// Memo Assistant — Proactive Engine (Phase 4.4 — Shopping List)
// Roda via Vercel Cron — gera lembretes, follow-ups, shopping lists
// Arquitetura: composição estruturada + persona via Claude
// Sub-fases ativas: 4.2 pre-event reminders, 4.3 follow-up de pendências, 4.4 shopping list semanal
// Sub-fases placeholder: 4.5 recorrência, 4.6 post-event, 4.7 daily briefing
// Cron schedules (vercel.json):
//   - 0 7 * * * (daily 7h UTC)  → reminders + follow-ups + shopping saturday reminder
//   - 0 17 * * 5 (friday 17h UTC = 18h BST) → shopping list send

// ============================================
// ENVIRONMENT VARIABLES
// ============================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const CRON_SECRET = process.env.CRON_SECRET;

// ============================================
// 4.0 — PROACTIVITY RULES
// "Quando o Memo tem permissão pra interromper?"
// ============================================
const PROACTIVE_RULES = {
  // Orçamento de atenção: máximo de mensagens proativas por dia por usuário
  maxPerDay: 3,

  // Janela de consolidação: entre 6h-10h (UK), preferir 1 briefing a N pings
  consolidationWindow: { startHour: 6, endHour: 10 },

  // Só interrompe se cai em pelo menos 1 desses 3 buckets:
  // A) Protege contra erro ou custo (multa, atraso, perda de compromisso)
  // B) Fecha loop aberto (pendência com prazo, algo prometido)
  // C) Consolida valor (briefing, lista semanal)

  // Se duas mensagens podem virar uma, vira uma.
  // Pre-event reminders e follow-up: ON por padrão
  // Daily briefing: opt-in
};

// ============================================
// PROACTIVE PERSONA PROMPTS (versão enxuta pra mensagens proativas)
// Composição estruturada: cron monta o payload, Claude veste na persona
// ============================================
const PROACTIVE_PERSONA = {
  ceo: {
    system: `Você é {MEMO_NAME}, assistente pessoal no WhatsApp. Tom: executivo prático — direto, conciso, orientado a resultado.
Você está enviando uma mensagem PROATIVA (não é resposta a input do usuário).
Gere UMA frase curta (8-20 palavras) no tom da persona.
A mensagem deve parecer lembrete útil, não notificação de app.
Proibido: "bora", "vamos pra cima", "foco", motivacional, exclamação tripla, emoji.
Proibido: "lembrete:", "aviso:", prefixo de categoria.
Use "pra/pro", tom WhatsApp informal de executivo.`,
    examples: [
      { type: 'reminder_today', entity: 'Dentista do Luigi às 14h', output: 'Dentista do Luigi hoje às 14h. Sai com antecedência.' },
      { type: 'reminder_today', entity: 'Reunião de pais 18h', output: 'Reunião de pais hoje às 18h. Chega antes que enche.' },
      { type: 'reminder_tomorrow', entity: 'Consulta no GP 9h30', output: 'Consulta no GP amanhã 9h30. NHS não espera.' },
      { type: 'reminder_tomorrow', entity: 'Pagar council tax', output: 'Council tax vence amanhã. Resolve hoje.' },
      { type: 'reminder_today', entity: 'Seguro do carro vence hoje', output: 'Seguro do carro vence hoje. Não deixa passar.' },
      { type: 'reminder_tomorrow', entity: 'Apresentação do Luigi na escola 14h', output: 'Apresentação do Luigi amanhã às 14h. Roupa pronta na noite anterior.' },
      { type: 'followup', entity: 'Pagar TV licence', output: 'TV licence — já resolveu?' },
      { type: 'followup', entity: 'Comprar ração do Rocky', output: 'Ração do Rocky. Comprou ou o gato tá passando fome?' },
      { type: 'followup', entity: 'Marcar consulta no GP', output: 'Consulta no GP. Conseguiu marcar?' },
      { type: 'followup', entity: 'Renovar parking permit', output: 'Parking permit. Já renovou?' },
      { type: 'followup', entity: 'Pagar mensalidade do futebol do Luigi', output: 'Mensalidade do futebol do Luigi. Já pagou?' },
      { type: 'shopping_list_send', entity: 'leite, ovos, café, papel higiênico', output: 'Lista da semana: leite, ovos, café, papel higiênico. Quando vai fazer a compra?' },
      { type: 'shopping_list_send', entity: 'arroz, frango, detergente', output: 'Lista pendente: arroz, frango, detergente. Qual o dia do mercado?' },
      { type: 'shopping_list_date_reminder', entity: 'leite, ovos, café', output: 'Lista da semana ainda aberta. Qual o dia do mercado?' },
      { type: 'shopping_list_date_reminder', entity: 'arroz, frango', output: 'Mercado dessa semana — qual o dia?' }
    ]
  },
  tiolegal: {
    system: `Você é {MEMO_NAME}, assistente pessoal no WhatsApp. Tom: Tio Legal — leve, espirituoso, humor de observação.
Você está enviando uma mensagem PROATIVA (não é resposta a input do usuário).
Gere UMA frase curta (8-20 palavras) no tom da persona. Humor leve se o contexto permitir, mas a utilidade vem primeiro.
A mensagem deve parecer lembrete de alguém da casa, não notificação de app.
Proibido: piada forçada, trocadilho, meme, stand-up, emoji excessivo, exclamação tripla.
Proibido: "lembrete:", "aviso:", prefixo de categoria.
Use "pra/pro", tom WhatsApp informal de tio.`,
    examples: [
      { type: 'reminder_today', entity: 'Dentista do Luigi às 14h', output: 'Dentista do Luigi hoje às 14h. Criança no dentista nunca é de última hora.' },
      { type: 'reminder_today', entity: 'Reunião de pais 18h', output: 'Reunião de pais hoje às 18h. Chegar atrasado é clássico, mas evita.' },
      { type: 'reminder_tomorrow', entity: 'Consulta no GP 9h30', output: 'Consulta no GP amanhã 9h30. Marcou no NHS, não perde.' },
      { type: 'reminder_tomorrow', entity: 'Pagar council tax', output: 'Council tax vence amanhã. Burocracia cobra multa bonita.' },
      { type: 'reminder_today', entity: 'Seguro do carro vence hoje', output: 'Seguro do carro vence hoje. Dirigir sem seguro no UK é aventura cara.' },
      { type: 'reminder_tomorrow', entity: 'Apresentação do Luigi na escola 14h', output: 'Apresentação do Luigi amanhã às 14h. Roupa arrumada na noite anterior salva a manhã.' },
      { type: 'followup', entity: 'Pagar TV licence', output: 'E a TV licence, pagou? Burocracia cobra multa bonita.' },
      { type: 'followup', entity: 'Comprar ração do Rocky', output: 'Ração do Rocky — comprou ou o bicho tá organizando protesto?' },
      { type: 'followup', entity: 'Marcar consulta no GP', output: 'Consulta no GP, marcou? NHS com vaga livre é ouro.' },
      { type: 'followup', entity: 'Renovar parking permit', output: 'Parking permit, renovou? Fiscal de rua não perdoa.' },
      { type: 'followup', entity: 'Pagar mensalidade do futebol do Luigi', output: 'Futebol do Luigi, pagou a mensalidade? Craque precisa de campo.' },
      { type: 'shopping_list_send', entity: 'leite, ovos, café, papel higiênico', output: 'Lista da semana tá aqui: leite, ovos, café, papel higiênico. Qual o dia do mercado?' },
      { type: 'shopping_list_send', entity: 'arroz, frango, detergente', output: 'Lista pro mercado: arroz, frango, detergente. Qual dia vai?' },
      { type: 'shopping_list_date_reminder', entity: 'leite, ovos, café', output: 'E a lista da semana, qual o dia do mercado?' },
      { type: 'shopping_list_date_reminder', entity: 'arroz, frango', output: 'Lista esperando — qual o dia do mercado?' }
    ]
  }
};

// Fallback pra personas que não têm prompt proativo (alfred, mae — inativos)
const DEFAULT_PROACTIVE_PERSONA = PROACTIVE_PERSONA.ceo;

// ============================================
// MAIN HANDLER — Vercel Cron chama aqui
// ============================================
export default async function handler(req, res) {
  // Segurança: verificar que é o Vercel Cron chamando
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    console.error('[Cron] Unauthorized request');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // UK timezone: BST (UTC+1) mar-out, GMT (UTC+0) nov-fev
    const now = new Date();
    const ukNow = getUKTime(now);
    console.log(`[Cron] Running at ${now.toISOString()} (UK: ${ukNow.toISOString()})`);

    // Buscar todos os usuários com onboarding completo
    const users = await fetchAllActiveUsers();
    console.log(`[Cron] ${users.length} active users`);

    let totalSent = 0;
    for (const user of users) {
      const sent = await processUser(user, now, ukNow);
      totalSent += sent;
    }

    console.log(`[Cron] Done. ${totalSent} proactive messages sent.`);
    return res.status(200).json({ ok: true, users: users.length, sent: totalSent });
  } catch (err) {
    console.error('[Cron] Fatal error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ============================================
// PROCESS USER — decide o que mandar pra cada usuário
// ============================================
async function processUser(user, now, ukNow) {
  const phone = user.phone_number;
  const persona = user.persona || 'ceo';
  let sent = 0;

  // Checar orçamento do dia
  const sentToday = await countProactiveSentToday(phone, now);
  let remaining = PROACTIVE_RULES.maxPerDay - sentToday;

  if (remaining <= 0) {
    console.log(`[Cron] ${phone}: budget exhausted (${sentToday}/${PROACTIVE_RULES.maxPerDay})`);
    return 0;
  }

  // ---- 4.2 — PRE-EVENT REMINDERS ----
  if (user.reminders_enabled !== false && remaining > 0) {
    const reminders = await getUpcomingEvents(phone, now);
    console.log(`[Cron] ${phone}: ${reminders.length} upcoming events`);

    for (const event of reminders) {
      if (remaining <= 0) break;

      // Verificar se já mandou reminder pra esse evento
      const alreadySent = await wasProactiveSent(phone, 'reminder', event.id);
      if (alreadySent) continue;

      // Determinar se é hoje ou amanhã
      const eventDate = new Date(event.due_at);
      const isToday = isSameDay(eventDate, ukNow);
      const isTomorrow = isSameDay(eventDate, addDays(ukNow, 1));

      if (!isToday && !isTomorrow) continue;

      const timeLabel = isToday ? 'hoje' : 'amanhã';
      const entity = buildEventEntity(event, timeLabel);

      // Gerar mensagem com persona via Claude
      const message = await generateProactiveMessage(user, {
        type: isToday ? 'reminder_today' : 'reminder_tomorrow',
        entity: entity
      });

      if (message) {
        await sendWhatsAppMessage(phone, message);
        await logProactive(phone, 'reminder', event.id, message);
        remaining--;
        sent++;
        console.log(`[Cron] ${phone}: sent reminder — "${message}"`);
      }
    }
  }

  // ---- 4.3 — FOLLOW-UP DE PENDÊNCIAS ----
  if (user.followup_enabled !== false && remaining > 0 && !user.pending_followup_id) {
    const overdue = await getOverdueTasks(phone, now);
    console.log(`[Cron] ${phone}: ${overdue.length} overdue tasks`);

    // Manda follow-up pro item mais antigo (1 por dia, pra não sobrecarregar)
    if (overdue.length > 0) {
      const task = overdue[0];

      // Verificar se já mandou follow-up pra essa task
      const alreadySent = await wasProactiveSent(phone, 'followup', task.id);
      if (!alreadySent) {
        const entity = buildFollowupEntity(task);

        const message = await generateProactiveMessage(user, {
          type: 'followup',
          entity: entity
        });

        if (message) {
          await sendWhatsAppMessage(phone, message);
          await logProactive(phone, 'followup', task.id, message);
          // Marcar no user que estamos esperando resposta pra esse follow-up
          await updateUserField(phone, 'pending_followup_id', task.id);
          remaining--;
          sent++;
          console.log(`[Cron] ${phone}: sent followup — "${message}"`);
        }
      }
    }
  }

  // ---- 4.4 — SHOPPING LIST SEMANAL ----
  // Envio: sexta 17-19h UTC (sexta noite UK).
  // Fallback: sábado 7-10h UTC, se user não respondeu a data.
  if (user.shopping_list_enabled !== false && remaining > 0) {
    if (isFridayEvening(ukNow) && !user.pending_shopping_list_date) {
      // Sexta à noite: manda lista nova
      const shoppingSent = await processShoppingList(user, ukNow);
      if (shoppingSent) {
        remaining--;
        sent++;
      }
    } else if (isSaturdayMorning(ukNow) && user.pending_shopping_list_date) {
      // Sábado manhã: user não respondeu data da lista de ontem
      const reminderSent = await remindShoppingListDate(user, ukNow);
      if (reminderSent) {
        remaining--;
        sent++;
      }
    }
  }

  // ---- 4.7 — DAILY BRIEFING (placeholder) ----
  // TODO: Phase 4.7 — consolidar agenda + pendências do dia em 1 mensagem

  return sent;
}

// ============================================
// QUERY: UPCOMING EVENTS (4.2)
// Busca AGENDA e LEMBRETES com due_at hoje ou amanhã
// ============================================
async function getUpcomingEvents(phoneNumber, now) {
  // Calcular range: de agora até fim de amanhã (UK time)
  const ukNow = getUKTime(now);
  const todayStart = new Date(ukNow);
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowEnd = new Date(todayStart);
  tomorrowEnd.setDate(tomorrowEnd.getDate() + 2); // end of tomorrow = start of day after

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/messages?phone_number=eq.${encodeURIComponent(phoneNumber)}&due_at=gte.${todayStart.toISOString()}&due_at=lt.${tomorrowEnd.toISOString()}&task_status=eq.pending&select=id,original_text,category,metadata,due_at&order=due_at.asc`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      }
    }
  );

  if (!res.ok) {
    console.error('[Cron] getUpcomingEvents failed:', res.status, await res.text());
    return [];
  }

  return await res.json();
}

// ============================================
// QUERY: OVERDUE TASKS (4.3)
// Busca LEMBRETES com task_status='pending' e due_at já passou
// ============================================
async function getOverdueTasks(phoneNumber, now) {
  const ukNow = getUKTime(now);

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/messages?phone_number=eq.${encodeURIComponent(phoneNumber)}&category=eq.LEMBRETES&task_status=eq.pending&due_at=lt.${ukNow.toISOString()}&due_at=not.is.null&select=id,original_text,category,metadata,due_at&order=due_at.asc&limit=5`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      }
    }
  );

  if (!res.ok) {
    console.error('[Cron] getOverdueTasks failed:', res.status, await res.text());
    return [];
  }

  return await res.json();
}

// ============================================
// BUILD FOLLOWUP ENTITY — monta descrição da pendência pra prompt
// ============================================
function buildFollowupEntity(task) {
  const meta = task.metadata || {};
  return meta.action_summary || task.original_text;
}

// ============================================
// UPDATE USER FIELD (helper genérico)
// ============================================
async function updateUserField(phoneNumber, field, value) {
  const body = {};
  body[field] = value;

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
      body: JSON.stringify(body)
    }
  );

  if (!res.ok) {
    console.error(`[Cron] updateUserField(${field}) failed:`, res.status, await res.text());
  }
}

// ============================================
// GENERATE PROACTIVE MESSAGE (composição estruturada + Claude)
// ============================================
async function generateProactiveMessage(user, context) {
  const persona = user.persona || 'ceo';
  const memoName = user.memo_name || 'Memo';
  const personaConfig = PROACTIVE_PERSONA[persona] || DEFAULT_PROACTIVE_PERSONA;

  const systemPrompt = personaConfig.system.replace(/\{MEMO_NAME\}/g, memoName);

  // Few-shot: exemplos do mesmo tipo de mensagem proativa
  const messages = [];
  const relevantExamples = personaConfig.examples.filter(ex => ex.type === context.type);
  for (const ex of relevantExamples) {
    messages.push({ role: 'user', content: `Gere lembrete proativo para: ${ex.entity}` });
    messages.push({ role: 'assistant', content: ex.output });
  }

  // Mensagem real
  const promptPrefix = context.type === 'followup'
    ? 'Gere follow-up perguntando se o usuário resolveu:'
    : 'Gere lembrete proativo para:';
  messages.push({ role: 'user', content: `${promptPrefix} ${context.entity}` });

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        system: systemPrompt,
        messages,
        max_tokens: 80,
        temperature: 0.7
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[Cron] Claude failed:', res.status, errText);
      return null;
    }

    const data = await res.json();
    let text = data.content?.[0]?.text?.trim();
    if (!text) return null;

    // Garante ponto final
    if (!text.endsWith('.') && !text.endsWith('!') && !text.endsWith('?')) {
      text += '.';
    }

    return text;
  } catch (err) {
    console.error('[Cron] generateProactiveMessage error:', err);
    return null;
  }
}

// ============================================
// BUILD EVENT ENTITY — monta descrição do evento pra prompt
// ============================================
function buildEventEntity(event, timeLabel) {
  const meta = event.metadata || {};
  const summary = meta.action_summary || event.original_text;
  const time = meta.time_text || '';

  if (time) {
    return `${summary} ${timeLabel} às ${time}`;
  }
  return `${summary} ${timeLabel}`;
}

// ============================================
// PROACTIVE LOG — registrar e consultar mensagens enviadas
// ============================================
async function logProactive(phoneNumber, messageType, referenceMessageId, messageText) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/proactive_log`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({
      phone_number: phoneNumber,
      message_type: messageType,
      reference_message_id: referenceMessageId,
      message_text: messageText
    })
  });

  if (!res.ok) {
    console.error('[Cron] logProactive failed:', res.status, await res.text());
  }
}

async function countProactiveSentToday(phoneNumber, now) {
  const ukNow = getUKTime(now);
  const todayStart = new Date(ukNow);
  todayStart.setHours(0, 0, 0, 0);

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/proactive_log?phone_number=eq.${encodeURIComponent(phoneNumber)}&sent_at=gte.${todayStart.toISOString()}&select=id`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: 'count=exact'
      }
    }
  );

  if (!res.ok) return 0;
  const count = parseInt(res.headers.get('content-range')?.split('/')[1] || '0', 10);
  return count;
}

async function wasProactiveSent(phoneNumber, messageType, referenceMessageId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/proactive_log?phone_number=eq.${encodeURIComponent(phoneNumber)}&message_type=eq.${messageType}&reference_message_id=eq.${referenceMessageId}&select=id&limit=1`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      }
    }
  );

  if (!res.ok) return false;
  const rows = await res.json();
  return rows.length > 0;
}

// ============================================
// FETCH ALL ACTIVE USERS
// ============================================
async function fetchAllActiveUsers() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/users?onboarding_state=eq.done&select=*`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      }
    }
  );

  if (!res.ok) {
    console.error('[Cron] fetchAllActiveUsers failed:', res.status, await res.text());
    return [];
  }

  return await res.json();
}

// ============================================
// SEND WHATSAPP MESSAGE (proativo — Memo inicia conversa)
// ============================================
async function sendWhatsAppMessage(to, text) {
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

// ============================================
// TIMEZONE HELPERS
// ============================================
function getUKTime(date) {
  // UK: GMT (UTC+0) nov-mar, BST (UTC+1) mar-out
  // Usa Intl pra calcular offset correto
  const ukString = date.toLocaleString('en-GB', { timeZone: 'Europe/London' });
  // Parse: "DD/MM/YYYY, HH:MM:SS"
  const [datePart, timePart] = ukString.split(', ');
  const [day, month, year] = datePart.split('/').map(Number);
  const [hours, minutes, seconds] = timePart.split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes, seconds);
}

function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// ============================================
// TIMING HELPERS — SHOPPING LIST (4.4)
// ============================================
// Sexta à noite UK (17h-20h UK time) — janela pra enviar a lista semanal
function isFridayEvening(ukNow) {
  return ukNow.getDay() === 5 && ukNow.getHours() >= 17 && ukNow.getHours() <= 20;
}

// Sábado de manhã UK (7h-10h UK time) — janela pra cobrar data da lista
function isSaturdayMorning(ukNow) {
  return ukNow.getDay() === 6 && ukNow.getHours() >= 7 && ukNow.getHours() <= 10;
}

// ============================================
// 4.4 — SHOPPING LIST: processShoppingList
// Busca shopping_items pendentes, dedupe, manda lista + pergunta data
// ============================================
async function processShoppingList(user, ukNow) {
  const phone = user.phone_number;

  // Buscar items pendentes
  const items = await getPendingShoppingItems(phone);
  if (items.length === 0) {
    console.log(`[Cron] ${phone}: no pending shopping items, skipping list`);
    return false;
  }

  const entity = items.join(', ');
  console.log(`[Cron] ${phone}: shopping list items — ${entity}`);

  // Gerar mensagem com persona
  const message = await generateProactiveMessage(user, {
    type: 'shopping_list_send',
    entity: entity
  });

  if (!message) return false;

  await sendWhatsAppMessage(phone, message);
  await logProactive(phone, 'shopping_list', null, message);
  // Seta flag pra webhook interceptar próxima mensagem como resposta de data
  await updateUserField(phone, 'pending_shopping_list_date', true);
  console.log(`[Cron] ${phone}: sent shopping list — "${message}"`);
  return true;
}

// ============================================
// 4.4 — SHOPPING LIST: remindShoppingListDate
// Fallback de sábado: user não respondeu a data, relembra
// ============================================
async function remindShoppingListDate(user, ukNow) {
  const phone = user.phone_number;

  // Buscar items pra incluir no lembrete (mesma query)
  const items = await getPendingShoppingItems(phone);
  const entity = items.slice(0, 4).join(', '); // Mostra só os primeiros 4 no lembrete

  const message = await generateProactiveMessage(user, {
    type: 'shopping_list_date_reminder',
    entity: entity || 'itens pendentes'
  });

  if (!message) return false;

  await sendWhatsAppMessage(phone, message);
  await logProactive(phone, 'shopping_list', null, message);
  console.log(`[Cron] ${phone}: sent shopping list date reminder — "${message}"`);
  return true;
}

// ============================================
// QUERY: PENDING SHOPPING ITEMS (4.4)
// Busca messages com metadata.shopping_items preenchido e task_status=pending
// Dedupe case-insensitive
// ============================================
async function getPendingShoppingItems(phoneNumber) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/messages?phone_number=eq.${encodeURIComponent(phoneNumber)}&task_status=eq.pending&metadata->shopping_items=not.is.null&select=id,metadata&order=created_at.asc`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      }
    }
  );

  if (!res.ok) {
    console.error('[Cron] getPendingShoppingItems failed:', res.status, await res.text());
    return [];
  }

  const rows = await res.json();
  const seen = new Set();
  const items = [];

  for (const row of rows) {
    const rawItems = row?.metadata?.shopping_items;
    if (!Array.isArray(rawItems)) continue;
    // Ignora mensagens que são a PRÓPRIA lista consolidada (evita loop)
    if (row?.metadata?.shopping_list === true) continue;
    for (const item of rawItems) {
      if (typeof item !== 'string') continue;
      const key = item.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      items.push(item.trim());
    }
  }

  return items;
}
