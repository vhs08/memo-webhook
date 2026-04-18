// Memo Test Suite — roda via GET /api/test
// Testa funções puras sem dependência de APIs externas

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const results = [];
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      results.push({ name, status: 'PASS' });
      passed++;
    } catch (err) {
      results.push({ name, status: 'FAIL', error: err.message });
      failed++;
    }
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
  }

  function assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(message || `Expected "${expected}" but got "${actual}"`);
    }
  }

  // ============================================
  // isTranscriptionReliable — cópia da função do webhook.js
  // ============================================
  function isTranscriptionReliable(text) {
    if (!text || text.trim().length === 0) return false;
    const trimmed = text.trim();
    if (trimmed.length < 3) return false;
    if (/^[\s\d\W]+$/.test(trimmed)) return false;

    const hallucinationPatterns = [
      /^(obrigad[oa]|tchau|ok|oi|sim|não|olá|hey|hello|bye|thanks|thank you)[.!]?$/i,
      /^\.+$/,
      /^(.)\1{4,}$/,
      /legendas?\s*(por|pela)\s*/i,
      /inscreva-se/i,
      /subscribe/i,
      /amara\.org/i,
      /www\./i,
      /música\s*$/i,
    ];

    for (const pattern of hallucinationPatterns) {
      if (pattern.test(trimmed)) return false;
    }

    const words = trimmed.toLowerCase().split(/\s+/);
    if (words.length >= 4) {
      const uniqueWords = new Set(words);
      const uniqueRatio = uniqueWords.size / words.length;
      if (uniqueRatio < 0.3) return false;
    }

    const alphaChars = trimmed.replace(/[^a-záàâãéèêíïóôõúüçñ]/gi, '').length;
    if (trimmed.length > 5 && alphaChars / trimmed.length < 0.4) return false;

    return true;
  }

  // ============================================
  // TESTES: isTranscriptionReliable
  // ============================================
  test('Transcrição válida: frase normal', () => {
    assert(isTranscriptionReliable('Dentista da Antonella amanhã às 15h'), 'Deveria ser confiável');
  });

  test('Transcrição válida: frase curta', () => {
    assert(isTranscriptionReliable('Comprar leite'), 'Deveria ser confiável');
  });

  test('Transcrição válida: placement da Antonella', () => {
    assert(isTranscriptionReliable('Placement da Antonella aceito e reunião dia 30 de abril às 16h'), 'Deveria ser confiável');
  });

  test('Transcrição rejeitada: vazio', () => {
    assert(!isTranscriptionReliable(''), 'Deveria rejeitar vazio');
  });

  test('Transcrição rejeitada: null', () => {
    assert(!isTranscriptionReliable(null), 'Deveria rejeitar null');
  });

  test('Transcrição rejeitada: muito curto', () => {
    assert(!isTranscriptionReliable('ok'), 'Deveria rejeitar texto muito curto');
  });

  test('Transcrição rejeitada: só pontuação', () => {
    assert(!isTranscriptionReliable('...'), 'Deveria rejeitar só pontuação');
  });

  test('Transcrição rejeitada: caracteres repetidos', () => {
    assert(!isTranscriptionReliable('aaaaaa'), 'Deveria rejeitar repetição');
  });

  test('Transcrição rejeitada: hallucination "Legendas por"', () => {
    assert(!isTranscriptionReliable('Legendas pela comunidade'), 'Deveria rejeitar hallucination');
  });

  test('Transcrição rejeitada: hallucination "Inscreva-se"', () => {
    assert(!isTranscriptionReliable('Inscreva-se no canal'), 'Deveria rejeitar hallucination');
  });

  test('Transcrição rejeitada: hallucination "Música"', () => {
    assert(!isTranscriptionReliable('Música'), 'Deveria rejeitar silêncio como música');
  });

  test('Transcrição rejeitada: word loop', () => {
    assert(!isTranscriptionReliable('sim sim sim sim sim sim'), 'Deveria rejeitar loop de palavras');
  });

  test('Transcrição rejeitada: só números e símbolos', () => {
    assert(!isTranscriptionReliable('123 456 !@#'), 'Deveria rejeitar não-texto');
  });

  test('Transcrição rejeitada: URL inventada', () => {
    assert(!isTranscriptionReliable('Visite www.exemplo.com'), 'Deveria rejeitar URL');
  });

  // ============================================
  // TESTES: Erasure patterns
  // ============================================
  const erasurePatterns = /\b(apague? meus dados|exclua? meus dados|delete my data|quero sair|remove meus dados|apagar minha conta|deletar minha conta|excluir minha conta)\b/i;

  test('Erasure: "apague meus dados" detectado', () => {
    assert(erasurePatterns.test('apague meus dados'), 'Deveria detectar');
  });

  test('Erasure: "delete my data" detectado', () => {
    assert(erasurePatterns.test('delete my data'), 'Deveria detectar');
  });

  test('Erasure: "quero sair" detectado', () => {
    assert(erasurePatterns.test('quero sair'), 'Deveria detectar');
  });

  test('Erasure: "apagar minha conta" detectado', () => {
    assert(erasurePatterns.test('apagar minha conta'), 'Deveria detectar');
  });

  test('Erasure: mensagem normal não detectada', () => {
    assert(!erasurePatterns.test('comprar dados móveis'), 'Não deveria detectar');
  });

  test('Erasure: "apague a luz" não detectado', () => {
    assert(!erasurePatterns.test('apague a luz'), 'Não deveria detectar');
  });

  // ============================================
  // TESTES: Consent patterns
  // ============================================
  const acceptPatterns = ['sim', 'aceito', 'aceitar', 'ok', 'yes', 'concordo', 'acordo', 'pode', 'bora', 's', '1', 'claro', 'com certeza'];

  function isConsent(text) {
    const response = (text || '').trim().toLowerCase();
    return acceptPatterns.some(p => response.includes(p));
  }

  test('Consent: "sim" aceito', () => {
    assert(isConsent('sim'), 'Deveria aceitar');
  });

  test('Consent: "aceito" aceito', () => {
    assert(isConsent('aceito'), 'Deveria aceitar');
  });

  test('Consent: "bora" aceito', () => {
    assert(isConsent('bora'), 'Deveria aceitar');
  });

  test('Consent: "Sim, concordo" aceito', () => {
    assert(isConsent('Sim, concordo'), 'Deveria aceitar');
  });

  test('Consent: "não" rejeitado', () => {
    assert(!isConsent('não'), 'Não deveria aceitar');
  });

  test('Consent: "talvez" rejeitado', () => {
    assert(!isConsent('talvez'), 'Não deveria aceitar');
  });

  // ============================================
  // TESTES: Followup response classification (regex only)
  // ============================================
  const donePatterns = /\b(sim|fiz|feito|já|pronto|pago|paguei|resolvi|resolvido|entreguei|mandei|liguei|agendei|comprei|troquei|cancelei|marquei|fui|tratei|dei entrada)\b/i;
  const snoozePatterns = /(?:^|\s|\b)(ainda não|não ainda|depois|amanhã|semana que vem|mais tarde|próxima semana|não deu|não consegui)(?=\s|$|[.,!?])/i;
  const postEventGoodPatterns = /\b(foi bem|foi bom|foi ótimo|foi boa|tudo bem|tudo certo|tudo ok|correu bem|deu certo|tranquilo|de boa|suave|beleza|foi tudo bem)\b/i;

  test('Followup: "já fiz" = done', () => {
    assert(donePatterns.test('já fiz'), 'Deveria ser done');
  });

  test('Followup: "paguei ontem" = done', () => {
    assert(donePatterns.test('paguei ontem'), 'Deveria ser done');
  });

  test('Followup: "dei entrada na renovação" = done', () => {
    assert(donePatterns.test('dei entrada na renovação'), 'Deveria ser done');
  });

  test('Followup: "ainda não" = snooze', () => {
    assert(snoozePatterns.test('ainda não'), 'Deveria ser snooze');
  });

  test('Followup: "amanhã resolvo" = snooze', () => {
    assert(snoozePatterns.test('amanhã resolvo'), 'Deveria ser snooze');
  });

  test('Followup: "foi tudo bem" = post-event good', () => {
    assert(postEventGoodPatterns.test('foi tudo bem'), 'Deveria ser post-event good');
  });

  test('Followup: "correu bem" = post-event good', () => {
    assert(postEventGoodPatterns.test('correu bem'), 'Deveria ser post-event good');
  });

  test('Followup: "tudo certo com a consulta" = post-event good', () => {
    assert(postEventGoodPatterns.test('tudo certo com a consulta'), 'Deveria ser post-event good');
  });

  // ============================================
  // TESTES: Rate Limiter
  // ============================================
  function createRateLimiter(maxRequests, windowMs) {
    const map = new Map();
    return {
      isLimited(phone) {
        const now = Date.now();
        const timestamps = map.get(phone) || [];
        const recent = timestamps.filter(t => now - t < windowMs);
        if (recent.length >= maxRequests) {
          map.set(phone, recent);
          return true;
        }
        recent.push(now);
        map.set(phone, recent);
        return false;
      },
      reset() { map.clear(); }
    };
  }

  const limiter = createRateLimiter(3, 1000); // 3 por segundo pra teste rápido

  test('Rate limit: primeiras 3 mensagens passam', () => {
    limiter.reset();
    assert(!limiter.isLimited('test1'), '1a deveria passar');
    assert(!limiter.isLimited('test1'), '2a deveria passar');
    assert(!limiter.isLimited('test1'), '3a deveria passar');
  });

  test('Rate limit: 4a mensagem bloqueada', () => {
    assert(limiter.isLimited('test1'), '4a deveria ser bloqueada');
  });

  test('Rate limit: outro número não é afetado', () => {
    assert(!limiter.isLimited('test2'), 'Outro número deveria passar');
  });

  // ============================================
  // RESULTADO — HTML formatado
  // ============================================
  const total = passed + failed;
  const statusText = failed === 0 ? '✅ ALL PASS' : `❌ ${failed} FAILURE${failed > 1 ? 'S' : ''}`;
  const statusColor = failed === 0 ? '#22c55e' : '#ef4444';

  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Memo Tests</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:#111; color:#eee; padding:24px; }
  h1 { font-size:24px; margin-bottom:8px; }
  .summary { font-size:18px; margin-bottom:24px; padding:16px; border-radius:8px; background:#1a1a1a; border-left:4px solid ${statusColor}; }
  .summary .status { color:${statusColor}; font-weight:700; }
  .section { margin-bottom:20px; }
  .section-title { font-size:16px; font-weight:600; color:#888; margin-bottom:8px; padding-bottom:4px; border-bottom:1px solid #333; }
  .test { padding:6px 12px; margin:2px 0; border-radius:4px; font-size:14px; font-family:monospace; }
  .pass { background:#0a2e0a; color:#4ade80; }
  .fail { background:#2e0a0a; color:#f87171; }
  .fail .error { color:#fca5a5; font-size:12px; margin-left:8px; }
  .time { color:#666; font-size:13px; margin-top:12px; }
</style></head><body>
<h1>Memo Test Suite</h1>
<div class="summary">
  <span class="status">${statusText}</span> — ${passed}/${total} passed
</div>`;

  let currentSection = '';
  for (const r of results) {
    const section = r.name.split(':')[0].trim();
    if (section !== currentSection) {
      if (currentSection) html += '</div>';
      currentSection = section;
      html += `<div class="section"><div class="section-title">${section}</div>`;
    }
    if (r.status === 'PASS') {
      html += `<div class="test pass">✓ ${r.name}</div>`;
    } else {
      html += `<div class="test fail">✗ ${r.name}<span class="error">${r.error}</span></div>`;
    }
  }
  html += '</div>';
  html += `<div class="time">Ran at ${new Date().toISOString()}</div>`;
  html += '</body></html>';

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(html);
}
