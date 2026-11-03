import { installShowcase } from '@bloom-gamekit/scenario';
import { TAKRAW_INTRO } from '../config/intro.js';
import { TakrawIntroScript } from './intro-script.js';
import { LOCALE } from '../i18n/locale.js';

/**
 * 소개영상. 게임킷 showcase 호스트가 격리 iframe(?showcaseDemo=1&lang=)을 열고, 대본(TakrawIntroScript)이 그 안의 관전 경기를 자막과 맞춘다.
 * 제목·장 제목(TextPair)은 여기서 페이지 언어로 풀고, 호스트의 조작 문구는 locale로 게임킷이 고른다.
 */
class TakrawIntro {
  /** @param {{ playSelector: string, launcher: string }} options */
  constructor({ playSelector, launcher }) {
    this.script = new TakrawIntroScript();
    this.handle = installShowcase({
      title: LOCALE.text(TAKRAW_INTRO.title), locale: LOCALE.locale, launcher, playSelector, durationMs: TAKRAW_INTRO.durationMs,
      ready: win => Boolean(win.__takraw?.ready),
      timeline: this.script.timeline().map(item => item.action === 'chapter' ? { ...item, title: LOCALE.text(item.title) } : item),
      custom: (name, win) => this.script.run(name, win),
    });
  }

  open() { this.handle?.open(); }
  dispose() { this.handle?.dispose(); this.handle = null; }
}

export { TakrawIntro };
