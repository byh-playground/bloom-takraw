// 발차기 소리의 공통 층. 타이밍 등급이 높을수록 같은 층 위에 높은 음을 더한다.
const KICK_LAYERS = [
  { kind: 'tone', hz: 175, end: 54, ms: 95, gain: 0.8, type: 'sine' },
  { kind: 'noise', hz: 1800, ms: 45, gain: 0.24 },
];

// 기존 득점 신호에 짧은 합성 함성을 합친다. 별도 중복 재생은 하지 않는다.
const POINT_LAYERS = [
  { kind: 'tone', hz: 620, end: 620, ms: 95, gain: .3, type: 'sine' },
  { kind: 'tone', hz: 830, end: 830, ms: 160, gain: .26, type: 'sine', delay: 95 },
  { kind: 'noise', hz: 1200, ms: 380, gain: .18, delay: 80 },
  { kind: 'tone', hz: 190, end: 260, ms: 320, gain: .06, type: 'triangle', delay: 90 },
  { kind: 'tone', hz: 285, end: 365, ms: 340, gain: .05, type: 'triangle', delay: 105 },
];

const TAKRAW_RUNTIME = Object.freeze({
  input: { size: 6, axisScale: 127 },
  // 관전: 같은 시드는 같은 AI 대 AI 경기를 만든다. showcaseSeed는 소개영상의 명경기다.
  watch: {
    param: 'watch', showcaseSeed: 36, maxSeed: 0xffffffff, randomMax: 9999,
    // 관전은 첫 득점까지의 한 판만 보여준다. 득점 뒤 이만큼 결과를 보여주고 같은 시드를 처음부터 다시 시작한다.
    loopHoldMs: 2500,
    // 일괄 탐색으로 고른 명경기. 낙하 여유 시간 = 스파이크를 받아낼 때 공이 지면에 닿기까지 남은 시간.
    featured: [
      { seed: 36, label: '가장 아슬아슬한 받아내기 · 0.05초' },
      { seed: 27, label: '받아내기 5번 · 11터치' },
    ],
  },
  clock: { baseHz: 120, inputHz: 60, renderHz: 60, maxCatchupSteps: 4 },
  network: {
    timeout: 45000,
    peerTimeout: 25000,
    handshakeTimeout: 45000,
    // The three public Nostr relays are signaling-only; gameplay stays on WebRTC.
    relays: ['wss://relay.primal.net', 'wss://relay.damus.io', 'wss://nos.lol'],
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ],
    transitionTimeout: 20000,
    reconnectGrace: 90000,
    rollbackWindow: 24,
    historySize: 128,
    maxSnapshotBytes: 2 * 1024 * 1024,
    maxHistoryBytes: 64 * 1024 * 1024,
    maxReplayBytes: 8 * 1024 * 1024,
  },
  // badge: 접촉 타이밍 등급 표시가 남는 시간(ms)
  feedback: { duration: 430, badge: 900, retentionTicks: 180, soundReferenceSpeed: 14 },
  hud: { interval: 80 },
  audio: {
    storageKey: 'bloom-takraw-audio',
    volume: 0.68,
    headroom: 0.24,
    maxVoices: 8,
    categories: {
      impact: { volume: 0.9, max: 5, gapMs: 30, priority: 2 },
      signal: { volume: 0.65, max: 2, gapMs: 100, priority: 5 },
    },
    sounds: {
      kick: { category: 'impact', priority: 3, layers: KICK_LAYERS },
      kickGood: {
        category: 'impact',
        priority: 3,
        layers: [...KICK_LAYERS, { kind: 'tone', hz: 880, end: 880, ms: 70, gain: 0.16, type: 'sine', delay: 20 }],
      },
      kickPerfect: {
        category: 'impact',
        priority: 3,
        layers: [
          ...KICK_LAYERS,
          { kind: 'tone', hz: 988, end: 1319, ms: 90, gain: 0.2, type: 'sine', delay: 15 },
          { kind: 'tone', hz: 1760, end: 1760, ms: 140, gain: 0.12, type: 'sine', delay: 70 },
        ],
      },
      // 스파이크: 킥 층 위에 낮은 쿵(무게)과 높은 갈라짐(날카로움), 짧은 상승음(성공 표식)을 얹는다.
      kickSpike: {
        category: 'impact',
        priority: 4,
        layers: [
          ...KICK_LAYERS,
          { kind: 'tone', hz: 140, end: 55, ms: 160, gain: 0.34, type: 'sine' },
          { kind: 'noise', hz: 3200, ms: 70, gain: 0.2 },
          { kind: 'tone', hz: 1175, end: 1760, ms: 110, gain: 0.16, type: 'sine', delay: 25 },
        ],
      },
      land: {
        category: 'impact',
        priority: 1,
        layers: [
          { kind: 'tone', hz: 100, end: 42, ms: 70, gain: 0.3, type: 'sine' },
          { kind: 'noise', hz: 700, ms: 55, gain: 0.13 },
        ],
      },
      net: {
        category: 'impact',
        priority: 2,
        layers: [{ kind: 'noise', hz: 2200, ms: 80, gain: 0.24 }],
      },
      serve: {
        category: 'signal',
        priority: 4,
        layers: [
          { kind: 'tone', hz: 520, end: 650, ms: 105, gain: 0.25, type: 'sine' },
        ],
      },
      point: {
        category: 'signal',
        priority: 5,
        layers: POINT_LAYERS,
      },
      matchPoint: {
        category: 'signal',
        priority: 5,
        layers: [
          ...POINT_LAYERS,
          { kind: 'tone', hz: 988, end: 1175, ms: 120, gain: .2, type: 'sine', delay: 260 },
          { kind: 'tone', hz: 1319, end: 1319, ms: 150, gain: .16, type: 'sine', delay: 390 },
        ],
      },
    },
  },
});

export { TAKRAW_RUNTIME };
