// Memo Assistant — WhatsApp Webhook Handler (Phase 3 — Personas v6)
// Vercel Serverless Function - api/webhook.js (ES Module)
// Fluxo: recebe mensagem → (onboarding se user novo) → (áudio vira texto via Whisper)
//         → categoriza com GPT-4o-mini → grava no Supabase → gera reply com persona
// Categorias (5): FINANCAS, COMPRAS, AGENDA, IDEIAS, LEMBRETES
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

// Categorias válidas
const VALID_CATEGORIES = ['AGENDA', 'COMPRAS', 'LEMBRETES', 'FINANCAS', 'IDEIAS'];

// Emojis de fallback
const CATEGORY_EMOJI = {
  AGENDA: '📅',
  COMPRAS: '🛒',
  LEMBRETES: '📝',
  FINANCAS: '💰',
  IDEIAS: '💡'
};

// ============================================
// PERSONA PROMPTS — v6 (Refatorado com Planner/Renderer)
// ============================================
const PERSONA_PROMPTS = {
  alfred: `Você é {MEMO_NAME}, assistente pessoal no WhatsApp. Sua voz é de classe, precisão e discrição. Você é uma presença confiável, não um cartório ou secretária formal. Evite clichês de atendimento. Seu foco é a ordem e a elegância econômica.`, 
  mae: `Você é {MEMO_NAME}, assistente pessoal no WhatsApp. Sua voz é de calor natural e proximidade íntima, como uma mãe real de WhatsApp. Seja prática, acolhedora e humana, sem pieguice ou comentários sobrando. Seu foco é o cuidado e a rotina humana.`, 
  coach: `Você é {MEMO_NAME}, assistente pessoal no WhatsApp. Sua voz é de energia curta, impulso e ação. Você é um executor vivo, não um guru ou palestrante. Evite clichês motivacionais. Seu foco é o movimento e a direção, sugerindo ação apenas quando o contexto realmente merece.`, 
  ceo: `Você é {MEMO_NAME}, assistente pessoal no WhatsApp. Sua voz é de enquadramento rápido, controle e clareza executiva. Seja humano sem floreios, e evite linguagem de status de sistema ou carimbos. Seu foco é a prioridade e o controle claro.`
};

// ============================================
// PERSONA WELCOME MESSAGES (Onboarding estático)
// ============================================
const PERSONA_WELCOME = {
  alfred: 'Bem-vindo. {MEMO_NAME} à disposição para organizar seus registros.',
  mae: 'Oi, querido(a)! {MEMO_NAME} por aqui para te ajudar com tudo.',
  coach: 'Pronto para agir? {MEMO_NAME} está aqui para impulsionar seus registros.',
  ceo: 'Foco e clareza. {MEMO_NAME} otimiza seus registros.'
};

// ============================================
// REPLY PLANNER (Etapa 1: Decisão Lógica)
// ============================================
async function planReply(context, user) {
  const { category, originalText, metadata } = context;
  const persona = user?.persona || 'ceo';

  const plannerSystemPrompt = `Você é um planejador de respostas para um assistente de WhatsApp. Sua tarefa é analisar a mensagem do usuário e o contexto, e decidir a intenção da resposta, se pode sugerir um próximo passo, o número de frases, nível de calor, formalidade e estilo de abertura.

CATEGORIAS DE INTENÇÃO DE RESPOSTA (escolha EXATAMENTE UMA):
- routine_capture: Registro de algo banal, rotineiro, sem grande impacto ou necessidade de ação imediata (ex: "comprei pão", "vi o filme").
- shopping_shortage: Item que precisa ser comprado ou reposto (ex: "acabou a ração", "preciso de leite").
- scheduled_event: Compromisso ou evento com data/hora específica ou recorrência (ex: "futebol sábado", "dentista terça").
- completed_log: Registro de uma ação já concluída, financeira ou de compra (ex: "paguei a conta", "comprei o presente").
- strategic_idea: Ideia de negócio, plano futuro, insight estratégico (ex: "app para landlords", "investir em ações").
- personal_reflection: Reflexão pessoal, meta sem ação imediata, pensamento (ex: "dedicar mais tempo à leitura", "mudar de cidade").
- sensitive_family_note: Assunto familiar delicado ou que exige discrição (ex: "Luigi sem TV", "problema na escola").

REGRAS PARA PRÓXIMO PASSO:
Um próximo passo SÓ pode ser sugerido se a intenção for 'strategic_idea' OU 'personal_reflection' E a persona permitir (Coach e CEO tendem a permitir mais).

REGRAS PARA NÚMERO DE FRASES:
- Default: 1 frase.
- Pode usar 2 frases se a intenção for 'strategic_idea', 'personal_reflection' ou 'sensitive_family_note' E a persona permitir (Mãe e Coach podem usar 2 frases com mais facilidade em contextos específicos).

NÍVEL DE CALOR (warmth_level): low, medium, high
NÍVEL DE FORMALIDADE (formality_level): low, medium, high
ESTILO DE ABERTURA (opening_style): direct, acknowledging, empathetic

Responda APENAS com um JSON válido com as chaves: reply_intent, can_suggest_next_step, phrase_count, warmth_level, formality_level, opening_style.`;

  const plannerUserContent = `Mensagem original: "${originalText}"
Categoria atribuída: ${category}
Persona selecionada: ${persona}

Com base nisso, gere o JSON com as decisões de planejamento.`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: plannerSystemPrompt },
          { role: 'user', content: plannerUserContent }
        ],
        max_tokens: 200,
        temperature: 0,
        response_format: { type: 'json_object' }
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`Planner GPT API failed: ${res.status} ${errText}`);
      return {
        reply_intent: 'routine_capture',
        can_suggest_next_step: false,
        phrase_count: 1,
        warmth_level: 'low',
        formality_level: 'medium',
        opening_style: 'direct'
      };
    }

    const data = await res.json();
    const rawPlan = data.choices?.[0]?.message?.content || '{}';
    let planning_decisions;
    try {
      planning_decisions = JSON.parse(rawPlan);
    } catch (err) {
      console.error('Failed to parse Planner GPT JSON:', rawPlan, err);
      planning_decisions = {
        reply_intent: 'routine_capture',
        can_suggest_next_step: false,
        phrase_count: 1,
        warmth_level: 'low',
        formality_level: 'medium',
        opening_style: 'direct'
      };
    }

    // Apply programmatic rules for next step and phrase count based on persona and intent
    if (planning_decisions.reply_intent === 'strategic_idea' || planning_decisions.reply_intent === 'personal_reflection') {
      if (persona === 'coach' || persona === 'ceo') {
        planning_decisions.can_suggest_next_step = true;
        planning_decisions.phrase_count = 2;
      } else {
        planning_decisions.can_suggest_next_step = false;
        planning_decisions.phrase_count = 1;
      }
    } else {
      planning_decisions.can_suggest_next_step = false;
      planning_decisions.phrase_count = 1;
    }

    // Adjust warmth, formality, opening style based on persona
    switch (persona) {
      case 'alfred':
        planning_decisions.warmth_level = 'low';
        planning_decisions.formality_level = 'high';
        planning_decisions.opening_style = 'acknowledging';
        break;
      case 'mae':
        planning_decisions.warmth_level = 'high';
        planning_decisions.formality_level = 'low';
        planning_decisions.opening_style = 'empathetic';
        break;
      case 'coach':
        planning_decisions.warmth_level = 'medium';
        planning_decisions.formality_level = 'medium';
        planning_decisions.opening_style = 'direct';
        break;
      case 'ceo':
        planning_decisions.warmth_level = 'low';
        planning_decisions.formality_level = 'high';
        planning_decisions.opening_style = 'direct';
        break;
    }

    return planning_decisions;
  } catch (error) {
    console.error('planReply error:', error);
    return {
      reply_intent: 'routine_capture',
      can_suggest_next_step: false,
      phrase_count: 1,
      warmth_level: 'low',
      formality_level: 'medium',
      opening_style: 'direct'
    };
  }
}

// ============================================
// PERSONA RENDERER (Etapa 2: Geração da Resposta)
// ============================================
async function generateReply(user, context, planning_decisions) {
  const persona = user?.persona || 'ceo';
  const memoName = user?.memo_name || 'Memo';
  const basePrompt = PERSONA_PROMPTS[persona] || PERSONA_PROMPTS.ceo;
  const systemPrompt = basePrompt.replace(/\{MEMO_NAME\}/g, memoName);

  const { originalText, recentReplies } = context;
  const { reply_intent, can_suggest_next_step, phrase_count, warmth_level, formality_level, opening_style } = planning_decisions;

  let antiRepBlock = '';
  if (recentReplies && recentReplies.length > 0) {
    antiRepBlock = `

ANTI-REPETIÇÃO: Seus últimos ${recentReplies.length} replies foram:
${recentReplies.map((r, i) => `${i + 1}. "${r}"`).join('\n')}

Evite repetir:
- Abertura, verbo principal, cadência, fechamento ou shape da frase.
- Não basta trocar uma palavra, a estrutura deve ser diferente.`;
  }

  const userContent = `O usuário acabou de registrar algo no Memo.

Contexto da mensagem original: "${originalText}"

Instruções de Geração:
- Persona: ${persona} ({MEMO_NAME})
- Intenção da Resposta: ${reply_intent}
- Pode Sugerir Próximo Passo: ${can_suggest_next_step ? 'Sim' : 'Não'}
- Número de Frases: ${phrase_count}
- Nível de Calor: ${warmth_level}
- Nível de Formalidade: ${formality_level}
- Estilo de Abertura: ${opening_style}

Regras Globais:
- Máximo de ${phrase_count} frase(s).
- Não explique o óbvio, não fale como sistema, não use labels de categoria.
- Não comente se não agrega, não aconselhe fora do contexto permitido.
- Não use tom de atendimento ou onboarding genérico.
- A persona deve aparecer no enquadramento e na cadência, não no excesso de palavras.
${antiRepBlock}

Sua resposta:`;

  try {
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
        max_tokens: 100,
        temperature: 0.8,
        presence_penalty: 0.8,
        frequency_penalty: 0.6
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
  } catch (error) {
    console.error('generateReply error:', error);
    throw error;
  }
}

// ============================================
// USERS TABLE HELPERS (Supabase)
// ============================================
async function fetchUser(phoneNumber) {
  try {
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
  } catch (error) {
    console.error('fetchUser error:', error);
    return null;
  }
}

async function createUser(phoneNumber) {
  try {
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
  } catch (error) {
    console.error('createUser error:', error);
    throw error;
  }
}

async function updateUser(phoneNumber, fields) {
  try {
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
  } catch (error) {
    console.error('updateUser error:', error);
    throw error;
  }
}

// ============================================
// BOT REPLY HISTORY (anti-repetição)
// ============================================
async function saveBotReply(phoneNumber, replyText) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/bot_replies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        phone_number: phoneNumber,
        reply_text: replyText
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`saveBotReply failed: ${res.status} ${errText}`);
    }
  } catch (error) {
    console.error('saveBotReply error:', error);
  }
}

async function fetchRecentBotReplies(phoneNumber, limit = 3) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/bot_replies?phone_number=eq.${encodeURIComponent(phoneNumber)}&select=reply_text&order=created_at.desc&limit=${limit}`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`
        }
      }
    );
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`fetchRecentBotReplies failed: ${res.status} ${errText}`);
    }
    const rows = await res.json();
    return rows.map(r => r.reply_text).reverse();
  } catch (error) {
    console.error('fetchRecentBotReplies error:', error);
    return [];
  }
}

// ============================================
// TRANSCRIÇÃO DE ÁUDIO (Whisper)
// ============================================
async function transcribeAudio(mediaId) {
  try {
    const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
    });
    if (!metaRes.ok) throw new Error(`Meta media fetch failed: ${metaRes.status}`);
    const metaData = await metaRes.json();
    const mediaUrl = metaData.url;
    if (!mediaUrl) throw new Error('No media URL returned by Meta');

    const audioRes = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
    });
    if (!audioRes.ok) throw new Error(`Audio download failed: ${audioRes.status}`);
    const audioBuffer = await audioRes.arrayBuffer();

    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer], { type: 'audio/ogg' }), 'audio.ogg');
    formData.append('model', 'whisper-1');
    formData.append('language', 'pt');
    formData.append(
      'prompt',
      'Nomes: Luigi, Antonella, Victor, Suelen. Memo assistente. Termos: Tesco, mercado, escola, dentista, consulta, farmácia, GP, boleto, mensalidade, pilates, academia, futebol.'
    );

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
  } catch (error) {
    console.error('transcribeAudio error:', error);
    throw error;
  }
}

// ============================================
// CATEGORIZAÇÃO (GPT-4o-mini JSON)
// ============================================
async function categorize(text) {
  const systemPrompt = `Você é o cérebro de categorização do Memo, um assistente de WhatsApp pra pais brasileiros/UK gerenciarem a vida doméstica.

Sua tarefa: ler a mensagem do usuário e devolver um JSON estruturado com a categoria + metadados úteis.

CATEGORIAS VÁLIDAS (escolha EXATAMENTE UMA das 5):
- FINANCAS: movimento financeiro JÁ CONFIRMADO (verbo no passado: "paguei", "gastei", "transferi", "recebi")
- COMPRAS: registro de compra JÁ REALIZADA (verbo no passado: "comprei", "já comprei", "adquiri")
- AGENDA: compromissos/eventos com data/hora específica OU com recorrência, pra comparecer
- IDEIAS: pensamentos, ideias de negócio, reflexões, planos futuros vagos, insights — NÃO são tarefas com ação imediata
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
- "Luigi tem dentista sexta 14h" → AGENDA
- "Reunião de pais na escola terça 18h" → AGENDA
- "Aniversário da vovó sábado 15h" → AGENDA
- "Futebol do Luigi sábado 9am" → AGENDA
- "Mercado todo sábado" → AGENDA
- "Academia segunda, quarta e sexta 7h" → AGENDA
- "Catequese domingo de manhã" → AGENDA
- "Tenho entrevista de emprego amanhã 9h" → AGENDA

PASSO 4 — IDEIAS (pensamentos, ideias, reflexões, planos vagos):
Quando o usuário está PENSANDO, não FAZENDO. Registros de ideias de negócio, reflexões pessoais, planos futuros sem data nem ação concreta, insights, brainstorms.
Exemplos:
- "Tive uma ideia de negócio: um app pra landlords" → IDEIAS
- "Pensei em criar um curso de culinária" → IDEIAS
- "E se a gente mudasse pro interior?" → IDEIAS
- "Acho que seria bom investir em ações" → IDEIAS
- "Quero começar a gravar vídeos pro YouTube" → IDEIAS
- "Tive um insight sobre a escola do Luigi" → IDEIAS
IMPORTANTE: Se a mensagem tem AÇÃO CONCRETA + DATA → é AGENDA ou LEMBRETES, não IDEIAS.

PASSO 5 — LEMBRETES (fallback — TODAS as pendências):
Tudo que NÃO é passado financeiro confirmado, NÃO é compra feita no passado, e NÃO é evento marcado com hora/recorrência.
Inclui:
- Pagamentos a fazer
- Compras a fazer
- Itens esgotados / a repor
- Booking a realizar
- Tarefas escolares sem horário
- Tarefas domésticas sem hora

PRINCÍPIO GERAL:
- Pretérito financeiro → FINANCAS
- Pretérito de compra → COMPRAS
- Evento com hora marcada OU recorrência → AGENDA
- Pensamento/reflexão/ideia sem ação concreta → IDEIAS
- TUDO MAIS → LEMBRETES

EXTRAÇÃO DE METADADOS IMPORTANTES:
- "recurrence": se a mensagem explicita um padrão de repetição, capture em linguagem natural. Senão null.
- "shopping_items": se a mensagem implica itens a comprar (pendentes OU compras feitas), extraia como array. Senão null.
- "needs_review": true quando a mensagem é ambígua ou tem dois verbos fortes em categorias diferentes.

FORMATO DA RESPOSTA:
{
  "category": "FINANCAS" | "COMPRAS" | "AGENDA" | "IDEIAS" | "LEMBRETES",
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

  try {
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
  } catch (error) {
    console.error('categorize error:', error);
    return { category: 'LEMBRETES', metadata: { confidence: 'low', needs_review: true, error: true } };
  }
}

// ============================================
// SALVAR NO SUPABASE
// ============================================
async function saveToSupabase(data) {
  try {
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
  } catch (error) {
    console.error('saveToSupabase error:', error);
  }
}

// ============================================
// ENVIAR RESPOSTA VIA WHATSAPP
// ============================================
async function sendWhatsAppReply(to, text) {
  try {
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
          to,
          text: { body: text }
        })
      }
    );
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`WhatsApp send failed: ${res.status} ${errText}`);
    }
  } catch (error) {
    console.error('sendWhatsAppReply error:', error);
    throw error;
  }
}

// ============================================
// WEBHOOK HANDLER PRINCIPAL (ES Module Export)
// ============================================
export default async (req, res) => {
  // Verificação do webhook (GET request)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook verified');
      return res.status(200).send(challenge);
    } else {
      console.log('Webhook verification failed');
      return res.status(403).send('Forbidden');
    }
  }

  // Processamento de mensagens (POST request)
  if (req.method === 'POST') {
    const body = req.body;

    try {
      // Verifica se é uma notificação de mensagem do WhatsApp
      if (body.object === 'whatsapp_business_account') {
        for (const entry of body.entry) {
          for (const change of entry.changes) {
            if (change.field === 'messages') {
              for (const message of change.value.messages) {
                if (message.type === 'text' || message.type === 'audio') {
                  const phoneNumber = message.from;
                  let originalText = '';

                  // Transcrição de áudio se necessário
                  if (message.type === 'audio') {
                    try {
                      originalText = await transcribeAudio(message.audio.id);
                      console.log(`Transcribed audio: ${originalText}`);
                    } catch (error) {
                      console.error('Erro na transcrição de áudio:', error);
                      await sendWhatsAppReply(phoneNumber, 'Desculpe, não consegui transcrever seu áudio. Poderia digitar, por favor?');
                      continue;
                    }
                  } else if (message.type === 'text') {
                    originalText = message.text.body;
                  }

                  // Fetch user or create if new
                  let user = await fetchUser(phoneNumber);
                  if (!user) {
                    try {
                      await createUser(phoneNumber);
                      user = await fetchUser(phoneNumber);
                      
                      // Send static welcome message
                      const welcomeMessage = PERSONA_WELCOME[user?.persona || 'ceo'].replace('{MEMO_NAME}', user?.memo_name || 'Memo');
                      await sendWhatsAppReply(phoneNumber, welcomeMessage);
                      await saveBotReply(phoneNumber, welcomeMessage);
                      continue; // Skip further processing for onboarding
                    } catch (error) {
                      console.error('Error creating new user:', error);
                      await sendWhatsAppReply(phoneNumber, 'Desculpe, ocorreu um erro ao configurar sua conta. Tente novamente.');
                      continue;
                    }
                  }

                  // Categorize the message
                  const { category, metadata } = await categorize(originalText);
                  console.log(`Categorized as: ${category}`);

                  // Save to Supabase
                  await saveToSupabase({
                    phone_number: phoneNumber,
                    original_text: originalText,
                    category: category,
                    metadata: metadata,
                    persona: user.persona
                  });

                  // Fetch recent replies for anti-repetition
                  const recentReplies = await fetchRecentBotReplies(phoneNumber);

                  // Etapa 1 - Planejamento da Resposta
                  const planning_decisions = await planReply({ category, originalText, metadata }, user);
                  console.log(`Planning decisions:`, planning_decisions);

                  // Etapa 2 - Renderização da Resposta pela Persona
                  const replyText = await generateReply(user, { category, originalText, metadata, recentReplies }, planning_decisions);
                  console.log(`Generated reply: ${replyText}`);

                  // Send reply via WhatsApp
                  await sendWhatsAppReply(phoneNumber, replyText);
                  await saveBotReply(phoneNumber, replyText);
                }
              }
            }
          }
        }
      }

      res.status(200).json({ status: 'ok' });
    } catch (error) {
      console.error('Webhook error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  // Método não suportado
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
  }
};
