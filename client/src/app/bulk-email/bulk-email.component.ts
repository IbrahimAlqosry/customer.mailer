import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription, catchError, concatMap, from, map, of } from 'rxjs';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { QuillEditorComponent } from 'ngx-quill';
import type Quill from 'quill';
import {
  LucideAngularModule, CircleCheck, CircleX, Clock, CloudUpload, Download, FileSpreadsheet, Mail, PenLine,
  RotateCcw, Search, Send, Sparkles, Trash2, Users, X, CircleStop, TriangleAlert, Eye, LoaderCircle, LogOut, Languages,
  ShieldAlert, Undo2, Wand, MailX, RefreshCw, MessageCircle, Phone, User, Moon, Sun,
} from 'lucide-angular';
import * as XLSX from 'xlsx';
import { Channel, Customer, EmailIssue, EmailService, ServerStatus } from './email.service';
import { readCustomers } from './excel-reader';
import { clearState, loadState, saveState } from './saved-state';
import { EDITOR_FONTS, EDITOR_SIZES } from './editor-options';
import { LottieComponent } from '../shared/lottie/lottie.component';
import { QuickSendComponent } from '../quick-send/quick-send.component';
import { ClockComponent } from '../shared/clock.component';
import { ThemeService } from '../shared/theme.service';
import { AuthService } from '../auth/auth.service';
import { I18nService, Params } from '../i18n/i18n.service';
import { ACCEPTED_FILE, LIMITS } from './validation';
import { TranslatePipe } from '../i18n/translate.pipe';
import { LANGUAGE_NAMES, Language, TranslationKey } from '../i18n/translations';
import { ERROR_ANIMATION, SENDING_ANIMATION, SUCCESS_ANIMATION, WARNING_ANIMATION } from '../shared/lottie/animations';

type Status = 'pending' | 'sending' | 'sent' | 'failed' | 'bounced';
// The two screens: sending to a whole file, or one message to one person.
type View = 'bulk' | 'single';
const VIEW_KEY = 'bulk-email:view';
type Filter = 'all' | 'sent' | 'failed' | 'pending' | 'issues';

interface Failure {
  reason: string;  // shown translated as 'reason.<code>'
  detail?: string; // the mail server's exact reply, e.g. "550 relaying denied"
}

interface Row extends Customer {
  status: Status;
  failure?: Failure;
  sentAt?: Date;
  // Problem found by the pre-send check. Rows with an issue are not sent until it's resolved.
  issue?: EmailIssue;
  checked?: boolean;
}

interface ConfirmDialog {
  title: string;
  message: string;
  note?: string;
  confirmText: string;
  tone: 'primary' | 'danger';
  icon: typeof Send; // any lucide icon
  action: () => void;
}

interface Message {
  key: TranslationKey;
  params?: Params;
}

interface Run {
  total: number;
  sent: number;
  failed: number;
  // Set when the mail server reported our sending limit (per hour/day) and the run was stopped.
  limit?: { detail?: string };
}

const VERIFY_CHUNK = 500;
// Bounces arrive seconds to minutes after sending; check a few times after each run.
const BOUNCE_CHECKS_MS = [30_000, 90_000, 180_000, 300_000];

@Component({
  selector: 'app-bulk-email',
  standalone: true,
  imports: [FormsModule, QuillEditorComponent, LucideAngularModule, LottieComponent, TranslatePipe, QuickSendComponent, ClockComponent],
  templateUrl: './bulk-email.component.html',
  styleUrl: './bulk-email.component.css',
})
export class BulkEmailComponent implements OnInit, OnDestroy {
  readonly icons = {
    CircleCheck, CircleX, Clock, CloudUpload, Download, FileSpreadsheet, Mail, PenLine,
    RotateCcw, Search, Send, Sparkles, Trash2, Users, X, CircleStop, TriangleAlert, Eye, LoaderCircle, LogOut, Languages,
    ShieldAlert, Undo2, Wand, MailX, RefreshCw, MessageCircle, Phone, User, Moon, Sun,
  };
  readonly fonts = EDITOR_FONTS;
  readonly sizes = EDITOR_SIZES;
  readonly sendingAnimation = SENDING_ANIMATION;
  readonly languages: Language[] = ['ar', 'en'];
  readonly languageNames = LANGUAGE_NAMES;

  server: ServerStatus | null = null;
  serverDown = false;
  view: View = readView();

  rows: Row[] = [];
  skipped = 0;
  fileName = '';
  dragging = false;

  // Pre-send address check
  verifying = false;
  verifyFailed = false;
  private verifySub?: Subscription;

  // Bounce tracking after sending
  bounceChecking = false;
  bounceUnavailable = false;
  lastBounceCheck: Date | null = null;
  private bounceTimers: ReturnType<typeof setTimeout>[] = [];

  subject = '';
  body = '';      // HTML from the editor
  bodyText = '';  // plain text, used to check the body isn't empty
  previewHtml: SafeHtml = '';
  // Language of the message customers receive. Independent of the UI language.
  emailLang: Language;
  // How customers are contacted. WhatsApp sends plain text (waMessage) to the phone column.
  channel: Channel = 'email';
  waMessage = '';
  waTouched = false;
  private quill?: Quill;

  filter: Filter = 'all';
  search = '';

  sending = false;
  showModal = false;
  run: Run | null = null;
  current: Row | null = null;
  // Messages are stored as keys so they follow the UI language if it changes.
  fileError: Message | null = null;
  readonly limits = LIMITS;
  // Field errors show once the field has been left, or after a send attempt.
  subjectTouched = false;
  bodyTouched = false;
  attempted = false;
  @ViewChild('subjectInput') private subjectInput?: ElementRef<HTMLInputElement>;
  @ViewChild('waInput') private waInput?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('fileSection') private fileSection?: ElementRef<HTMLElement>;
  private sendSub?: Subscription;

  constructor(
    private emailService: EmailService,
    private sanitizer: DomSanitizer,
    readonly auth: AuthService,
    readonly i18n: I18nService,
    readonly theme: ThemeService,
  ) {
    this.emailLang = i18n.lang();
  }

  ngOnInit(): void {
    this.emailService.status().subscribe({
      next: s => (this.server = s),
      error: () => (this.serverDown = true),
    });
    this.restore();
  }

  ngOnDestroy(): void {
    this.sendSub?.unsubscribe();
    this.verifySub?.unsubscribe();
    this.clearBounceTimers();
  }

  setView(view: View): void {
    this.view = view;
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // Storage blocked: the choice just won't be remembered.
    }
  }

  logout(): void {
    const t = this.i18n.t.bind(this.i18n);
    const unsent = this.waiting + this.count('failed');
    this.confirmDialog = {
      title: t('confirm.logoutTitle'),
      message: t(this.sending ? 'confirm.logoutMessageSending' : 'confirm.logoutMessage'),
      note: unsent > 0 ? t('confirm.logoutNote', { n: unsent }) : undefined,
      confirmText: t('header.logout'),
      tone: 'danger',
      icon: this.icons.LogOut,
      action: () => {
        if (this.sending) this.stop();
        this.auth.logout();
      },
    };
  }

  // ---------- Confirm dialog ----------

  confirmDialog: ConfirmDialog | null = null;

  // Focus the confirm button when the dialog opens, so Enter confirms and Esc cancels.
  @ViewChild('confirmButton') set confirmButton(button: ElementRef<HTMLButtonElement> | undefined) {
    button?.nativeElement.focus();
  }

  confirm(): void {
    const dialog = this.confirmDialog;
    this.confirmDialog = null;
    dialog?.action();
  }

  @HostListener('document:keydown.escape')
  cancelConfirm(): void {
    this.confirmDialog = null;
  }

  // ---------- File ----------

  onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.loadFile(file);
    input.value = '';
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging = false;
    const file = event.dataTransfer?.files?.[0];
    if (file && !this.sending) this.loadFile(file);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging = true;
  }

  private loadFile(file: File): void {
    this.clearFile();
    if (!ACCEPTED_FILE.test(file.name)) return this.rejectFile('validation.fileType');
    if (file.size === 0) return this.rejectFile('validation.fileEmpty');
    if (file.size > LIMITS.fileMb * 1024 * 1024) return this.rejectFile('validation.fileSize', { max: LIMITS.fileMb });

    const reader = new FileReader();
    reader.onload = () => {
      let result: ReturnType<typeof readCustomers>;
      try {
        result = readCustomers(reader.result as ArrayBuffer, file.name);
      } catch {
        return this.rejectFile('error.readFailed');
      }
      if (result.customers.length === 0) return this.rejectFile('error.noCustomers');
      if (result.customers.length > LIMITS.recipients) {
        return this.rejectFile('validation.tooManyRows', { n: result.customers.length, max: LIMITS.recipients });
      }
      this.fileName = file.name;
      this.rows = result.customers.map(c => ({ ...c, status: 'pending' }));
      this.skipped = result.skipped;
      // A file with only phone numbers (or only emails) chooses its channel by itself.
      const hasEmail = this.rows.some(r => r.email);
      const hasPhone = this.rows.some(r => r.phone);
      if (!hasEmail && hasPhone && this.whatsappReady) this.channel = 'whatsapp';
      else if (hasEmail && !hasPhone) this.channel = 'email';
      this.persist();
      this.verifyRows(this.rows);
    };
    reader.onerror = () => this.rejectFile('error.openFailed');
    reader.readAsArrayBuffer(file);
  }

  // A rejected file leaves the drop zone in place so the user can pick another one.
  private rejectFile(key: TranslationKey, params?: Params): void {
    this.fileName = '';
    this.rows = [];
    this.fileError = { key, params };
  }

  clearFile(): void {
    this.verifySub?.unsubscribe();
    this.verifying = false;
    this.verifyFailed = false;
    this.clearBounceTimers();
    this.lastBounceCheck = null;
    this.bounceUnavailable = false;
    this.rows = [];
    this.skipped = 0;
    this.fileName = '';
    this.run = null;
    this.fileError = null;
    this.filter = 'all';
    clearState();
  }

  removeRow(row: Row): void {
    this.rows = this.rows.filter(r => r !== row);
    this.persist();
  }

  // ---------- Pre-send address check ----------

  // Asks the server about each address (domain accepts mail, disposable, fake, likely typo).
  // If the check itself fails (e.g. offline), the addresses stay sendable rather than blocked.
  verifyRows(rows: Row[]): void {
    const pending = rows.filter(r => r.email && !r.checked);
    if (pending.length === 0) return;
    this.verifySub?.unsubscribe();
    this.verifying = true;
    this.verifyFailed = false;

    const chunks: Row[][] = [];
    for (let i = 0; i < pending.length; i += VERIFY_CHUNK) chunks.push(pending.slice(i, i + VERIFY_CHUNK));

    this.verifySub = from(chunks)
      .pipe(concatMap(chunk => this.emailService.verifyEmails(chunk.map(r => r.email)).pipe(map(res => ({ chunk, res })))))
      .subscribe({
        next: ({ chunk, res }) => {
          chunk.forEach((row, i) => {
            const result = res.results[i];
            row.checked = true;
            row.issue = result && !result.valid && result.code
              ? { code: result.code, severity: result.severity ?? 'error', suggestion: result.suggestion }
              : undefined;
          });
          this.persist();
        },
        error: () => {
          this.verifying = false;
          this.verifyFailed = true;
        },
        complete: () => {
          this.verifying = false;
          if (this.issueCount > 0 && !this.sending) this.filter = 'issues';
        },
      });
  }

  retryVerify(): void {
    this.verifyRows(this.rows);
  }

  // Replaces a likely typo with the suggested address (e.g. kmail.com -> gmail.com) and re-checks it.
  applySuggestion(row: Row): void {
    const suggestion = row.issue?.suggestion;
    if (!suggestion) return;
    if (this.rows.some(r => r !== row && r.email === suggestion)) {
      this.removeRow(row); // the corrected address is already in the list
      return;
    }
    row.email = suggestion;
    row.issue = undefined;
    row.checked = false;
    this.persist();
    this.verifyRows([row]);
  }

  // The user confirms a flagged address is correct; it will be sent.
  keepAddress(row: Row): void {
    row.issue = undefined;
    this.persist();
  }

  removeInvalid(): void {
    this.rows = this.rows.filter(r => this.problem(r)?.severity !== 'error');
    if (this.filter === 'issues' && this.issueCount === 0) this.filter = 'all';
    this.persist();
  }

  issueLabel(issue: EmailIssue): string {
    return this.i18n.t(`issue.${issue.code}` as TranslationKey);
  }

  // ---------- Bounce tracking ----------

  private clearBounceTimers(): void {
    this.bounceTimers.forEach(clearTimeout);
    this.bounceTimers = [];
  }

  private scheduleBounceChecks(): void {
    this.clearBounceTimers();
    this.bounceTimers = BOUNCE_CHECKS_MS.map(ms => setTimeout(() => this.checkBounces(), ms));
  }

  // Reads delivery failures reported to the sender's inbox and marks those rows as bounced.
  checkBounces(): void {
    const sent = this.rows.filter(r => r.status === 'sent' && r.sentAt);
    if (sent.length === 0 || this.bounceChecking) return;
    const since = new Date(Math.min(...sent.map(r => r.sentAt!.getTime())) - 60_000);
    this.bounceChecking = true;
    this.emailService.checkBounces(since, sent.map(r => r.email)).subscribe({
      next: ({ bounces, checkedAt }) => {
        for (const bounce of bounces) {
          const row = this.rows.find(r => r.email === bounce.email && r.status === 'sent');
          if (!row) continue;
          row.status = 'bounced';
          row.failure = { reason: bounce.reason, detail: bounce.detail ?? undefined };
        }
        this.lastBounceCheck = new Date(checkedAt);
        this.bounceUnavailable = false;
        this.bounceChecking = false;
        if (bounces.length > 0 && !this.sending) this.filter = 'failed';
        this.persist();
      },
      error: () => {
        this.bounceChecking = false;
        this.bounceUnavailable = true;
      },
    });
  }

  get bounceCount(): number {
    return this.count('bounced');
  }

  get lastBounceCheckTime(): string {
    return this.lastBounceCheck?.toLocaleTimeString(this.i18n.lang() === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { hour: '2-digit', minute: '2-digit' }) ?? '';
  }

  // ---------- Saved state (survives a page reload) ----------

  // Saved while any customer is still unsent (pending, failed, bounced or flagged). Once everyone
  // is sent the storage is cleared, but the table stays on screen until the file is changed or removed.
  persist(): void {
    if (this.rows.length === 0 || this.rows.every(r => r.status === 'sent')) {
      clearState();
      return;
    }
    saveState({
      fileName: this.fileName,
      skipped: this.skipped,
      subject: this.subject,
      body: this.body,
      emailLang: this.emailLang,
      channel: this.channel,
      waMessage: this.waMessage,
      rows: this.rows.map(r => ({ ...r, sentAt: r.sentAt?.toISOString() })),
      run: this.run,
    });
  }

  private restore(): void {
    const saved = loadState();
    if (!saved) return;
    this.fileName = saved.fileName;
    this.skipped = saved.skipped;
    this.subject = saved.subject;
    this.body = saved.body;
    this.emailLang = saved.emailLang ?? 'ar';
    this.channel = saved.channel ?? 'email';
    this.waMessage = saved.waMessage ?? '';
    this.run = saved.run;
    this.rows = saved.rows.map(({ error, ...r }) => ({
      ...r,
      // A row that was mid-send when the page closed didn't get a result: send it again.
      status: r.status === 'sending' ? 'pending' : r.status,
      failure: r.failure ?? (error ? { reason: 'OTHER', detail: error } : undefined),
      issue: r.issue as EmailIssue | undefined,
      sentAt: r.sentAt ? new Date(r.sentAt) : undefined,
    }));
    // The editor doesn't report restored content, so fill these in directly.
    this.bodyText = (new DOMParser().parseFromString(this.body, 'text/html').body.textContent ?? '').trim();
    this.previewHtml = this.sanitizer.bypassSecurityTrustHtml(this.body);
    // Lists saved before address checking existed get checked now.
    this.verifyRows(this.rows);
  }

  // ---------- Stats / filtering ----------

  count(status: Status): number {
    return this.rows.filter(r => r.status === status).length;
  }

  // What stops a customer from being sent on the current channel: no email / no phone, or the
  // pre-send email check (email channel only). Null when the customer can be sent to.
  problem(row: Row): EmailIssue | null {
    if (this.channel === 'whatsapp') return row.phone ? null : { code: 'NO_PHONE', severity: 'error' };
    if (!row.email) return { code: 'NO_EMAIL', severity: 'error' };
    return row.issue ?? null;
  }

  isSendable(row: Row): boolean {
    return row.status === 'pending' && !this.problem(row);
  }

  contact(row: Row): string {
    return (this.channel === 'whatsapp' ? row.phone : row.email) || '—';
  }

  get sendableCount(): number {
    return this.rows.filter(r => this.isSendable(r)).length;
  }

  get issueCount(): number {
    return this.rows.filter(r => this.problem(r)).length;
  }

  get invalidCount(): number {
    return this.rows.filter(r => this.problem(r)?.severity === 'error').length;
  }

  get reviewCount(): number {
    return this.rows.filter(r => this.problem(r)?.severity === 'warning').length;
  }

  get failedCount(): number {
    return this.count('failed') + this.count('bounced');
  }

  get waiting(): number {
    return this.sendableCount + this.count('sending');
  }

  // The badge shown for a row: its send status, or the check result while it isn't sendable.
  displayStatus(row: Row): string {
    const problem = row.status === 'pending' ? this.problem(row) : null;
    if (problem) return problem.severity === 'error' ? 'invalid' : 'review';
    return row.status;
  }

  get runProgress(): number {
    if (!this.run || this.run.total === 0) return 0;
    return Math.round(((this.run.sent + this.run.failed) / this.run.total) * 100);
  }

  get visibleRows(): Row[] {
    const q = this.search.trim().toLowerCase();
    return this.rows.filter(r => {
      if (this.filter === 'pending' && !(this.isSendable(r) || r.status === 'sending')) return false;
      if (this.filter === 'sent' && r.status !== 'sent') return false;
      if (this.filter === 'failed' && r.status !== 'failed' && r.status !== 'bounced') return false;
      if (this.filter === 'issues' && !this.problem(r)) return false;
      return !q || r.name.toLowerCase().includes(q) || r.email.includes(q) || (r.phone ?? '').includes(q);
    });
  }

  get resultAnimation(): object {
    if (this.run?.limit) return WARNING_ANIMATION;
    if (!this.run || this.run.sent === 0) return ERROR_ANIMATION;
    return this.run.failed > 0 ? WARNING_ANIMATION : SUCCESS_ANIMATION;
  }

  get resultTitleKey(): TranslationKey {
    if (this.run?.limit) return 'limit.title';
    if (!this.run || this.run.sent === 0) return 'modal.resultNone';
    return this.run.failed > 0 ? 'modal.resultPartial' : 'modal.resultSuccess';
  }

  // ---------- Channel ----------

  get whatsappReady(): boolean {
    return !!this.server?.whatsappReady;
  }

  // Switching channel starts a new round: statuses from the other channel would be misleading.
  setChannel(channel: Channel): void {
    if (channel === this.channel || this.sending) return;
    if (channel === 'whatsapp' && !this.whatsappReady) return;
    const apply = () => {
      this.channel = channel;
      for (const r of this.rows) {
        if (r.status !== 'pending') { r.status = 'pending'; r.failure = undefined; r.sentAt = undefined; }
      }
      this.run = null;
      this.clearBounceTimers();
      this.lastBounceCheck = null;
      this.attempted = false;
      this.filter = this.issueCount > 0 ? 'issues' : 'all';
      this.persist();
    };
    if (!this.rows.some(r => r.status !== 'pending')) return apply();
    const t = this.i18n.t.bind(this.i18n);
    this.confirmDialog = {
      title: t('channel.switchTitle'),
      message: t('channel.switchMessage'),
      note: t('channel.switchNote'),
      confirmText: t('channel.switchConfirm'),
      tone: 'primary',
      icon: channel === 'whatsapp' ? this.icons.MessageCircle : this.icons.Mail,
      action: apply,
    };
  }

  // WhatsApp preview for the first customer, with the name filled in like the server does.
  // The first customer who has a phone, as the WhatsApp preview's example.
  private get waSampleName(): string | undefined {
    return this.rows.find(r => r.phone)?.name || this.rows[0]?.name;
  }

  get waGreeting(): string {
    return this.greetingFor(this.waSampleName);
  }

  get waPreview(): string {
    return this.waMessage.replace(/\{\s*(name|الاسم)\s*\}/gi, this.waSampleName || this.i18n.t('recipients.name'));
  }

  insertWaName(textarea: HTMLTextAreaElement): void {
    const token = this.emailLang === 'ar' ? '{الاسم}' : '{name}';
    const start = textarea.selectionStart ?? this.waMessage.length;
    const end = textarea.selectionEnd ?? start;
    this.waMessage = this.waMessage.slice(0, start) + token + this.waMessage.slice(end);
    this.persist();
    setTimeout(() => { textarea.focus(); textarea.setSelectionRange(start + token.length, start + token.length); });
  }

  // ---------- Email language ----------

  get emailDir(): 'rtl' | 'ltr' {
    return this.emailLang === 'ar' ? 'rtl' : 'ltr';
  }

  // Must match the greeting the server adds (server/email-template.js).
  get previewGreeting(): string {
    return this.greetingFor(this.rows[0]?.name);
  }

  // Same wording as the server's greeting(), used by both email and WhatsApp.
  private greetingFor(name: string | undefined): string {
    if (this.emailLang === 'en') return name ? `Dear ${name},` : 'Dear Customer,';
    return name ? `عزيزي العميل / ${name}` : 'عزيزي العميل';
  }

  setEmailLang(lang: Language): void {
    if (lang === this.emailLang || this.sending) return;
    this.emailLang = lang;
    if (this.quill) this.applyEmailDirection(this.quill);
    this.persist();
  }

  // Flips every line to the email language's direction. Centered/justified lines keep their alignment.
  private applyEmailDirection(quill: Quill): void {
    const rtl = this.emailLang === 'ar';
    for (const line of quill.getLines()) {
      const align = line.formats()['align'];
      quill.formatLine(quill.getIndex(line), 1, {
        direction: rtl ? 'rtl' : false,
        align: align === 'center' || align === 'justify' ? align : rtl ? 'right' : 'left',
      }, 'user');
    }
  }

  // ---------- Editor ----------

  onEditorCreated(quill: Quill): void {
    this.quill = quill;
    if (quill.getLength() > 1) return; // restored content keeps its own formatting
    // Start a new message in the email language's direction. (formatLine doesn't move focus,
    // unlike quill.format(), which would scroll the page to the editor on load.)
    this.applyEmailDirection(quill);
  }

  onEditorChanged(event: { text: string; html: string | null }): void {
    this.bodyText = event.text.trim();
    // The editor's own HTML: bypass Angular's sanitizer so inline font/size/color styles show in the preview.
    this.previewHtml = this.sanitizer.bypassSecurityTrustHtml(event.html ?? '');
    this.persist();
  }

  // ---------- Validation ----------

  get subjectLength(): number {
    return this.subject.trim().length;
  }

  get recipientsError(): Message | null {
    if (this.rows.length === 0) return this.fileError ? null : { key: 'validation.fileRequired' };
    if (this.verifying) return { key: 'validation.verifying' };
    if (this.sendableCount > 0) return null;
    return this.count('pending') > 0 ? { key: 'validation.noSendable' } : { key: 'validation.noPending' };
  }

  get subjectError(): Message | null {
    if (!this.subjectLength) return { key: 'validation.subjectRequired' };
    return this.subjectLength > LIMITS.subject ? { key: 'validation.subjectTooLong', params: { max: LIMITS.subject } } : null;
  }

  get bodyError(): Message | null {
    if (!this.bodyText) return { key: 'validation.bodyRequired' };
    const tooLong = this.bodyText.length > LIMITS.bodyText || this.body.length > LIMITS.bodyHtml;
    return tooLong ? { key: 'validation.bodyTooLong', params: { max: LIMITS.bodyText } } : null;
  }

  get waError(): Message | null {
    const text = this.waMessage.trim();
    if (!text) return { key: 'validation.waRequired' };
    return text.length > LIMITS.whatsappMessage ? { key: 'validation.waTooLong', params: { max: LIMITS.whatsappMessage } } : null;
  }

  get showWaError(): boolean {
    return (this.waTouched || this.attempted) && !!this.waError;
  }

  // A rejected file always shows; "no file / nothing left to send" only after a send attempt.
  get fileMessage(): Message | null {
    return this.fileError ?? (this.attempted ? this.recipientsError : null);
  }

  get showSubjectError(): boolean {
    return (this.subjectTouched || this.attempted) && !!this.subjectError;
  }

  get showBodyError(): boolean {
    return (this.bodyTouched || this.attempted) && !!this.bodyError;
  }

  // Marks every field as checked and moves the user to the first problem.
  private validateForSend(): boolean {
    this.attempted = true;
    if (this.recipientsError || this.fileError) {
      this.fileSection?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
    if (this.channel === 'whatsapp') {
      if (this.waError) {
        this.waInput?.nativeElement.focus();
        return false;
      }
      return true;
    }
    if (this.subjectError) {
      this.subjectInput?.nativeElement.focus();
      return false;
    }
    if (this.bodyError) {
      this.quill?.focus();
      return false;
    }
    return true;
  }

  // ---------- Sending ----------

  send(): void {
    const t = this.i18n.t.bind(this.i18n);
    if (this.sending || !this.validateForSend()) return;
    const targets = this.rows.filter(r => this.isSendable(r));
    const excluded = this.rows.filter(r => r.status === 'pending' && this.problem(r)).length;
    const notes = [t('confirm.sendNote')];
    if (excluded > 0) notes.unshift(t('confirm.sendExcluded', { n: excluded }));
    this.confirmDialog = {
      title: t('confirm.sendTitle'),
      message: this.channel === 'whatsapp'
        ? t('confirm.waMessage', { n: targets.length })
        : `${t('confirm.sendMessage', { n: targets.length, subject: this.subject.trim() })} ${t('confirm.sendLanguage', { language: LANGUAGE_NAMES[this.emailLang] })}`,
      note: this.channel === 'whatsapp' ? notes.slice(0, -1).concat(t('confirm.waNote')).join(' ') : notes.join(' '),
      confirmText: t(this.channel === 'whatsapp' ? 'compose.sendWaTo' : 'compose.sendTo', { n: targets.length }),
      tone: 'primary',
      icon: this.channel === 'whatsapp' ? this.icons.MessageCircle : this.icons.Send,
      action: () => this.sendTo(targets),
    };
  }

  retryFailed(): void {
    const t = this.i18n.t.bind(this.i18n);
    // Send-time failures can be retried; bounced addresses are known not to work.
    const targets = this.rows.filter(r => r.status === 'failed');
    if (this.sending || targets.length === 0) return;
    this.showModal = false; // the results modal sits below the dialog; close it so only one is visible
    this.confirmDialog = {
      title: t('confirm.retryTitle'),
      message: t('confirm.retryMessage', { n: targets.length }),
      note: t('confirm.retryNote'),
      confirmText: t('confirm.retryConfirm', { n: targets.length }),
      tone: 'primary',
      icon: this.icons.RotateCcw,
      action: () => {
        targets.forEach(r => { r.status = 'pending'; r.failure = undefined; });
        this.sendTo(targets);
      },
    };
  }

  stop(): void {
    this.sendSub?.unsubscribe();
    this.rows.filter(r => r.status === 'sending').forEach(r => (r.status = 'pending'));
    this.finishRun();
  }

  closeModal(): void {
    this.showModal = false;
  }

  showDetails(filter: Filter): void {
    this.filter = filter;
    this.showModal = false;
  }

  // One request per customer, one after another, so each row updates live.
  private sendTo(targets: Row[]): void {
    const subject = this.subject.trim();
    const body = this.body;
    const language = this.emailLang;
    const channel = this.channel;
    const waMessage = this.waMessage.trim();
    this.sending = true;
    this.showModal = true;
    this.attempted = false; // the attempt succeeded; don't keep showing "nothing left to send" afterwards
    this.filter = 'all';
    this.run = { total: targets.length, sent: 0, failed: 0 };

    this.sendSub = from(targets)
      .pipe(
        concatMap(row => {
          row.status = 'sending';
          this.current = row;
          const request = channel === 'whatsapp'
            ? this.emailService.sendWhatsApp(waMessage, [{ name: row.name, phone: row.phone ?? '' }], language)
            : this.emailService.sendEmails(subject, body, [{ name: row.name, email: row.email }], language);
          return request.pipe(
            map(res => {
              const result = res.results[0];
              const failure: Failure | undefined = result?.success
                ? undefined
                : { reason: result?.reason || 'OTHER', detail: result?.error };
              return { row, ok: result?.success === true, failure };
            }),
            catchError(err => of({
              row,
              ok: false,
              failure: err?.status === 0
                ? { reason: 'NO_CONNECTION' }
                : { reason: 'OTHER', detail: err?.error?.message as string | undefined },
            })),
          );
        }),
      )
      .subscribe({
        next: ({ row, ok, failure }) => {
          // The account's sending limit was reached: every remaining email would fail the same way.
          // Stop here and keep this customer (and the rest) as "not sent" so the next send continues.
          if (!ok && failure?.reason === 'RATE_LIMIT') {
            row.status = 'pending';
            row.failure = undefined;
            if (this.run) this.run.limit = { detail: failure.detail };
            this.sendSub?.unsubscribe();
            this.finishRun();
            return;
          }
          row.status = ok ? 'sent' : 'failed';
          row.failure = failure;
          row.sentAt = new Date();
          if (this.run) ok ? this.run.sent++ : this.run.failed++;
          this.persist();
        },
        complete: () => this.finishRun(),
      });
  }

  private finishRun(): void {
    this.sending = false;
    this.current = null;
    if (this.failedCount > 0) this.filter = 'failed';
    this.persist();
    // Bounce reports only exist for email.
    if (this.channel === 'email' && this.count('sent') > 0) this.scheduleBounceChecks();
  }

  // ---------- Report ----------

  failureText(failure: Failure): string {
    return this.i18n.t(`reason.${failure.reason}` as TranslationKey);
  }

  exportReport(): void {
    const t = this.i18n.t.bind(this.i18n);
    const rtl = this.i18n.lang() === 'ar';
    const data = this.rows.map((r, i) => ({
      '#': i + 1,
      [t('report.name')]: r.name,
      [t('report.email')]: r.email,
      [t('report.phone')]: r.phone ?? '',
      [t('report.status')]: t(`status.${this.displayStatus(r)}` as TranslationKey),
      [t('report.error')]: r.failure ? this.failureText(r.failure) : this.problem(r) ? this.issueLabel(this.problem(r)!) : '',
      [t('report.detail')]: r.failure?.detail ?? (this.problem(r)?.suggestion ? t('issue.suggest', { email: this.problem(r)!.suggestion! }) : ''),
      [t('report.sentAt')]: r.sentAt ? r.sentAt.toLocaleString(rtl ? 'ar-EG-u-nu-latn' : 'en-GB') : '',
    }));
    const sheet = XLSX.utils.json_to_sheet(data);
    sheet['!cols'] = [{ wch: 5 }, { wch: 28 }, { wch: 34 }, { wch: 18 }, { wch: 14 }, { wch: 36 }, { wch: 44 }, { wch: 22 }];
    const book = XLSX.utils.book_new();
    book.Workbook = { Views: [{ RTL: rtl }] };
    XLSX.utils.book_append_sheet(book, sheet, t('report.sheet'));
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    XLSX.writeFile(book, `${t('report.file')}-${stamp}.xlsx`);
  }
}

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'single' ? 'single' : 'bulk';
  } catch {
    return 'bulk';
  }
}
