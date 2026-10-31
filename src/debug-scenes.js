/**
 * 주소로 여는 확인용 장면(`?debug=1&scene=이름&tick=N&…`). 일반 플레이에서는 로드되지 않는다.
 * 호스트는 파라미터를 해석하지 않으므로 값의 형식은 각 장면이 정하고, 틀리면 그대로 실패한다.
 */
export function createDebugScenes({ config, openWatch, pulse, render, renderFrom, ballPosition, read, openClub, showClub, openMatch, readReplay }) {
  const QUANTUM = 1000 / config.simulation.tickRate;
  const scenes = {
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
     * watch와 같은 재생을 고정 카메라로 그리고 화면 HUD를 숨긴다(아이콘·공유 이미지용 장면 캡처).
     * camera는 `x,y,z,tx,ty,tz,fov`(카메라 위치, 바라보는 점, 세로 시야각 도)이며 바라보는 점은 공 위치 기준의 상대 좌표다.
     */
    spike({ seed, camera }) {
      const values = String(camera).split(',').map(Number);
      if (values.length !== 7 || !values.every(Number.isFinite)) throw new Error(`spike needs camera=x,y,z,tx,ty,tz,fov: ${camera}`);
      const [x, y, z, tx, ty, tz, fov] = values;
      const watch = scenes.watch({ seed });
      const style = document.createElement('style');
      style.textContent = '#app > :not(#court-canvas){display:none!important}';
      document.head.append(style);
      return {
        step: watch.step,
        render() {
          watch.render();
          const ball = ballPosition();
          if (!ball) throw new Error('spike needs a ball on screen');
          renderFrom({ position: { x, y, z }, target: { x: ball.x + tx, y: ball.y + ty, z: ball.z + tz }, fov });
        },
        state: () => ({ ...read(), ball: ballPosition() }),
        dispose() { style.remove(); watch.dispose(); },
      };
    },
    /**
     * 시드를 고정한 AI 대전을 실제 시간으로 연다(가상 시계 없음). 득점 리플레이는 워커가 계산해 보내므로 틱 단위로 멈춰 재현하지 않는다.
     * every=1이면 모든 득점을 리플레이한다.
     */
    match({ seed, every }) {
      if (!/^\d+$/.test(seed ?? '')) throw new Error(`match needs an integer seed: ${seed}`);
      if (!openMatch(Number(seed), every === '1')) throw new Error('match could not start');
      return { state: () => ({ ...read(), replay: readReplay() }) };
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
  return scenes;
}
