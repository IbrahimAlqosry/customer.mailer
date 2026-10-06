import { Component, NgZone, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { LucideAngularModule, CalendarDays, Clock } from 'lucide-angular';
import { I18nService } from '../i18n/i18n.service';

// Current date and time in the UI language, e.g. "الثلاثاء 6 أكتوبر 2026 · 11:42 ص".
// Updates on each minute boundary rather than every second, so it costs one tick a minute.
@Component({
  selector: 'app-clock',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <time class="clock" [attr.datetime]="iso()">
      <span class="part date">
        <lucide-icon [img]="icons.CalendarDays" [size]="15" />
        <span class="weekday">{{ weekday() }}</span>{{ date() }}
      </span>
      <span class="part time"><lucide-icon [img]="icons.Clock" [size]="15" /> {{ time() }}</span>
    </time>
  `,
  styles: [`
    :host { display: inline-flex; }
    .clock { display: inline-flex; align-items: center; gap: 12px; font-size: 13px; font-weight: 600; white-space: nowrap; }
    .part { display: inline-flex; align-items: center; gap: 6px; }
    .time { font-variant-numeric: tabular-nums; }
    lucide-icon { display: inline-flex; opacity: 0.85; }
    /* Small laptops: the weekday is dropped to make room in the header. */
    @media (min-width: 1001px) and (max-width: 1240px) { .weekday { display: none; } }
  `],
})
export class ClockComponent implements OnInit, OnDestroy {
  readonly icons = { CalendarDays, Clock };
  private readonly now = signal(new Date());
  private timer?: ReturnType<typeof setTimeout>;

  // Western digits in Arabic too, to match the rest of the app.
  private readonly locale = computed(() => (this.i18n.lang() === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB'));
  // "الثلاثاء،" / "Tuesday," (the flex gap adds the space) — separate from the date so small screens can hide it.
  readonly weekday = computed(() =>
    this.now().toLocaleDateString(this.locale(), { weekday: 'long' }) + (this.i18n.lang() === 'ar' ? '،' : ','));
  readonly date = computed(() =>
    this.now().toLocaleDateString(this.locale(), { day: 'numeric', month: 'long', year: 'numeric' }));
  readonly time = computed(() =>
    this.now().toLocaleTimeString(this.i18n.lang() === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', { hour: 'numeric', minute: '2-digit' }));
  readonly iso = computed(() => this.now().toISOString());

  constructor(private i18n: I18nService, private zone: NgZone) {}

  ngOnInit(): void {
    this.schedule();
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }

  private schedule(): void {
    const msToNextMinute = 60_000 - (Date.now() % 60_000) + 50;
    // The wait runs outside Angular; only the actual update triggers a refresh.
    this.zone.runOutsideAngular(() => {
      this.timer = setTimeout(() => this.zone.run(() => {
        this.now.set(new Date());
        this.schedule();
      }), msToNextMinute);
    });
  }
}
