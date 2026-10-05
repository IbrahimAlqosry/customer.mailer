import { Component, ElementRef, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import {
  LucideAngularModule, ChartColumn, CircleAlert, Eye, EyeOff, FileSpreadsheet, KeyRound, LoaderCircle, Lock, LogIn,
  Languages, Mail, PenLine, ShieldCheck, User,
} from 'lucide-angular';
import { AuthService } from './auth.service';
import { LottieComponent } from '../shared/lottie/lottie.component';
import { SENDING_ANIMATION } from '../shared/lottie/animations';
import { I18nService, Params } from '../i18n/i18n.service';
import { TranslatePipe } from '../i18n/translate.pipe';
import { TranslationKey } from '../i18n/translations';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, LucideAngularModule, LottieComponent, TranslatePipe],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent {
  readonly icons = { ChartColumn, CircleAlert, Eye, EyeOff, FileSpreadsheet, KeyRound, Languages, LoaderCircle, Lock, LogIn, Mail, PenLine, ShieldCheck, User };
  readonly sendingAnimation = SENDING_ANIMATION;
  readonly year = new Date().getFullYear();

  username = '';
  password = '';
  showPassword = false;
  capsLock = false;
  loading = false;
  // Kept as a key so the message follows the language switch.
  error: { key: TranslationKey; params?: Params } | null = null;
  shake = false;

  constructor(private auth: AuthService, readonly i18n: I18nService) {}

  onKey(event: KeyboardEvent): void {
    this.capsLock = event.getModifierState?.('CapsLock') ?? false;
  }

  // Field errors show once a field has been left, or after a submit attempt.
  usernameTouched = false;
  passwordTouched = false;
  attempted = false;
  @ViewChild('usernameInput') private usernameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('passwordInput') private passwordInput?: ElementRef<HTMLInputElement>;

  get showUsernameError(): boolean {
    return (this.usernameTouched || this.attempted) && !this.username.trim();
  }

  get showPasswordError(): boolean {
    return (this.passwordTouched || this.attempted) && !this.password;
  }

  submit(): void {
    if (this.loading) return;
    this.attempted = true;
    if (!this.username.trim() || !this.password) {
      // Inline messages explain what's missing; move focus to the first empty field.
      (this.username.trim() ? this.passwordInput : this.usernameInput)?.nativeElement.focus();
      this.error = null;
      this.shake = false;
      requestAnimationFrame(() => (this.shake = true));
      return;
    }
    this.loading = true;
    this.error = null;
    this.auth.login(this.username.trim(), this.password).subscribe({
      // On success AuthService flips to logged in and the app swaps this page out.
      error: (err: HttpErrorResponse) => {
        this.loading = false;
        this.password = '';
        const code = err.error?.code;
        if (err.status === 0) this.fail('login.connection');
        else if (code === 'TOO_MANY_ATTEMPTS') this.fail('login.tooMany', { minutes: err.error.minutes });
        else if (code === 'INVALID_CREDENTIALS') this.fail('login.invalid');
        else this.fail('login.unexpected');
      },
    });
  }

  private fail(key: TranslationKey, params?: Params): void {
    this.error = { key, params };
    // Restart the shake animation even if the previous one hasn't finished.
    this.shake = false;
    requestAnimationFrame(() => (this.shake = true));
  }
}
