import { winningSpikeScore } from './score-motion.js';
import { POSE_KEYS } from './highlight-shadow.js';

const STRIDE = POSE_KEYS.length;

/** 한 틱의 입력을 워커로 보낼 값으로 복사한다. 세션이 같은 배열을 다시 쓸 수 있어 값만 남긴다. */
function copyFrame(frame) {
  return { tick: frame.tick, tickRate: frame.tickRate, inputs: frame.inputs.map(entry => ({
    playerId: entry.playerId, input: entry.input.slice(), commands: (entry.commands || []).map(command => ({ ...command, payload: command.payload?.slice?.() ?? command.payload })),
  })) };
}

/**
 * 득점 리플레이. 원본은 경기 시작 상태와 매 틱 입력이고, 워커의 그림자 경기가 그 기록으로 같은 경기를 다시 계산한다.
 * 그림자 경기는 앞으로 생길 어떤 재생 구간보다도 앞선 틱(safeTick)까지만 미리 따라간다. 재생 구간은 끝에서 leadTouches번째 터치 앞이거나
 * 득점 maxSeconds초 전이므로 지금까지의 터치와 현재 틱만으로 그 경계를 안다. 그래서 득점이 나면 바로 그 장면부터 계산해 보내 준다.
 * 메인 스레드는 명장면 판정과 받은 포즈의 재생만 한다. 실제 경기 상태·저장 형식은 건드리지 않는다.
 */
class TakrawHighlight {
  /** urls: 워커가 불러올 Rapier·코덱 모듈 주소(import map으로 푼 값). */
  constructor(settings, urls) {
    this.settings = settings;
    this.urls = urls;
    this.worker = null;
    this.failed = false;
    this.playId = 0;
    this.reset();
  }

  /** 기록을 버린다. 워커의 그림자 경기도 다음 기준점까지 멈춘다. */
  reset() {
    this.anchored = false;
    this.touches = [];
    this.cause = null;
    this.pending = null;
    this.clip = null;
    this.recorded = -Infinity; // 워커로 보낸 마지막 입력의 틱
    this.worker?.postMessage({ type: 'reset' });
  }

  get playing() { return !!this.clip; }

  /** 경기 시작 상태(실제 경기 save의 바이트)를 기준점으로 삼는다. 워커는 처음 한 번 만든다. 워커를 못 쓰는 환경이면 리플레이 없이 진행한다. */
  anchor(bytes) {
    this.reset();
    if (this.failed) return;
    if (!this.worker) {
      try {
        this.worker = new Worker(new URL('./highlight-worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = event => this.receive(event.data);
        this.worker.onerror = () => this.fail();
        this.worker.postMessage({ type: 'init', ...this.urls });
      } catch { this.fail(); return; }
    }
    this.worker.postMessage({ type: 'anchor', bytes }, [bytes.buffer]);
    this.anchored = true;
  }

  fail() {
    this.failed = true;
    this.worker?.terminate();
    this.worker = null;
    this.anchored = false;
    this.clip = null;
  }

  /** 실제 경기 한 스텝의 입력과 결과 사건을 기록한다. 입력은 워커로 넘기고, 그림자 경기가 따라가도 되는 틱을 함께 알린다. */
  record(frame, view) {
    if (!this.anchored) return;
    for (const event of view.events) {
      if (event.type === 'serve') this.touches = [];
      else if (event.type === 'touch') this.touches.push({ tick: event.tick, team: event.team, spike: !!event.spike });
      else if (event.type === 'point' && !this.pending) this.pending = this.judge(event, this.cause);
      if (event.type !== 'point') this.cause = event;
    }
    this.recorded = frame.tick;
    this.worker.postMessage({ type: 'input', frame: copyFrame(frame), target: this.safeTick(frame.tick) });
  }

  /** 명장면이면 재생할 구간을 돌려준다. 스파이크 결정타이거나 긴 랠리일 때만 고른다. */
  judge(point, cause) {
    const s = this.settings, last = this.touches[this.touches.length - 1];
    const spike = winningSpikeScore(point, cause, last);
    if (!spike && this.touches.length < s.longRallyTouches) return null;
    const lead = this.touches[Math.max(0, this.touches.length - s.leadTouches)];
    const from = Math.max((lead?.tick ?? point.tick) - s.leadTicks, point.tick - s.maxSeconds * s.tickRate);
    return { from, to: point.tick + s.tailTicks, slowAt: spike ? last.tick : null, reason: spike ? 'spike' : 'rally' };
  }

  /** 다음 득점이 명장면이 되더라도 재생 구간이 이 틱보다 앞서 시작하지 않는다. 그림자 경기는 여기까지만 미리 계산한다. */
  safeTick(liveTick) {
    const s = this.settings;
    if (this.pending) return this.pending.from - 1;
    const lead = this.touches.length >= s.leadTouches ? this.touches[this.touches.length - s.leadTouches].tick - s.leadTicks : -Infinity;
    return Math.max(liveTick - s.maxSeconds * s.tickRate, lead) - 1;
  }

  /** 꼬리 구간의 입력까지 워커로 보냈으면 재생을 시작한다. 포즈는 워커가 계산하는 대로 도착하고, 첫 묶음이 오기 전에는 시계를 멈춰 둔다. */
  begin() {
    const range = this.pending;
    if (!range || this.recorded < range.to || !this.worker) return false;
    this.pending = null;
    const id = ++this.playId;
    this.clip = { ...range, id, at: range.from, ids: null, ticks: [], data: [], done: false, startedAt: performance.now(), firstAt: null, receivedAt: performance.now() };
    this.worker.postMessage({ type: 'play', play: { id, from: range.from, to: range.to } });
    return true;
  }

  receive(message) {
    if (message.type === 'error') { console.error('[takraw highlight]', message.message); this.fail(); return; }
    const clip = this.clip;
    if (!clip || message.id !== clip.id) return;
    if (message.type === 'missing') { this.clip = null; return; }
    if (message.type !== 'poses') return;
    clip.ids = message.ids;
    if (clip.firstAt === null) { clip.firstAt = performance.now(); this.lastLatencyMs = clip.firstAt - clip.startedAt; this.played = (this.played || 0) + 1; }
    clip.ticks.push(...message.ticks);
    clip.data.push(...message.data);
    clip.done = message.done;
    clip.receivedAt = performance.now();
  }

  stop() { this.clip = null; }

  /** 재생 시각을 dt(초)만큼 진행한다. 스파이크 앞뒤는 느리게 흐른다. 아직 계산되지 않은 틱은 기다린다. 끝나면 false.
   * 워커가 stallMs 동안 새 장면을 보내지 않으면 경기를 붙잡아 두지 않고 끝낸다. */
  advance(dt) {
    const clip = this.clip, s = this.settings;
    if (!clip) return false;
    const stalled = !clip.done && performance.now() - clip.receivedAt > s.stallMs;
    if (stalled) { this.clip = null; return false; }
    if (clip.ticks.length < 2) return true;
    const slow = clip.slowAt !== null && clip.at >= clip.slowAt - s.slowBefore && clip.at <= clip.slowAt + s.slowAfter;
    const last = clip.ticks[clip.ticks.length - 1].tick;
    clip.at = Math.min(last, Math.max(clip.at, clip.ticks[0].tick) + dt * s.tickRate * (slow ? s.slowRate : 1));
    if (!(clip.done && clip.at >= last)) return true;
    this.clip = null;
    return false;
  }

  /** 현재 재생 시각의 포즈(id → pose)와 화면용 상태. 틱 사이는 선형 보간, 회전은 부호를 맞춰 보간한다. 아직 그릴 것이 없으면 null. */
  frame() {
    const clip = this.clip;
    if (!clip || clip.ticks.length < 2) return null;
    let index = 0;
    while (index < clip.ticks.length - 2 && clip.ticks[index + 1].tick <= clip.at) index++;
    // 이미 지난 묶음은 버려 재생이 길어도 탐색이 짧다.
    if (index > 8) { clip.ticks.splice(0, index); clip.data.splice(0, index); index = 0; }
    const a = clip.ticks[index], b = clip.ticks[index + 1], left = clip.data[index], right = clip.data[index + 1];
    const t = Math.max(0, Math.min(1, (clip.at - a.tick) / Math.max(1, b.tick - a.tick)));
    const poses = new Map();
    clip.ids.forEach((id, i) => {
      const o = i * STRIDE, pose = {};
      let dot = 0;
      for (let k = 3; k < 7; k++) dot += left[o + k] * right[o + k];
      const sign = dot < 0 ? -1 : 1;
      POSE_KEYS.forEach((key, k) => {
        const end = (k >= 3 && k < 7 ? sign : 1) * right[o + k];
        pose[key] = left[o + k] + (end - left[o + k]) * t;
      });
      poses.set(id, pose);
    });
    return { poses, state: { phase: 'replay', selected: b.selected, ballSpeed: b.ballSpeed, tick: b.tick }, reason: clip.reason };
  }

  dispose() { this.worker?.terminate(); this.worker = null; this.clip = null; }
}

export { TakrawHighlight };
