/**
 * 화면 그리기 주기. requestAnimationFrame을 소유하고 hz보다 자주 그리지 않는다.
 * 표본 수신과 표시에는 같은 단조 시계(performance.now)를 쓴다. RAF timestamp는 직전 입력보다 오래될 수 있다.
 *   blocked(): true면 이 프레임을 건너뛴다(실행 실패 뒤). 다음 프레임 예약은 계속한다.
 *   onFrame(now): 그릴 때마다 한 번.
 */
class RenderLoop {
    constructor({ hz, blocked, onFrame }) {
        this.hz = hz;
        this.blocked = blocked;
        this.onFrame = onFrame;
        this.handle = 0;
        this.lastAt = -Infinity;
        this.running = false;
        this.tick = () => {
            if (!this.running) return;
            this.handle = requestAnimationFrame(this.tick);
            if (this.blocked()) return;
            const now = performance.now();
            if (now - this.lastAt + 0.5 < 1000 / this.hz) return;
            this.lastAt = now;
            this.onFrame(now);
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
