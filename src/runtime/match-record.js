import { SessionReplayRecorder } from '@bloom-gamekit/metrics';
import { TAKRAW_MODE_POLICY } from '../config/runtime.js';

/**
 * 끝난 경기 하나를 지표(경기 기록)로 남긴다. 기록 중인 세션의 경기 관측 { ordinal, finishedAt, recorded }을 소유한다.
 * 온라인은 예측한 끝을 남기지 않도록 그 tick이 확정된 뒤에 남긴다.
 * 경기가 시작될 때(`start`) metrics.beginMatch가 시작 이벤트와 recorder를 한 번에 주고, 끝나면 그 recorder로 recordMatch한다.
 * 온라인은 두 사람이 같은 matchId(방 세션·roster 세대·그 세대의 순번)를 시작 시점에 정해 서버가 시작도 기록도 한 번만 센다.
 * 중도 종료·오류로 끝난 경기는 recordMatch를 부르지 않는다(완주율의 미완주).
 * 해제할 자원은 없다.
 */
class MatchRecord {
    constructor({ metrics, recordError }) {
        this.metrics = metrics;
        this.recordError = recordError;
        this.track = null;
    }

    /** 세션 하나를 연다. 기록하지 않는 모드(관전·연습)는 관측하지 않는다. 기록 여부를 돌려준다. */
    begin(mode) {
        const recorded = Boolean(TAKRAW_MODE_POLICY[mode]?.recorded);
        this.track = recorded
            ? { ordinal: 0, finishedAt: null, recorded: false, recorder: null }
            : null;
        return recorded;
    }

    /**
     * 새 경기 하나의 시작. 시작 이벤트를 보내는 유일한 지점이다(첫 경기·재경기 모두).
     * 기록하지 않는 모드(관전·연습)는 끝을 기록하지 않는 시작(record: false)만 남긴다.
     */
    start({ session, mode }) {
        const track = this.track;
        try {
            if (!track) {
                this.metrics.beginMatch({ mode, record: false });
                return;
            }
            track.recorder = this.metrics.beginMatch(
                {
                    session,
                    mode,
                    ...(TAKRAW_MODE_POLICY[mode].room
                        ? { matchId: `${session.sessionId}:${session.epoch}:${track.ordinal}` }
                        : {}),
                },
                SessionReplayRecorder,
            );
        } catch (error) {
            this.recordError(error, 'metrics-match');
        }
    }

    /** 온라인 roster 세대가 바뀌면 그 세대의 순번을 처음부터 센다. */
    membershipCommitted() {
        if (this.track) this.track.ordinal = 0;
    }

    /** 매 진행 뒤 경기가 끝났는지(끝난 뒤 다시 시작됐는지) 본다. schoolId·localTeam은 match·online에서만 기록에 붙는다. */
    observe({ session, state, mode, schoolId, localTeam }) {
        const track = this.track;
        if (!session || !track) return;
        if (state?.phase !== 'finished' || ![0, 1].includes(state.matchWinner)) {
            // 기록한 경기 다음에 끝남이 풀렸다 = 재경기(같은 세션의 재시작 명령). 새 경기의 시작은 여기 하나다.
            if (track.recorded) {
                if (session.resimulating) return;
                this.start({ session, mode });
            }
            track.finishedAt = null;
            track.recorded = false;
            return;
        }
        if (track.recorded) return;
        track.finishedAt ??= session.tick;
        if (session.resimulating || session.confirmedTick + 1 < track.finishedAt) return;
        const recorder = track.recorder;
        if (!recorder) return;
        track.recorded = true;
        track.recorder = null;
        const policy = TAKRAW_MODE_POLICY[mode];
        const online = policy.room;
        track.ordinal += 1;
        try {
            this.metrics.recordMatch(recorder, {
                winner: state.matchWinner,
                sets: [...state.sets],
                score: [...state.score],
                ticks: state.tick,
                seed: state.seed,
                ...(policy.opponentSchool ? { schoolId: schoolId() ?? null } : {}),
                ...(online ? { localTeam: localTeam() } : {}),
            });
        } catch (error) {
            this.recordError(error, 'metrics-match');
        }
    }

    dispose() {
        this.track = null;
    }
}

export { MatchRecord };
