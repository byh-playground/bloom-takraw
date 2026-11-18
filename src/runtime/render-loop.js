import { FramePacer } from '@bloom-gamekit/simloop';

/**
 * 화면 그리기 주기. requestAnimationFrame을 소유한다(세션이 없을 때도 그리므로 시뮬 루프의 자동 RAF를 쓰지 않는다).
 * 프레임을 건너뛸지는 gamekit FramePacer가 정한다: 화면 주사 k번마다 한 번, k는 빈도가 minHz 이상으로 남는 가장 큰 정수.
 *   blocked(): true면 이 프레임을 건너뛴다(실행 실패 뒤). 다음 프레임 예약은 계속한다.
 *   onFrame(frameTimeMs): 그릴 때마다 한 번. frameTimeMs는 RAF timestamp(화면 프레임 시각)다.
 */
class RenderLoop {
    constructor({ minHz, blocked, onFrame }) {
        this.pacer = new FramePacer({ minHz });
        this.handle = 0;
        this.running = false;
        this.tick = (frameTimeMs) => {
            if (!this.running) return;
            this.handle = requestAnimationFrame(this.tick);
            if (this.pacer.accept(frameTimeMs) && !blocked()) onFrame(frameTimeMs);
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
        this.pacer.rebase();
        cancelAnimationFrame(this.handle);
    }

    dispose() {
        this.stop();
    }
}

export { RenderLoop };
