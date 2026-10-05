// Client-side limits and checks. The server enforces the same rules (server/validation.js);
// these exist so the user gets instant, translated feedback before anything is sent.

export const LIMITS = {
  subject: 150,          // characters
  bodyText: 20_000,      // characters of visible text
  bodyHtml: 200_000,     // characters of editor HTML
  fileMb: 5,
  recipients: 5_000,     // customers per file
};

export const ACCEPTED_FILE = /\.(xlsx|xls|csv)$/i;

// local@domain.tld, no spaces, no consecutive/leading/trailing dots. Same pattern as the server.
const EMAIL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}
