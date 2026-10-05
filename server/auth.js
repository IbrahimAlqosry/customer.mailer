const crypto = require('crypto');
const { validateLogin } = require('./validation');

const TOKEN_HOURS = Number(process.env.AUTH_TOKEN_HOURS) || 12;
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD || !process.env.AUTH_SECRET) {
  console.error('ADMIN_USERNAME, ADMIN_PASSWORD and AUTH_SECRET must be set in .env');
  process.exit(1);
}

// Compares via hashes so the check takes the same time whatever the input length.
function safeEqual(a, b) {
  const hash = v => crypto.createHash('sha256').update(String(v)).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}

const sign = data => crypto.createHmac('sha256', process.env.AUTH_SECRET).update(data).digest('base64url');

// Token: base64url(JSON payload) + "." + HMAC signature.
function createToken(username) {
  const payload = Buffer.from(JSON.stringify({ sub: username, exp: Date.now() + TOKEN_HOURS * 3600_000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  const [payload, signature] = String(token).split('.');
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

// Failed logins per IP, to slow down password guessing.
const failures = new Map();

function login(req, res) {
  const ip = req.ip;
  const entry = failures.get(ip);
  if (entry && entry.count >= MAX_ATTEMPTS && entry.until > Date.now()) {
    const minutes = Math.ceil((entry.until - Date.now()) / 60_000);
    return res.status(429).json({ code: 'TOO_MANY_ATTEMPTS', minutes, message: `Too many failed attempts. Try again in ${minutes} minutes.` });
  }

  let credentials;
  try {
    credentials = validateLogin(req.body);
  } catch (err) {
    return res.status(400).json({ code: err.code, message: err.message });
  }
  const { username, password } = credentials;
  const ok = safeEqual(username, process.env.ADMIN_USERNAME) & safeEqual(password, process.env.ADMIN_PASSWORD);
  if (!ok) {
    const count = entry && entry.until > Date.now() ? entry.count + 1 : 1;
    failures.set(ip, { count, until: Date.now() + LOCK_MINUTES * 60_000 });
    return res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' });
  }

  failures.delete(ip);
  res.json({ token: createToken(process.env.ADMIN_USERNAME), username: process.env.ADMIN_USERNAME, expiresInHours: TOKEN_HOURS });
}

function requireAuth(req, res, next) {
  const header = req.get('Authorization') || '';
  const user = header.startsWith('Bearer ') && verifyToken(header.slice(7));
  if (!user) return res.status(401).json({ code: 'SESSION_EXPIRED', message: 'Session expired. Please sign in again.' });
  req.user = user;
  next();
}

module.exports = { login, requireAuth };
