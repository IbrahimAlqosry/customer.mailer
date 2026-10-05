// Turns an SMTP status/reply (e.g. "5.1.1", "550 relaying denied") into a reason code the client
// shows in the user's language. The raw reply is always kept alongside it as the technical detail.

const RULES = [
  // Our own account hit its sending cap (per hour/day). Checked first: these replies also contain
  // words like "quota" that would otherwise read as "the recipient's mailbox is full".
  // e.g. Exim/cPanel "has exceeded the max emails per hour (100/100)", Gmail "5.4.5 Daily user sending quota exceeded",
  // Outlook "SubmissionQuotaExceeded", generic "rate limit" / "too many messages".
  ['RATE_LIMIT', /sending (limit|quota)|send quota|submissionquota|daily (user )?(sending )?(limit|quota)|(hourly|daily) (message |email )?limit|max(imum)? (number of )?(e-?mails|messages|recipients) (per|an?) (hour|day)|exceeded the max(imum)? (e-?mails|messages)|(e-?mails|messages) per (hour|day)|rate.?limit|too many (messages|e-?mails|mails|recipients|connections)|(message|e-?mail|sending) limit (exceeded|reached)|limit (exceeded|reached)|5\.4\.5\b|throttl/],
  ['NO_MAILBOX', /5\.1\.(1|10)\b|user unknown|unknown user|no such user|user not found|does not exist|doesn't exist|mailbox (unavailable|not found)|no mailbox|recipient (not found|unknown)|unknown recipient|invalid recipient|address rejected/],
  // The recipient's server won't take mail for this address (it doesn't host it).
  ['RECIPIENT_REFUSED', /relay(ing)? (access )?(denied|not permitted)|not permitted to relay|relay not allowed/],
  ['MAILBOX_FULL', /5\.2\.2\b|mailbox full|quota|over quota|insufficient storage/],
  ['BAD_DOMAIN', /5\.1\.2\b|domain not found|host not found|no mx|unrouteable|dns (error|failure)/],
  ['SPAM_BLOCKED', /5\.7\.\d|spam|blocked|blacklist|blocklist|policy|reputation|dmarc|spf|dkim/],
  ['MESSAGE_TOO_LARGE', /5\.3\.4\b|too large|size limit|exceeds.*size/],
  ['TEMPORARY', /^4\d\d|\b4\.\d\.\d\b|try again later|temporar|greylist/],
  ['AUTH_FAILED', /authentication|auth.*failed|535\b|invalid login|username and password/],
  ['CONNECTION', /econnrefused|etimedout|econnreset|ehostunreach|connection (refused|timed out|closed)|socket/],
];

function reasonFromSmtp(...parts) {
  const text = parts.filter(Boolean).join(' ').toLowerCase();
  for (const [code, pattern] of RULES) if (pattern.test(text)) return code;
  return 'OTHER';
}

module.exports = { reasonFromSmtp };
