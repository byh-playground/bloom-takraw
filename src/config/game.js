const TAKRAW_VERSION = '0.12.42';

/** Normalized athlete bonuses; both the simulation and club UI read this formula. */
function takrawAthleteEffects(stats = {}, definition = TAKRAW_CONFIG.athletes) {
  return Object.fromEntries(Object.entries(definition.bonus).map(([key, maximum]) =>
    [key, Math.max(0, Math.min(1, ((stats[key] ?? definition.base) - definition.base) /
      (definition.max - definition.base))) * maximum]));
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
  athletes: { base: 50, max: 100, bonus: {
    mobility: 0.10, jump: 0.02, power: 0.08, flexibility: 0.10,
    setting: 0.04, defense: 0.20, recovery: 0.15,
  } },
  physics: { groundToss: { receiveApex: 2.4, attackApex: 4.2 } },
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
    // 서브 토스의 변주(±): 위치(m)와 올리는 속도(m/s). 서브가 매번 다른 궤적이 된다. 폭을 2배로 키우면 아웃이 늘어 랠리가 짧아져(120경기초 기준) 이 값으로 정했다.
    serve: { depth: 0.03, lateral: 0.08, height: 0.05, rise: 0.08,
      // 사람이 서브할 때 공격수가 서는 자리(자기 코트 방향 좌표, m).
      spot: { x: -5.2, z: -0.3 },
      // 사람 서브의 공 올리기: 서버 앞 offset(m)·높이 height(m)에서 꼭짓점 apex(m)까지 바로 위로 올린다(simulation/game.js feedServe).
      toss: { offset: 0.65, height: 1.0, apex: 3.5 } },
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

export { TAKRAW_VERSION, TAKRAW_CONFIG, takrawAthleteEffects };
