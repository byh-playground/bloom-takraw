import { TAKRAW_INTRO } from '../config/intro.js';

/** 소개영상 대본: 자막 타임라인과 격리 iframe 안의 게임을 다루는 명령. 호스트(게임킷)를 모르는 순수 클래스라 단독으로 시험한다. */
class TakrawIntroScript {
  constructor({ coarse = false, config = TAKRAW_INTRO } = {}) { this.config = config; this.coarse = coarse; }

  /** 자막 한 칸마다 "그 틱까지 기다리기 → 자막 바꾸기" 두 항목을 둔다. 느린 기기에서도 자막이 장면과 어긋나지 않는다. */
  timeline() {
    const { chapters, tickRate } = this.config;
    return [{ atMs: 0, action: 'custom', name: 'watch' }, ...chapters.flatMap((chapter, index) => {
      const atMs = Math.round(chapter.tick * 1000 / tickRate);
      return [
        { atMs, action: 'custom', name: `tick:${chapter.tick}` },
        { atMs, action: 'chapter', index, title: this.words(chapter.title), caption: this.words(chapter.caption) },
      ];
    })];
  }

  words(text) {
    return this.coarse ? this.config.touchWords.reduce((value, [from, to]) => value.replaceAll(from, to), text) : text;
  }

  /** 호스트는 false를 돌려받으면 같은 항목을 다시 시도한다. win은 iframe 창이다. */
  run(name, win) {
    const runtime = win.__takraw;
    if (name === 'watch') return Boolean(runtime?.ready && runtime.watch(this.config.seed));
    if (name.startsWith('tick:')) return (runtime?.game?.state.tick ?? 0) >= Number(name.slice(5));
    return true;
  }
}

export { TakrawIntroScript };
