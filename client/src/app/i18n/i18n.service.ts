import { Injectable, computed, effect, signal } from '@angular/core';
import { Language, TRANSLATIONS, TranslationKey } from './translations';

const LANG_KEY = 'bulk-email:lang';

export type Params = Record<string, string | number>;

function storedLanguage(): Language {
  try {
    const value = localStorage.getItem(LANG_KEY);
    return value === 'en' || value === 'ar' ? value : 'ar';
  } catch {
    return 'ar';
  }
}

@Injectable({ providedIn: 'root' })
export class I18nService {
  readonly lang = signal<Language>(storedLanguage());
  readonly dir = computed(() => (this.lang() === 'ar' ? 'rtl' : 'ltr'));

  constructor() {
    // Keep the page's lang/dir/title in sync, so the whole layout flips with the language.
    effect(() => {
      const lang = this.lang();
      document.documentElement.lang = lang;
      document.documentElement.dir = this.dir();
      document.title = this.t('app.name');
      try {
        localStorage.setItem(LANG_KEY, lang);
      } catch {
        // Storage blocked: the choice just won't be remembered.
      }
    });
  }

  toggle(): void {
    this.lang.set(this.lang() === 'ar' ? 'en' : 'ar');
  }

  /** Text in the current UI language. */
  t(key: TranslationKey, params?: Params): string {
    return this.tIn(this.lang(), key, params);
  }

  /** Text in a specific language (e.g. the email's language, which can differ from the UI's). */
  tIn(lang: Language, key: TranslationKey, params?: Params): string {
    const text = TRANSLATIONS[lang][key] ?? key;
    return params ? text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m)) : text;
  }
}
