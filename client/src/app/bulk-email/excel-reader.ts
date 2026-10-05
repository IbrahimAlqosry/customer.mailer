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

function isNameHeader(h: string): boolean {
  return !isEmailHeader(h) && (h.includes('name') || h.includes('اسم') || h.includes('عميل'));
}

function isEmail(value: unknown): boolean {
  return isValidEmail(clean(value));
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
  const rows = XLSX.utils
    .sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false })
    .filter(r => r.some(c => clean(c) !== ''));

  if (rows.length === 0) return { customers: [], skipped: 0 };

  const columnCount = Math.max(...rows.map(r => r.length));
  const hasHeader = !rows[0].some(isEmail);
  const headers = hasHeader ? rows[0].map(normalizeHeader) : [];
  const dataRows = hasHeader ? rows.slice(1) : rows;

  // Email column: the one with the most valid emails, so column order doesn't matter.
  const emailCounts = Array.from({ length: columnCount }, (_, c) => dataRows.filter(r => isEmail(r[c])).length);
  const emailCol = emailCounts.indexOf(Math.max(...emailCounts));

  // Name column: a recognised header, otherwise the text column with the most values.
  let nameCol = headers.findIndex((h, c) => c !== emailCol && isNameHeader(h));
  if (nameCol === -1) {
    let best = -1;
    for (let c = 0; c < columnCount; c++) {
      if (c === emailCol) continue;
      const count = dataRows.filter(r => clean(r[c]) !== '' && !isEmail(r[c])).length;
      if (count > best) { best = count; nameCol = c; }
    }
  }

  const customers: Customer[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const row of dataRows) {
    const name = nameCol >= 0 ? clean(row[nameCol]) : '';
    const email = clean(row[emailCol]).toLowerCase();

    if (!isValidEmail(email) || seen.has(email)) {
      skipped++;
      continue;
    }
    seen.add(email);
    customers.push({ name, email });
  }
  return { customers, skipped };
}
