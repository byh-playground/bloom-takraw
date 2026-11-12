import { FrameMetrics } from '@bloom-gamekit/debug-tools';

/**
 * 프레임당 렌더 제출량(드로우콜·삼각형·셰이더 프로그램·텍스처)과 그리는 시간의 최근 분포(DEV-033). 표시 전용 진단이다.
 * 후처리 때문에 한 프레임에 render()를 여러 번 부르므로 renderer.info.autoReset을 끄고 프레임 시작에서 직접 초기화해 프레임 합계를 읽는다.
 * 프레임마다 하는 일은 숫자 몇 개를 고정 크기 링에 쓰는 것뿐이고, 요약(snapshot)은 읽을 때만 계산한다. 일반 화면에는 나오지 않는다.
 * 읽는 곳: window.__takraw.diagnostics().render, 치명 오류 화면의 "진단 복사" 한 줄.
 */
class TakrawRenderStats {
    constructor(renderer, { capacity = 240 } = {}) {
        this.info = renderer.info;
        this.info.autoReset = false;
        this.metrics = new FrameMetrics({
            capacity,
            counters: ['drawCalls', 'triangles', 'programs', 'textures'],
        });
    }

    /** 프레임 시작: 제출 카운터를 0으로 되돌리고 시간 재기를 시작한다. */
    begin() {
        if (this.metrics.active) this.metrics.endFrame();
        this.info.reset();
        this.metrics.beginFrame(performance.now());
    }

    /** 프레임 끝: 이 프레임의 제출량을 기록한다. */
    end() {
        const { metrics, info } = this;
        metrics.count('drawCalls', info.render.calls);
        metrics.count('triangles', info.render.triangles);
        metrics.count('programs', info.programs?.length ?? 0);
        metrics.count('textures', info.memory.textures);
        metrics.endFrame();
    }

    /** 최근 프레임 요약: intervalMs(프레임 간격), cpuMs(그리기 호출 구간), counts(제출량), 가장 느린 프레임들. */
    snapshot() {
        return this.metrics.snapshot({ slowFrameMs: 50, slowLimit: 3 });
    }

    /** 진단 복사에 넣는 한 줄. */
    line() {
        const s = this.snapshot();
        if (!s.retainedFrames) return 'render: no frames';
        const f = (v) => Math.round(v * 10) / 10;
        const { drawCalls, triangles, programs, textures } = s.counts;
        return `render frames=${s.retainedFrames} fps=${f(s.fps ?? 0)} intervalMs p50=${f(s.intervalMs.p50)} p95=${f(s.intervalMs.p95)} max=${f(s.intervalMs.max)} drawCalls mean=${Math.round(drawCalls.mean)} max=${drawCalls.max} triangles max=${triangles.max} programs=${programs.max} textures=${textures.max}`;
    }
}

export { TakrawRenderStats };
