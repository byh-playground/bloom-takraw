import { TAKRAW_INTRO } from '../config/intro.js';

/** 소개영상 대본: 문구 타임라인과 격리 iframe 안의 게임을 다루는 명령. 호스트(게임킷)를 모르는 순수 클래스라 단독으로 시험한다. */
class TakrawIntroScript {
  constructor({ config = TAKRAW_INTRO, now = () => performance.now() } = {}) { this.config = config; this.now = now; this.gateAt = null; }

  /**
   * tick 장은 "그 틱까지 기다리기 → 문구 바꾸기" 두 항목을 둔다. 느린 기기에서도 문구가 장면과 어긋나지 않는다.
   * afterMs 장(득점 뒤 시스템 소개)은 "바로 앞 장이 뜬 뒤 afterMs 기다리기 → 문구 바꾸기"다. 랠리가 다시 시작돼 틱이 되돌아가도 영향이 없다.
   * show가 있는 장은 문구를 바꾸기 직전에 게임 화면(뽑기 연출 등)을 띄우거나 닫는다.
   */
  timeline() {
    const { chapters, tickRate } = this.config;
    let atMs = 0;
    return [{ atMs: 0, action: 'custom', name: 'watch' }, ...chapters.flatMap((chapter, index) => {
      const gate = chapter.tick === undefined ? `after:${chapter.afterMs}` : `tick:${chapter.tick}`;
      atMs = chapter.tick === undefined ? atMs + chapter.afterMs : Math.round(chapter.tick * 1000 / tickRate);
      const scene = chapter.show ? [{ atMs, action: 'custom', name: `show:${chapter.show}` }] : [];
      return [{ atMs, action: 'custom', name: gate }, ...scene, { atMs, action: 'chapter', index, title: chapter.title, caption: '' }];
    })];
  }

  /**
   * 호스트는 false를 돌려받으면 같은 항목을 다시 시도하고, 예정 시각보다 6초 넘게 밀린 항목은 버린다. win은 iframe 창이다.
   * gateAt은 바로 앞 장이 뜬 시각이다. 틱 기다림 중에는 비워 두어, 느린 기기에서 호스트가 그 기다림을 버리고 장을 띄웠다면
   * 다음 afterMs는 그 장이 뜬 뒤(첫 시도 시각)부터 잰다. 그래야 득점 장과 시스템 소개 장이 연달아 스쳐 지나가지 않는다.
   */
  run(name, win) {
    const runtime = win.__takraw;
    if (name === 'watch') return Boolean(runtime?.ready && runtime.watch(this.config.seed));
    if (name.startsWith('tick:')) {
      this.gateAt = null;
      if ((runtime?.game?.state.tick ?? 0) < Number(name.slice(5))) return false;
      this.gateAt = this.now();
      return true;
    }
    if (name.startsWith('after:')) {
      this.gateAt ??= this.now();
      if (this.now() - this.gateAt < Number(name.slice(6))) return false;
      this.gateAt = this.now();
      return true;
    }
    if (name.startsWith('show:')) return Boolean(runtime?.showcase?.(name.slice(5), this.config));
    return true;
  }
}

export { TakrawIntroScript };
