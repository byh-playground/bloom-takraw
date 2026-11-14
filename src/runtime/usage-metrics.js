/**
 * 사용 지표 두 가지(README "게임 지표"). 둘 다 새로 재는 것 없이 이미 있는 값만 읽는다.
 *   TrainingRecord: 연습 과제(레슨) 진입과 통과. 판정은 시뮬레이션이 하고(`getView().training`), 여기서는 그 결과 값의 변화만 본다.
 *   PerfSummary: 세션당 한 번, 첫 경기가 어느 정도 진행된 뒤 렌더 진단(`RenderStats.snapshot()`)과 품질 설정을 구간으로 내려 보낸다.
 * 해제할 자원은 없다.
 */
import { TAKRAW_CONFIG } from '../config/game.js';
import { takrawTickCount } from '../simulation/tick-time.js';

/** value가 경계(bounds) 중 처음으로 넘지 않는 것의 라벨. 마지막 라벨은 모두 넘을 때. */
function bucket(value, bounds, labels) {
    const index = bounds.findIndex((bound) => value <= bound);
    return labels[index < 0 ? bounds.length : index];
}

class TrainingRecord {
    constructor({ metrics }) {
        this.metrics = metrics;
        this.reset();
    }

    /** 연습 세션을 새로 열 때(경기 시작 지점) 부른다. */
    reset() {
        this.lesson = null;
        this.successes = 0;
    }

    /**
     * 진행할 때마다 연습 사실(view.training: lesson·tempo·successes)을 본다. 과제 = 레슨 id.
     * 레슨이 처음 보이면 start, 그 레슨의 성공 횟수가 늘면 pass(props count는 그 레슨의 누적 통과 횟수, 레슨을 바꾸거나 다시 시작하면 0부터).
     */
    observe(training) {
        if (!training) return;
        if (training.lesson !== this.lesson) {
            this.lesson = training.lesson;
            this.successes = training.successes;
            this.metrics.track('training', training.lesson, 'start', { tempo: training.tempo });
            return;
        }
        if (training.successes > this.successes)
            this.metrics.track('training', training.lesson, 'pass', {
                count: training.successes,
                tempo: training.tempo,
            });
        this.successes = training.successes;
    }
}

class PerfSummary {
    constructor({ metrics }) {
        this.metrics = metrics;
        this.sent = false;
    }

    /**
     * 경기가 충분히 진행됐고(minMatchMs) 프레임 기록이 충분하면(minFrames) 한 번만 보낸다.
     * stats는 view.renderStats.snapshot()이 아니라 호출 함수를 받아 조건이 되기 전에는 요약을 계산하지 않는다.
     */
    observe({ tick, mode, quality, snapshot }) {
        if (
            this.sent ||
            tick < takrawTickCount(PerfSummary.minMatchMs, TAKRAW_CONFIG.simulation.tickRate)
        )
            return;
        const stats = snapshot();
        if (stats.retainedFrames < PerfSummary.minFrames || stats.fps === null) return;
        this.sent = true;
        const ratio = window.devicePixelRatio || 1;
        this.metrics.track('boot', 'perf', 'done', {
            mode,
            quality,
            dpr: bucket(ratio, [1.25, 1.75, 2.25], ['1', '1.5', '2', '3']),
            fps: bucket(stats.fps, [23.9, 44.9, 57.9], ['lt24', 'lt45', 'lt58', 'ge58']),
            p95: bucket(stats.intervalMs.p95, [19.9, 33.9, 49.9], ['lt20', 'lt34', 'lt50', 'ge50']),
            draws: bucket(
                stats.counts.drawCalls.max,
                [30, 60, 120],
                ['le30', 'le60', 'le120', 'gt120'],
            ),
            tris: bucket(
                stats.counts.triangles.max,
                [50000, 150000, 500000],
                ['le50k', 'le150k', 'le500k', 'gt500k'],
            ),
        });
    }
}
/** 경기 진행 시간(ms, 경기 틱으로 올림해 비교)과 최근 프레임 수. */
PerfSummary.minMatchMs = 20000;
PerfSummary.minFrames = 120;

export { TrainingRecord, PerfSummary };
