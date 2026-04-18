// Memo Health Check — endpoint simples pra verificar status
// GET /api/health → retorna status + métricas das últimas 24h

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xgsioilxmmpmfgndfmar.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Buscar contagens por event_type nas últimas 24h
    const metricsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/metrics?created_at=gte.${since}&select=event_type`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`
        }
      }
    );

    if (!metricsRes.ok) {
      return res.status(200).json({
        status: 'ok',
        note: 'metrics table unavailable',
        timestamp: new Date().toISOString()
      });
    }

    const rows = await metricsRes.json();

    // Contar por tipo
    const counts = {};
    for (const row of rows) {
      counts[row.event_type] = (counts[row.event_type] || 0) + 1;
    }

    // Buscar latência média das últimas 24h
    const processedRes = await fetch(
      `${SUPABASE_URL}/rest/v1/metrics?event_type=eq.message_processed&created_at=gte.${since}&select=details`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`
        }
      }
    );

    let avgLatency = null;
    if (processedRes.ok) {
      const processed = await processedRes.json();
      if (processed.length > 0) {
        const latencies = processed
          .map(r => r.details?.latency_ms)
          .filter(l => typeof l === 'number');
        if (latencies.length > 0) {
          avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
        }
      }
    }

    return res.status(200).json({
      status: 'ok',
      period: 'last_24h',
      metrics: {
        messages_processed: counts.message_processed || 0,
        whisper_failures: counts.whisper_fail || 0,
        whisper_rejected: counts.whisper_rejected || 0,
        reply_failures: counts.reply_fail || 0,
        onboardings: counts.onboarding_complete || 0,
        erasures: counts.erasure || 0,
        avg_latency_ms: avgLatency
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return res.status(200).json({
      status: 'degraded',
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
}
