import { Injectable, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { API_URL } from '../api';

const TOKEN_KEY = 'bulk-email:token';

interface LoginResponse {
  token: string;
  username: string;
}

interface Session {
  token: string;
  username: string;
  exp: number; // ms timestamp
}

// Reads the expiry the server signed into the token (the signature is checked server-side).
function parseToken(token: string): Session | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp > Date.now() ? { token, username: payload.sub, exp: payload.exp } : null;
  } catch {
    return null;
  }
}

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly session = signal<Session | null>(null);
  private expiryTimer?: ReturnType<typeof setTimeout>;

  readonly loggedIn = computed(() => this.session() !== null);
  readonly username = computed(() => this.session()?.username ?? '');

  constructor(private http: HttpClient) {
    const stored = readStoredToken();
    const session = stored ? parseToken(stored) : null;
    if (session) this.start(session);
    else this.forget();
  }

  get token(): string | null {
    return this.session()?.token ?? null;
  }

  login(username: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${API_URL}/login`, { username, password }).pipe(
      tap(res => {
        const session = parseToken(res.token);
        if (!session) return;
        try {
          localStorage.setItem(TOKEN_KEY, res.token);
        } catch {
          // Storage blocked: the session still works until the page is reloaded.
        }
        this.start(session);
      }),
    );
  }

  logout(): void {
    this.forget();
    this.session.set(null);
  }

  private start(session: Session): void {
    this.session.set(session);
    clearTimeout(this.expiryTimer);
    // setTimeout overflows above ~24.8 days; tokens last hours, so this is only a safety cap.
    this.expiryTimer = setTimeout(() => this.logout(), Math.min(session.exp - Date.now(), 2 ** 31 - 1));
  }

  private forget(): void {
    clearTimeout(this.expiryTimer);
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Ignore.
    }
  }
}
