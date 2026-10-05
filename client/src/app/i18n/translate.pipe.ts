import { Pipe, PipeTransform } from '@angular/core';
import { I18nService, Params } from './i18n.service';
import { TranslationKey } from './translations';

// Impure so text updates as soon as the language changes; a lookup is cheap enough to run every check.
@Pipe({ name: 't', standalone: true, pure: false })
export class TranslatePipe implements PipeTransform {
  constructor(private i18n: I18nService) {}

  // Accepts plain strings too, for keys built in templates like ('status.' + row.status).
  transform(key: TranslationKey | string, params?: Params): string {
    return this.i18n.t(key as TranslationKey, params);
  }
}
