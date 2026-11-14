import { TAKRAW_MODE_POLICY, TAKRAW_RUNTIME } from '../config/runtime.js';
import { TakrawHighlight } from '../presentation/highlight.js';

/** ms로 적은 리플레이 구간 설정(config/runtime.js highlight)을 틱 번호로 자르는 TakrawHighlight에 맞춰 틱 수로 올림한다. */
function highlightSettings(time) {
    const s = TAKRAW_RUNTIME.highlight,
        ticks = (ms) => time.ceilTicks(ms);
    return {
        ...s,
        tickRate: time.tickRate,
        leadTicks: ticks(s.leadMs),
        tailTicks: ticks(s.tailMs),
        slowBefore: ticks(s.slowBeforeMs),
        slowAfter: ticks(s.slowAfterMs),
    };
}

/**
 * 득점 리플레이. 경기 시작 상태 + 입력으로 워커의 그림자 경기가 다시 계산한 장면을 그린다. 재생 중에는 경기 진행과 조작을 멈춘다.
 * 워커에는 import map이 없어 모듈 주소를 여기서 풀어 넘긴다. playedAt은 재생 시계의 직전 렌더 시각이다.
 * 재생 화면을 띄운 동안 active가 true다. 워커가 장면을 못 만들면 재생 없이 끝난다.
 *   onPlaybackChange(active): 재생을 시작하거나 끝낸 직후 부른다(세션이 조작·시계를 멈추거나 다시 돈다).
 *   showReplay(reason | null): 재생 표시(건너뛰기 버튼·문구)를 켜고 끈다.
 *   snapCamera(): 재생 카메라와 경기 카메라가 바뀌는 순간 카메라를 바로 옮긴다.
 */
class HighlightController {
    constructor({ time, showReplay, snapCamera, onPlaybackChange }) {
        this.showReplay = showReplay;
        this.snapCamera = snapCamera;
        this.onPlaybackChange = onPlaybackChange;
        this.highlight = new TakrawHighlight(highlightSettings(time), {
            rapierUrl: import.meta.resolve('rapier'),
            deterministicUrl: import.meta.resolve('@bloom-gamekit/deterministic'),
        });
        this.shown = false;
        this.playedAt = 0;
    }

    /** 리플레이 화면을 띄우고 경기를 멈춘 동안 true. */
    get active() {
        return this.shown;
    }

    /**
     * 리플레이 기준점: 이 세션의 첫 스텝 직전 상태. 새로 만든 물리 월드와 스냅샷에서 되살린 월드는 계산이 달라지므로,
     * 실제 경기도 같은 바이트에서 되살려 두 경기를 같은 출발점에 둔다(락스텝 합류와 같은 방식). 세션이 상태를 불러오거나 바꾸면 다시 잡는다.
     */
    anchorIfNeeded(game, codec, mode) {
        if (!TAKRAW_MODE_POLICY[mode]?.replay || this.highlight.anchored) return;
        const start = codec.encode(game.save()).slice();
        game.load(codec.decode(start));
        this.highlight.anchor(start);
    }

    record(context, view) {
        this.highlight.record(context, view);
    }

    /** 꼬리 구간까지 기록된 명장면이 있으면 재생을 시작한다(onAdvance에서 호출). */
    tryBegin(mode) {
        if (!TAKRAW_MODE_POLICY[mode]?.replay || this.shown || !this.highlight.begin()) return;
        this.shown = true;
        this.onPlaybackChange(true);
        this.playedAt = performance.now();
        this.snapCamera();
        this.showReplay(this.highlight.clip.reason);
    }

    /** 재생이 끝났거나 사용자가 건너뛰었다. 멈춘 동안의 시간은 따라잡지 않고 득점 뒤 대기부터 이어 간다. */
    end() {
        if (!this.shown) return;
        this.shown = false;
        this.highlight.stop();
        this.showReplay(null);
        this.snapCamera();
        this.onPlaybackChange(false);
    }

    /** 재생할 장면이 남았는지(워커가 끝냈으면 false). */
    get running() {
        return this.highlight.playing;
    }

    /**
     * 지금 그릴 재생 장면. 재생이 끝났으면 끝내고 null, 워커의 첫 장면을 기다리는 동안도 null이다(멈춘 실제 경기를 그대로 그린다).
     * 일시 정지 중에는 재생 시계가 흐르지 않는다.
     */
    frame(now, paused) {
        const dt = paused ? 0 : Math.min(0.1, Math.max(0, (now - this.playedAt) / 1000));
        this.playedAt = now;
        if (!this.highlight.advance(dt)) {
            this.end();
            return null;
        }
        return this.highlight.frame();
    }

    /** 기록을 버린다(세션이 상태를 불러오거나 바꿀 때). 재생 중 여부는 그대로다. */
    reset() {
        this.highlight.reset();
    }

    /** 세션 종료: 재생 화면을 닫고 기록을 버린다. 조작·시계는 세션이 따로 정리한다. */
    stop() {
        if (this.shown) this.showReplay(null);
        this.shown = false;
        this.highlight.reset();
    }

    /** 확인용 장면: 모든 득점을 리플레이한다. 판정 기준만 낮추고 재생 방식은 그대로다. */
    replayEveryScore() {
        this.highlight.settings = { ...this.highlight.settings, longRallyTouches: 0 };
    }

    /** 확인용 장면의 재생 상태. */
    replayState() {
        return {
            playing: this.shown,
            played: this.highlight.played || 0,
            lastLatencyMs: this.highlight.lastLatencyMs ?? null,
        };
    }

    diagnostics() {
        return {
            anchored: this.highlight.anchored,
            playing: this.shown,
            played: this.highlight.played || 0,
            lastLatencyMs: this.highlight.lastLatencyMs ?? null,
            failed: this.highlight.failed,
        };
    }

    dispose() {
        this.highlight.dispose();
    }
}

export { HighlightController };
