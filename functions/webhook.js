export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return new Response('OK', { status: 200 });
  }

  try {
    const update = await request.json();
    console.log('📥 Telegram update:', update);

    // Handle channel posts
    if (update.channel_post) {
      const message = update.channel_post;
      
      // Check if message is from monitored channel
      if (message.chat.id.toString() === env.CHANNEL_ID?.toString()) {
        return await processChannelMessage(message, env);
      }
    }

    return new Response('OK', { status: 200 });

  } catch (error) {
    console.error('❌ Webhook error:', error);
    return new Response('OK', { status: 200 });
  }
}

async function processChannelMessage(message, env) {
  try {
    // Extract file info from different message types
    let fileInfo = null;
    let filename = 'file';

    if (message.document) {
      fileInfo = message.document;
      filename = fileInfo.file_name || 'document';
    } else if (message.video) {
      fileInfo = message.video;
      filename = `video_${Date.now()}.mp4`;
    } else if (message.photo) {
      fileInfo = message.photo[message.photo.length - 1]; // Largest photo
      filename = `photo_${Date.now()}.jpg`;
    } else if (message.audio) {
      fileInfo = message.audio;
      filename = fileInfo.file_name || `audio_${Date.now()}.mp3`;
    } else {
      console.log('ℹ️ No supported file found in message');
      return new Response('OK', { status: 200 });
    }

    if (!fileInfo?.file_id) {
      console.log('❌ No file_id found');
      return new Response('OK', { status: 200 });
    }

    console.log(`📎 Processing file: ${filename} (${fileInfo.file_size} bytes)`);

    // Generate unique file ID
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 6);
    const fileId = `tl_${timestamp}_${random}`;
    const extension = getFileExtension(filename);

    // Get Telegram file URL
    const telegramUrl = await getTelegramFileUrl(fileInfo.file_id, env.BOT_TOKEN);
    
    // Store file metadata in KV
    const fileData = {
      id: fileId,
      filename: filename,
      extension: extension,
      size: fileInfo.file_size || 0,
      telegramFileId: fileInfo.file_id,
      telegramUrl: telegramUrl,
      uploadedAt: Date.now(),
      messageId: message.message_id,
      lastRefresh: Date.now(),
      refreshCount: 0
    };

    await env.TELELINK.put(fileId, JSON.stringify(fileData));
    console.log(`✅ File stored in KV: ${fileId}`);

    // Generate permanent link
    const baseUrl = `https://${env.DOMAIN || 'your-project.pages.dev'}`;
    const permanentUrl = `${baseUrl}/files/${fileId}${extension}`;

    // Send reply to channel with permanent link
    const replyText = `🔗 **Permanent Link Generated!**\n\n` +
                     `📁 **File:** ${filename}\n` +
                     `💾 **Size:** ${formatBytes(fileInfo.file_size || 0)}\n` +
                     `🌐 **Link:** ${permanentUrl}\n` +
                     `⬇️ **Download:** ${permanentUrl}?dl=1\n\n` +
                     `✨ **Auto-refreshing • Never expires**`;

    await sendTelegramMessage(env.BOT_TOKEN, message.chat.id, replyText, message.message_id);

    return new Response('OK', { status: 200 });

  } catch (error) {
    console.error('❌ Process message error:', error);
    return new Response('OK', { status: 200 });
  }
}

async function getTelegramFileUrl(fileId, botToken) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const data = await response.json();
  
  if (!data.ok || !data.result?.file_path) {
    throw new Error('Failed to get Telegram file URL');
  }
  
  return `https://api.telegram.org/file/bot${botToken}/${data.result.file_path}`;
}

async function sendTelegramMessage(botToken, chatId, text, replyToMessageId) {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        reply_to_message_id: replyToMessageId,
        parse_mode: 'Markdown'
      })
    });
  } catch (error) {
    console.error('Send message error:', error);
  }
}

function getFileExtension(filename) {
  return filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
