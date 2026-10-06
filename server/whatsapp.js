// Sends WhatsApp messages through the Sms4Crm gateway (settings in .env).
// The gateway answers HTTP 200 for everything; the outcome is in the JSON body:
//   { "success": false, "errNo": 1013, "result": "Recipient (000) length is less than accepted", "errDesc": "Wrong Recipient Number" }
//
// Reaching the gateway from inside the same network: a server often can't reach its own public
// address (no "hairpin NAT"). Point WHATSAPP_API_URL at the internal address and set
// WHATSAPP_TLS_SERVERNAME to the public host name: the certificate is then still checked
// against that name, and it's sent as the Host header so IIS picks the right site.

const http = require('http');
const https = require('https');

const TIMEOUT_MS = 30_000;
const CHECK_TIMEOUT_MS = 10_000;

function config() {
  return {
    url: process.env.WHATSAPP_API_URL,
    appKey: process.env.WHATSAPP_APP_KEY,
    template: process.env.WHATSAPP_TEMPLATE_NAME,
    countryCode: String(process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || '').replace(/\D/g, ''),
    servername: process.env.WHATSAPP_TLS_SERVERNAME || '',
  };
}

function isWhatsAppConfigured() {
  const { url, appKey, template } = config();
  return Boolean(url && appKey && template);
}

/**
 * Turns what people type in a spreadsheet into the international digits the gateway expects:
 *   "+967 775 555 054", "00967775555054", "0775555054", "775555054"  ->  "967775555054"
 * Returns null when the result isn't a plausible phone number (8 to 15 digits).
 */
function normalizePhone(raw, countryCode = config().countryCode) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const international = value.startsWith('+') || value.startsWith('00');
  let digits = value.replace(/\D/g, '');
  if (international) {
    digits = digits.replace(/^00/, '');
  } else if (countryCode && !digits.startsWith(countryCode)) {
    // A local number: drop the trunk "0" and add the default country code.
    digits = countryCode + digits.replace(/^0+/, '');
  }
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

// POSTs JSON to the gateway; resolves { status, body } or rejects with a network/TLS error.
function postJson(payload, timeoutMs) {
  const { url, servername } = config();
  const target = new URL(url);
  const data = Buffer.from(JSON.stringify(payload));
  const isHttps = target.protocol === 'https:';
  const options = {
    method: 'POST',
    hostname: target.hostname,
    port: target.port || (isHttps ? 443 : 80),
    path: target.pathname + target.search,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length,
      ...(servername ? { Host: target.port ? `${servername}:${target.port}` : servername } : {}),
    },
    ...(isHttps && servername ? { servername } : {}),
    timeout: timeoutMs,
  };
  return new Promise((resolve, reject) => {
    const req = (isHttps ? https : http).request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let body = null;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('The WhatsApp gateway did not answer in time.'), { code: 'TIMEOUT' })));
    req.on('error', reject);
    req.end(data);
  });
}

// Gateway error numbers -> a reason the client translates. Anything else is kept as WA_FAILED,
// with the gateway's own words as the detail.
function reasonFor(body) {
  const text = `${body?.result || ''} ${body?.errDesc || ''}`.toLowerCase();
  if (body?.errNo === 1013 || /recipient|number/.test(text)) return 'WA_BAD_NUMBER';
  if (body?.errNo === 1005 || /appkey|tenant/.test(text)) return 'WA_CONFIG';
  if (/limit|quota|too many|exceed/.test(text)) return 'RATE_LIMIT';
  return 'WA_FAILED';
}

// Network/TLS failures in words an admin can act on; the code is kept for searching.
function describeNetworkError(err) {
  const code = err.code || err.cause?.code || '';
  const hints = {
    TIMEOUT: 'no answer (blocked by a firewall, or the server cannot reach this address)',
    ETIMEDOUT: 'connection timed out (firewall, or the server cannot reach its own public address)',
    ECONNREFUSED: 'connection refused (nothing listening on that address/port)',
    ENOTFOUND: 'host name not found (DNS)',
    EAI_AGAIN: 'DNS lookup failed',
    ECONNRESET: 'connection reset',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'SSL certificate chain not trusted on this server',
    SELF_SIGNED_CERT_IN_CHAIN: 'self-signed SSL certificate in chain',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'self-signed SSL certificate',
    CERT_HAS_EXPIRED: 'SSL certificate expired',
    ERR_TLS_CERT_ALTNAME_INVALID: 'SSL certificate is for a different host name (set WHATSAPP_TLS_SERVERNAME)',
  };
  return `${code || 'ERROR'}: ${hints[code] || err.message}`;
}

async function sendWhatsApp({ phone, message, language }) {
  const { appKey, template } = config();
  try {
    const { status, body } = await postJson(
      { AppKey: appKey, sRecipient: phone, Lng: language, sMessage: message, TemplateName: template }, TIMEOUT_MS);
    if (status >= 200 && status < 300 && body?.success === true) return { success: true };
    const detail = [body?.result, body?.errDesc, body?.errNo && `(${body.errNo})`].filter(Boolean).join(' · ') || `HTTP ${status}`;
    return { success: false, reason: body ? reasonFor(body) : 'WA_FAILED', error: detail.slice(0, 300) };
  } catch (err) {
    return { success: false, reason: 'WA_UNREACHABLE', error: describeNetworkError(err).slice(0, 300) };
  }
}

// Can this server talk to the gateway? Sends a request with a deliberately invalid AppKey, which
// the gateway rejects (errNo 1005) without sending anything; any JSON answer means it's reachable.
let lastCheck = { reachable: null, error: null, checkedAt: null };

async function checkGateway() {
  if (!isWhatsAppConfigured()) return (lastCheck = { reachable: false, error: 'Not configured', checkedAt: new Date().toISOString() });
  const started = Date.now();
  try {
    const { status, body } = await postJson(
      { AppKey: 'connectivity-check', sRecipient: '0', Lng: 'en', sMessage: 'check', TemplateName: config().template }, CHECK_TIMEOUT_MS);
    const reachable = Boolean(body) || (status > 0 && status < 500);
    lastCheck = { reachable, error: reachable ? null : `HTTP ${status}`, ms: Date.now() - started, checkedAt: new Date().toISOString() };
  } catch (err) {
    lastCheck = { reachable: false, error: describeNetworkError(err), checkedAt: new Date().toISOString() };
  }
  return lastCheck;
}

module.exports = {
  isWhatsAppConfigured,
  normalizePhone,
  sendWhatsApp,
  checkGateway,
  gatewayStatus: () => lastCheck,
  config: () => ({ countryCode: config().countryCode }),
};
