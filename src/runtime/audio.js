import { AudioPlayer } from '@bloom-gamekit/audio';
import { TAKRAW_RUNTIME } from '../config/runtime.js';

/** 배경 음악 크기: 홈 homeLevel, 경기 중 level, 일시정지·소개영상 중에는 낮게. */
function takrawBgmLevel({ mode, paused }) {
    if (!mode) return TAKRAW_RUNTIME.bgm.homeLevel;
    return paused ? TAKRAW_RUNTIME.bgm.pausedLevel : TAKRAW_RUNTIME.bgm.level;
}

/**
 * 효과음 플레이어와 배경 음악 한 곡. 곡 파일 읽기·디코드·켜기·덕킹 타이머를 소유한다.
 * 배경 음악의 크기는 이 모듈이 정하지 않는다. 생성자의 level()이 지금 세션 상태로 크기를 알려 준다(덕킹 복귀도 그 순간의 값을 쓴다).
 *   settings: 소리 설정 save. 읽지 못했으면 null을 넘기고, 그때는 저장 없이 음소거로 시작한다.
 */
class RuntimeAudio {
    constructor({ settings, onSaveError, level, recordError }) {
        this.level = level;
        this.recordError = recordError;
        if (settings) {
            this.player = new AudioPlayer({
                ...TAKRAW_RUNTIME.audio,
                settings,
                onSaveError,
            });
        } else {
            this.player = new AudioPlayer(TAKRAW_RUNTIME.audio);
            this.player.setMuted(true);
        }
        this.bgm = null;
        this.bgmState = { buffer: false, loading: false, failed: false };
        this.duckTimer = 0;
        this.disposed = false;
    }

    get muted() {
        return this.player.muted;
    }

    /** 오디오 잠금을 풀고 배경 음악을 켠다(이미 켜져 있으면 그대로). 첫 제스처 전에는 켜지지 않고 다음 제스처에서 켠다. */
    unlock() {
        return this.player.unlock().then((ok) => {
            if (!ok) return ok;
            if (this.bgmState.buffer) this.startBgm();
            else this.loadBgm().then(() => this.startBgm());
            return ok;
        });
    }

    /** 지금 세션 상태의 크기로 배경 음악을 옮긴다. */
    setBackground(rampMs) {
        this.bgm?.setLevel(this.level(), rampMs);
    }

    /** 타격·득점 순간에 음악을 잠깐 낮춰 효과음이 묻히지 않게 한다(kind는 TAKRAW_RUNTIME.bgm.duck의 키). */
    duck(kind) {
        if (!this.bgm) return;
        const { depth, holdMs, releaseMs } = TAKRAW_RUNTIME.bgm.duck[kind];
        this.bgm.setLevel(this.level() * depth, 15);
        clearTimeout(this.duckTimer);
        this.duckTimer = setTimeout(() => this.bgm?.setLevel(this.level(), releaseMs), holdMs);
    }

    /** 경기 이벤트 저널의 소리 어댑터. 소리가 끝나면 onEnded(event)로 알린다. */
    eventAdapter(onEnded) {
        return this.player.createAdapter({ onEnded });
    }

    setMuted(muted) {
        this.player.setMuted(muted);
    }

    snapshot() {
        return this.player.snapshot();
    }

    dispose() {
        this.disposed = true;
        clearTimeout(this.duckTimer);
        this.bgm = null;
        this.player.dispose();
    }

    /** 곡 파일을 한 번만 읽어 디코드하고 모듈에 등록한다. 실패해도 음악만 빠질 뿐 게임은 계속된다. */
    async loadBgm() {
        const state = this.bgmState;
        if (state.buffer || state.loading || state.failed) return;
        state.loading = true;
        try {
            const response = await fetch(TAKRAW_RUNTIME.bgm.url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const decoded = await this.player.context.decodeAudioData(await response.arrayBuffer());
            if (this.disposed) return;
            this.player.setBuffer('bgm', decoded);
            state.buffer = true;
        } catch (error) {
            state.failed = true;
            this.recordError(error, 'bgm-load');
        } finally {
            state.loading = false;
        }
    }

    startBgm() {
        if (!this.bgm && this.bgmState.buffer && !this.disposed)
            this.bgm = this.player.startBed('bgm', {
                level: this.level(),
                fadeMs: TAKRAW_RUNTIME.bgm.fadeMs,
            });
    }
}

export { RuntimeAudio, takrawBgmLevel };
