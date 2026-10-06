import { Component, ElementRef, Input, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { QuillEditorComponent } from 'ngx-quill';
import type Quill from 'quill';
import {
  LucideAngularModule, CircleCheck, CircleX, Eye, LoaderCircle, Mail, MessageCircle, Send, TriangleAlert, User, Wand, History,
} from 'lucide-angular';
import { Channel, EmailIssue, EmailService, SendResponse, ServerStatus } from '../bulk-email/email.service';
import { LIMITS, isValidEmail } from '../bulk-email/validation';
import { I18nService, Params } from '../i18n/i18n.service';
import { TranslatePipe } from '../i18n/translate.pipe';
import { LANGUAGE_NAMES, Language, TranslationKey } from '../i18n/translations';
import { Observable } from 'rxjs';

interface Message {
  key: TranslationKey;
  params?: Params;
}

interface Failure {
  reason: string;
  detail?: string;
}

interface Sent {
  channel: Channel;
  to: string;
  name: string;
  ok: boolean;
  failure?: Failure;
  at: Date;
}

const RECENT_LIMIT = 10;

// One message to one person: the recipient's email or phone is typed in, no Excel file.
// Uses the same server endpoints (and so the same checks, greeting and template) as bulk sending.
@Component({
  selector: 'app-quick-send',
  standalone: true,
  imports: [FormsModule, QuillEditorComponent, LucideAngularModule, TranslatePipe],
  templateUrl: './quick-send.component.html',
  styleUrl: './quick-send.component.css',
})
export class QuickSendComponent {
  @Input() server: ServerStatus | null = null;

  readonly icons = { CircleCheck, CircleX, Eye, LoaderCircle, Mail, MessageCircle, Send, TriangleAlert, User, Wand, History };
  readonly languages: Language[] = ['ar', 'en'];
  readonly languageNames = LANGUAGE_NAMES;
  readonly limits = LIMITS;

  channel: Channel = 'email';
  lang: Language;

  name = '';
  email = '';
  phone = '';
  subject = '';
  body = '';
  bodyText = '';
  previewHtml: SafeHtml = '';
  waMessage = '';

  // Field errors show once a field has been left, or after a send attempt.
  touched = { email: false, phone: false, subject: false, body: false, wa: false };
  attempted = false;

  // Result of the server's address check (fake, disposable, typo…) for the typed email.
  emailIssue: EmailIssue | null = null;
  emailChecked = '';
  checkingEmail = false;

  sending = false;
  result: Sent | null = null;
  recent: Sent[] = [];

  private quill?: Quill;
  @ViewChild('recipientInput') private recipientInput?: ElementRef<HTMLInputElement>;
  @ViewChild('subjectInput') private subjectInput?: ElementRef<HTMLInputElement>;
  @ViewChild('waInput') private waInput?: ElementRef<HTMLTextAreaElement>;

  constructor(private emailService: EmailService, private sanitizer: DomSanitizer, readonly i18n: I18nService) {
    this.lang = i18n.lang();
  }

  // ---------- Channel / language ----------

  get whatsappReady(): boolean {
    return !!this.server?.whatsappReady;
  }

  setChannel(channel: Channel): void {
    if (this.sending || (channel === 'whatsapp' && !this.whatsappReady)) return;
    this.channel = channel;
    this.attempted = false;
    this.result = null;
  }

  setLang(lang: Language): void {
    if (lang === this.lang || this.sending) return;
    this.lang = lang;
    if (this.quill) this.applyDirection(this.quill);
  }

  get dir(): 'rtl' | 'ltr' {
    return this.lang === 'ar' ? 'rtl' : 'ltr';
  }

  // Same wording as the server's greeting (server/email-template.js).
  get greeting(): string {
    const name = this.name.trim();
    if (this.lang === 'en') return name ? `Dear ${name},` : 'Dear Customer,';
    return name ? `عزيزي العميل / ${name}` : 'عزيزي العميل';
  }

  // ---------- Recipient ----------

  // Matches the server's normalisation (server/whatsapp.js), shown so the user sees the final number.
  get normalizedPhone(): string | null {
    const value = this.phone.trim();
    if (!value) return null;
    const international = value.startsWith('+') || value.startsWith('00');
    const code = this.server?.whatsappCountryCode ?? '';
    let digits = value.replace(/\D/g, '');
    if (international) digits = digits.replace(/^00/, '');
    else if (code && !digits.startsWith(code)) digits = code + digits.replace(/^0+/, '');
    return /^\d{8,15}$/.test(digits) ? digits : null;
  }

  onEmailChange(): void {
    this.emailIssue = null;
    this.emailChecked = '';
  }

  // Runs the same server check as bulk sending once the user leaves the field.
  checkEmail(): void {
    this.touched.email = true;
    const email = this.email.trim().toLowerCase();
    if (!isValidEmail(email) || email === this.emailChecked) return;
    this.checkingEmail = true;
    this.emailService.verifyEmails([email]).subscribe({
      next: ({ results }) => {
        const r = results[0];
        this.emailIssue = r && !r.valid && r.code ? { code: r.code, severity: r.severity ?? 'error', suggestion: r.suggestion } : null;
        this.emailChecked = email;
        this.checkingEmail = false;
      },
      error: () => {
        // The check is a help, not a gate: if it can't run, sending is still allowed.
        this.checkingEmail = false;
      },
    });
  }

  applySuggestion(): void {
    if (!this.emailIssue?.suggestion) return;
    this.email = this.emailIssue.suggestion;
    this.onEmailChange();
    this.checkEmail();
  }

  issueLabel(issue: EmailIssue): string {
    return this.i18n.t(`issue.${issue.code}` as TranslationKey);
  }

  // ---------- Editor (email) ----------

  onEditorCreated(quill: Quill): void {
    this.quill = quill;
    this.applyDirection(quill);
  }

  onEditorChanged(event: { text: string; html: string | null }): void {
    this.bodyText = event.text.trim();
    // The editor's own HTML: bypass Angular's sanitizer so inline font/size/color styles show in the preview.
    this.previewHtml = this.sanitizer.bypassSecurityTrustHtml(event.html ?? '');
  }

  private applyDirection(quill: Quill): void {
    const rtl = this.lang === 'ar';
    for (const line of quill.getLines()) {
      const align = line.formats()['align'];
      quill.formatLine(quill.getIndex(line), 1, {
        direction: rtl ? 'rtl' : false,
        align: align === 'center' || align === 'justify' ? align : rtl ? 'right' : 'left',
      }, 'user');
    }
  }

  // ---------- Validation ----------

  get recipientError(): Message | null {
    if (this.channel === 'whatsapp') {
      if (!this.phone.trim()) return { key: 'validation.phoneRequired' };
      return this.normalizedPhone ? null : { key: 'validation.phoneInvalid' };
    }
    const email = this.email.trim();
    if (!email) return { key: 'validation.emailRequired' };
    if (!isValidEmail(email.toLowerCase())) return { key: 'validation.emailInvalid' };
    return null;
  }

  // An address the check marked as an error (fake, disposable, domain doesn't exist) blocks sending.
  get emailBlocked(): boolean {
    return this.channel === 'email' && this.emailIssue?.severity === 'error';
  }

  get subjectError(): Message | null {
    const length = this.subject.trim().length;
    if (!length) return { key: 'validation.subjectRequired' };
    return length > LIMITS.subject ? { key: 'validation.subjectTooLong', params: { max: LIMITS.subject } } : null;
  }

  get bodyError(): Message | null {
    if (!this.bodyText) return { key: 'validation.bodyRequired' };
    const tooLong = this.bodyText.length > LIMITS.bodyText || this.body.length > LIMITS.bodyHtml;
    return tooLong ? { key: 'validation.bodyTooLong', params: { max: LIMITS.bodyText } } : null;
  }

  get waError(): Message | null {
    const length = this.waMessage.trim().length;
    if (!length) return { key: 'validation.waRequired' };
    return length > LIMITS.whatsappMessage ? { key: 'validation.waTooLong', params: { max: LIMITS.whatsappMessage } } : null;
  }

  show(field: keyof QuickSendComponent['touched'], error: Message | null): boolean {
    return (this.touched[field] || this.attempted) && !!error;
  }

  // ---------- Send ----------

  send(): void {
    if (this.sending) return;
    this.attempted = true;
    this.result = null;

    if (this.recipientError || this.emailBlocked) return this.recipientInput?.nativeElement.focus();
    if (this.channel === 'email') {
      if (this.subjectError) return this.subjectInput?.nativeElement.focus();
      if (this.bodyError) return void this.quill?.focus();
    } else if (this.waError) {
      return this.waInput?.nativeElement.focus();
    }

    const name = this.name.trim();
    const to = this.channel === 'whatsapp' ? this.normalizedPhone! : this.email.trim().toLowerCase();
    const channel = this.channel;
    const request: Observable<SendResponse> = channel === 'whatsapp'
      ? this.emailService.sendWhatsApp(this.waMessage.trim(), [{ name, phone: to }], this.lang)
      : this.emailService.sendEmails(this.subject.trim(), this.body, [{ name, email: to }], this.lang);

    this.sending = true;
    request.subscribe({
      next: res => {
        const r = res.results[0];
        this.finish({ channel, to, name, ok: r?.success === true,
          failure: r?.success ? undefined : { reason: r?.reason || 'OTHER', detail: r?.error } });
      },
      error: err => this.finish({ channel, to, name, ok: false,
        failure: err?.status === 0 ? { reason: 'NO_CONNECTION' } : { reason: 'OTHER', detail: err?.error?.message } }),
    });
  }

  private finish(sent: Omit<Sent, 'at'>): void {
    this.sending = false;
    this.result = { ...sent, at: new Date() };
    this.recent = [this.result, ...this.recent].slice(0, RECENT_LIMIT);
    if (sent.ok) {
      // Ready for the next person: clear the recipient, keep the message to reuse it.
      this.name = '';
      this.email = '';
      this.phone = '';
      this.emailIssue = null;
      this.emailChecked = '';
      this.attempted = false;
      this.touched = { email: false, phone: false, subject: false, body: false, wa: false };
    }
  }

  failureText(failure: Failure): string {
    return this.i18n.t(`reason.${failure.reason}` as TranslationKey);
  }

  time(date: Date): string {
    return date.toLocaleTimeString(this.i18n.lang() === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  }
}
