// 발차기 소리의 공통 층. 타이밍 등급이 높을수록 같은 층 위에 높은 음을 더한다.
const KICK_LAYERS = [
  { kind: 'tone', hz: 175, end: 54, ms: 95, gain: 0.8, type: 'sine' },
  { kind: 'noise', hz: 1800, ms: 45, gain: 0.24 },
];

const TAKRAW_RUNTIME = Object.freeze({
  input: { size: 6, axisScale: 127 },
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
        layers: [
          { kind: 'tone', hz: 620, end: 620, ms: 95, gain: 0.3, type: 'sine' },
          { kind: 'tone', hz: 830, end: 830, ms: 160, gain: 0.26, type: 'sine', delay: 95 },
        ],
      },
    },
  },
});

export { TAKRAW_RUNTIME };
