import { AiBrain, Temperament, seededUnit } from './ai-brain.js';
import { AiFormation } from './ai-formation.js';
import { TakrawPhysics } from './physics.js';
import { TakrawTimingJudge } from './timing.js';

/** 연습 선택과 안내의 단일 원본. 실제 발차기 선택/자세는 물리 계층이 소유한다. */
const TAKRAW_TRAINING_LESSONS = Object.freeze([
  { id: 'auto', command: 6, title: '상황에 맞춰 차기',
    sequence: '거리와 높이 맞추기 → 점프 → 좌클 유지',
    detail: '공과 몸의 위치에 맞는 발차기로 이어져요. 점프 높이와 누르는 시점을 맞춰 보세요.' },
  { id: 'downward', command: 5, title: '내려찍기',
    sequence: '좌클 먼저 유지 → 점프 → 높은 발로 내려찍기',
    detail: '올려 둔 발에서 내려치는 동작을 이어가세요. 공과 몸 사이에 발을 돌릴 공간을 남겨요.' },
  { id: 'sideswipe', command: 7, title: '사선 회전킥', approachScale: 0.75, kickDelayScale: 1.5,
    sequence: '무릎 들고 점프 → 좌클 유지 → 몸을 돌려 사선 타격',
    detail: '몸통을 기울여 돌며 뒷발을 사선으로 내려요. 발자국에서 높이와 거리를 먼저 맞추세요.' },
  { id: 'scissors', command: 8, title: '가위치기',
    sequence: '점프 → 좌클 유지 → 다리를 교차해 발등 타격',
    detail: '공중에서 두 다리를 교차하며 발등을 보내요. 공 바로 아래로 너무 붙지 않게 준비하세요.' },
  { id: 'roundhouse540', command: 9, title: '540도 회전킥',
    sequence: '점프 → 좌클 유지 → 발등이 앞서는 회전 타격',
    detail: '몸과 다리를 함께 돌려 발등 쪽으로 차요. 높은 토스를 보고 회전할 시간을 확보하세요.' },
]);

/** 연습 토스의 종류. high는 세터가 높게 올리는 기본 토스, quick은 낮고 빠른 토스(속공)다. 명령 번호는 동작 연습(5~9)·재시작(4)과 겹치지 않는다. */
const TAKRAW_TRAINING_TEMPOS = Object.freeze([
  { id: 'high', command: 21, title: '높은 토스', detail: '세터가 높게 올려요. 점프 버튼을 잠깐 유지하며 여유 있게 타이밍을 맞춰요.' },
  { id: 'quick', command: 22, title: '속공', detail: '네트 앞으로 낮고 빠르게 와요. 점프 버튼을 짧게 누르고 떼며 바로 발차기를 이어가요.' },
]);

/** 경기와 판정의 유일한 소유자. 사람/AI/네트워크가 같은 물리 입력을 사용한다. */
class TakrawGame {
  constructor({ RAPIER, config }) {
    this.config = config;
    this.physics = new TakrawPhysics(RAPIER, config);
    this.timingJudge = new TakrawTimingJudge(config.timing);
    this.aiBrain = new AiBrain();
    this.formation = new AiFormation(config.ai.fill, { speed: this.physics.settings.movementSpeed, court: config.court });
    this.fillStance = [null, null];
    this.humanTeams = [false, false]; // 이번 틱에 사람 입력이 있는 팀(매 틱 입력에서 다시 정해져 저장하지 않는다)
    this.temperaments = { key: '', list: [] };
    this.temperamentProfiles = [null, null];
    this.revision = 0;
    this.tuning = [null, null]; // 팀별 학습 조정 값(이름 → 절대값). 없으면 config 기본값을 쓴다.
    this.tuners = [null, null]; // 팀별 상황 반응형 조정기: (game, playerId) → 조정 값. 상대가 공을 칠 때마다 다시 계산한다(로컬 경기 전용).
    this.retuneTeam = -1;
    this.isolated = false; // 학습 장면 전용: 훈련 모드에서도 상대 공에 대한 리시브 판단을 켠다.
    this.teamById = {};
    this.setTeams();
    this.reset('match');
  }

  setTeams(home = null, away = null) {
    const roles = ['receiver', 'setter', 'attacker'], names = ['리시버', '세터', '공격수'];
    const definition = this.config.athletes, keys = Object.keys(definition.bonus);
    const teamNames = [], athletes = [];
    for (const [team, supplied] of [home, away].entries()) {
      if (supplied !== null && (!supplied || typeof supplied.name !== 'string' ||
          !supplied.name.trim() || [...supplied.name.trim()].length > 18 ||
          !Array.isArray(supplied.players) || supplied.players.length !== roles.length)) {
        throw new Error('팀 이름과 리시버·세터·공격수 편성을 확인하세요.');
      }
      teamNames.push(supplied ? supplied.name.trim() : team === 0 ? '우리 팀' : '상대 팀');
      const ids = new Set();
      for (const [slot, role] of roles.entries()) {
        const matches = supplied ? supplied.players.filter(player => player?.role === role) : [];
        if (supplied && matches.length !== 1) throw new Error('각 역할에는 서로 다른 선수 한 명이 필요합니다.');
        const player = supplied ? matches[0] : { id: `standard-${team * 3 + slot}`, name: names[slot], role,
          stats: Object.fromEntries(keys.map(key => [key, definition.base])) };
        if (typeof player.id !== 'string' || !player.id.trim() || ids.has(player.id) ||
            typeof player.name !== 'string' || !player.name.trim() || !player.stats ||
            keys.some(key => !Number.isInteger(player.stats[key]) || player.stats[key] < definition.base || player.stats[key] > definition.max)) {
          throw new Error('선수 식별자·이름·능력치를 확인하세요.');
        }
        ids.add(player.id);
        athletes.push({ id: player.id, name: player.name.trim(), role,
          stats: Object.fromEntries(keys.map(key => [key, player.stats[key]])) });
      }
    }
    // Validate the entire lineup before changing either team. The physics
    // snapshot owns the selected profiles and derives its physical settings.
    this.physics.setAthletes(athletes);
    this.teamNames = teamNames;
    this.revision++;
  }

  /** seed는 경기 변주(선수 성향·서브)의 원천이다. 훈련은 같은 상황이 반복되어야 하므로 기본 시드를 쓴다. */
  reset(mode = this.mode, lesson = this.state?.training?.lesson || 'auto', seed = this.config.network.seed, tempo = this.state?.training?.tempo || 'high') {
    this.mode = mode;
    this.retuneTeam = -1;
    this.state = {
      mode, phase: 'ready', tick: 0, time: 0, seed: mode === 'training' ? this.config.network.seed : seed >>> 0,
      score: [0, 0], sets: [0, 0], set: 1,
      serving: 1, selected: [2, 5],
      touches: 0, possession: -1, lastTouch: -1, toss: null, play: null, defense: [null, null],
      lastMessage: mode === 'training' ? '공의 옆에 서서 점프와 발차기를 맞춰 보세요.' : '첫 서브를 준비합니다.',
      pointWinner: -1, pointReason: '', matchWinner: -1, ballSpeed: 0,
      timer: this.config.rules.ready, rally: 0,
      // 팀별 최근 점프·발차기 입력 오차. 접촉 때 평가해 소비한다(스냅샷에 포함).
      timing: this.timingJudge.emptyRecords(),
      training: mode === 'training' ? {
        lesson: TAKRAW_TRAINING_LESSONS.some(item => item.id === lesson) ? lesson : 'auto', attempt: 0, successes: 0,
        tempo: TAKRAW_TRAINING_TEMPOS.some(item => item.id === tempo) ? tempo : 'high',
        setAt: null, jumpAt: null, kickAt: null, jumpOffset: null, kickOffset: null,
        entry: null, motionId: null, contact: null, result: null, previousResult: null, setApex: 0,
      } : null,
    };
    if (mode === 'training') this.state.timer = this.config.training.ready;
    this.ai = Array.from({ length: 6 }, () => ({ x: 0, z: 0, active: false, kickFrom: 0, kickUntil: 0, jumpUntil: 0, cooldown: 0, previousJump: false, previousKick: false, attack: null, receive: null, brain: AiBrain.blankRecord() }));
    this.aiDirty = true;
    this.inputs = Array.from({ length: 6 }, () => this.emptyInput());
    this.events = [];
    this.metrics = { logicSteps: 0, physicsSteps: 0, aiSteps: 0, contacts: 0, spikes: 0, rallies: 0, maxBallSpeed: 0, defensiveSwitches: 0, defensiveTouches: 0 };
    this.physics.resetPlayers();
    this.physics.resetBall({ x: 3.6, y: 0.2, z: 0 }, { x: 0, y: 0, z: 0 });
    this.revision++;
  }

  emptyInput() { return { x: 0, z: 0, jump: false, kick: false, jumpPressed: false, kickPressed: false }; }

  setTrainingLesson(lesson) {
    if (this.mode !== 'training' || !TAKRAW_TRAINING_LESSONS.some(item => item.id === lesson)) return false;
    this.reset('training', lesson);
    return true;
  }

  setTrainingTempo(tempo) {
    if (this.mode !== 'training' || !TAKRAW_TRAINING_TEMPOS.some(item => item.id === tempo)) return false;
    this.reset('training', undefined, undefined, tempo);
    return true;
  }

  applyMembership(change) {
    const next = {};
    for (const id of change.players) if (Object.hasOwn(this.teamById, id)) next[id] = this.teamById[id];
    for (const id of change.players) {
      if (Object.hasOwn(next, id)) continue;
      const used = Object.values(next);
      const free = [0, 1].find(team => !used.includes(team));
      if (free !== undefined) next[id] = free;
    }
    this.teamById = next;
    this.aiDirty = true;
    if (this.mode === 'online' && change.players.length < 2) this.state.lastMessage = '상대가 입장하면 경기가 시작됩니다.';
    this.revision++;
  }

  decode(input, commands, secondary = false) {
    const offset = secondary ? 3 : 0;
    const signed = b => (b > 127 ? b - 256 : b) / 127;
    const code = secondary ? 10 : 0;
    const has = n => commands.some(command => command.payload?.[0] === n + code);
    return {
      x: signed(input[offset] || 0), z: signed(input[offset + 1] || 0),
      jump: !!((input[offset + 2] || 0) & 1), kick: !!((input[offset + 2] || 0) & 2),
      jumpPressed: has(1), kickPressed: has(2), restart: has(4),
      trainingLesson: TAKRAW_TRAINING_LESSONS.find(lesson => has(lesson.command))?.id || null,
      trainingTempo: TAKRAW_TRAINING_TEMPOS.find(tempo => has(tempo.command))?.id || null,
    };
  }

  step(frame) {
    const dt = 1 / frame.tickRate;
    this.events = [];
    this.state.tick = frame.tick;
    this.state.time += dt;
    this.metrics.logicSteps++;
    const humans = [null, null];
    for (const entry of frame.inputs) {
      let team = this.teamById[entry.playerId];
      if (team === undefined) {
        const free = [0, 1].find(slot => !Object.values(this.teamById).includes(slot));
        team = free === undefined ? 0 : free;
        this.teamById[entry.playerId] = team;
      }
      humans[team] = this.decode(entry.input, entry.commands || []);
      if (this.mode === 'local') humans[1] = this.decode(entry.input, entry.commands || [], true);
    }
    if (this.mode === 'training' && humans[0]?.trainingLesson) {
      this.setTrainingLesson(humans[0].trainingLesson);
      this.state.tick = frame.tick + 1;
      return;
    }
    if (this.mode === 'training' && humans[0]?.trainingTempo) {
      this.setTrainingTempo(humans[0].trainingTempo);
      this.state.tick = frame.tick + 1;
      return;
    }
    if (humans[0]?.restart) {
      if (this.mode === 'training') this.prepareRally();
      // 다시 시작은 새 변주를 쓴다. 두 피어가 같은 현재 시드·랠리 번호에서 같은 새 시드를 얻는다.
      else this.reset(this.mode, undefined, Math.floor(seededUnit(this.state.seed, this.state.rally, this.state.tick, 99) * 4294967296));
      this.state.tick = frame.tick + 1;
      return;
    }
    if (this.mode === 'match' || this.mode === 'training') humans[1] = null;
    const humanTeams = [!!humans[0], !!humans[1]];
    const changed = humanTeams[0] !== this.humanTeams[0] || humanTeams[1] !== this.humanTeams[1];
    this.humanTeams = humanTeams;
    // 사람이 처음 들어온 순간 서브 전 배치를 다시 한다(첫 서브가 사람 팀일 때 공격수를 서브 자리에 세운다).
    if (changed && this.state.phase === 'ready' && this.state.rally === 0) this.placeServe();
    for (let team = 0; team < 2; team++) humans[team] = this.assistReceive(team, humans[team]);
    // 서브 시작에는 발차기 버튼이 공 던지기다: 던질 때까지 발차기 입력은 발이 아니라 던지기 힘 모으기로만 쓴다.
    const toss = this.state.serveToss, server = humans[this.state.serving];
    if (toss && toss.stage === 'hold' && this.state.phase === 'rally' && this.state.lastTouch < 0 && server)
      humans[this.state.serving] = { ...server, kick: false, kickPressed: false, toss: server.kick, tossPressed: server.kickPressed };

    // Claim/release is an input edge. Re-evaluate that change immediately,
    // while ordinary pursuit decisions remain on the configured AI clock.
    if (this.mode !== 'training') for (const [team, input] of humans.entries()) {
      if (!input) continue;
      const previous = this.inputs[this.state.selected[team]];
      if (!!(input.kick || input.kickPressed) !== !!previous.kick ||
          (previous.kick && (input.jumpPressed || Math.hypot(input.x - previous.x, input.z - previous.z) > 0.75))) this.aiDirty = true;
    }

    const onlineWaiting = this.mode === 'online' && Object.keys(this.teamById).length < 2;
    if (this.state.phase !== 'finished' && !onlineWaiting) {
      if (this.state.phase === 'ready') {
        this.state.timer -= dt;
        if (this.state.timer <= 0) this.beginRally();
      } else if (this.state.phase === 'point') {
        this.state.timer -= dt;
        if (this.state.timer <= 0) this.prepareRally();
      }
    }

    if (this.aiDirty || frame.tick % Math.max(1, Math.round(frame.tickRate / this.config.simulation.aiRate)) === 0) {
      this.decideAI(humans);
      this.aiDirty = false;
    }
    const previousInputs = this.inputs.map(input => ({ kick: input.kick, intent: input.intent, rally: input.rally }));
    for (let i = 0; i < 6; i++) {
      const a = this.ai[i];
      const kick = this.state.phase === 'rally' && a.kickUntil > this.state.time && a.kickFrom <= this.state.time;
      const jump = this.state.phase === 'rally' && a.jumpUntil > this.state.time;
      this.inputs[i] = {
        x: this.state.phase === 'rally' ? a.x : 0,
        z: this.state.phase === 'rally' ? a.z : 0,
        jump, kick, jumpPressed: jump && !a.previousJump, kickPressed: kick && !a.previousKick,
        receive: this.state.phase === 'rally' && a.active && a.receive ? { ...a.receive, allowSlide: true } : null,
      };
      a.previousJump = jump; a.previousKick = kick;
    }

    for (let team = 0; team < 2; team++) {
      if (!humans[team]) continue;
      const id = this.state.selected[team];
      const h = humans[team];
      this.inputs[id] = {
        x: h.x, z: h.z,
        jump: h.jump || h.jumpPressed,
        kick: h.kick || h.kickPressed,
        jumpPressed: h.jumpPressed, kickPressed: h.kickPressed,
      };
    }
    // AI 서버: 공을 던질 때까지 자기 자리에 서 있고(이동·점프·발차기 없음), 던진 공이 올라가는 동안은 차지 않는다(내려오는 공만 찬다).
    const serveToss = this.state.serveToss, aiServerId = this.serverId(this.state.serving);
    if (serveToss && this.state.phase === 'rally' && this.state.lastTouch < 0 && !humans[this.state.serving]) {
      if (serveToss.stage === 'hold') this.inputs[aiServerId] = { x: 0, z: 0, jump: false, kick: false, jumpPressed: false, kickPressed: false, receive: null };
      else if (this.physics.ball.linvel().y > 0) Object.assign(this.inputs[aiServerId], { jump: false, kick: false, jumpPressed: false, kickPressed: false });
    }
    this.updateServeToss(humans, dt);
    if (this.mode === 'training') this.recordTrainingInput();
    this.observeTiming(humans);

    // The game chooses an ally; the physics controller only guides the foot.
    // Humans and AI use this same target, with no extra aiming input or ball force.
    for (const player of this.physics.players) {
      const input = this.inputs[player.id], previous = previousInputs[player.id];
      // Keep one held stroke's foot target through the collision response.
      // The next kick chooses the new possession/contact-count intent.
      input.intent = this.state.phase === 'rally' && input.kick && previous.kick && previous.rally === this.state.rally ? previous.intent : this.kickIntent(player);
      input.tossTarget = input.intent?.target || null;
      input.motionPreference = this.state.training && player.id === this.state.selected[0] ? this.state.training.lesson : 'auto';
      input.rally = this.state.rally;
      if (humans[player.team] && player.id === this.state.selected[player.team]) {
        const assignment = this.state.defense[player.team];
        const plan = assignment?.humanPlan || null;
        // This guides the physical motion, never reserves the ball collider.
        // A release or jump stops new receiving actuation on this same tick.
        input.receive = plan && input.kick && !input.jump && !input.jumpPressed ? { ...plan, allowSlide: true } : null;
      }
    }

    const count = this.config.simulation.substeps;
    for (let sub = 0; sub < count; sub++) {
      const beforeBall = this.physics.ball.translation();
      const events = this.physics.step(dt / count, this.inputs) || [];
      this.metrics.physicsSteps++;
      for (const event of events) this.handlePhysicsEvent(event, humans);
      this.confirmToss(humans);
      this.applyTuner();
      const afterBall = this.physics.ball.translation();
      if (this.mode === 'training') this.observeTraining();
      if (this.state.phase === 'rally' && beforeBall.x * afterBall.x < 0) {
        const play = this.state.play, leavingTeam = beforeBall.x < 0 ? 0 : 1;
        // A pass that actually crosses the net is an overpass, not a newly
        // chosen return. Keep the original intent and the observed outcome.
        if (play?.kind === 'toss' && play.team === leavingTeam && play.from === this.state.lastTouch) play.outcome = 'overpass';
        this.state.toss = null;
        const fraction = -beforeBall.x / (afterBall.x - beforeBall.x);
        const crossingHeight = beforeBall.y + (afterBall.y - beforeBall.y) * fraction;
        if (this.state.training?.contact && afterBall.x > beforeBall.x) {
          const crossingSide = beforeBall.z + (afterBall.z - beforeBall.z) * fraction;
          this.state.training.contact.crossed = crossingHeight >= this.config.court.netHeight + this.physics.settings.ballRadius - 0.02 && Math.abs(crossingSide) <= this.config.court.halfWidth;
        }
        if (crossingHeight < this.config.court.netHeight + this.physics.settings.ballRadius - 0.02) {
          const loser = this.state.lastTouch < 0 ? this.state.serving : Math.floor(this.state.lastTouch / 3);
          this.awardPoint(1 - loser, '네트 아래 통과');
        }
      }
      // Edge는 논리 틱 첫 물리 substep에서만 소비한다. held는 유지한다.
      for (const input of this.inputs) { input.jumpPressed = false; input.kickPressed = false; }
    }
    const velocity = this.physics.ball.linvel();
    this.state.ballSpeed = Math.hypot(velocity.x, velocity.y, velocity.z);
    this.metrics.maxBallSpeed = Math.max(this.metrics.maxBallSpeed, this.state.ballSpeed);
    const ball = this.physics.ball.translation();
    if (this.state.phase === 'rally' && (ball.y < -1 || Math.abs(ball.x) > 24 || Math.abs(ball.z) > 18)) {
      this.awardPoint(this.state.lastTouch < 0 ? 1 - this.state.serving : 1 - Math.floor(this.state.lastTouch / 3), '아웃');
    }
    if (this.mode === 'training' && this.state.phase === 'rally' && this.state.time - this.rallyStart > this.config.training.timeout) this.awardPoint(1, '다음 토스를 준비합니다.');
    this.state.tick = frame.tick + 1;
  }

  emit(event) {
    this.events.push({ tick: this.state.tick, sequence: this.events.length, playerId: -1, team: -1, speed: 0, position: { x: 0, y: 0, z: 0 }, ...event });
  }

  prepareRally() {
    this.state.phase = 'ready';
    this.state.timer = this.mode === 'training' ? this.config.training.ready : this.config.rules.ready;
    this.state.touches = 0; this.state.possession = -1; this.state.lastTouch = -1; this.state.toss = null; this.state.play = null; this.state.defense = [null, null];
    this.state.pointWinner = -1; this.state.pointReason = '';
    this.state.selected = [2, 5];
    this.state.timing = this.timingJudge.emptyRecords();
    this.state.lastMessage = this.mode === 'training' ? '다음 공을 준비합니다.' : `${this.state.serving === 0 ? '우리 팀' : '상대 팀'} 서브`;
    if (this.state.training) {
      const training = this.state.training;
      training.previousResult = training.result;
      Object.assign(training, { setAt: null, jumpAt: null, kickAt: null, jumpOffset: null, kickOffset: null,
        entry: null, motionId: null, contact: null, result: null, setApex: 0 });
    }
    this.placeServe();
    for (const ai of this.ai) Object.assign(ai, { x: 0, z: 0, active: false, kickFrom: 0, kickUntil: 0, jumpUntil: 0, cooldown: 0, previousJump: false, previousKick: false, attack: null, receive: null, brain: AiBrain.blankRecord() });
    this.aiDirty = true;
    this.revision++;
  }

  beginRally() {
    this.state.phase = 'rally';
    this.state.rally++;
    this.metrics.rallies++;
    this.state.touches = 0; this.state.possession = -1; this.state.lastTouch = -1; this.state.toss = null; this.state.play = null; this.state.defense = [null, null];
    this.rallyStart = this.state.time;
    this.state.timing = this.timingJudge.emptyRecords();
    if (this.mode === 'training') {
      const setter = this.physics.players[1], p = setter.root.translation(), feed = this.config.training.feed;
      this.state.training.attempt++;
      // A fresh drill feeds the setter. After this reset the setter's real
      // foot collision supplies the set, exactly as in a match.
      if (this.state.training.tempo === 'quick') {
        this.feedQuick(p);
        this.state.lastMessage = '낮고 빠른 토스가 옵니다. 점프를 짧게 누르고 바로 차세요.';
      } else {
        this.physics.resetBall({ x: p.x + feed.offset, y: feed.height, z: p.z - feed.lateral }, { x: 0, y: feed.rise, z: 0 });
        this.state.lastMessage = '세터가 높게 올립니다. 바닥 발자국에서 준비하세요.';
      }
    } else {
      // 서브는 사람·AI 모두 같은 공 던지기다: 공을 들고(hold) 힘을 모은 만큼 위로 던진다. 사람은 발차기 버튼을 누른 시간, AI는 판마다 다른 값(aimCharge, 0~fullCharge초)이 모으는 시간이다.
      const aiCharge = seededUnit(this.state.seed, this.state.rally, 5) * this.config.ai.serve.toss.fullCharge;
      this.state.serveToss = this.humanServes(this.state.serving) ? { stage: 'hold', charge: 0 } : { stage: 'hold', charge: 0, aimCharge: aiCharge };
      this.holdServeBall();
      this.state.lastMessage = this.humanServes(this.state.serving)
        ? '서브 · 공 던지기를 짧게 누르면 낮게, 꾹 누르면 높게 위로 올라갑니다. 달리면서 던지면 공이 달리는 방향으로 날아갑니다. 던지기 전에 엔드라인 안쪽을 밟으면 반칙입니다.'
        : '서브 · 공의 위치를 확인하세요.';
    }
    this.emit({ type: 'serve', team: this.state.serving, position: { ...this.physics.ball.translation() } });
    this.revision++;
  }

  /**
   * 서브 라인 반칙(사람·AI 같은 규칙): 서버가 공을 던지기 전에 발이 엔드라인 안쪽(코트 쪽)을 밟으면 서브 팀이 실점한다.
   * 사람은 던지기 버튼을 뗄 때까지 매 틱, AI는 공을 던지는 순간(서브 시작)에 검사한다. 반칙이면 점수를 주고 true.
   */
  callServeFootFault() {
    const team = this.state.serving, n = team === 0 ? 1 : -1, server = this.physics.players[this.serverId(team)];
    if (!['footL', 'footR'].some(name => server.byName[name].body.translation().x * n > -this.config.court.halfLength)) return false;
    this.awardPoint(1 - team, '서브 라인 반칙');
    return true;
  }

  /** 공 던지기 전: 공을 서버 앞 손 높이에 가만히 둔다(서버가 움직이면 따라간다). */
  holdServeBall() {
    const { toss } = this.config.ai.serve, p = this.physics.players[this.serverId(this.state.serving)].root.translation(), n = this.state.serving === 0 ? 1 : -1;
    const ratio = Math.min(1, (this.state.serveToss?.charge || 0) / toss.fullCharge);
    this.physics.resetBall({ x: p.x + n * toss.offset, y: toss.height + toss.lift * ratio, z: p.z - n * 0.10 }, { x: 0, y: 0, z: 0 });
  }

  /**
   * 서브의 공 던지기(사람·AI 같은 규칙): 모으는 동안 힘(charge)이 쌓이고, 끝나는 순간 공을 위로만 던진다. 사람은 발차기 버튼을 떼는 순간, AI는 charge가 aimCharge에 닿는 순간이다.
   * 꼭짓점은 charge 0이면 minApex, fullCharge초 이상이면 maxApex이고 그 사이는 선형이다. 앞뒤·좌우 속도는 서버가 던지는 순간 움직이던 속도 그대로라, 서 있으면 제자리에 떨어지고 달리면서 던지면 그 방향으로 날아간다. 던진 뒤 공은 일반 물리로 움직인다.
   * 상태는 state.serveToss(저장됨)에만 있어 롤백해도 같다.
   */
  updateServeToss(humans, dt) {
    const toss = this.state.serveToss;
    if (!toss || toss.stage === 'thrown' || this.state.phase !== 'rally' || this.state.lastTouch >= 0) return;
    const human = humans[this.state.serving], cfg = this.config.ai.serve.toss;
    if (this.callServeFootFault()) return;
    const held = this.humanServes(this.state.serving) ? !!human?.toss : toss.charge < toss.aimCharge, pressed = !!human?.tossPressed;
    if (held || pressed) { toss.charging = true; toss.charge += dt; }
    const idle = this.state.time - this.rallyStart > cfg.maxHold;
    if (!(toss.charging && !held) && !idle) { this.holdServeBall(); return; }
    const ratio = Math.min(1, toss.charge / cfg.fullCharge), apex = cfg.minApex + (cfg.maxApex - cfg.minApex) * ratio;
    const gravity = Math.abs(this.physics.settings.gravity), p = this.physics.ball.translation();
    const move = this.physics.players[this.serverId(this.state.serving)].root.linvel();
    this.physics.resetBall(p, { x: move.x, y: Math.sqrt(2 * gravity * (apex - p.y)), z: move.z });
    toss.stage = 'thrown'; toss.apex = apex;
    this.state.lastMessage = '서브 · 공이 올라갑니다. 점프와 발차기로 차세요.';
  }

  /**
   * 속공 토스: 세터 옆에서 낮은 포물선으로 공격수 앞 낙하 타점(낮은 공격의 접촉 높이)에 정확히 닿게 한다.
   * 높은 토스처럼 세터 발 충돌에 맡기면 세트 높이가 발 접촉에 따라 불연속으로 바뀌어 낮은 공격 구간(shortJump)에 들어오지 않는다.
   * 토스 시각을 기록(setAt)해 안내가 바로 열린다.
   */
  feedQuick(setterPosition) {
    const { quick } = this.config.training, { lowAttack, attack } = this.config.ai.toss, gravity = Math.abs(this.physics.settings.gravity);
    const hp = this.physics.players[this.state.selected[0]].root.translation();
    const start = { x: setterPosition.x + quick.offset, y: quick.height, z: setterPosition.z };
    const contact = { x: Math.min(hp.x + attack.offset, -0.9), y: (lowAttack.minHeight + lowAttack.maxHeight) / 2, z: hp.z - attack.lateral };
    const rise = Math.sqrt(2 * gravity * (quick.apex - start.y));
    const time = (rise + Math.sqrt(rise * rise - 2 * gravity * (contact.y - start.y))) / gravity;
    this.physics.resetBall(start, { x: (contact.x - start.x) / time, y: rise, z: (contact.z - start.z) / time });
    this.state.training.setAt = this.state.time;
  }

  handlePhysicsEvent(event, humans) {
    if (event.type === 'land') { this.emit(event); return; }
    if (this.state.phase !== 'rally') return;
    // 공을 던지기 전(손에 든 공)에는 몸이 부딪혀도 터치·반칙·낙하로 세지 않는다. 공은 매 틱 손 자리로 되돌려진다.
    if (this.state.serveToss?.stage === 'hold') return;
    if (event.type === 'touch') {
      if (this.state.training && event.playerId === this.state.selected[0]) {
        const training = this.state.training, player = this.physics.players[event.playerId];
        const foot = /^foot/.test(event.part || '');
        if (!training.contact || (foot && !training.contact.foot)) {
          training.contact = { part: event.part, foot,
            downward: foot && !!event.footVelocity && event.footVelocity.y < -1 && event.position.y > this.config.court.netHeight,
            height: event.position.y, entry: player.kick.airPlan?.entry || null,
            motionId: player.kick.airPlan?.motion?.id || null, time: this.state.time,
            outgoing: null, crossed: false, counted: false };
        }
      }
      if (/hand|forearm|upperArm/i.test(event.part || '')) {
        this.emit(event);
        this.awardPoint(1 - event.team, '핸드 반칙');
        return;
      }
      if (this.state.possession !== event.team) {
        this.state.possession = event.team;
        this.state.touches = 0;
      }
      this.state.touches++;
      this.state.lastTouch = event.playerId;
      this.releaseTuning(event.team);
      const defendedTouch = this.state.defense[event.team]?.playerId === event.playerId;
      if (this.mode !== 'training') {
        const defense = this.state.defense[event.team];
        this.state.defense = [null, null];
        if (defense && (defense.human || defense.plan.mode !== 'cushion')) this.aiDirty = true;
      }
      this.metrics.contacts++;
      if (defendedTouch) this.metrics.defensiveTouches++;
      // 스파이크 판정의 유일한 정의: 네트 위에서 발이 아래로 움직이며 공을 맞힘. 연출(spike 플래그)과 지표가 같은 값을 쓴다.
      const spike = /^foot/.test(event.part || '') && !!event.footVelocity && event.footVelocity.y < -1 && event.position.y > this.config.court.netHeight;
      event.spike = spike;
      const timing = this.judgeTiming(event, humans);
      this.emit(timing ? { ...event, timing } : event);
      if (this.state.touches > this.config.rules.contacts) {
        this.awardPoint(1 - event.team, '네 번째 터치');
        return;
      }
      if (spike) this.metrics.spikes++;
      if (spike && this.tuners[1 - event.team]) this.retuneTeam = 1 - event.team; // 학습한 받기 조정은 스파이크에만 학습했다
      const target = this.inputs[event.playerId]?.tossTarget;
      const set = target && /^(foot|lowerLeg)/.test(event.part || '') && this.physics.players[event.playerId].kick.mode === 'ground' && !spike;
      if (target?.playerId === -1 && /^(foot|lowerLeg)/.test(event.part || '') && !spike) this.physics.assistServe(this.physics.players[event.playerId], event.position, target);
      else if (set && target.playerId % 3 === 2) this.physics.assistSet(this.physics.players[event.playerId], event.position, target);
      const intent = this.inputs[event.playerId]?.intent;
      this.state.play = { team: event.team, from: event.playerId, to: target?.playerId ?? null,
        kind: spike ? 'attack' : intent?.kind || 'receive', reason: spike ? 'spike' : intent?.reason || 'contact',
        condition: intent?.condition || null, part: event.part, at: this.state.time,
        outcome: target && !spike ? (set ? 'pending' : 'mishit') : 'contact' };
      this.state.toss = set ? { team: event.team, from: event.playerId, to: target.playerId, started: this.state.time, pending: true } : null;
      this.state.lastMessage = spike ? '스파이크!' : set ? '아군에게 받아 올리세요.' : '상대 코트로 넘기세요.';
    } else if (event.type === 'ground') {
      this.emit(event);
      const p = event.position;
      const inside = Math.abs(p.x) <= this.config.court.halfLength + 0.03 && Math.abs(p.z) <= this.config.court.halfWidth + 0.03;
      const loser = inside ? (p.x < 0 ? 0 : 1) : this.state.lastTouch < 0 ? this.state.serving : Math.floor(this.state.lastTouch / 3);
      this.awardPoint(1 - loser, inside ? '코트에 공이 닿았습니다.' : '아웃');
    } else if (event.type === 'net' && event.playerId >= 0) {
      this.emit(event);
      this.awardPoint(1 - event.team, '네트 터치');
    }
  }

  confirmToss(humans) {
    const pass = this.state.toss;
    if (this.state.phase !== 'rally' || !pass?.pending) return;
    // CCD can report contact at the end of a substep, before its response is
    // solved. Reserve the receiving ally after the actual upward response.
    if (this.physics.ball.linvel().y <= 1) {
      if (this.state.time - pass.started > 0.10) {
        if (this.state.play?.from === pass.from && this.state.play.kind === 'toss') this.state.play.outcome = 'mishit';
        this.state.toss = null;
      }
      return;
    }
    pass.pending = false;
    if (this.state.play?.from === pass.from && this.state.play.kind === 'toss') this.state.play.outcome = 'set';
    if (this.state.training && pass.from === 1 && pass.to === this.state.selected[0]) this.state.training.setAt = this.state.time;
    this.aiDirty = true;
    this.state.lastMessage = pass.to % 3 === 2 ? '공격수에게 토스 · 점프 타이밍을 맞추세요.' : '아군에게 리시브 · 다음 토스를 준비하세요.';
    for (const player of this.physics.players) {
      if (player.team !== pass.team || player.id === pass.to || player.id === pass.from || player.jump.active) continue;
      if (humans[pass.team] && this.state.selected[pass.team] === player.id) continue;
      // Cancel other chasers while the passer completes its scheduled stroke.
      this.ai[player.id].kickFrom = this.ai[player.id].kickUntil = this.ai[player.id].jumpUntil = 0;
    }
  }

  awardPoint(winner, reason) {
    if (this.state.phase !== 'rally') return;
    this.releaseTuning(0); this.releaseTuning(1);
    this.state.phase = 'point';
    this.state.toss = null;
    this.state.defense = [null, null];
    this.state.pointWinner = winner;
    this.state.pointReason = reason;
    this.state.timer = this.mode === 'training' ? this.config.training.retry : this.config.rules.point;
    if (this.state.training) this.finishTraining(reason);
    this.state.lastMessage = this.mode === 'training' ? `${reason} · 다시 도전해 보세요.` : `${winner === 0 ? '우리 팀' : '상대 팀'} 득점 · ${reason}`;
    if (this.mode !== 'training') {
      this.state.score[winner]++;
      const [a, b] = this.state.score;
      const limit = a >= this.config.rules.deuce && b >= this.config.rules.deuce ? this.config.rules.cap : this.config.rules.points;
      if (this.state.score[winner] >= limit) {
        this.state.sets[winner]++;
        if (this.state.sets[winner] >= this.config.rules.sets) {
          this.state.phase = 'finished';
          this.state.matchWinner = winner;
          this.state.lastMessage = `${winner === 0 ? '우리 팀' : '상대 팀'} 승리!`;
        } else {
          this.state.set++;
          this.state.score = [0, 0];
          this.state.lastMessage = `${winner === 0 ? '우리 팀' : '상대 팀'} 세트 획득 · 다음 세트를 준비합니다.`;
        }
      }
      this.state.serving = 1 - this.state.serving;
    }
    this.emit({ type: 'point', team: winner, position: { ...this.physics.ball.translation() }, reason });
  }

  /** 이번 서브를 사람이 하는가(서브 첫 타격 전). 이때 서브 공은 서버가 받아 차는 공이라 사람 발차기가 받기 동작으로 이어진다. */
  humanServes(team) { return this.humanTeams[team] && this.mode !== 'training' && this.state.serving === team && this.state.lastTouch < 0; }

  /** 서브하는 선수. 사람이 있는 팀은 사람이 조작하는 공격수가 뒤에서 서브하고, 사람이 없는 팀은 첫 번째 선수가 서브한다. */
  serverId(team) { return this.humanTeams[team] && this.mode !== 'training' ? this.state.selected[team] : team * 3; }

  /** 서브 시작 자리: 사람이 서브하면 공격수가 자기 코트 뒤쪽 서브 자리(ai.serve.spot, 팀 방향 좌표)에서 시작한다. */
  serveStarts() {
    const team = this.state.serving, id = this.serverId(team);
    if (this.mode === 'training') return null;
    const player = this.physics.players[id], n = player.toward, spot = this.config.ai.serve.spot;
    // 사람 서버는 서브 자리(x, z), AI 서버는 서브 자리 x에 자기 자리 z로 선다(엔드라인 뒤). 서브 뒤 AI는 평소처럼 자기 포메이션으로 돌아간다.
    return { [id]: { x: spot.x * n, z: id === team * 3 ? player.home.z : spot.z * n } };
  }

  /** 서브 직전 배치: 선수를 시작 자리에 세우고 공을 서버 발밑에 둔다. */
  placeServe() {
    this.physics.resetPlayers(this.serveStarts());
    const pos = this.physics.players[this.serverId(this.state.serving)].root.translation();
    this.physics.resetBall({ x: pos.x, y: 0.2, z: pos.z }, { x: 0, y: 0, z: 0 });
  }

  receptionDistance(player, intercept) {
    const p = player.root.translation();
    return Math.hypot(p.x - intercept.x, p.z - intercept.z) +
      (/recover|fall|down/i.test(player.state) ? 2 : 0) + (this.state.lastTouch === player.id ? 1.3 : 0);
  }

  isReceiveBall(team, intercept) {
    if ((this.mode === 'training' && !this.isolated) || this.state.phase !== 'rally') return false;
    const toward = team === 0 ? 1 : -1;
    // A ball already below the normal receiving height may still have a
    // reachable lower slide contact. The physical planner verifies that path.
    if ((!intercept.reachable && this.physics.ball.translation().y >= this.config.ai.receiveHeight) ||
        intercept.x * toward >= -0.15) return false;
    if (this.state.lastTouch < 0) return this.state.serving !== team || this.humanServes(team);
    if (this.state.possession !== team) return true;
    if (this.state.touches >= this.config.rules.contacts) return false;
    const pass = this.state.toss?.team === team ? this.state.toss : null;
    if (!pass) return true;
    // A normal attacking set keeps its recipient and the existing jump/kick
    // meaning. Only an observed mishit or a missed reception becomes a save.
    if (pass.to === this.state.selected[team] || pass.pending) return false;
    const recipient = this.physics.players[pass.to], position = recipient.root.translation();
    const reach = recipient.settings.movementSpeed * Math.max(0, intercept.time - 0.1) + recipient.settings.receive.lungeReach;
    return /fall|recover|down/.test(recipient.state) || Math.hypot(position.x - intercept.x, position.z - intercept.z) > reach;
  }

  decideReceive(team, human, available, intercept, preferred) {
    const previous = this.state.defense[team];
    this.state.defense[team] = null;
    for (let id = team * 3; id < team * 3 + 3; id++) this.ai[id].receive = null;
    if (!this.isReceiveBall(team, intercept)) return null;
    const settings = this.config.ai.receive;
    const effort = (player, plan) => {
      const position = player.root.translation();
      return Math.hypot(position.x - plan.stance.x, position.z - plan.stance.z) / player.settings.movementSpeed +
        (plan.reachable ? 0 : 2) + (this.state.lastTouch === player.id ? 0.4 : 0);
    };
    const candidates = available.map(player => ({ player, plan: this.physics.planReceive(player) })).filter(item => item.plan);
    // Every player has a real physics reach estimate. A chosen but unreachable
    // "preferred" chaser must never block a teammate who can actually save it.
    const reachable = candidates.filter(item => item.plan.reachable)
      .sort((a, b) => effort(a.player, a.plan) - effort(b.player, b.plan) || a.player.id - b.player.id);
    const preferredItem = reachable.find(item => item.player === preferred);
    const previousItem = reachable.find(item => item.player.id === previous?.playerId);
    const best = reachable[0];
    const sticky = previousItem && best &&
      effort(previousItem.player, previousItem.plan) <= effort(best.player, best.plan) + settings.hysteresis;
    const selected = sticky ? previousItem : preferredItem && best &&
      effort(preferredItem.player, preferredItem.plan) <= effort(best.player, best.plan) + settings.hysteresis
      ? preferredItem : best || candidates.sort((a, b) =>
        effort(a.player, a.plan) - effort(b.player, b.plan) || a.player.id - b.player.id)[0];
    let actor = selected?.player || null, plan = selected?.plan || null;
    const controlled = human ? this.physics.players[this.state.selected[team]] : null;
    const intends = human && (human.kick || human.kickPressed) && !human.jump && !human.jumpPressed;
    let humanPlan = intends ? this.physics.planReceive(controlled, human) : null;
    if (!humanPlan?.reachable) humanPlan = null;
    const previousActor = previous && this.physics.players[previous.playerId];
    const action = previousActor?.receive;
    const held = previousActor === controlled ? intends : previousActor && this.ai[previousActor.id].kickUntil > this.state.time &&
      this.ai[previousActor.id].kickFrom <= this.state.time;
    const physicalCommit = held && action?.committed && action.hitAt === null && action.phase !== 'recover' && this.physics.time < action.until;
    const closeCommit = held && previous?.plan.reachable && previous.plan.at + previous.plan.time - this.physics.time <= settings.commitLead &&
      previous.plan.at + previous.plan.time + this.config.ai.toss.ground.followThrough >= this.physics.time;
    if (physicalCommit || closeCommit) {
      actor = previousActor;
      plan = { ...previous.plan, point: { ...(action?.point || previous.plan.point) },
        at: this.physics.time, time: Math.max(0, (action?.contactAt ?? previous.plan.at + previous.plan.time) - this.physics.time) };
      if (actor === controlled) humanPlan = plan;
    } else if (humanPlan && humanPlan.time <= settings.claimLead &&
        (!plan || !plan.reachable || effort(controlled, humanPlan) <= effort(actor, plan) + settings.claimSlack)) {
      actor = controlled; plan = humanPlan;
    }
    if (!actor || !plan) return null;
    const assignment = { playerId: actor.id, team, human: actor === controlled,
      plan: structuredClone(plan), humanPlan: humanPlan ? structuredClone(humanPlan) : null };
    this.state.defense[team] = assignment;
    if (previous && previous.playerId !== actor.id) this.metrics.defensiveSwitches++;
    if (actor !== controlled) this.ai[actor.id].receive = structuredClone(plan);
    return assignment;
  }

  /** 사람이 있는 팀의 AI 동료 대기 자리(월드 좌표 Map). 사람이 없거나 기능이 꺼져 있으면 null이라 기본 자리를 쓴다. */
  fillTargets(team, human) {
    const options = this.config.ai.fill;
    if (!human || !options?.enabled) return null;
    const selected = this.physics.players[this.state.selected[team]];
    if (!selected || selected.team !== team) return null;
    const n = selected.toward, position = selected.root.translation();
    const allies = this.physics.players.filter(player => player.team === team && player !== selected)
      .map(player => ({ id: player.id, role: player.role, home: { x: player.home.x * n, z: player.home.z * n } }));
    const plan = this.formation.plan({ x: position.x * n, z: position.z * n }, allies, { x: selected.home.x * n, z: selected.home.z * n });
    return new Map([...plan].map(([id, point]) => [id, { x: point.x * n, z: point.z * n }]));
  }

  /** 사람이 발차기를 누르고 받을 자리로 달릴 때 자리에서 멈추게 입력 크기만 줄인다. 방향·점프·발차기는 건드리지 않는다. */
  assistReceive(team, human) {
    const settings = this.config.ai.receive.assist;
    if (!human || !settings || this.mode === 'training' || this.state.phase !== 'rally') return human;
    if (!(human.kick || human.kickPressed) || human.jump || human.jumpPressed) return human;
    const assignment = this.state.defense[team], plan = assignment?.humanPlan || (assignment?.human ? assignment.plan : null);
    const player = this.physics.players[this.state.selected[team]];
    if (!plan || plan.mode === 'slide' || player.receive?.mode === 'slide' || !plan.stance) return human;
    const remaining = plan.at + plan.time - this.physics.time;
    if (!(remaining > 0 && remaining <= settings.window)) return human;
    const magnitude = Math.hypot(human.x, human.z);
    if (magnitude <= settings.minInput) return human;
    const root = player.root.translation(), dx = plan.stance.x - root.x, dz = plan.stance.z - root.z, distance = Math.hypot(dx, dz);
    if (distance < 0.02) return { ...human, x: 0, z: 0 };
    if ((human.x * dx + human.z * dz) / (magnitude * distance) <= settings.cone) return human;
    const scale = Math.min(1, distance * settings.brake / magnitude);
    return scale >= 1 ? human : { ...human, x: human.x * scale, z: human.z * scale };
  }

  receiveCover(player, assignment) {
    const point = assignment.plan.point, distance = this.config.ai.receive.coverDistance;
    const n = player.toward, limit = this.config.court.halfWidth - 0.25;
    // 리시버 역할의 보조 자리만 여기서 정한다. 세터·공격수의 보조 자리는 ai-brain.js의 CoverState가 정한다.
    const target = { x: point.x - n * distance, z: point.z + (player.home.z < point.z ? -1 : 1) * distance };
    const dx = target.x - point.x, dz = target.z - point.z, length = Math.hypot(dx, dz);
    if (length < distance) {
      target.x = point.x + (length > 0.01 ? dx / length : -n) * distance;
      target.z = point.z + (length > 0.01 ? dz / length : 0) * distance;
    }
    return { x: n * Math.max(-this.config.court.halfLength + 0.35, Math.min(-0.6, target.x * n)),
      z: Math.max(-limit, Math.min(limit, target.z)) };
  }

  getReceiveGuides() {
    if (this.state.phase !== 'rally') return [null, null];
    return this.state.defense.map(assignment => {
      if (!assignment) return null;
      const player = this.physics.players[assignment.playerId], action = player.receive, plan = assignment.plan;
      const stage = action?.phase || (plan.reachable ? 'approach' : 'late');
      return { playerId: player.id, team: player.team, human: assignment.human,
        point: { ...(action?.point || plan.point) }, stance: { ...plan.stance },
        mode: action?.mode || plan.mode, reachable: plan.reachable, stage,
        remaining: Math.max(0, (action?.contactAt ?? plan.at + plan.time) - this.physics.time) };
    });
  }

  kickIntent(player) {
    if (this.state.phase !== 'rally') return null;
    // A serve and the last legal team contact must clear the net. Every other
    // grounded kick builds the team's attack, including a human reception.
    if (this.mode !== 'training' && this.state.lastTouch < 0 && this.state.serving === player.team) {
      // 서브 발차기는 사람·AI 모두 상대 코트 뒤쪽 한가운데를 향해 네트를 넘는 공을 만든다(공중 발차기는 기존 그대로 앞으로 내리찍는다).
      const target = { x: player.toward * this.config.ai.serve.groundAim.x, z: 0, playerId: -1 };
      return { kind: 'return', reason: 'serve', from: player.id, target };
    }
    if (this.state.possession === player.team && this.state.touches >= this.config.rules.contacts - 1) return { kind: 'return', reason: 'last_touch', from: player.id, target: null };
    // The designated attacker prepares a high foot for the incoming set. This
    // is the same final-attack intent for either team and either input owner.
    if (player.role === 'attacker' && this.state.toss?.to === player.id) return { kind: 'attack', reason: 'set_received', from: player.id, target: null };
    const preferred = player.role === 'setter' || (this.state.possession === player.team && this.state.touches > 0) ? 'attacker' : 'setter';
    const origin = player.root.translation();
    const recoveringAttacker = ally => ally.role === 'attacker' && preferred === 'attacker' &&
      this.state.lastTouch === ally.id && this.state.touches === 1 && ally.receive?.mode === 'slide' &&
      Math.max(0, ally.receive.until - this.physics.time) < Math.sqrt(2 * this.physics.settings.groundToss.attackApex / this.physics.settings.gravity);
    const candidates = this.physics.players.filter(ally => ally.team === player.team && ally.id !== player.id);
    candidates.sort((a, b) => {
      const rank = ally => {
        const p = ally.root.translation();
        return (/fall|recover|down/i.test(ally.state) && !recoveringAttacker(ally) ? 20 : 0) + (ally.role === preferred ? 0 : 6) + Math.hypot(p.x - origin.x, p.z - origin.z);
      };
      return rank(a) - rank(b) || a.id - b.id;
    });
    const ally = candidates[0], p = ally.root.translation(), n = player.toward;
    const preferredAlly = candidates.find(candidate => candidate.role === preferred);
    const condition = recoveringAttacker(ally) ? 'recovering_attacker' : ally.role === preferred || !preferredAlly ? null : /fall|recover|down/i.test(preferredAlly.state) ? 'recovering' : 'distance';
    const spread = ally.role === 'attacker' ? this.tossSpread(player) : { x: 0, z: 0 };
    return { kind: 'toss', reason: condition && condition !== 'recovering_attacker' ? 'cover' : ally.role === 'attacker' ? 'set' : 'receive',
      condition, from: player.id, target: { playerId: ally.id,
      x: n * Math.max(-this.config.court.halfLength + 0.5, Math.min(-0.95, p.x * n + this.tuned(player.team, 'aimDx', this.config.ai.toss.aim.dx) + spread.x)),
      z: Math.max(-2.55, Math.min(2.55, p.z - n * 0.10 + this.tuned(player.team, 'aimDz', this.config.ai.toss.aim.dz) + spread.z)),
    } };
  }

  /**
   * 세트 목표점의 흩어짐: 공격수 기준점 둘레의 직사각형 안에서 점 하나를 고른다. 앞뒤(x)는 좁고 좌우(z)는 넓다 —
   * 앞뒤가 크게 흔들리면 공격수가 때릴 각이 나오지 않기 때문이다. 반 길이는 세터의 토스(setting) 능력이 높을수록 작다
   * (ai.toss.spread.half.x/z = [능력 기본값일 때, 능력 최대일 때] m). 같은 시드·랠리·터치 수·세터면 같은 점이라 피어끼리 일치하고,
   * 한 번의 토스 동안 AI 판단을 다시 해도 목표가 바뀌지 않는다. 연습 모드는 같은 상황의 반복을 위해 흩어지지 않는다.
   * 반환 값은 팀 방향 좌표(앞=+, 옆)라서 호출하는 쪽이 팀 방향을 곱한다.
   */
  tossSpread(setter) {
    const spread = this.config.ai.toss.spread;
    if (!spread || this.mode === 'training') return { x: 0, z: 0 };
    const bonus = this.config.athletes.bonus.setting, ratio = bonus > 0 ? Math.min(1, Math.max(0, (setter.effects?.setting ?? 0) / bonus)) : 0;
    const half = axis => spread.half[axis][0] + (spread.half[axis][1] - spread.half[axis][0]) * ratio;
    const key = [this.state.seed, this.state.rally, this.state.touches, setter.id];
    return { x: half('x') * (2 * seededUnit(...key, 1) - 1), z: half('z') * (2 * seededUnit(...key, 2) - 1) };
  }

  /** 팀의 학습 조정 값. 조정이 없거나 해당 이름이 없으면 기본값을 돌려준다. */
  tuned(team, name, fallback) { return this.tuning[team]?.[name] ?? fallback; }

  /** 팀의 조정 값을 바꾼다. values는 이름 → 유한한 수의 객체이며 null이면 기본으로 되돌린다. */
  setTuning(team, values) {
    if (values && !Object.values(values).every(Number.isFinite)) throw new Error('조정 값은 유한한 수여야 합니다.');
    this.tuning[team] = values ? { ...values } : null;
    this.physics.setTossTuning(team, this.tuning[team]);
  }

  /** 팀의 조정기를 등록한다. null이면 해제하고 조정 값도 기본으로 되돌린다. */
  setTuner(team, tuner) {
    if (tuner !== null && typeof tuner !== 'function') throw new Error('조정기는 함수여야 합니다.');
    this.tuners[team] = tuner;
    if (!tuner) this.setTuning(team, null);
  }

  // TOBE(learning) 받는 선수 선택: applyTuner는 착지 예상 지점에 가장 가까운 선수를 고른다. 학습 장면의 받는 선수(세터)와 다를 수 있다(docs/learning-tobe.md ①).
  /** 조정기가 있는 팀의 조정 값을 기본으로 되돌린다. 받기 학습은 첫 접촉(받는 동작)만 학습했으므로 그 뒤의 토스·공격에는 쓰지 않는다. */
  releaseTuning(team) { if (this.tuners[team] && this.tuning[team]) this.setTuning(team, null); }

  /** 상대가 방금 공을 쳤다면, 공이 반응한 뒤 착지 예상 지점에 가장 가까운 선수 기준으로 팀 조정 값을 갱신한다. */
  applyTuner() {
    const team = this.retuneTeam;
    if (team < 0) return;
    this.retuneTeam = -1;
    const tuner = this.tuners[team];
    if (!tuner || this.state.phase !== 'rally') return;
    const land = this.predictAtHeight(this.config.ai.receiveHeight);
    if (!land.reachable) return;
    let nearest = null, best = Infinity;
    for (const player of this.physics.players) {
      if (player.team !== team) continue;
      const t = player.root.translation(), d = Math.hypot(t.x - land.x, t.z - land.z);
      if (d < best) { best = d; nearest = player.id; }
    }
    if (nearest !== null) this.setTuning(team, tuner(this, nearest));
  }

  tossTarget(player) { return this.kickIntent(player)?.target || null; }

  getTeamPlay(team) {
    if (this.mode === 'training') return null;
    const state = this.state, play = state.play;
    const names = { receiver: '리시버', setter: '세터', attacker: '공격수' };
    const name = id => names[this.physics.players[id]?.role] || '동료';
    const result = (title, detail, tone = 'neutral', data = null) => ({ title, detail, tone,
      stage: state.phase, from: data?.from ?? null, to: data?.to ?? data?.target?.playerId ?? null,
      kind: data?.kind || null, reason: data?.reason || null });
    const overpass = play?.outcome === 'overpass';
    if (state.phase === 'point' || state.phase === 'finished') {
      const winner = state.phase === 'finished' ? state.matchWinner : state.pointWinner;
      const title = `${winner === team ? '우리 팀' : '상대 팀'} ${state.phase === 'finished' ? '승리' : '득점'}`;
      const detail = overpass ? `${play.team === team ? '우리' : '상대'} 토스가 길어 네트를 넘었어요 · ${state.pointReason}` : state.pointReason;
      return result(title, detail, overpass && play.team === team ? 'warning' : 'neutral', play);
    }
    if (state.phase === 'ready') return result(`${state.serving === team ? '우리 팀' : '상대 팀'} 서브 준비`, '서브는 상대 코트로 · 리시브 뒤에는 동료에게 연결해요.');
    const defense = state.defense[team];
    if (defense) {
      const actor = this.physics.players[defense.playerId], action = actor.receive;
      const motion = action?.mode === 'slide' ? '슬라이딩 리시브' : action?.mode === 'lunge' ? '옆으로 뻗어 받는 중' : action ? '발로 받아 올리는 중' : '리시브 준비';
      const title = `${defense.human ? '내' : name(actor.id)} ${motion}`;
      const detail = defense.human ? '좌클을 유지해 받으세요. 동료는 다음 공을 커버해요.' :
        defense.plan.reachable ? '빈 공간으로 이동해 좌클을 누르면 직접 받아낼 수 있어요.' : '먼 공을 따라가는 중이에요. 가까운 빈 공간을 직접 커버해 보세요.';
      return result(title, detail, defense.human ? 'ready' : 'neutral', { from: actor.id, kind: 'receive', reason: 'defense' });
    }
    if (play?.kind === 'attack' && play.from === state.lastTouch) {
      const own = play.team === team, toward = play.team === 0 ? 1 : -1;
      const crossed = this.physics.ball.translation().x * toward > this.physics.settings.ballRadius;
      return result(`${own ? '우리 팀' : '상대 팀'} ${state.touches === this.config.rules.contacts ? '세 번째 터치 · ' : ''}스파이크`,
        crossed ? '실제 발 타격으로 네트를 넘겼어요. 다음 공을 준비하세요.' : '공중에서 발로 타격했어요. 공이 넘어가는 궤적을 확인하세요.',
        own ? 'ready' : 'warning', play);
    }
    if (overpass) return result(play.team === team ? '토스가 길어 상대 코트로 넘어갔어요' : '상대 토스가 우리 코트로 넘어왔어요',
      play.team === team ? `${name(play.from)}가 ${name(play.to)}에게 올리던 공이에요. 다음 공을 수비하세요.` : '반환을 선택한 공이 아니라 빗나간 토스예요. 받을 자리를 잡으세요.',
      play.team === team ? 'warning' : 'ready', play);
    if (play?.kind === 'toss' && play.outcome === 'mishit') return result(`${play.team === team ? '우리' : '상대'} 토스가 빗맞았어요`,
      `${name(play.from)}가 ${name(play.to)}에게 연결하려던 공이에요. 공의 위치를 확인하세요.`, 'warning', play);
    const pass = state.toss;
    if (pass?.team === team) {
      const remaining = this.config.rules.contacts - state.touches;
      const detail = remaining <= 0 ? '같은 팀이 추가로 닿으면 네 번째 터치 반칙이에요.' :
        remaining === 1 ? '남은 터치 1회 · 다음 타격은 상대 코트로 보내야 해요.' :
        play?.condition === 'recovering_attacker' ? '공격수가 일어날 수 있도록 높은 토스를 준비해요. 회복 뒤 공격할 자리로 이동하세요.' :
        play?.reason === 'cover' ? play.condition === 'recovering' ?
        '받을 선수가 자세를 회복 중이라 다른 동료에게 연결해요.' : '받을 선수가 멀어 가까운 동료에게 연결해요.' :
        pass.to === state.selected[team] ? '바닥 발자국으로 이동해 점프 타이밍을 맞추세요.' : '리시브 → 세터 → 공격수 순서로 공격을 준비해요.';
      return result(`${name(pass.from)} → ${name(pass.to)} ${pass.pending ? '받아 올리는 중' : '토스'}`, detail, pass.to === state.selected[team] ? 'ready' : 'neutral', play);
    }
    const landing = this.predictAtHeight(this.config.ai.receiveHeight);
    const actingTeam = state.lastTouch < 0 ? state.serving : landing.x < 0 ? 0 : 1;
    const active = this.physics.players.find(player => player.team === actingTeam && this.ai[player.id].active);
    const actor = active || this.physics.players[state.selected[actingTeam]];
    const intent = this.inputs[actor.id]?.intent;
    const own = actingTeam === team;
    if (intent?.reason === 'serve') return result(`${own ? '우리 팀' : '상대 팀'} 서브`, '서브 첫 타격은 상대 코트로 보내요.', 'neutral', intent);
    if (state.possession === actingTeam && state.touches >= this.config.rules.contacts) return result(`${own ? '우리 팀' : '상대 팀'} ${this.config.rules.contacts}회 타격 완료`,
      '같은 팀이 추가로 닿으면 네 번째 터치 반칙이에요.', 'neutral', play);
    if (intent?.reason === 'last_touch') return result(own ? '마지막 터치 · 상대 코트로' : '상대 마지막 터치 · 우리 코트로',
      `${own ? '우리 팀이' : '상대 팀이'} 이미 ${this.config.rules.contacts - 1}회 접촉했어요. 다음 타격은 네트를 넘어야 해요.`, own ? 'ready' : 'neutral', intent);
    if (intent?.kind === 'attack') return result(own ? '공격수 · 스파이크 준비' : '상대 공격수 · 스파이크 준비',
      own ? '공과의 거리·점프 높이·발차기 타이밍을 맞추세요.' : '상대가 내려칠 공을 수비하세요.', own ? 'ready' : 'neutral', intent);
    if (intent?.kind === 'toss') {
      const detail = intent.reason === 'cover' ? intent.condition === 'recovering' ?
        '받을 선수가 자세를 회복 중이라 다른 동료에게 연결해요.' : '받을 선수가 멀어 가까운 동료에게 연결해요.' :
        intent.target.playerId === state.selected[team] ? `${name(actor.id)}가 올릴 공을 보고 공격할 자리를 잡으세요.` : '남은 터치로 리시브와 토스를 연결해요.';
      return result(`${own ? '' : '상대 '}${name(actor.id)} → ${name(intent.target.playerId)} 토스 준비`, detail, 'neutral', intent);
    }
    return result(own ? '우리 팀 공격 준비' : '상대 공을 받는 중', '리시브 → 세터 → 공격수 · 팀당 최대 3회 접촉이에요.');
  }

  predictAtHeight(height) {
    const p = this.physics.ball.translation();
    const v = this.physics.ball.linvel();
    const gravity = Math.abs(this.physics.settings.gravity);
    const discriminant = v.y * v.y + 2 * gravity * (p.y - height);
    const t = discriminant > 0 ? Math.max(0, (v.y + Math.sqrt(discriminant)) / gravity) : 0;
    return { x: p.x + v.x * t, z: p.z + v.z * t, time: t, reachable: discriminant >= 0 && t > 0 };
  }

  predictAerial(player = null) {
    const p = this.physics.ball.translation();
    const v = this.physics.ball.linvel();
    const { lowAttack, attack } = this.config.ai.toss;
    const jumpGain = player ? player.settings.jumpSpeed - this.physics.settings.jumpSpeed : 0;
    const highHeight = this.config.ai.toss.airContactHeight + jumpGain * attack.checkLead;
    const highAerial = this.predictAtHeight(highHeight);
    const gravity = Math.abs(this.physics.settings.gravity);
    const apex = p.y + Math.max(0, v.y) ** 2 / (2 * gravity);
    const shortJump = !highAerial.reachable || apex < highHeight + attack.preparation.apexMargin;
    const contactLead = shortJump ? lowAttack.contactLead : attack.checkLead;
    // A low set's narrow height window can open just before maxLead. Keep one
    // AI decision interval so the 15 Hz controller cannot skip that window.
    const maxLead = shortJump ? Math.max(attack.maxLead,
      contactLead + 1 / this.config.simulation.aiRate) : attack.maxLead;
    const overheadHeight = p.y + v.y * contactLead - 0.5 * gravity * contactLead * contactLead;
    const heightGain = jumpGain * contactLead;
    const height = shortJump ? (lowAttack.minHeight + lowAttack.maxHeight) / 2 + heightGain : highHeight;
    const aerial = { ...(shortJump ? this.predictAtHeight(height) : highAerial), y: height };
    return { ...aerial, shortJump, contactLead, maxLead,
      jumpWindow: shortJump ? overheadHeight >= lowAttack.minHeight + heightGain && overheadHeight <= lowAttack.maxHeight + heightGain : overheadHeight > attack.minHeight + heightGain && overheadHeight < attack.maxHeight + heightGain,
    };
  }

  approachPosition(team, aim, offset) {
    const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
    const n = team === 0 ? 1 : -1, sideLimit = this.config.court.halfWidth - 0.15;
    // 서브 중(첫 터치 전, 서브 팀)에는 서버가 엔드라인 뒤에 설 수 있도록 뒤쪽 한계를 서브 자리까지 푼다.
    const back = this.state.lastTouch < 0 && this.state.serving === team ? Math.max(6.2, Math.abs(this.config.ai.serve.spot.x) + 0.3) : 6.2;
    return { x: clamp(aim.x - n * offset, team === 0 ? -back : 0.6, team === 0 ? -0.6 : back),
      z: clamp(aim.z + n * this.config.ai.toss.attack.lateral, -sideLimit, sideLimit) };
  }

  recordTrainingInput() {
    const training = this.state.training;
    if (!training || this.state.phase !== 'rally') return;
    const input = this.inputs[this.state.selected[0]], guide = this.getAttackGuides()[0];
    const player = this.physics.players[this.state.selected[0]];
    if (input.jumpPressed && training.jumpAt === null) {
      // Remember the displayed low/high preparation for this jump. The ball's
      // prediction can change later, but an airborne player cannot redo it.
      training.jumpTiming = guide ? { attempt: training.attempt,
        shortJump: guide.shortJump, contactLead: guide.contactLead,
        jumpHold: guide.jumpHold, kickDelay: guide.kickDelay } : null;
      training.jumpAt = this.state.time;
      training.jumpOffset = this.timingJudge.jumpError(guide);
    }
    if ((input.kickPressed || input.kick) && training.kickAt === null) {
      training.kickAt = this.state.time;
      training.kickOffset = this.kickTimingError(player, guide, training.lesson);
    }
  }

  /** 발차기 입력 시점의 타이밍 오차. 연습 기록과 접촉 판정이 같은 식을 쓴다. */
  kickTimingError(player, guide, lesson) {
    return this.timingJudge.kickError({
      lesson, guide, jumpActive: player.jump.active, jumpTime: player.jump.time,
      kickDelay: () => this.getAttackKickDelay(guide || this.predictAerial(player)),
      preholdLead: this.config.training.guide.preholdLead,
    });
  }

  /** 사람이 조작하는 선수의 점프·발차기 입력 순간을 기록한다. 안내는 입력이 있을 때만 계산한다. */
  observeTiming(humans) {
    if (this.state.phase !== 'rally') return;
    const lesson = this.state.training?.lesson ?? 'auto';
    let guides = null;
    for (const team of [0, 1]) {
      if (!humans[team]) continue;
      const player = this.physics.players[this.state.selected[team]], input = this.inputs[player.id];
      if (!input.jumpPressed && !input.kickPressed) continue;
      guides ??= this.getAttackGuides();
      const guide = guides[team];
      if (input.jumpPressed) this.timingJudge.record(this.state.timing, team, 'jump', this.timingJudge.jumpError(guide), this.state.time);
      if (input.kickPressed) this.timingJudge.record(this.state.timing, team, 'kick', this.kickTimingError(player, guide, lesson), this.state.time);
    }
  }

  /** 사람 선수의 공중 발 접촉만 등급을 받는다. 어떤 접촉이든 해당 선수의 기록은 소비된다. */
  judgeTiming(event, humans) {
    const team = event.team;
    if (!humans[team] || event.playerId !== this.state.selected[team]) return null;
    const record = this.state.timing[team];
    this.state.timing[team] = this.timingJudge.emptyRecord();
    if (this.physics.players[event.playerId].grounded || !/^foot/.test(event.part || '')) return null;
    return this.timingJudge.evaluate(record, this.state.time);
  }

  observeTraining() {
    const training = this.state.training;
    if (!training) return;
    if (training.setAt !== null && !training.contact) training.setApex = Math.max(training.setApex, this.physics.ball.translation().y);
    const player = this.physics.players[this.state.selected[0]];
    if (player.kick.mode === 'air' && player.kick.airPlan) {
      training.entry = player.kick.airPlan.entry;
      training.motionId = player.kick.airPlan.motion?.id || null;
    }
    if (training.contact && !training.contact.outgoing) {
      const v = this.physics.ball.linvel();
      training.contact.outgoing = { x: v.x, y: v.y, z: v.z };
    }
  }

  finishTraining(reason) {
    const t = this.state.training, hit = t.contact;
    const matches = !!hit?.motionId && (t.lesson === 'auto' || hit.motionId === t.lesson);
    const downward = hit?.foot && hit.downward && hit.outgoing?.y < -0.2 && hit.outgoing.x > 0.5;
    let result;
    if (downward && matches && hit.crossed && this.state.pointWinner === 0) {
      const name = TAKRAW_TRAINING_LESSONS.find(lesson => lesson.id === hit.motionId)?.title || '스파이크';
      result = { code: 'success', title: `${t.tempo === 'quick' ? '속공 · ' : ''}${name} 성공!`, detail: '발로 내려찍어 네트 위로 보냈어요. 같은 타이밍을 한 번 더 기억하세요.', tone: 'success' };
      if (!hit.counted) { t.successes++; hit.counted = true; }
    } else if (t.setAt === null) {
      result = { code: 'set', title: '세터가 다시 올릴게요', detail: '이번 공은 연습할 높이로 연결되지 않았어요. 새 토스에서 다시 준비하세요.', tone: 'neutral' };
    } else if (hit?.foot && !matches) {
      result = { code: 'motion', title: hit.motionId ? '다른 발차기로 맞았어요' : '공중 발차기를 이어 보세요',
        detail: t.lesson === 'downward' ? '점프 전에 좌클을 유지해 발을 올리고, 누른 채 점프하세요.' :
          '발자국에서 점프한 뒤 좌클을 유지하세요. 공중의 실제 발 타격으로 연습 결과를 확인해요.', tone: 'retry' };
    } else if (downward && hit.crossed) {
      result = { code: 'out', title: reason === '아웃' ? '내려찍었지만 코트를 벗어났어요' : '내려찍기 동작까지 성공', detail: `${reason} · 다음 공은 타점과 발차기 유지 시간을 조금 조절해 보세요.`, tone: 'retry' };
    } else if (downward) {
      result = { code: 'net', title: '내려찍기까지 성공', detail: '발로 내려찍었지만 네트 위로 통과하지 못했어요. 실제 타격 높이와 공이 나간 각도를 확인하세요.', tone: 'retry' };
    } else if (hit?.foot) {
      result = { code: 'angle', title: '발에 맞았어요', detail: '발 접촉이 내려가는 공격으로 이어지지 않았어요. 다음 토스에서 몸의 이동을 줄이고 공 옆에 발을 돌릴 공간을 준비하세요.', tone: 'retry' };
    } else if (hit) {
      result = { code: 'body', title: /^lowerLeg/.test(hit.part) ? '정강이에 맞았어요' : '몸에 먼저 닿았어요', detail: '공 바로 아래보다 바닥 발자국에서 준비하세요. 공과 몸 사이에 발을 돌릴 공간이 필요해요.', tone: 'retry' };
    } else if (t.jumpAt === null) {
      result = { code: 'jump', title: '이번 공에서는 점프하지 않았어요', detail: '발자국으로 이동한 뒤 속도를 줄여 보세요. 점프 안내가 열리면 표시된 높이에 맞춰 짧게 누르거나 유지하세요.', tone: 'retry' };
    } else if (t.kickAt === null) {
      result = { code: 'kick', title: '발차기도 함께 해 보세요', detail: t.lesson === 'downward' ?
        '좌클을 먼저 누른 채 점프해야 올려 둔 발로 내려찍을 수 있어요.' : '점프 후 “지금 발차기” 안내에 좌클을 눌러 유지하세요.', tone: 'retry' };
    } else {
      const missedPrehold = t.lesson === 'downward' && t.kickAt >= t.jumpAt;
      result = { code: 'miss', title: missedPrehold ? '점프 전에 발을 먼저 올려 보세요' : '공과 발이 만나지 않았어요',
        detail: missedPrehold ? '이번에는 점프와 같거나 뒤에 좌클을 눌렀어요. 다음 공은 이동 중 선행 좌클 안내부터 따라 보세요.' :
          '타점 표시는 준비를 돕는 예측이에요. 다음 토스에서 이동 속도를 줄이고 공 옆의 준비 위치를 맞춰 보세요.', tone: 'retry' };
    }
    t.result = { ...result, reason, entry: hit?.entry || t.entry, motionId: hit?.motionId || t.motionId, contact: hit?.part || null,
      jumpOffset: t.jumpOffset, kickOffset: t.kickOffset };
  }

  getAttackKickDelay(aerial = this.predictAerial()) {
    const training = this.state.training;
    if (training && training.jumpAt !== null && training.jumpTiming?.attempt === training.attempt)
      return training.jumpTiming.kickDelay;
    const lesson = training && TAKRAW_TRAINING_LESSONS.find(item => item.id === training.lesson);
    const attack = aerial.shortJump ? this.config.ai.toss.lowAttack : this.config.ai.toss.attack;
    return attack.kickDelay * (lesson?.kickDelayScale ?? 1);
  }

  getTraining(guide = this.getAttackGuides()[0]) {
    const t = this.state.training;
    if (!t) return null;
    const player = this.physics.players[this.state.selected[0]], input = this.inputs[player.id];
    const settings = this.config.training.guide, aerial = this.predictAerial(player);
    const recorded = t.jumpAt !== null && t.jumpTiming?.attempt === t.attempt ? t.jumpTiming : null;
    const shortJump = recorded?.shortJump ?? guide?.shortJump ?? aerial.shortJump;
    const contactLead = recorded?.contactLead ?? guide?.contactLead ?? aerial.contactLead;
    const jumpHold = recorded?.jumpHold ?? guide?.jumpHold ?? (shortJump ? 1 / this.config.simulation.tickRate : this.config.ai.jumpHold);
    const kickDelay = recorded?.kickDelay ?? guide?.kickDelay ?? this.getAttackKickDelay(aerial);
    const lesson = TAKRAW_TRAINING_LESSONS.find(item => item.id === t.lesson) || TAKRAW_TRAINING_LESSONS[0];
    const plan = player.kick.airPlan, motion = plan?.motion;
    const motionId = t.contact?.motionId || motion?.id || t.motionId;
    const motionName = TAKRAW_TRAINING_LESSONS.find(item => item.id === motionId)?.title;
    const adjustment = motion?.reachError > 0.08 ? ' · 높이·거리를 맞춰 보세요' :
      motion?.adaptation > 0.025 ? ' · 다리 조절 중' : '';
    const jumpIn = guide && player.grounded ? guide.time - contactLead : null;
    const kickIn = t.lesson === 'downward' ? (jumpIn === null ? null : jumpIn - settings.preholdLead) :
      (player.jump.active ? input.kick && plan ? null : kickDelay - player.jump.time : jumpIn === null ? null : jumpIn + kickDelay);
    const contactIn = Number.isFinite(plan?.remaining) ? Math.max(0, plan.remaining) : null;
    const base = { lesson: t.lesson, tempo: t.tempo, attempt: t.attempt, successes: t.successes, title: lesson.title,
      sequence: lesson.sequence, motionId: motionId || null,
      motionStatus: motionName ? `${motionName}${t.contact?.foot && t.contact.motionId ? ' · 타격 확인' : adjustment}` :
        t.lesson === 'auto' ? '공과 몸의 위치에 맞춰 동작을 골라요' : `${lesson.title} 동작을 연습해요`,
      jumpIn, kickIn, shortJump, contactLead, jumpHold, kickDelay, contactIn, phase: plan?.phase || null,
      estimated: !plan, result: t.result || t.previousResult, stage: 'set', cue: '세터의 토스를 기다리세요',
      detail: '바닥 발자국과 타점은 예상 위치예요. 공이 올라오면 이동해 준비하세요.', tone: 'neutral', progress: 0 };
    if (this.state.phase === 'point') return { ...base, stage: 'result', cue: t.result?.title || '다시 도전해 보세요', detail: t.result?.detail || '', tone: t.result?.tone || 'neutral', progress: 1 };
    if (this.state.phase === 'ready') return { ...base, stage: 'ready', cue: '다음 토스를 준비합니다', detail: lesson.sequence };
    if (t.contact && (!player.jump.active || !plan || plan.phase === 'follow' || !input.kick)) {
      const down = t.contact.foot && t.contact.downward && t.contact.outgoing?.y < -0.2;
      return { ...base, stage: 'contact', cue: down ? '내려찍었어요!' : t.contact.foot ? '발에 닿았어요' : /^lowerLeg/.test(t.contact.part) ? '정강이에 맞았어요' : '몸에 먼저 닿았어요',
        detail: down ? '공이 네트를 넘는지 확인하세요.' : '다음 토스에서 위치와 타이밍을 다시 맞춰 보세요.', tone: down ? 'success' : 'retry', progress: 1 };
    }
    if (t.setAt === null) return base;
    if (player.jump.active) {
      const jumpDetail = shortJump ? '점프 버튼은 짧게 누르고 떼세요.' :
        player.jump.time < jumpHold ? '점프 버튼도 잠깐 유지하세요.' : '점프 버튼은 놓아도 돼요.';
      if (plan && input.kick) {
        const follow = plan.phase === 'follow', striking = plan.phase === 'strike';
        const horizon = this.physics.settings.airKick.contact?.horizon || contactLead;
        return { ...base, stage: follow ? 'contact' : 'kick',
          cue: follow ? '발차기 뒤 착지를 준비하세요' : striking ? '좌클 유지 · 공을 향해 차고 있어요' : '좌클 유지 · 발을 올리고 있어요',
          detail: follow ? '공의 진행과 착지를 확인하세요.' : `${jumpDetail} 좌클을 유지해 발차기를 이어가세요.`,
          tone: follow ? 'neutral' : 'ready', progress: follow ? 1 : Math.max(0, Math.min(1, 1 - (contactIn ?? horizon) / Math.max(horizon, 0.01))) };
      }
      const wait = t.lesson !== 'downward' && kickIn > 0;
      return { ...base, stage: 'kick', cue: wait ? '조금 더 떠오르세요' : input.kick ? '좌클을 유지하세요' : '지금 발차기!',
        detail: wait ? `${jumpDetail} 발차기 안내를 기다리세요.` : `${jumpDetail} 좌클을 눌러 유지하면 실제 발이 공을 향해 움직여요.`,
        tone: wait ? 'neutral' : 'ready', progress: Math.max(0, Math.min(1, player.jump.time / Math.max(kickDelay, 0.01))) };
    }
    if (!guide) return { ...base, stage: 'position', cue: '공의 옆에서 준비하세요', detail: '공이 올라오면 바닥 발자국과 점프 안내가 나타납니다.' };
    const progress = jumpIn === null ? 0 : Math.max(0, Math.min(1, 1 - jumpIn / this.config.visual.attackGuide.maxLead));
    // The ground hold starts while approaching; waiting until the position
    // circle is reached can consume the whole preparation interval.
    if (guide.preholdWindow && !guide.preheld) return { ...base, stage: 'kick', cue: input.kick ? '좌클 유지 · 발을 올려 두세요' : '좌클을 먼저 누르세요',
      detail: '발자국으로 이동하는 동안 먼저 좌클을 누르세요. 발을 올린 채 속도를 줄이고 점프를 준비해요.', tone: 'ready', progress };
    if (!guide.inPosition || (!guide.settled && !guide.braking)) return { ...base, stage: 'position', cue: t.lesson === 'downward' && input.kick ? '좌클 유지 · 발자국으로 이동하세요' : '발자국으로 이동하세요',
      detail: '표시는 공이 올 위치의 예측이에요. 공 옆에서 발을 돌릴 공간을 준비하세요.', progress };
    if (guide.braking) return { ...base, stage: 'brake', cue: t.lesson === 'downward' && input.kick ? '좌클 유지 · 이동 속도를 줄이세요' : '이동키를 놓고 속도를 줄이세요',
      detail: '몸이 아직 타점을 지나갈 속도로 움직이고 있어요. 발자국 안에서 이동을 멈춘 뒤 점프 안내를 확인하세요.', tone: 'neutral', progress };
    if (guide.jumpWindow) return { ...base, stage: 'jump', cue: '지금 점프!', detail: t.lesson === 'downward' ?
      (shortJump ? '좌클을 유지한 채 점프 버튼을 짧게 누르고 떼세요.' : '좌클을 유지한 채 점프 버튼도 잠깐 유지하세요.') :
      (shortJump ? '낮은 공이에요. 점프 버튼을 짧게 누르고 뗀 뒤 발차기 안내를 보세요.' : '점프 버튼을 잠깐 유지한 뒤 발차기 안내를 보세요.'), tone: 'ready', progress: 1 };
    if (guide.preholdWindow && input.kick) return { ...base, stage: 'kick', cue: '좌클 유지 · 점프를 기다리세요', detail: '올려 둔 발을 유지하며 점프 안내를 확인하세요.', tone: 'ready', progress };
    return { ...base, stage: 'position', cue: '점프 타이밍을 기다리세요', detail: t.lesson === 'downward' ? '좌클 준비 → 점프 순서입니다.' : '점프 → 공중에서 좌클 순서입니다.', progress };
  }

  getAttackGuides() {
    if (this.state.phase !== 'rally') return [null, null];
    if (this.state.training && this.state.training.setAt === null) return [null, null];
    const { attack } = this.config.ai.toss;
    const { court } = this.config;
    const lesson = this.state.training && TAKRAW_TRAINING_LESSONS.find(item => item.id === this.state.training.lesson);
    const approachOffset = attack.offset * (lesson?.approachScale ?? 1);
    const training = this.state.training;
    const recorded = training && training.jumpAt !== null && training.jumpTiming?.attempt === training.attempt ? training.jumpTiming : null;
    return [0, 1].map(team => {
      const n = team === 0 ? 1 : -1, player = this.physics.players[this.state.selected[team]];
      if (!player || /fall|recover|down/i.test(player.state)) return null;
      const aerial = this.predictAerial(player);
      const predicted = aerial.reachable && aerial.time > attack.minLead && aerial.time <= this.config.visual.attackGuide.maxLead;
      const shortJump = recorded?.shortJump ?? aerial.shortJump;
      const contactLead = recorded?.contactLead ?? aerial.contactLead;
      const jumpHold = recorded?.jumpHold ?? (shortJump ? 1 / this.config.simulation.tickRate : this.config.ai.jumpHold);
      const kickDelay = this.getAttackKickDelay(aerial);
      if (this.mode !== 'training' && !this.humanServes(team) && (this.state.possession !== team || this.state.touches < 1 ||
          (this.state.toss?.team === team && this.state.toss.to !== player.id))) return null;
      const plan = player.jump.active ? player.kick.airPlan : null;
      const tracking = plan?.contact?.impact && plan.phase !== 'follow' && Number.isFinite(plan.remaining);
      if (!tracking && !predicted) return null;
      const point = tracking ? plan.contact.impact : { x: aerial.x, y: aerial.y, z: aerial.z };
      const time = tracking ? Math.max(0, plan.remaining) : aerial.time;
      if (point.x * n >= -0.15 || Math.abs(point.x) > court.halfLength || Math.abs(point.z) > court.halfWidth) return null;
      const stance = this.approachPosition(team, point, approachOffset), pos = player.root.translation();
      const dx = stance.x - pos.x, dz = stance.z - pos.z;
      const velocity = this.attackVelocity(player), prepare = attack.preparation;
      const distance = Math.hypot(dx, dz), inPosition = distance <= attack.positionRadius;
      const drift = Math.hypot(dx - velocity.x * time, dz - velocity.z * time);
      const brakeTravel = Math.hypot(velocity.x, velocity.z) * prepare.brakeLead;
      const settled = drift < prepare.driftRadius;
      // A stationary player near the edge still needs to approach. Ask for
      // braking only when momentum carries them away from the contact stance.
      const braking = inPosition && ((!settled && drift > distance) || brakeTravel > attack.positionRadius);
      const needsPrehold = lesson?.id === 'downward';
      const preheld = !!this.inputs[player.id]?.kick && player.kick.held && player.kick.mode === 'ground';
      const preholdWindow = needsPrehold && !player.jump.active && aerial.time - contactLead <= this.config.training.guide.preholdLead;
      const timeWindow = predicted && aerial.jumpWindow && aerial.time < aerial.maxLead && player.grounded;
      const jumpWindow = timeWindow && inPosition && settled && !braking && (!needsPrehold || preheld);
      const stage = player.jump.active ? 'kick' : preholdWindow && !preheld ? 'kick' :
        !inPosition || (!settled && !braking) ? 'position' : braking ? 'brake' : jumpWindow ? 'jump' : preholdWindow ? 'kick' : 'position';
      return { playerId: player.id, contact: { x: point.x, y: point.y, z: point.z },
        stance, time, inPosition, settled, drift, braking, brakeTravel,
        shortJump, contactLead, jumpHold, kickDelay, preholdWindow, preheld, timeWindow,
        estimated: !tracking, phase: plan?.phase || null, remaining: tracking ? time : null,
        jumpWindow,
        kickWindow: player.jump.active && (plan ? plan.phase === 'strike' : player.jump.time >= kickDelay),
        stage,
      };
    });
  }

  attackVelocity(player) {
    const velocity = { x: 0, z: 0 };
    for (const part of player.parts) {
      const v = part.body.linvel(), weight = part.mass / player.mass;
      velocity.x += v.x * weight; velocity.z += v.z * weight;
    }
    return velocity;
  }

  /** 팀별 성향 데이터만 받는다. 학교·유니폼·도장깨기 진행은 시뮬레이션이 알지 않는다. */
  setTemperaments(profiles = [null, null]) {
    if (!Array.isArray(profiles) || profiles.length !== 2 ||
        !Array.from(profiles).every(value => value === null || Temperament.validConfig(value))) throw new TypeError('팀별 AI 성향을 확인해 주세요.');
    this.temperamentProfiles = structuredClone(profiles);
    this.temperaments = { key: '', list: [] };
  }

  /** 시드·선수·랠리 번호와 프로필이 같으면 롤백·재실행에서도 같은 성향을 만든다. */
  temperamentOf(playerId) {
    const key = `${this.state.seed}:${this.state.rally}`;
    if (this.temperaments.key !== key) this.temperaments = { key, list: [] };
    return this.temperaments.list[playerId] ??= new Temperament(this.temperamentProfiles[Math.floor(playerId / 3)] || this.config.ai.temperament,
      this.state.seed, playerId, this.state.rally);
  }

  decideAI(humans) {
    this.metrics.aiSteps++;
    if (this.state.phase !== 'rally') return;
    const p = this.physics.ball.translation();
    const v = this.physics.ball.linvel();
    const intercept = this.predictAtHeight(this.config.ai.receiveHeight);
    const { lowAttack, attack } = this.config.ai.toss;
    for (let team = 0; team < 2; team++) {
      if (this.mode === 'training' && team === 1) {
        for (let i = 3; i < 6; i++) Object.assign(this.ai[i], { x: 0, z: 0, active: false, kickFrom: 0, kickUntil: 0, jumpUntil: 0 });
        continue;
      }
      const human = humans[team];
      this.fillStance[team] = this.mode === 'training' ? null : this.fillTargets(team, human);
      const available = this.physics.players.filter(player => player.team === team && (!human || this.state.selected[team] !== player.id) && (this.mode !== 'training' || player.id === 1) && !this.humanServes(team));
      for (let id = team * 3; id < team * 3 + 3; id++) this.ai[id].active = false;
      const pass = this.state.toss?.team === team ? this.state.toss : null;
      const recipient = pass ? this.physics.players[pass.to] : null;
      const aerialPass = recipient?.role === 'attacker' ? this.predictAerial(recipient) : null;
      const useAerial = aerialPass?.reachable && aerialPass.time > 0 && aerialPass.x * recipient.toward < -0.15;
      const receivingPoint = useAerial ? aerialPass : intercept;
      const receivingStance = this.approachPosition(team, receivingPoint,
        useAerial ? attack.offset : this.config.ai.toss.receiveOffset);
      const recipientDistance = recipient ? Math.hypot(recipient.root.translation().x - receivingStance.x,
        recipient.root.translation().z - receivingStance.z) : Infinity;
      const reachableDistance = (recipient?.settings.movementSpeed || this.physics.settings.movementSpeed) *
        Math.max(0, receivingPoint.time - 0.1) + attack.positionRadius;
      const recipientReady = recipient && !/fall|recover|down/i.test(recipient.state) && recipientDistance < reachableDistance;
      const ownSide = team === 0 ? receivingPoint.x < -0.15 : receivingPoint.x > 0.15;
      let active = null, best = Infinity;
      if (ownSide) {
        // An ally pass belongs to its recipient. Other AI only step in when a
        // low, missed set is beyond that player's reach or they have fallen.
        if (recipientReady) active = available.includes(recipient) ? recipient : null;
        else for (const player of available) {
          const score = this.receptionDistance(player, intercept);
          if (score < best) { best = score; active = player; }
        }
      }
      if (this.state.training) active = this.state.training.setAt === null && !this.state.training.contact ? this.physics.players[1] : null;
      const groundBase = this.config.ai.toss.ground;
      const groundTuned = this.tuning[team] ? { ...groundBase, lead: this.tuned(team, 'lead', groundBase.lead),
        followThrough: this.tuned(team, 'followThrough', groundBase.followThrough) } : groundBase;
      const braking = this.tuned(team, 'braking', this.config.ai.receive.braking);
      const defense = this.decideReceive(team, human, available, intercept, active);
      if (defense) active = this.physics.players[defense.playerId];
      for (const player of available) {
        const a = this.ai[player.id];
        a.active = player === active;
        const aerial = player === recipient && aerialPass ? aerialPass : this.predictAerial(player), { shortJump } = aerial;
        const q = player.root.translation();
        const setTarget = this.tossTarget(player);
        const ground = groundTuned;
        const kickLead = setTarget ? ground.lead : 0.20;
        const kickWindow = setTarget ? ground.window : 0.36;
        const attacking = this.state.possession === team && (this.state.touches >= 2 || (player.role === 'attacker' && this.state.touches >= 1));
        const highContact = !defense && attacking && aerial.reachable && aerial.time > attack.minLead;
        const aim = highContact ? aerial : intercept;
        // 목표 자리와 현재 상태(대기·보조·받기·공격·세트·추격)는 상태머신이 정한다.
        const { mode, target } = this.aiBrain.update({
          game: this, player, team, ball: p, aim, defense, active, highContact, setTarget,
          record: a.brain, temperament: this.temperamentOf(player.id), now: this.state.time });
        if (defense) {
          if (player !== active) {
            // Never leave a previous chaser kicking after another teammate takes over.
            a.kickFrom = a.kickUntil = a.jumpUntil = 0;
            a.attack = null;
          }
          if (player === active && a.attack) {
            // A late incoming save takes priority over an obsolete aerial attack.
            a.attack = null; a.jumpUntil = 0; a.kickFrom = a.kickUntil = 0; a.cooldown = 0;
          }
        }
        const dx = target.x - q.x, dz = target.z - q.z;
        const dist = Math.hypot(dx, dz);
        const velocity = this.attackVelocity(player), prepare = attack.preparation;
        const anticipating = mode === 'attack';
        const receiving = mode === 'receive' || (mode === 'set' && !player.jump.active);
        const brakeLead = anticipating ? prepare.brakeLead : receiving ? braking : 0;
        const moveX = dx - velocity.x * brakeLead;
        const moveZ = dz - velocity.z * brakeLead;
        const approachScale = player.settings.movementSpeed / this.physics.settings.movementSpeed;
        const approachRadius = (anticipating ? 0.5 : 0.7) * approachScale;
        a.x = dist > (anticipating ? 0.08 : 0.12) ? moveX / Math.max(Math.hypot(moveX, moveZ), approachRadius) : 0;
        a.z = dist > (anticipating ? 0.08 : 0.12) ? moveZ / Math.max(Math.hypot(moveX, moveZ), approachRadius) : 0;
        const drift = Math.hypot(dx - velocity.x * aerial.time, dz - velocity.z * aerial.time);
        const settled = drift < prepare.driftRadius;
        if (player === active) {
          const saving = !!defense && defense.plan.reachable && defense.plan.time <= ground.window &&
            p.y > this.physics.settings.ballRadius && v.y < 1.5 && !player.jump.active;
          if (saving) {
            // Re-time BEFORE contact as the ball trajectory changes. The old
            // cooldown was set at reservation time, so it could prevent a save
            // even when the foot never made contact. No ball impulse is added.
            const arrivalAt = this.state.time + defense.plan.time;
            const from = Math.max(this.state.time, arrivalAt - ground.lead);
            const until = arrivalAt + ground.followThrough;
            const strokeHeld = a.kickFrom <= this.state.time && a.kickUntil > this.state.time;
            if (!strokeHeld) a.kickFrom = from;
            a.kickUntil = strokeHeld ? Math.max(a.kickUntil, until) : until;
            a.cooldown = a.kickUntil + 0.16;
          } else if (this.state.time >= a.cooldown) {
            if (highContact && settled && aerial.time < aerial.maxLead && aerial.jumpWindow && (player.grounded || (player.supportAge < 0.065 && !player.jump.active))) {
              a.attack = { until: this.state.time + aerial.time };
              a.jumpUntil = this.state.time + (shortJump ? 1 / this.config.simulation.tickRate : this.config.ai.jumpHold);
              a.kickFrom = this.state.time + (shortJump ? lowAttack.kickDelay : attack.kickDelay);
              a.kickUntil = a.kickFrom + 0.65;
              a.cooldown = a.kickFrom + 0.9;
              a.x = 0; a.z = 0;
            } else if (!defense && !highContact && dist < 0.40 && intercept.time < kickWindow && p.y > 0.28 && v.y < 1.5) {
              a.kickFrom = this.state.time + Math.max(0, intercept.time - kickLead);
              a.kickUntil = a.kickFrom + (setTarget ? kickLead + ground.followThrough : this.config.ai.kickHold);
              a.cooldown = a.kickUntil + 0.25;
            }
          }
        }
        // A receiver must finish approaching while its real foot swings.
        // Stopping on kickFrom strands the player outside the kick workspace.
        const reaching = receiving;
        if (a.jumpUntil > this.state.time || (player.jump.active && this.state.time < a.kickUntil) ||
            (!reaching && this.state.time >= a.kickFrom - 0.06 && this.state.time < a.kickUntil)) { a.x = 0; a.z = 0; }
        if (player.jump.active && a.attack && this.state.time < a.kickUntil && player.kick.airPlan?.phase !== 'follow') {
          const remaining = Math.max(0.08, a.attack.until - this.state.time);
          const point = { x: p.x + v.x * remaining, z: p.z + v.z * remaining };
          const stance = this.approachPosition(team, point, attack.offset);
          const gain = 2 / (remaining * remaining * player.settings.airControl);
          const steerX = (stance.x - q.x - velocity.x * remaining) * gain;
          const steerZ = (stance.z - q.z - velocity.z * remaining) * gain;
          const length = Math.max(1, Math.hypot(steerX, steerZ));
          a.x = steerX / length; a.z = steerZ / length;
        }
      }
    }
  }

  getView() {
    const attackGuides = this.getAttackGuides();
    return {
      entities: this.physics.getEntities(), state: this.state, events: this.events, revision: this.revision,
      attackGuides, receiveGuides: this.getReceiveGuides(), training: this.getTraining(attackGuides[0]), teamNames: [...this.teamNames],
      teamPlay: [this.getTeamPlay(0), this.getTeamPlay(1)],
      players: this.physics.players.map(player => ({
        id: player.id, team: player.team, role: player.role, name: player.athlete.name, profile: structuredClone(player.athlete),
        state: player.state, grounded: player.grounded, position: { ...player.root.translation() },
        receive: player.receive ? { mode: player.receive.mode, phase: player.receive.phase } : null,
        motionId: player.kick.airPlan?.motion?.id || null,
        kickHeld: !!this.inputs[player.id]?.kick, jumpHeld: !!this.inputs[player.id]?.jump,
        tossReady: this.state.serveToss?.stage === 'hold' && player.id === this.state.selected[this.state.serving], tossCharge: player.id === this.state.selected[this.state.serving] && this.state.serveToss?.stage === 'hold' ? Math.min(1, this.state.serveToss.charge / this.config.ai.serve.toss.fullCharge) : 0,
      })),
    };
  }

  save() {
    return { version: this.config.version, mode: this.mode, state: structuredClone(this.state), teamNames: [...this.teamNames], teamById: { ...this.teamById }, ai: structuredClone(this.ai), aiDirty: this.aiDirty, inputs: structuredClone(this.inputs), rallyStart: this.rallyStart || 0, metrics: { ...this.metrics }, physics: this.physics.save(), tuning: structuredClone(this.tuning), temperamentProfiles: structuredClone(this.temperamentProfiles) };
  }
  validate(data) {
    const vector = (value, axes) => value && axes.every(axis => Number.isFinite(value[axis]));
    const receivePlan = plan => plan && ['cushion', 'lunge', 'slide'].includes(plan.mode) &&
      typeof plan.reachable === 'boolean' && typeof plan.moving === 'boolean' &&
      vector(plan.point, ['x', 'y', 'z']) && vector(plan.stance, ['x', 'z']) &&
      Number.isFinite(plan.time) && plan.time >= 0 && Number.isFinite(plan.at) && plan.at >= 0 &&
      Number.isFinite(plan.distance) && plan.distance >= 0;
    const defense = (assignment, team) => assignment === null || (assignment &&
      Number.isInteger(assignment.playerId) && assignment.playerId >= team * 3 && assignment.playerId < team * 3 + 3 &&
      assignment.team === team && typeof assignment.human === 'boolean' &&
      (!assignment.human || assignment.playerId === team * 3 + 2) && receivePlan(assignment.plan) &&
      (assignment.humanPlan === null || receivePlan(assignment.humanPlan)));
    const tuning = value => value === null || (value && typeof value === 'object' && Object.values(value).every(Number.isFinite));
    return data && data.version === this.config.version && data.physics && data.state &&
      Array.isArray(data.temperamentProfiles) && data.temperamentProfiles.length === 2 &&
      Array.from(data.temperamentProfiles).every(value => value === null || Temperament.validConfig(value)) &&
      Array.isArray(data.tuning) && data.tuning.length === 2 && data.tuning.every(tuning) &&
      Array.isArray(data.teamNames) && data.teamNames.length === 2 && data.teamNames.every(name => typeof name === 'string' && name.trim()) &&
      Array.isArray(data.state.defense) && data.state.defense.length === 2 && Array.from(data.state.defense).every(defense) &&
      Array.isArray(data.state.score) && data.state.score.length === 2 && data.state.score.every(Number.isFinite) &&
      Array.isArray(data.ai) && data.ai.length === 6 && Array.from(data.ai).every(ai => ai && (ai.receive === null || receivePlan(ai.receive)) && AiBrain.validRecord(ai.brain)) &&
      Number.isInteger(data.state.seed) &&
      Array.isArray(data.inputs) && data.inputs.length === 6 && Array.from(data.inputs).every(input => input &&
        (!Object.hasOwn(input, 'receive') || input.receive === null || (receivePlan(input.receive) && typeof input.receive.allowSlide === 'boolean'))) &&
      Array.isArray(data.state.selected) && data.state.selected.length === 2 && data.state.selected.every((id, team) => id === team * 3 + 2);
  }
  load(data) {
    if (!this.validate(data)) throw new Error('경기 상태 형식 또는 버전이 맞지 않습니다.');
    this.physics.load(data.physics);
    this.setTemperaments(data.temperamentProfiles);
    this.tuning = structuredClone(data.tuning);
    data.tuning.forEach((values, team) => this.physics.setTossTuning(team, values));
    this.mode = data.mode; this.state = structuredClone(data.state); this.teamById = { ...data.teamById };
    this.teamNames = [...data.teamNames];
    this.ai = structuredClone(data.ai); this.inputs = structuredClone(data.inputs);
    this.aiDirty = data.aiDirty;
    this.rallyStart = data.rallyStart; this.metrics = { ...data.metrics }; this.events = [];
    this.revision++;
  }
  dispose() { this.physics.dispose(); }
}

export { TAKRAW_TRAINING_LESSONS, TAKRAW_TRAINING_TEMPOS, TakrawGame };
