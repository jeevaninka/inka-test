import { describe, it, expect } from 'vitest';
import { isPrivateOrForbiddenIp, validateDestinationUrl } from '@/lib/network/ssrf-guard';

describe('SSRF Guard IP and URL Verification', () => {
  it('correctly identifies private, loopback, metadata, and link-local IPv4 addresses', () => {
    // Loopback
    expect(isPrivateOrForbiddenIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrForbiddenIp('127.255.255.255')).toBe(true);

    // AWS EC2 / ECS Metadata IP
    expect(isPrivateOrForbiddenIp('169.254.169.254')).toBe(true);

    // Private RFC1918
    expect(isPrivateOrForbiddenIp('10.0.0.1')).toBe(true);
    expect(isPrivateOrForbiddenIp('172.16.0.5')).toBe(true);
    expect(isPrivateOrForbiddenIp('172.31.255.255')).toBe(true);
    expect(isPrivateOrForbiddenIp('192.168.1.1')).toBe(true);

    // Carrier-Grade NAT (RFC 6598)
    expect(isPrivateOrForbiddenIp('100.64.0.1')).toBe(true);
    expect(isPrivateOrForbiddenIp('100.127.255.255')).toBe(true);

    // Current network & reserved
    expect(isPrivateOrForbiddenIp('0.0.0.0')).toBe(true);
    expect(isPrivateOrForbiddenIp('240.0.0.1')).toBe(true);

    // Legitimate public IPs
    expect(isPrivateOrForbiddenIp('8.8.8.8')).toBe(false);
    expect(isPrivateOrForbiddenIp('1.1.1.1')).toBe(false);
    expect(isPrivateOrForbiddenIp('93.184.216.34')).toBe(false);
  });

  it('correctly identifies IPv6 loopback, local, and mapped addresses', () => {
    expect(isPrivateOrForbiddenIp('::1')).toBe(true);
    expect(isPrivateOrForbiddenIp('::')).toBe(true);
    expect(isPrivateOrForbiddenIp('fe80::1')).toBe(true);
    expect(isPrivateOrForbiddenIp('fc00::1')).toBe(true);
    expect(isPrivateOrForbiddenIp('fd12:3456:789a::1')).toBe(true);

    // IPv4-mapped IPv6
    expect(isPrivateOrForbiddenIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateOrForbiddenIp('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateOrForbiddenIp('::ffff:8.8.8.8')).toBe(false);
  });

  it('rejects forbidden URLs attempting to access localhost or metadata', async () => {
    await expect(validateDestinationUrl('http://127.0.0.1:3000/test')).rejects.toThrow(/SSRF Protection/);
    await expect(validateDestinationUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow(/SSRF Protection/);
    await expect(validateDestinationUrl('http://localhost:3002')).rejects.toThrow(/SSRF Protection/);
  });

  it('honors domain allowlist for internal self-hosted tools', async () => {
    const url = await validateDestinationUrl('http://internal-jira.corp.local/api', {
      allowlistDomains: ['internal-jira.corp.local'],
    });
    expect(url.hostname).toBe('internal-jira.corp.local');
  });
});
