const POSE_KEYS = ['x', 'y', 'z', 'qx', 'qy', 'qz', 'qw', 'halfHeight'];

/**
 * 리플레이용 그림자 경기. 실제 경기의 시작 상태를 불러와 같은 입력을 같은 순서로 넣으면 같은 경기가 된다(락스텝과 같은 결정성).
 * 입력은 쌓아 두고 target 틱까지만 계산한다. 재생 구간(from..to)의 틱은 계산하면서 포즈를 묶어 내보낸다.
 */
class TakrawHighlightShadow {
  constructor(game, emit, batchTicks = 4) {
    this.game = game;
    this.emit = emit;
    this.batchTicks = batchTicks;
    this.reset();
  }

  reset() {
    this.stepped = -Infinity; // 마지막으로 계산한 입력의 틱. 게임의 state.tick은 스텝 뒤 다음 틱을 가리키므로 따로 센다.
    this.log = [];
    this.target = -Infinity;
    this.play = null;
  }

  anchor(data) {
    this.reset();
    this.game.load(data);
  }

  push(frame, target) {
    this.log.push(frame);
    this.target = Math.max(this.target, target);
    this.pump();
  }

  /** from..to를 재생한다. 그림자 경기가 이미 from을 지났으면 그 장면은 다시 만들 수 없다고 알린다. */
  start(play) {
    if (this.stepped >= play.from) { this.emit({ type: 'missing', id: play.id }); return; }
    this.play = { ...play, ticks: [], data: [] };
    this.target = Math.max(this.target, play.to);
    this.pump();
  }

  pump() {
    while (this.log.length && this.log[0].tick <= this.target) {
      const frame = this.log.shift();
      this.game.step(frame);
      this.stepped = frame.tick;
      const play = this.play, tick = frame.tick;
      if (!play || tick < play.from) continue;
      const entities = this.game.physics.getEntities(), state = this.game.state;
      play.ids ??= entities.map(entity => entity.id);
      const poses = new Float32Array(entities.length * POSE_KEYS.length);
      entities.forEach((entity, index) => POSE_KEYS.forEach((key, k) => { poses[index * POSE_KEYS.length + k] = entity[key] ?? 0; }));
      play.ticks.push({ tick, selected: state.selected.slice(), ballSpeed: state.ballSpeed || 0 });
      play.data.push(poses);
      const done = tick >= play.to;
      if (done || play.ticks.length >= this.batchTicks) this.flush(done);
      if (done) { this.play = null; this.target = -Infinity; }
    }
    // 재생 중 기록이 끊기면(세션 종료 등) 남은 묶음이라도 보낸다.
    if (this.play && this.play.ticks.length && !this.log.length) this.flush(false);
  }

  flush(done) {
    const play = this.play;
    this.emit({ type: 'poses', id: play.id, ids: play.ids, ticks: play.ticks, data: play.data, done }, play.data.map(poses => poses.buffer));
    play.ticks = [];
    play.data = [];
  }
}

export { TakrawHighlightShadow, POSE_KEYS };
