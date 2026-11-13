import { PresentationEventQueue } from '@bloom-gamekit/presentation-events';
import { TAKRAW_CONFIG } from '../config/game.js';
import { TAKRAW_MODE_POLICY, TAKRAW_RUNTIME } from '../config/runtime.js';
import { impactStyleKey, takrawContactKind } from '../presentation/impact.js';
import { TakrawRumble } from '../presentation/rumble.js';
import { winningSpikeScore } from '../presentation/score-motion.js';
import { takrawMatchStatus } from '../presentation/match-status.js';
import { takrawSoundPayload } from '../presentation/sound.js';

/** 등급 표시가 바뀌었는지 비교하는 키. 같은 판정이 재확정될 때 표시를 다시 띄우지 않기 위해 쓴다. */
function badgeKey(timing) {
    return timing ? `${timing.grade}:${Math.round(timing.error * 1000)}` : '';
}

/**
 * 접촉·바닥 이벤트가 남는 시간(ms). 효과(파동·눌림·표시 히트스톱과 따라잡기)와 등급 표시가 끝날 때까지 유지한다.
 * 접촉 종류별 연출은 가장 센 세기의 수명까지 남긴다.
 */
function contactDuration(payload) {
    const { duration, badge } = TAKRAW_RUNTIME.feedback;
    const { visual } = TAKRAW_CONFIG,
        impact = visual.impact.styles[impactStyleKey(visual.impact.styles, payload)];
    const effect = Math.max(
        (impact.hold + impact.life * Math.sqrt(visual.impact.intensity.max)) * 1000,
        (impact.displayHold ?? 0) * (1 + visual.impact.displayCatchUp) * 1000,
    );
    if (!payload.timing && !payload.spike) return Math.max(duration, effect);
    return Math.max(
        duration,
        badge,
        effect,
        (impact.shake?.duration ?? 0) * 1000,
        payload.spike ? (impact.hold + visual.impactElements.life) * 1000 : 0,
    );
}

/**
 * 경기 이벤트(접촉·착지·득점·소리)의 표현 저널. gamekit PresentationEventQueue와 롤백 중 여부, 마지막 접촉을 소유한다.
 * 세션마다 replace()로 새 큐를 만들고 close()로 닫는다. 보는 모드·팀은 perspective()로 읽는다.
 */
class MatchEventJournal {
    constructor({ config, view, ui, audio, perspective }) {
        this.config = config;
        this.view = view;
        this.ui = ui;
        this.audio = audio;
        this.perspective = perspective;
        this.queue = null;
        this.inRollback = false;
        this.contact = null;
        this.rumble = new TakrawRumble({ reducedMotion: () => view.reducedMotion() });
    }

    /** 마지막 접촉 이벤트(진단·득점 연출 판정). */
    get lastContact() {
        return this.contact;
    }

    /** 이 경기의 마지막 접촉을 잊는다(보간 리셋과 같은 때). */
    forgetContact() {
        this.contact = null;
    }

    /** 새 큐로 바꾼다(세션 시작·합류·복구). 이전 큐의 표시 자원은 모두 정리된다. */
    replace() {
        this.queue?.dispose();
        this.inRollback = false;
        const { view, ui, audio, perspective, rumble } = this;
        const showHitPop = (payload) => {
            const text =
                TAKRAW_CONFIG.visual.impact.styles[
                    impactStyleKey(TAKRAW_CONFIG.visual.impact.styles, payload)
                ].pop;
            return text ? ui.showHitPop(text, payload.team) : null;
        };
        // 접촉 효과 시작(사용자 조작 팀의 접촉이면 기기 진동도). 반환한 노드를 update·release에 넘긴다.
        const startImpact = (payload) => {
            const { team } = perspective();
            if (payload.team === team) this.rumble.play(payload);
            return view.impacts.start(payload);
        };
        const updateImpact = (handle, ageMs) => view.impacts.update(handle.impact, ageMs);
        const showBadge = (payload) => {
            const { team } = perspective();
            return payload.timing && payload.team === team
                ? ui.showTiming(payload.timing)
                : null;
        };
        this.queue = new PresentationEventQueue({
            retentionTicks: TAKRAW_RUNTIME.feedback.retentionTicks,
            adapters: {
                contact: {
                    reversible: true,
                    start(event) {
                        audio.duck('touch');
                        return {
                            impact: startImpact(event.payload),
                            badge: showBadge(event.payload),
                            badgeKey: badgeKey(event.payload.timing),
                            pop: showHitPop(event.payload),
                        };
                    },
                    update: updateImpact,
                    // 같은 이벤트의 재확정은 경과 시간을 유지한 채 모양과 등급 표시만 갱신한다.
                    reconcile(handle, event) {
                        view.impacts.reconcile(handle.impact, event.payload);
                        const key = badgeKey(event.payload.timing);
                        if (key === handle.badgeKey) return;
                        ui.hideTiming(handle.badge);
                        handle.badge = showBadge(event.payload);
                        handle.badgeKey = key;
                    },
                    stop(handle) {
                        view.impacts.release(handle.impact);
                        ui.hideTiming(handle.badge);
                        ui.hideHitPop(handle.pop);
                    },
                },
                // 공이 바닥에 닿음: 위아래 눌림·약한 파동·그림자 반응·소리. 접촉처럼 추측 이벤트라 롤백되면 사라진다.
                ground: {
                    reversible: true,
                    start: (event) => ({ impact: startImpact(event.payload) }),
                    update: updateImpact,
                    reconcile(handle, event) {
                        view.impacts.reconcile(handle.impact, event.payload);
                    },
                    stop: (handle) => view.impacts.release(handle.impact),
                },
                // 선수 착지 먼지: 접촉처럼 추측 이벤트라 롤백되면 사라진다.
                land: {
                    reversible: true,
                    start(event) {
                        return { node: view.field.startLand(event.payload) };
                    },
                    update(handle, ageMs) {
                        if (handle.node) view.field.update(handle.node, ageMs);
                    },
                    reconcile() {},
                    stop(handle) {
                        view.field.release(handle.node);
                    },
                },
                // 득점 색종이: 확정된 득점에만 터진다.
                score: {
                    reversible: false,
                    start(event) {
                        view.startCheer(performance.now());
                        audio.duck('point');
                        if (
                            TAKRAW_MODE_POLICY[perspective().mode]?.scoreMotion &&
                            event.payload.winningSpike &&
                            !view.reducedMotion()
                        )
                            view.scoreMotion.start(performance.now());
                        // 득점 착지(표시 전용): 바닥에 닿은 점의 큰 파동, 점수 숫자 튐, 득점 팀 사용자의 진동. 파동·진동은 동작 줄이기에서 꺼진다.
                        const { team } = perspective();
                        const landing = event.payload.landing;
                        const impact =
                            landing && !view.reducedMotion()
                                ? view.impacts.start({
                                      ...event.payload,
                                      kind: 'score',
                                      style: 'scoreLand',
                                      position: { x: landing.x, y: 0, z: landing.z },
                                  })
                                : null;
                        ui.bumpScore(event.payload.team);
                        if (event.payload.team === team)
                            rumble.play({ ...event.payload, kind: 'score', style: 'scoreLand' });
                        return { node: view.field.startConfetti(event.payload), impact };
                    },
                    update(handle, ageMs) {
                        if (handle.node) view.field.update(handle.node, ageMs);
                        if (handle.impact) view.impacts.update(handle.impact, ageMs);
                    },
                    reconcile() {},
                    stop(handle) {
                        view.field.release(handle.node);
                        if (handle.impact) view.impacts.release(handle.impact);
                    },
                },
                sound: audio.eventAdapter((event) => this.queue?.finish(event)),
            },
        });
    }

    /** 한 스텝의 시뮬레이션 이벤트를 저널에 넣는다. 복구·재생 스텝은 넣지 않는다. */
    emit(frame, data) {
        if (!this.queue || frame.recovering || frame.replaying) return;
        const config = this.config,
            journal = this.queue;
        let previousEvent = null;
        for (const event of data.events) {
            if (event.type === 'serve') this.contact = null;
            const identity = {
                tick: event.tick,
                sequence: event.sequence,
                entityId: event.playerId >= 0 ? `player:${event.playerId}` : 'court',
                generation: 0,
            };
            // 접촉 종류(표시 전용): 이 스텝 뒤 경기 상태(touches·play)로 고른다. 효과·소리가 같은 값을 쓴다.
            const contact =
                event.type === 'touch' || event.type === 'ground'
                    ? takrawContactKind(event, data.state)
                    : null;
            if (event.type === 'touch') {
                this.contact = { ...event, position: { ...event.position } };
                const payload = { ...event, ...contact, position: { ...event.position } };
                journal.emit({
                    ...identity,
                    kind: 'contact',
                    payload,
                    policy: 'speculative',
                    durationMs: contactDuration(payload),
                });
            } else if (event.type === 'ground') {
                const payload = {
                    ...event,
                    ...contact,
                    speed: data.state.ballSpeed,
                    position: { ...event.position },
                };
                journal.emit({
                    ...identity,
                    kind: 'ground',
                    payload,
                    policy: 'speculative',
                    durationMs: contactDuration(payload),
                });
            }
            const matchPoint =
                event.type === 'point' &&
                takrawMatchStatus(data.state, config.rules).matchPointTeams.length > 0;
            if (event.type === 'land') {
                journal.emit({
                    ...identity,
                    kind: 'land',
                    payload: { ...event, position: { ...event.position } },
                    policy: 'speculative',
                    durationMs: TAKRAW_CONFIG.visual.field.land.life * 1000,
                });
            } else if (event.type === 'point') {
                const { halfLength } = TAKRAW_CONFIG.court;
                journal.emit({
                    ...identity,
                    kind: 'score',
                    payload: {
                        ...event,
                        winningSpike: winningSpikeScore(event, previousEvent, this.contact),
                        landing: { ...event.position },
                        position: { x: ((event.team === 0 ? -1 : 1) * halfLength) / 2, y: 0, z: 0 },
                    },
                    policy: 'confirmed',
                    durationMs: TAKRAW_CONFIG.visual.field.confetti.life * 1000,
                });
            }
            // 소리는 표시 전용이라 변주(좌우·음높이)에 Math.random을 쓴다. 롤백으로 같은 이벤트가 다시 나와도 저널이 같은 식별자의 중복을 버려 소리는 한 번만 난다.
            const sound = takrawSoundPayload(event, {
                reference: TAKRAW_RUNTIME.feedback.soundReferenceSpeed,
                halfWidth: config.court.halfWidth,
                halfLength: config.court.halfLength,
                viewTeam: this.perspective().team,
                panSpread: TAKRAW_RUNTIME.feedback.soundPanSpread,
                detuneCents: TAKRAW_RUNTIME.feedback.soundDetuneCents,
                distanceDrop: TAKRAW_RUNTIME.feedback.soundDistanceDrop,
                random: Math.random,
                matchPoint,
                contact,
            });
            if (sound)
                journal.emit({ ...identity, kind: 'sound', payload: sound, policy: 'confirmed' });
            previousEvent = event;
        }
    }

    /** 세션이 확정한 틱까지 추측 이벤트를 확정한다. 롤백 중에는 하지 않는다. */
    confirm(session) {
        if (!this.queue || !session || this.inRollback) return;
        const tick = Math.min(session.confirmedTick, session.tick - 1);
        if (tick >= 0 && tick >= this.queue.confirmedTick) this.queue.confirmThrough(tick);
    }

    beginRollback(from) {
        if (this.queue && !this.inRollback) {
            this.queue.beginRollback(Math.max(from, this.queue.confirmedTick + 1));
            this.inRollback = true;
        }
    }

    endRollback() {
        if (this.inRollback) this.queue.endRollback();
        this.inRollback = false;
    }

    update(now) {
        this.queue?.update(now);
    }

    /** 세션이 끝나 큐를 닫는다. */
    close() {
        this.queue?.dispose();
        this.queue = null;
        this.inRollback = false;
    }

    dispose() {
        this.close();
    }
}

export { MatchEventJournal };
