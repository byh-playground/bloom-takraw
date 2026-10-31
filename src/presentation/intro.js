import { installShowcase } from '@bloom-gamekit/scenario';
import { TAKRAW_INTRO } from '../config/intro.js';
import { TakrawIntroScript } from './intro-script.js';

/** 소개영상. 게임킷 showcase 호스트가 격리 iframe(?showcaseDemo=1)을 열고, 대본(TakrawIntroScript)이 그 안의 관전 경기를 자막과 맞춘다. */
class TakrawIntro {
  /** @param {{ playSelector: string, launcher: string }} options */
  constructor({ playSelector, launcher }) {
    this.script = new TakrawIntroScript();
    this.handle = installShowcase({
      title: TAKRAW_INTRO.title, launcher, playSelector, durationMs: TAKRAW_INTRO.durationMs,
      ready: win => Boolean(win.__takraw?.ready),
      timeline: this.script.timeline(),
      custom: (name, win) => this.script.run(name, win),
    });
  }

  open() { this.handle?.open(); }
  dispose() { this.handle?.dispose(); this.handle = null; }
}

export { TakrawIntro };
