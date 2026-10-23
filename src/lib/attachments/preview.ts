import { safeFetch } from '@/lib/network/ssrf-guard';
import { logger } from '@/lib/logger';

export async function getExternalLinkPreview(url: string): Promise<{
  title?: string;
  thumbnailUrl?: string;
  description?: string;
}> {
  // Google Drive - Extract file ID and use thumbnail URL pattern
  if (url.includes('drive.google.com')) {
    const fileId = extractGoogleDriveId(url);
    if (fileId) {
      return {
        title: 'Google Drive File',
        thumbnailUrl: `https://lh3.googleusercontent.com/d/${fileId}`,
        description: 'Shared Google Drive file',
      };
    }
  }

  // Dropbox - Convert to preview link
  if (url.includes('dropbox.com')) {
    const previewUrl = convertDropboxToPreview(url);
    return {
      title: 'Dropbox File',
      thumbnailUrl: previewUrl,
      description: 'Shared Dropbox file',
    };
  }

  // OneDrive - Similar pattern
  if (url.includes('onedrive.live.com') || url.includes('1drv.ms')) {
    return {
      title: 'OneDrive File',
      thumbnailUrl: undefined,
      description: 'Shared OneDrive file',
    };
  }

  // Generic fallback - Try to fetch Open Graph metadata
  const ogData = await fetchOpenGraphMetadata(url);
  if (ogData) {
    return {
      title: ogData.title || 'External Link',
      thumbnailUrl: ogData.image,
      description: ogData.description,
    };
  }

  // Last resort
  return {
    title: 'External Link',
    thumbnailUrl: undefined,
    description: 'Shared file from external storage',
  };
}

function extractGoogleDriveId(url: string): string | null {
  const patterns = [
    /\/d\/([^/?]+)/,
    /\/open\?id=([^&]+)/,
    /\/file\/d\/([^/?]+)/,
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function convertDropboxToPreview(url: string): string {
  return url.replace('www.dropbox.com', 'dl.dropboxusercontent.com')
            .replace('?dl=0', '?raw=1');
}

async function fetchOpenGraphMetadata(url: string): Promise<{
  title?: string;
  image?: string;
  description?: string;
} | null> {
  try {
    const response = await safeFetch(
      url,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } },
      { maxRedirects: 3, maxSizeBytes: 256 * 1024, timeoutMs: 5000 }
    );
    const html = await response.text();
    
    // Parse Open Graph tags
    const titleMatch = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i);
    const imageMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
    const descMatch = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i);
    
    if (titleMatch || imageMatch) {
      return {
        title: titleMatch?.[1],
        image: imageMatch?.[1],
        description: descMatch?.[1],
      };
    }
  } catch (e: any) {
    logger.debug('OpenGraph metadata fetch skipped', {
      module: 'AttachmentsPreview',
      action: 'fetchOpenGraphMetadata',
      url,
      reason: e?.message,
    });
  }
  return null;
}