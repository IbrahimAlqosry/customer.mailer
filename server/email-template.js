// Builds the HTML + plain-text email sent to each customer.
// Email clients ignore most modern CSS, so the layout is tables + inline styles only
// (bgcolor attributes back up gradients for Outlook, which ignores CSS backgrounds).

const FONT = "Tahoma, 'Segoe UI', Arial, sans-serif";

// Per-language text and direction. Arabic is right-to-left, English left-to-right.
const LANGUAGES = {
  ar: {
    dir: 'rtl',
    align: 'right',
    greeting: name => (name ? `عزيزي العميل / ${name}` : 'عزيزي العميل'),
    regards: 'مع خالص التحيات،',
    sentTo: email => `تم إرسال هذه الرسالة إلى ${email}`,
    rights: year => `© ${year} جميع الحقوق محفوظة`,
  },
  en: {
    dir: 'ltr',
    align: 'left',
    greeting: name => (name ? `Dear ${name},` : 'Dear Customer,'),
    regards: 'Best regards,',
    sentTo: email => `This email was sent to ${email}`,
    rights: year => `© ${year} All rights reserved.`,
  },
};

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlToText(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h[1-3]|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildEmail({ name, email, subject, bodyHtml, language, brand }) {
  const lang = LANGUAGES[language] ? language : 'ar';
  const t = LANGUAGES[lang];
  const { dir, align } = t;
  const year = new Date().getFullYear();
  const greeting = t.greeting(name);
  const bodyText = htmlToText(bodyHtml);
  const brandInitial = (brand.trim()[0] || '✉').toUpperCase();
  const listPadding = dir === 'rtl' ? 'padding:0 22px 0 0;' : 'padding:0 0 0 22px;';
  // Hidden "preheader": the snippet inbox lists show next to the subject.
  const preheader = bodyText.replace(/\s+/g, ' ').slice(0, 110);

  const text = [
    greeting,
    '',
    bodyText,
    '',
    t.regards,
    brand,
    '',
    '—',
    t.sentTo(email),
  ].join('\n');

  const html = `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${escapeHtml(subject)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=Tajawal:wght@400;700&family=Amiri:wght@400;700&display=swap" rel="stylesheet">
  <style>
    body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; }
    p { margin: 0; }
    ul, ol { margin: 0; ${listPadding} }
    a { color: #2952cc; }
    @media (max-width: 620px) {
      .container { width: 100% !important; }
      .px { padding-left: 22px !important; padding-right: 22px !important; }
      .title { font-size: 20px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background:#eef1f7;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">${escapeHtml(preheader)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef1f7" style="background:#eef1f7;">
    <tr><td align="center" style="padding:32px 12px;">

      <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;">

        <!-- Header -->
        <tr><td bgcolor="#1e3fa3" class="px" dir="${dir}"
                style="background:#1e3fa3; background-image:linear-gradient(135deg, #142e7a 0%, #1e3fa3 45%, #3b6cf0 100%); border-radius:16px 16px 0 0; padding:28px 36px 30px; text-align:${align};">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align}">
            <tr>
              <td width="40" height="40" bgcolor="#ffffff" align="center" valign="middle"
                  style="width:40px; height:40px; border-radius:12px; background:#ffffff; color:#1e3fa3; font-family:${FONT}; font-size:18px; font-weight:bold; line-height:40px;">${escapeHtml(brandInitial)}</td>
              <td style="padding-${dir === 'rtl' ? 'right' : 'left'}:12px; font-family:${FONT}; font-size:16px; font-weight:bold; color:#ffffff;">${escapeHtml(brand)}</td>
            </tr>
          </table>
          <div style="clear:both; height:22px; line-height:22px; font-size:0;">&nbsp;</div>
          <h1 class="title" style="margin:0; font-family:${FONT}; font-size:23px; line-height:1.5; font-weight:bold; color:#ffffff; text-align:${align};">${escapeHtml(subject)}</h1>
        </td></tr>

        <!-- Body -->
        <tr><td bgcolor="#ffffff" class="px" dir="${dir}"
                style="background:#ffffff; padding:34px 36px 30px; font-family:${FONT}; font-size:15px; line-height:1.9; color:#344054; text-align:${align};">
          <p style="margin:0 0 18px; font-size:17px; font-weight:bold; color:#172033;">${escapeHtml(greeting)}</p>
          <div>${bodyHtml}</div>

          <!-- Signature -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:30px;">
            <tr><td style="border-top:1px solid #e4e7ec; padding-top:20px; font-family:${FONT}; text-align:${align};">
              <p style="margin:0; font-size:14px; color:#667085;">${t.regards}</p>
              <p style="margin:4px 0 0; font-size:15px; font-weight:bold; color:#1e3fa3;">${escapeHtml(brand)}</p>
            </td></tr>
          </table>
        </td></tr>

        <!-- Accent line -->
        <tr><td height="4" bgcolor="#2952cc" style="height:4px; line-height:4px; font-size:0; background:#2952cc; background-image:linear-gradient(90deg, #1e3fa3, #4f7cf5);">&nbsp;</td></tr>

        <!-- Footer -->
        <tr><td bgcolor="#f8f9fc" class="px" dir="${dir}"
                style="background:#f8f9fc; border-radius:0 0 16px 16px; padding:20px 36px 24px; font-family:${FONT}; font-size:12px; line-height:1.8; color:#98a2b3; text-align:center;">
          <p style="margin:0;">${escapeHtml(t.sentTo(email))}</p>
          <p style="margin:2px 0 0;">${escapeHtml(t.rights(year))} · <span dir="ltr">${escapeHtml(brand)}</span></p>
        </td></tr>

      </table>

    </td></tr>
  </table>
</body>
</html>`;

  return { text, html };
}

// The opening line every message starts with (email and WhatsApp share it).
function greeting(name, language) {
  return (LANGUAGES[language] || LANGUAGES.ar).greeting(name);
}

module.exports = { buildEmail, greeting, htmlToText, escapeHtml };
