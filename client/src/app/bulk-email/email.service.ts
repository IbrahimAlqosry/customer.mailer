import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_URL } from '../api';
import { Language } from '../i18n/translations';

export interface Customer {
  name: string;
  email: string;
}

export interface SendResult {
  name: string;
  email: string;
  success: boolean;
  code?: string;   // e.g. 'INVALID_EMAIL'
  reason?: string; // translated by the client: 'reason.<code>'
  error?: string;  // the mail server's exact reply
}

// Pre-send address check (server/email-check.js).
export type IssueCode = 'INVALID_SYNTAX' | 'FAKE' | 'DISPOSABLE' | 'DOMAIN_NOT_FOUND' | 'NO_MX' | 'TYPO';

export interface EmailIssue {
  code: IssueCode;
  severity: 'error' | 'warning';
  suggestion?: string;
}

export interface EmailCheck extends Partial<EmailIssue> {
  email: string;
  valid: boolean;
}

// A delivery failure reported to the sender's inbox after sending (server/bounce-check.js).
export interface Bounce {
  email: string;
  reason: string;
  detail: string | null;
  at: string;
}

export interface SendResponse {
  total: number;
  sent: number;
  failed: number;
  results: SendResult[];
}

export interface ServerStatus {
  smtpReady: boolean;
  from: string;
  fromName: string;
}

@Injectable({ providedIn: 'root' })
export class EmailService {
  constructor(private http: HttpClient) {}

  status(): Observable<ServerStatus> {
    return this.http.get<ServerStatus>(`${API_URL}/status`);
  }

  // `body` is HTML from the rich text editor; `language` sets the email's greeting and direction.
  sendEmails(subject: string, body: string, recipients: Customer[], language: Language): Observable<SendResponse> {
    return this.http.post<SendResponse>(`${API_URL}/send-emails`, { subject, body, recipients, language });
  }

  verifyEmails(emails: string[]): Observable<{ results: EmailCheck[] }> {
    return this.http.post<{ results: EmailCheck[] }>(`${API_URL}/verify-emails`, { emails });
  }

  checkBounces(since: Date, emails: string[]): Observable<{ bounces: Bounce[]; checkedAt: string }> {
    return this.http.post<{ bounces: Bounce[]; checkedAt: string }>(`${API_URL}/bounces`, { since: since.toISOString(), emails });
  }
}
