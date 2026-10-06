import { Component } from '@angular/core';
import { BulkEmailComponent } from './bulk-email/bulk-email.component';
import { LoginComponent } from './auth/login.component';
import { AuthService } from './auth/auth.service';
import { I18nService } from './i18n/i18n.service';
import { ThemeService } from './shared/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [BulkEmailComponent, LoginComponent],
  template: `
    @if (auth.loggedIn()) {
      <app-bulk-email />
    } @else {
      <app-login />
    }
  `,
})
export class AppComponent {
  // Injected here so the page's lang/dir and theme are set before any screen renders.
  constructor(readonly auth: AuthService, i18n: I18nService, theme: ThemeService) {}
}
