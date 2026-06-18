/**
 * Vercel Serverless Function: Lead-Proxy zu Zapier
 *
 * - Frontend POSTet hierhin (same-origin → kein CORS, AdBlocker-proof)
 * - Function leitet Lead-Daten an Zapier-Webhook weiter (3× retry mit backoff)
 * - Antwortet IMMER 200 OK damit User durch zur OTO-Page kommt
 * - Failed sends werden in Vercel-Logs sichtbar für Monitoring
 *
 * Deploy-Pfad im Repo: /api/lead.js  (bzw. /linkedin/api/lead.js falls Subfolder-Root)
 */

const ZAPIER_WEBHOOK = 'https://hooks.zapier.com/hooks/catch/25556690/433ypm4/';
const MAX_ATTEMPTS = 3;

export default async function handler(req, res) {
  // CORS (für den Fall dass externe Calls kommen)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // Body parsen (Vercel parst JSON automatisch, aber sendBeacon sendet evtl. als String)
  let payload = req.body;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch (e) { payload = {}; }
  }

  // Server-Side-Metadaten anreichern
  const enriched = {
    ...payload,
    server_received_at: new Date().toISOString(),
    server_user_agent:  req.headers['user-agent'] || '',
    server_ip:          req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '',
    server_referer:     req.headers.referer || ''
  };

  // Zapier mit Retry feuern
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const zapResponse = await fetch(ZAPIER_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(enriched)
      });

      if (zapResponse.ok) {
        console.log('[Lead] Zapier OK (attempt ' + attempt + ')');
        return res.status(200).json({ ok: true, attempt });
      }
      lastError = 'Zapier HTTP ' + zapResponse.status;
    } catch (err) {
      lastError = err.message || String(err);
    }

    // Exponential backoff vor Retry: 500ms, 1000ms
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, attempt * 500));
    }
  }

  // Alle Versuche fehlgeschlagen — Daten in Vercel-Logs persistieren
  // (Du kannst die in Vercel Dashboard → Functions → Logs abrufen)
  console.error('[Lead] Zapier FAILED after ' + MAX_ATTEMPTS + ' attempts');
  console.error('[Lead] Error:', lastError);
  console.error('[Lead] Payload:', JSON.stringify(enriched));

  // ABER: trotzdem 200 zurück, damit User zur OTO-Page kommt
  // (Lead-Daten sind in Vercel-Logs gerettet, müssen manuell nachgezogen werden)
  return res.status(200).json({ ok: false, error: lastError, queued_in_logs: true });
}
