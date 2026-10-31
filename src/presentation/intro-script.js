import { TAKRAW_INTRO } from '../config/intro.js';

/** 소개영상 대본: 문구 타임라인과 격리 iframe 안의 게임을 다루는 명령. 호스트(게임킷)를 모르는 순수 클래스라 단독으로 시험한다. */
class TakrawIntroScript {
  constructor({ config = TAKRAW_INTRO, now = () => performance.now() } = {}) { this.config = config; this.now = now; this.gateAt = null; }

  /**
   * tick 장은 "그 틱까지 기다리기 → 문구 바꾸기" 두 항목을 둔다. 느린 기기에서도 문구가 장면과 어긋나지 않는다.
   * afterMs 장(득점 뒤 시스템 소개)은 "마지막 틱 장이 뜬 뒤 afterMs 기다리기 → 문구 바꾸기"다. 랠리가 다시 시작돼 틱이 되돌아가도 영향이 없다.
   */
  timeline() {
    const { chapters, tickRate } = this.config;
    let lastTickMs = 0;
    return [{ atMs: 0, action: 'custom', name: 'watch' }, ...chapters.flatMap((chapter, index) => {
      const gate = chapter.tick === undefined ? `after:${chapter.afterMs}` : `tick:${chapter.tick}`;
      if (chapter.tick !== undefined) lastTickMs = Math.round(chapter.tick * 1000 / tickRate);
      const atMs = chapter.tick === undefined ? lastTickMs + chapter.afterMs : lastTickMs;
      return [{ atMs, action: 'custom', name: gate }, { atMs, action: 'chapter', index, title: chapter.title, caption: '' }];
    })];
  }

  /** 호스트는 false를 돌려받으면 같은 항목을 다시 시도한다. win은 iframe 창이다. */
  run(name, win) {
    const runtime = win.__takraw;
    if (name === 'watch') return Boolean(runtime?.ready && runtime.watch(this.config.seed));
    if (name.startsWith('tick:')) {
      if ((runtime?.game?.state.tick ?? 0) < Number(name.slice(5))) return false;
      this.gateAt = this.now();
      return true;
    }
    if (name.startsWith('after:')) return this.gateAt !== null && this.now() - this.gateAt >= Number(name.slice(6));
    return true;
  }
}

export { TakrawIntroScript };
