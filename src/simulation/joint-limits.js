/**
 * 사람 관절 가동 범위(도)와 각도 분해의 유일한 정의.
 * 관절 기준틀: 위쪽 뼈(부모)의 몸 좌표. 뼈 방향이 y, 정면이 +z, 오른쪽 몸이 +x다(휴식 자세에서 부모·자식 회전이 같다).
 * 자식의 상대 회전을 비틀림(y축 회전)과 휘어짐(x축·z축 회전 벡터)으로 나눈다. 짐벌 문제가 없다.
 *   x: 앞뒤 휘어짐. 음수 = 다리·팔이 앞으로 올라감(굽힘), 양수 = 뒤로 젖힘(폄)
 *   z: 옆으로 휘어짐. 오른쪽 몸 기준 양수 = 몸 밖으로 벌어짐(벌림). 왼쪽 몸은 부호를 뒤집어 같은 표를 쓴다
 *   twist: 뼈 축 회전. 오른쪽 몸 기준이며 왼쪽 몸은 부호를 뒤집는다
 * 무릎·팔꿈치는 물리 엔진의 경첩 한계(0~140°)가 맡으므로 이 표에 없다.
 */
const DEG = Math.PI / 180;

/**
 * 물리 엔진에 거는 한계표. 실제 해부학 범위보다 넓게 잡은 값이다(몸통·목·어깨·손목만).
 * 고관절·발목은 표에 없어 한계가 없다: 6조건×120초 측정에서 한계를 걸면 킥·스파이크가 깨졌다(스파이크 84→26~51, 발목은 0).
 * 근거: docs/verification/joint-limits.md
 */
const HUMAN_JOINT_LIMITS = Object.freeze({
  waist: { x: [-40, 25], z: [-30, 30], twist: [-35, 35] },
  neck: { x: [-45, 40], z: [-35, 35], twist: [-60, 60] },
  shoulder: { x: [-120, 70], z: [-40, 120], twist: [-60, 60] },
  wrist: { x: [-70, 70], z: [-30, 30], twist: [-30, 30] },
});

const conj = q => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
const mul = (a, b) => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});

/**
 * 부모·자식 월드 회전 → { x, z, twist }(라디안). side는 +1(오른쪽)/-1(왼쪽).
 * 결과는 오른쪽 몸 기준 표와 비교할 수 있게 z와 twist에 side를 곱해 돌려준다.
 */
function jointAngles(parentRotation, childRotation, side = 1) {
  const q = mul(conj(parentRotation), childRotation);
  if (q.w < 0) { q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w; }
  const twistNorm = Math.hypot(q.y, q.w) || 1, twist = { x: 0, y: q.y / twistNorm, z: 0, w: q.w / twistNorm };
  const swing = mul(q, conj(twist)), size = Math.hypot(swing.x, swing.z);
  const scale = size > 1e-9 ? 2 * Math.atan2(size, swing.w) / size : 2;
  return { x: swing.x * scale, z: swing.z * scale * side, twist: 2 * Math.atan2(twist.y, twist.w) * side };
}

/** 표의 한계를 넘은 양(라디안, 한계 안이면 0). 넘은 방향은 부호로 나타낸다. */
function excessOf(angle, [min, max]) {
  const lo = min * DEG, hi = max * DEG;
  return angle > hi ? angle - hi : angle < lo ? angle - lo : 0;
}

export { DEG, HUMAN_JOINT_LIMITS, jointAngles, excessOf };
