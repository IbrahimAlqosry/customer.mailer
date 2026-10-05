import { AfterViewInit, Component, ElementRef, Input, NgZone, OnChanges, OnDestroy, SimpleChanges, ViewChild } from '@angular/core';
import lottie, { AnimationItem } from 'lottie-web/build/player/lottie_light';

@Component({
  selector: 'app-lottie',
  standalone: true,
  template: `<div #host class="host"></div>`,
  styles: [':host { display: block; } .host { width: 100%; height: 100%; }'],
})
export class LottieComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) data!: object;
  @Input() loop = false;
  @ViewChild('host', { static: true }) host!: ElementRef<HTMLDivElement>;

  private animation?: AnimationItem;

  constructor(private zone: NgZone) {}

  ngAfterViewInit(): void {
    this.play();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data'] && !changes['data'].firstChange) this.play();
  }

  ngOnDestroy(): void {
    this.animation?.destroy();
  }

  private play(): void {
    this.animation?.destroy();
    // Run outside Angular so the animation frames don't trigger change detection.
    this.zone.runOutsideAngular(() => {
      this.animation = lottie.loadAnimation({
        container: this.host.nativeElement,
        renderer: 'svg',
        loop: this.loop,
        autoplay: true,
        animationData: structuredClone(this.data), // lottie mutates the data it is given
      });
    });
  }
}
