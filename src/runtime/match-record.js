import { SessionReplayRecorder } from '@bloom-gamekit/metrics';
import { TAKRAW_RUNTIME } from '../config/runtime.js';

/**
 * 끝난 경기 하나를 지표(경기 기록)로 남긴다. 기록 중인 세션의 경기 관측 { ordinal, finishedAt, recorded }을 소유한다.
 * 온라인은 예측한 끝을 남기지 않도록 그 tick이 확정된 뒤에 남긴다.
 * 두 사람이 같은 matchId(방 세션·roster 세대·그 세대에서 끝난 순번)를 보내 서버에 한 행만 남는다.
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
        const recorded = TAKRAW_RUNTIME.metrics.modes.includes(mode);
        this.track = recorded ? { ordinal: 0, finishedAt: null, recorded: false } : null;
        return recorded;
    }

    /** 온라인 roster 세대가 바뀌면 그 세대의 순번을 처음부터 센다. */
    membershipCommitted() {
        if (this.track) this.track.ordinal = 0;
    }

    /** 매 진행 뒤 경기가 끝났는지 본다. schoolId·localTeam은 match·online에서만 기록에 붙는다. */
    observe({ session, state, mode, schoolId, localTeam }) {
        const track = this.track;
        if (!session || !track) return;
        if (state?.phase !== 'finished' || ![0, 1].includes(state.matchWinner)) {
            track.finishedAt = null;
            track.recorded = false;
            return;
        }
        if (track.recorded) return;
        track.finishedAt ??= session.tick;
        if (session.resimulating || session.confirmedTick + 1 < track.finishedAt) return;
        track.recorded = true;
        const online = mode === 'online';
        const recorder = new SessionReplayRecorder({
            session,
            mode,
            ...(online
                ? { matchId: `${session.sessionId}:${session.epoch}:${track.ordinal}` }
                : {}),
        });
        track.ordinal += 1;
        try {
            this.metrics.recordMatch(recorder, {
                winner: state.matchWinner,
                sets: [...state.sets],
                score: [...state.score],
                ticks: state.tick,
                seed: state.seed,
                ...(mode === 'match' ? { schoolId: schoolId() ?? null } : {}),
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
