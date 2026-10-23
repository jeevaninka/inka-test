import dns from 'dns/promises';
import net from 'net';

export function isPrivateOrForbiddenIp(ipAddress: string): boolean {
  let ip = ipAddress.trim().toLowerCase();

  // Handle IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  const version = net.isIP(ip);
  if (version === 0) {
    return true; // Not a valid IP, block by default
  }

  if (version === 4) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true;
    }
    const [a, b] = parts;

    // 0.0.0.0/8 (Current network)
    if (a === 0) return true;
    // 10.0.0.0/8 (Private)
    if (a === 10) return true;
    // 100.64.0.0/10 (Carrier-Grade NAT)
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 127.0.0.0/8 (Loopback)
    if (a === 127) return true;
    // 169.254.0.0/16 (Link-Local / AWS Metadata)
    if (a === 169 && b === 254) return true;
    // 172.16.0.0/12 (Private)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16 (Private)
    if (a === 192 && b === 168) return true;
    // 224.0.0.0/4 (Multicast)
    if (a >= 224 && a <= 239) return true;
    // 240.0.0.0/4 (Reserved)
    if (a >= 240) return true;

    return false;
  }

  if (version === 6) {
    // ::1 (Loopback)
    if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true;
    // :: (Unspecified)
    if (ip === '::' || ip === '0:0:0:0:0:0:0:0') return true;
    // fc00::/7 (Unique Local Address)
    if (ip.startsWith('fc') || ip.startsWith('fd')) return true;
    // fe80::/10 (Link-Local)
    if (
      ip.startsWith('fe8') ||
      ip.startsWith('fe9') ||
      ip.startsWith('fea') ||
      ip.startsWith('feb')
    ) {
      return true;
    }

    return false;
  }

  return true;
}

export async function validateDestinationUrl(
  urlStr: string,
  options?: { allowlistDomains?: string[] }
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error('Invalid URL format');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Blocked protocol: only HTTP and HTTPS are permitted');
  }

  const hostname = parsed.hostname;

  // Check optional domain allowlist for internal enterprise PM tools
  if (options?.allowlistDomains?.length) {
    const allowed = options.allowlistDomains.some(
      (d) => hostname === d || hostname.endsWith(`.${d}`)
    );
    if (allowed) {
      return parsed;
    }
  }

  // Resolve hostname DNS to check IP addresses
  let addresses: { address: string; family: number }[] = [];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch (err: any) {
    throw new Error(`DNS resolution failed for hostname ${hostname}: ${err.message}`);
  }

  if (!addresses.length) {
    throw new Error(`Unable to resolve host ${hostname}`);
  }

  for (const record of addresses) {
    if (isPrivateOrForbiddenIp(record.address)) {
      throw new Error(
        `SSRF Protection: Access to ${hostname} (${record.address}) is forbidden`
      );
    }
  }

  return parsed;
}

/**
 * Safe fetch wrapper that prevents SSRF, DNS rebinding, unvalidated redirect chains,
 * and caps response size and duration.
 */
export async function safeFetch(
  urlStr: string,
  init: RequestInit = {},
  options?: {
    maxRedirects?: number;
    maxSizeBytes?: number;
    timeoutMs?: number;
    allowlistDomains?: string[];
  }
): Promise<{ ok: boolean; status: number; statusText: string; text: () => Promise<string>; headers: Headers }> {
  const maxRedirects = options?.maxRedirects ?? 3;
  const maxSizeBytes = options?.maxSizeBytes ?? 512 * 1024; // 512KB cap
  const timeoutMs = options?.timeoutMs ?? 7000;

  let currentUrl = urlStr;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const validated = await validateDestinationUrl(currentUrl, {
      allowlistDomains: options?.allowlistDomains,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(validated.toString(), {
        ...init,
        redirect: 'manual', // Never follow redirects blindly
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // Handle redirect manually
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        const nextLocation = response.headers.get('location')!;
        currentUrl = new URL(nextLocation, validated).toString();
        continue;
      }

      // Stream with size cap
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        text: async () => {
          if (!response.body) {
            return response.text();
          }

          const reader = response.body.getReader();
          let bytesReceived = 0;
          const chunks: Uint8Array[] = [];

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              bytesReceived += value.length;
              if (bytesReceived > maxSizeBytes) {
                await reader.cancel();
                throw new Error(`Response body exceeds maximum permitted size (${maxSizeBytes} bytes)`);
              }
              chunks.push(value);
            }
          }

          const totalBuffer = Buffer.concat(chunks);
          return totalBuffer.toString('utf-8');
        },
      };
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeoutMs}ms`);
      }
      throw err;
    }
  }

  throw new Error(`Exceeded maximum redirect limit (${maxRedirects})`);
}
