/** 정책 입력 인코더(하나뿐). 모든 위치는 선수 몸 기준 상대값이고 팀 방향을 뒤집어 항상 자기 코트가 x<0이다. */
const ROLES = ['receiver', 'setter', 'attacker'];

class ReceiveObservation {
  static get size() { return 24; }

  static encode(game, playerId) {
    const physics = game.physics, me = physics.players[playerId], toward = me.toward;
    const ball = physics.ball.translation(), v = physics.ball.linvel(), s = me.root.translation(), sv = physics._bodyVelocity(me);
    const allies = physics.players.filter(p => p.team === me.team && p.id !== playerId).sort((a, b) => a.id - b.id);
    const landing = game.predictAtHeight(game.config.ai.receiveHeight);
    const rel = (x, z) => [(x - s.x) * toward / 6, (z - s.z) * toward / 3];
    const features = [
      (ball.x - s.x) * toward / 6, (ball.y - 0.9) / 4, (ball.z - s.z) * toward / 3,
      v.x * toward / 12, v.y / 12, v.z * toward / 12,
      sv.x * toward / 5, sv.y / 5, sv.z * toward / 5,
      me.grounded ? 1 : 0,
      ...allies.flatMap(a => { const t = a.root.translation(); return rel(t.x, t.z); }),
      -s.x * toward / 6, s.z * toward / 3,
      -ball.x * toward / 6, (ball.y - game.config.court.netHeight) / 4,
      ...(landing.reachable ? [...rel(landing.x, landing.z), Math.min(1.5, landing.time) / 1.5] : [0, 0, 0]),
      ...ROLES.map(role => me.role === role ? 1 : 0),
    ];
    if (features.length !== ReceiveObservation.size) throw new Error('관측 길이가 size와 다릅니다.');
    return Float64Array.from(features);
  }
}

export { ROLES, ReceiveObservation };
