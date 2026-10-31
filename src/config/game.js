const TAKRAW_VERSION = '0.14.0';
// 게임 이름의 단일 출처. 화면·진단·학교 현수막은 이 값을 쓰고, 정적 파일(index.html·README·AGENTS·package.json)은 scripts/check.cjs가 일치를 검사한다.
const TAKRAW_GAME_NAME = '발 배구';
const TAKRAW_PRODUCT_NAME = `블룸 ${TAKRAW_GAME_NAME}`;

/**
 * 능력치 → 경기 효과의 단일 공식(경기와 팀 관리 화면이 같이 읽는다).
 * base~max는 직선으로 0~1 비율이고, max를 넘으면 overflow 기울기로 log2(v/max)에 비례해 완만히 늘어난다. 효과는 maxEffect를 넘지 않는다.
 */
function takrawAthleteEffects(stats = {}, definition = TAKRAW_CONFIG.athletes) {
  return Object.fromEntries(Object.entries(definition.bonus).map(([key, maximum]) => {
    const value = stats[key] ?? definition.base;
    const ratio = value > definition.max ? 1 + definition.overflow * Math.log2(value / definition.max)
      : Math.max(0, (value - definition.base) / (definition.max - definition.base));
    return [key, Math.min(definition.maxEffect, ratio * maximum)];
  }));
}

const TAKRAW_CONFIG = Object.freeze({
  product: 'BLOOM TAKRAW',
  version: TAKRAW_VERSION,
  status: 'Candidate',
  simulation: { tickRate: 60, substeps: 2, aiRate: 15 },
  network: { namespace: 'bloom-takraw', seed: 7 },
  court: { halfLength: 6.7, halfWidth: 3.05, netHeight: 1.52 },
  // Team 0 coordinates; team 1 mirrors X/Z: receive, central set, front attack.
  formation: {
    receiver: { x: -4.7, z: 0.7 },
    setter: { x: -3.2, z: -1.25 },
    attacker: { x: -2.0, z: 1.3 },
  },
  // 출시 전 임시 경기 길이: 7점, 6:6부터 기존 듀스 방식으로 9점 상한, 단판.
  rules: { contacts: 3, points: 7, deuce: 6, cap: 9, sets: 1, ready: 1.25, point: 2 },
  // 접촉 타이밍 등급 창(초). 오차 크기가 perfect 이하면 perfect, good 이하면 good, 그 외 normal.
  // 헤드리스 실측(docs/verification/timing-impact.md)에서 발이 공에 닿은 입력 오차는 최대 약 0.06초였다.
  // 입력 틱 1.2개(0.02초) 이내를 perfect, 2.4개(0.04초) 이내를 good으로 둔다. 사람 플레이로 재보정 대상이다.
  // maxAge: 입력 기록이 접촉 판정에 유효한 최대 경과 시간(초).
  timing: { windows: { perfect: 0.02, good: 0.04 }, maxAge: 1.2 },
  // base: 기본 능력치, max: 효과 비율 1이 되는 능력치(이 위는 overflow × log2(v/max)만큼 더 늘어남), maxEffect: 효과 값의 상한(수비는 1 - 효과라 1 미만이어야 한다).
  athletes: { base: 50, max: 100, overflow: 0.5, maxEffect: 0.95, bonus: {
    mobility: 0.10, jump: 0.02, power: 0.08, flexibility: 0.10,
    setting: 0.04, defense: 0.20, recovery: 0.15,
  } },
  physics: { groundToss: { receiveApex: 2.4, attackApex: 4.2 },
    // 주발: 기본으로 오른발로 차고, 공이 주발 반대쪽으로 groundOffset(지상, m) 넘거나 반대 발이 airMargin(공중, m) 넘게 가까울 때만 왼발.
    dominantFoot: { side: 'R', groundOffset: 0.25, airMargin: 0.05 } },
  training: { ready: 1.1, retry: 2.2, timeout: 7,
    feed: { height: 2.4, rise: 1.5, offset: 0.8, lateral: 0.10 },
    guide: { preholdLead: 0.34, kickWindow: 0.08 },
    // 속공 토스(simulation/game.js feedQuick): 세터 옆 offset(m)·높이 height(m)에서 꼭짓점 apex(m)로 올려 공격수 앞 낙하 타점에 닿게 한다.
    // 꼭짓점은 낮은 공격 판정(ai.toss.attack.apexMargin 안)에 들어오도록 정했다.
    quick: { offset: 0.5, height: 1.0, apex: 3.5 },
  },
  ai: { receiveHeight: 0.75, kickHold: 0.34, jumpHold: 0.25,
    // 선수 성향의 범위. 경기 시드·선수·랠리 번호로 값이 정해져 경기마다 상황이 달라진다(simulation/ai-brain.js).
    // reaction: 동료가 받기 시작한 뒤 보조 위치로 움직이기까지의 반응 시간(초), clearance: 공 궤적과 떨어지는 간격(m),
    // depth·lateral: 대기 자리의 앞뒤·옆 흔들림(±m).
    temperament: { reaction: [0.02, 0.24], clearance: [1.0, 1.5], depth: 0.35, lateral: 0.30 },
    serve: {
      // 사람이 서브할 때 공격수가 서는 자리(자기 코트 방향 좌표, m). 엔드라인(6.7 m) 뒤.
      spot: { x: -7.2, z: -0.3 },
      // 서브의 공 던지기(사람·AI 같은 규칙, AI는 판마다 다른 모으는 시간을 쓴다)(발차기 버튼. 누르는 동안 공이 lift(m)까지 올라가 높이가 보인다)(simulation/game.js updateServeToss): 공은 서버 앞 offset(m)·높이 height(m) 손 자리에 있다가,
      // 던지기를 떼면 위로 던져진다(앞뒤·좌우 속도는 던지는 순간 서버의 이동 속도 그대로). 꼭짓점은 짧게 누르면 minApex(m), fullCharge(초) 이상 누르면 maxApex(m). jumpApex(m) 이상으로 던지면 AI는 점프서브를 한다. maxHold(초) 안에 안 던지면 자동으로 던진다.
      groundAim: { x: 4.2 },
      toss: { offset: 0.65, height: 1.0, lift: 0.9, minApex: 1.6, maxApex: 4.4, jumpApex: 3.2, fullCharge: 0.8, maxHold: 12 } },
    // 사람이 자리를 비우면 AI 동료가 비운 구역을 메운다(ai-formation.js). slow: 이 시간(초)을 넘겨 닿는 구역만 벌점, reaction: 출발 반응(초),
    // reachRadius: 선수가 이동 없이 닿는 반경(m), step·reach: 후보 자리 간격(m)과 단계 수, deviationWeight: 기본 자리에서 멀어지는 벌점, minGain: 사람이 기본 자리에 있을 때보다 벌점이 이만큼 나빠지고, 옮겨서 이만큼 좋아질 때만 옮김, bounds: 역할별 설 수 있는 x 범위(자기 코트 방향 좌표).
    fill: { enabled: true, gridStep: 0.5, slow: 0.5, reaction: 0.1, reachRadius: 0.3, step: 0.75, reach: 2, deviationWeight: 0.012, minGain: 0.15,
      bounds: { receiver: { x: [-5.7, -3.6] }, setter: { x: [-4.5, -2.2] }, attacker: { x: [-3.5, -1.0] } } },
    receive: { claimLead: 0.75, commitLead: 0.10, claimSlack: 0.25, coverDistance: 1.25, hysteresis: 0.16, braking: 0.18,
      // 사람이 발차기를 누른 채 받을 공을 향해 달릴 때, 받는 자리(stance)에 멈추도록 속도만 줄여 준다(방향은 그대로).
      // window: 착지 몇 초 전부터, brake: 남은 거리(m)당 허용 입력 크기, cone: 입력이 자리 방향과 이룰 최소 내적(이보다 벗어나면 돕지 않는다).
      assist: { window: 0.9, brake: 2.2, cone: 0.35, minInput: 0.25 } },
    toss: { receiveOffset: 0.8, incomingOffset: 0.8, airContactHeight: 3.6,
      // 동료에게 보내는 지면 토스의 목표 보정(m): dx는 동료보다 네트 쪽, dz는 옆쪽으로 둔다.
      aim: { dx: 0.70, dz: 0 },
      // 세트 목표점이 공격수 기준점 둘레의 직사각형 안에서 흩어지는 반 길이(m): 능력별 [토스 능력 기본값(50), 최대값(100)]. 앞뒤(x)는 좁고 좌우(z)는 넓다(simulation/game.js tossSpread).
      spread: { half: { x: [0.3, 0.1], z: [1.0, 0.25] } },
      ground: { lead: 0.30, followThrough: 0.15, window: 0.45 },
      lowAttack: { minHeight: 2.65, maxHeight: 3.0, contactLead: 0.64, kickDelay: 0.16 },
      attack: { offset: 0.65, lateral: 0.10, positionRadius: 0.55, minLead: 0.16, maxLead: 0.65,
        checkLead: 0.60, kickDelay: 0.08, minHeight: 3.1, maxHeight: 3.7,
        preparation: { brakeLead: 0.30, driftRadius: 0.35, apexMargin: 0.30 } },
    },
  },
  visual: {
    receiveGuide: { groundHeight: 0.07, contactRadius: 0.10, contactMinPixels: 16, actorWidth: 0.38,
      colors: { ai: 0x9ad3e5, human: 0xd8f2ae }, opacity: { active: 0.8, waiting: 0.4 } },
    attackGuide: { maxLead: 1.6, groundHeight: 0.065, contactRadius: 0.10, contactMinPixels: 16,
      foot: { length: 0.28, width: 0.10, spacing: 0.22 },
      colors: { approach: 0xc0e2d8, ready: 0xfff0ba }, opacity: { approach: 0.50, ready: 0.94 } },
    camera: { fov: 48, distance: 9.5, elevation: 4.6, focusHeight: 1.6, focusAhead: 2.2,
      follow: 7, ballWeight: 0.28, maxLateral: 2.3, maxDistance: 20, frameMargin: 0.78,
      topInset: 120, narrowTopInset: 188, narrowWidth: 700, near: 0.1, far: 100,
      orbit: { sensitivity: 0.006, minPitch: 0.14, maxPitch: 1.13 } },
    // 접촉 효과의 등급별 표시 값(타격감 가이드 §3·§6: 국소 hitflash·squash 먼저, 카메라 흔들림은 가장 센 사건 하나만). 등급 이름은 timing.windows와 normal이다.
    // ringScale: 링 최대 배율, dots: 입자 수, outerRing: 바깥 링 추가, hold: 링·입자를 첫 모습으로 유지하는 시간(초),
    // shake: 카메라 진동(CSS px, 초), trail: 공 궤적 강조 색과 지속 시간(초), streaks: 속도선 수, flash: 접점 별 섬광 크기(m, 0이면 없음),
    // fovPunch: 화면 확대(시야각 비율), squash: 공이 맞은 방향으로 눌리는 비율(0~1, 외형만), pop: 큰 글자 문구.
    // spike는 payload.spike가 참일 때 등급보다 먼저 고른다.
    impact: {
      normal: { life: 0.25, ringScale: 2.1, dots: 6, ringColor: null, outerRing: false, hold: 0, shake: null, trail: null,
        streaks: 0, flash: 0.22, fovPunch: 0, squash: 0.12, pop: null },
      good: { life: 0.32, ringScale: 2.8, dots: 8, ringColor: 0xfff6d2, outerRing: false, hold: 0, shake: null, trail: null,
        streaks: 4, flash: 0.32, fovPunch: 0.012, squash: 0.17, pop: null },
      perfect: { life: 0.45, ringScale: 3.6, dots: 10, ringColor: 0xffe27a, outerRing: true, hold: 0.07,
        shake: { amplitude: 3, duration: 0.2 }, trail: { color: 0xffe27a, duration: 0.8 },
        streaks: 6, flash: 0.45, fovPunch: 0.025, squash: 0.24, pop: null },
      spike: { life: 0.62, ringScale: 5.4, dots: 16, ringColor: 0xffffff, outerRing: true, hold: 0.09,
        shake: { amplitude: 6, duration: 0.30 }, trail: { color: 0xff9b54, duration: 1.1 },
        streaks: 12, flash: 0.80, fovPunch: 0.06, squash: 0.34, pop: 'SPIKE!' },
    },
    // 스파이크 속성 연출: 스파이크를 친 팀 학교의 속성(schools.js TAKRAW_ELEMENTS의 id)으로 고른다. 기본 스파이크 연출 위에 입자를 더한다.
    // life: 속성 입자의 최대 수명(초). colors: 입자 색 4개(0xRRGGBB, 채도 높고 중간 밝기, 흰색은 포인트만), ring: 링 색, trail: 공 궤적 색, edge: 입자 테두리 색.
    // parts: shape(dot·diamond·leaf·shard·crescent·hex·flake·star·bolt·streak), n(개수), c(색 번호), speed(m/s), up(위 방향 가산), g(중력, 음수면 떠오름),
    //   size(m), life(위 life 비율), delay(비율), spin(rad/s), dir(burst 사방·up 위쪽 부채·flat 수평·swirl 접촉점 둘레 회전), grow(끝 배율), flicker(깜빡임).
    // 모든 속성의 입자 합은 maxParticles 이하이고, 입자는 tick·sequence 시드로 배치한다(Math.random 없음).
    impactElements: {
      life: 1.2,
      maxParticles: 40,
      rim: 1.35, // 입자 바깥 어두운 테두리(edge 색) 배율: 밝은 배경에서 윤곽이 보이게 한다
      ballLife: .7, // 속성 연출 동안 공을 입자 위에 평면 원으로 다시 그리는 시간(초). 입자에 가려지지 않게 한다
      ballMargin: .16, // 입자가 공 중심에서 이 거리(m) 밖에서 시작한다(공 반지름 .095 + 여유)
      flash: .5, // 속성 연출이 있을 때 기본 별 섬광의 배율(입자가 묻히지 않게 줄인다)
      byElement: {
        grass: { colors: [0x00deb1, 0x33ff74, 0x88ff33, 0xffd033], ring: 0x52ff71, trail: 0x3dff7b, edge: 0x007059, parts: [
          { shape: 'leaf', n: 14, c: 1, speed: 1.44, up: .5, g: .9, size: .24, life: 1, spin: 5, dir: 'burst' },
          { shape: 'dot', n: 10, c: 3, speed: .4, up: .35, g: -.12, size: .09, life: 1, spin: 0, dir: 'burst' }] },
        fire: { colors: [0xffc633, 0xff8433, 0xff3412, 0xa63011], ring: 0xffb952, trail: 0xff8a3d, edge: 0x705100, parts: [
          { shape: 'shard', n: 10, c: 1, speed: 1.28, up: .9, g: -.5, size: .272, life: .8, spin: 0, dir: 'up' },
          { shape: 'dot', n: 20, c: 0, speed: 1.6, up: .7, g: -.35, size: .07, life: 1, spin: 0, dir: 'burst', flicker: true },
          { shape: 'dot', n: 5, c: 3, speed: .48, up: .5, g: -.2, size: .12, life: .85, delay: .15, spin: 0, dir: 'up', grow: 2 }] },
        water: { colors: [0x003dba, 0x33a2ff, 0x33afff, 0xffffff], ring: 0x52b9ff, trail: 0x3da7ff, edge: 0x002570, parts: [
          { shape: 'dot', n: 18, c: 1, speed: 1.76, up: .9, g: 2.2, size: .108, life: .9, spin: 0, dir: 'burst' },
          { shape: 'dot', n: 12, c: 3, speed: 1.12, up: .1, g: 1.2, size: .064, life: .7, spin: 0, dir: 'flat' }] },
        lightning: { colors: [0xffcd33, 0xffe333, 0xffffff, 0x0c83ab], ring: 0xffe752, trail: 0xffd03d, edge: 0x705500, parts: [
          { shape: 'bolt', n: 5, c: 1, speed: 1.44, up: .2, g: 0, size: .48, life: .45, spin: 0, dir: 'burst', flicker: true },
          { shape: 'streak', n: 22, c: 0, speed: 3.84, up: .3, g: 0, size: .9, life: .35, spin: 0, dir: 'burst' }] },
        moon: { colors: [0x8e5fd0, 0xb48cf0, 0xffd84a, 0xffffff], ring: 0x9b7ae0, trail: 0xb48cf0, edge: 0x3a2670, parts: [
          { shape: 'crescent', n: 3, c: 1, speed: 2.4, up: .2, g: 0, size: .34, life: .6, spin: 3, dir: 'flat' },
          { shape: 'star', n: 6, c: 2, speed: .8, up: .5, g: -.1, size: .16, life: 1, spin: 2, dir: 'burst', flicker: true },
          { shape: 'dot', n: 24, c: 3, speed: .56, up: .4, g: -.1, size: .058, life: 1, spin: 0, dir: 'burst' }] },
        sun: { colors: [0xff9f1c, 0xffcc33, 0xffd833, 0xffffff], ring: 0xffde52, trail: 0xffcf3d, edge: 0x704100, parts: [
          { shape: 'streak', n: 12, c: 1, speed: 2.88, up: 0, g: 0, size: 1.5, life: .6, spin: 0, dir: 'burst' },
          { shape: 'hex', n: 5, c: 2, speed: .96, up: .2, g: 0, size: .22, life: .8, spin: 0, dir: 'burst', grow: 1.6 },
          { shape: 'star', n: 14, c: 3, speed: .72, up: .3, g: -.05, size: .128, life: 1, spin: 1.5, dir: 'burst', flicker: true }] },
        ice: { colors: [0x33c1ff, 0x33c5ff, 0xffffff, 0x0081c7], ring: 0x52ceff, trail: 0x3dcfff, edge: 0x004e70, parts: [
          { shape: 'flake', n: 1, c: 2, speed: 0, up: 0, g: 0, size: .8, life: .5, spin: .8, dir: 'burst', grow: 1.3 },
          { shape: 'shard', n: 12, c: 1, speed: 2.08, up: .5, g: 1.4, size: .24, life: .85, spin: 0, dir: 'burst' },
          { shape: 'dot', n: 14, c: 2, speed: .56, up: .2, g: .5, size: .064, life: 1, spin: 0, dir: 'burst' }] },
        earth: { colors: [0x9a6b3a, 0x6b4a2a, 0xc89a4a, 0x4a3a2a], ring: 0xc89a4a, trail: 0xc8a15a, edge: 0x3a2616, parts: [
          { shape: 'diamond', n: 8, c: 1, speed: 1.6, up: .9, g: 2.6, size: .224, life: .9, spin: 6, dir: 'burst' },
          { shape: 'dot', n: 6, c: 2, speed: .64, up: .15, g: -.05, size: .18, life: .9, spin: 0, dir: 'flat', grow: 2 },
          { shape: 'dot', n: 14, c: 0, speed: 1.76, up: .7, g: 2.8, size: .076, life: .8, spin: 0, dir: 'burst' }] },
        wind: { colors: [0x4fb6c8, 0xffffff, 0x2f8fb5, 0x7fd45a], ring: 0xffffff, trail: 0x4fb6c8, edge: 0x1f5f7a, parts: [
          { shape: 'crescent', n: 3, c: 0, speed: 1.92, up: 0, g: 0, size: .36, life: .7, spin: 4, dir: 'swirl', grow: 1.5 },
          { shape: 'streak', n: 10, c: 1, speed: 2.56, up: .1, g: 0, size: 1.35, life: .6, spin: 0, dir: 'swirl' },
          { shape: 'leaf', n: 10, c: 3, speed: 1.6, up: .2, g: .1, size: .16, life: 1, spin: 7, dir: 'swirl' }] },
        dark: { colors: [0x2a2238, 0x7a3fd0, 0xa070ff, 0x0e0b14], ring: 0x9a6cf0, trail: 0xa070ff, edge: 0x1c0f3a, parts: [
          { shape: 'dot', n: 14, c: 1, speed: 1.6, up: .3, g: 0, size: .16, life: .9, spin: 0, dir: 'burst' },
          { shape: 'streak', n: 3, c: 2, speed: .8, up: .2, g: 0, size: 2.1, life: .5, spin: 0, dir: 'flat', flicker: true },
          { shape: 'dot', n: 8, c: 0, speed: .4, up: .5, g: -.2, size: .2, life: .9, delay: .1, spin: 0, dir: 'up', grow: 1.8 }] },
      },
    },
    // 화면 흔들림의 상한(CSS px). 여러 접촉이 겹쳐도 가장 센 하나만 쓰고 이 값을 넘지 않는다.
    shakeCap: 6,
    // 지면·득점 연출. life는 초, count는 입자 수.
    field: {
      land: { life: 0.55, puffs: 7, minSpeed: 2.2, color: 0xf3ecd6, radius: 0.55 },
      confetti: { life: 1.6, count: 44, height: 2.4, spread: 3.2, colors: [0xffd75e, 0xff7f6e, 0x62d0c0, 0xfff3c4] },
    },
    colors: { ground: 0xece7d9, ball: 0xffcd61 },
  },
});

export { TAKRAW_VERSION, TAKRAW_GAME_NAME, TAKRAW_PRODUCT_NAME, TAKRAW_CONFIG, takrawAthleteEffects };
