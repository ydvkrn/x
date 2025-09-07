export async function onRequest(context) {
  const { env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('📋 Loading files list...');

    // Get all files from KV
    const listResult = await env.TELELINK.list();
    
    if (!listResult.keys || listResult.keys.length === 0) {
      console.log('📁 No files found in KV');
      return new Response(JSON.stringify({
        success: true,
        files: [],
        total: 0
      }), { headers: corsHeaders });
    }

    // Get file data for each key
    const filePromises = listResult.keys.map(async (key) => {
      try {
        const fileDataString = await env.TELELINK.get(key.name);
        if (fileDataString) {
          const fileData = JSON.parse(fileDataString);
          return {
            id: fileData.id,
            filename: fileData.filename,
            extension: fileData.extension,
            size: fileData.size,
            uploadedAt: fileData.uploadedAt,
            refreshCount: fileData.refreshCount || 0,
            lastRefresh: fileData.lastRefresh
          };
        }
        return null;
      } catch (error) {
        console.error(`Error loading file ${key.name}:`, error);
        return null;
      }
    });

    const files = (await Promise.all(filePromises)).filter(file => file !== null);
    
    // Sort by upload date (newest first)
    files.sort((a, b) => b.uploadedAt - a.uploadedAt);

    console.log(`✅ Loaded ${files.length} files`);

    return new Response(JSON.stringify({
      success: true,
      files: files,
      total: files.length
    }), { headers: corsHeaders });

  } catch (error) {
    console.error('❌ Files list error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), { status: 500, headers: corsHeaders });
  }
}
