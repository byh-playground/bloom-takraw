/**
 * 몸 회전 기준 궤적. 공중 차기에서 몸이 축 둘레로 도는 각을 "한계 안에서 실제로 따라갈 수 있는" 스칼라 곡선 하나로 세우는 순수 계산이다
 * (docs/architecture.md "공중 차기의 몸 회전 기준 궤적"). 물리 엔진·설정을 모른다. 한계(각속도 상한, 시각마다의 토크 상한, 축 둘레 관성)는 부르는 쪽이
 * 실제 구동 설정과 실제 몸에서 읽어 넣는다. 계획에만 쓰는 값은 없다.
 *
 * 곡선은 5차 곡선이다: 지금 상태(각, 각속도, 각가속도)에서 접촉 시각의 끝 상태(각, 각속도, 각가속도 0)로 간다. 끝의 각가속도가 0이라 접촉을 일정한
 * 각속도로 지나간다. 시작 각가속도도 정해 둘 수 있어야 한다: 몸 회전 토크의 상한은 계획 시작에서 0이었다가 오르므로(지지, _airTurnSupport)
 * 시작 각가속도가 0이 아닌 곡선은 처음 몇 걸음의 토크를 낼 수 없다. 처음 시작은 각가속도 0이다. 곡선 위의 어느 상태(각, 각속도, 각가속도)에서
 * 다시 풀어도 같은 곡선이다.
 */

const sample = [0, 0, 0];

/**
 * 5차 곡선: 각 from, 각속도 rate, 각가속도 accel에서 remaining초 뒤의 각 to, 각속도 final, 각가속도 0으로 가는 진행도 u(0~1)의 값.
 * out = [각, 각속도, 각가속도].
 */
function turnCurve(from, rate, accel, to, final, remaining, u, out) {
    const h1 = rate * remaining,
        h2 = (accel * remaining * remaining) / 2;
    const d0 = to - from - h1 - h2,
        d1 = final * remaining - h1 - 2 * h2,
        d2 = -2 * h2;
    const c3 = 10 * d0 - 4 * d1 + 0.5 * d2,
        c4 = -15 * d0 + 7 * d1 - d2,
        c5 = 6 * d0 - 3 * d1 + 0.5 * d2;
    out[0] = from + u * (h1 + u * (h2 + u * (c3 + u * (c4 + u * c5))));
    out[1] = (h1 + u * (2 * h2 + u * (3 * c3 + u * (4 * c4 + u * 5 * c5)))) / remaining;
    out[2] = (2 * h2 + u * (6 * c3 + u * (12 * c4 + u * 20 * c5))) / (remaining * remaining);
    return out;
}

/**
 * 시작 상태 start = { angle, rate }에서 끝 상태 end = { angle, rate }까지 duration초의 곡선이 한계를 얼마나 쓰는지(1 이하면 한계 안).
 * limit = { rate, inertia, torque }: 각속도 상한(rad/s), 축 둘레 관성(kg·m²), 계획 시작 뒤 time초의 토크 상한을 내는 함수(N·m).
 * 표본마다 각속도 ÷ 상한과 관성 × |각가속도| ÷ 토크 상한 가운데 큰 값이다. 되돌아가는 곡선은 1을 넘는 것으로 센다: 각속도가 0보다
 * (이미 거꾸로 돌고 있던 몸이면 그 시작 각속도보다) 낮아지는 곡선이다. 거꾸로 돌던 몸이 앞으로 돌아서기까지의 구간은 되돌아가는 것이 아니다.
 * 표본은 고르게 나눈 samples칸의 가운데 지점과 끝이다. 시작 순간은 뺀다: 토크 상한이 0에서 오르기 시작해 나눌 수 없고, 시작 각가속도가 0인
 * 곡선이라 그 순간에 거는 토크도 0이다. 상한이 오르는 구간(지지 시간)도 칸 가운데 지점이 가장 이른 걸음의 요구를 본다.
 */
function bodyTurnUsage(start, end, duration, limit, samples) {
    const floor = Math.min(0, start.rate);
    let usage = 0;
    for (let index = 0; index <= samples + 1; index++) {
        // 첫 표본(index 0)은 시작 직후의 아주 이른 지점이다: 시작 각가속도가 0인 곡선의 요구와 오르는 토크 상한은 둘 다 시간에 비례하므로
        // 그 비가 시작 근처에서 가장 크다. 이른 걸음의 토크 부족은 거기서 본다.
        const u =
            index === 0 ? 0.5 / (samples * samples) : index > samples ? 1 : (index - 0.5) / samples;
        turnCurve(
            start.angle,
            start.rate,
            start.acceleration ?? 0,
            end.angle,
            end.rate,
            duration,
            u,
            sample,
        );
        const rate = sample[1],
            demand = limit.inertia * Math.abs(sample[2]);
        usage = Math.max(
            usage,
            rate < floor ? 1 + (floor - rate) / limit.rate : rate / limit.rate,
            demand > 0 ? demand / limit.torque(u * duration) : 0,
        );
    }
    return usage;
}

/**
 * 접촉 시각의 끝 상태를 고른다. want = { angle, rate }: 동작이 원하는 접촉 각과 접촉 각속도의 상한(둘 다 넘지 않는다).
 * search = { samples, bisection }: 곡선 표본 수, 찾는 칸 수이자 이분법 횟수(다리 관절 계획과 같은 값).
 * 고르는 순서(legPlanSolve와 같은 방식, 상수 없음):
 *   1. 원하는 그대로가 한계 안이면 그대로.
 *   2. 접촉 각속도: 어떤 접촉 각으로든 한계 안에 드는 가장 큰 값(want.rate 이하).
 *   3. 접촉 각: 그 각속도에서 한계 안에 드는 가장 큰 값(want.angle 이하, 시작 각 이상).
 *   어떻게 골라도 한계 안에 못 들면(이미 상한보다 빨리 돌거나 거꾸로 도는 몸, 토크가 오르기 전에 끝나는 짧은 계획) 한계를 가장 덜 넘는 끝 상태다.
 * 반환: { angle, rate, usage }. usage가 1을 넘으면 구동이 상한에 걸린다.
 */
function bodyTurnPlan(start, want, duration, limit, search) {
    const { samples, bisection } = search;
    const span = Math.max(0, want.angle - start.angle),
        end = { angle: 0, rate: 0 };
    // 끝 상태의 두 비율: angle = 시작 각 + turn × span, rate = spin × want.rate.
    const usageAt = (turn, spin) => {
        end.angle = start.angle + turn * span;
        end.rate = spin * want.rate;
        return bodyTurnUsage(start, end, duration, limit, samples);
    };
    // [0, 1]에서 cost가 가장 낮은 곳: 고르게 나눈 칸에서 가장 낮은 곳을 찾고 그 양옆 칸 안을 삼분해 좁힌다(cost는 끝 상태에 대해 골짜기가 하나다).
    const easiest = (cost) => {
        const step = 1 / bisection;
        let at = 0,
            usage = Infinity;
        for (let index = 0; index <= bisection; index++) {
            const value = cost(index * step);
            if (value < usage) {
                usage = value;
                at = index * step;
            }
        }
        let lo = Math.max(0, at - step),
            hi = Math.min(1, at + step);
        for (let index = 0; index < bisection; index++) {
            const third = (hi - lo) / 3;
            if (cost(lo + third) <= cost(hi - third)) hi -= third;
            else lo += third;
        }
        const middle = (lo + hi) / 2,
            value = cost(middle);
        return value < usage ? { at: middle, usage: value } : { at, usage };
    };
    // within(value)가 참인 가장 큰 value를 [from, 1]에서 찾는다. from에서는 참이어야 한다.
    const largest = (from, within) => {
        if (within(1)) return 1;
        let lo = from,
            hi = 1;
        for (let step = 0; step < bisection; step++) {
            const middle = (lo + hi) / 2;
            if (within(middle)) lo = middle;
            else hi = middle;
        }
        return lo;
    };
    const result = (turn, spin) => {
        const usage = usageAt(turn, spin);
        return { angle: end.angle, rate: end.rate, usage };
    };
    if (usageAt(1, 1) <= 1) return result(1, 1);
    // 그 접촉 각속도로 한계를 가장 덜 쓰는 접촉 각.
    const reach = (spin) => easiest((turn) => usageAt(turn, spin));
    let spin = 1,
        turn = reach(1);
    if (turn.usage > 1) {
        const best = easiest((value) => reach(value).usage);
        turn = reach(best.at);
        if (turn.usage > 1) return result(turn.at, best.at);
        spin = largest(best.at, (value) => {
            const found = reach(value);
            if (found.usage > 1) return false;
            turn = found;
            return true;
        });
        turn = reach(spin);
    }
    return result(
        largest(turn.at, (value) => usageAt(value, spin) <= 1),
        spin,
    );
}

/**
 * 기준 상태 turn = { angle, rate, acceleration, at, end: { angle, rate, at }, top }을 시각 to(초)까지 나아간다.
 * 접촉 시각(end.at) 전에는 끝 상태로 가는 곡선 위에서 옮긴다(기준 상태의 시각 at부터라, 구동이 빠진 걸음이 있어도 같은 곡선 위다).
 * 접촉 시각 뒤에는 접촉 각속도 그대로 일정하게 돌다가 동작의 끝 각(top)에서 멈춘다.
 */
function bodyTurnAdvance(turn, to) {
    const { end } = turn;
    if (to < end.at) {
        const remaining = end.at - turn.at;
        turnCurve(
            turn.angle,
            turn.rate,
            turn.acceleration,
            end.angle,
            end.rate,
            remaining,
            (to - turn.at) / remaining,
            sample,
        );
        [turn.angle, turn.rate, turn.acceleration] = sample;
    } else {
        const angle = end.angle + end.rate * (to - end.at);
        turn.angle = Math.min(turn.top, angle);
        turn.rate = angle < turn.top ? end.rate : 0;
        turn.acceleration = 0;
    }
    turn.at = to;
}

export { bodyTurnPlan, bodyTurnUsage, bodyTurnAdvance, turnCurve };
