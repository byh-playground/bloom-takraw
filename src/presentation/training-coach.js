import { takrawMessage as message } from '../simulation/game.js';

/**
 * 연습 안내의 순수 함수: 시뮬레이션이 낸 사실(game.getTrainingFacts, getView().training)에서
 * 단계(stage)·문구(cue·detail)·색(tone)·진행 막대(progress)를 만든다. 상태를 바꾸지 않는다.
 * maxLead는 표시 설정(config.visual.attackGuide.maxLead)이고 runtime의 HUD 조립이 넘긴다.
 * 결과는 ui.updateTraining이 읽는 모양이다. cue·detail은 message(id, values)이고 문장은 src/i18n/messages/match.js가 만든다.
 */
function takrawTrainingCoach(facts, { maxLead }) {
    if (!facts) return null;
    const t = facts,
        prehold = t.prehold;
    const base = {
        lesson: t.lesson,
        tempo: t.tempo,
        attempt: t.attempt,
        successes: t.successes,
        title: t.title,
        sequence: t.sequence,
        motionId: t.motionId,
        motionStatus: t.motionKnown
            ? message('motionStatus', { motionId: t.motionId, adjustment: t.adjustment })
            : message(t.anyMotion ? 'motionAuto' : 'motionLesson', {
                  lesson: t.lesson,
              }),
        jumpIn: t.jumpIn,
        kickIn: t.kickIn,
        shortJump: t.shortJump,
        contactLead: t.contactLead,
        jumpHold: t.jumpHold,
        kickDelay: t.kickDelay,
        contactIn: t.contactIn,
        phase: t.phase,
        estimated: t.estimated,
        result: t.result,
        stage: 'set',
        cue: message('cueWaitSet'),
        detail: message('detailWaitSet'),
        tone: 'neutral',
        progress: 0,
    };
    // 결과 단계의 cue·detail은 결과 코드의 제목·설명이다(값은 결과의 code와 갈래).
    const outcome = t.attemptResult && { code: t.attemptResult.code, ...t.attemptResult.values };
    if (t.rallyPhase === 'point')
        return {
            ...base,
            stage: 'result',
            cue: outcome ? message('resultTitle', outcome) : message('cueRetry'),
            detail: outcome ? message('resultDetail', outcome) : message('none'),
            tone: t.attemptResult?.tone || 'neutral',
            progress: 1,
        };
    if (t.rallyPhase === 'ready')
        return {
            ...base,
            stage: 'ready',
            cue: message('cueNextToss'),
            detail: message('lessonSequence', { lesson: t.lesson }),
        };
    if (t.contact && (!t.jumpActive || !t.planned || t.phase === 'follow' || !t.kickHeld)) {
        const down = t.contact.foot && t.contact.downward && t.contact.outgoingY < -0.2;
        return {
            ...base,
            stage: 'contact',
            cue: message(
                down
                    ? 'cueStruckDown'
                    : t.contact.foot
                      ? 'cueFoot'
                      : /^lowerLeg/.test(t.contact.part)
                        ? 'cueShin'
                        : 'cueBody',
            ),
            detail: message(down ? 'detailWatchNet' : 'detailRetryTiming'),
            tone: down ? 'success' : 'retry',
            progress: 1,
        };
    }
    if (!t.set) return base;
    if (t.jumpActive) {
        const jump = t.shortJump ? 'tap' : t.jumpTime < t.jumpHold ? 'hold' : 'release';
        if (t.planned && t.kickHeld) {
            const follow = t.phase === 'follow',
                striking = t.phase === 'strike';
            const horizon = t.horizon;
            return {
                ...base,
                stage: follow ? 'contact' : 'kick',
                cue: message(follow ? 'cueLanding' : striking ? 'cueStriking' : 'cueRaising'),
                detail: follow ? message('detailLanding') : message('detailKeepKick', { jump }),
                tone: follow ? 'neutral' : 'ready',
                progress: follow
                    ? 1
                    : Math.max(
                          0,
                          Math.min(1, 1 - (t.contactIn ?? horizon) / Math.max(horizon, 0.01)),
                      ),
            };
        }
        const wait = !prehold && t.kickIn > 0;
        return {
            ...base,
            stage: 'kick',
            cue: message(wait ? 'cueRise' : t.kickHeld ? 'cueHoldKick' : 'cueKickNow'),
            detail: message(wait ? 'detailWaitKick' : 'detailPressKick', { jump }),
            tone: wait ? 'neutral' : 'ready',
            progress: Math.max(0, Math.min(1, t.jumpTime / Math.max(t.kickDelay, 0.01))),
        };
    }
    const guide = t.guide;
    if (!guide)
        return {
            ...base,
            stage: 'position',
            cue: message('cueBesideBall'),
            detail: message('detailGuideSoon'),
        };
    const progress = t.jumpIn === null ? 0 : Math.max(0, Math.min(1, 1 - t.jumpIn / maxLead));
    // The ground hold starts while approaching; waiting until the position
    // circle is reached can consume the whole preparation interval.
    if (guide.preholdWindow && !guide.preheld)
        return {
            ...base,
            stage: 'kick',
            cue: message(t.kickHeld ? 'cueKeepRaised' : 'cuePressFirst'),
            detail: message('detailPrehold'),
            tone: 'ready',
            progress,
        };
    if (!guide.inPosition || (!guide.settled && !guide.braking))
        return {
            ...base,
            stage: 'position',
            cue: message('cueMoveToFootprint', {
                holding: prehold && t.kickHeld,
            }),
            detail: message('detailPrediction'),
            progress,
        };
    if (guide.braking)
        return {
            ...base,
            stage: 'brake',
            cue: message('cueBrake', { holding: prehold && t.kickHeld }),
            detail: message('detailBrake'),
            tone: 'neutral',
            progress,
        };
    if (guide.jumpWindow)
        return {
            ...base,
            stage: 'jump',
            cue: message('cueJumpNow'),
            detail: message('detailJumpNow', {
                downward: prehold,
                short: t.shortJump,
            }),
            tone: 'ready',
            progress: 1,
        };
    if (guide.preholdWindow && t.kickHeld)
        return {
            ...base,
            stage: 'kick',
            cue: message('cueWaitJump'),
            detail: message('detailWaitJump'),
            tone: 'ready',
            progress,
        };
    return {
        ...base,
        stage: 'position',
        cue: message('cueJumpTiming'),
        detail: message('detailOrder', { downward: prehold }),
        progress,
    };
}

export { takrawTrainingCoach };
