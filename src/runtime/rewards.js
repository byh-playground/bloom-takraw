import { TAKRAW_CLUB_RULES } from '../club/club.js';
import { RUNTIME } from '../i18n/messages/runtime.js';
import { TAKRAW_MODE_POLICY } from '../config/runtime.js';

function matchId() {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * AI 대전(match) 보상: 이 경기({ id, finished, schoolId })와 경기 결과 보상(reward), 저장 대기열(jobs·running·timer)을 소유한다.
 * 완료 관측은 한 번만 하고, 영속 I/O(club.rewardMatch)는 시뮬레이션 콜백 밖 타이머에서 실행한다.
 *   getClub(): 지금 클럽(확인용 장면이 바꿔 끼울 수 있다), onChange(): 대기열 상태가 바뀌어 클럽 화면·HUD를 다시 그려야 할 때.
 */
class MatchRewards {
    constructor({ getClub, recordError, onChange }) {
        this.getClub = getClub;
        this.recordError = recordError;
        this.onChange = onChange;
        this.jobs = [];
        this.running = false;
        this.timer = null;
        this.match = null;
        this.reward = null;
        this.disposed = false;
    }

    /** AI 대전 하나를 시작한다. schoolId는 도전 중인 학교(퀵 대전은 null). */
    begin({ schoolId }) {
        this.match = { id: matchId(), finished: false, schoolId };
        this.reward = null;
    }

    /** 보상 대상 경기가 없다(다른 모드·처음 화면). 저장 대기열은 그대로 이어진다. */
    clear() {
        this.match = null;
        this.reward = null;
    }

    /** 지금 경기의 도전 학교. */
    get schoolId() {
        return this.match?.schoolId;
    }

    /** 경기가 끝났으면 보상 저장을 한 번 예약한다. */
    observe({ mode, state }) {
        const match = this.match;
        if (
            this.disposed ||
            !TAKRAW_MODE_POLICY[mode]?.rewards ||
            !match ||
            match.finished ||
            state?.phase !== 'finished' ||
            ![0, 1].includes(state.matchWinner)
        )
            return;
        match.finished = true;
        const won = state.matchWinner === 0,
            reward = TAKRAW_CLUB_RULES.rewards[won ? 'win' : 'loss'];
        const job = {
            id: match.id,
            won,
            mode: 'match',
            schoolId: match.schoolId,
            status: 'queued',
            message: RUNTIME.rewardSaving(),
            ...reward,
        };
        this.jobs.push(job);
        this.reward = job;
        // 완료 관측은 한 번만 한다. 영속 I/O는 시뮬레이션 콜백 밖에서 실행한다.
        this.schedule();
    }

    /** 실패한 저장을 다시 시도한다(클럽을 새로 읽은 뒤). */
    async retry() {
        const club = this.getClub();
        if (this.disposed || !club) return;
        try {
            await club.refresh();
            this.schedule(true);
        } catch (error) {
            this.recordError(error, 'club-refresh');
        }
    }

    /** 클럽 화면에 알릴 대기 중 보상(실패한 것 우선). */
    pending() {
        const pending = this.jobs.find((job) => job.status === 'error') || this.jobs[0] || null;
        return pending ? { status: pending.status, message: pending.message } : null;
    }

    /** HUD의 이 경기 보상(보상이 이 경기 것일 때만). */
    hudReward() {
        return this.match?.id === this.reward?.id ? this.reward : null;
    }

    diagnostics() {
        return {
            pending: this.jobs.length,
            saving: this.running,
            failed: this.jobs.filter((job) => job.status === 'error').length,
        };
    }

    dispose() {
        this.disposed = true;
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.timer = null;
    }

    schedule(retry = false) {
        if (this.disposed) return;
        if (retry) for (const job of this.jobs) if (job.status === 'error') job.status = 'queued';
        if (
            this.running ||
            this.timer !== null ||
            !this.jobs.some((job) => job.status === 'queued')
        )
            return;
        this.timer = window.setTimeout(() => {
            this.timer = null;
            this.save();
        }, 0);
    }

    async save() {
        if (this.disposed || this.running) return;
        this.running = true;
        try {
            let job;
            while (!this.disposed && (job = this.jobs.find((value) => value.status === 'queued'))) {
                job.status = 'saving';
                job.message = RUNTIME.rewardSaving();
                this.onChange();
                try {
                    await this.getClub().rewardMatch({
                        id: job.id,
                        won: job.won,
                        mode: job.mode,
                        schoolId: job.schoolId,
                    });
                    const actual = this.getClub().getView().lastReward;
                    job.status = 'saved';
                    if (actual?.id === job.id) {
                        job.credits = actual.credits;
                        job.trainingPoints = actual.trainingPoints;
                        job.message = RUNTIME.rewardSaved({
                            credits: job.credits,
                            points: job.trainingPoints,
                        });
                    } else job.message = RUNTIME.rewardAlready();
                    this.jobs.splice(this.jobs.indexOf(job), 1);
                } catch (error) {
                    job.status = 'error';
                    job.message = RUNTIME.rewardFailed();
                    this.recordError(error, 'club-reward');
                }
                if (this.match?.id === job.id) this.reward = job;
            }
        } finally {
            this.running = false;
            this.onChange();
            this.schedule();
        }
    }
}

export { MatchRewards };
