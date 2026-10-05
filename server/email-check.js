// Checks addresses before sending: domain exists and accepts mail, not disposable, not an
// obvious fake/test address, and likely typos of popular providers (e.g. kmail.com -> gmail.com).
// It can't prove a mailbox exists (providers refuse to say); bounce tracking covers that.

const dns = require('dns').promises;
const disposableList = require('disposable-email-domains');
const { isValidEmail } = require('./validation');

const DISPOSABLE = new Set(disposableList);

// Popular providers people mistype. Domains here are never flagged as typos themselves.
const POPULAR = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'aol.com', 'protonmail.com', 'proton.me', 'yandex.com', 'mail.ru', 'gmx.com', 'zoho.com',
  'yahoo.co.uk', 'hotmail.co.uk', 'hotmail.fr', 'outlook.sa', 'mail.com', 'email.com',
];
const POPULAR_SET = new Set(POPULAR);

// Placeholder domains and local parts that are never real recipients.
const FAKE_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net', 'test.com', 'test.net', 'test.org', 'domain.com', 'yourdomain.com',
  'mydomain.com', 'sample.com', 'company.com', 'email.test', 'localhost', 'invalid', 'none.com', 'noemail.com', 'fake.com',
]);
const FAKE_LOCALS = new Set([
  'test', 'testing', 'tester', 'fake', 'noemail', 'no-email', 'no.email', 'nomail', 'none', 'null', 'nobody', 'dummy',
  'sample', 'asdf', 'asdfgh', 'qwerty', 'abc', 'abcd', 'xyz', 'xxx', 'xxxx', 'noreply', 'no-reply', 'donotreply', 'do-not-reply',
  'user', 'username', 'email', 'name', 'admin123', '123', '1234', '12345', '123456',
]);

const DNS_TIMEOUT_MS = 5000;
const CACHE_MS = 60 * 60 * 1000;
const domainCache = new Map(); // domain -> { result, at }

function withTimeout(promise) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), DNS_TIMEOUT_MS))]);
}

// Optimal string alignment distance (Levenshtein + adjacent swaps), enough for typo detection.
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

function typoSuggestion(domain) {
  if (POPULAR_SET.has(domain)) return null;
  let best = null;
  for (const popular of POPULAR) {
    const distance = editDistance(domain, popular);
    // One edit for short domains, up to two for longer ones (e.g. "gamil.con" -> "gmail.com").
    const allowed = popular.length >= 9 ? 2 : 1;
    if (distance <= allowed && (!best || distance < best.distance)) best = { domain: popular, distance };
  }
  return best?.domain ?? null;
}

function isDisposable(domain) {
  // Also matches subdomains, e.g. "abc.mailinator.com".
  const parts = domain.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    if (DISPOSABLE.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}

// Does the domain accept email? MX records, or an A/AAAA record (implicit MX, RFC 5321).
async function checkDomain(domain) {
  const cached = domainCache.get(domain);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.result;

  let result;
  try {
    const mx = await withTimeout(dns.resolveMx(domain));
    // A single "." MX means the domain explicitly accepts no email (null MX, RFC 7505).
    result = mx.length === 1 && (mx[0].exchange === '' || mx[0].exchange === '.') ? 'NO_MX' : 'OK';
  } catch (err) {
    if (err.code === 'ENOTFOUND') {
      result = 'DOMAIN_NOT_FOUND';
    } else if (err.code === 'ENODATA') {
      const hasAddress = await withTimeout(dns.resolve4(domain)).then(() => true, () =>
        withTimeout(dns.resolve6(domain)).then(() => true, () => false));
      result = hasAddress ? 'OK' : 'NO_MX';
    } else {
      // DNS trouble on our side (timeout, server failure): don't block the address.
      return 'UNKNOWN';
    }
  }
  domainCache.set(domain, { result, at: Date.now() });
  return result;
}

async function checkEmail(rawEmail) {
  const email = String(rawEmail ?? '').trim().toLowerCase();
  const issue = (code, severity, extra) => ({ email, valid: false, code, severity, ...extra });
  if (!isValidEmail(email)) return issue('INVALID_SYNTAX', 'error');

  const [local, domain] = [email.slice(0, email.lastIndexOf('@')), email.slice(email.lastIndexOf('@') + 1)];
  if (FAKE_DOMAINS.has(domain) || FAKE_LOCALS.has(local) || /^(.)\1{2,}$/.test(local)) return issue('FAKE', 'error');
  if (isDisposable(domain)) return issue('DISPOSABLE', 'error');

  const domainStatus = await checkDomain(domain);
  if (domainStatus === 'DOMAIN_NOT_FOUND' || domainStatus === 'NO_MX') {
    const suggestion = typoSuggestion(domain);
    return issue(domainStatus, 'error', suggestion ? { suggestion: `${local}@${suggestion}` } : undefined);
  }

  // The domain works but looks like a mistyped popular provider: worth a second look.
  const suggestion = typoSuggestion(domain);
  if (suggestion) return issue('TYPO', 'warning', { suggestion: `${local}@${suggestion}` });

  return { email, valid: true };
}

async function checkEmails(emails) {
  // Look up each domain once, a few at a time, before checking individual addresses.
  const domains = [...new Set(emails.map(e => String(e).trim().toLowerCase().split('@')[1]).filter(Boolean))];
  for (let i = 0; i < domains.length; i += 20) {
    await Promise.all(domains.slice(i, i + 20).map(d => checkDomain(d).catch(() => 'UNKNOWN')));
  }
  return Promise.all(emails.map(checkEmail));
}

module.exports = { checkEmails, typoSuggestion, editDistance };
