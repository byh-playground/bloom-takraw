import { AiBrain, Temperament } from './ai-brain.js';
import { AiFormation } from './ai-formation.js';
import { TakrawPhysics } from './physics.js';
import { TakrawTimingJudge } from './timing.js';
import {
    TAKRAW_TRAINING_LESSONS,
    TAKRAW_TRAINING_TEMPOS,
    TakrawTrainingDrill,
} from './training.js';
import { takrawDecodeIdentity } from './identity.js';
import { takrawModeProfile } from './modes.js';
import { takrawSeededUnit } from './random.js';
import { TAKRAW_ROLE } from '../config/game.js';
import {
    TAKRAW_ROLES,
    TAKRAW_TEAM_PLAYER_IDS,
    TAKRAW_TRAINING_SETTER_ID,
    takrawHumanPlayerId,
    takrawHumanPlayerIds,
    takrawIsAttacker,
    takrawPlayerId,
    takrawTeamOf,
} from './roster.js';

/**
 * 화면 문구의 코드와 값. 시뮬레이션은 문장을 만들지 않고, 화면(src/i18n/messages/match.js)이 id로 언어별 문장을 만든다.
 * 값에는 팀 번호(0|1)·역할 id·득점 사유 코드처럼 언어와 무관한 것만 넣는다. 결정론 상태(state.lastMessage)에도 이 값이 저장된다.
 */
const message = (id, values = {}) => ({ id, values });

/** 부호 있는 바이트(int8)의 최댓값. 이보다 큰 바이트는 음수(b - 256)다. */
const INT8_MAX = 127;

/** 경기와 판정의 유일한 소유자. 사람/AI/네트워크가 같은 물리 입력을 사용한다. */
class TakrawGame {
    /** deterministic은 gamekit `@bloom-gamekit/deterministic` 모듈이다. 리플레이 워커에는 import map이 없어 RAPIER처럼 받는다. */
    constructor({ RAPIER, config, deterministic }) {
        this.config = config;
        this.seededUnit = takrawSeededUnit(deterministic);
        this.physics = new TakrawPhysics(RAPIER, config);
        this.timingJudge = new TakrawTimingJudge(config.timing);
        this.drill = new TakrawTrainingDrill();
        this.aiBrain = new AiBrain();
        this.formation = new AiFormation(config.ai.fill, {
            speed: this.physics.settings.movementSpeed,
            court: config.court,
        });
        this.fillStance = [null, null];
        this.humanTeams = [false, false]; // 이번 틱에 사람 입력이 있는 팀(매 틱 입력에서 다시 정해져 저장하지 않는다)
        this.temperaments = { key: '', list: [] };
        this.temperamentProfiles = [null, null];
        this.revision = 0;
        this.teamById = {};
        this.setTeams();
        this.reset('match');
    }

    /** 지금 모드의 능력(simulation/modes.js). 저장되는 값은 모드 이름뿐이고 프로필은 거기서 파생한다. */
    get profile() {
        return takrawModeProfile(this.mode);
    }

    setTeams(home = null, away = null) {
        const roles = TAKRAW_ROLES;
        const definition = this.config.athletes,
            keys = Object.keys(definition.bonus);
        const teamNames = [],
            athletes = [];
        for (const [team, supplied] of [home, away].entries()) {
            if (
                supplied !== null &&
                (!supplied ||
                    typeof supplied.name !== 'string' ||
                    !supplied.name.trim() ||
                    [...supplied.name.trim()].length > 18 ||
                    !Array.isArray(supplied.players) ||
                    supplied.players.length !== roles.length)
            ) {
                throw new Error('팀 이름과 리시버·세터·공격수 편성을 확인하세요.');
            }
            // 이름을 받지 않은 팀은 null이다. 화면이 보는 사람 기준의 "우리 팀/상대 팀"으로 보여 준다.
            teamNames.push(supplied ? supplied.name.trim() : null);
            const ids = new Set();
            for (const [slot, role] of roles.entries()) {
                const matches = supplied
                    ? supplied.players.filter((player) => player?.role === role)
                    : [];
                if (supplied && matches.length !== 1)
                    throw new Error('각 역할에는 서로 다른 선수 한 명이 필요합니다.');
                // 기본 선수는 이름이 없고(null) 화면이 역할 이름으로 보여 준다.
                const player = supplied
                    ? matches[0]
                    : {
                          id: `standard-${takrawPlayerId(team, slot)}`,
                          name: null,
                          role,
                          stats: Object.fromEntries(keys.map((key) => [key, definition.base])),
                      };
                if (
                    typeof player.id !== 'string' ||
                    !player.id.trim() ||
                    ids.has(player.id) ||
                    (supplied
                        ? typeof player.name !== 'string' || !player.name.trim()
                        : player.name !== null) ||
                    !player.stats ||
                    keys.some(
                        (key) =>
                            !Number.isInteger(player.stats[key]) ||
                            player.stats[key] < definition.base,
                    )
                ) {
                    throw new Error('선수 식별자·이름·능력치를 확인하세요.');
                }
                ids.add(player.id);
                athletes.push({
                    id: player.id,
                    name: player.name?.trim() ?? null,
                    role,
                    stats: Object.fromEntries(keys.map((key) => [key, player.stats[key]])),
                });
            }
        }
        // Validate the entire lineup before changing either team. The physics
        // snapshot owns the selected profiles and derives its physical settings.
        this.physics.setAthletes(athletes);
        this.teamNames = teamNames;
        this.teamSchools = [null, null]; // 온라인에서 상대가 알려 준 학교(표시 전용). 명령으로만 채워진다.
        this.revision++;
    }

    /** seed는 경기 변주(선수 성향·서브)의 원천이다. 훈련은 같은 상황이 반복되어야 하므로 기본 시드를 쓴다. */
    reset(
        mode = this.mode,
        lesson = this.state?.training?.lesson,
        seed = this.config.simulation.fixedSeed,
        tempo = this.state?.training?.tempo,
    ) {
        const reused = Boolean(this.state);
        const profile = takrawModeProfile(mode);
        this.mode = mode;
        this.state = {
            mode,
            phase: 'ready',
            tick: 0,
            time: 0,
            seed: profile.repeatable ? this.config.simulation.fixedSeed : seed >>> 0,
            score: [0, 0],
            sets: [0, 0],
            set: 1,
            serving: 1,
            selected: takrawHumanPlayerIds(),
            touches: 0,
            possession: -1,
            lastTouch: -1,
            toss: null,
            play: null,
            defense: [null, null],
            lastMessage: message(profile.drill ? 'trainingStart' : 'firstServe'),
            pointWinner: -1,
            pointReason: '',
            matchWinner: -1,
            ballSpeed: 0,
            timer: this.config.rules.ready,
            rally: 0,
            // 팀별 최근 점프·발차기 입력 오차. 접촉 때 평가해 소비한다(스냅샷에 포함).
            timing: this.timingJudge.emptyRecords(),
            // 연습 기록(TakrawTrainingDrill이 유일한 writer). 연습이 아니면 null이다.
            training: profile.drill ? this.drill.createRecord(lesson, tempo) : null,
        };
        if (profile.drill) this.state.timer = this.config.training.ready;
        this.ai = Array.from({ length: 6 }, () => ({
            x: 0,
            z: 0,
            active: false,
            kickFrom: 0,
            kickUntil: 0,
            jumpUntil: 0,
            cooldown: 0,
            previousJump: false,
            previousKick: false,
            attack: null,
            receive: null,
            brain: AiBrain.blankRecord(),
        }));
        this.aiDirty = true;
        this.inputs = Array.from({ length: 6 }, () => this.emptyInput());
        this.events = [];
        this.metrics = {
            logicSteps: 0,
            physicsSteps: 0,
            aiSteps: 0,
            contacts: 0,
            spikes: 0,
            rallies: 0,
            maxBallSpeed: 0,
            defensiveSwitches: 0,
            defensiveTouches: 0,
        };
        // 처음 reset(생성 직후)은 월드가 이미 새것이다. 그 뒤의 reset은 월드를 새로 만들어 이전 경기의 접촉 캐시·시계가 넘어오지 않게 한다.
        if (reused) this.physics.rebuild();
        this.rallyStart = undefined;
        this.physics.resetPlayers();
        this.physics.resetBall({ x: 3.6, y: 0.2, z: 0 }, { x: 0, y: 0, z: 0 });
        // 첫 서브도 다음 서브와 같은 배치(prepareRally와 같은 placeServe)다. 사람이 아직 없어도 서버는 엔드라인 뒤에서 시작한다.
        if (profile.serve) this.placeServe();
        this.revision++;
    }

    /** 선수 한 명의 입력 기본값. 매 틱 step이 채우는 실제 입력과 같은 키를 가져 스냅샷 형식이 하나다. */
    emptyInput() {
        return {
            x: 0,
            z: 0,
            jump: false,
            kick: false,
            jumpPressed: false,
            kickPressed: false,
            aim: { x: 0, y: 0 },
            receive: null,
            intent: null,
            tossTarget: null,
            motionPreference: 'auto',
            rally: 0,
        };
    }

    setTrainingLesson(lesson) {
        if (!this.profile.drill || !TAKRAW_TRAINING_LESSONS.some((item) => item.id === lesson))
            return false;
        this.reset(this.mode, lesson);
        return true;
    }

    setTrainingTempo(tempo) {
        if (!this.profile.drill || !TAKRAW_TRAINING_TEMPOS.some((item) => item.id === tempo))
            return false;
        this.reset(this.mode, undefined, undefined, tempo);
        return true;
    }

    applyMembership(change) {
        const next = {};
        for (const id of change.players)
            if (Object.hasOwn(this.teamById, id)) next[id] = this.teamById[id];
        for (const id of change.players) {
            if (Object.hasOwn(next, id)) continue;
            const used = Object.values(next);
            const free = [0, 1].find((team) => !used.includes(team));
            if (free !== undefined) next[id] = free;
        }
        this.teamById = next;
        this.aiDirty = true;
        if (this.profile.waitsForPeers && change.players.length < 2)
            this.state.lastMessage = message('waitingOpponent');
        this.revision++;
    }

    decode(input, commands, secondary = false) {
        const layout = this.config.input,
            offset = secondary ? layout.stride : 0;
        const signed = (b) => (b > INT8_MAX ? b - 256 : b) / layout.axisScale;
        const code = secondary ? 10 : 0;
        const has = (n) => commands.some((command) => command.payload?.[0] === n + code);
        return {
            x: signed(input[offset] || 0),
            z: signed(input[offset + 1] || 0),
            jump: !!((input[offset + 2] || 0) & 1),
            kick: !!((input[offset + 2] || 0) & 2),
            // 조준도 이동 축과 같은 부호 있는 바이트다. 원 밖 값(-128)은 물리 aimedContact가 상한으로 자른다.
            aim: { x: signed(input[offset + 3] || 0), y: signed(input[offset + 4] || 0) },
            jumpPressed: has(1),
            kickPressed: has(2),
            restart: has(4),
            trainingLesson:
                TAKRAW_TRAINING_LESSONS.find((lesson) => has(lesson.command))?.id || null,
            trainingTempo: TAKRAW_TRAINING_TEMPOS.find((tempo) => has(tempo.command))?.id || null,
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
                const free = [0, 1].find((slot) => !Object.values(this.teamById).includes(slot));
                team = free === undefined ? 0 : free;
                this.teamById[entry.playerId] = team;
            }
            humans[team] = this.decode(entry.input, entry.commands || []);
            for (const command of entry.commands || []) {
                // 팀 이름·학교 알림(표시 전용): 보낸 사람의 팀 자리에만 적는다.
                const identity = takrawDecodeIdentity(command.payload);
                if (identity) {
                    this.teamNames[team] = identity.name;
                    this.teamSchools[team] = identity.schoolId;
                }
            }
            if (this.profile.secondaryInput)
                humans[1] = this.decode(entry.input, entry.commands || [], true);
        }
        if (this.profile.drill && humans[0]?.trainingLesson) {
            this.setTrainingLesson(humans[0].trainingLesson);
            this.state.tick = frame.tick + 1;
            return;
        }
        if (this.profile.drill && humans[0]?.trainingTempo) {
            this.setTrainingTempo(humans[0].trainingTempo);
            this.state.tick = frame.tick + 1;
            return;
        }
        if (humans[0]?.restart) {
            if (this.profile.drill) this.prepareRally();
            // 다시 시작은 새 변주를 쓴다. 두 피어가 같은 현재 시드·랠리 번호에서 같은 새 시드를 얻는다.
            else
                this.reset(
                    this.mode,
                    undefined,
                    Math.floor(
                        this.seededUnit(this.state.seed, this.state.rally, this.state.tick, 99) *
                            4294967296,
                    ),
                );
            this.state.tick = frame.tick + 1;
            return;
        }
        // 사람 입력을 받지 않는 팀(AI 대전·연습의 팀 1, 관전의 두 팀)은 들어온 입력을 버린다.
        for (let team = 0; team < 2; team++)
            if (!this.profile.humanInput[team]) humans[team] = null;
        const humanTeams = [!!humans[0], !!humans[1]];
        const changed =
            humanTeams[0] !== this.humanTeams[0] || humanTeams[1] !== this.humanTeams[1];
        this.humanTeams = humanTeams;
        // 사람이 처음 들어온 순간 서브 전 배치를 다시 한다(첫 서브가 사람 팀일 때 공격수를 서브 자리에 세운다).
        if (changed && this.state.phase === 'ready' && this.state.rally === 0) this.placeServe();
        for (let team = 0; team < 2; team++) humans[team] = this.assistReceive(team, humans[team]);
        // 서브 시작에는 발차기 버튼이 공 던지기다: 던질 때까지 발차기 입력은 발이 아니라 던지기 힘 모으기로만 쓴다.
        const toss = this.state.serveToss,
            server = humans[this.state.serving];
        if (
            toss &&
            toss.stage === 'hold' &&
            this.state.phase === 'rally' &&
            this.state.lastTouch < 0 &&
            server
        )
            humans[this.state.serving] = {
                ...server,
                kick: false,
                kickPressed: false,
                toss: server.kick,
                tossPressed: server.kickPressed,
            };

        // Claim/release is an input edge. Re-evaluate that change immediately,
        // while ordinary pursuit decisions remain on the configured AI clock.
        if (this.profile.defense)
            for (const [team, input] of humans.entries()) {
                if (!input) continue;
                const previous = this.inputs[this.state.selected[team]];
                if (
                    !!(input.kick || input.kickPressed) !== !!previous.kick ||
                    (previous.kick &&
                        (input.jumpPressed ||
                            Math.hypot(input.x - previous.x, input.z - previous.z) > 0.75))
                )
                    this.aiDirty = true;
            }

        const onlineWaiting = this.profile.waitsForPeers && Object.keys(this.teamById).length < 2;
        if (this.state.phase !== 'finished' && !onlineWaiting) {
            if (this.state.phase === 'ready') {
                this.state.timer -= dt;
                if (this.state.timer <= 0) this.beginRally();
            } else if (this.state.phase === 'point') {
                this.state.timer -= dt;
                if (this.state.timer <= 0) this.prepareRally();
            }
        }

        // AI 갱신 주기는 경기 안의 스텝 수 기준이다. 호스트가 넘기는 frame.tick은 세션마다 시작이 달라(게임킷 세션 0, 시뮬레이션 도구 1) 주기가 어긋나면 같은 시드가 다른 경기가 된다.
        if (
            this.aiDirty ||
            this.metrics.logicSteps %
                Math.max(1, Math.round(frame.tickRate / this.config.simulation.aiRate)) ===
                0
        ) {
            this.decideAI(humans);
            this.aiDirty = false;
        }
        const previousInputs = this.inputs.map((input) => ({
            kick: input.kick,
            intent: input.intent,
            rally: input.rally,
        }));
        for (let i = 0; i < 6; i++) {
            const a = this.ai[i];
            const kick =
                this.state.phase === 'rally' &&
                a.kickUntil > this.state.time &&
                a.kickFrom <= this.state.time;
            const jump = this.state.phase === 'rally' && a.jumpUntil > this.state.time;
            this.inputs[i] = {
                x: this.state.phase === 'rally' ? a.x : 0,
                z: this.state.phase === 'rally' ? a.z : 0,
                jump,
                kick,
                jumpPressed: jump && !a.previousJump,
                kickPressed: kick && !a.previousKick,
                // AI는 늘 가운데(발이 가던 방향 그대로 공 중심)를 찬다. 사람과 같은 aimedContact를 탄다.
                aim: { x: 0, y: 0 },
                receive:
                    this.state.phase === 'rally' && a.active && a.receive
                        ? { ...a.receive, allowSlide: true }
                        : null,
            };
            a.previousJump = jump;
            a.previousKick = kick;
        }

        for (let team = 0; team < 2; team++) {
            if (!humans[team]) continue;
            const id = this.state.selected[team];
            const h = humans[team];
            this.inputs[id] = {
                x: h.x,
                z: h.z,
                jump: h.jump || h.jumpPressed,
                kick: h.kick || h.kickPressed,
                jumpPressed: h.jumpPressed,
                kickPressed: h.kickPressed,
                aim: h.aim,
            };
        }
        // AI 서버: 공을 던질 때까지 자기 자리에 서 있고(이동·점프·발차기 없음), 지상서브는 던진 공이 올라가는 동안 차지 않는다(내려오는 공만 찬다).
        const serveToss = this.state.serveToss,
            aiServerId = this.serverId(this.state.serving);
        if (
            serveToss &&
            this.state.phase === 'rally' &&
            this.state.lastTouch < 0 &&
            !humans[this.state.serving]
        ) {
            if (serveToss.stage === 'hold') this.inputs[aiServerId] = this.emptyInput();
            else if (!this.isJumpServe(this.state.serving) && this.physics.ball.linvel().y > 0)
                Object.assign(this.inputs[aiServerId], {
                    jump: false,
                    kick: false,
                    jumpPressed: false,
                    kickPressed: false,
                });
        }
        this.updateServeToss(humans, dt);
        if (this.profile.drill) this.recordTrainingInput();
        this.observeTiming(humans);

        // The game chooses an ally; the physics controller only guides the foot.
        // Humans and AI use this same target, with no extra aiming input or ball force.
        for (const player of this.physics.players) {
            const input = this.inputs[player.id],
                previous = previousInputs[player.id];
            // Keep one held stroke's foot target through the collision response.
            // The next kick chooses the new possession/contact-count intent.
            input.intent =
                this.state.phase === 'rally' &&
                input.kick &&
                previous.kick &&
                previous.rally === this.state.rally
                    ? previous.intent
                    : this.kickIntent(player);
            input.tossTarget = input.intent?.target || null;
            input.motionPreference =
                this.state.training && player.id === this.state.selected[0]
                    ? this.state.training.lesson
                    : 'auto';
            input.rally = this.state.rally;
            if (humans[player.team] && player.id === this.state.selected[player.team]) {
                const assignment = this.state.defense[player.team];
                const plan = assignment?.humanPlan || null;
                // This guides the physical motion, never reserves the ball collider.
                // A release or jump stops new receiving actuation on this same tick.
                input.receive =
                    plan && input.kick && !input.jump && !input.jumpPressed
                        ? { ...plan, allowSlide: true }
                        : null;
            }
        }

        const count = this.config.simulation.substeps;
        for (let sub = 0; sub < count; sub++) {
            const beforeBall = this.physics.ball.translation();
            const events = this.physics.step(dt / count, this.inputs) || [];
            this.metrics.physicsSteps++;
            for (const event of events) this.handlePhysicsEvent(event, humans);
            this.confirmToss(humans);
            const afterBall = this.physics.ball.translation();
            if (this.profile.drill)
                this.drill.observeStep(this.state.training, {
                    ball: this.physics.ball,
                    player: this.physics.players[this.state.selected[0]],
                });
            if (this.state.phase === 'rally' && beforeBall.x * afterBall.x < 0) {
                const play = this.state.play,
                    leavingTeam = beforeBall.x < 0 ? 0 : 1;
                // A pass that actually crosses the net is an overpass, not a newly
                // chosen return. Keep the original intent and the observed outcome.
                if (
                    play?.kind === 'toss' &&
                    play.team === leavingTeam &&
                    play.from === this.state.lastTouch
                )
                    play.outcome = 'overpass';
                this.state.toss = null;
                const fraction = -beforeBall.x / (afterBall.x - beforeBall.x);
                const crossingHeight = beforeBall.y + (afterBall.y - beforeBall.y) * fraction;
                if (this.state.training?.contact && afterBall.x > beforeBall.x) {
                    const crossingSide = beforeBall.z + (afterBall.z - beforeBall.z) * fraction;
                    this.drill.observeCrossing(
                        this.state.training,
                        crossingHeight >=
                            this.config.court.netHeight + this.physics.settings.ballRadius - 0.02 &&
                            Math.abs(crossingSide) <= this.config.court.halfWidth,
                    );
                }
                if (
                    crossingHeight <
                    this.config.court.netHeight + this.physics.settings.ballRadius - 0.02
                ) {
                    const loser =
                        this.state.lastTouch < 0
                            ? this.state.serving
                            : takrawTeamOf(this.state.lastTouch);
                    this.awardPoint(1 - loser, 'underNet');
                }
            }
            // Edge는 논리 틱 첫 물리 substep에서만 소비한다. held는 유지한다.
            for (const input of this.inputs) {
                input.jumpPressed = false;
                input.kickPressed = false;
            }
        }
        const velocity = this.physics.ball.linvel();
        this.state.ballSpeed = Math.hypot(velocity.x, velocity.y, velocity.z);
        this.metrics.maxBallSpeed = Math.max(this.metrics.maxBallSpeed, this.state.ballSpeed);
        const ball = this.physics.ball.translation();
        if (
            this.state.phase === 'rally' &&
            (ball.y < -1 || Math.abs(ball.x) > 24 || Math.abs(ball.z) > 18)
        ) {
            this.awardPoint(
                this.state.lastTouch < 0
                    ? 1 - this.state.serving
                    : 1 - takrawTeamOf(this.state.lastTouch),
                'out',
            );
        }
        if (
            this.profile.drill &&
            this.state.phase === 'rally' &&
            this.state.time - this.rallyStart > this.config.training.timeout
        )
            this.awardPoint(1, 'nextToss');
        this.state.tick = frame.tick + 1;
    }

    emit(event) {
        this.events.push({
            tick: this.state.tick,
            sequence: this.events.length,
            playerId: -1,
            team: -1,
            speed: 0,
            position: { x: 0, y: 0, z: 0 },
            ...event,
        });
    }

    prepareRally() {
        this.state.phase = 'ready';
        this.state.timer = this.profile.drill
            ? this.config.training.ready
            : this.config.rules.ready;
        this.state.touches = 0;
        this.state.possession = -1;
        this.state.lastTouch = -1;
        this.state.toss = null;
        this.state.play = null;
        this.state.defense = [null, null];
        this.state.pointWinner = -1;
        this.state.pointReason = '';
        this.state.selected = takrawHumanPlayerIds();
        this.state.timing = this.timingJudge.emptyRecords();
        this.state.lastMessage = this.profile.drill
            ? message('nextBall')
            : message('serve', { team: this.state.serving });
        if (this.state.training) this.drill.clearAttempt(this.state.training);
        this.placeServe();
        for (const ai of this.ai)
            Object.assign(ai, {
                x: 0,
                z: 0,
                active: false,
                kickFrom: 0,
                kickUntil: 0,
                jumpUntil: 0,
                cooldown: 0,
                previousJump: false,
                previousKick: false,
                attack: null,
                receive: null,
                brain: AiBrain.blankRecord(),
            });
        this.aiDirty = true;
        this.revision++;
    }

    beginRally() {
        this.state.phase = 'rally';
        this.state.rally++;
        this.metrics.rallies++;
        this.state.touches = 0;
        this.state.possession = -1;
        this.state.lastTouch = -1;
        this.state.toss = null;
        this.state.play = null;
        this.state.defense = [null, null];
        this.rallyStart = this.state.time;
        this.state.timing = this.timingJudge.emptyRecords();
        if (this.profile.drill) {
            const setter = this.physics.players[TAKRAW_TRAINING_SETTER_ID],
                p = setter.root.translation(),
                feed = this.config.training.feed;
            this.drill.startAttempt(this.state.training);
            // A fresh drill feeds the setter. After this reset the setter's real
            // foot collision supplies the set, exactly as in a match.
            if (this.drill.tempo(this.state.training).quick) {
                this.feedQuick(p);
                this.state.lastMessage = message('quickToss');
            } else {
                this.physics.resetBall(
                    { x: p.x + feed.offset, y: feed.height, z: p.z - feed.lateral },
                    { x: 0, y: feed.rise, z: 0 },
                );
                this.state.lastMessage = message('highToss');
            }
        } else {
            // 서브는 사람·AI 모두 같은 공 던지기다: 공을 들고(hold) 힘을 모은 만큼 위로 던진다. 사람은 발차기 버튼을 누른 시간, AI는 판마다 다른 값(aimCharge, 0~fullCharge초)이 모으는 시간이다.
            const aiCharge =
                this.seededUnit(this.state.seed, this.state.rally, 5) *
                this.config.ai.serve.toss.fullCharge;
            this.state.serveToss = this.humanServes(this.state.serving)
                ? { stage: 'hold', charge: 0 }
                : { stage: 'hold', charge: 0, aimCharge: aiCharge };
            this.holdServeBall();
            this.state.lastMessage = message(
                this.humanServes(this.state.serving) ? 'serveTossHuman' : 'serveCheck',
            );
        }
        this.emit({
            type: 'serve',
            team: this.state.serving,
            position: { ...this.physics.ball.translation() },
        });
        this.revision++;
    }

    /**
     * 서브 라인 반칙(사람·AI 같은 규칙): 서버가 공을 던지기 전에 발이 엔드라인 안쪽(코트 쪽)을 밟으면 서브 팀이 실점한다.
     * 사람은 던지기 버튼을 뗄 때까지 매 틱, AI는 공을 던지는 순간(서브 시작)에 검사한다. 반칙이면 점수를 주고 true.
     */
    callServeFootFault() {
        const team = this.state.serving,
            n = team === 0 ? 1 : -1,
            server = this.physics.players[this.serverId(team)];
        if (
            !['footL', 'footR'].some(
                (name) =>
                    server.byName[name].body.translation().x * n > -this.config.court.halfLength,
            )
        )
            return false;
        this.awardPoint(1 - team, 'serveLine');
        return true;
    }

    /** 던진 공의 꼭짓점이 jumpApex 이상이면 점프서브다(사람·AI 같은 기준: 높이 올린 공은 점프해서 친다). AI만 이 기준으로 점프를 정한다. */
    isJumpServe(team) {
        const toss = this.state.serveToss;
        return (
            this.state.lastTouch < 0 &&
            this.state.serving === team &&
            toss?.stage === 'thrown' &&
            toss.apex >= this.config.ai.serve.toss.jumpApex
        );
    }

    /** 공 던지기 전: 공을 서버 앞 손 높이에 가만히 둔다(서버가 움직이면 따라간다). */
    holdServeBall() {
        const { toss } = this.config.ai.serve,
            p = this.physics.players[this.serverId(this.state.serving)].root.translation(),
            n = this.state.serving === 0 ? 1 : -1;
        const ratio = Math.min(1, (this.state.serveToss?.charge || 0) / toss.fullCharge);
        this.physics.resetBall(
            { x: p.x + n * toss.offset, y: toss.height + toss.lift * ratio, z: p.z - n * 0.1 },
            { x: 0, y: 0, z: 0 },
        );
    }

    /**
     * 서브의 공 던지기(사람·AI 같은 규칙): 모으는 동안 힘(charge)이 쌓이고, 끝나는 순간 공을 위로만 던진다. 사람은 발차기 버튼을 떼는 순간, AI는 charge가 aimCharge에 닿는 순간이다.
     * 꼭짓점은 charge 0이면 minApex, fullCharge초 이상이면 maxApex이고 그 사이는 선형이다. 앞뒤·좌우 속도는 서버가 던지는 순간 움직이던 속도 그대로라, 서 있으면 제자리에 떨어지고 달리면서 던지면 그 방향으로 날아간다. 던진 뒤 공은 일반 물리로 움직인다.
     * 상태는 state.serveToss(저장됨)에만 있어 롤백해도 같다.
     */
    updateServeToss(humans, dt) {
        const toss = this.state.serveToss;
        if (
            !toss ||
            toss.stage === 'thrown' ||
            this.state.phase !== 'rally' ||
            this.state.lastTouch >= 0
        )
            return;
        const human = humans[this.state.serving],
            cfg = this.config.ai.serve.toss;
        if (this.callServeFootFault()) return;
        const held = this.humanServes(this.state.serving)
                ? !!human?.toss
                : toss.charge < toss.aimCharge,
            pressed = !!human?.tossPressed;
        if (held || pressed) {
            toss.charging = true;
            toss.charge += dt;
        }
        const idle = this.state.time - this.rallyStart > cfg.maxHold;
        if (!(toss.charging && !held) && !idle) {
            this.holdServeBall();
            return;
        }
        const ratio = Math.min(1, toss.charge / cfg.fullCharge),
            apex = cfg.minApex + (cfg.maxApex - cfg.minApex) * ratio;
        const gravity = Math.abs(this.physics.settings.gravity),
            p = this.physics.ball.translation();
        const move = this.physics.players[this.serverId(this.state.serving)].root.linvel();
        this.physics.resetBall(p, {
            x: move.x,
            y: Math.sqrt(2 * gravity * (apex - p.y)),
            z: move.z,
        });
        toss.stage = 'thrown';
        toss.apex = apex;
        this.state.lastMessage = message('serveRising');
    }

    /**
     * 속공 토스: 세터 옆에서 낮은 포물선으로 공격수 앞 낙하 타점(낮은 공격의 접촉 높이)에 정확히 닿게 한다.
     * 높은 토스처럼 세터 발 충돌에 맡기면 세트 높이가 발 접촉에 따라 불연속으로 바뀌어 낮은 공격 구간(shortJump)에 들어오지 않는다.
     * 토스 시각을 기록(setAt)해 안내가 바로 열린다.
     */
    feedQuick(setterPosition) {
        const { quick } = this.config.training,
            { lowAttack, attack } = this.config.ai.toss,
            gravity = Math.abs(this.physics.settings.gravity);
        const hp = this.physics.players[this.state.selected[0]].root.translation();
        const start = { x: setterPosition.x + quick.offset, y: quick.height, z: setterPosition.z };
        const contact = {
            x: Math.min(hp.x + attack.offset, -0.9),
            y: (lowAttack.minHeight + lowAttack.maxHeight) / 2,
            z: hp.z - attack.lateral,
        };
        const rise = Math.sqrt(2 * gravity * (quick.apex - start.y));
        const time =
            (rise + Math.sqrt(rise * rise - 2 * gravity * (contact.y - start.y))) / gravity;
        this.physics.resetBall(start, {
            x: (contact.x - start.x) / time,
            y: rise,
            z: (contact.z - start.z) / time,
        });
        this.drill.observeSet(this.state.training, this.state.time);
    }

    handlePhysicsEvent(event, humans) {
        if (event.type === 'land') {
            this.emit(event);
            return;
        }
        if (this.state.phase !== 'rally') return;
        // 공을 던지기 전(손에 든 공)에는 몸이 부딪혀도 터치·반칙·낙하로 세지 않는다. 공은 매 틱 손 자리로 되돌려진다.
        if (this.state.serveToss?.stage === 'hold') return;
        if (event.type === 'touch') {
            if (this.state.training && event.playerId === this.state.selected[0])
                this.drill.observeContact(
                    this.state.training,
                    event,
                    this.physics.players[event.playerId],
                    { netHeight: this.config.court.netHeight, time: this.state.time },
                );
            if (/hand|forearm|upperArm/i.test(event.part || '')) {
                this.emit(event);
                this.awardPoint(1 - event.team, 'hand');
                return;
            }
            if (this.state.possession !== event.team) {
                this.state.possession = event.team;
                this.state.touches = 0;
            }
            this.state.touches++;
            this.state.lastTouch = event.playerId;
            const defendedTouch = this.state.defense[event.team]?.playerId === event.playerId;
            if (this.profile.defense) {
                const defense = this.state.defense[event.team];
                this.state.defense = [null, null];
                if (defense && (defense.human || defense.plan.mode !== 'cushion'))
                    this.aiDirty = true;
            }
            this.metrics.contacts++;
            if (defendedTouch) this.metrics.defensiveTouches++;
            // 스파이크 판정의 유일한 정의: 네트 위에서 발이 아래로 움직이며 공을 맞힘. 연출(spike 플래그)과 지표가 같은 값을 쓴다.
            const spike =
                /^foot/.test(event.part || '') &&
                !!event.footVelocity &&
                event.footVelocity.y < -1 &&
                event.position.y > this.config.court.netHeight;
            event.spike = spike;
            const timing = this.judgeTiming(event, humans);
            this.emit(timing ? { ...event, timing } : event);
            if (this.state.touches > this.config.rules.contacts) {
                this.awardPoint(1 - event.team, 'fourthTouch');
                return;
            }
            if (spike) this.metrics.spikes++;
            const target = this.inputs[event.playerId]?.tossTarget;
            const set =
                target &&
                /^(foot|lowerLeg)/.test(event.part || '') &&
                this.physics.players[event.playerId].kick.mode === 'ground' &&
                !spike;
            // 접촉 뒤 공 속도를 목표 포물선으로 덮어쓰는 보정은 AI 접촉에만 둔다. 이 틱에 사람 입력이 들어간 선수(그 팀의 조종 선수)가
            // 찬 서브·세트는 발과 공의 접촉 물리가 정한 그대로 나간다(조준 오프셋이 결과에 남는다).
            const human =
                !!humans[event.team] && event.playerId === this.state.selected[event.team];
            if (
                !human &&
                target?.playerId === -1 &&
                /^(foot|lowerLeg)/.test(event.part || '') &&
                !spike
            )
                this.physics.assistServe(
                    this.physics.players[event.playerId],
                    event.position,
                    target,
                );
            else if (!human && set && takrawIsAttacker(target.playerId))
                this.physics.assistSet(
                    this.physics.players[event.playerId],
                    event.position,
                    target,
                );
            const intent = this.inputs[event.playerId]?.intent;
            this.state.play = {
                team: event.team,
                from: event.playerId,
                to: target?.playerId ?? null,
                kind: spike ? 'attack' : intent?.kind || 'receive',
                reason: spike ? 'spike' : intent?.reason || 'contact',
                condition: intent?.condition || null,
                part: event.part,
                at: this.state.time,
                outcome: target && !spike ? (set ? 'pending' : 'mishit') : 'contact',
            };
            this.state.toss = set
                ? {
                      team: event.team,
                      from: event.playerId,
                      to: target.playerId,
                      started: this.state.time,
                      pending: true,
                  }
                : null;
            this.state.lastMessage = message(spike ? 'spike' : set ? 'setToTeammate' : 'sendOver');
        } else if (event.type === 'ground') {
            this.emit(event);
            const p = event.position;
            const inside =
                Math.abs(p.x) <= this.config.court.halfLength + 0.03 &&
                Math.abs(p.z) <= this.config.court.halfWidth + 0.03;
            const loser = inside
                ? p.x < 0
                    ? 0
                    : 1
                : this.state.lastTouch < 0
                  ? this.state.serving
                  : takrawTeamOf(this.state.lastTouch);
            this.awardPoint(1 - loser, inside ? 'grounded' : 'out');
        } else if (event.type === 'net' && event.playerId >= 0) {
            this.emit(event);
            this.awardPoint(1 - event.team, 'netTouch');
        }
    }

    confirmToss(humans) {
        const pass = this.state.toss;
        if (this.state.phase !== 'rally' || !pass?.pending) return;
        // CCD can report contact at the end of a substep, before its response is
        // solved. Reserve the receiving ally after the actual upward response.
        if (this.physics.ball.linvel().y <= 1) {
            if (this.state.time - pass.started > 0.1) {
                if (this.state.play?.from === pass.from && this.state.play.kind === 'toss')
                    this.state.play.outcome = 'mishit';
                this.state.toss = null;
            }
            return;
        }
        pass.pending = false;
        if (this.state.play?.from === pass.from && this.state.play.kind === 'toss')
            this.state.play.outcome = 'set';
        if (
            this.state.training &&
            pass.from === TAKRAW_TRAINING_SETTER_ID &&
            pass.to === this.state.selected[0]
        )
            this.drill.observeSet(this.state.training, this.state.time);
        this.aiDirty = true;
        this.state.lastMessage = message(
            takrawIsAttacker(pass.to) ? 'tossToAttacker' : 'receiveToTeammate',
        );
        for (const player of this.physics.players) {
            if (
                player.team !== pass.team ||
                player.id === pass.to ||
                player.id === pass.from ||
                player.jump.active
            )
                continue;
            if (humans[pass.team] && this.state.selected[pass.team] === player.id) continue;
            // Cancel other chasers while the passer completes its scheduled stroke.
            this.ai[player.id].kickFrom =
                this.ai[player.id].kickUntil =
                this.ai[player.id].jumpUntil =
                    0;
        }
    }

    /** reason은 득점 사유 코드다(underNet·out·nextToss·serveLine·hand·fourthTouch·grounded·netTouch). 문구는 화면이 만든다. */
    awardPoint(winner, reason) {
        if (this.state.phase !== 'rally') return;
        this.state.phase = 'point';
        this.state.toss = null;
        this.state.defense = [null, null];
        this.state.pointWinner = winner;
        this.state.pointReason = reason;
        this.state.timer = this.profile.drill
            ? this.config.training.retry
            : this.config.rules.point;
        if (this.state.training)
            this.drill.finish(this.state.training, {
                reason,
                pointWinner: this.state.pointWinner,
            });
        this.state.lastMessage = this.profile.drill
            ? message('trainingPoint', { reason })
            : message('point', { team: winner, reason });
        if (this.profile.scoring) {
            this.state.score[winner]++;
            const [a, b] = this.state.score;
            const limit =
                a >= this.config.rules.deuce && b >= this.config.rules.deuce
                    ? this.config.rules.cap
                    : this.config.rules.points;
            if (this.state.score[winner] >= limit) {
                this.state.sets[winner]++;
                if (this.state.sets[winner] >= this.config.rules.sets) {
                    this.state.phase = 'finished';
                    this.state.matchWinner = winner;
                    this.state.lastMessage = message('matchWin', { team: winner });
                } else {
                    this.state.set++;
                    this.state.score = [0, 0];
                    this.state.lastMessage = message('setWin', { team: winner });
                }
            }
            this.state.serving = 1 - this.state.serving;
        }
        this.emit({
            type: 'point',
            team: winner,
            position: { ...this.physics.ball.translation() },
            reason,
        });
    }

    /** 이번 서브를 사람이 하는가(서브 첫 타격 전). 이때 서브 공은 서버가 받아 차는 공이라 사람 발차기가 받기 동작으로 이어진다. */
    humanServes(team) {
        return (
            this.humanTeams[team] &&
            this.profile.serve &&
            this.state.serving === team &&
            this.state.lastTouch < 0
        );
    }

    /** 서브하는 선수. 사람이 있는 팀은 사람이 조작하는 공격수가 뒤에서 서브하고, 사람이 없는 팀은 첫 번째 선수가 서브한다. */
    serverId(team) {
        return this.humanTeams[team] && this.profile.serve
            ? this.state.selected[team]
            : takrawPlayerId(team, 0);
    }

    /** 서브 시작 자리: 사람이 서브하면 공격수가 자기 코트 뒤쪽 서브 자리(ai.serve.spot, 팀 방향 좌표)에서 시작한다. */
    serveStarts() {
        const team = this.state.serving,
            id = this.serverId(team);
        if (!this.profile.serve) return null;
        const player = this.physics.players[id],
            n = player.toward,
            spot = this.config.ai.serve.spot;
        // 사람 서버는 서브 자리(x, z), AI 서버는 서브 자리 x에 자기 자리 z로 선다(엔드라인 뒤). 서브 뒤 AI는 평소처럼 자기 포메이션으로 돌아간다.
        return {
            [id]: { x: spot.x * n, z: id === takrawPlayerId(team, 0) ? player.home.z : spot.z * n },
        };
    }

    /** 서브 직전 배치: 선수를 시작 자리에 세우고 공을 서버 발밑에 둔다. */
    placeServe() {
        this.physics.resetPlayers(this.serveStarts());
        const pos = this.physics.players[this.serverId(this.state.serving)].root.translation();
        this.physics.resetBall({ x: pos.x, y: 0.2, z: pos.z }, { x: 0, y: 0, z: 0 });
    }

    receptionDistance(player, intercept) {
        const p = player.root.translation();
        return (
            Math.hypot(p.x - intercept.x, p.z - intercept.z) +
            (/recover|fall|down/i.test(player.state) ? 2 : 0) +
            (this.state.lastTouch === player.id ? 1.3 : 0)
        );
    }

    isReceiveBall(team, intercept) {
        if (!this.profile.defense || this.state.phase !== 'rally') return false;
        const toward = team === 0 ? 1 : -1;
        // A ball already below the normal receiving height may still have a
        // reachable lower slide contact. The physical planner verifies that path.
        if (
            (!intercept.reachable &&
                this.physics.ball.translation().y >= this.config.ai.receiveHeight) ||
            intercept.x * toward >= -0.15
        )
            return false;
        if (this.state.lastTouch < 0) return this.state.serving !== team || this.humanServes(team);
        if (this.state.possession !== team) return true;
        if (this.state.touches >= this.config.rules.contacts) return false;
        const pass = this.state.toss?.team === team ? this.state.toss : null;
        if (!pass) return true;
        // A normal attacking set keeps its recipient and the existing jump/kick
        // meaning. Only an observed mishit or a missed reception becomes a save.
        if (pass.to === this.state.selected[team] || pass.pending) return false;
        const recipient = this.physics.players[pass.to];
        // 서브의 토스 기록은 받을 동료가 없다(to=-1, kickIntent의 서브 목표). 공이 네트를 넘지 못하고 우리 코트로 돌아오면 지킬 동료가 없으니 일반 받기다.
        if (!recipient) return true;
        const position = recipient.root.translation();
        const reach =
            recipient.settings.movementSpeed * Math.max(0, intercept.time - 0.1) +
            recipient.settings.receive.lungeReach;
        return (
            /fall|recover|down/.test(recipient.state) ||
            Math.hypot(position.x - intercept.x, position.z - intercept.z) > reach
        );
    }

    decideReceive(team, human, available, intercept, preferred) {
        const previous = this.state.defense[team];
        this.state.defense[team] = null;
        for (const id of TAKRAW_TEAM_PLAYER_IDS[team]) this.ai[id].receive = null;
        if (!this.isReceiveBall(team, intercept)) return null;
        const settings = this.config.ai.receive;
        const effort = (player, plan) => {
            const position = player.root.translation();
            return (
                Math.hypot(position.x - plan.stance.x, position.z - plan.stance.z) /
                    player.settings.movementSpeed +
                (plan.reachable ? 0 : 2) +
                (this.state.lastTouch === player.id ? 0.4 : 0)
            );
        };
        const candidates = available
            .map((player) => ({ player, plan: this.physics.planReceive(player) }))
            .filter((item) => item.plan);
        // Every player has a real physics reach estimate. A chosen but unreachable
        // "preferred" chaser must never block a teammate who can actually save it.
        const reachable = candidates
            .filter((item) => item.plan.reachable)
            .sort(
                (a, b) =>
                    effort(a.player, a.plan) - effort(b.player, b.plan) ||
                    a.player.id - b.player.id,
            );
        const preferredItem = reachable.find((item) => item.player === preferred);
        const previousItem = reachable.find((item) => item.player.id === previous?.playerId);
        const best = reachable[0];
        const sticky =
            previousItem &&
            best &&
            effort(previousItem.player, previousItem.plan) <=
                effort(best.player, best.plan) + settings.hysteresis;
        const selected = sticky
            ? previousItem
            : preferredItem &&
                best &&
                effort(preferredItem.player, preferredItem.plan) <=
                    effort(best.player, best.plan) + settings.hysteresis
              ? preferredItem
              : best ||
                candidates.sort(
                    (a, b) =>
                        effort(a.player, a.plan) - effort(b.player, b.plan) ||
                        a.player.id - b.player.id,
                )[0];
        let actor = selected?.player || null,
            plan = selected?.plan || null;
        const controlled = human ? this.physics.players[this.state.selected[team]] : null;
        const intends =
            human && (human.kick || human.kickPressed) && !human.jump && !human.jumpPressed;
        let humanPlan = intends ? this.physics.planReceive(controlled, human) : null;
        if (!humanPlan?.reachable) humanPlan = null;
        const previousActor = previous && this.physics.players[previous.playerId];
        const action = previousActor?.receive;
        const held =
            previousActor === controlled
                ? intends
                : previousActor &&
                  this.ai[previousActor.id].kickUntil > this.state.time &&
                  this.ai[previousActor.id].kickFrom <= this.state.time;
        const physicalCommit =
            held &&
            action?.committed &&
            action.hitAt === null &&
            action.phase !== 'recover' &&
            this.physics.time < action.until;
        const closeCommit =
            held &&
            previous?.plan.reachable &&
            previous.plan.at + previous.plan.time - this.physics.time <= settings.commitLead &&
            previous.plan.at + previous.plan.time + this.config.ai.toss.ground.followThrough >=
                this.physics.time;
        if (physicalCommit || closeCommit) {
            actor = previousActor;
            plan = {
                ...previous.plan,
                point: { ...(action?.point || previous.plan.point) },
                at: this.physics.time,
                time: Math.max(
                    0,
                    (action?.contactAt ?? previous.plan.at + previous.plan.time) -
                        this.physics.time,
                ),
            };
            if (actor === controlled) humanPlan = plan;
        } else if (
            humanPlan &&
            humanPlan.time <= settings.claimLead &&
            (!plan ||
                !plan.reachable ||
                effort(controlled, humanPlan) <= effort(actor, plan) + settings.claimSlack)
        ) {
            actor = controlled;
            plan = humanPlan;
        }
        if (!actor || !plan) return null;
        const assignment = {
            playerId: actor.id,
            team,
            human: actor === controlled,
            plan: structuredClone(plan),
            humanPlan: humanPlan ? structuredClone(humanPlan) : null,
        };
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
        const n = selected.toward,
            position = selected.root.translation();
        const allies = this.physics.players
            .filter((player) => player.team === team && player !== selected)
            .map((player) => ({
                id: player.id,
                role: player.role,
                home: { x: player.home.x * n, z: player.home.z * n },
            }));
        const plan = this.formation.plan({ x: position.x * n, z: position.z * n }, allies, {
            x: selected.home.x * n,
            z: selected.home.z * n,
        });
        return new Map([...plan].map(([id, point]) => [id, { x: point.x * n, z: point.z * n }]));
    }

    /** 사람이 발차기를 누르고 받을 자리로 달릴 때 자리에서 멈추게 입력 크기만 줄인다. 방향·점프·발차기는 건드리지 않는다. */
    assistReceive(team, human) {
        const settings = this.config.ai.receive.assist;
        if (!human || !settings || !this.profile.defense || this.state.phase !== 'rally')
            return human;
        if (!(human.kick || human.kickPressed) || human.jump || human.jumpPressed) return human;
        const assignment = this.state.defense[team],
            plan = assignment?.humanPlan || (assignment?.human ? assignment.plan : null);
        const player = this.physics.players[this.state.selected[team]];
        if (!plan || plan.mode === 'slide' || player.receive?.mode === 'slide' || !plan.stance)
            return human;
        const remaining = plan.at + plan.time - this.physics.time;
        if (!(remaining > 0 && remaining <= settings.window)) return human;
        const magnitude = Math.hypot(human.x, human.z);
        if (magnitude <= settings.minInput) return human;
        const root = player.root.translation(),
            dx = plan.stance.x - root.x,
            dz = plan.stance.z - root.z,
            distance = Math.hypot(dx, dz);
        if (distance < 0.02) return { ...human, x: 0, z: 0 };
        if ((human.x * dx + human.z * dz) / (magnitude * distance) <= settings.cone) return human;
        const scale = Math.min(1, (distance * settings.brake) / magnitude);
        return scale >= 1 ? human : { ...human, x: human.x * scale, z: human.z * scale };
    }

    receiveCover(player, assignment) {
        const point = assignment.plan.point,
            distance = this.config.ai.receive.coverDistance;
        const n = player.toward,
            limit = this.config.court.halfWidth - 0.25;
        // 리시버 역할의 보조 자리만 여기서 정한다. 세터·공격수의 보조 자리는 ai-brain.js의 CoverState가 정한다.
        const target = {
            x: point.x - n * distance,
            z: point.z + (player.home.z < point.z ? -1 : 1) * distance,
        };
        const dx = target.x - point.x,
            dz = target.z - point.z,
            length = Math.hypot(dx, dz);
        if (length < distance) {
            target.x = point.x + (length > 0.01 ? dx / length : -n) * distance;
            target.z = point.z + (length > 0.01 ? dz / length : 0) * distance;
        }
        return {
            x: n * Math.max(-this.config.court.halfLength + 0.35, Math.min(-0.6, target.x * n)),
            z: Math.max(-limit, Math.min(limit, target.z)),
        };
    }

    getReceiveGuides() {
        if (this.state.phase !== 'rally') return [null, null];
        return this.state.defense.map((assignment) => {
            if (!assignment) return null;
            const player = this.physics.players[assignment.playerId],
                action = player.receive,
                plan = assignment.plan;
            const stage = action?.phase || (plan.reachable ? 'approach' : 'late');
            return {
                playerId: player.id,
                team: player.team,
                human: assignment.human,
                point: { ...(action?.point || plan.point) },
                stance: { ...plan.stance },
                mode: action?.mode || plan.mode,
                reachable: plan.reachable,
                stage,
                remaining: Math.max(
                    0,
                    (action?.contactAt ?? plan.at + plan.time) - this.physics.time,
                ),
            };
        });
    }

    kickIntent(player) {
        if (this.state.phase !== 'rally') return null;
        // A serve and the last legal team contact must clear the net. Every other
        // grounded kick builds the team's attack, including a human reception.
        if (this.profile.serve && this.state.lastTouch < 0 && this.state.serving === player.team) {
            // 서브 발차기는 사람·AI 모두 상대 코트 뒤쪽 한가운데를 향해 네트를 넘는 공을 만든다(공중 발차기는 기존 그대로 앞으로 내리찍는다).
            const target = {
                x: player.toward * this.config.ai.serve.groundAim.x,
                z: 0,
                playerId: -1,
            };
            return { kind: 'return', reason: 'serve', from: player.id, target };
        }
        if (
            this.state.possession === player.team &&
            this.state.touches >= this.config.rules.contacts - 1
        )
            return { kind: 'return', reason: 'last_touch', from: player.id, target: null };
        // The designated attacker prepares a high foot for the incoming set. This
        // is the same final-attack intent for either team and either input owner.
        if (player.role === TAKRAW_ROLE.attacker && this.state.toss?.to === player.id)
            return { kind: 'attack', reason: 'set_received', from: player.id, target: null };
        const preferred =
            player.role === TAKRAW_ROLE.setter ||
            (this.state.possession === player.team && this.state.touches > 0)
                ? TAKRAW_ROLE.attacker
                : TAKRAW_ROLE.setter;
        const origin = player.root.translation();
        const recoveringAttacker = (ally) =>
            ally.role === TAKRAW_ROLE.attacker &&
            preferred === TAKRAW_ROLE.attacker &&
            this.state.lastTouch === ally.id &&
            this.state.touches === 1 &&
            ally.receive?.mode === 'slide' &&
            Math.max(0, ally.receive.until - this.physics.time) <
                Math.sqrt(
                    (2 * this.physics.settings.groundToss.attackApex) /
                        this.physics.settings.gravity,
                );
        const candidates = this.physics.players.filter(
            (ally) => ally.team === player.team && ally.id !== player.id,
        );
        candidates.sort((a, b) => {
            const rank = (ally) => {
                const p = ally.root.translation();
                return (
                    (/fall|recover|down/i.test(ally.state) && !recoveringAttacker(ally) ? 20 : 0) +
                    (ally.role === preferred ? 0 : 6) +
                    Math.hypot(p.x - origin.x, p.z - origin.z)
                );
            };
            return rank(a) - rank(b) || a.id - b.id;
        });
        const ally = candidates[0],
            p = ally.root.translation(),
            n = player.toward;
        const preferredAlly = candidates.find((candidate) => candidate.role === preferred);
        const condition = recoveringAttacker(ally)
            ? 'recovering_attacker'
            : ally.role === preferred || !preferredAlly
              ? null
              : /fall|recover|down/i.test(preferredAlly.state)
                ? 'recovering'
                : 'distance';
        const spread =
            ally.role === TAKRAW_ROLE.attacker ? this.tossSpread(player) : { x: 0, z: 0 };
        return {
            kind: 'toss',
            reason:
                condition && condition !== 'recovering_attacker'
                    ? 'cover'
                    : ally.role === TAKRAW_ROLE.attacker
                      ? 'set'
                      : 'receive',
            condition,
            from: player.id,
            target: {
                playerId: ally.id,
                x:
                    n *
                    Math.max(
                        -this.config.court.halfLength + 0.5,
                        Math.min(-0.95, p.x * n + this.config.ai.toss.aim.dx + spread.x),
                    ),
                z: Math.max(
                    -2.55,
                    Math.min(2.55, p.z - n * 0.1 + this.config.ai.toss.aim.dz + spread.z),
                ),
            },
        };
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
        if (!spread || this.profile.repeatable) return { x: 0, z: 0 };
        const bonus = this.config.athletes.bonus.setting,
            ratio =
                bonus > 0 ? Math.min(1, Math.max(0, (setter.effects?.setting ?? 0) / bonus)) : 0;
        const half = (axis) =>
            spread.half[axis][0] + (spread.half[axis][1] - spread.half[axis][0]) * ratio;
        const key = [this.state.seed, this.state.rally, this.state.touches, setter.id];
        return {
            x: half('x') * (2 * this.seededUnit(...key, 1) - 1),
            z: half('z') * (2 * this.seededUnit(...key, 2) - 1),
        };
    }

    tossTarget(player) {
        return this.kickIntent(player)?.target || null;
    }

    /**
     * 팀 시점의 플레이 안내. title·detail은 message(id, values)이고 문장은 src/i18n/messages/match.js가 만든다.
     * values의 own은 이 팀(team) 기준이고, from·to·role은 역할 id(receiver|setter|attacker, 모르면 null)다.
     */
    getTeamPlay(team) {
        if (!this.profile.teamPlay) return null;
        const state = this.state,
            play = state.play;
        const role = (id) => this.physics.players[id]?.role ?? null;
        const result = (title, detail, tone = 'neutral', data = null) => ({
            title,
            detail,
            tone,
            stage: state.phase,
            from: data?.from ?? null,
            to: data?.to ?? data?.target?.playerId ?? null,
            kind: data?.kind || null,
            reason: data?.reason || null,
        });
        const overpass = play?.outcome === 'overpass';
        const coverDetail = (condition) =>
            message(condition === 'recovering' ? 'playCoverRecovering' : 'playCoverFar');
        if (state.phase === 'point' || state.phase === 'finished') {
            const winner = state.phase === 'finished' ? state.matchWinner : state.pointWinner;
            const title = message(state.phase === 'finished' ? 'playWin' : 'playPoint', {
                own: winner === team,
            });
            const detail = overpass
                ? message('playOverpassPoint', {
                      own: play.team === team,
                      reason: state.pointReason,
                  })
                : message('pointReason', { reason: state.pointReason });
            return result(
                title,
                detail,
                overpass && play.team === team ? 'warning' : 'neutral',
                play,
            );
        }
        if (state.phase === 'ready')
            return result(
                message('playServeReady', { own: state.serving === team }),
                message('playServeReadyDetail'),
            );
        const defense = state.defense[team];
        if (defense) {
            const actor = this.physics.players[defense.playerId],
                action = actor.receive;
            const motion =
                action?.mode === 'slide'
                    ? 'slide'
                    : action?.mode === 'lunge'
                      ? 'lunge'
                      : action
                        ? 'cushion'
                        : 'ready';
            const title = message('playReceive', {
                human: defense.human,
                role: role(actor.id),
                motion,
            });
            const detail = message(
                defense.human
                    ? 'playReceiveHuman'
                    : defense.plan.reachable
                      ? 'playReceiveReachable'
                      : 'playReceiveFar',
            );
            return result(title, detail, defense.human ? 'ready' : 'neutral', {
                from: actor.id,
                kind: 'receive',
                reason: 'defense',
            });
        }
        if (play?.kind === 'attack' && play.from === state.lastTouch) {
            const own = play.team === team,
                toward = play.team === 0 ? 1 : -1;
            const crossed =
                this.physics.ball.translation().x * toward > this.physics.settings.ballRadius;
            return result(
                message('playSpike', { own, third: state.touches === this.config.rules.contacts }),
                message(crossed ? 'playSpikeCrossed' : 'playSpikeAir'),
                own ? 'ready' : 'warning',
                play,
            );
        }
        if (overpass)
            return result(
                message(play.team === team ? 'playOverpassOwn' : 'playOverpassTheirs'),
                play.team === team
                    ? message('playOverpassOwnDetail', { from: role(play.from), to: role(play.to) })
                    : message('playOverpassTheirsDetail'),
                play.team === team ? 'warning' : 'ready',
                play,
            );
        if (play?.kind === 'toss' && play.outcome === 'mishit')
            return result(
                message('playMishit', { own: play.team === team }),
                message('playMishitDetail', { from: role(play.from), to: role(play.to) }),
                'warning',
                play,
            );
        const pass = state.toss;
        if (pass?.team === team) {
            const remaining = this.config.rules.contacts - state.touches;
            const detail =
                remaining <= 0
                    ? message('playFourthTouch')
                    : remaining === 1
                      ? message('playLastTouchLeft')
                      : play?.condition === 'recovering_attacker'
                        ? message('playRecoveringAttacker')
                        : play?.reason === 'cover'
                          ? coverDetail(play.condition)
                          : message(
                                pass.to === state.selected[team]
                                    ? 'playMoveToFootprint'
                                    : 'playBuildAttack',
                            );
            return result(
                message('playPass', {
                    from: role(pass.from),
                    to: role(pass.to),
                    pending: pass.pending,
                }),
                detail,
                pass.to === state.selected[team] ? 'ready' : 'neutral',
                play,
            );
        }
        const landing = this.predictAtHeight(this.config.ai.receiveHeight);
        const actingTeam = state.lastTouch < 0 ? state.serving : landing.x < 0 ? 0 : 1;
        const active = this.physics.players.find(
            (player) => player.team === actingTeam && this.ai[player.id].active,
        );
        const actor = active || this.physics.players[state.selected[actingTeam]];
        const intent = this.inputs[actor.id]?.intent;
        const own = actingTeam === team,
            contacts = this.config.rules.contacts;
        if (intent?.reason === 'serve')
            return result(
                message('playServe', { own }),
                message('playServeDetail'),
                'neutral',
                intent,
            );
        if (state.possession === actingTeam && state.touches >= contacts)
            return result(
                message('playContactsDone', { own, contacts }),
                message('playFourthTouch'),
                'neutral',
                play,
            );
        if (intent?.reason === 'last_touch')
            return result(
                message('playLastTouch', { own }),
                message('playLastTouchDetail', { own, used: contacts - 1 }),
                own ? 'ready' : 'neutral',
                intent,
            );
        if (intent?.kind === 'attack')
            return result(
                message('playAttackReady', { own }),
                message(own ? 'playAttackReadyDetail' : 'playDefendSpike'),
                own ? 'ready' : 'neutral',
                intent,
            );
        if (intent?.kind === 'toss') {
            const detail =
                intent.reason === 'cover'
                    ? coverDetail(intent.condition)
                    : intent.target.playerId === state.selected[team]
                      ? message('playWatchSetter', { role: role(actor.id) })
                      : message('playLinkTouches');
            return result(
                message('playTossReady', {
                    own,
                    from: role(actor.id),
                    to: role(intent.target.playerId),
                }),
                detail,
                'neutral',
                intent,
            );
        }
        return result(
            message(own ? 'playAttackBuild' : 'playReceiving'),
            message('playDefaultDetail', { contacts }),
        );
    }

    predictAtHeight(height) {
        const p = this.physics.ball.translation();
        const v = this.physics.ball.linvel();
        const gravity = Math.abs(this.physics.settings.gravity);
        const discriminant = v.y * v.y + 2 * gravity * (p.y - height);
        const t = discriminant > 0 ? Math.max(0, (v.y + Math.sqrt(discriminant)) / gravity) : 0;
        return {
            x: p.x + v.x * t,
            z: p.z + v.z * t,
            time: t,
            reachable: discriminant >= 0 && t > 0,
        };
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
        const shortJump =
            !highAerial.reachable || apex < highHeight + attack.preparation.apexMargin;
        const contactLead = shortJump ? lowAttack.contactLead : attack.checkLead;
        // A low set's narrow height window can open just before maxLead. Keep one
        // AI decision interval so the 15 Hz controller cannot skip that window.
        const maxLead = shortJump
            ? Math.max(attack.maxLead, contactLead + 1 / this.config.simulation.aiRate)
            : attack.maxLead;
        const overheadHeight = p.y + v.y * contactLead - 0.5 * gravity * contactLead * contactLead;
        const heightGain = jumpGain * contactLead;
        const height = shortJump
            ? (lowAttack.minHeight + lowAttack.maxHeight) / 2 + heightGain
            : highHeight;
        const aerial = { ...(shortJump ? this.predictAtHeight(height) : highAerial), y: height };
        return {
            ...aerial,
            shortJump,
            contactLead,
            maxLead,
            jumpWindow: shortJump
                ? overheadHeight >= lowAttack.minHeight + heightGain &&
                  overheadHeight <= lowAttack.maxHeight + heightGain
                : overheadHeight > attack.minHeight + heightGain &&
                  overheadHeight < attack.maxHeight + heightGain,
        };
    }

    approachPosition(team, aim, offset) {
        const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
        const n = team === 0 ? 1 : -1,
            sideLimit = this.config.court.halfWidth - 0.15;
        // 서브 중(첫 터치 전, 서브 팀)에는 서버가 엔드라인 뒤에 설 수 있도록 뒤쪽 한계를 서브 자리까지 푼다.
        const back =
            this.state.lastTouch < 0 && this.state.serving === team
                ? Math.max(6.2, Math.abs(this.config.ai.serve.spot.x) + 0.3)
                : 6.2;
        return {
            x: clamp(aim.x - n * offset, team === 0 ? -back : 0.6, team === 0 ? -0.6 : back),
            z: clamp(aim.z + n * this.config.ai.toss.attack.lateral, -sideLimit, sideLimit),
        };
    }

    /** 연습 기록에 사람 선수의 점프·발차기 입력 순간을 남긴다(updateServeToss 뒤, observeTiming 앞). */
    recordTrainingInput() {
        const training = this.state.training;
        if (!training || this.state.phase !== 'rally') return;
        const input = this.inputs[this.state.selected[0]],
            guide = this.getAttackGuides()[0];
        const player = this.physics.players[this.state.selected[0]];
        this.drill.recordInput(training, {
            input,
            guide,
            time: this.state.time,
            jumpError: this.timingJudge.jumpError(guide),
            kickError: () =>
                this.kickTimingError(player, guide, this.drill.lesson(training).prehold),
        });
    }

    /** 발차기 입력 시점의 타이밍 오차. 연습 기록과 접촉 판정이 같은 식을 쓴다. */
    kickTimingError(player, guide, prehold) {
        return this.timingJudge.kickError({
            prehold,
            guide,
            jumpActive: player.jump.active,
            jumpTime: player.jump.time,
            kickDelay: () => this.getAttackKickDelay(guide || this.predictAerial(player)),
            preholdLead: this.config.training.guide.preholdLead,
        });
    }

    /** 사람이 조작하는 선수의 점프·발차기 입력 순간을 기록한다. 안내는 입력이 있을 때만 계산한다. */
    observeTiming(humans) {
        if (this.state.phase !== 'rally') return;
        // 연습이 아닐 때와 발을 먼저 올리지 않는 레슨은 점프 뒤 지연 기준이다.
        const prehold = this.state.training
            ? this.drill.lesson(this.state.training).prehold
            : false;
        let guides = null;
        for (const team of [0, 1]) {
            if (!humans[team]) continue;
            const player = this.physics.players[this.state.selected[team]],
                input = this.inputs[player.id];
            if (!input.jumpPressed && !input.kickPressed) continue;
            guides ??= this.getAttackGuides();
            const guide = guides[team];
            if (input.jumpPressed)
                this.timingJudge.record(
                    this.state.timing,
                    team,
                    'jump',
                    this.timingJudge.jumpError(guide),
                    this.state.time,
                );
            if (input.kickPressed)
                this.timingJudge.record(
                    this.state.timing,
                    team,
                    'kick',
                    this.kickTimingError(player, guide, prehold),
                    this.state.time,
                );
        }
    }

    /** 사람 선수의 공중 발 접촉만 등급을 받는다. 어떤 접촉이든 해당 선수의 기록은 소비된다. */
    judgeTiming(event, humans) {
        const team = event.team;
        if (!humans[team] || event.playerId !== this.state.selected[team]) return null;
        const record = this.state.timing[team];
        this.state.timing[team] = this.timingJudge.emptyRecord();
        if (this.physics.players[event.playerId].grounded || !/^foot/.test(event.part || ''))
            return null;
        return this.timingJudge.evaluate(record, this.state.time);
    }

    getAttackKickDelay(aerial = this.predictAerial()) {
        const training = this.state.training;
        const recorded = this.drill.recordedJump(training);
        if (recorded) return recorded.kickDelay;
        const lesson = training && this.drill.lesson(training);
        const attack = aerial.shortJump
            ? this.config.ai.toss.lowAttack
            : this.config.ai.toss.attack;
        return attack.kickDelay * (lesson?.kickDelayScale ?? 1);
    }

    /**
     * 연습 안내의 재료(사실)만 낸다. 단계·문구·색·진행 막대는 화면(presentation/training-coach.js)이 이 값으로 만든다.
     * 상태를 바꾸지 않는다(DEV-008). guide는 사람 팀의 공격 안내(getAttackGuides()[0])다.
     */
    getTrainingFacts(guide = this.getAttackGuides()[0]) {
        const t = this.state.training;
        if (!t) return null;
        const player = this.physics.players[this.state.selected[0]],
            input = this.inputs[player.id];
        const settings = this.config.training.guide,
            aerial = this.predictAerial(player);
        const recorded = this.drill.recordedJump(t);
        const shortJump = recorded?.shortJump ?? guide?.shortJump ?? aerial.shortJump;
        const contactLead = recorded?.contactLead ?? guide?.contactLead ?? aerial.contactLead;
        const jumpHold =
            recorded?.jumpHold ??
            guide?.jumpHold ??
            (shortJump ? 1 / this.config.simulation.tickRate : this.config.ai.jumpHold);
        const kickDelay =
            recorded?.kickDelay ?? guide?.kickDelay ?? this.getAttackKickDelay(aerial);
        const lesson = this.drill.lesson(t);
        const plan = player.kick.airPlan,
            motion = plan?.motion;
        const motionId = t.contact?.motionId || motion?.id || t.motionId;
        // 동작 상태: 동작 이름 + 갈래(hit·reach·adapt·없음). 동작이 없으면 레슨 안내다.
        const motionKnown = TAKRAW_TRAINING_LESSONS.some((item) => item.id === motionId);
        const adjustment =
            t.contact?.foot && t.contact.motionId
                ? 'hit'
                : motion?.reachError > 0.08
                  ? 'reach'
                  : motion?.adaptation > 0.025
                    ? 'adapt'
                    : null;
        const jumpIn = guide && player.grounded ? guide.time - contactLead : null;
        const kickIn = lesson.prehold
            ? jumpIn === null
                ? null
                : jumpIn - settings.preholdLead
            : player.jump.active
              ? input.kick && plan
                  ? null
                  : kickDelay - player.jump.time
              : jumpIn === null
                ? null
                : jumpIn + kickDelay;
        const contactIn = Number.isFinite(plan?.remaining) ? Math.max(0, plan.remaining) : null;
        return {
            lesson: t.lesson,
            tempo: t.tempo,
            attempt: t.attempt,
            successes: t.successes,
            title: lesson.title,
            sequence: lesson.sequence,
            anyMotion: lesson.anyMotion,
            prehold: lesson.prehold,
            motionId: motionId || null,
            motionKnown,
            adjustment,
            jumpIn,
            kickIn,
            shortJump,
            contactLead,
            jumpHold,
            kickDelay,
            contactIn,
            phase: plan?.phase || null,
            estimated: !plan,
            // 화면에 남길 결과(이번 시도, 없으면 지난 시도)와 이번 시도의 결과.
            result: t.result || t.previousResult,
            attemptResult: t.result,
            rallyPhase: this.state.phase,
            set: t.setAt !== null,
            contact: t.contact && {
                part: t.contact.part,
                foot: t.contact.foot,
                downward: t.contact.downward,
                outgoingY: t.contact.outgoing?.y,
            },
            jumpActive: player.jump.active,
            jumpTime: player.jump.time,
            planned: !!plan,
            kickHeld: input.kick,
            horizon: this.physics.settings.airKick.contact?.horizon || contactLead,
            guide: guide && {
                preholdWindow: guide.preholdWindow,
                preheld: guide.preheld,
                inPosition: guide.inPosition,
                settled: guide.settled,
                braking: guide.braking,
                jumpWindow: guide.jumpWindow,
            },
        };
    }

    getAttackGuides() {
        if (this.state.phase !== 'rally') return [null, null];
        if (this.state.training && this.state.training.setAt === null) return [null, null];
        const { attack } = this.config.ai.toss;
        const { court } = this.config;
        const training = this.state.training;
        const lesson = training && this.drill.lesson(training);
        const approachOffset = attack.offset * (lesson?.approachScale ?? 1);
        const recorded = this.drill.recordedJump(training);
        return [0, 1].map((team) => {
            const n = team === 0 ? 1 : -1,
                player = this.physics.players[this.state.selected[team]];
            if (!player || /fall|recover|down/i.test(player.state)) return null;
            const aerial = this.predictAerial(player);
            const predicted =
                aerial.reachable &&
                aerial.time > attack.minLead &&
                aerial.time <= this.config.visual.attackGuide.maxLead;
            const shortJump = recorded?.shortJump ?? aerial.shortJump;
            const contactLead = recorded?.contactLead ?? aerial.contactLead;
            const jumpHold =
                recorded?.jumpHold ??
                (shortJump ? 1 / this.config.simulation.tickRate : this.config.ai.jumpHold);
            const kickDelay = this.getAttackKickDelay(aerial);
            if (
                !this.profile.drill &&
                !this.humanServes(team) &&
                (this.state.possession !== team ||
                    this.state.touches < 1 ||
                    (this.state.toss?.team === team && this.state.toss.to !== player.id))
            )
                return null;
            const plan = player.jump.active ? player.kick.airPlan : null;
            const tracking =
                plan?.contact?.impact && plan.phase !== 'follow' && Number.isFinite(plan.remaining);
            if (!tracking && !predicted) return null;
            const point = tracking
                ? plan.contact.impact
                : { x: aerial.x, y: aerial.y, z: aerial.z };
            const time = tracking ? Math.max(0, plan.remaining) : aerial.time;
            if (
                point.x * n >= -0.15 ||
                Math.abs(point.x) > court.halfLength ||
                Math.abs(point.z) > court.halfWidth
            )
                return null;
            const stance = this.approachPosition(team, point, approachOffset),
                pos = player.root.translation();
            const dx = stance.x - pos.x,
                dz = stance.z - pos.z;
            const velocity = this.attackVelocity(player),
                prepare = attack.preparation;
            const distance = Math.hypot(dx, dz),
                inPosition = distance <= attack.positionRadius;
            const drift = Math.hypot(dx - velocity.x * time, dz - velocity.z * time);
            const brakeTravel = Math.hypot(velocity.x, velocity.z) * prepare.brakeLead;
            const settled = drift < prepare.driftRadius;
            // A stationary player near the edge still needs to approach. Ask for
            // braking only when momentum carries them away from the contact stance.
            const braking =
                inPosition &&
                ((!settled && drift > distance) || brakeTravel > attack.positionRadius);
            const needsPrehold = !!lesson?.prehold;
            const preheld =
                !!this.inputs[player.id]?.kick && player.kick.held && player.kick.mode === 'ground';
            const preholdWindow =
                needsPrehold &&
                !player.jump.active &&
                aerial.time - contactLead <= this.config.training.guide.preholdLead;
            const timeWindow =
                predicted && aerial.jumpWindow && aerial.time < aerial.maxLead && player.grounded;
            const jumpWindow =
                timeWindow && inPosition && settled && !braking && (!needsPrehold || preheld);
            const stage = player.jump.active
                ? 'kick'
                : preholdWindow && !preheld
                  ? 'kick'
                  : !inPosition || (!settled && !braking)
                    ? 'position'
                    : braking
                      ? 'brake'
                      : jumpWindow
                        ? 'jump'
                        : preholdWindow
                          ? 'kick'
                          : 'position';
            return {
                playerId: player.id,
                contact: { x: point.x, y: point.y, z: point.z },
                stance,
                time,
                inPosition,
                settled,
                drift,
                braking,
                brakeTravel,
                shortJump,
                contactLead,
                jumpHold,
                kickDelay,
                preholdWindow,
                preheld,
                timeWindow,
                estimated: !tracking,
                phase: plan?.phase || null,
                remaining: tracking ? time : null,
                jumpWindow,
                kickWindow:
                    player.jump.active &&
                    (plan ? plan.phase === 'strike' : player.jump.time >= kickDelay),
                stage,
            };
        });
    }

    attackVelocity(player) {
        const velocity = { x: 0, z: 0 };
        for (const part of player.parts) {
            const v = part.body.linvel(),
                weight = part.mass / player.mass;
            velocity.x += v.x * weight;
            velocity.z += v.z * weight;
        }
        return velocity;
    }

    /** 팀별 성향 데이터만 받는다. 학교·유니폼·도장깨기 진행은 시뮬레이션이 알지 않는다. */
    setTemperaments(profiles = [null, null]) {
        if (
            !Array.isArray(profiles) ||
            profiles.length !== 2 ||
            !Array.from(profiles).every((value) => value === null || Temperament.validConfig(value))
        )
            throw new TypeError('팀별 AI 성향을 확인해 주세요.');
        this.temperamentProfiles = structuredClone(profiles);
        this.temperaments = { key: '', list: [] };
    }

    /** 시드·선수·랠리 번호와 프로필이 같으면 롤백·재실행에서도 같은 성향을 만든다. */
    temperamentOf(playerId) {
        const key = `${this.state.seed}:${this.state.rally}`;
        if (this.temperaments.key !== key) this.temperaments = { key, list: [] };
        return (this.temperaments.list[playerId] ??= new Temperament(
            this.temperamentProfiles[takrawTeamOf(playerId)] || this.config.ai.temperament,
            this.state.seed,
            playerId,
            this.state.rally,
            this.seededUnit,
        ));
    }

    decideAI(humans) {
        this.metrics.aiSteps++;
        if (this.state.phase !== 'rally') return;
        const p = this.physics.ball.translation();
        const v = this.physics.ball.linvel();
        const intercept = this.predictAtHeight(this.config.ai.receiveHeight);
        const { lowAttack, attack } = this.config.ai.toss;
        for (let team = 0; team < 2; team++) {
            if (!this.profile.aiTeams[team]) {
                for (const i of TAKRAW_TEAM_PLAYER_IDS[team])
                    Object.assign(this.ai[i], {
                        x: 0,
                        z: 0,
                        active: false,
                        kickFrom: 0,
                        kickUntil: 0,
                        jumpUntil: 0,
                    });
                continue;
            }
            const human = humans[team];
            this.fillStance[team] = this.profile.formation ? this.fillTargets(team, human) : null;
            const available = this.physics.players.filter(
                (player) =>
                    player.team === team &&
                    (!human || this.state.selected[team] !== player.id) &&
                    (!this.profile.drill || player.id === TAKRAW_TRAINING_SETTER_ID) &&
                    !this.humanServes(team),
            );
            for (const id of TAKRAW_TEAM_PLAYER_IDS[team]) this.ai[id].active = false;
            const pass = this.state.toss?.team === team ? this.state.toss : null;
            const recipient = pass ? this.physics.players[pass.to] : null;
            const aerialPass =
                recipient?.role === TAKRAW_ROLE.attacker ? this.predictAerial(recipient) : null;
            const useAerial =
                aerialPass?.reachable &&
                aerialPass.time > 0 &&
                aerialPass.x * recipient.toward < -0.15;
            const receivingPoint = useAerial ? aerialPass : intercept;
            const receivingStance = this.approachPosition(
                team,
                receivingPoint,
                useAerial ? attack.offset : this.config.ai.toss.receiveOffset,
            );
            const recipientDistance = recipient
                ? Math.hypot(
                      recipient.root.translation().x - receivingStance.x,
                      recipient.root.translation().z - receivingStance.z,
                  )
                : Infinity;
            const reachableDistance =
                (recipient?.settings.movementSpeed || this.physics.settings.movementSpeed) *
                    Math.max(0, receivingPoint.time - 0.1) +
                attack.positionRadius;
            const recipientReady =
                recipient &&
                !/fall|recover|down/i.test(recipient.state) &&
                recipientDistance < reachableDistance;
            const ownSide = team === 0 ? receivingPoint.x < -0.15 : receivingPoint.x > 0.15;
            let active = null,
                best = Infinity;
            if (ownSide) {
                // An ally pass belongs to its recipient. Other AI only step in when a
                // low, missed set is beyond that player's reach or they have fallen.
                if (recipientReady) active = available.includes(recipient) ? recipient : null;
                else
                    for (const player of available) {
                        const score = this.receptionDistance(player, intercept);
                        if (score < best) {
                            best = score;
                            active = player;
                        }
                    }
            }
            if (this.state.training)
                active =
                    this.state.training.setAt === null && !this.state.training.contact
                        ? this.physics.players[TAKRAW_TRAINING_SETTER_ID]
                        : null;
            const groundBase = this.config.ai.toss.ground;
            const braking = this.config.ai.receive.braking;
            const defense = this.decideReceive(team, human, available, intercept, active);
            if (defense) active = this.physics.players[defense.playerId];
            for (const player of available) {
                const a = this.ai[player.id];
                a.active = player === active;
                const aerial =
                        player === recipient && aerialPass
                            ? aerialPass
                            : this.predictAerial(player),
                    { shortJump } = aerial;
                const q = player.root.translation();
                const setTarget = this.tossTarget(player);
                const ground = groundBase;
                const kickLead = setTarget ? ground.lead : 0.2;
                const kickWindow = setTarget ? ground.window : 0.36;
                // 서브: 던진 공의 꼭짓점이 jumpApex 이상이면 점프서브(공중 공격과 같은 점프·발차기), 아니면 지상서브다(사람과 같은 기준).
                const jumpServe = this.isJumpServe(team);
                const attacking =
                    jumpServe ||
                    (this.state.possession === team &&
                        (this.state.touches >= 2 ||
                            (player.role === TAKRAW_ROLE.attacker && this.state.touches >= 1)));
                const highContact =
                    !defense && attacking && aerial.reachable && aerial.time > attack.minLead;
                const aim = highContact ? aerial : intercept;
                // 목표 자리와 현재 상태(대기·보조·받기·공격·세트·추격)는 상태머신이 정한다.
                const { mode, target } = this.aiBrain.update({
                    game: this,
                    player,
                    team,
                    ball: p,
                    aim,
                    defense,
                    active,
                    highContact,
                    setTarget,
                    record: a.brain,
                    temperament: this.temperamentOf(player.id),
                    now: this.state.time,
                });
                if (defense) {
                    if (player !== active) {
                        // Never leave a previous chaser kicking after another teammate takes over.
                        a.kickFrom = a.kickUntil = a.jumpUntil = 0;
                        a.attack = null;
                    }
                    if (player === active && a.attack) {
                        // A late incoming save takes priority over an obsolete aerial attack.
                        a.attack = null;
                        a.jumpUntil = 0;
                        a.kickFrom = a.kickUntil = 0;
                        a.cooldown = 0;
                    }
                }
                const dx = target.x - q.x,
                    dz = target.z - q.z;
                const dist = Math.hypot(dx, dz);
                const velocity = this.attackVelocity(player),
                    prepare = attack.preparation;
                const anticipating = mode === 'attack';
                const receiving = mode === 'receive' || (mode === 'set' && !player.jump.active);
                const brakeLead = anticipating ? prepare.brakeLead : receiving ? braking : 0;
                const moveX = dx - velocity.x * brakeLead;
                const moveZ = dz - velocity.z * brakeLead;
                const approachScale =
                    player.settings.movementSpeed / this.physics.settings.movementSpeed;
                const approachRadius = (anticipating ? 0.5 : 0.7) * approachScale;
                a.x =
                    dist > (anticipating ? 0.08 : 0.12)
                        ? moveX / Math.max(Math.hypot(moveX, moveZ), approachRadius)
                        : 0;
                a.z =
                    dist > (anticipating ? 0.08 : 0.12)
                        ? moveZ / Math.max(Math.hypot(moveX, moveZ), approachRadius)
                        : 0;
                const drift = Math.hypot(
                    dx - velocity.x * aerial.time,
                    dz - velocity.z * aerial.time,
                );
                const settled = drift < prepare.driftRadius;
                if (player === active) {
                    const saving =
                        !!defense &&
                        defense.plan.reachable &&
                        defense.plan.time <= ground.window &&
                        p.y > this.physics.settings.ballRadius &&
                        v.y < 1.5 &&
                        !player.jump.active;
                    if (saving) {
                        // Re-time BEFORE contact as the ball trajectory changes. The old
                        // cooldown was set at reservation time, so it could prevent a save
                        // even when the foot never made contact. No ball impulse is added.
                        const arrivalAt = this.state.time + defense.plan.time;
                        const from = Math.max(this.state.time, arrivalAt - ground.lead);
                        const until = arrivalAt + ground.followThrough;
                        const strokeHeld =
                            a.kickFrom <= this.state.time && a.kickUntil > this.state.time;
                        if (!strokeHeld) a.kickFrom = from;
                        a.kickUntil = strokeHeld ? Math.max(a.kickUntil, until) : until;
                        a.cooldown = a.kickUntil + 0.16;
                    } else if (this.state.time >= a.cooldown) {
                        if (
                            highContact &&
                            settled &&
                            aerial.time < aerial.maxLead &&
                            aerial.jumpWindow &&
                            (player.grounded || (player.supportAge < 0.065 && !player.jump.active))
                        ) {
                            a.attack = { until: this.state.time + aerial.time };
                            a.jumpUntil =
                                this.state.time +
                                (shortJump
                                    ? 1 / this.config.simulation.tickRate
                                    : this.config.ai.jumpHold);
                            a.kickFrom =
                                this.state.time +
                                (shortJump ? lowAttack.kickDelay : attack.kickDelay);
                            a.kickUntil = a.kickFrom + 0.65;
                            a.cooldown = a.kickFrom + 0.9;
                            a.x = 0;
                            a.z = 0;
                        } else if (
                            !defense &&
                            !highContact &&
                            dist < 0.4 &&
                            intercept.time < kickWindow &&
                            p.y > 0.28 &&
                            v.y < 1.5
                        ) {
                            a.kickFrom = this.state.time + Math.max(0, intercept.time - kickLead);
                            a.kickUntil =
                                a.kickFrom +
                                (setTarget
                                    ? kickLead + ground.followThrough
                                    : this.config.ai.kickHold);
                            a.cooldown = a.kickUntil + 0.25;
                        }
                    }
                }
                // A receiver must finish approaching while its real foot swings.
                // Stopping on kickFrom strands the player outside the kick workspace.
                const reaching = receiving;
                if (
                    a.jumpUntil > this.state.time ||
                    (player.jump.active && this.state.time < a.kickUntil) ||
                    (!reaching &&
                        this.state.time >= a.kickFrom - 0.06 &&
                        this.state.time < a.kickUntil)
                ) {
                    a.x = 0;
                    a.z = 0;
                }
                if (
                    player.jump.active &&
                    a.attack &&
                    this.state.time < a.kickUntil &&
                    player.kick.airPlan?.phase !== 'follow'
                ) {
                    const remaining = Math.max(0.08, a.attack.until - this.state.time);
                    const point = { x: p.x + v.x * remaining, z: p.z + v.z * remaining };
                    const stance = this.approachPosition(team, point, attack.offset);
                    const gain = 2 / (remaining * remaining * player.settings.airControl);
                    const steerX = (stance.x - q.x - velocity.x * remaining) * gain;
                    const steerZ = (stance.z - q.z - velocity.z * remaining) * gain;
                    const length = Math.max(1, Math.hypot(steerX, steerZ));
                    a.x = steerX / length;
                    a.z = steerZ / length;
                }
            }
        }
    }

    getView() {
        const attackGuides = this.getAttackGuides();
        return {
            entities: this.physics.getEntities(),
            state: this.state,
            events: this.events,
            revision: this.revision,
            attackGuides,
            receiveGuides: this.getReceiveGuides(),
            training: this.getTrainingFacts(attackGuides[0]),
            teamNames: [...this.teamNames],
            teamSchools: [...this.teamSchools],
            teamPlay: [this.getTeamPlay(0), this.getTeamPlay(1)],
            players: this.physics.players.map((player) => ({
                id: player.id,
                team: player.team,
                role: player.role,
                name: player.athlete.name,
                profile: structuredClone(player.athlete),
                state: player.state,
                grounded: player.grounded,
                position: { ...player.root.translation() },
                receive: player.receive
                    ? { mode: player.receive.mode, phase: player.receive.phase }
                    : null,
                motionId: player.kick.airPlan?.motion?.id || null,
                kickHeld: !!this.inputs[player.id]?.kick,
                jumpHeld: !!this.inputs[player.id]?.jump,
                tossReady:
                    this.state.serveToss?.stage === 'hold' &&
                    player.id === this.state.selected[this.state.serving],
                tossCharge:
                    player.id === this.state.selected[this.state.serving] &&
                    this.state.serveToss?.stage === 'hold'
                        ? Math.min(
                              1,
                              this.state.serveToss.charge / this.config.ai.serve.toss.fullCharge,
                          )
                        : 0,
            })),
        };
    }

    save() {
        return {
            version: this.config.version,
            mode: this.mode,
            state: structuredClone(this.state),
            teamNames: [...this.teamNames],
            teamSchools: [...this.teamSchools],
            teamById: { ...this.teamById },
            ai: structuredClone(this.ai),
            aiDirty: this.aiDirty,
            inputs: structuredClone(this.inputs),
            rallyStart: this.rallyStart || 0,
            metrics: { ...this.metrics },
            physics: this.physics.save(),
            temperamentProfiles: structuredClone(this.temperamentProfiles),
        };
    }
    validate(data) {
        const vector = (value, axes) => value && axes.every((axis) => Number.isFinite(value[axis]));
        const receivePlan = (plan) =>
            plan &&
            ['cushion', 'lunge', 'slide'].includes(plan.mode) &&
            typeof plan.reachable === 'boolean' &&
            typeof plan.moving === 'boolean' &&
            vector(plan.point, ['x', 'y', 'z']) &&
            vector(plan.stance, ['x', 'z']) &&
            Number.isFinite(plan.time) &&
            plan.time >= 0 &&
            Number.isFinite(plan.at) &&
            plan.at >= 0 &&
            Number.isFinite(plan.distance) &&
            plan.distance >= 0;
        const defense = (assignment, team) =>
            assignment === null ||
            (assignment &&
                Number.isInteger(assignment.playerId) &&
                takrawTeamOf(assignment.playerId) === team &&
                assignment.team === team &&
                typeof assignment.human === 'boolean' &&
                (!assignment.human || assignment.playerId === takrawHumanPlayerId(team)) &&
                receivePlan(assignment.plan) &&
                (assignment.humanPlan === null || receivePlan(assignment.humanPlan)));
        return (
            data &&
            data.version === this.config.version &&
            data.physics &&
            data.state &&
            Array.isArray(data.temperamentProfiles) &&
            data.temperamentProfiles.length === 2 &&
            Array.from(data.temperamentProfiles).every(
                (value) => value === null || Temperament.validConfig(value),
            ) &&
            Array.isArray(data.teamNames) &&
            data.teamNames.length === 2 &&
            data.teamNames.every(
                (name) => name === null || (typeof name === 'string' && name.trim()),
            ) &&
            Array.isArray(data.teamSchools) &&
            data.teamSchools.length === 2 &&
            data.teamSchools.every((id) => id === null || typeof id === 'string') &&
            Array.isArray(data.state.defense) &&
            data.state.defense.length === 2 &&
            Array.from(data.state.defense).every(defense) &&
            Array.isArray(data.state.score) &&
            data.state.score.length === 2 &&
            data.state.score.every(Number.isFinite) &&
            Array.isArray(data.ai) &&
            data.ai.length === 6 &&
            Array.from(data.ai).every(
                (ai) =>
                    ai &&
                    (ai.receive === null || receivePlan(ai.receive)) &&
                    AiBrain.validRecord(ai.brain),
            ) &&
            Number.isInteger(data.state.seed) &&
            Array.isArray(data.inputs) &&
            data.inputs.length === 6 &&
            Array.from(data.inputs).every(
                (input) =>
                    input &&
                    Number.isFinite(input.aim?.x) &&
                    Number.isFinite(input.aim?.y) &&
                    (input.receive === null ||
                        (receivePlan(input.receive) &&
                            typeof input.receive.allowSlide === 'boolean')),
            ) &&
            Array.isArray(data.state.selected) &&
            data.state.selected.length === 2 &&
            data.state.selected.every((id, team) => id === takrawHumanPlayerId(team))
        );
    }
    load(data) {
        if (!this.validate(data)) throw new Error('경기 상태 형식 또는 버전이 맞지 않습니다.');
        this.physics.load(data.physics);
        this.setTemperaments(data.temperamentProfiles);
        this.mode = data.mode;
        this.state = structuredClone(data.state);
        this.teamById = { ...data.teamById };
        this.teamNames = [...data.teamNames];
        this.teamSchools = [...data.teamSchools];
        this.ai = structuredClone(data.ai);
        this.inputs = structuredClone(data.inputs);
        this.aiDirty = data.aiDirty;
        this.rallyStart = data.rallyStart;
        this.metrics = { ...data.metrics };
        this.events = [];
        this.revision++;
    }
    dispose() {
        this.physics.dispose();
    }
}

export { TakrawGame, message as takrawMessage };
