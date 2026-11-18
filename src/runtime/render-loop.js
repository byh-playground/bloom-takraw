/**
 * 화면 그리기 주기. requestAnimationFrame을 소유하고 hz보다 자주 그리지 않는다.
 * 시각은 둘이다. 둘 다 performance.now와 같은 시계다.
 *   frameAt: RAF timestamp(브라우저가 이 화면 프레임을 시작한 시각). 화면 주사에 맞춰 고르게 늘어난다.
 *     건너뛸지 판정과 표시 시계(무엇을 그릴지)에 쓴다. 콜백이 실제로 도는 시각(now)은 앞선 메인 스레드 작업(틱 등)만큼
 *     늦어지므로, now로 판정하면 늦게 돈 프레임의 다음 프레임이 간격 미달로 버려지고 now로 보간하면 표시 시각이 흔들린다.
 *   now: 콜백이 도는 시각. 입력 관찰·틱 진행에 쓴다. frameAt은 직전 입력·틱보다 오래될 수 있다.
 *   blocked(): true면 이 프레임을 건너뛴다(실행 실패 뒤). 다음 프레임 예약은 계속한다.
 *   onFrame(now, frameAt): 그릴 때마다 한 번.
 */
class RenderLoop {
    constructor({ hz, blocked, onFrame }) {
        this.hz = hz;
        this.blocked = blocked;
        this.onFrame = onFrame;
        this.handle = 0;
        this.lastAt = -Infinity;
        this.running = false;
        this.tick = (frameAt) => {
            if (!this.running) return;
            this.handle = requestAnimationFrame(this.tick);
            if (this.blocked()) return;
            if (frameAt - this.lastAt + 0.5 < 1000 / this.hz) return;
            this.lastAt = frameAt;
            this.onFrame(performance.now(), frameAt);
        };
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.handle = requestAnimationFrame(this.tick);
    }

    /** 예약한 프레임을 취소한다. 확인용 장면은 실시간 그리기를 멈추고 직접 그린다. */
    stop() {
        this.running = false;
        cancelAnimationFrame(this.handle);
    }

    dispose() {
        this.stop();
    }
}

export { RenderLoop };
