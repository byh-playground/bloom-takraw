// 발차기 한 번은 네 층이다. 낮은 쿵(thump)은 무게를, 중음 몸통(body, 삼각파)은 작은 스피커에서도 들리는 울림을,
// 슬랩(slap)과 클릭(click)은 발이 공에 닿는 순간의 "탁"을 맡는다. 공 속도가 세질수록 모든 층이 커지고 길어지고 밝아진다.
// (이전 소리는 사실상 120~500Hz 사인파 하나라 2kHz 위 에너지가 0이었고, 단계별 음량 차이도 2dB뿐이었다.)
const KICK_LEVELS = {
  Soft: [
    { kind: 'tone', hz: 150, end: 70, ms: 80, gain: 0.3, type: 'sine' },
    { kind: 'tone', hz: 240, end: 130, ms: 50, gain: 0.3, type: 'triangle' },
    { kind: 'noise', hz: 2200, ms: 28, gain: 0.12 },
    { kind: 'noise', hz: 6000, ms: 7, gain: 0.25 },
  ],
  Medium: [
    { kind: 'tone', hz: 170, end: 62, ms: 95, gain: 0.45, type: 'sine' },
    { kind: 'tone', hz: 280, end: 130, ms: 60, gain: 0.45, type: 'triangle' },
    { kind: 'noise', hz: 2800, ms: 38, gain: 0.2 },
    { kind: 'noise', hz: 7000, ms: 8, gain: 0.45 },
  ],
  Hard: [
    { kind: 'tone', hz: 200, end: 52, ms: 130, gain: 0.62, type: 'sine' },
    { kind: 'tone', hz: 330, end: 140, ms: 75, gain: 0.6, type: 'triangle' },
    { kind: 'noise', hz: 3400, ms: 50, gain: 0.3 },
    { kind: 'noise', hz: 8000, ms: 10, gain: 0.7 },
    { kind: 'tone', hz: 1100, end: 520, ms: 35, gain: 0.14, type: 'triangle' },
  ],
};

// 타이밍 등급이 높을수록 같은 단계 위에 높은 음을 더한다.
const KICK_GRADES = {
  '': [],
  Good: [{ kind: 'tone', hz: 880, end: 880, ms: 70, gain: 0.22, type: 'sine', delay: 20 }],
  Perfect: [
    { kind: 'tone', hz: 988, end: 1319, ms: 90, gain: 0.28, type: 'sine', delay: 15 },
    { kind: 'tone', hz: 1760, end: 1760, ms: 140, gain: 0.18, type: 'sine', delay: 70 },
  ],
};

// kickSoft·kickSoftGood·kickSoftPerfect … kickHardPerfect(9개). 단계×등급 조합은 src/presentation/sound.js가 고른다.
const KICK_SOUNDS = Object.fromEntries(Object.entries(KICK_LEVELS).flatMap(([level, layers]) =>
  Object.entries(KICK_GRADES).map(([grade, extra]) => [`kick${level}${grade}`, { category: 'impact', priority: 3, layers: [...layers, ...extra] }])));

// 득점 신호: 반짝이는 두 음 + 짧은 합성 함성. 가장 보상적인 순간이라 타격보다 크게 둔다.
const POINT_LAYERS = [
  { kind: 'tone', hz: 620, end: 620, ms: 95, gain: 0.85, type: 'sine' },
  { kind: 'tone', hz: 830, end: 830, ms: 160, gain: 0.75, type: 'sine', delay: 95 },
  { kind: 'noise', hz: 2400, ms: 380, gain: 0.5, delay: 80 },
  { kind: 'tone', hz: 190, end: 260, ms: 320, gain: 0.2, type: 'triangle', delay: 90 },
  { kind: 'tone', hz: 285, end: 365, ms: 340, gain: 0.17, type: 'triangle', delay: 105 },
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
      { seed: 1013, label: '받아내기 4번 · 12터치' },
      { seed: 19, label: '받아내기 4번 · 13터치' },
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
  // soundPanSpread: 코트 끝에서의 좌우 치우침(0..1), soundDetuneCents: 같은 소리가 반복돼도 단조롭지 않게 매번 ±이 만큼 음높이를 흔든다.
  // soundDistanceDrop: 상대 코트 끝에서의 음량 감소 비율(0..1). 가까운 소리는 크고 먼 소리는 작아 깊이감이 난다.
  feedback: {
    duration: 430, badge: 900, retentionTicks: 180, soundReferenceSpeed: 14,
    soundPanSpread: 0.7, soundDetuneCents: 150, soundDistanceDrop: 0.35,
  },
  // 관중 환경음: 경기 중 계속 깔리고 득점·스파이크에 순간적으로 커진다. 일시정지·소개영상에서는 낮춘다.
  crowd: {
    level: 1, pausedLevel: 0.25, fadeMs: 800, stopFadeMs: 500, levelRampMs: 300,
    swell: {
      point: { boost: 1, attackMs: 120, releaseMs: 1100 },
      matchPoint: { boost: 1.6, attackMs: 150, releaseMs: 1600 },
      spike: { boost: 0.3, attackMs: 40, releaseMs: 500 },
    },
  },
  hud: { interval: 80 },
  audio: {
    storageKey: 'bloom-takraw-audio',
    volume: 0.68,
    // 이전 값(threshold -18, ratio 6)은 소프트부터 스파이크까지의 음량 차이를 6dB에서 2dB로 눌렀다. 느슨하게 풀어 세기가 들리게 한다.
    headroom: 0.4,
    compressor: { threshold: -10, knee: 8, ratio: 3, attackMs: 4, releaseMs: 150 },
    maxVoices: 8,
    categories: {
      impact: { volume: 0.9, max: 5, gapMs: 30, priority: 2 },
      signal: { volume: 0.8, max: 2, gapMs: 100, priority: 5 },
      ambience: { volume: 0.8, max: 1, gapMs: 0, priority: 0 },
    },
    // 환경음 노이즈 루프가 반복으로 들리지 않게 길게 둔다(4초).
    synthesis: { noiseMs: 4000 },
    sounds: {
      ...KICK_SOUNDS,
      // 발이 아닌 몸(정강이·허벅지·골반·몸통·머리)에 맞은 소리: 둔탁하고 밝은 "탁"이 없다. 낮은 쿵만 있으면 작은 스피커에서 안 들려 중음 몸통을 둔다.
      kickBody: {
        category: 'impact',
        priority: 3,
        layers: [
          { kind: 'tone', hz: 150, end: 90, ms: 85, gain: 0.3, type: 'sine' },
          { kind: 'tone', hz: 210, end: 110, ms: 60, gain: 0.45, type: 'triangle' },
          { kind: 'noise', hz: 900, ms: 55, gain: 0.3 },
        ],
      },
      // 스파이크: 가장 센 발차기 층 위에 깊고 긴 낮은 꼬리(무게), 넓게 퍼지는 고음 갈라짐(날카로움), 짧은 상승음(성공 표식)을 얹는다.
      kickSpike: {
        category: 'impact',
        priority: 4,
        layers: [
          ...KICK_LEVELS.Hard,
          { kind: 'tone', hz: 130, end: 50, ms: 200, gain: 0.45, type: 'sine' },
          { kind: 'tone', hz: 90, end: 36, ms: 320, gain: 0.3, type: 'sine', delay: 30 },
          { kind: 'noise', hz: 3600, ms: 80, gain: 0.35 },
          { kind: 'noise', hz: 6500, ms: 150, gain: 0.18, delay: 20 },
          { kind: 'tone', hz: 1175, end: 1760, ms: 110, gain: 0.22, type: 'sine', delay: 25 },
        ],
      },
      land: {
        category: 'impact',
        priority: 1,
        layers: [
          { kind: 'tone', hz: 100, end: 45, ms: 70, gain: 0.18, type: 'sine' },
          { kind: 'tone', hz: 170, end: 90, ms: 50, gain: 0.45, type: 'triangle' },
          { kind: 'noise', hz: 800, ms: 50, gain: 0.24 },
        ],
      },
      net: {
        category: 'impact',
        priority: 2,
        layers: [
          { kind: 'noise', hz: 2200, ms: 80, gain: 0.38 },
          { kind: 'noise', hz: 5000, ms: 30, gain: 0.32 },
        ],
      },
      serve: {
        category: 'signal',
        priority: 4,
        layers: [
          { kind: 'tone', hz: 520, end: 650, ms: 105, gain: 0.45, type: 'sine' },
          { kind: 'tone', hz: 1040, end: 1300, ms: 80, gain: 0.12, type: 'sine', delay: 10 },
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
          { kind: 'tone', hz: 988, end: 1175, ms: 120, gain: 0.6, type: 'sine', delay: 260 },
          { kind: 'tone', hz: 1319, end: 1319, ms: 150, gain: 0.5, type: 'sine', delay: 390 },
        ],
      },
    },
    // 관중 환경음: 바람이 아니라 웅성거림이 되도록 밴드패스 여섯 겹을 서로 다른 지점에서 읽고(offsetMs) 좌우에 펼친다(pan).
    // 느린 흔들림(0.2~0.3Hz)은 군중의 크기 변화, 음절 흔들림(4~8Hz)은 말소리의 결이다. 아래쪽 두 겹은 낮은 웅성거림, 가운데 두 겹은 말소리 대역,
    // 위쪽 두 겹은 박수·치찰 결이다. 1Hz 미만의 흔들림만 있으면 파도·바람 소리가 된다.
    beds: {
      crowd: {
        category: 'ambience',
        layers: [
          { kind: 'noise', type: 'bandpass', hz: 420, q: 0.8, gain: 0.44, pan: -0.65, offsetMs: 0, lfos: [{ hz: 0.19, depth: 0.2 }, { hz: 3.7, depth: 0.5 }] },
          { kind: 'noise', type: 'bandpass', hz: 480, q: 0.8, gain: 0.44, pan: 0.65, offsetMs: 1900, lfos: [{ hz: 0.27, depth: 0.2 }, { hz: 4.6, depth: 0.5 }] },
          { kind: 'noise', type: 'bandpass', hz: 1150, q: 1.1, gain: 0.19, pan: -0.35, offsetMs: 900, lfos: [{ hz: 0.33, depth: 0.2 }, { hz: 5.3, depth: 0.55 }] },
          { kind: 'noise', type: 'bandpass', hz: 1500, q: 1.1, gain: 0.19, pan: 0.35, offsetMs: 2700, lfos: [{ hz: 0.23, depth: 0.2 }, { hz: 6.4, depth: 0.55 }] },
          { kind: 'noise', type: 'bandpass', hz: 2700, q: 1.3, gain: 0.045, pan: -0.8, offsetMs: 3300, lfos: [{ hz: 7.3, depth: 0.6 }] },
          { kind: 'noise', type: 'bandpass', hz: 3100, q: 1.3, gain: 0.045, pan: 0.8, offsetMs: 1300, lfos: [{ hz: 8.1, depth: 0.6 }] },
        ],
      },
    },
  },
});

export { TAKRAW_RUNTIME };
