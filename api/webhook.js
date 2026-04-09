// Memo Assistant — WhatsApp Webhook Handler (Phase 2)
// Fluxo: recebe mensagem → (se áudio) transcreve com Whisper → categoriza com GPT-5-nano
//         → grava no Supabase → envia confirmação via WhatsApp

// ============================================
// ENVIRONMENT VARIABLES (configuradas no Vercel)
// ============================================
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'memo_verify_2026';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xgsioilxmmpmfgndfmar.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

// Categorias válidas (conforme PRD v1.3)
const VALID_CATEGORIES = ['AGENDA', 'FINANCAS', 'SAUDE', 'ESCOLA', 'RECADOS', 'OUTROS'];

// Emojis de confirmação por categoria
const CATEGORY_EMOJI = {
  AGENDA: '📅',
  FINANCAS: '💰',
  SAUDE: '💊',
  ESCOLA: '🎒',
  RECADOS: '📝',
  OUTROS: '📦'
};

// ============================================
// MAIN HANDLER
// ============================================
export default async function handler(req, res) {
  // --- GET: verificação de webhook da Meta ---
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

  // --- POST: mensagem recebida da Meta ---
  if (req.method === 'POST') {
    // IMPORTANTE: em serverless (Vercel), a função é terminada assim que
    // a resposta é enviada. Por isso processamos ANTES de responder 200.
    // Meta tolera até ~20s — temos folga para Whisper + GPT + Supabase + reply.
    try {
      await processMessage(req.body);
    } catch (error) {
      console.error('Error processing message:', error);
    }
    return res.status(200).json({ status: 'ok' });
  }
}

// ============================================
// PROCESSAMENTO PRINCIPAL
// ============================================
async function processMessage(body) {
  // Navega a estrutura do payload da Meta
  const entry = body?.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;
  const message = value?.messages?.[0];

  // Se não é mensagem (ex: status update), ignora
  if (!message) {
    console.log('No message in payload (likely status update)');
    return;
  }

  const phoneNumber = message.from;
  const messageType = message.type;

  console.log(`Received ${messageType} from ${phoneNumber}`);

  let originalText = null;
  let audioUrl = null;
  let storedType = null;

  // --- Extrai/transcreve o texto conforme o tipo ---
  if (messageType === 'text') {
    originalText = message.text?.body || '';
    storedType = 'text';
  } else if (messageType === 'audio') {
    const audioId = message.audio?.id;
    if (!audioId) {
      console.error('Audio message without ID');
      return;
    }
    try {
      originalText = await transcribeAudio(audioId);
      audioUrl = `meta_media_id:${audioId}`;
      storedType = 'audio';
      console.log(`Transcribed audio: "${originalText}"`);
    } catch (err) {
      console.error('Whisper transcription failed:', err);
      await sendWhatsAppReply(phoneNumber, '⚠️ Não consegui transcrever o áudio. Tenta mandar por texto?');
      return;
    }
  } else {
    // Tipos não suportados (imagem, vídeo, documento, etc.)
    await sendWhatsAppReply(phoneNumber, '⚠️ Por enquanto só aceito texto ou áudio. Outros formatos ainda não.');
    return;
  }

  // --- Categoriza com GPT-5-nano ---
  let category = 'OUTROS';
  try {
    category = await categorize(originalText);
    console.log(`Categorized as: ${category}`);
  } catch (err) {
    console.error('Categorization failed:', err);
    // Continua com OUTROS — não bloqueia o fluxo
  }

  // --- Grava no Supabase ---
  try {
    await saveToSupabase({
      phone_number: phoneNumber,
      message_type: storedType,
      original_text: originalText,
      audio_url: audioUrl,
      category: category,
      status: 'processed'
    });
    console.log('Saved to Supabase');
  } catch (err) {
    console.error('Supabase save failed:', err);
  }

  // --- Envia confirmação de volta ao usuário ---
  try {
    const emoji = CATEGORY_EMOJI[category] || '📦';
    const preview = originalText.length > 80 ? originalText.substring(0, 80) + '...' : originalText;
    const replyText = `${emoji} Anotado em ${category}:\n"${preview}"`;
    await sendWhatsAppReply(phoneNumber, replyText);
    console.log('Confirmation sent to user');
  } catch (err) {
    console.error('Failed to send confirmation:', err);
  }
}

// ============================================
// TRANSCRIÇÃO DE ÁUDIO (Whisper)
// ============================================
async function transcribeAudio(mediaId) {
  // Passo 1: pedir à Meta a URL de download do arquivo
  const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
  });
  if (!metaRes.ok) throw new Error(`Meta media fetch failed: ${metaRes.status}`);
  const metaData = await metaRes.json();
  const mediaUrl = metaData.url;
  if (!mediaUrl) throw new Error('No media URL returned by Meta');

  // Passo 2: baixar o arquivo de áudio (também requer token)
  const audioRes = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
  });
  if (!audioRes.ok) throw new Error(`Audio download failed: ${audioRes.status}`);
  const audioBuffer = await audioRes.arrayBuffer();

  // Passo 3: enviar pro Whisper
  const formData = new FormData();
  formData.append('file', new Blob([audioBuffer], { type: 'audio/ogg' }), 'audio.ogg');
  formData.append('model', 'whisper-1');
  formData.append('language', 'pt');

  const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: formData
  });
  if (!whisperRes.ok) {
    const errText = await whisperRes.text();
    throw new Error(`Whisper API failed: ${whisperRes.status} ${errText}`);
  }
  const whisperData = await whisperRes.json();
  return whisperData.text || '';
}

// ============================================
// CATEGORIZAÇÃO (GPT-5-nano)
// ============================================
async function categorize(text) {
  const systemPrompt = `Você é um assistente que categoriza mensagens de pais sobre suas crianças e casa.
Categorize em UMA das seguintes categorias, respondendo APENAS com o nome em maiúsculas, sem explicação:

AGENDA - compromissos, reuniões, aniversários, eventos futuros, datas
FINANCAS - pagamentos, mensalidades, contas, dinheiro, despesas
SAUDE - médico, remédio, sintomas, consultas, vacinas, dentista
ESCOLA - lição de casa, prova, reunião escolar, professor, boletim, material
RECADOS - lembretes, coisas para comprar, tarefas domésticas, compras
OUTROS - qualquer coisa que não se encaixe acima

Responda APENAS com uma palavra da lista acima.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-5-nano',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      max_tokens: 10,
      temperature: 0
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GPT API failed: ${res.status} ${errText}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content?.trim().toUpperCase() || 'OUTROS';
  // Valida: se o GPT retornar algo fora da lista, cai pra OUTROS
  return VALID_CATEGORIES.includes(raw) ? raw : 'OUTROS';
}

// ============================================
// SALVAR NO SUPABASE
// ============================================
async function saveToSupabase(data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Supabase insert failed: ${res.status} ${errText}`);
  }
}

// ============================================
// ENVIAR RESPOSTA VIA WHATSAPP
// ============================================
async function sendWhatsAppReply(to, text) {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        text: { body: text }
      })
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WhatsApp send failed: ${res.status} ${errText}`);
  }
}
