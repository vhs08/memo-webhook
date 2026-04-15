// Memo Assistant — Proactive Engine (Phase 4.6 — Post-event Follow-up)
// Roda via Vercel Cron — gera lembretes, follow-ups, shopping lists, recurring events, post-event
// Arquitetura: composição estruturada + persona via Claude
// Sub-fases ativas: 4.2 reminders, 4.3 follow-up, 4.4 shopping, 4.5 recorrência, 4.6 post-event
// Sub-fases placeholder: 4.7 daily briefing
// Cron schedules (vercel.json):
//   - 0 7 * * * (daily 7h UTC)  → reminders + follow-ups + shopping saturday reminder + recurring matches
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
      { type: 'shopping_list_date_reminder', entity: 'arroz, frango', output: 'Mercado dessa semana — qual o dia?' },
      { type: 'reminder_recurring', entity: 'ir à academia hoje às 07:00', output: 'Academia hoje às 7h. Sai antes.' },
      { type: 'reminder_recurring', entity: 'ir à academia sexta às 07:00', output: 'Academia sexta às 7h. Deixa a mochila pronta na quinta.' },
      { type: 'reminder_recurring', entity: 'pagar council tax hoje', output: 'Council tax hoje. Resolve de manhã.' },
      { type: 'reminder_recurring', entity: 'mercado hoje às 09:00', output: 'Mercado hoje às 9h. Leva a lista.' },
      { type: 'reminder_recurring', entity: 'futebol do Luigi amanhã às 09:00', output: 'Futebol do Luigi amanhã 9h. Chuteira pronta hoje.' },
      { type: 'post_event', entity: 'Dentista do Luigi', output: 'E aí, como foi a dentista do Luigi?' },
      { type: 'post_event', entity: 'Reunião de pais', output: 'Reunião de pais — foi tudo certo?' },
      { type: 'post_event', entity: 'Consulta no GP', output: 'Consulta no GP, resolveu o que precisava?' },
      { type: 'post_event_nudge', entity: 'Dentista do Luigi', output: 'Dentista do Luigi ainda em aberto aqui — foi tudo certo?' },
      { type: 'post_event_nudge', entity: 'Reunião de pais', output: 'Reunião de pais — fecha pra mim, foi tudo ok?' }
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
      { type: 'shopping_list_date_reminder', entity: 'arroz, frango', output: 'Lista esperando — qual o dia do mercado?' },
      { type: 'reminder_recurring', entity: 'ir à academia hoje às 07:00', output: 'Academia hoje 7h. Primeira da semana, já vale.' },
      { type: 'reminder_recurring', entity: 'ir à academia sexta às 07:00', output: 'Academia sexta 7h. Mochila arrumada na quinta à noite é vitória.' },
      { type: 'reminder_recurring', entity: 'pagar council tax hoje', output: 'Council tax hoje. Resolve cedo, que à tarde aparece imprevisto.' },
      { type: 'reminder_recurring', entity: 'mercado hoje às 09:00', output: 'Mercado hoje 9h. Lista na mão e bora.' },
      { type: 'reminder_recurring', entity: 'futebol do Luigi amanhã às 09:00', output: 'Futebol do Luigi amanhã 9h. Chuteira limpa vira ritual da noite.' },
      { type: 'post_event', entity: 'Dentista do Luigi', output: 'E aí, como foi a dentista do Luigi?' },
      { type: 'post_event', entity: 'Reunião de pais', output: 'Reunião de pais — tudo tranquilo?' },
      { type: 'post_event', entity: 'Consulta no GP', output: 'E a consulta no GP, saiu o que precisava?' },
      { type: 'post_event_nudge', entity: 'Dentista do Luigi', output: 'Só pra fechar a lista — dentista do Luigi ficou ok?' },
      { type: 'post_event_nudge', entity: 'Reunião de pais', output: 'Reunião de pais ainda em aberto aqui — foi tudo certo?' }
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

  // ---- 4.6 — POST-EVENT FOLLOW-UP ----
  // AGENDA one-time que já passou → pergunta "como foi?" na manhã seguinte
  // Até 2 tentativas (gap 48h). Depois auto-fecha silenciosamente.
  if (user.followup_enabled !== false && remaining > 0 && !user.pending_followup_id) {
    const eligible = await getPastEventsForPostEvent(phone, ukNow);
    console.log(`[Cron] ${phone}: ${eligible.length} past events eligible for post-event`);

    if (eligible.length > 0) {
      const { event, nudge } = eligible[0]; // mais antigo primeiro
      const entity = buildPostEventEntity(event);
      const type = nudge === 1 ? 'post_event' : 'post_event_nudge';

      const message = await generateProactiveMessage(user, { type, entity });
      if (message) {
        await sendWhatsAppMessage(phone, message);
        await logProactive(phone, 'post_event', event.id, message);
        await updateUserField(phone, 'pending_followup_id', event.id);
        remaining--;
        sent++;
        console.log(`[Cron] ${phone}: sent post-event (nudge ${nudge}) — "${message}"`);
      }
    }

    // Give-up: eventos com 2+ nudges e sem resposta → auto-done silencioso
    await cleanupStaleEvents(phone, ukNow);
  }

  // ---- 4.5 — RECORRÊNCIA (recurring events reminders) ----
  // Todos os dias checa: hoje bate com algum recurrence_rule do user?
  if (user.reminders_enabled !== false && remaining > 0) {
    const recurringToday = await getRecurringItemsForToday(phone, ukNow);
    console.log(`[Cron] ${phone}: ${recurringToday.length} recurring items matching today`);

    for (const item of recurringToday) {
      if (remaining <= 0) break;
      // Dedup: usa (message_id + data de hoje) como reference pra proactive_log
      const todayKey = ukNow.toISOString().slice(0, 10); // YYYY-MM-DD
      const refId = `${item.id}::${todayKey}`;
      const alreadySent = await wasProactiveSent(phone, 'reminder', refId);
      if (alreadySent) continue;

      const entity = buildRecurringEntity(item, ukNow);
      const message = await generateProactiveMessage(user, {
        type: 'reminder_recurring',
        entity: entity
      });

      if (message) {
        await sendWhatsAppMessage(phone, message);
        await logProactive(phone, 'reminder', refId, message);
        remaining--;
        sent++;
        console.log(`[Cron] ${phone}: sent recurring reminder — "${message}"`);
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

  // Prompt prefix específico por tipo — evita que Claude confunda post_event com reminder
  const PROMPT_PREFIXES = {
    followup: 'Gere follow-up perguntando se o usuário resolveu:',
    post_event: 'Gere pergunta pós-evento. O compromisso JÁ ACONTECEU no passado — pergunte como foi, em tom empático:',
    post_event_nudge: 'Gere segunda cobrança pós-evento (usuário não respondeu ainda). Tom de assistente atento querendo fechar o ciclo, sem impor:',
    shopping_list_send: 'Gere mensagem consolidando lista de compras da semana e perguntando quando o usuário vai ao mercado:',
    shopping_list_date_reminder: 'Gere lembrete sobre lista da semana ainda em aberto, perguntando o dia da compra de novo:',
    reminder_recurring: 'Gere lembrete proativo para compromisso recorrente (o label de dia "hoje"/"amanhã"/"sexta" já está na entity, use-o):',
    reminder_today: 'Gere lembrete proativo para hoje:',
    reminder_tomorrow: 'Gere lembrete proativo para amanhã:'
  };
  const promptPrefix = PROMPT_PREFIXES[context.type] || 'Gere lembrete proativo para:';

  // Few-shot: exemplos do mesmo tipo de mensagem proativa (usando o prefix correspondente pra dar contexto)
  const messages = [];
  const relevantExamples = personaConfig.examples.filter(ex => ex.type === context.type);
  for (const ex of relevantExamples) {
    messages.push({ role: 'user', content: `${promptPrefix} ${ex.entity}` });
    messages.push({ role: 'assistant', content: ex.output });
  }

  // Mensagem real
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
// RECURRENCE HELPERS (Phase 4.5) — duplicado do webhook.js
// ============================================

// Retorna true se o recurrence_rule bate com o dia atual (UK time)
function recurrenceMatchesToday(rule, ukNow) {
  if (!rule || !rule.freq) return false;

  if (rule.freq === 'DAILY') return true;

  if (rule.freq === 'WEEKLY') {
    if (!Array.isArray(rule.by_day)) return false;
    return rule.by_day.includes(ukNow.getDay());
  }

  if (rule.freq === 'MONTHLY') {
    return rule.by_month_day === ukNow.getDate();
  }

  return false;
}

// Busca todos os items do user com recurrence_rule não-null
async function getRecurringItems(phoneNumber) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/messages?phone_number=eq.${encodeURIComponent(phoneNumber)}&metadata->recurrence_rule=not.is.null&select=id,original_text,category,metadata&order=created_at.desc`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      }
    }
  );

  if (!res.ok) {
    console.error('[Cron] getRecurringItems failed:', res.status, await res.text());
    return [];
  }

  return await res.json();
}

// Filtra recurring items que batem com hoje
async function getRecurringItemsForToday(phoneNumber, ukNow) {
  const all = await getRecurringItems(phoneNumber);
  return all.filter(item => {
    const rule = item?.metadata?.recurrence_rule;
    return recurrenceMatchesToday(rule, ukNow);
  });
}

// Calcula a PRÓXIMA ocorrência de um recurrence_rule (cópia de webhook.js)
function nextOccurrence(rule, from = new Date()) {
  if (!rule || !rule.freq) return null;
  const [hh, mm] = (rule.time || '09:00').split(':').map(Number);

  const toUkDate = (d) => {
    const ukString = d.toLocaleString('en-GB', { timeZone: 'Europe/London' });
    const [datePart, timePart] = ukString.split(', ');
    const [day, month, year] = datePart.split('/').map(Number);
    const [h, m, s] = timePart.split(':').map(Number);
    return new Date(year, month - 1, day, h, m, s);
  };

  const ukFrom = toUkDate(from);

  if (rule.freq === 'DAILY') {
    const next = new Date(ukFrom);
    next.setHours(hh, mm, 0, 0);
    if (next <= ukFrom) next.setDate(next.getDate() + 1);
    return next;
  }

  if (rule.freq === 'WEEKLY') {
    const today = ukFrom.getDay();
    let minDays = Infinity;
    for (const target of rule.by_day) {
      let diff = (target - today + 7) % 7;
      if (diff === 0) {
        const sameDayTarget = new Date(ukFrom);
        sameDayTarget.setHours(hh, mm, 0, 0);
        if (sameDayTarget <= ukFrom) diff = 7;
      }
      if (diff < minDays) minDays = diff;
    }
    const next = new Date(ukFrom);
    next.setDate(next.getDate() + minDays);
    next.setHours(hh, mm, 0, 0);
    return next;
  }

  if (rule.freq === 'MONTHLY') {
    const day = rule.by_month_day;
    const next = new Date(ukFrom);
    next.setDate(day);
    next.setHours(hh, mm, 0, 0);
    if (next <= ukFrom) {
      next.setMonth(next.getMonth() + 1);
      next.setDate(day);
      next.setHours(hh, mm, 0, 0);
    }
    return next;
  }

  return null;
}

// Computa label de dia ("hoje", "amanhã", "sexta") baseado na próxima ocorrência
function computeDayLabel(nextDate, ukNow) {
  if (!nextDate) return '';
  const startToday = new Date(ukNow);
  startToday.setHours(0, 0, 0, 0);
  const startNext = new Date(nextDate);
  startNext.setHours(0, 0, 0, 0);
  const diffDays = Math.round((startNext - startToday) / (24 * 60 * 60 * 1000));

  if (diffDays <= 0) return 'hoje';
  if (diffDays === 1) return 'amanhã';
  const weekdays = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  return weekdays[nextDate.getDay()];
}

// ============================================
// 4.6 — POST-EVENT FOLLOW-UP HELPERS
// ============================================

// Query: AGENDA one-time (sem recurrence_rule) com due_at passado (últimos 7 dias)
// e task_status ainda pending
async function getPastAgendaEvents(phoneNumber, ukNow) {
  const sevenDaysAgo = new Date(ukNow.getTime() - 7 * 24 * 60 * 60 * 1000);

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/messages?phone_number=eq.${encodeURIComponent(phoneNumber)}&category=eq.AGENDA&task_status=eq.pending&due_at=lt.${ukNow.toISOString()}&due_at=gte.${sevenDaysAgo.toISOString()}&select=id,original_text,category,metadata,due_at&order=due_at.asc`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      }
    }
  );

  if (!res.ok) {
    console.error('[Cron] getPastAgendaEvents failed:', res.status, await res.text());
    return [];
  }

  const rows = await res.json();
  // Filtra os que têm recurrence_rule (recorrentes são tratados pelo 4.5)
  return rows.filter(r => !r?.metadata?.recurrence_rule);
}

// Query: conta quantos post_event logs existem pra um evento
async function countPostEventAttempts(phoneNumber, eventId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/proactive_log?phone_number=eq.${encodeURIComponent(phoneNumber)}&message_type=eq.post_event&reference_message_id=eq.${encodeURIComponent(eventId)}&select=sent_at&order=sent_at.desc`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      }
    }
  );
  if (!res.ok) return { count: 0, lastSent: null };
  const rows = await res.json();
  return {
    count: rows.length,
    lastSent: rows?.[0]?.sent_at || null
  };
}

// Retorna eventos elegíveis pra post-event follow-up
// Cada entry: { event, nudge: 1 | 2 }
async function getPastEventsForPostEvent(phoneNumber, ukNow) {
  const pastEvents = await getPastAgendaEvents(phoneNumber, ukNow);
  const eligible = [];

  for (const event of pastEvents) {
    const { count, lastSent } = await countPostEventAttempts(phoneNumber, event.id);

    if (count === 0) {
      // Nunca foi cobrado ainda → 1ª tentativa
      eligible.push({ event, nudge: 1 });
    } else if (count === 1) {
      // Já cobrou 1x. Só tenta de novo se já passou 48h
      const hoursSince = lastSent ? (ukNow - new Date(lastSent)) / (1000 * 60 * 60) : 999;
      if (hoursSince >= 48) {
        eligible.push({ event, nudge: 2 });
      }
    }
    // count >= 2: desiste (tratado em cleanupStaleEvents)
  }

  return eligible;
}

// Limpa eventos que tiveram 2+ nudges e ainda sem resposta (> 48h desde o último)
// Auto-marca task_status=done e limpa pending_followup_id se apontar pra eles
async function cleanupStaleEvents(phoneNumber, ukNow) {
  const pastEvents = await getPastAgendaEvents(phoneNumber, ukNow);

  for (const event of pastEvents) {
    const { count, lastSent } = await countPostEventAttempts(phoneNumber, event.id);
    if (count < 2) continue;

    const hoursSince = lastSent ? (ukNow - new Date(lastSent)) / (1000 * 60 * 60) : 0;
    if (hoursSince < 48) continue; // Ainda dentro da janela do 2º nudge

    // Give up: marca done silenciosamente
    console.log(`[Cron] ${phoneNumber}: giving up on event ${event.id} (2 nudges, ${Math.round(hoursSince)}h since last)`);
    try {
      await fetch(
        `${SUPABASE_URL}/rest/v1/messages?id=eq.${encodeURIComponent(event.id)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            Prefer: 'return=minimal'
          },
          body: JSON.stringify({ task_status: 'done' })
        }
      );
    } catch (err) {
      console.error('[Cron] cleanupStaleEvents patch failed:', err);
    }
  }

  // Se o user tem pending_followup_id apontando pra um desses eventos stale, limpa
  const userRes = await fetch(
    `${SUPABASE_URL}/rest/v1/users?phone_number=eq.${encodeURIComponent(phoneNumber)}&select=pending_followup_id`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      }
    }
  );
  if (!userRes.ok) return;
  const users = await userRes.json();
  const pendingId = users?.[0]?.pending_followup_id;
  if (!pendingId) return;

  // Se o pending_followup_id aponta pra um dos stale events que acabamos de marcar como done
  const stillStale = pastEvents.find(e => e.id === pendingId);
  if (stillStale) {
    const { count } = await countPostEventAttempts(phoneNumber, pendingId);
    if (count >= 2) {
      await updateUserField(phoneNumber, 'pending_followup_id', null);
      console.log(`[Cron] ${phoneNumber}: cleared stale pending_followup_id ${pendingId}`);
    }
  }
}

// Monta entity pra prompt de post-event
function buildPostEventEntity(event) {
  return event?.metadata?.action_summary || event?.metadata?.clean_text || event?.original_text || 'Seu compromisso';
}

// Monta entity pra prompt de reminder de recorrente (com label de dia correto)
function buildRecurringEntity(item, ukNow) {
  const summary = item?.metadata?.action_summary || item?.metadata?.clean_text || item?.original_text || 'Compromisso recorrente';
  const rule = item?.metadata?.recurrence_rule;
  const time = rule?.time;

  const next = nextOccurrence(rule, ukNow);
  const dayLabel = computeDayLabel(next, ukNow);

  const dayPart = dayLabel ? ` ${dayLabel}` : '';
  const timePart = time ? ` às ${time}` : '';
  return `${summary}${dayPart}${timePart}`;
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
