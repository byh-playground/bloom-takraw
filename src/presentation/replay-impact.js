import { impactStyleKey, takrawContactKind } from './impact.js';

/**
 * 득점 리플레이의 접촉 화면 이펙트. 워커의 그림자 경기가 보낸 접촉·바닥 이벤트를 재생 시각(틱)에 맞춰 TakrawImpactEffects로 띄운다.
 * - 경과 시간은 실제 시간이 아니라 재생 시각에서 나와, 스파이크 앞뒤 슬로모션이면 파동·눌림·구름도 같이 느려지고 일시 정지하면 멈춘다.
 * - 화면 이펙트만 재현한다: 파동·명암, 공·발 반짝임, 공 눌림·늘어남, 속성 구름. 표시 히트스톱·기기 진동·화면 진동·확대·글자·소리는 리플레이에서 내지 않는다.
 * - 재생이 끝나(replay 상태가 없어지면) 남은 이펙트는 바로 거둔다. 저널(롤백·확정)을 거치지 않는 표시 전용 경로다.
 */
class TakrawReplayImpacts {
    constructor({ impacts, config }) {
        this.impacts = impacts;
        this.styles = config.visual.impact.styles;
        this.maxStrength = config.visual.impact.intensity.max;
        this.source = null;
        this.next = 0;
        this.nodes = [];
    }

    /** 접촉 효과가 남는 시간(ms): 정지 구간 + 수명(가장 센 세기 기준). 히트스톱(displayHold)은 세지 않는다. */
    lifetime(payload) {
        const style = this.styles[impactStyleKey(this.styles, payload)];
        return (style.hold + style.life * Math.sqrt(this.maxStrength)) * 1000;
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
