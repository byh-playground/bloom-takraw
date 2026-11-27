import { impactStyleKey, takrawContactKind } from './impact.js';

/**
 * 득점 리플레이의 접촉 화면 이펙트. 워커의 그림자 경기가 보낸 접촉·바닥 이벤트를 재생 시각(틱)에 맞춰 TakrawImpactEffects로 띄운다.
 * - 이펙트는 재생 시각을 따라 슬로모션에서 함께 느려지고 일시 정지하면 멈춘다.
 * - 파동·명암, 공 눌림·늘어남, 속성 구름과 함께 스파이크 때 공과 찬 선수의 히트스톱·블링크를 보여준다.
 * - 재생이 끝나(replay 상태가 없어지면) 남은 이펙트는 바로 거둔다. 저널(롤백·확정)을 거치지 않는 표시 전용 경로다.
 */
class TakrawReplayImpacts {
    constructor({ impacts, config }) {
        this.impacts = impacts;
        this.impact = config.visual.impact;
        this.source = null;
        this.next = 0;
        this.nodes = [];
    }

    /** 화면 효과와 스파이크의 정지·복귀가 모두 끝날 때까지 노드를 유지한다. */
    lifetime(payload) {
        const { styles, intensity, spikeHitstop } = this.impact;
        const style = styles[impactStyleKey(styles, payload)];
        const effectMs = (style.hold + style.life * Math.sqrt(intensity.max)) * 1000;
        return payload.spike
            ? Math.max(effectMs, spikeHitstop.holdMs + spikeHitstop.recoveryMs)
            : effectMs;
    }

    /** replay: 재생 상태({ at, tickRate, events }) 또는 null(재생 중이 아님). 프레임마다 부른다. */
    sync(replay) {
        if (!replay) {
            if (this.source) this.clear();
            return;
        }
        if (replay.events !== this.source) {
            this.clear();
            this.source = replay.events;
        }
        const events = replay.events;
        while (this.next < events.length && events[this.next].tick <= replay.at) {
            const event = events[this.next++];
            const payload = {
                ...event,
                ...takrawContactKind(event, event.after),
                position: { ...event.position },
            };
            this.nodes.push({
                tick: event.tick,
                life: this.lifetime(payload),
                node: this.impacts.startReplay(payload),
            });
        }
        const live = [];
        for (const entry of this.nodes) {
            const age = ((replay.at - entry.tick) / replay.tickRate) * 1000;
            if (age >= entry.life) this.impacts.release(entry.node);
            else {
                this.impacts.update(entry.node, Math.max(0, age));
                live.push(entry);
            }
        }
        this.nodes = live;
    }

    clear() {
        for (const entry of this.nodes) this.impacts.release(entry.node);
        this.nodes.length = 0;
        this.source = null;
        this.next = 0;
    }
}

export { TakrawReplayImpacts };
