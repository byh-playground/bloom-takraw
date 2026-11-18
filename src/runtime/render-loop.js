/**
 * 화면 그리기 주기. requestAnimationFrame을 소유한다.
 * 그리는 빈도: 화면 주사 k번마다 한 번, k는 빈도가 hz 이상으로 남는 가장 큰 정수다(60 Hz·90 Hz 화면은 매번, 120 Hz·144 Hz·165 Hz는
 * 2번마다 = 60·72·82.5 fps). 주사 간격의 정수 배로만 그려야 프레임 간격이 고르다. hz에 맞춰 남는 시간을 쌓으면 간격이 번갈아 달라진다.
 * 주사 간격은 최근 RAF 간격의 중앙값으로 추정한다(탭 복귀·한두 프레임 지연은 중앙값을 움직이지 않는다). 표본이 차기 전에는 1000/hz로 본다.
 * 시각은 둘이다. 둘 다 performance.now와 같은 시계다.
 *   frameAt: RAF timestamp(브라우저가 이 화면 프레임을 시작한 시각). 화면 주사에 맞춰 고르게 늘어난다.
 *     건너뛸지 판정과 표시 시계(무엇을 그릴지)에 쓴다. 콜백이 실제로 도는 시각(now)은 앞선 메인 스레드 작업(틱 등)만큼
 *     늦어지므로, now로 판정하면 늦게 돈 프레임의 다음 프레임이 간격 미달로 버려지고 now로 보간하면 표시 시각이 흔들린다.
 *   now: 콜백이 도는 시각. 입력 관찰·틱 진행에 쓴다. frameAt은 직전 입력·틱보다 오래될 수 있다.
 *   blocked(): true면 이 프레임을 건너뛴다(실행 실패 뒤). 다음 프레임 예약은 계속한다.
 *   onFrame(now, frameAt): 그릴 때마다 한 번.
 */
const REFRESH_SAMPLES = 15;

class RenderLoop {
    constructor({ hz, blocked, onFrame }) {
        this.hz = hz;
        this.blocked = blocked;
        this.onFrame = onFrame;
        this.handle = 0;
        this.lastAt = -Infinity;
        this.seenAt = null; // 직전 RAF timestamp(그렸는지와 무관)
        this.gaps = new Float64Array(REFRESH_SAMPLES); // 최근 RAF 간격(ms), 돌려쓰는 칸
        this.sorted = new Float64Array(REFRESH_SAMPLES);
        this.gapCount = 0;
        this.refreshMs = 1000 / hz;
        this.running = false;
        this.tick = (frameAt) => {
            if (!this.running) return;
            this.handle = requestAnimationFrame(this.tick);
            this.observeRefresh(frameAt);
            if (this.blocked()) return;
            if (frameAt - this.lastAt < (this.stride() - 0.5) * this.refreshMs) return;
            this.lastAt = frameAt;
            this.onFrame(performance.now(), frameAt);
        };
    }

    /** RAF 간격 하나를 표본에 넣고, 표본이 다 차 있으면 중앙값을 주사 간격으로 삼는다. */
    observeRefresh(frameAt) {
        const gap = this.seenAt === null ? 0 : frameAt - this.seenAt;
        this.seenAt = frameAt;
        if (gap <= 0) return;
        this.gaps[this.gapCount % REFRESH_SAMPLES] = gap;
        this.gapCount += 1;
        if (this.gapCount < REFRESH_SAMPLES) return;
        this.sorted.set(this.gaps);
        this.sorted.sort();
        this.refreshMs = this.sorted[REFRESH_SAMPLES >> 1];
    }

    /** 화면 주사 몇 번마다 그리는지. 0.05는 주사율 표기 오차(59.94 Hz 등) 여유다. */
    stride() {
        return Math.max(1, Math.floor(1000 / this.hz / this.refreshMs + 0.05));
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.handle = requestAnimationFrame(this.tick);
    }

    /** 예약한 프레임을 취소한다. 확인용 장면은 실시간 그리기를 멈추고 직접 그린다. */
    stop() {
        this.running = false;
        this.seenAt = null;
        cancelAnimationFrame(this.handle);
    }

    dispose() {
        this.stop();
    }
}

export { RenderLoop };
