import * as THREE from 'three';
import RAPIER from 'rapier';
import { ActionState, createDOMInput } from '@bloom-gamekit/input';
import { createLoop, createDeadlineScheduler } from '@bloom-gamekit/simloop';
import { PresentationRuntime, RenderObject } from '@bloom-gamekit/interpolation';
import { createRoomSession, profiles } from '@bloom-gamekit/rollback';
import { createNostrDynamicRoom } from '@bloom-gamekit/transport';
import { AudioPlayer } from '@bloom-gamekit/audio';
import { PresentationEventQueue } from '@bloom-gamekit/presentation-events';
import { createValueCodec } from '@bloom-gamekit/deterministic';

import { TAKRAW_VERSION, TAKRAW_CONFIG } from './config/game.js';
import { TAKRAW_RUNTIME } from './config/runtime.js';
import { TAKRAW_CLUB_RULES, TakrawClub } from './club/club.js';
import { TAKRAW_TRAINING_LESSONS, TakrawGame } from './simulation/game.js';
import { TakrawView } from './presentation/view.js';
import { impactStyleKey } from './presentation/impact.js';
import { seedFromText } from './simulation/ai-brain.js';
import { TakrawUI } from './presentation/ui.js';

const PLAYER_STATE_LABELS = Object.freeze({
      ready: '준비', standing: '준비', grounded: '준비', idle: '준비',
      airborne: '공중', jumping: '점프', falling: '낙하',
      kicking: '발차기', spike: '스파이크', overhead: '스파이크',
      down: '자세 회복', fallen: '자세 회복', ragdoll: '자세 회복',
      recovering: '일어나는 중', recovery: '일어나는 중', gettingUp: '일어나는 중',
    });

async function bootTakraw() {
  const config = TAKRAW_CONFIG;
  const stepMs = 1000 / config.simulation.tickRate;
  const dependencyState = Object.fromEntries(['three', 'rapier', '@bloom-gamekit/input', '@bloom-gamekit/simloop', '@bloom-gamekit/interpolation', '@bloom-gamekit/rollback', '@bloom-gamekit/transport', '@bloom-gamekit/audio', '@bloom-gamekit/presentation-events', '@bloom-gamekit/deterministic', '@bloom-gamekit/object-pool'].map(name => [name, { url: import.meta.resolve(name), state: 'ready' }]));
  const errors = [];
  const listeners = [];
  const actionNames = [
    'left', 'right', 'forward', 'back', 'jump', 'kick',
    'p2Left', 'p2Right', 'p2Forward', 'p2Back', 'p2Jump', 'p2Kick',
  ];
  const samples = Object.fromEntries(actionNames.map(name => [name, {}]));
  const poseCache = new Map();
  const poseEntities = [];
  const pendingCommands = [];
  const axis = { x: 0, z: 0 };
  const cameraDrag = { pointer: null, x: 0, y: 0 };
  const stats = { frames: 0, steps: 0, simulationMs: 0, maxSimulationMs: 0, backlogDrops: 0 };
  const clubSession = { team: null, match: null, reward: null };
  const rewards = { jobs: [], running: false, timer: null };

  let ui;
  let club;
  let game;
  let view;
  let actions;
  let device;
  let audio;
  let codec;
  let session = null;
  let room = null;
  let loop = null;
  let pump = null;
  let journal = null;
  let presentation = null;
  let latestView = null;
  let mode = null;
  let bootstrapStage = 'interface';
  let disposed = false;
  let failed = false;
  let paused = false;
  let releasing = false;
  let inRollback = false;
  let observationPending = false;
  let run = 0;
  let animation = 0;
  let renderTime = -Infinity;
  let hudTime = -Infinity;
  let publishedTick = -1;
  let gameRevision = -1;
  let presentationRevision = 0;
  let presentationSequence = 0;
  let resetMode = 'reset';
  let lastInput = new Uint8Array(TAKRAW_RUNTIME.input.size);
  let lastContact = null;
  let network = Object.freeze({ state: 'idle', code: '', message: '', count: 0, phase: '연결 준비', hint: '', diagnostics: '' });
  const connection = {
    abort: null, history: [], handshake: { startedAtMs: 0 }, observedFailure: null,
    warning: { message: '', atMs: 0 }, retry: { pending: new Map(), nextCheckAtMs: 0 },
    rosterSize: 0, gameShown: false, maintenance: { nextAtMs: 0 },
  };

  function isReady() { return bootstrapStage === 'ready'; }

  function canStart(nextMode) {
    if (!isReady() || disposed || failed) return false;
    if (nextMode === 'match' || nextMode === 'training') return club?.status === 'ready';
    return nextMode === 'local' || nextMode === 'online';
  }

  function showBootStatus(message = '', isError = false) {
    ui.setBootStatus({ phase: bootstrapStage, message, isError });
  }

  const resumeKey = `bloom-takraw:${TAKRAW_VERSION}:active-room`;

  function forgetRoom() {
    try {
      room?.forgetResume();
      const saved = JSON.parse(sessionStorage.getItem(resumeKey) || 'null');
      if (saved?.room) sessionStorage.removeItem(`${resumeKey}:${saved.room}`);
      sessionStorage.removeItem(resumeKey);
    } catch { /* Storage errors are reported when connecting. */ }
  }

  function maintainConnections() {
    const now = performance.now();
    if (!room || !session || session.failure || now < connection.retry.nextCheckAtMs) return;
    connection.retry.nextCheckAtMs = now + 1000;
    for (const id of session.players) {
      if (id === session.localPlayerId || room.transports.has(id) || connection.retry.pending.has(id)) continue;
      const token = run, capability = room;
      connection.retry.pending.set(id, true);
      networkEvent('reconnect-start');
      capability.reconnect(id).catch(error => {
        if (token === run) networkEvent('reconnect-retry', error.message);
      }).finally(() => { if (token === run) connection.retry.pending.delete(id); });
    }
  }

  function networkEvent(name, detail = '') {
    const entry = `${new Date().toLocaleTimeString('ko-KR', { hour12: false })} · ${String(name).slice(0, 80)}${detail ? ` · ${String(detail).slice(0, 180)}` : ''}`;
    connection.history.push(entry);
    if (connection.history.length > 28) connection.history.shift();
    setNetwork({ diagnostics: `BLOOM TAKRAW ${TAKRAW_VERSION} · ${location.protocol} · secure=${window.isSecureContext}\n${connection.history.join('\n')}` });
  }

  function readableConnectionError(error) {
    const raw = String(error?.message || error || 'unknown').replace(/\s+/g, ' ').slice(0, 180);
    if (/WebCrypto|secure randomness|secure context|HTTPS|crypto\.subtle/i.test(raw)) return '보안 연결이 필요해요. HTTPS 사이트에서 같은 버전으로 접속하세요.';
    if (/bootstrap|checkpoint|snapshot|membership-failed/i.test(raw))
      return `경기 물리 상태 동기화 검사에 실패했어요. (${raw})`;
    if (/version|contract|handshake|protocol|simulationVersion|mismatch|incompatible/i.test(raw)) return `서로 다른 게임 버전이나 동기화 규칙일 수 있어요. 양쪽에서 v${TAKRAW_VERSION}를 열어 주세요. (${raw})`;
    if (/No Nostr relay|signaling|relay|publication|Nostr/i.test(raw)) return `방 신호 서버 연결에 실패했어요. 네트워크를 확인해 주세요. (${raw})`;
    if (/WebRTC|ICE|peer|transport|connection/i.test(raw)) return `친구와 직접 연결하는 데 실패했어요. 방화벽·NAT 설정을 확인해 주세요. (${raw})`;
    return `연결 오류: ${raw}`;
  }

  function listen(target, type, callback, options) {
    target.addEventListener(type, callback, options);
    listeners.push(() => target.removeEventListener(type, callback, options));
  }

  function recordError(error, source) {
    const value = error instanceof Error ? error : new Error(String(error));
    errors.push({ source, message: value.message, stack: value.stack || '', time: performance.now() });
    if (errors.length > 12) errors.shift();
    console.error('[블룸 세팍타크로]', source, value);
    return value;
  }

  function setNetwork(value) {
    network = Object.freeze({ ...network, ...value });
    ui?.setNetwork(network);
  }

  function publishClub() {
    if (disposed || !club || !ui) return;
    const pending = rewards.jobs.find(job => job.status === 'error') || rewards.jobs[0] || null;
    ui.setClub({ ...club.getView(), pendingReward: pending ? { status: pending.status, message: pending.message } : null });
  }

  function matchId() {
    const bytes = new Uint8Array(16); globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function observeMatchResult() {
    const match = clubSession.match, state = latestView?.state;
    if (disposed || mode !== 'match' || !match || match.finished || state?.phase !== 'finished' || ![0,1].includes(state.matchWinner)) return;
    match.finished = true;
    const won = state.matchWinner === 0, reward = TAKRAW_CLUB_RULES.rewards[won ? 'win' : 'loss'];
    const job = { id: match.id, won, mode: 'match', status: 'queued', message: '경기 보상을 저장하고 있어요.', ...reward };
    rewards.jobs.push(job); clubSession.reward = job;
    // 완료 관측은 한 번만 한다. 영속 I/O는 시뮬레이션 콜백 밖에서 실행한다.
    scheduleRewards();
  }

  function scheduleRewards(retry = false) {
    if (disposed) return;
    if (retry) for (const job of rewards.jobs) if (job.status === 'error') job.status = 'queued';
    if (rewards.running || rewards.timer !== null || !rewards.jobs.some(job => job.status === 'queued')) return;
    rewards.timer = window.setTimeout(() => { rewards.timer = null; saveRewards(); }, 0);
  }

  async function saveRewards() {
    if (disposed || rewards.running) return;
    rewards.running = true;
    try {
      let job;
      while (!disposed && (job = rewards.jobs.find(value => value.status === 'queued'))) {
        job.status = 'saving'; job.message = '경기 보상을 저장하고 있어요.'; publishClub(); hudTime = -Infinity;
        try {
          await club.rewardMatch({ id: job.id, won: job.won, mode: job.mode });
          job.status = 'saved'; job.message = `보상 저장 완료 · ${job.credits} C + ${job.trainingPoints} P`;
          rewards.jobs.splice(rewards.jobs.indexOf(job), 1);
        } catch (error) {
          job.status = 'error'; job.message = '보상을 아직 저장하지 못했어요. 탭을 닫기 전에 재시도해 주세요.';
          recordError(error, 'club-reward');
        }
        if (clubSession.match?.id === job.id) clubSession.reward = job;
      }
    } finally {
      rewards.running = false; publishClub(); hudTime = -Infinity; scheduleRewards();
    }
  }

  async function retryReward() {
    if (disposed || !club) return;
    try { await club.refresh(); scheduleRewards(true); }
    catch (error) { recordError(error, 'club-refresh'); }
  }

  async function clubAction(action, payload = {}) {
    if (!club || disposed) return null;
    if (action === 'refresh') return club.refresh();
    if (mode || ui.inGame) throw new Error('팀 변경은 처음 화면에서 할 수 있어요.');
    if (action === 'rename') return club.rename(payload.name);
    if (action === 'assign') return club.assign(payload.role, payload.playerId);
    if (action === 'train') return club.train(payload.playerId, payload.stat);
    if (action === 'allocate') return club.allocate(payload.playerId, payload.allocations, { revision: payload.revision });
    if (action === 'recruit') return club.recruit(payload.playerId);
    throw new Error('팀 관리 동작을 확인해 주세요.');
  }

  function localTeam() {
    if (!session || mode !== 'online') return 0;
    return game.teamById?.[session.localPlayerId] ?? 0;
  }

  function controlsAllowed() {
    return Boolean(isReady() && session?.ready && !paused && !session.failure &&
      (mode !== 'online' || session.players.length === 2));
  }

  function clearDeviceState() {
    axis.x = 0;
    axis.z = 0;
    cameraDrag.pointer = null;
    ui?.canvas.classList.remove('is-orbiting');
    actions?.releaseAll();
    device?.releaseAll();
    actions?.consume();
    lastInput = new Uint8Array(TAKRAW_RUNTIME.input.size);
  }

  function releaseControls() {
    if (releasing) return;
    releasing = true;
    try {
      clearDeviceState();
      loop?.releaseInput();
    } finally {
      releasing = false;
    }
  }

  function observeSoon() {
    if (!loop || observationPending || disposed) return;
    observationPending = true;
    queueMicrotask(() => {
      observationPending = false;
      if (!loop || disposed) return;
      try {
        loop.observeInput(performance.now());
        pump?.wake();
      } catch (error) {
        simulationFailed(error);
      }
    });
  }

  function encodeAxis(value) {
    return Math.round(Math.max(-1, Math.min(1, value)) * TAKRAW_RUNTIME.input.axisScale) & 255;
  }

  function writeMovement(input, offset, right, back) {
    // Both local players share the same screen; online peers each see their
    // own team from behind. Only world-space input crosses the network.
    const movement = view.screenMovement(right, back, localTeam());
    input[offset] = encodeAxis(movement.x);
    input[offset + 1] = encodeAxis(movement.z);
  }

  function moveCamera(event) {
    const rotating = controlsAllowed() && event.active && event.pointerType === 'mouse' &&
      (event.buttons & 2) !== 0 && !['up', 'cancel'].includes(event.type);
    if (!rotating) {
      cameraDrag.pointer = null;
      ui.canvas.classList.remove('is-orbiting');
      return;
    }
    if (cameraDrag.pointer === event.pointerId) {
      view.orbitBy(event.x - cameraDrag.x, event.y - cameraDrag.y);
    } else ui.canvas.focus({ preventScroll: true });
    cameraDrag.pointer = event.pointerId;
    cameraDrag.x = event.x;
    cameraDrag.y = event.y;
    ui.canvas.classList.add('is-orbiting');
  }

  function resetCamera() {
    view?.resetCamera();
    observeSoon();
  }

  function getInput() {
    const input = new Uint8Array(TAKRAW_RUNTIME.input.size);
    const commands = pendingCommands.splice(0).map(code => ({ payload: Uint8Array.of(code) }));
    for (const name of actionNames) actions.sampleInto(name, samples[name]);
    if (controlsAllowed()) {
      writeMovement(input, 0,
        Number(samples.right.held) - Number(samples.left.held) + axis.x,
        Number(samples.back.held) - Number(samples.forward.held) + axis.z);
      input[2] = (samples.jump.held ? 1 : 0) | (samples.kick.held ? 2 : 0);
      if (samples.jump.pressed) commands.push({ payload: Uint8Array.of(1) });
      if (samples.kick.pressed) commands.push({ payload: Uint8Array.of(2) });
      if (mode === 'local') {
        writeMovement(input, 3,
          Number(samples.p2Right.held) - Number(samples.p2Left.held),
          Number(samples.p2Back.held) - Number(samples.p2Forward.held));
        input[5] = (samples.p2Jump.held ? 1 : 0) | (samples.p2Kick.held ? 2 : 0);
        if (samples.p2Jump.pressed) commands.push({ payload: Uint8Array.of(11) });
        if (samples.p2Kick.pressed) commands.push({ payload: Uint8Array.of(12) });
      }
    }
    actions.consume();
    lastInput = input.slice();
    return { input, commands };
  }

  function createPresentation() {
    class BodyPose extends RenderObject {
      static renderSchema = {
        x: this.POSITION_X, y: this.POSITION_Y, z: this.POSITION_Z,
        qx: this.LINEAR, qy: this.LINEAR, qz: this.LINEAR, qw: this.LINEAR,
        halfHeight: this.LINEAR,
      };
    }
    presentation = new PresentationRuntime({ stepMs, delayMs: stepMs });
    poseCache.clear();
    poseEntities.length = 0;
    publishedTick = -1;
    gameRevision = -1;
    presentationRevision += 1;
    presentationSequence = 0;
    resetMode = 'reset';
    return BodyPose;
  }

  let BodyPose;

  function publish(force = false, now = performance.now()) {
    if (!presentation || !latestView) return;
    const tick = latestView.state.tick;
    if (!force && publishedTick === tick && gameRevision === latestView.revision && !resetMode) return;
    if (gameRevision !== latestView.revision || tick < publishedTick) resetMode ||= 'reset';
    if (resetMode) presentationRevision += 1;
    poseEntities.length = 0;
    const liveIds = new Set();
    for (const entity of latestView.entities) {
      liveIds.add(entity.id);
      let source = poseCache.get(entity.id);
      if (!source) {
        source = { x: entity.x, y: entity.y, z: entity.z, qx: entity.qx, qy: entity.qy, qz: entity.qz, qw: entity.qw,
          halfHeight: entity.halfHeight ?? 0 };
        poseCache.set(entity.id, source);
      }
      const dot = source.qx * entity.qx + source.qy * entity.qy + source.qz * entity.qz + source.qw * entity.qw;
      const sign = dot < 0 ? -1 : 1;
      source.x = entity.x;
      source.y = entity.y;
      source.z = entity.z;
      source.qx = entity.qx * sign;
      source.qy = entity.qy * sign;
      source.qz = entity.qz * sign;
      source.qw = entity.qw * sign;
      source.halfHeight = entity.halfHeight ?? 0;
      poseEntities.push({ id: entity.id, generation: 0, type: BodyPose, source });
    }
    for (const id of poseCache.keys()) if (!liveIds.has(id)) poseCache.delete(id);
    presentation.capture({
      revision: presentationRevision,
      sequence: ++presentationSequence,
      timeMs: tick * stepMs,
      mode: resetMode || 'continuous',
      entities: poseEntities,
    }, now);
    publishedTick = tick;
    gameRevision = latestView.revision;
    resetMode = null;
  }

  /** 접촉 효과 한 건의 표시 자원. 우리 팀의 타이밍 등급 표시는 이벤트 수명 동안 함께 유지한다. */
  /** 스타일에 pop 문구가 있으면 큰 글자 팝업을 띄운다. */
  function showHitPop(payload) {
    const text = TAKRAW_CONFIG.visual.impact[impactStyleKey(TAKRAW_CONFIG.visual.impact, payload)].pop;
    return text ? ui.showHitPop(text, payload.team) : null;
  }

  function showBadge(payload) {
    return payload.timing && (mode === 'local' || payload.team === localTeam()) ? ui.showTiming(payload.timing) : null;
  }

  /** 등급 표시가 바뀌었는지 비교하는 키. 같은 판정이 재확정될 때 표시를 다시 띄우지 않기 위해 쓴다. */
  function badgeKey(timing) {
    return timing ? `${timing.grade}:${Math.round(timing.error * 1000)}` : '';
  }

  /** 접촉 이벤트가 남는 시간(ms). 등급 효과의 정지·궤적 강조와 등급 표시가 끝날 때까지 유지한다. */
  function contactDuration(payload) {
    const { duration, badge } = TAKRAW_RUNTIME.feedback;
    const impact = TAKRAW_CONFIG.visual.impact[impactStyleKey(TAKRAW_CONFIG.visual.impact, payload)];
    if (!payload.timing && !payload.spike) return duration;
    return Math.max(duration, badge, (impact.hold + impact.life) * 1000,
      (impact.trail?.duration ?? 0) * 1000, (impact.shake?.duration ?? 0) * 1000);
  }

  function replaceJournal() {
    journal?.dispose();
    inRollback = false;
    journal = new PresentationEventQueue({
      retentionTicks: TAKRAW_RUNTIME.feedback.retentionTicks,
      adapters: {
        contact: {
          reversible: true,
          start(event) {
            return { impact: view.impacts.start(event.payload), badge: showBadge(event.payload), badgeKey: badgeKey(event.payload.timing), pop: showHitPop(event.payload) };
          },
          update(handle, ageMs) { view.impacts.update(handle.impact, ageMs); },
          // 같은 이벤트의 재확정은 경과 시간을 유지한 채 모양과 등급 표시만 갱신한다.
          reconcile(handle, event) {
            view.impacts.reconcile(handle.impact, event.payload);
            const key = badgeKey(event.payload.timing);
            if (key === handle.badgeKey) return;
            ui.hideTiming(handle.badge);
            handle.badge = showBadge(event.payload);
            handle.badgeKey = key;
          },
          stop(handle) {
            view.impacts.release(handle.impact);
            ui.hideTiming(handle.badge);
            ui.hideHitPop(handle.pop);
          },
        },
        // 선수 착지 먼지: 접촉처럼 추측 이벤트라 롤백되면 사라진다.
        land: {
          reversible: true,
          start(event) { return { node: view.field.startLand(event.payload) }; },
          update(handle, ageMs) { if (handle.node) view.field.update(handle.node, ageMs); },
          reconcile() {},
          stop(handle) { view.field.release(handle.node); },
        },
        // 득점 색종이: 확정된 득점에만 터진다.
        score: {
          reversible: false,
          start(event) { return { node: view.field.startConfetti(event.payload) }; },
          update(handle, ageMs) { if (handle.node) view.field.update(handle.node, ageMs); },
          reconcile() {},
          stop(handle) { view.field.release(handle.node); },
        },
        sound: audio.createAdapter({ onEnded: event => journal?.finish(event) }),
      },
    });
  }

  function emitEvents(frame, data) {
    if (!journal || frame.recovering || frame.replaying) return;
    for (const event of data.events) {
      const identity = {
        tick: event.tick,
        sequence: event.sequence,
        entityId: event.playerId >= 0 ? `player:${event.playerId}` : 'court',
        generation: 0,
      };
      if (event.type === 'touch') {
        lastContact = { ...event, position: { ...event.position } };
        journal.emit({
          ...identity,
          kind: 'contact',
          payload: { ...event, position: { ...event.position } },
          policy: 'speculative',
          durationMs: contactDuration(event),
        });
      }
      if (event.type === 'land') {
        journal.emit({ ...identity, kind: 'land', payload: { ...event, position: { ...event.position } }, policy: 'speculative',
          durationMs: TAKRAW_CONFIG.visual.field.land.life * 1000 });
      } else if (event.type === 'point') {
        const { halfLength } = TAKRAW_CONFIG.court;
        journal.emit({ ...identity, kind: 'score', payload: { ...event, position: { x: (event.team === 0 ? -1 : 1) * halfLength / 2, y: 0, z: 0 } },
          policy: 'confirmed', durationMs: TAKRAW_CONFIG.visual.field.confetti.life * 1000 });
      }
      const kickSound = event.spike ? 'kickSpike' : { perfect: 'kickPerfect', good: 'kickGood' }[event.timing?.grade] ?? 'kick';
      const soundId = { touch: kickSound, land: 'land', net: 'net', serve: 'serve', point: 'point' }[event.type];
      if (soundId) {
        const strength = event.type === 'point' || event.type === 'serve' ? 0.8 :
          Math.max(0.2, Math.min(1.2, event.speed / TAKRAW_RUNTIME.feedback.soundReferenceSpeed));
        journal.emit({ ...identity, kind: 'sound', payload: { soundId, strength }, policy: 'confirmed' });
      }
    }
  }

  function confirmEvents() {
    if (!journal || !session || inRollback) return;
    const tick = Math.min(session.confirmedTick, session.tick - 1);
    if (tick >= 0 && tick >= journal.confirmedTick) journal.confirmThrough(tick);
  }

  function maintainNetwork(now = performance.now(), force = false) {
    if (mode !== 'online' || !session) return;
    if (!force && now < connection.maintenance.nextAtMs) return;
    connection.maintenance.nextAtMs = now + TAKRAW_RUNTIME.hud.interval;
    maintainConnections();
    const count = session.players.length;
    const failed = session.failure;
    let state;
    let message;
    let phase;
    const linkCount = room?.transports?.size || 0;
    if (failed) {
      state = 'error';
      phase = '세션 오류';
      if (connection.observedFailure !== failed) {
        connection.observedFailure = failed;
        networkEvent('session-failed', `${failed.type || 'failed'} ${failed.reason || ''}`);
        recordError(new Error(JSON.stringify(failed)), 'session');
      }
      message = readableConnectionError(failed.reason || failed.type || '세션 동기화 실패');
    } else if (count === 2 && (linkCount < 1 || ['interrupted', 'disconnected'].includes(session.status))) {
      state = 'connecting';
      phase = '재접속 중';
      message = '연결이 끊겨 경기를 기다리고 있어요. 같은 방으로 다시 연결합니다.';
    } else if (!session.ready) {
      state = 'connecting';
      phase = linkCount ? '경기 동기화 중' : '상대 연결 중';
      message = linkCount ? '상대와 연결됐어요. 동일한 경기 상태를 확인하고 있어요.' :
        '방 연결을 준비하고 있어요. 상대방의 접속을 기다리는 중입니다.';
    } else if (count < 2) {
      state = 'listening';
      phase = '친구 입장 대기';
      message = '방 코드를 친구에게 알려주세요. 상대가 들어오면 경기가 시작돼요.';
    } else {
      state = 'connected';
      phase = '연결 완료';
      message = '상대와 연결됐어요.';
      connection.warning.message = '';
    }
    if (state === 'connecting' && linkCount && !connection.handshake.startedAtMs) connection.handshake.startedAtMs = performance.now();
    if (state !== 'connecting' || !linkCount) connection.handshake.startedAtMs = 0;
    if (state === 'connecting' && linkCount && connection.handshake.startedAtMs &&
        performance.now() - connection.handshake.startedAtMs > TAKRAW_RUNTIME.network.handshakeTimeout) {
      const error = new Error('온라인 세션 참가/동기화 시간 초과');
      networkEvent('session-timeout', error.message);
      recordError(error, 'session-timeout');
      stopSession();
      setNetwork({ state: 'error', phase: '연결 시간 초과', count: 0, code: '',
        message: '상대와 연결됐지만 경기 상태를 맞추지 못했어요. 양쪽 게임 버전이 같은지 확인하고 다시 연결해 주세요.',
        hint: `양쪽에서 v${TAKRAW_VERSION} 실행 필요` });
      return;
    }
    if (count !== connection.rosterSize) {
      connection.rosterSize = count;
      loop?.resetTiming();
      pump?.rebase();
      releaseControls();
    }
    const hint = state === 'connected' ? '' :
      connection.warning.message && performance.now() - connection.warning.atMs < 20000 ? connection.warning.message : '';
    if (network.state !== state || network.count !== count || network.message !== message ||
        network.phase !== phase || network.hint !== hint) {
      setNetwork({ state, code: room?.room || network.code, count, message, phase, hint });
    }
    if (state === 'connected' && !connection.gameShown) {
      connection.gameShown = true;
      ui.showGame('online');
      ui.canvas.focus({ preventScroll: true });
    }
  }

  function selectedHud() {
    const team = localTeam();
    const selectedId = latestView.state.selected?.[team] ?? (team === 1 ? 5 : 2);
    const player = latestView.players.find(candidate => candidate.id === selectedId);
    const motionName = TAKRAW_TRAINING_LESSONS.find(lesson => lesson.id === player?.motionId)?.title;
    return {
      ...latestView.state,
      training: latestView.training,
      teamPlay: latestView.teamPlay?.[team] || null,
      teamNames: latestView.teamNames,
      matchReward: clubSession.match?.id === clubSession.reward?.id ? clubSession.reward : null,
      localTeam: team,
      selectedName: player?.name ? `${player.name} · 공격수` : '공격수',
      selectedState: motionName || (player ? PLAYER_STATE_LABELS[player.state] || (player.grounded ? '준비' : '공중') : ''),
      kickHeld: Boolean(player?.kickHeld),
      jumpHeld: Boolean(player?.jumpHeld),
      connection: mode === 'online' ? network.message : '',
    };
  }

  function renderScene(now = performance.now()) {
    if (!view || !presentation || !latestView) return;
    publish(false, now);
    confirmEvents();
    journal?.update(now);
    view.render(presentation.frame(now), latestView, now, { team: localTeam(), mode });
    stats.frames += 1;
    const hudInterval = mode === 'training' ? Math.min(TAKRAW_RUNTIME.hud.interval, 1000 / 30) : TAKRAW_RUNTIME.hud.interval;
    if (now - hudTime >= hudInterval) {
      hudTime = now;
      if (mode) ui.update(selectedHud());
    }
  }

  function frame() {
    if (disposed) return;
    animation = requestAnimationFrame(frame);
    if (failed) return;
    // 표본 수신과 표시에는 같은 단조 시계를 쓴다. RAF timestamp는 직전 입력보다 오래될 수 있다.
    const now = performance.now();
    if (now - renderTime + 0.5 < 1000 / TAKRAW_RUNTIME.clock.renderHz) return;
    renderTime = now;
    try {
      loop?.observeInput(now);
      if (loop) loop.render();
      else renderScene(now);
    } catch (error) {
      simulationFailed(error);
    }
  }

  function simulationFailed(error) {
    if (failed) return error;
    failed = true;
    const value = recordError(error, 'simulation');
    pump?.stop();
    loop?.stop();
    releaseControls();
    if (mode === 'online') {
      setNetwork({ state: 'error', message: '경기를 계속할 수 없어요. 방을 닫고 다시 시작해 주세요.' });
    }
    showBootStatus('게임 실행 중 문제가 생겼어요. 새로고침 후 다시 시작해 주세요.', true);
    return value;
  }

  function stopSession({ preserveResume = false } = {}) {
    if (!preserveResume) forgetRoom();
    run += 1;
    connection.retry.pending.clear();
    connection.retry.nextCheckAtMs = 0;
    connection.maintenance.nextAtMs = 0;
    connection.abort?.abort();
    connection.abort = null;
    releaseControls();
    pump?.stop();
    loop?.stop();
    pump = null;
    loop = null;
    session?.close();
    session = null;
    room?.close();
    room = null;
    journal?.dispose();
    journal = null;
    pendingCommands.length = 0;
    paused = false;
    failed = false;
    mode = null;
    connection.rosterSize = 0;
    connection.gameShown = false;
    inRollback = false;
    connection.handshake.startedAtMs = 0;
    connection.observedFailure = null;
    connection.warning.message = '';
    connection.warning.atMs = 0;
  }

  function onSessionEvent(event, token) {
    if (token !== run || disposed) return;
    if (event.type === 'rollback') {
      if (journal && !inRollback) {
        journal.beginRollback(Math.max(event.from, journal.confirmedTick + 1));
        inRollback = true;
      }
      resetMode = 'rollback';
    } else if (event.type === 'reconciled') {
      if (inRollback) journal.endRollback();
      inRollback = false;
      latestView = game.getView();
      resetMode = 'rollback';
    } else if (event.type === 'membership-committed' || event.type === 'recovered') {
      replaceJournal();
      latestView = game.getView();
      resetMode = 'reset';
      loop?.resetTiming();
      pump?.rebase();
    }
    if (['membership-committed', 'peer-disconnected', 'recovered', 'fatal', 'desync-unrecoverable'].includes(event.type)) {
      networkEvent(`session:${event.type}`, event.reason || `tick=${event.tick ?? '?'}`);
    }
    if (event.type === 'fatal' || event.type === 'desync-unrecoverable') {
      simulationFailed(new Error(event.reason || event.type));
    }
  }

  function openSession(nextMode, capability, token) {
    mode = nextMode;
    paused = false;
    clubSession.team = ['match','training'].includes(nextMode) ? club.matchTeam() : null;
    clubSession.match = nextMode === 'match' ? { id: matchId(), finished: false } : null;
    clubSession.reward = null;
    game.setTeams(clubSession.team, null);
    // 경기마다 AI 성향·서브가 달라지도록 시드를 정한다. 온라인은 두 사람이 같은 방 코드에서 같은 시드를 얻고, 혼자 하는 경기는 새 값이다.
    const matchSeed = nextMode === 'online' ? seedFromText(String(capability)) : nextMode === 'training' ? undefined : crypto.getRandomValues(new Uint32Array(1))[0];
    game.reset(nextMode, undefined, matchSeed);
    latestView = game.getView();
    BodyPose = createPresentation();
    replaceJournal();
    const online = nextMode === 'online';
    let firstCheckpointReadback = true;
    const adapter = {
      save: () => codec.encode(game.save()),
      load(bytes) {
        const data = codec.decode(bytes);
        if (!game.validate(data)) throw new Error('Invalid Takraw snapshot');
        game.load(data);
        if (online && firstCheckpointReadback) {
          firstCheckpointReadback = false;
          const replay = codec.encode(game.save());
          const identical = bytes.length === replay.length && bytes.every((value, index) => value === replay[index]);
          const actual = identical ? data : codec.decode(replay);
          const physicalSame = data.physics.snapshot.length === actual.physics.snapshot.length &&
            data.physics.snapshot.every((value, index) => value === actual.physics.snapshot[index]);
          networkEvent(identical ? 'checkpoint-verified' : 'checkpoint-mismatch',
            `physics=${physicalSame ? 'equal' : 'different'} bytes=${bytes.length}/${replay.length}`);
        }
        latestView = game.getView();
        resetMode = 'reset';
      },
      validateSnapshot(bytes) {
        try { return game.validate(codec.decode(bytes)); }
        catch { return false; }
      },
      applyMembership(change) {
        game.applyMembership(change);
        latestView = game.getView();
      },
      step(context) {
        const begin = performance.now();
        game.step(context);
        latestView = game.getView();
        emitEvents(context, latestView);
        const elapsed = performance.now() - begin;
        stats.steps += 1;
        stats.simulationMs += elapsed;
        stats.maxSimulationMs = Math.max(stats.maxSimulationMs, elapsed);
      },
    };
    const profile = online ? {
      ...profiles.action,
      mode: 'rollback',
      tickRate: config.simulation.tickRate,
      baseInputDelayTicks: 1,
      minInputDelayTicks: 0,
      maxInputDelayTicks: 6,
      rollbackWindowTicks: TAKRAW_RUNTIME.network.rollbackWindow,
      stateHistorySize: TAKRAW_RUNTIME.network.historySize,
      checksumInterval: config.simulation.tickRate,
      maxCatchupSteps: TAKRAW_RUNTIME.clock.maxCatchupSteps,
      maxSnapshotBytes: TAKRAW_RUNTIME.network.maxSnapshotBytes,
      maxHistoryBytes: TAKRAW_RUNTIME.network.maxHistoryBytes,
      maxReplayBytes: TAKRAW_RUNTIME.network.maxReplayBytes,
    } : {
      ...profiles.lockstep,
      mode: 'lockstep',
      tickRate: config.simulation.tickRate,
      baseInputDelayTicks: 0,
      minInputDelayTicks: 0,
      maxInputDelayTicks: 0,
      adaptiveInputDelay: false,
      pacingPolicy: 'none',
      maxCatchupSteps: TAKRAW_RUNTIME.clock.maxCatchupSteps,
    };
    session = createRoomSession({
      mode: online ? 'online' : 'local',
      ...(online ? { room: capability } : { localPlayerId: 'local', localFastPath: true }),
      simulationVersion: TAKRAW_VERSION,
      seed: config.network.seed,
      inputSize: TAKRAW_RUNTIME.input.size,
      adapter,
      profile,
      membership: {
        maxPlayers: 2,
        transitionTimeoutMs: TAKRAW_RUNTIME.network.transitionTimeout,
        reconnectGraceMs: TAKRAW_RUNTIME.network.reconnectGrace,
        maxCatchupSteps: TAKRAW_RUNTIME.clock.maxCatchupSteps,
      },
      onEvent: event => onSessionEvent(event, token),
    });
    loop = createLoop({
      session,
      rates: {
        baseHz: TAKRAW_RUNTIME.clock.baseHz,
        inputHz: TAKRAW_RUNTIME.clock.inputHz,
        renderHz: TAKRAW_RUNTIME.clock.renderHz,
      },
      getInput,
      canObserveInput: () => Boolean(session?.ready && !session.failure),
      canAdvance: () => Boolean(session?.ready && !session.failure &&
        (online ? session.players.length === 2 : !paused)),
      onAdvance() { publish(); confirmEvents(); observeMatchResult(); },
      onInputRelease: clearDeviceState,
      onError: simulationFailed,
      onBacklogDrop() { stats.backlogDrops += 1; },
      render: () => renderScene(performance.now()),
    });
    let maintenanceDeadline = null;
    pump = createDeadlineScheduler({
      getDeadlineMs: () => {
        // 입장 대기는 simulation debt를 따라잡는 시간이 아니다. 방 정비만 60Hz로 유지한다.
        if (session && (!session.ready || (online && session.players.length < 2))) {
          return maintenanceDeadline;
        }
        return loop?.nextDeadlineMs ?? null;
      },
      pulse(now) {
        if (!loop || token !== run) return;
        maintenanceDeadline = now + 1000 / TAKRAW_RUNTIME.clock.inputHz;
        loop.pollInput(now);
        loop.pulse(now, { render: false, input: false });
        // Network commands belong to the existing pump, not to rendering.
        maintainNetwork(now);
      },
    });
    publish(true);
    loop.observeInput(performance.now());
    pump.start();
    showBootStatus('', false);
    if (online) {
      connection.handshake.startedAtMs = 0;
      networkEvent('session-open', `role=${room?.role || '?'} players=${session.players.length}`);
      maintainNetwork(performance.now(), true);
    } else {
      ui.showGame(nextMode);
      ui.canvas.focus({ preventScroll: true });
      setNetwork({ state: 'idle', code: '', message: '', count: 0 });
    }
    hudTime = -Infinity;
  }

  function startLocal(nextMode) {
    if (!canStart(nextMode)) { publishClub(); return; }
    audio.unlock();
    observeMatchResult();
    stopSession();
    try { openSession(nextMode, null, run); }
    catch (error) { simulationFailed(error); }
  }

  async function connect(action, code, resuming = false) {
    if (!isReady() || disposed) return;
    if (action === 'close') { quit(); return; }
    if (action === 'resume') {
      try {
        const saved = JSON.parse(sessionStorage.getItem(resumeKey) || 'null');
        if (saved && ['host', 'join'].includes(saved.role) && /^\d{4}$/.test(saved.room))
          return connect(saved.role, saved.room, true);
      } catch (error) { networkEvent('resume-unavailable', error.message); }
      setNetwork({ state: 'error', canResume: false, message: '다시 연결할 경기 정보가 없어요. 새 방을 만들어 주세요.' });
      return;
    }
    if (action !== 'host' && action !== 'join') return;
    const roomCode = String(code || (action === 'host' ?
      String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0') : '')).trim();
    if (action === 'join' && !/^\d{4}$/.test(roomCode)) {
      setNetwork({ state: 'error', message: '친구에게 받은 네 자리 방 코드를 입력해 주세요.', count: 0 });
      return;
    }
    if (!window.isSecureContext || !globalThis.crypto?.subtle || typeof globalThis.WebSocket !== 'function' ||
        typeof globalThis.RTCPeerConnection !== 'function') {
      setNetwork({ state: 'error', phase: '브라우저 연결 환경', code: '', count: 0,
        message: 'WebRTC·WebCrypto가 동작하는 HTTPS 브라우저에서 열어 주세요.',
        hint: '두 사람이 모두 동일한 HTML 버전을 사용해야 해요.' });
      networkEvent('preflight-failed', `secure=${window.isSecureContext} crypto=${!!globalThis.crypto?.subtle} rtc=${typeof globalThis.RTCPeerConnection}`);
      return;
    }
    audio.unlock();
    stopSession({ preserveResume: resuming });
    const token = run;
    connection.abort = new AbortController();
    networkEvent('connect-start', `role=${action} version=${TAKRAW_VERSION}`);
    setNetwork({ state: 'connecting', canResume: resuming, phase: resuming ? '이전 경기 재접속' : action === 'host' ? '방 생성 중' : '방 검색 중',
      code: action === 'join' ? roomCode : '', count: 0, hint: '',
      message: action === 'host' ? '친구를 초대할 방을 만들고 있어요.' : '친구의 방을 찾고 있어요.' });
    let capability;
    try {
      capability = await createNostrDynamicRoom({
        role: action,
        room: roomCode,
        namespace: config.network.namespace,
        resume: { storage: sessionStorage, key: `${resumeKey}:${roomCode}`, reset: !resuming },
        maxPlayers: 2,
        timeoutMs: TAKRAW_RUNTIME.network.timeout,
        peerTimeoutMs: TAKRAW_RUNTIME.network.peerTimeout,
        relays: TAKRAW_RUNTIME.network.relays,
        rtcConfig: { iceServers: TAKRAW_RUNTIME.network.iceServers },
        signal: connection.abort.signal,
        onStatus(event) {
          if (token !== run) return;
          const reason = event.reason || event.message || '';
          if (event.type === 'signaler' && event.status === 'connected') {
            networkEvent('relay-connected', event.relay || '');
            setNetwork({ phase: '신호 서버 연결됨' });
          } else if (event.type === 'signaler' && event.status === 'error' ||
              event.type === 'peer-failed' || event.type === 'signal-error') {
            connection.warning.message = readableConnectionError(reason || event.type);
            connection.warning.atMs = performance.now();
            networkEvent(event.type === 'signaler' ? 'relay-error' : event.type, reason);
            setNetwork({ hint: connection.warning.message });
          } else if (['peer-connected', 'room-ready', 'peer-disconnected'].includes(event.type)) {
            networkEvent(event.type, reason);
            if (event.type === 'peer-connected') setNetwork({ phase: '친구와 직접 연결됨', hint: '' });
          }
        },
      });
      if (token !== run || disposed) { capability.close(); return; }
      room = capability;
      sessionStorage.setItem(resumeKey, JSON.stringify({ role: action, room: capability.room }));
      setNetwork({ canResume: true });
      networkEvent('room-created', `room=${capability.room} role=${action}`);
      openSession('online', capability, token);
    } catch (error) {
      capability?.close();
      if (token !== run || disposed) return;
      networkEvent('connect-error', String(error?.message || error));
      recordError(error, 'network');
      const diagnostics = network.diagnostics;
      stopSession({ preserveResume: true });
      setNetwork({ state: 'error', phase: '연결 실패', count: 0, code: '', diagnostics,
        message: readableConnectionError(error),
        hint: action === 'join' ? '방 코드 · 양쪽 버전 · 상대가 방을 열어둔 상태인지 확인하세요.' :
          '신호 서버 상태나 브라우저 보안 설정을 확인하세요.' });
    }
  }

  function restart() {
    if (!mode) return;
    if (mode === 'training') {
      releaseControls();
      pendingCommands.push(4);
      observeSoon();
      ui.canvas.focus({ preventScroll: true });
      return;
    }
    if (mode === 'online') {
      if (!session?.ready || session.players.length !== 2) return;
      if (localTeam() !== 0) {
        setNetwork({ message: '새 경기는 방장이 시작할 수 있어요.' });
        return;
      }
      pendingCommands.push(4);
      observeSoon();
    } else startLocal(mode);
  }

  function quit() {
    if (!isReady() || disposed) return;
    observeMatchResult();
    stopSession();
    clubSession.team = null; clubSession.match = null; clubSession.reward = null;
    game.setTeams(null, null);
    game.reset('match');
    latestView = game.getView();
    BodyPose = createPresentation();
    publish(true);
    showBootStatus('', false);
    ui.showHome();
    publishClub();
    setNetwork({ state: 'idle', code: '', message: '', count: 0, phase: '연결 준비', hint: '', canResume: false });
  }

  function setPaused(value) {
    paused = Boolean(value);
    releaseControls();
    if (mode !== 'online') {
      loop?.resetTiming();
      if (paused) pump?.stop();
      else {
        pump?.start();
        pump?.wake();
      }
    }
  }

  const runtime = Object.freeze({
    get game() { return game; },
    get session() { return session; },
    get loop() { return loop; },
    get view() { return view; },
    get ui() { return ui; },
    get ready() { return isReady(); },
    diagnostics() {
      return {
        product: '블룸 세팍타크로',
        version: TAKRAW_VERSION,
        status: config.status,
        ready: isReady(), bootstrapStage, mode, paused, failed,
        environment: { secureContext: window.isSecureContext, webCrypto: Boolean(globalThis.crypto?.subtle) },
        dependencies: { ...dependencyState },
        tick: session?.tick ?? latestView?.state.tick ?? 0,
        phase: latestView?.state.phase || 'loading',
        selected: latestView?.state.selected?.slice() || [2, 5],
        physics: { players: game?.physics.players.length || 0, entities: latestView?.entities.length || 0 },
        input: Array.from(lastInput),
        network: { ...network, session: session?.status || null, ready: Boolean(session?.ready),
          players: session?.players.slice() || [], roomConnections: room?.transports?.size || 0,
          roomMetrics: room?.metrics || null },
        session: session?.metrics || null,
        audio: audio?.snapshot() || null,
        club: club?.diagnostics() || null,
        rewards: { pending: rewards.jobs.length, saving: rewards.running, failed: rewards.jobs.filter(job => job.status === 'error').length },
        simulation: { ...stats, averageMs: stats.steps ? stats.simulationMs / stats.steps : 0 },
        lastContact,
        errors: errors.slice(),
      };
    },
    dispose() {
      if (disposed) return;
      stopSession({ preserveResume: true });
      disposed = true;
      bootstrapStage = 'disposed';
      cancelAnimationFrame(animation);
      for (const remove of listeners.splice(0)) remove();
      if (rewards.timer !== null) window.clearTimeout(rewards.timer);
      rewards.timer = null;
      club?.dispose();
      ui?.dispose();
      device?.dispose();
      audio?.dispose();
      view?.dispose();
      game?.physics.dispose();
    },
  });
  window.__takraw = runtime;

  ui = new TakrawUI({
    canStart,
    onStart(nextMode) {
      if (nextMode === 'online') {
        setNetwork({ state: 'idle', count: 0, message: '방을 만들거나 친구의 방 코드로 참가해 주세요.' });
      } else startLocal(nextMode);
    },
    onRestart: restart,
    onClubAction: clubAction,
    onRewardRetry: retryReward,
    onTrainingLesson(lesson) {
      const option = TAKRAW_TRAINING_LESSONS.find(item => item.id === lesson);
      if (mode !== 'training' || !controlsAllowed() || !option) return;
      releaseControls();
      pendingCommands.push(option.command);
      observeSoon();
      ui.canvas.focus({ preventScroll: true });
    },
    onCameraReset: resetCamera,
    onPause: setPaused,
    onQuit: quit,
    onSetting(key, value) {
      if (key === 'sound') audio?.setMuted(!value);
      if (key === 'quality') view?.setQuality(value);
    },
    onNetwork: connect,
    onDiagnostics: () => runtime.diagnostics(),
    onTouch(action, source, down) {
      if (!actions || !['jump', 'kick'].includes(action)) return;
      if (down && !controlsAllowed()) return;
      actions.set(action, `touch:${source}`, Boolean(down));
      if (down) audio?.unlock();
      observeSoon();
    },
    onAxis(x, z) {
      axis.x = controlsAllowed() ? Math.max(-1, Math.min(1, x)) : 0;
      axis.z = controlsAllowed() ? Math.max(-1, Math.min(1, z)) : 0;
      observeSoon();
    },
  }, network);
  club = new TakrawClub({ onChange: publishClub });
  const clubLoad = club.load().catch(error => { recordError(error, 'club-load'); return null; });
  listen(window, 'pagehide', () => runtime.dispose());
  // BFCache에서는 이미 정리한 물리·저장 연결을 새 부팅으로 복원한다.
  window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
  showBootStatus('코트를 준비하고 있어요.');

  try {
    await clubLoad;
    bootstrapStage = 'physics';
    showBootStatus('선수와 공을 준비하고 있어요.');
    if (!RAPIER || typeof RAPIER.init !== 'function') throw new Error('Rapier entry contract');
    await RAPIER.init();
    game = new TakrawGame({ RAPIER, config });
    bootstrapStage = 'graphics';
    view = new TakrawView({ THREE, canvas: ui.canvas, config });
    bootstrapStage = 'controls';
    codec = createValueCodec();
    audio = new AudioPlayer(TAKRAW_RUNTIME.audio);
    audio.setMuted(ui.settings.sound === false);
    view.setQuality(ui.settings.quality);
    actions = new ActionState();
    ui.canvas.tabIndex = 0;
    device = createDOMInput({
      target: ui.canvas,
      state: actions,
      keys: {
        KeyA: 'left', KeyD: 'right', KeyW: 'forward', KeyS: 'back',
        Space: 'jump',
        ArrowLeft: 'p2Left', ArrowRight: 'p2Right', ArrowUp: 'p2Forward', ArrowDown: 'p2Back',
        Enter: 'p2Jump', Numpad0: 'p2Jump', ShiftRight: 'p2Kick',
      },
      pointerButtons: { 0: 'kick', 2: 'cameraOrbit' },
      touchAction: 'none',
      onPointer(event) {
        if (event.type === 'down') audio.unlock();
        moveCamera(event);
        observeSoon();
      },
    });
    listen(document, 'keydown', event => {
      if (event.code !== 'KeyC' || event.repeat || !controlsAllowed()) return;
      if (event.target?.closest?.('input,textarea,select,button,[contenteditable="true"]')) return;
      event.preventDefault();
      resetCamera();
    });
    listen(document, 'keydown', observeSoon);
    listen(document, 'keyup', observeSoon);
    listen(window, 'blur', releaseControls);
    listen(document, 'visibilitychange', () => {
      if (document.hidden) releaseControls();
      else {
        loop?.resetTiming();
        pump?.rebase();
        pump?.wake();
      }
    });
    listen(window, 'resize', () => view.resize());
    game.reset('match');
    latestView = game.getView();
    BodyPose = createPresentation();
    publish(true);
    bootstrapStage = 'ready';
    showBootStatus('', false);
    ui.showHome();
    animation = requestAnimationFrame(frame);
    try {
      const saved = JSON.parse(sessionStorage.getItem(resumeKey) || 'null');
      if (saved && ['host', 'join'].includes(saved.role) && /^\d{4}$/.test(saved.room)) {
        ui.openDialog('network');
        void connect(saved.role, saved.room, true);
      }
    } catch (error) { networkEvent('resume-unavailable', error.message); }
    return runtime;
  } catch (error) {
    recordError(error, 'bootstrap');
    pump?.stop();
    const message = bootstrapStage === 'graphics' && /webgl/i.test(String(error?.message || error)) ?
      '이 브라우저에서 3D 화면을 사용할 수 없어요. WebGL2를 지원하는 브라우저에서 하드웨어 가속을 켜고 다시 열어주세요.' :
        '게임 준비 중 문제가 생겼어요. 도움말의 실행 정보를 확인한 뒤 새로고침해 주세요.';
    bootstrapStage = 'failed';
    showBootStatus(message, true);
    throw error;
  }
}

export { bootTakraw };
