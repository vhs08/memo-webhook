// Memo Assistant — WhatsApp Webhook Handler
// Handles Meta verification + receives messages + stores in Supabase

// These values are read from Vercel Environment Variables (secure, not in code)
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'memo_verify_2026';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xgsioilxmmpmfgndfmar.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY;

export default async function handler(req, res) {
  // ============================================
  // STEP 1: Handle Meta webhook verification (GET)
  // Meta sends a GET request with a challenge code
  // We must return that exact code to prove we own this URL
  // ============================================
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook verified successfully');
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Verification failed');
  }

  // ============================================
  // STEP 2: Handle incoming WhatsApp messages (POST)
  // Meta sends message data as JSON
  // We extract the relevant fields and store in Supabase
  // ============================================
  if (req.method === 'POST') {
    const body = req.body;

    // Always respond 200 quickly (Meta requires response within 5 seconds)
    // We process the message before responding
    try {
      // Navigate the Meta webhook payload structure
      const entry = body?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      // Check if this is an actual message (not a status update)
      if (value?.messages && value.messages.length > 0) {
        const message = value.messages[0];
        const phone = message.from; // sender's phone number
        const messageType = message.type; // 'text', 'audio', 'image', etc.

        // Extract text content based on message type
        let originalText = null;
        let audioUrl = null;

        if (messageType === 'text') {
          originalText = message.text?.body || '';
        } else if (messageType === 'audio') {
          // Audio messages have an ID — we'll handle transcription in Phase 2
          audioUrl = message.audio?.id || '';
        }

        // Store in Supabase
        const supabaseResponse = await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            phone_number: phone,
            message_type: messageType === 'text' ? 'text' : 'audio',
            original_text: originalText,
            audio_url: audioUrl,
            status: 'received'
          })
        });

        if (!supabaseResponse.ok) {
          console.error('Supabase error:', await supabaseResponse.text());
        } else {
          console.log(`Message from ${phone} stored successfully`);
        }
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }

    // Always return 200 to Meta (otherwise they retry and eventually disable webhook)
    return res.status(200).json({ status: 'ok' });
  }

  // Any other HTTP method
  return res.status(405).send('Method not allowed');
}
