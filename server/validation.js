// Input validation for the API. Errors carry a `code` the client translates into the user's language.

const LIMITS = {
  subject: 150,          // characters
  bodyHtml: 200_000,     // characters of editor HTML
  bodyText: 20_000,      // characters of visible text
  name: 200,
  email: 254,            // RFC 5321 maximum
  recipientsPerRequest: 50,
  verifyPerRequest: 1000,
  bounceEmails: 5000,
  credential: 200,
};

const LANGUAGES = ['ar', 'en'];

// Practical address check: local@domain.tld, no spaces, no consecutive/leading/trailing dots.
const EMAIL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

function isValidEmail(email) {
  return typeof email === 'string' && email.length <= LIMITS.email && EMAIL_RE.test(email);
}

class ValidationError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

// Line breaks in a subject could inject extra email headers; collapse all whitespace runs to one space.
const singleLine = value => value.replace(/\s+/g, ' ').trim();

function validateSendRequest(body) {
  const { subject, body: html, recipients, language = 'ar' } = body || {};

  if (typeof subject !== 'string' || !singleLine(subject)) {
    throw new ValidationError('SUBJECT_REQUIRED', 'Subject is required.');
  }
  const cleanSubject = singleLine(subject);
  if (cleanSubject.length > LIMITS.subject) {
    throw new ValidationError('SUBJECT_TOO_LONG', `Subject must be at most ${LIMITS.subject} characters.`, { max: LIMITS.subject });
  }

  if (typeof html !== 'string' || !html.trim()) {
    throw new ValidationError('BODY_REQUIRED', 'Message body is required.');
  }
  if (html.length > LIMITS.bodyHtml) {
    throw new ValidationError('BODY_TOO_LONG', 'Message body is too long.', { max: LIMITS.bodyHtml });
  }

  if (!LANGUAGES.includes(language)) {
    throw new ValidationError('INVALID_LANGUAGE', `Language must be one of: ${LANGUAGES.join(', ')}.`);
  }

  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new ValidationError('RECIPIENTS_REQUIRED', 'At least one recipient is required.');
  }
  if (recipients.length > LIMITS.recipientsPerRequest) {
    throw new ValidationError('TOO_MANY_RECIPIENTS', `At most ${LIMITS.recipientsPerRequest} recipients per request.`, { max: LIMITS.recipientsPerRequest });
  }

  const cleanRecipients = recipients.map(r => ({
    name: singleLine(String(r?.name ?? '')).slice(0, LIMITS.name),
    email: String(r?.email ?? '').trim().toLowerCase(),
  }));

  return { subject: cleanSubject, html, recipients: cleanRecipients, language };
}

// A non-empty list of strings (the addresses themselves are checked by the caller).
function validateEmailList(emails, max) {
  if (!Array.isArray(emails) || emails.length === 0) throw new ValidationError('RECIPIENTS_REQUIRED', 'At least one email is required.');
  if (emails.length > max) throw new ValidationError('TOO_MANY_RECIPIENTS', `At most ${max} emails per request.`, { max });
  return emails.map(e => String(e ?? '').trim().toLowerCase().slice(0, LIMITS.email + 1));
}

function validateLogin(body) {
  const { username, password } = body || {};
  const valid = v => typeof v === 'string' && v.length > 0 && v.length <= LIMITS.credential;
  if (!valid(username) || !valid(password)) {
    throw new ValidationError('INVALID_REQUEST', 'Username and password are required.');
  }
  return { username, password };
}

module.exports = { LIMITS, isValidEmail, validateSendRequest, validateEmailList, validateLogin, ValidationError };
