/**
 * 득점 순간 연출(표시 전용 시안). 꺼져 있으면(variant null) 아무것도 하지 않아 기존 연출 그대로다.
 * 시안은 누적이다: A = 착지점 큰 파동 + 점수 숫자 반응 + 득점 팀 진동, B = A + 착지 표시 히트스톱, C = B + 득점 팀 색 곱셈 스침, D = B + 착지점 둘레만 남기는 가장자리 곱셈 어두워짐.
 * 모두 화면 픽셀에 곱하거나(shock-wave 패스) 물체의 포즈·DOM 숫자만 건드리고 아무것도 덧그리지 않는다. 시뮬레이션·시간·네트워크에는 쓰지 않는다.
 * 파동은 접촉 효과(impacts)의 노드 하나를 쓰고, 색 곱셈·가장자리 어두워짐은 shock-wave의 기존 패스 한 번에 얹힌다(새 장면 객체·재질·드로우콜 없음).
 */
const VARIANTS = Object.freeze({
    A: Object.freeze({ style: 'scoreLand', tint: false, spot: false }),
    B: Object.freeze({ style: 'scoreLandHold', tint: false, spot: false }),
    C: Object.freeze({ style: 'scoreLandHold', tint: true, spot: false }),
    D: Object.freeze({ style: 'scoreLandHold', tint: false, spot: true }),
});

class TakrawScoreMoment {
    constructor({ THREE, config, impacts, teamColor, reducedMotion }) {
        this.THREE = THREE;
        this.settings = config.visual.scoreMoment;
        this.impacts = impacts;
        this.teamColor = teamColor;
        this.reducedMotion = reducedMotion;
        this.variant = null;
        this.active = new Set();
    }

    /** 확인용 장면이 고른다. 이름이 없으면 끈다. 모르는 이름은 그대로 실패한다. */
    select(name) {
        if (name === null || name === undefined || name === '') this.variant = null;
        else if (VARIANTS[name]) this.variant = VARIANTS[name];
        else throw new Error(`score must be one of ${Object.keys(VARIANTS).join(',')}: ${name}`);
    }

    get enabled() {
        return this.variant !== null && !this.reducedMotion();
    }

    /** 확정된 득점 이벤트 payload(landing = 공이 닿은 점, team = 득점 팀)로 시작한다. 꺼져 있으면 null. */
    start(payload) {
        if (!this.enabled || !payload.landing) return null;
        const { x, z } = payload.landing;
        const node = {
            impact: this.impacts.start({
                ...payload,
                kind: 'score',
                style: this.variant.style,
                position: { x, y: 0, z },
            }),
            x,
            z,
            team: payload.team,
            age: 0,
            tint: this.variant.tint,
            spot: this.variant.spot,
        };
        this.active.add(node);
        return node;
    }

    update(node, ageMs) {
        node.age = ageMs;
        this.impacts.update(node.impact, ageMs);
    }

    release(node) {
        if (!this.active.delete(node)) return;
        this.impacts.release(node.impact);
    }

    /**
     * 지금 화면에 곱할 보정을 out에 채운다(가장 센 하나). tintAmount·spotAmount가 0이면 없다.
     * 세기는 0→1→0(sin)으로 한 번 오르내린다.
     */
    grade(out) {
        out.tintAmount = 0;
        out.spotAmount = 0;
        for (const node of this.active) {
            const { tint, spot } = this.settings,
                seconds = node.age / 1000;
            if (node.tint && seconds < tint.life) {
                const amount = tint.amount * Math.sin((Math.PI * seconds) / tint.life);
                if (amount > out.tintAmount) {
                    out.tintAmount = amount;
                    out.tintHex = this.teamColor(node.team);
                }
            }
            if (node.spot && seconds < spot.life) {
                const amount = spot.amount * Math.sin((Math.PI * seconds) / spot.life);
                if (amount > out.spotAmount) {
                    out.spotAmount = amount;
                    out.spotRadius = spot.radius;
                    out.spot.set(node.x, 0, node.z);
                }
            }
        }
    }

    dispose() {
        for (const node of this.active) this.impacts.release(node.impact);
        this.active.clear();
    }
}

export { TakrawScoreMoment, VARIANTS as SCORE_MOMENT_VARIANTS };
