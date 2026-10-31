/**
 * 주소로 여는 확인용 장면(`?debug=1&scene=이름&tick=N&…`). 일반 플레이에서는 로드되지 않는다.
 * 호스트는 파라미터를 해석하지 않으므로 값의 형식은 각 장면이 정하고, 틀리면 그대로 실패한다.
 */
export function createDebugScenes({ config, openWatch, pulse, render, read }) {
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
  };
}
