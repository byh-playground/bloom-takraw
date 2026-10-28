/**
 * 사람이 자기 자리를 떠났을 때 AI 동료가 비운 구역을 메우는 대기 자리(대형)를 정한다.
 *
 * 구조: AiFormation 한 객체가 "사람 위치 + 동료 둘의 후보 자리"로 코트 전체의 도달 시간을 계산해 가장 느린 구역이 줄어드는 조합을 고른다(순수 계산, 상태 없음).
 * - 기본 자리(home)에서 멀어질수록 벌점을 주어 사람이 제자리에 있으면 동료도 제자리에 남는다.
 * - 역할마다 설 수 있는 범위(bounds)가 있어 공격수는 네트 가까이, 리시버는 뒤에 머문다.
 * 위치는 매 AI 판단마다 현재 상태에서만 계산하므로 스냅샷에 저장할 값이 없다. 사람이 없는 팀에는 쓰지 않는다.
 */
class AiFormation {
  /** options: ai.fill 설정. speed: 선수 이동속도(m/s). court: { halfLength, halfWidth }. */
  constructor(options, { speed, court }) {
    this.options = options; this.speed = speed; this.court = court;
    this.grid = [];
    for (let x = -court.halfLength + 0.2; x <= -0.79; x += options.gridStep) {
      for (let z = -court.halfWidth + 0.15; z <= court.halfWidth - 0.14; z += options.gridStep) this.grid.push([x, z]);
    }
  }

  /** 격자 각 점에 이 위치의 선수가 닿는 시간(초). 한 위치마다 한 번만 계산해 조합 비교에 재사용한다. */
  times(x, z) {
    const { reaction, reachRadius } = this.options, result = new Float64Array(this.grid.length);
    for (let i = 0; i < this.grid.length; i++) {
      const dx = this.grid[i][0] - x, dz = this.grid[i][1] - z;
      result[i] = Math.max(0, Math.sqrt(dx * dx + dz * dz) - reachRadius) / this.speed + reaction;
    }
    return result;
  }

  /** 자기 코트 방향으로 맞춘 좌표(x는 음수 쪽이 자기 코트)의 선수 위치들이 코트를 덮는 정도: 늦게 닿는 구역의 제곱 벌점 합. */
  cost(positions) {
    return this.costOf(positions.map(([x, z]) => this.times(x, z)));
  }

  costOf(timeArrays, limit = Infinity) {
    const slow = this.options.slow;
    let total = 0;
    for (let i = 0; i < this.grid.length; i++) {
      let nearest = Infinity;
      for (const array of timeArrays) if (array[i] < nearest) nearest = array[i];
      if (nearest > slow) { total += (nearest - slow) * (nearest - slow); if (total >= limit) return total; }
    }
    return total;
  }

  /**
   * human: 사람 선수의 현재 위치 { x, z }(자기 코트 방향 좌표). humanHome: 그 선수의 기본 자리. allies: [{ id, role, home: { x, z } }](같은 좌표).
   * 돌려주는 값: Map(id → { x, z }) 동료별 대기 자리. 개선이 없으면 home 그대로다.
   */
  plan(human, allies, humanHome) {
    const { step, reach, deviationWeight, bounds } = this.options;
    const offsets = [];
    for (let i = -reach; i <= reach; i++) for (let j = -reach; j <= reach; j++) offsets.push([i * step, j * step]);
    offsets.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]) || a[0] - b[0] || a[1] - b[1]); // 제자리가 맨 앞
    const limitZ = this.court.halfWidth - 0.25;
    const candidates = allies.map(ally => {
      const box = bounds[ally.role], list = [], seen = new Set();
      for (const [dx, dz] of offsets) {
        const x = Math.max(box.x[0], Math.min(box.x[1], ally.home.x + dx)), z = Math.max(-limitZ, Math.min(limitZ, ally.home.z + dz));
        const key = `${x.toFixed(2)},${z.toFixed(2)}`;
        if (seen.has(key)) continue;
        seen.add(key); list.push({ x, z, deviation: (x - ally.home.x) ** 2 + (z - ally.home.z) ** 2, times: this.times(x, z) });
      }
      return list;
    });
    let best = null;
    const humanTimes = this.times(human.x, human.z);
    if (allies.length === 2) {
      for (const a of candidates[0]) for (const b of candidates[1]) {
        const penalty = deviationWeight * (a.deviation + b.deviation);
        const value = this.costOf([humanTimes, a.times, b.times], best ? best.value - penalty + 1e-9 : Infinity) + penalty;
        if (!best || value < best.value - 1e-9) best = { value, picks: [a, b] };
      }
    }
    // 사람이 기본 자리에 있을 때의 도달 벌점(reference)보다 나빠졌을 때만 옮긴다. 사람이 제자리에 있으면 동료도 제자리에 있어 평소 대형이 그대로다.
    if (best && candidates.length === 2) {
      const homeTimes = [candidates[0][0].times, candidates[1][0].times];
      const reference = this.costOf([this.times(humanHome.x, humanHome.z), ...homeTimes]), homeValue = this.costOf([humanTimes, ...homeTimes]);
      if (homeValue <= reference + this.options.minGain || homeValue - best.value < this.options.minGain) best = { value: homeValue, picks: [candidates[0][0], candidates[1][0]] };
    }
    const result = new Map();
    allies.forEach((ally, index) => result.set(ally.id, best ? { x: best.picks[index].x, z: best.picks[index].z } : { ...ally.home }));
    return result;
  }
}

export { AiFormation };
