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
  // 배경 음악: 첫 제스처 뒤로 홈에서도 경기 중에도 작게 깔린다. 곡은 효과음 아래에 머물도록 작게 두고(level, 홈은 효과음이 없어 조금 크게 homeLevel),
  // 타격 순간에는 잠깐 더 낮춰(duck) 타격음이 곡의 멜로디(200~400Hz)에 묻히지 않게 한다. 득점 소리는 더 깊고 길게 비운다.
  // 곡은 CC0 "Head in the Sand"(assets/audio/CREDITS.md). 불러오지 못하면 음악만 없고 게임은 그대로 돌아간다.
  bgm: {
    url: new URL('../../assets/audio/head-in-the-sand.ogg', import.meta.url).href,
    level: 0.7, homeLevel: 0.9, pausedLevel: 0.35, fadeMs: 1500, stopFadeMs: 600, levelRampMs: 300,
    duck: {
      touch: { depth: 0.55, holdMs: 90, releaseMs: 260 },
      point: { depth: 0.35, holdMs: 500, releaseMs: 700 },
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
      music: { volume: 1, max: 1, gapMs: 0, priority: 0 },
    },
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
    // 음원 베드: 게임이 읽어 디코드한 곡을 setBuffer('bgm')로 등록하면 루프로 깔린다.
    beds: {
      // 곡의 0~3초와 20~22초(루프 중간)는 본체와 달리 노이즈 채널 퍼커션(무게중심 1.4kHz, 2kHz 이상 25%)이다. 본체는 2kHz 이상이 0~3%다.
      // 컴프레서로 이 조용한 구간이 올라오면 거칠게(찢어지게) 들려, 1.6kHz 로우패스로 노이즈의 고음만 약 10dB 덜어 낸다(본체 크기는 그대로).
      // 곡 안의 크기 편차(3초 구간 10.8dB)가 커서 도입부는 묻히고 하이라이트가 튀었다. 레이어 컴프레서로 편차를 2.5dB로 줄인다.
      // 컴프레서의 자동 보정으로 전체가 약 5dB 커지므로 gain을 0.55로 낮춰 하이라이트 크기는 전과 같게 두고 도입부만 올린다(게임 레벨 0.7에서 평균 약 -36dBFS).
      bgm: {
        category: 'music',
        layers: [{ kind: 'buffer', bufferId: 'bgm', gain: 0.55, type: 'lowpass', hz: 1600, q: 0.7, compressor: { threshold: -50, ratio: 10, attackMs: 100, releaseMs: 900 } }],
      },
    },
  },
});

export { TAKRAW_RUNTIME };
