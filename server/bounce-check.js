// Finds delivery failures ("bounces") for addresses we sent to, by reading the sender's inbox.
// The mail server accepts every message first and only reports a failed delivery later, as an
// email back to the sender; this turns those reports into per-recipient results.
// The mailbox is opened read-only: nothing is marked as read, moved or deleted.

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const MAX_MESSAGES = 300; // newest candidate messages to inspect per check

function imapConfig() {
  return {
    host: process.env.IMAP_HOST || process.env.SMTP_HOST,
    port: Number(process.env.IMAP_PORT) || 993,
    secure: (process.env.IMAP_SECURE || 'true') !== 'false',
    auth: {
      user: process.env.IMAP_USER || process.env.SMTP_USER,
      pass: process.env.IMAP_PASS || process.env.SMTP_PASS,
    },
    logger: false,
  };
}

const { reasonFromSmtp } = require('./smtp-reasons');

// A delivery-status report has one block per recipient (RFC 3464).
function parseDeliveryStatus(text) {
  const results = [];
  for (const block of text.split(/\r?\n\s*\r?\n/)) {
    const field = name => block.match(new RegExp(`^${name}:\\s*(.+)$`, 'im'))?.[1].trim();
    const recipient = (field('Final-Recipient') || field('Original-Recipient') || '').replace(/^rfc822;\s*/i, '').trim().toLowerCase();
    const action = (field('Action') || '').toLowerCase();
    if (!recipient || (action && action !== 'failed')) continue; // ignore "delayed"/"delivered" notices
    results.push({ email: recipient, status: field('Status'), diagnostic: field('Diagnostic-Code') });
  }
  return results;
}

// "smtp; 550 5.1.1 <x@y>: Recipient address rejected" -> "550 5.1.1 <x@y>: Recipient address rejected"
function cleanDiagnostic(text) {
  return (text || '').replace(/^\s*smtp;\s*/i, '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

// For free-text notices: the SMTP reply line (e.g. "550 ...") that follows the failed address.
function smtpReplyNear(body, address) {
  const after = body.slice(body.toLowerCase().indexOf(address));
  return after.match(/\b[45]\d\d[ -][^\n]+/)?.[0] ?? after.slice(0, 300);
}

/**
 * @param {Date} since   only reports received after this moment
 * @param {string[]} emails  the addresses we sent to (only these are reported)
 */
async function findBounces(since, emails) {
  const wanted = new Set(emails.map(e => String(e).trim().toLowerCase()));
  const client = new ImapFlow(imapConfig());
  const bounces = new Map(); // email -> bounce

  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
      // IMAP "SINCE" works by day; the exact time is filtered below.
      const uids = await client.search({
        since: new Date(since.getFullYear(), since.getMonth(), since.getDate()),
        or: [
          { from: 'mailer-daemon' }, { from: 'postmaster' }, { from: 'mail delivery' },
          { subject: 'undeliver' }, { subject: 'delivery status' }, { subject: 'failure' },
          { subject: 'returned mail' }, { subject: 'not delivered' }, { subject: 'delivery has failed' },
        ],
      }, { uid: true });

      for await (const message of client.fetch(uids.slice(-MAX_MESSAGES), { source: true, internalDate: true }, { uid: true })) {
        if (message.internalDate && message.internalDate < since) continue;
        const parsed = await simpleParser(message.source);
        const reports = [];

        // Standard report: a message/delivery-status part.
        for (const part of parsed.attachments || []) {
          if (/delivery-status/i.test(part.contentType)) reports.push(...parseDeliveryStatus(part.content.toString('utf8')));
        }
        // Many servers (e.g. Exim) put the same report fields in the text body instead.
        if (reports.length === 0 && parsed.text) reports.push(...parseDeliveryStatus(parsed.text));
        // Last resort: find our recipients anywhere in the text of a failure notice.
        if (reports.length === 0) {
          const body = `${parsed.subject || ''}\n${parsed.text || ''}`;
          for (const address of body.toLowerCase().match(/[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || []) {
            if (wanted.has(address)) reports.push({ email: address, diagnostic: smtpReplyNear(body, address) });
          }
        }

        for (const report of reports) {
          if (!wanted.has(report.email)) continue;
          bounces.set(report.email, {
            email: report.email,
            reason: reasonFromSmtp(report.status, report.diagnostic),
            // The remote server's own words, e.g. "550 relaying denied" (shown as the technical detail).
            detail: cleanDiagnostic(report.diagnostic) || report.status || null,
            at: (message.internalDate || parsed.date || new Date()).toISOString(),
          });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return [...bounces.values()];
}

module.exports = { findBounces };
