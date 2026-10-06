import * as XLSX from 'xlsx';
import * as cptable from 'xlsx/dist/cpexcel.full.mjs';
import { Customer } from './email.service';
import { isValidEmail } from './validation';

// Codepage tables are needed to read Arabic text from old .xls files.
XLSX.set_cptable(cptable);

const ARABIC_CODEPAGE = 1256;

// Invisible direction / zero-width characters that Excel often adds around Arabic text.
const INVISIBLE_RE = /[​-‏‪-‮⁦-⁩﻿ ]/g;

export interface ReadResult {
  customers: Customer[];
  skipped: number;
}

function clean(value: unknown): string {
  return String(value ?? '').replace(INVISIBLE_RE, ' ').replace(/\s+/g, ' ').trim();
}

// Normalises Arabic spelling variants so "إسم العميل" / "الاسم" / "اسم  العميل" all match.
function normalizeHeader(value: unknown): string {
  return clean(value)
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '') // diacritics and tatweel
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');
}

function isEmailHeader(h: string): boolean {
  return h.includes('mail') || h.includes('بريد') || h.includes('ايميل') || h.includes('اميل');
}

function isPhoneHeader(h: string): boolean {
  return /phone|mobile|tel|whats|cell|جوال|موبايل|محمول|هاتف|تليفون|تلفون|واتس/.test(h);
}

function isNameHeader(h: string): boolean {
  return !isEmailHeader(h) && !isPhoneHeader(h) && (h.includes('name') || h.includes('اسم') || h.includes('عميل'));
}

function isEmail(value: unknown): boolean {
  return isValidEmail(clean(value));
}

// A phone cell as typed: digits with optional +, spaces, dashes, dots or brackets; 7 to 15 digits.
// The server turns it into the international form (country code etc.) when sending.
function phoneText(value: unknown): string {
  // Excel stores phone numbers as numbers; read those from the raw value so a 12-digit number
  // isn't shown as "9.67776E+11".
  const text = typeof value === 'number' ? String(Math.round(value)) : clean(value);
  if (!/^\+?[\d\s\-().]+$/.test(text)) return '';
  const digits = text.replace(/\D/g, '').length;
  return digits >= 7 && digits <= 15 ? text : '';
}

function readWorkbook(buffer: ArrayBuffer, fileName: string): XLSX.WorkBook {
  if (/\.(csv|txt)$/i.test(fileName)) {
    // Excel saves "CSV" in Windows-1256 on Arabic systems, and "CSV UTF-8" in UTF-8.
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      text = new TextDecoder('windows-1256').decode(buffer);
    }
    return XLSX.read(text.replace(/^﻿/, ''), { type: 'string' });
  }
  return XLSX.read(buffer, { type: 'array', codepage: ARABIC_CODEPAGE });
}

export function readCustomers(buffer: ArrayBuffer, fileName: string): ReadResult {
  const workbook = readWorkbook(buffer, fileName);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  // Formatted text for names and emails; raw values for phone numbers (see phoneText).
  const textRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false });
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true });
  const keep = textRows.map(r => r.some(c => clean(c) !== ''));
  const rows = textRows.filter((_, i) => keep[i]);
  const raws = rawRows.filter((_, i) => keep[i]);

  if (rows.length === 0) return { customers: [], skipped: 0 };

  const columnCount = Math.max(...rows.map(r => r.length));
  const hasHeader = !rows[0].some((c, i) => isEmail(c) || phoneText(raws[0][i]));
  const headers = hasHeader ? rows[0].map(normalizeHeader) : [];
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const dataRaws = hasHeader ? raws.slice(1) : raws;
  const columns = Array.from({ length: columnCount }, (_, c) => c);
  const best = (score: (c: number) => number, exclude: number[]) => {
    let col = -1, top = 0;
    for (const c of columns) if (!exclude.includes(c) && score(c) > top) { top = score(c); col = c; }
    return col;
  };

  // Email column: the one with the most valid emails, so column order doesn't matter.
  const emailCol = best(c => dataRows.filter(r => isEmail(r[c])).length, []);

  // Phone column: a recognised header (mobile, جوال, هاتف…), otherwise the column with the most phone numbers.
  let phoneCol = headers.findIndex((h, c) => c !== emailCol && isPhoneHeader(h));
  if (phoneCol === -1) phoneCol = best(c => dataRaws.filter(r => phoneText(r[c])).length, [emailCol]);

  // Name column: a recognised header, otherwise the text column with the most values.
  let nameCol = headers.findIndex((h, c) => c !== emailCol && c !== phoneCol && isNameHeader(h));
  if (nameCol === -1) {
    nameCol = best(c => dataRows.filter((r, i) => clean(r[c]) !== '' && !isEmail(r[c]) && !phoneText(dataRaws[i][c])).length, [emailCol, phoneCol]);
  }

  // A customer needs a valid email or a phone number (or both); duplicates count once.
  const customers: Customer[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  dataRows.forEach((row, i) => {
    const name = nameCol >= 0 ? clean(row[nameCol]) : '';
    const rawEmail = emailCol >= 0 ? clean(row[emailCol]).toLowerCase() : '';
    const email = isValidEmail(rawEmail) ? rawEmail : '';
    const phone = phoneCol >= 0 ? phoneText(dataRaws[i][phoneCol]) : '';
    const key = email || phone.replace(/\D/g, '');

    if (!key || seen.has(key)) {
      skipped++;
      return;
    }
    seen.add(key);
    customers.push({ name, email, phone });
  });
  return { customers, skipped };
}
