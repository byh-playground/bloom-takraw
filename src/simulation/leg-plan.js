/**
 * 다리 관절 공간 계획. 차기 계획(접촉점·접촉 순간 발 속도)과 관절 구동이 같은 다리 모델을 쓰게 하는 순수 계산이다(docs/architecture.md "지상 토스 다리 관절 계획").
 * 물리 엔진·설정을 모른다. 모델(실제 몸 부위의 질량·길이·관성, 실제 관절 모터의 최대 토크, 발-골반 힘의 상한과 힘-속도 한계, 무릎 범위)은 부르는 쪽이 넣는다.
 *
 * 관절 좌표 q = [엉덩이 굽힘, 엉덩이 벌림, 무릎 굽힘] (rad). 골반 좌표는 x 오른쪽, y 위, z 앞이다.
 *   엉덩이: 허벅지의 골반에 대한 상대 사원수가 (sin(굽힘/2), 0, sin(벌림/2), w)다. Rapier 구형 관절 모터의 축별 목표각이 만드는 자세와 같다
 *     (굽힘 음수 = 다리가 앞으로 올라감, 벌림 양수 = 오른쪽으로).
 *   무릎: 허벅지 x축 경첩, 양수 = 정강이가 뒤로.
 * 기구학과 동역학은 같은 두 방향 벡터(허벅지 방향·정강이 방향, legAxes)에서 나온다: 발목 자리, 야코비안, 관절 토크가 굽힘과 벌림이 함께 있어도 같은 자세를 본다.
 * 동역학: 허벅지·정강이 막대(중심 둘레 관성 포함)와 발목에 붙은 발 질점. 발은 발 방향 제어가 세계 기준으로 잡고 있어 회전 관성을 넣지 않는다.
 *
 * 구동기는 둘이다: 관절 모터(엉덩이 굽힘·벌림, 무릎. 축마다 최대 토크)와 발목에 거는 발-골반 힘(크기 상한, 엉덩이에 대한 발 속도가 빠를수록 미는 힘이 줄어듦).
 * 궤적이 요구하는 관절 토크는 모터가 최대 토크 안에서 맡고, 모터만으로 모자랄 때만 발-골반 힘이 가장 작은 크기로 거든다(legActuation). 계획의 한계 판정과 실제 구동이 이 나눔을 같이 쓴다.
 *
 * 쓰는 쪽은 접촉 조건만 정한다: 접촉 순간의 발목 자리와 원하는 발목 속도(엉덩이 기준)를 legPlanSolve에 넘기면 휘두르기 길이와
 * 낼 수 있는 끝 상태(관절 각·각속도·각가속도)가 나오고, 걸음마다 legPlanAdvance로 기준 궤적을 나아가며 legTorques·legActuation으로 그 궤적의 모터 토크와 발-골반 힘을 얻는다.
 */

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const AXES = ['x', 'y', 'z'];

/**
 * 다리 모델. upper·lower: 허벅지·정강이 길이(m). upperMass·lowerMass·footMass(kg). upperInertia·lowerInertia: 막대 중심의 굽힘축 관성(kg·m²).
 * hipTorque·kneeTorque: 그 관절 모터의 최대 토크(N·m). footForce: 발-골반 힘의 상한(N).
 * maxFootSpeed: 엉덩이에 대한 발목 속도 한계(m/s). 발-골반 힘은 발이 움직이는 방향으로 (1 - 속도/maxFootSpeed)배만 밀 수 있다.
 * kneeMin·kneeMax: 무릎 범위(rad). reachMin·reachMax: 엉덩이~발목 거리 범위(m). gravity(m/s²)와 down(골반 좌표의 중력 방향 단위 벡터).
 */
function legPlanModel(parts) {
    const { upper, lower, upperMass, lowerMass, footMass, upperInertia, lowerInertia } = parts;
    const upperCenter = upper / 2,
        lowerCenter = lower / 2;
    return {
        ...parts,
        // 질량 분포의 모멘트: 질량이 엉덩이에서 (허벅지 방향 × α + 정강이 방향 × β)에 있을 때 Σmα², Σmβ², Σmαβ, Σmα, Σmβ(legTorques).
        thighInertia:
            upperInertia +
            upperMass * upperCenter * upperCenter +
            (lowerMass + footMass) * upper * upper,
        shankInertia:
            lowerInertia + lowerMass * lowerCenter * lowerCenter + footMass * lower * lower,
        coupling: (lowerMass * lowerCenter + footMass * lower) * upper,
        thighMoment: upperMass * upperCenter + (lowerMass + footMass) * upper,
        shankMoment: lowerMass * lowerCenter + footMass * lower,
    };
}

/**
 * 허벅지 방향(엉덩이 → 무릎)과 정강이 방향(무릎 → 발목)의 단위 벡터(골반 좌표). 순기구학·야코비안·역동역학이 모두 이 둘에서 나온다.
 * turn = { thigh: [3], shank: [3] }을 주면 두 방향의 관절 각 미분(관절 j가 그 방향을 돌리는 정도)도 채운다.
 */
function legAxes(q, thigh, shank, turn = null) {
    const a = Math.sin(q[0] / 2),
        c = Math.sin(q[1] / 2),
        w = Math.sqrt(Math.max(1e-18, 1 - a * a - c * c));
    // 엉덩이 사원수 (a, 0, c, w)로 허벅지 좌표의 (0, y, z)를 돌린다. 허벅지는 (0, -1, 0), 정강이는 무릎 각만큼 꺾인 (0, -cos, -sin).
    const y = -Math.cos(q[2]),
        z = -Math.sin(q[2]),
        bend = a * a + c * c;
    thigh.x = 2 * w * c;
    thigh.y = 2 * bend - 1;
    thigh.z = -2 * w * a;
    shank.x = -2 * w * c * y + 2 * a * c * z;
    shank.y = y - 2 * w * a * z - 2 * bend * y;
    shank.z = z + 2 * w * a * y - 2 * a * a * z;
    if (!turn) return;
    // a, c, w의 굽힘(0)·벌림(1) 미분.
    const a0 = Math.cos(q[0] / 2) / 2,
        c1 = Math.cos(q[1] / 2) / 2,
        w0 = (-a * a0) / w,
        w1 = (-c * c1) / w;
    const lift = w0 * a + w * a0,
        side = w1 * c + w * c1;
    let out = turn.thigh[0];
    out.x = 2 * w0 * c;
    out.y = 4 * a * a0;
    out.z = -2 * lift;
    out = turn.thigh[1];
    out.x = 2 * side;
    out.y = 4 * c * c1;
    out.z = -2 * w1 * a;
    out = turn.thigh[2];
    out.x = out.y = out.z = 0;
    out = turn.shank[0];
    out.x = -2 * w0 * c * y + 2 * a0 * c * z;
    out.y = -2 * lift * z - 4 * a * a0 * y;
    out.z = 2 * lift * y - 4 * a * a0 * z;
    out = turn.shank[1];
    out.x = -2 * side * y + 2 * a * c1 * z;
    out.y = -2 * w1 * a * z - 4 * c * c1 * y;
    out.z = 2 * w1 * a * y;
    // 무릎(2): y, z의 미분은 (sin, -cos) = (-z, y).
    out = turn.shank[2];
    out.x = 2 * w * c * z + 2 * a * c * y;
    out.y = -z - 2 * w * a * y + 2 * bend * z;
    out.z = y - 2 * w * a * z - 2 * a * a * y;
}

const ankleThigh = { x: 0, y: 0, z: 0 },
    ankleShank = { x: 0, y: 0, z: 0 };

/** 순기구학: 엉덩이 관절에서 본 발목 위치(골반 좌표). */
function legAnkle(model, q, out = {}) {
    legAxes(q, ankleThigh, ankleShank);
    out.x = model.upper * ankleThigh.x + model.lower * ankleShank.x;
    out.y = model.upper * ankleThigh.y + model.lower * ankleShank.y;
    out.z = model.upper * ankleThigh.z + model.lower * ankleShank.z;
    return out;
}

/** 역기구학(닫힌 식): 엉덩이 관절에서 본 발목 위치 → 관절 각. 거리는 [reachMin, reachMax]로 자르고 방향은 그대로 둔다. */
function legJoints(model, ankle, out = [0, 0, 0]) {
    const { upper, lower } = model;
    const length = Math.hypot(ankle.x, ankle.y, ankle.z),
        reach = clamp(length, model.reachMin, model.reachMax);
    const knee =
        Math.PI -
        Math.acos(
            clamp((upper * upper + lower * lower - reach * reach) / (2 * upper * lower), -1, 1),
        );
    out[2] = knee;
    out[0] = 0;
    out[1] = 0;
    if (length < 1e-9) return out;
    // 허벅지 좌표의 발목 방향 u를 목표 방향 r로 돌리는 회전 가운데, 축이 xz 평면에 있는 것(사원수 y 성분 0)이 엉덩이 자세다.
    const uy = (-upper - lower * Math.cos(knee)) / reach,
        uz = (-lower * Math.sin(knee)) / reach;
    const rx = ankle.x / length,
        ry = ankle.y / length,
        rz = ankle.z / length;
    let nx = uz - rz,
        nz = rx;
    const axis = Math.hypot(nx, nz);
    if (axis < 1e-9) return out;
    nx /= axis;
    nz /= axis;
    const un = nz * uz,
        rn = nx * rx + nz * rz;
    const ux = -un * nx,
        uzPerp = uz - un * nz,
        rxPerp = rx - rn * nx,
        rzPerp = rz - rn * nz;
    // n · (u⊥ × r⊥), u⊥ · r⊥ (두 벡터의 y 성분은 uy, ry 그대로다).
    const sine = nx * (uy * rzPerp - uzPerp * ry) + nz * (ux * ry - uy * rxPerp),
        cosine = ux * rxPerp + uy * ry + uzPerp * rzPerp;
    const half = Math.sin(Math.atan2(sine, cosine) / 2);
    out[0] = 2 * Math.asin(clamp(nx * half, -1, 1));
    out[1] = 2 * Math.asin(clamp(nz * half, -1, 1));
    return out;
}

const vector = () => ({ x: 0, y: 0, z: 0 });
const jacobianThigh = vector(),
    jacobianShank = vector(),
    jacobianTurn = {
        thigh: [vector(), vector(), vector()],
        shank: [vector(), vector(), vector()],
    },
    jacobian = [0, 0, 0, 0, 0, 0, 0, 0, 0];

/** 순기구학의 야코비안(행 x·y·z, 열 관절)을 jacobian에 채우고 행렬식을 돌려준다. 방향 벡터의 관절 각 미분은 jacobianTurn에 남는다. */
function fillJacobian(model, q) {
    legAxes(q, jacobianThigh, jacobianShank, jacobianTurn);
    for (let j = 0; j < 3; j++) {
        const thigh = jacobianTurn.thigh[j],
            shank = jacobianTurn.shank[j];
        jacobian[j] = model.upper * thigh.x + model.lower * shank.x;
        jacobian[3 + j] = model.upper * thigh.y + model.lower * shank.y;
        jacobian[6 + j] = model.upper * thigh.z + model.lower * shank.z;
    }
    const [a, b, c, d, e, f, g, h, i] = jacobian;
    return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

/** 발목 속도(엉덩이 기준, 골반 좌표) → 관절 각속도. 다리가 곧게 펴져 풀 수 없으면 0이다. */
function legJointVelocity(model, q, velocity, out = [0, 0, 0]) {
    const determinant = fillJacobian(model, q);
    if (Math.abs(determinant) < 1e-9) {
        out[0] = out[1] = out[2] = 0;
        return out;
    }
    const [a, b, c, d, e, f, g, h, i] = jacobian;
    const { x, y, z } = velocity;
    out[0] = (x * (e * i - f * h) - b * (y * i - f * z) + c * (y * h - e * z)) / determinant;
    out[1] = (a * (y * i - f * z) - x * (d * i - f * g) + c * (d * z - y * g)) / determinant;
    out[2] = (a * (e * z - y * h) - b * (d * z - y * g) + x * (d * h - e * g)) / determinant;
    return out;
}

/** 관절 각속도 → 엉덩이에 대한 발목 속도(골반 좌표). */
function legAnkleVelocity(model, q, qd, out = {}) {
    fillJacobian(model, q);
    out.x = jacobian[0] * qd[0] + jacobian[1] * qd[1] + jacobian[2] * qd[2];
    out.y = jacobian[3] * qd[0] + jacobian[4] * qd[1] + jacobian[5] * qd[2];
    out.z = jacobian[6] * qd[0] + jacobian[7] * qd[1] + jacobian[8] * qd[2];
    return out;
}

/** 시간 차분(관절 각속도·각가속도, 방향 벡터의 가속)의 간격(ms). */
const DIFFERENCE_MS = 1;
const DIFFERENCE = DIFFERENCE_MS / 1000;
const accelerationAngles = [0, 0, 0],
    accelerationNow = vector(),
    accelerationBefore = vector(),
    accelerationAfter = vector(),
    accelerationRate = [0, 0, 0];

/** 관절 각·각속도·각가속도로 가는 발목의 가속(엉덩이 기준, 골반 좌표). 궤적을 DIFFERENCE_MS 앞뒤로 옮긴 차분이다. */
function legAnkleAcceleration(model, q, qd, qdd, out = {}) {
    legAnkle(model, q, accelerationNow);
    for (let j = 0; j < 3; j++)
        accelerationAngles[j] = q[j] - qd[j] * DIFFERENCE + 0.5 * qdd[j] * DIFFERENCE * DIFFERENCE;
    legAnkle(model, accelerationAngles, accelerationBefore);
    for (let j = 0; j < 3; j++)
        accelerationAngles[j] = q[j] + qd[j] * DIFFERENCE + 0.5 * qdd[j] * DIFFERENCE * DIFFERENCE;
    legAnkle(model, accelerationAngles, accelerationAfter);
    for (const axis of AXES)
        out[axis] =
            (accelerationAfter[axis] - 2 * accelerationNow[axis] + accelerationBefore[axis]) /
            (DIFFERENCE * DIFFERENCE);
    return out;
}

/**
 * 발목이 자리 ankle을 속도 velocity·가속 acceleration으로 지날 때의 관절 각가속도(발목 가속 = J q̈ + J̇ q̇를 푼 값).
 * 그 길의 DIFFERENCE_MS 앞·지금·뒤 자리를 각각 역기구학으로 풀어 관절 각의 차분으로 구한다. 세 자리 모두 다리가 닿는 거리로 잘리므로(legJoints)
 * 닿는 거리 밖으로 나가는 길에서는 거리 한계를 따라 도는 길의 각가속도가 나온다(자리·속도·가속이 같은 잘린 길에서 나온다).
 */
function legJointAcceleration(model, ankle, velocity, acceleration, out = [0, 0, 0]) {
    const at = (sign, angles) => {
        for (const axis of AXES)
            accelerationNow[axis] =
                ankle[axis] +
                sign * velocity[axis] * DIFFERENCE +
                0.5 * acceleration[axis] * DIFFERENCE * DIFFERENCE;
        return legJoints(model, accelerationNow, angles);
    };
    at(-1, accelerationAngles);
    at(1, accelerationRate);
    legJoints(model, ankle, out);
    for (let j = 0; j < 3; j++)
        out[j] =
            (accelerationRate[j] - 2 * out[j] + accelerationAngles[j]) / (DIFFERENCE * DIFFERENCE);
    return out;
}

const strokePoint = {},
    strokeNow = [0, 0, 0],
    strokeNext = [0, 0, 0],
    strokeLater = [0, 0, 0];

/**
 * 발목이 엉덩이 기준 자리 ankle을 속도 velocity로 지나 곧게 나아갈 때, 지난 뒤 time초의 관절 상태(out = { position, velocity, acceleration }).
 * 다리가 닿는 거리 밖으로 나가는 곧은 길은 그 거리에서 잘려(legJoints) 엉덩이 둘레를 도는 길이 된다. 그래서 다리가 다 펴진 자리에서는 멀어지는 속도 몫이
 * 저절로 빠진다. 각속도·각가속도는 그 길을 DIFFERENCE_MS 간격으로 푼 차분이다.
 */
function legStroke(model, ankle, velocity, time, out) {
    const at = (offset, angles) => {
        strokePoint.x = ankle.x + velocity.x * (time + offset);
        strokePoint.y = ankle.y + velocity.y * (time + offset);
        strokePoint.z = ankle.z + velocity.z * (time + offset);
        return legJoints(model, strokePoint, angles);
    };
    at(0, strokeNow);
    at(DIFFERENCE, strokeNext);
    at(2 * DIFFERENCE, strokeLater);
    for (let j = 0; j < 3; j++) {
        out.position[j] = strokeNow[j];
        out.velocity[j] =
            (-3 * strokeNow[j] + 4 * strokeNext[j] - strokeLater[j]) / (2 * DIFFERENCE);
        out.acceleration[j] =
            (strokeNow[j] - 2 * strokeNext[j] + strokeLater[j]) / (DIFFERENCE * DIFFERENCE);
    }
    return out;
}

/**
 * 관절 하나의 궤적: 지금 상태(각 from, 각속도 rate)에서 remaining초 뒤의 끝 상태(각 to, 각속도 final, 각가속도 curve)로 가는 4차 곡선의 진행도 u(0~1) 값.
 * 끝의 각가속도까지 맞추므로 접촉을 지나 곧게 나아가는 따라 차기(legStroke)와 각·각속도·각가속도가 이어진다: 접촉 직전에 급히 꺾이지 않고, 발이 조금 늦게 닿아도
 * 속도가 같다. 곡선 위의 어느 상태에서 다시 풀어도 같은 곡선이다. out = [각, 각속도, 각가속도].
 */
function legCurve(from, rate, to, final, curve, remaining, u, out) {
    const lead = rate * remaining,
        a = to - from - lead,
        b = final * remaining - lead,
        c = curve * remaining * remaining;
    const square = c / 2 + 6 * a - 3 * b,
        cube = -c - 8 * a + 5 * b,
        quartic = c / 2 + 3 * a - 2 * b;
    out[0] = from + u * (lead + u * (square + u * (cube + u * quartic)));
    out[1] = (lead + u * (2 * square + u * (3 * cube + u * 4 * quartic))) / remaining;
    out[2] = (2 * square + u * (6 * cube + u * 12 * quartic)) / (remaining * remaining);
    return out;
}

/** 구동 나눔(legActuation)의 반복 횟수. 제약 3개의 볼록 문제라 이 횟수면 수렴한다(다리가 거의 곧을 때가 가장 느리다). */
const SPLIT_SWEEPS = 16;
const splitShare = [0, 0, 0];

/**
 * 구동 나눔: 관절 토크 torque를 모터 몫(out.motor, 축마다 최대 토크 안)과 발-골반 힘 몫(out.force, 골반 좌표, 발목에 거는 힘)으로 나눈다.
 * 발목 힘 F는 관절 j에 jⱼ · F의 토크를 낸다(jⱼ는 그 관절 각이 발목을 옮기는 방향, 야코비안의 열). 모터가 최대 토크 안에서 낼 수 있는 나눔 가운데
 * 발목 힘이 가장 작은 것을 고른다: 세 띠 torqueⱼ − capⱼ ≤ jⱼ · F ≤ torqueⱼ + capⱼ의 교집합에서 원점에 가장 가까운 F다(띠마다 번갈아 맞추는 Hildreth 반복).
 * 모터만으로 되면 힘은 0이고, 다리가 곧게 펴져 발목 힘이 무릎을 굽히지 못하는 자세에서도 낼 수 있는 방향의 힘만 나온다.
 * out.force는 힘-속도 한계가 깎기 전에 요청해야 하는 힘이다: 발이 움직이는 방향 성분은 (1 - 속도/maxFootSpeed)배만 전달되므로 그만큼 키운다.
 * 반환 값은 한계 사용률이다: 요청 힘 ÷ footForce와 발 속도 ÷ maxFootSpeed 가운데 큰 값이고, 발목 힘으로도 모터의 모자란 몫을 못 채우면
 * (다리가 곧은 자세) 그 관절의 토크 ÷ 최대 토크다. 1 이하면 한계 안이다.
 */
function legActuation(model, q, qd, torque, out) {
    const { motor, force } = out;
    fillJacobian(model, q);
    let fx = 0,
        fy = 0,
        fz = 0;
    splitShare[0] = splitShare[1] = splitShare[2] = 0;
    for (let sweep = 0, moved = true; sweep < SPLIT_SWEEPS && moved; sweep++) {
        moved = false;
        for (let j = 0; j < 3; j++) {
            const x = jacobian[j],
                y = jacobian[3 + j],
                z = jacobian[6 + j],
                size = x * x + y * y + z * z;
            if (size < 1e-12) continue;
            const cap = j === 2 ? model.kneeTorque : model.hipTorque,
                // 이 관절의 몫을 뺀 나머지 힘이 내는 토크.
                others = x * fx + y * fy + z * fz - splitShare[j] * size,
                share = clamp(
                    0,
                    (torque[j] - cap - others) / size,
                    (torque[j] + cap - others) / size,
                ),
                change = share - splitShare[j];
            if (change === 0) continue;
            fx += x * change;
            fy += y * change;
            fz += z * change;
            splitShare[j] = share;
            moved = true;
        }
    }
    let usage = 0;
    for (let j = 0; j < 3; j++) {
        const cap = j === 2 ? model.kneeTorque : model.hipTorque,
            rest = torque[j] - (jacobian[j] * fx + jacobian[3 + j] * fy + jacobian[6 + j] * fz);
        motor[j] = clamp(rest, -cap, cap);
        // 모터가 최대 토크까지 쓰는 것은 한계 안이다. 발목 힘으로도 못 채워 남은 몫만 한계를 넘은 것으로 센다.
        if (Math.abs(rest) > cap * (1 + 1e-6)) usage = Math.max(usage, Math.abs(rest) / cap);
    }
    // 엉덩이에 대한 발목 속도(J q̇).
    const vx = jacobian[0] * qd[0] + jacobian[1] * qd[1] + jacobian[2] * qd[2],
        vy = jacobian[3] * qd[0] + jacobian[4] * qd[1] + jacobian[5] * qd[2],
        vz = jacobian[6] * qd[0] + jacobian[7] * qd[1] + jacobian[8] * qd[2];
    const speed = Math.hypot(vx, vy, vz),
        speedUsage = speed / model.maxFootSpeed;
    if (speed > 1e-9) {
        const along = (fx * vx + fy * vy + fz * vz) / speed;
        if (along > 0) {
            // 힘-속도 한계가 전달하는 비율. 발 속도 한계에 닿으면 미는 힘이 전달되지 않는다.
            const passed = Math.max(1e-6, 1 - speedUsage),
                extra = along * (1 / passed - 1);
            fx += (vx / speed) * extra;
            fy += (vy / speed) * extra;
            fz += (vz / speed) * extra;
        }
    }
    force.x = fx;
    force.y = fy;
    force.z = fz;
    return Math.max(usage, speedUsage, Math.hypot(fx, fy, fz) / model.footForce);
}

const torqueAngles = [0, 0, 0],
    torqueNow = { thigh: vector(), shank: vector() },
    torqueBefore = { thigh: vector(), shank: vector() },
    torqueAfter = { thigh: vector(), shank: vector() },
    torqueTurn = { thigh: [vector(), vector(), vector()], shank: [vector(), vector(), vector()] },
    torqueThigh = vector(),
    torqueShank = vector();

/**
 * 역동역학: 관절 각·각속도·각가속도를 내는 데 필요한 관절 토크 [엉덩이 굽힘, 엉덩이 벌림, 무릎] (N·m).
 * 다리의 모든 질량은 엉덩이에서 (허벅지 방향 × α + 정강이 방향 × β) 자리에 있다. 그래서 질량마다의 가속·중력 힘을 모으면
 *   허벅지 몫 = thighInertia × (허벅지 방향의 가속) + coupling × (정강이 방향의 가속) − 중력 × thighMoment,
 *   정강이 몫 = coupling × (허벅지 방향의 가속) + shankInertia × (정강이 방향의 가속) − 중력 × shankMoment
 * 두 벡터가 되고, 관절 j의 토크는 그 둘을 그 관절 각이 두 방향을 돌리는 정도(legAxes의 turn)에 내적한 값이다.
 * 방향 벡터의 가속은 궤적을 DIFFERENCE_MS 앞뒤로 옮긴 차분이다. 순기구학과 같은 legAxes를 써서 굽힘·벌림이 함께 있어도 같은 자세를 본다.
 */
function legTorques(model, q, qd, qdd, out = [0, 0, 0]) {
    const { thighInertia, shankInertia, coupling, thighMoment, shankMoment, gravity, down } = model;
    legAxes(q, torqueNow.thigh, torqueNow.shank, torqueTurn);
    for (let j = 0; j < 3; j++)
        torqueAngles[j] = q[j] - qd[j] * DIFFERENCE + 0.5 * qdd[j] * DIFFERENCE * DIFFERENCE;
    legAxes(torqueAngles, torqueBefore.thigh, torqueBefore.shank);
    for (let j = 0; j < 3; j++)
        torqueAngles[j] = q[j] + qd[j] * DIFFERENCE + 0.5 * qdd[j] * DIFFERENCE * DIFFERENCE;
    legAxes(torqueAngles, torqueAfter.thigh, torqueAfter.shank);
    const span = DIFFERENCE * DIFFERENCE,
        pull = gravity * thighMoment,
        drag = gravity * shankMoment;
    for (const axis of AXES) {
        const thigh =
                (torqueAfter.thigh[axis] - 2 * torqueNow.thigh[axis] + torqueBefore.thigh[axis]) /
                span,
            shank =
                (torqueAfter.shank[axis] - 2 * torqueNow.shank[axis] + torqueBefore.shank[axis]) /
                span;
        torqueThigh[axis] = thighInertia * thigh + coupling * shank - pull * down[axis];
        torqueShank[axis] = coupling * thigh + shankInertia * shank - drag * down[axis];
    }
    for (let j = 0; j < 3; j++) {
        const thigh = torqueTurn.thigh[j],
            shank = torqueTurn.shank[j];
        out[j] =
            torqueThigh.x * thigh.x +
            torqueThigh.y * thigh.y +
            torqueThigh.z * thigh.z +
            torqueShank.x * shank.x +
            torqueShank.y * shank.y +
            torqueShank.z * shank.z;
    }
    return out;
}

const sampleAngles = [0, 0, 0],
    sampleRates = [0, 0, 0],
    sampleAccelerations = [0, 0, 0],
    sampleTorques = [0, 0, 0],
    sampleActuation = { motor: [0, 0, 0], force: {} },
    sampleCurve = [0, 0, 0];

/**
 * 시작 상태에서 끝 상태까지 duration초의 관절 곡선(legCurve)이 한계를 얼마나 쓰는지. 표본마다 그 궤적의 관절 토크를
 * 구동기에 나눈 한계 사용률(legActuation) 가운데 가장 큰 값이다(1 이하면 한계 안). 무릎이 경첩 범위를 벗어나는 곡선은 1을 넘는다.
 */
function legPlanUsage(model, start, end, duration, samples) {
    let usage = 0;
    for (let index = 0; index <= samples; index++) {
        const u = index / samples;
        for (let j = 0; j < 3; j++) {
            legCurve(
                start.position[j],
                start.velocity[j],
                end.position[j],
                end.velocity[j],
                end.acceleration[j],
                duration,
                u,
                sampleCurve,
            );
            sampleAngles[j] = sampleCurve[0];
            sampleRates[j] = sampleCurve[1];
            sampleAccelerations[j] = sampleCurve[2];
        }
        // 무릎 경첩 범위를 벗어나는 곡선은 그 끝에서 멈춘 것으로 보고(실제 무릎도 거기서 멈춘다), 벗어난 만큼을 한계를 넘은 것으로 센다.
        const knee = clamp(sampleAngles[2], model.kneeMin, model.kneeMax);
        if (knee !== sampleAngles[2]) {
            usage = Math.max(
                usage,
                1 + Math.abs(sampleAngles[2] - knee) / (model.kneeMax - model.kneeMin),
            );
            sampleAngles[2] = knee;
            sampleRates[2] = sampleAccelerations[2] = 0;
        }
        legTorques(model, sampleAngles, sampleRates, sampleAccelerations, sampleTorques);
        usage = Math.max(
            usage,
            legActuation(model, sampleAngles, sampleRates, sampleTorques, sampleActuation),
        );
    }
    return usage;
}

/**
 * 걸리는 시간과 낼 수 있는 접촉 속도. start는 { position: [3], velocity: [3] }(지금 관절 상태), available은 접촉까지 남은 시간(초, 모르면 Infinity).
 * contact = { ankle, swing, reach }: 접촉 순간의 발목 자리(엉덩이 기준, 골반 좌표)와, 원하는 발목 속도를 둘로 나눈 것이다.
 *   swing은 발목이 엉덩이 둘레를 도는 속도(다리 길이를 바꾸지 않는 몫), reach는 엉덩이에서 멀어지거나 가까워지는 속도(다리를 펴거나 접는 몫)다.
 *   다리가 거의 펴진 자리에서는 reach 몫에 아주 빠른 무릎 각속도가 필요하므로, 못 내면 이 몫부터 줄인다.
 * search = { minTime, maxTime, samples, bisection }: 고르는 길이 범위(초), 곡선 표본 수, 길이·배율을 찾는 칸 수이자 반복 횟수.
 * 길이는 구동 한계를 가장 덜 쓰는 것으로 고른다. 한계에 딱 맞는 가장 짧은 길이는 추종 오차를 되먹임으로 고칠 여유가 없어 발이 계획보다 늦는다.
 * 반환:
 *   lead: [minTime, maxTime]에서 한계 사용률이 가장 낮은 길이(초). 휘두르기를 시작할 때다(접촉까지 이만큼 남았을 때).
 *   duration: 이 계획의 길이. 남은 시간이 lead 이상이면 남은 시간이다. 모자라면 남은 시간(최소 minTime)이고, 그 시간에 한계 안에서 닿을 수 없으면
 *     닿을 수 있는 가장 짧은 길이다(남은 시간보다 길어 발이 공보다 늦게 닿는다).
 *   end: 끝 상태 { position, velocity, acceleration }: 발목이 접촉 자리를 낼 수 있는 속도로 지나가는 관절 상태(legStroke)다. 한계·시간 때문에
 *     원하던 대로 못 하면 곧게 지나가기, reach 몫, 속도 전체 순서로 내준 것이다. 무엇을 내줘도 한계 안에 못 들면 원하던 대로 두며,
 *     그때는 구동이 상한에 걸려 발이 계획보다 늦는다.
 *   straight: 끝 상태가 접촉을 곧게 지나가는가(거짓이면 접촉 각속도 그대로 호를 그린다). 접촉 뒤 따라 차기도 같은 길을 가야 한다.
 */
function legPlanSolve(model, start, contact, available, search) {
    const { minTime, maxTime, samples, bisection } = search;
    const end = { position: [0, 0, 0], velocity: [0, 0, 0], acceleration: [0, 0, 0] },
        stroke = {};
    // 한계 때문에 접촉 조건에서 내주는 것 셋(1이면 원하던 그대로). 이 순서로 내준다.
    //   straight(1 또는 0): 접촉을 곧게 지나가는가. 접촉 각가속도 = straight × (발목이 곧게 지나가는 값). 0이면 접촉 각속도 그대로 호를 그리며 지나간다.
    //     다리가 거의 펴진 자리에서 곧게 지나가려면 접촉 직전에 무릎을 접었다 급히 펴야 해서, 못 하면 호로 지나간다.
    //   stretch(1 또는 0): reach 몫(다리를 펴거나 접는 속도)을 내는가.
    //   whole(0~1): 접촉 발목 속도 전체의 비율.
    const give = { straight: 1, stretch: 1, whole: 1 };
    // 끝 상태를 지금의 give로 채운다: 접촉 발목 속도 = whole × (swing + stretch × reach).
    const aim = () => {
        stroke.x = give.whole * (contact.swing.x + give.stretch * contact.reach.x);
        stroke.y = give.whole * (contact.swing.y + give.stretch * contact.reach.y);
        stroke.z = give.whole * (contact.swing.z + give.stretch * contact.reach.z);
        legStroke(model, contact.ankle, stroke, 0, end);
        for (let j = 0; j < 3; j++) end.acceleration[j] *= give.straight;
    };
    const usageAt = (duration) => legPlanUsage(model, start, end, duration, samples);
    // 한계 사용률이 가장 낮은 길이: 범위를 고르게 나눈 칸에서 가장 낮은 곳을 찾고, refine이면 그 양옆 칸 안을 삼분해 좁힌다.
    const easiest = (refine) => {
        const step = (maxTime - minTime) / bisection;
        let time = maxTime,
            usage = Infinity;
        for (let index = bisection; index >= 0; index--) {
            const duration = minTime + step * index,
                value = usageAt(duration);
            if (value < usage) {
                usage = value;
                time = duration;
            }
        }
        if (!refine) return { time, usage };
        let lo = Math.max(minTime, time - step),
            hi = Math.min(maxTime, time + step);
        for (let index = 0; index < bisection; index++) {
            const third = (hi - lo) / 3;
            if (usageAt(lo + third) <= usageAt(hi - third)) hi -= third;
            else lo += third;
        }
        const middle = (lo + hi) / 2,
            value = usageAt(middle);
        return value < usage ? { time: middle, usage: value } : { time, usage };
    };
    // within(value)가 참인 가장 큰 value를 [0, top]에서 찾는다. 0에서도 거짓이면 null.
    const largest = (top, within) => {
        if (within(top)) return top;
        if (!within(0)) return null;
        let lo = 0,
            hi = top;
        for (let step = 0; step < bisection; step++) {
            const middle = (lo + hi) / 2;
            if (within(middle)) lo = middle;
            else hi = middle;
        }
        return lo;
    };
    // 한계 안에 드는 접촉 조건: 원하던 대로가 안 되면 곧게 지나가기(straight)를, 그래도 안 되면 reach 몫(stretch)을 통째로 내주고,
    // 그래도 안 되면 속도 전체(whole)를 한계 안에 드는 가장 큰 값까지 줄인다. 어떻게 줄여도 안 되면 원하던 대로 둔다(구동이 상한에 걸린다).
    // straight·stretch를 조금씩 줄이지 않는 이유: 한계에 딱 걸리는 값에서 멈추면 추종 오차를 고칠 여유가 없는 계획이 된다.
    const fit = (within) => {
        const wanted = { ...give };
        for (const key of ['straight', 'stretch']) {
            if (within()) return;
            give[key] = 0;
            aim();
        }
        const scaled = largest(give.whole, (value) => {
            give.whole = value;
            aim();
            return within();
        });
        if (scaled === null) Object.assign(give, wanted);
        else give.whole = scaled;
        aim();
    };
    const speed = Math.hypot(
        contact.swing.x + contact.reach.x,
        contact.swing.y + contact.reach.y,
        contact.swing.z + contact.reach.z,
    );
    if (speed > model.maxFootSpeed) give.whole = model.maxFootSpeed / speed;
    aim();
    fit(() => easiest(false).usage <= 1);
    const best = easiest(true);
    const result = (duration) => ({
        lead: best.time,
        duration,
        end,
        straight: give.straight === 1,
    });
    if (available === Infinity) return result(best.time);
    // 실제 길이(남은 시간)는 고른 길이와 다르다: 길면 곡선이 달라지고, 짧으면(늦은 누름) 시간이 모자란다. 그 길이로 다시 보고 낼 수 있는 접촉 조건으로 맞춘다.
    let duration = Math.max(available, minTime);
    fit(() => usageAt(duration) <= 1);
    if (duration < best.time && usageAt(duration) > 1 && usageAt(best.time) <= 1) {
        // 남은 시간에는 무엇을 내줘도 한계 안에서 닿지 못한다: 한계 안에서 닿는 가장 짧은 길이로 잡는다. 발이 공보다 늦게 닿는다(늦은 누름의 값).
        // 남은 시간에 억지로 맞춘 계획은 구동이 내내 상한에 걸려, 발이 뒤늦게 계획보다 빠른 속도로 지나간다.
        let late = best.time;
        for (let step = 0; step < bisection; step++) {
            const middle = (duration + late) / 2;
            if (usageAt(middle) <= 1) late = middle;
            else duration = middle;
        }
        duration = late;
    }
    return result(duration);
}

/**
 * 기준 궤적을 dt만큼 나아간다. reference = { position, velocity, acceleration }(지금의 기준 상태)를 끝 상태로 가는 곡선(legCurve) 위에서 옮긴다.
 * remaining은 지금부터 접촉까지 남은 시간(초)이고 dt는 그 이하여야 한다.
 */
function legPlanAdvance(reference, end, remaining, dt) {
    const u = Math.min(1, dt / remaining);
    for (let j = 0; j < 3; j++) {
        legCurve(
            reference.position[j],
            reference.velocity[j],
            end.position[j],
            end.velocity[j],
            end.acceleration[j],
            remaining,
            u,
            sampleCurve,
        );
        reference.position[j] = sampleCurve[0];
        reference.velocity[j] = sampleCurve[1];
        reference.acceleration[j] = sampleCurve[2];
    }
}

export {
    legPlanModel,
    legAnkle,
    legJoints,
    legJointVelocity,
    legAnkleVelocity,
    legAnkleAcceleration,
    legJointAcceleration,
    legStroke,
    legTorques,
    legActuation,
    legPlanSolve,
    legPlanAdvance,
};
