require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const sanitizeHtml = require('sanitize-html');
const { login, requireAuth } = require('./auth');
const { buildEmail, htmlToText } = require('./email-template');
const { LIMITS, isValidEmail, validateSendRequest, validateEmailList, ValidationError } = require('./validation');
const { checkEmails } = require('./email-check');
const { findBounces } = require('./bounce-check');
const { reasonFromSmtp } = require('./smtp-reasons');

const app = express();
// Behind IIS (ARR) every request arrives from 127.0.0.1; trust its X-Forwarded-For header so
// req.ip is the real visitor (the login lockout counts attempts per visitor IP).
app.set('trust proxy', 'loopback');
app.use(cors({ origin: process.env.CLIENT_ORIGIN }));
app.use(express.json({ limit: '5mb' }));

// Express 4 doesn't pass errors thrown in async handlers to the error middleware by itself.
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

app.post('/api/login', login);

// Unauthenticated liveness check for deployment: /CustomerMailerApi/api/health on IIS.
app.get('/api/health', (req, res) => res.json({ ok: true }));

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false, // port 587 uses STARTTLS
  requireTLS: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});


const FONT_FALLBACK = 'Tahoma, Arial, sans-serif';

// Cleans the rich-text HTML coming from the editor so only safe formatting reaches the email.
function prepareBodyHtml(rawHtml) {
  const html = String(rawHtml)
    // Quill turns every space into &nbsp;, which stops lines from wrapping in email clients.
    .replace(/(&nbsp;)+/g, m => (m.length === 6 ? ' ' : m))
    // Keep empty lines visible: an empty <p></p> collapses in most email clients.
    .replace(/<p([^>]*)><\/p>/g, '<p$1><br></p>');

  return sanitizeHtml(html, {
    allowedTags: ['p', 'br', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ol', 'ul', 'li', 'h1', 'h2', 'h3', 'blockquote'],
    allowedAttributes: { '*': ['style'], a: ['href', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedStyles: {
      '*': {
        'color': [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i],
        'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i],
        'font-size': [/^\d{1,2}px$/],
        'font-family': [/^[\w\s"',-]+$/],
        'text-align': [/^(left|right|center|justify)$/],
        'direction': [/^(rtl|ltr)$/],
        'margin': [/^0$/],
      },
    },
    transformTags: {
      p: (tagName, attribs) => ({ tagName, attribs: { ...attribs, style: `margin:0;${attribs.style || ''}` } }),
      a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, target: '_blank', rel: 'noopener' } }),
    },
  })
    // Web fonts like Cairo aren't available in every email client; add a safe fallback.
    .replace(/font-family:\s*([^;"]+)/g, (m, family) => `font-family:${family.trim()}, ${FONT_FALLBACK}`);
}

app.post('/api/send-emails', requireAuth, asyncRoute(async (req, res) => {
  const { subject, html, recipients, language } = validateSendRequest(req.body);

  const bodyHtml = prepareBodyHtml(html);
  const bodyText = htmlToText(bodyHtml);
  if (!bodyText) throw new ValidationError('BODY_REQUIRED', 'Message body is empty.');
  if (bodyText.length > LIMITS.bodyText) {
    throw new ValidationError('BODY_TOO_LONG', 'Message body is too long.', { max: LIMITS.bodyText });
  }

  const results = [];
  let limitHit = false;
  // One email per customer: each gets their own name and nobody sees
  // the other customers' addresses.
  for (const { name, email } of recipients) {
    // After the account's sending limit is reached every further attempt fails too; don't try them.
    if (limitHit) {
      results.push({ name, email, success: false, skipped: true, reason: 'RATE_LIMIT', error: 'Not attempted: sending limit reached' });
      continue;
    }
    if (!isValidEmail(email)) {
      results.push({ name, email, success: false, code: 'INVALID_EMAIL', reason: 'INVALID_EMAIL', error: 'Invalid email address' });
      continue;
    }

    try {
      const { text, html } = buildEmail({ name, email, subject, bodyHtml, language, brand: process.env.MAIL_FROM_NAME || '' });
      await transporter.sendMail({
        from: `"${process.env.MAIL_FROM_NAME}" <${process.env.SMTP_USER}>`,
        to: email,
        subject,
        text,
        html,
      });
      results.push({ name, email, success: true });
    } catch (err) {
      // A translated reason for the user, plus the mail server's exact reply as the detail.
      const detail = String(err.response || err.message || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      const reason = reasonFromSmtp(String(err.responseCode || ''), detail, err.code);
      limitHit = reason === 'RATE_LIMIT';
      results.push({ name, email, success: false, reason, error: detail });
    }
  }

  const sent = results.filter(r => r.success).length;
  res.json({ total: results.length, sent, failed: results.length - sent, results });
}));

let smtpReady = false;

// Checks addresses before sending (domain accepts mail, disposable, fake, likely typo).
app.post('/api/verify-emails', requireAuth, asyncRoute(async (req, res) => {
  const emails = validateEmailList(req.body?.emails, LIMITS.verifyPerRequest);
  res.json({ results: await checkEmails(emails) });
}));

// Delivery failures reported back to the sender's inbox after sending.
app.post('/api/bounces', requireAuth, asyncRoute(async (req, res) => {
  const emails = validateEmailList(req.body?.emails, LIMITS.bounceEmails);
  const since = new Date(req.body?.since);
  if (Number.isNaN(since.getTime())) throw new ValidationError('INVALID_REQUEST', '"since" must be a date.');
  try {
    res.json({ bounces: await findBounces(since, emails), checkedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Bounce check failed:', err.message);
    res.status(503).json({ code: 'BOUNCE_CHECK_UNAVAILABLE', message: 'Could not read the sender mailbox.' });
  }
}));

app.get('/api/status', requireAuth, (req, res) => {
  res.json({ smtpReady, from: process.env.SMTP_USER, fromName: process.env.MAIL_FROM_NAME });
});

// Errors as JSON with a code (validation, malformed JSON, oversized body), never an HTML error page.
app.use((err, req, res, next) => {
  if (err instanceof ValidationError) {
    return res.status(400).json({ code: err.code, message: err.message, ...err.details });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ code: 'INVALID_JSON', message: 'Request body is not valid JSON.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ code: 'PAYLOAD_TOO_LARGE', message: 'Request is too large.' });
  console.error(err);
  res.status(500).json({ code: 'SERVER_ERROR', message: 'Unexpected server error.' });
});

const port = process.env.PORT || 3000;
transporter.verify()
  .then(() => { smtpReady = true; console.log('SMTP connection OK'); })
  .catch(err => console.error('SMTP connection failed:', err.message));

// Local-only by default: in production IIS is the public entry point and forwards /api here.
const host = process.env.HOST || '127.0.0.1';
app.listen(port, host, () => console.log(`Email server running on http://${host}:${port}`));
