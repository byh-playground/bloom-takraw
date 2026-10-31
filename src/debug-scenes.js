/**
 * 주소로 여는 확인용 장면(`?debug=1&scene=이름&tick=N&…`). 일반 플레이에서는 로드되지 않는다.
 * 호스트는 파라미터를 해석하지 않으므로 값의 형식은 각 장면이 정하고, 틀리면 그대로 실패한다.
 */
export function createDebugScenes({ config, openWatch, pulse, render, read, openClub, showClub }) {
  const QUANTUM = 1000 / config.simulation.tickRate;
  return {
    /** 시드 하나의 AI 대 AI 경기를 가상 시계로 틱 단위로 진행한다. */
    watch({ seed }) {
      if (!openWatch(seed)) throw new Error(`watch needs an integer seed in range: ${seed}`);
      // 표시·연출이 읽는 시계도 틱에서 나오게 해, 같은 주소가 항상 같은 장면을 만든다.
      const realNow = performance.now.bind(performance);
      // 열기 직전 실제 시각에서 이어 가야 이미 발행된 표시 시계가 거꾸로 가지 않는다.
      let clock = realNow();
      performance.now = () => clock;
      return {
        step() {
          const before = read().tick;
          // 첫 pulse는 루프의 시간 기준만 잡을 수 있어 한 번 더 부른다.
          for (let attempt = 0; attempt < 3 && read().tick === before; attempt++) {
            clock += QUANTUM;
            pulse(clock);
          }
          if (read().tick !== before + 1) throw new Error(`step advanced ${read().tick - before} ticks`);
        },
        render: () => render(clock),
        state: read,
        dispose() { performance.now = realNow; },
      };
    },
    /**
     * 시드로 만든 새 클럽(메모리 저장)을 팀 관리 화면으로 연다. 실제 저장은 건드리지 않는다.
     * credits가 있으면 코인을 그 값으로 두고, draws가 있으면 그 뒤 그 횟수만큼 뽑는다(코인이 모자라면 게임 규칙대로 실패).
     */
    async club({ seed, credits, draws }) {
      if (!/^\d+$/.test(seed ?? '')) throw new Error(`club needs an integer seed: ${seed}`);
      const club = await openClub(Number(seed));
      if (credits !== undefined) await club._mutate(record => { record.credits = Number(credits); }, '코인을 바꿨어요.');
      if (draws !== undefined) for (const _ of Array.from({ length: Number(draws) })) await club.draw();
      showClub();
      const view = () => club.getView();
      return {
        state: () => ({ status: view().status, teamName: view().teamName, credits: view().credits, home: view().campaign.home,
          roster: view().roster.map(player => player.name), pending: view().draw.pending?.name ?? null }),
      };
    },
  };
}
