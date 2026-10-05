// Keeps an unfinished send in localStorage so a page reload doesn't lose it.
const STORAGE_KEY = 'bulk-email:state';

export interface SavedRow {
  name: string;
  email: string;
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'bounced';
  failure?: { reason: string; detail?: string };
  error?: string; // older saved data: a plain failure message
  issue?: { code: string; severity: 'error' | 'warning'; suggestion?: string };
  checked?: boolean;
  sentAt?: string; // ISO date
}

export interface SavedState {
  fileName: string;
  skipped: number;
  subject: string;
  body: string;
  emailLang?: 'ar' | 'en'; // missing in data saved before email languages existed
  rows: SavedRow[];
  run: { total: number; sent: number; failed: number; limit?: { detail?: string } } | null;
}

// Storage can be unavailable (private mode, blocked site data) or full; the app just works without it then.
export function loadState(): SavedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const state = raw ? (JSON.parse(raw) as SavedState) : null;
    return Array.isArray(state?.rows) ? state : null;
  } catch {
    return null;
  }
}

export function saveState(state: SavedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore: quota exceeded or storage blocked.
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}
