import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideQuillConfig } from 'ngx-quill/config';
import { AppComponent } from './app/app.component';
import { authInterceptor } from './app/auth/auth.interceptor';
import { EDITOR_FONTS, EDITOR_SIZES } from './app/bulk-email/editor-options';

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(withInterceptors([authInterceptor])),
    // Inline styles (instead of Quill's CSS classes) so formatting survives in email clients.
    provideQuillConfig({
      suppressGlobalRegisterWarning: true,
      // Quill's align picker has no icon for an explicit 'left' value (it expects "no format"),
      // which English emails use; reuse the default left-align icon for it.
      beforeRender: () => import('quill').then(({ default: Quill }) => {
        const icons = Quill.import('ui/icons') as Record<string, Record<string, string>>;
        icons['align']['left'] = icons['align'][''];
      }),
      customOptions: [
        { import: 'attributors/style/font', whitelist: EDITOR_FONTS.map(f => f.value) },
        { import: 'attributors/style/size', whitelist: EDITOR_SIZES },
        { import: 'attributors/style/align', whitelist: ['right', 'center', 'left', 'justify'] },
        { import: 'attributors/style/direction', whitelist: ['rtl'] },
      ],
    }),
  ],
}).catch(err => console.error(err));
