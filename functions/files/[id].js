export async function onRequest(context) {
  const { request, env, params } = context;
  const fileId = params.id;

  console.log(`🔍 Serving file: ${fileId}`);

  try {
    // Get file data from KV
    const fileDataString = await env.TELELINK.get(fileId);
    
    if (!fileDataString) {
      console.log(`❌ File not found: ${fileId}`);
      return new Response('File not found', { status: 404 });
    }

    const fileData = JSON.parse(fileDataString);
    console.log(`📄 File data loaded: ${fileData.filename}`);

    // Try to fetch file from Telegram URL
    let response = await fetch(fileData.telegramUrl);
    
    // If URL expired, refresh it
    if (!response.ok && (response.status === 403 || response.status === 404 || response.status === 410)) {
      console.log(`🔄 Telegram URL expired, refreshing... (${response.status})`);
      
      try {
        // Get new Telegram URL
        const newTelegramUrl = await refreshTelegramUrl(fileData.telegramFileId, env.BOT_TOKEN);
        
        // Update KV with new URL
        const updatedFileData = {
          ...fileData,
          telegramUrl: newTelegramUrl,
          lastRefresh: Date.now(),
          refreshCount: (fileData.refreshCount || 0) + 1
        };
        
        await env.TELELINK.put(fileId, JSON.stringify(updatedFileData));
        console.log(`✅ URL refreshed for ${fileId} (refresh #${updatedFileData.refreshCount})`);
        
        // Fetch with new URL
        response = await fetch(newTelegramUrl);
        
      } catch (refreshError) {
        console.error(`❌ Failed to refresh URL for ${fileId}:`, refreshError);
        return new Response('File temporarily unavailable', { status: 503 });
      }
    }

    if (!response.ok) {
      console.log(`❌ Failed to fetch file: ${response.status}`);
      return new Response('Failed to fetch file', { status: response.status });
    }

    // Set response headers
    const headers = new Headers();
    const contentType = getContentType(fileData.extension);
    
    headers.set('Content-Type', contentType);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'public, max-age=3600');
    headers.set('Accept-Ranges', 'bytes');

    // Copy relevant headers from Telegram response
    if (response.headers.get('Content-Length')) {
      headers.set('Content-Length', response.headers.get('Content-Length'));
    }

    // Handle download vs view
    const url = new URL(request.url);
    const isDownload = url.searchParams.has('dl');
    
    if (isDownload) {
      headers.set('Content-Disposition', `attachment; filename="${fileData.filename}"`);
    } else {
      if (contentType.startsWith('image/') || contentType.startsWith('video/') || 
          contentType.startsWith('audio/') || contentType === 'application/pdf') {
        headers.set('Content-Disposition', 'inline');
      } else {
        headers.set('Content-Disposition', `attachment; filename="${fileData.filename}"`);
      }
    }

    console.log(`✅ Serving file: ${fileData.filename} (${contentType})`);

    return new Response(response.body, {
      status: 200,
      headers: headers
    });

  } catch (error) {
    console.error(`❌ File serve error for ${fileId}:`, error);
    return new Response(`Server error: ${error.message}`, { status: 500 });
  }
}

async function refreshTelegramUrl(fileId, botToken) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const data = await response.json();
  
  if (!data.ok || !data.result?.file_path) {
    throw new Error('Failed to refresh Telegram file URL');
  }
  
  return `https://api.telegram.org/file/bot${botToken}/${data.result.file_path}`;
}

function getContentType(extension) {
  const mimeTypes = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska', '.webm': 'video/webm',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac',
    '.pdf': 'application/pdf', '.txt': 'text/plain',
    '.zip': 'application/zip', '.rar': 'application/vnd.rar'
  };
  
  return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
}
