// Memo Assistant — WhatsApp Webhook Handler (Phase 3)
// Fluxo: recebe mensagem → (onboarding se user novo) → (áudio vira texto via Whisper)
//         → categoriza com GPT-4o-mini → grava no Supabase → GERA REPLY COM PERSONA via GPT
// Categorias (4): FINANCAS, COMPRAS, AGENDA, LEMBRETES
// Personas (4): alfred, mae, coach, ceo

// ============================================
// ENVIRONMENT VARIABLES (configuradas no Vercel)
// ============================================
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'memo_verify_2026';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xgsioilxmmpmfgndfmar.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

// Categorias válidas (taxonomia simplificada 2026-04-09: 4 categorias)
const VALID_CATEGORIES = ['AGENDA', 'COMPRAS', 'LEMBRETES', 'FINANCAS'];

// Emojis de confirmação por categoria (fallback se generateReply falhar)
const CATEGORY_EMOJI = {
  AGENDA: '📅',
  COMPRAS: '🛒',
  LEMBRETES: '📝',
  FINANCAS: '💰'
};

// ============================================
// PERSONA PROMPTS — PHASE 3
// Cada persona tem tom e exemplos. Temperature alta + instruções
// explícitas de "nunca repetir" garantem variação real nos replies.
// ============================================
const PERSONA_PROMPTS = {
  alfred: `Você é {MEMO_NAME}, um mordomo britânico digital — extensão discreta e eficiente do seu patrão. Você trata o usuário SEMPRE por "senhor" ou "senhora". Nunca familiar, nunca gírias, nunca emojis em excesso (no máximo 1 pontual, e raramente). Tom: formal, cerimonioso sem ser pesado, levemente seco, cada palavra calculada. Você tem classe, não tem pressa.

Exemplos de confirmações (NUNCA copie, use só como referência de TOM):
- "Registrado, senhor. Dentista da Antonella confirmado para sexta às 14h — constará na agenda."
- "Providência anotada: seguro do veículo quitado. Permita-me arquivar sob finanças."
- "Pois não. Consulta marcada, senhor."
- "Certamente. O pagamento pendente foi devidamente registrado."

REGRAS DE OURO:
1. JAMAIS use o mesmo formato duas vezes seguidas. Varie início, estrutura, ritmo.
2. 1 a 2 frases. Nunca mais.
3. Mencione a categoria (AGENDA / COMPRAS / LEMBRETES / FINANCAS) apenas se for natural — jamais como label robótico tipo "[FINANCAS]".
4. Sem emojis corridos. No máximo 1, e raríssimo.
5. Você é um mordomo, não um robô. Tenha alma britânica.`,

  mae: `Você é {MEMO_NAME}, a mãe amorosa que o usuário sempre teve por perto. Você fala PT-BR carinhoso, usa "amor", "meu bem", "filho", "filha", "querido(a)". Tom: afetuoso, tranquilizador, curto em palavras mas cheio de calor humano. Você se preocupa. Você cuida.

Exemplos de confirmações (NUNCA copie, use só como referência de TOM):
- "Tá anotado aqui, amor. Dentista da Antonella sexta 14h, fica tranquilo 💛"
- "Deixa comigo, meu bem. Seguro do carro já tá guardado."
- "Prontinho, filho. Mais uma coisa a menos na tua cabeça."
- "Guardei, querido. Pode mandar o próximo sem medo."

REGRAS DE OURO:
1. JAMAIS use o mesmo formato duas vezes seguidas. Varie chamamento, estrutura, abertura.
2. 1 a 2 frases curtinhas. Mãe não discursa.
3. Emojis permitidos com moderação: 💛 🌸 ☕️ 🤗 (1 por mensagem, e nem sempre).
4. Nunca mencione a categoria como label. Fala natural: "tua agenda", "as contas", "a listinha de compras".
5. Você é calor humano. Nunca seja fria, nunca seja corporativa.`,

  coach: `Você é {MEMO_NAME}, um coach de alta performance — o assistente pessoal mais energético do usuário. Tom: direto, confiante, afirmativo, motivacional sem ser clichê meloso. Você celebra micro-wins. Usa CAPS ocasional pra ênfase (sem exagerar). Fala como quem tá no corner do ringue torcendo pelo seu atleta.

Exemplos de confirmações (NUNCA copie, use só como referência de TOM):
- "FECHOU! Dentista da Antonella na agenda, sexta 14h. Segue o jogo 💪"
- "Mais um pago. Tá no controle TOTAL das contas essa semana."
- "Anotado. Tua lista não para de diminuir, tô vendo isso 🔥"
- "Capturado. Próximo."

REGRAS DE OURO:
1. JAMAIS repita a mesma abertura ou bordão duas vezes seguidas. Varie SEMPRE.
2. 1 a 2 frases. Coach bom é curto e elétrico.
3. Emojis permitidos: 💪 🔥 ✅ ⚡️ 🎯 (1 ou 2 por mensagem, não sempre).
4. Nunca mencione categoria como label. Fale natural: "agenda", "as contas", "tua lista".
5. Celebre sem exagerar. Energia alta, clichê baixo.`,

  ceo: `Você é {MEMO_NAME}, o chief of staff digital do usuário — assistente executivo de alto nível. Tom: profissional, conciso, orientado a execução, ZERO cerimônia, ZERO familiaridade. Você é eficiência pura. Cada palavra tem função. Nenhuma palavra sobra. Você não puxa conversa, você entrega.

Exemplos de confirmações (NUNCA copie, use só como referência de TOM):
- "Agendado: dentista Antonella, sexta 14h."
- "Seguro do carro registrado em finanças."
- "Lembrete capturado. Seguiremos."
- "Feito. No sistema."

REGRAS DE OURO:
1. JAMAIS use o mesmo formato duas vezes seguidas. Varie estrutura e ritmo.
2. 1 frase curta, no máximo 2. Executivo bom não enrola.
3. ZERO emojis (raríssima exceção: ✓ quando fizer sentido).
4. Nunca use label robótico tipo "[CATEGORIA]". Integre naturalmente ("em finanças", "na agenda", "como lembrete").
5. Sem calor humano, sem exclamação, sem "amor", sem "senhor". Executivo puro.`
};

// Rótulos legíveis das personas (pra mensagens de onboarding)
const PERSONA_LABELS = {
  alfred: 'Alfred',
  mae: 'Mãe',
  coach: 'Coach',
  ceo: 'CEO'
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
    // Processa ANTES de responder 200 (Vercel serverless encerra ao responder)
    try {
      await processMessage(req.body);
    } catch (error) {
      console.error('Error processing message:', error);
    }
    return res.status(200).json({ status: 'ok' });
  }

  return res.status(405).send('Method not allowed');
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

  // --- Extrai texto bruto da mensagem (suporta texto ou áudio) ---
  let originalText = null;
  let audioUrl = null;
  let storedType = null;

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
    await sendWhatsAppReply(phoneNumber, '⚠️ Por enquanto só aceito texto ou áudio. Outros formatos ainda não.');
    return;
  }

  // --- Carrega (ou cria) o user do Supabase ---
  let user = await fetchUser(phoneNumber);

  if (!user) {
    // Primeira mensagem — cria row já em 'awaiting_name' e manda pergunta 1
    await createUser(phoneNumber);
    await sendWhatsAppReply(
      phoneNumber,
      `Oi! 👋 Eu vou ser seu assistente pessoal — tudo que você me mandar (texto, áudio, conta, compra, compromisso) eu organizo pra você.\n\nAntes de começar, preciso de 2 coisinhas rápidas.\n\n*1/2 — Que nome você quer me dar?*\n(Se não quiser escolher, é só mandar "Memo")`
    );
    return;
  }

  // --- State machine de onboarding ---
  if (user.onboarding_state === 'awaiting_name') {
    const name = (originalText || '').trim() || 'Memo';
    // Capitaliza primeira letra (se o user mandou minúsculo)
    const memoName = name.charAt(0).toUpperCase() + name.slice(1);
    await updateUser(phoneNumber, {
      memo_name: memoName,
      onboarding_state: 'awaiting_persona'
    });
    await sendWhatsAppReply(
      phoneNumber,
      `Perfeito, *${memoName}* na área. 🎩\n\n*2/2 — Como você quer que eu fale com você?*\n\n1️⃣ *Alfred* — formal, discreto, britânico. Te trata por "senhor/senhora".\n2️⃣ *Mãe* — carinhoso, afetuoso, te chama de "amor".\n3️⃣ *Coach* — direto, motivacional, alta energia.\n4️⃣ *CEO* — executivo, conciso, sem rodeios.\n\nResponde só com o número (1, 2, 3 ou 4).`
    );
    return;
  }

  if (user.onboarding_state === 'awaiting_persona') {
    const choice = (originalText || '').trim();
    const personaMap = { '1': 'alfred', '2': 'mae', '3': 'coach', '4': 'ceo' };
    const persona = personaMap[choice];

    if (!persona) {
      await sendWhatsAppReply(
        phoneNumber,
        `Hmm, não entendi. Manda só o número: *1* (Alfred), *2* (Mãe), *3* (Coach) ou *4* (CEO).`
      );
      return;
    }

    await updateUser(phoneNumber, {
      persona: persona,
      onboarding_state: 'done'
    });

    // Primeira fala OFICIAL já no tom da persona escolhida — GPT gera
    const updatedUser = { ...user, memo_name: user.memo_name, persona };
    try {
      const welcome = await generateReply(updatedUser, {
        isWelcome: true
      });
      await sendWhatsAppReply(phoneNumber, welcome);
    } catch (err) {
      console.error('Welcome reply generation failed:', err);
      // Fallback estático
      await sendWhatsAppReply(
        phoneNumber,
        `Pronto. Pode me mandar qualquer coisa — conta, compra, compromisso, recado — eu guardo pra você.`
      );
    }
    return;
  }

  // --- Onboarding completo → fluxo normal de captura ---
  // user.onboarding_state === 'done'

  // Categoriza com GPT-4o-mini
  let category = 'LEMBRETES'; // fallback se a API falhar
  let metadata = null;
  try {
    const result = await categorize(originalText);
    category = result.category;
    metadata = result.metadata;
    console.log(`Categorized as: ${category}`);
    if (metadata) {
      console.log(`Metadata: ${JSON.stringify(metadata)}`);
    }
  } catch (err) {
    console.error('Categorization failed:', err);
  }

  // Grava no Supabase
  try {
    await saveToSupabase({
      phone_number: phoneNumber,
      message_type: storedType,
      original_text: originalText,
      audio_url: audioUrl,
      category: category,
      status: 'processed',
      metadata: metadata
    });
    console.log('Saved to Supabase');
  } catch (err) {
    console.error('Supabase save failed:', err);
  }

  // Gera reply DINÂMICO com persona via GPT
  try {
    const reply = await generateReply(user, {
      category,
      metadata,
      originalText
    });
    await sendWhatsAppReply(phoneNumber, reply);
    console.log('Persona reply sent to user');
  } catch (err) {
    console.error('Persona reply failed, using fallback:', err);
    // Fallback: template estático antigo
    const emoji = CATEGORY_EMOJI[category] || '📦';
    const preview = originalText.length > 80 ? originalText.substring(0, 80) + '...' : originalText;
    await sendWhatsAppReply(phoneNumber, `${emoji} Anotado em ${category}:\n"${preview}"`);
  }
}

// ============================================
// USERS TABLE HELPERS (Supabase)
// ============================================
async function fetchUser(phoneNumber) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/users?phone_number=eq.${encodeURIComponent(phoneNumber)}&select=*`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      }
    }
  );
  if (!res.ok) {
    console.error('fetchUser failed:', res.status, await res.text());
    return null;
  }
  const rows = await res.json();
  return rows?.[0] || null;
}

async function createUser(phoneNumber) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({
      phone_number: phoneNumber,
      onboarding_state: 'awaiting_name'
    })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`createUser failed: ${res.status} ${errText}`);
  }
}

async function updateUser(phoneNumber, fields) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/users?phone_number=eq.${encodeURIComponent(phoneNumber)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(fields)
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`updateUser failed: ${res.status} ${errText}`);
  }
}

// ============================================
// TRANSCRIÇÃO DE ÁUDIO (Whisper) — inalterado do Phase 2
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
  formData.append('prompt', 'Nomes: Luigi, Antonella, Victor, Suelen. Memo assistente. Termos: Tesco, mercado, escola, dentista, consulta, farmácia, GP, boleto, mensalidade, pilates, academia, futebol.');

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
// CATEGORIZAÇÃO (GPT-4o-mini JSON) — inalterado do Phase 2
// ============================================
async function categorize(text) {
  const systemPrompt = `Você é o cérebro de categorização do Memo, um assistente de WhatsApp pra pais brasileiros/UK gerenciarem a vida doméstica.

Sua tarefa: ler a mensagem do usuário e devolver um JSON estruturado com a categoria + metadados úteis.

CATEGORIAS VÁLIDAS (escolha EXATAMENTE UMA das 4):
- FINANCAS: movimento financeiro JÁ CONFIRMADO (verbo no passado: "paguei", "gastei", "transferi", "recebi")
- COMPRAS: registro de compra JÁ REALIZADA (verbo no passado: "comprei", "já comprei", "adquiri")
- AGENDA: compromissos/eventos com data/hora específica OU com recorrência, pra comparecer
- LEMBRETES: TODAS as pendências — pagar, comprar, fazer, marcar, itens a repor, tarefas a realizar

REGRAS DE PRIORIDADE — AVALIE NESTA ORDEM EXATA (pare na primeira que bater):

PASSO 1 — FINANCAS (movimento financeiro JÁ CONFIRMADO, verbo no passado):
Só quando o verbo está EXPLICITAMENTE no passado: "paguei", "já paguei", "quitei", "gastei", "transferi", "recebi", "depositei". É registro de uma transação que JÁ ACONTECEU.
Exemplos:
- "Paguei a dentista hoje" → FINANCAS
- "Já paguei a mensalidade do Luigi" → FINANCAS
- "Gastei 200 libras no mercado" → FINANCAS
- "Transferi pro aluguel" → FINANCAS
- "Recebi o salário" → FINANCAS
IMPORTANTE: "Pagar X" (infinitivo/futuro) NÃO é FINANCAS — é LEMBRETES (PASSO 4). Pagamento pendente é tarefa, não registro financeiro.

PASSO 2 — COMPRAS (log de compra JÁ FEITA, verbo no passado):
Só quando o verbo está EXPLICITAMENTE no passado: "comprei", "comprou", "já comprei", "acabei de comprar", "adquiri". É registro de uma compra que ACONTECEU.
Exemplos: "Comprei leite no Tesco" → COMPRAS, "Já comprei o remédio da Antonella" → COMPRAS, "Comprei uniforme novo do Luigi" → COMPRAS.
IMPORTANTE: "Comprar X" (infinitivo/futuro) NÃO é COMPRAS — é LEMBRETES (PASSO 4).

PASSO 3 — AGENDA (compromissos marcados ou recorrentes):
Compromissos/eventos com data/hora específica pra comparecer, OU eventos recorrentes (padrão "todo sábado", "toda semana", "todo dia 5"). O usuário precisa estar presente ou fazer a coisa naquele momento.
Exemplos:
- "Luigi tem dentista sexta 14h" → AGENDA (compromisso já marcado)
- "Reunião de pais na escola terça 18h" → AGENDA (evento marcado; escola é só localização)
- "Aniversário da vovó sábado 15h" → AGENDA
- "Futebol do Luigi sábado 9am" → AGENDA
- "Mercado todo sábado" → AGENDA (evento recorrente)
- "Academia segunda, quarta e sexta 7h" → AGENDA (recorrente)
- "Catequese domingo de manhã" → AGENDA (recorrente)
- "Tenho entrevista de emprego amanhã 9h" → AGENDA

PASSO 4 — LEMBRETES (fallback — TODAS as pendências):
Tudo que NÃO é passado financeiro confirmado (PASSO 1), NÃO é compra feita no passado (PASSO 2), e NÃO é evento marcado com hora/recorrência (PASSO 3). Toda pendência ativa cai aqui.
Inclui:
- Pagamentos a fazer — "pagar dentista sexta", "pagar futebol do Luigi", "pagar escola", "boleto vence dia 20", "mensalidade da academia"
- Compras a fazer — "comprar X" no infinitivo, listas de mercado ("comprar leite e pão no Tesco")
- Itens esgotados / a repor — "acabou os ovos", "não tem mais sal", "falta papel higiênico", "tô sem café"
- Booking a realizar — "marcar consulta do Luigi no GP quinta", "agendar dentista", "ligar pra reservar mesa"
- Tarefas escolares sem horário — "boletim do Luigi chegou", "ajudar Luigi com lição de casa", "entregar trabalho dia 13"
- Tarefas domésticas sem hora — "levar roupa na lavanderia", "consertar torneira"

PRINCÍPIO GERAL: o TEMPO VERBAL define a categoria.
- Pretérito financeiro ("paguei", "gastei") → FINANCAS
- Pretérito de compra ("comprei") → COMPRAS
- Evento com hora marcada OU recorrência → AGENDA
- TUDO MAIS (incluindo "pagar X" e "comprar X" no futuro/infinitivo) → LEMBRETES

Regra mnemônica: passado confirmado vira log (FINANCAS/COMPRAS); futuro pendente vira tarefa (LEMBRETES); evento marcado vira compromisso (AGENDA).

EXTRAÇÃO DE METADADOS IMPORTANTES:
- "recurrence": se a mensagem explicita um padrão de repetição ("todo sábado", "toda semana", "todo dia 5"), capture em linguagem natural. Senão null.
- "shopping_items": se a mensagem implica itens a comprar (compras pendentes OU compras feitas), extraia a lista de itens como array. Ex: "acabou os ovos" → ["ovos"], "comprar leite e pão" → ["leite", "pão"], "comprei sal e açúcar" → ["sal", "açúcar"]. Senão null.
- "needs_review": true quando a mensagem é ambígua ou tem dois verbos fortes em categorias diferentes (ex: "marcar dentista e pagar recepção").

FORMATO DA RESPOSTA (JSON válido, sem texto fora):
{
  "category": "FINANCAS" | "COMPRAS" | "AGENDA" | "LEMBRETES",
  "confidence": "high" | "medium" | "low",
  "needs_review": true | false,
  "clean_text": "texto da mensagem limpo e com pontuação correta",
  "person": "nome da pessoa mencionada ou null",
  "date_text": "texto da data como aparece na mensagem, ou null",
  "time_text": "texto do horário como aparece na mensagem, ou null",
  "recurrence": "padrão de repetição em linguagem natural, ou null",
  "shopping_items": ["item1", "item2"] ou null,
  "action_summary": "resumo curto da ação em 3-7 palavras"
}

Responda APENAS com o JSON, nada mais.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      max_tokens: 300,
      temperature: 0,
      response_format: { type: 'json_object' }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GPT API failed: ${res.status} ${errText}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '{}';

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse GPT JSON:', raw);
    return { category: 'LEMBRETES', metadata: { confidence: 'low', needs_review: true, parse_error: true } };
  }

  const rawCategory = (parsed.category || '').toUpperCase();
  const category = VALID_CATEGORIES.includes(rawCategory) ? rawCategory : 'LEMBRETES';

  const metadata = {
    confidence: parsed.confidence || 'medium',
    needs_review: parsed.needs_review || false,
    clean_text: parsed.clean_text || null,
    person: parsed.person || null,
    date_text: parsed.date_text || null,
    time_text: parsed.time_text || null,
    recurrence: parsed.recurrence || null,
    shopping_items: Array.isArray(parsed.shopping_items) ? parsed.shopping_items : null,
    action_summary: parsed.action_summary || null
  };

  return { category, metadata };
}

// ============================================
// SALVAR NO SUPABASE — inalterado do Phase 2
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
// GENERATE REPLY COM PERSONA (Phase 3) — GPT-4o-mini, temperature alta
// Substitui o template fixo do Phase 2 por reply dinâmico.
// ============================================
async function generateReply(user, context) {
  const persona = user?.persona || 'ceo';
  const memoName = user?.memo_name || 'Memo';
  const basePrompt = PERSONA_PROMPTS[persona] || PERSONA_PROMPTS.ceo;
  const systemPrompt = basePrompt.replace(/\{MEMO_NAME\}/g, memoName);

  let userContent;

  if (context.isWelcome) {
    // Primeira fala após onboarding — boas-vindas no tom da persona
    userContent = `[EVENTO: Onboarding concluído. O usuário acabou de escolher você como persona. Esta é sua primeira fala oficial — dê boas-vindas e diga que está pronto pra receber qualquer coisa (conta, compra, compromisso, recado, lembrete). Máximo 2 frases. Use a persona 100%. NÃO use template — gere algo único.]`;
  } else {
    // Confirmação de captura normal
    const { category, metadata, originalText } = context;
    const summary = metadata?.action_summary || originalText;
    const person = metadata?.person || null;
    const dateText = metadata?.date_text || null;
    const timeText = metadata?.time_text || null;

    userContent = `[EVENTO: O usuário acabou de registrar um item no sistema.

Mensagem original do usuário: "${originalText}"
Categoria atribuída: ${category}
Resumo da ação: ${summary}
Pessoa mencionada: ${person || 'nenhuma'}
Data: ${dateText || 'não especificada'}
Horário: ${timeText || 'não especificado'}

Sua tarefa: confirmar o registro em 1-2 frases NO SEU TOM DE PERSONA.

REGRAS CRÍTICAS:
- NUNCA use template fixo. O usuário vai receber dezenas dessas por semana — repetição mata a magia.
- Varie completamente a estrutura, abertura, ritmo, escolha de palavras.
- Mencione a categoria de forma natural, nunca como label ([${category}]).
- Se a mensagem tiver pessoa/data/hora relevante, incorpore naturalmente.
- Seja surpreendente dentro do seu tom — não previsível.
- Persona acima de tudo.]`;
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      max_tokens: 120,
      temperature: 0.95, // ALTA pra maximizar variação
      presence_penalty: 0.6, // penaliza reuso de palavras
      frequency_penalty: 0.4
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`generateReply GPT failed: ${res.status} ${errText}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('generateReply: empty response');
  return text;
}

// ============================================
// ENVIAR RESPOSTA VIA WHATSAPP — inalterado
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
