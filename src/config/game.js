import { TAKRAW_PHYSICS } from './physics.js';

// 제품 버전. package.json의 version과 같아야 하며(빌드 단계가 없어 한 곳에서 읽을 수 없다) scripts/check.cjs가 일치를 검사한다.
const TAKRAW_VERSION = '0.17.5';
// 이름은 뜻이 다른 셋이다. 어느 것도 바꾸면 안 되는 식별자가 아니라 화면에 보이는 이름이다.
//   TAKRAW_GAME_NAME: 종목 이름(TextPair). 학교 클럽명·"○○ 경기장" 같은 문구 속에 들어간다.
//   TAKRAW_PRODUCT_NAME: 제품 이름 "블룸 발 배구"/"Bloom Takraw"(TextPair). 홈 제목·소개영상·접속 버전 안내에 쓴다.
//   TAKRAW_DIAGNOSTIC_NAME: 진단 글·콘솔 머리글의 영어 대문자 제품 이름.
// 정적 파일과의 일치(index.html은 en, README·AGENTS·package.json은 ko)는 scripts/check.cjs가 검사한다.
const TAKRAW_GAME_NAME = Object.freeze({ ko: '발 배구', en: 'Takraw' });
const TAKRAW_PRODUCT_NAME = Object.freeze({
    ko: `블룸 ${TAKRAW_GAME_NAME.ko}`,
    en: `Bloom ${TAKRAW_GAME_NAME.en}`,
});
const TAKRAW_DIAGNOSTIC_NAME = TAKRAW_PRODUCT_NAME.en.toUpperCase();
// 저장·방·지표가 이 게임을 가리키는 식별자. 화면 이름이 아니라서 바꾸면 기존 저장·방 복귀·지표가 끊긴다.
const TAKRAW_ID = 'bloom-takraw';

/**
 * 능력치 → 경기 효과의 단일 공식(경기와 팀 관리 화면이 같이 읽는다).
 * base~max는 직선으로 0~1 비율이고, max를 넘으면 overflow 기울기로 log2(v/max)에 비례해 완만히 늘어난다. 효과는 maxEffect를 넘지 않는다.
 */
function takrawAthleteEffects(stats = {}, definition = TAKRAW_CONFIG.athletes) {
    return Object.fromEntries(
        Object.entries(definition.bonus).map(([key, maximum]) => {
            const value = stats[key] ?? definition.base;
            const ratio =
                value > definition.max
                    ? 1 + definition.overflow * Math.log2(value / definition.max)
                    : Math.max(0, (value - definition.base) / (definition.max - definition.base));
            return [key, Math.min(definition.maxEffect, ratio * maximum)];
        }),
    );
}

/**
 * 접촉 타이밍 등급 이름. 판정(simulation/timing.js)·킥 소리(config/runtime.js)·접촉 효과(visual.impact)·HUD 등급 표시가 이 이름을 쓴다.
 * perfect·good은 창(timing.windows) 이름이기도 하고, 모든 창 밖이면 normal이다. CSS(.timing-badge[data-grade])도 같은 글자를 쓴다.
 */
const TAKRAW_TIMING_GRADES = Object.freeze({ perfect: 'perfect', good: 'good', normal: 'normal' });

/**
 * 선수 역할 id와 팀 안 순서(슬롯 0 리시버, 1 세터, 2 공격수)의 단일 출처. 선수 id 배치(simulation/roster.js)·
 * AI 학교 선수(config/schools.js)·팀 편성(club/club.js)·화면이 이 목록을 읽고, 역할별 판단(AI·토스·물리)과 선호 역할 데이터는
 * TAKRAW_ROLE의 이름으로 가리킨다. 값(글자)은 스냅샷·저장의 player.role·preferredRole에 그대로 들어가므로 바꾸지 않는다.
 */
const TAKRAW_ROLE = Object.freeze({ receiver: 'receiver', setter: 'setter', attacker: 'attacker' });
const TAKRAW_ROLES = Object.freeze([
    TAKRAW_ROLE.receiver,
    TAKRAW_ROLE.setter,
    TAKRAW_ROLE.attacker,
]);
/** 역할의 표시 이름(TextPair). 팀 편성(club.js roles)과 화면 문구(i18n SHARED.attacker)가 읽는다. */
const TAKRAW_ROLE_NAMES = Object.freeze({
    receiver: Object.freeze({ ko: '리시버', en: 'Receiver' }),
    setter: Object.freeze({ ko: '세터', en: 'Setter' }),
    attacker: Object.freeze({ ko: '공격수', en: 'Attacker' }),
});

const TAKRAW_CONFIG = Object.freeze({
    version: TAKRAW_VERSION,
    status: 'Candidate',
    // fixedSeed: 시드를 받지 않은 경기(생성 직후·연습)의 고정 시드. 연습은 같은 상황이 반복되어야 한다.
    simulation: { tickRate: 60, substeps: 2, aiRate: 15, fixedSeed: 7 },
    // 매 틱 입력 바이트열: [x, z, 버튼] × 2명(1P·2P). x·z는 -1..1을 axisScale배 한 부호 있는 바이트(runtime.js가 쓰고 game.js decode가 읽는다).
    input: { size: 6, axisScale: 127 },
    // 코트·네트 치수의 단일 출처. 물리(네트 충돌체)·판정·AI·화면이 모두 이 값을 읽는다.
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
    // 헤드리스 실측에서 발이 공에 닿은 입력 오차는 최대 약 0.06초였다.
    // 입력 틱 1.2개(0.02초) 이내를 perfect, 2.4개(0.04초) 이내를 good으로 둔다. 사람 플레이로 재보정 대상이다.
    // maxAge: 입력 기록이 접촉 판정에 유효한 최대 경과 시간(초).
    timing: {
        windows: { [TAKRAW_TIMING_GRADES.perfect]: 0.02, [TAKRAW_TIMING_GRADES.good]: 0.04 },
        maxAge: 1.2,
    },
    // base: 기본 능력치, max: 효과 비율 1이 되는 능력치(이 위는 overflow × log2(v/max)만큼 더 늘어남), maxEffect: 효과 값의 상한(수비는 1 - 효과라 1 미만이어야 한다).
    athletes: {
        base: 50,
        max: 100,
        overflow: 0.5,
        maxEffect: 0.95,
        bonus: {
            mobility: 0.1,
            jump: 0.02,
            power: 0.08,
            flexibility: 0.1,
            setting: 0.04,
            defense: 0.2,
            recovery: 0.15,
        },
    },
    // 물리 어댑터 설정의 원본은 config/physics.js다.
    physics: TAKRAW_PHYSICS,
    training: {
        ready: 1.1,
        retry: 2.2,
        timeout: 7,
        feed: { height: 2.4, rise: 1.5, offset: 0.8, lateral: 0.1 },
        guide: { preholdLead: 0.34, kickWindow: 0.08 },
        // 속공 토스(simulation/game.js feedQuick): 세터 옆 offset(m)·높이 height(m)에서 꼭짓점 apex(m)로 올려 공격수 앞 낙하 타점에 닿게 한다.
        // 꼭짓점은 낮은 공격 판정(ai.toss.attack.apexMargin 안)에 들어오도록 정했다.
        quick: { offset: 0.5, height: 1.0, apex: 3.5 },
    },
    ai: {
        receiveHeight: 0.75,
        kickHold: 0.34,
        jumpHold: 0.25,
        // 선수 성향의 범위. 경기 시드·선수·랠리 번호로 값이 정해져 경기마다 상황이 달라진다(simulation/ai-brain.js).
        // reaction: 동료가 받기 시작한 뒤 보조 위치로 움직이기까지의 반응 시간(초), clearance: 공 궤적과 떨어지는 간격(m),
        // depth·lateral: 대기 자리의 앞뒤·옆 흔들림(±m).
        temperament: { reaction: [0.02, 0.24], clearance: [1.0, 1.5], depth: 0.35, lateral: 0.3 },
        serve: {
            // 사람이 서브할 때 공격수가 서는 자리(자기 코트 방향 좌표, m). 엔드라인(6.7 m) 뒤.
            spot: { x: -7.2, z: -0.3 },
            // 서브의 공 던지기(사람·AI 같은 규칙, AI는 판마다 다른 모으는 시간을 쓴다)(발차기 버튼. 누르는 동안 공이 lift(m)까지 올라가 높이가 보인다)(simulation/game.js updateServeToss): 공은 서버 앞 offset(m)·높이 height(m) 손 자리에 있다가,
            // 던지기를 떼면 위로 던져진다(앞뒤·좌우 속도는 던지는 순간 서버의 이동 속도 그대로). 꼭짓점은 짧게 누르면 minApex(m), fullCharge(초) 이상 누르면 maxApex(m). jumpApex(m) 이상으로 던지면 AI는 점프서브를 한다. maxHold(초) 안에 안 던지면 자동으로 던진다.
            groundAim: { x: 4.2 },
            toss: {
                offset: 0.65,
                height: 1.0,
                lift: 0.9,
                minApex: 1.6,
                maxApex: 4.4,
                jumpApex: 3.2,
                fullCharge: 0.8,
                maxHold: 12,
            },
        },
        // 사람이 자리를 비우면 AI 동료가 비운 구역을 메운다(ai-formation.js). slow: 이 시간(초)을 넘겨 닿는 구역만 벌점, reaction: 출발 반응(초),
        // reachRadius: 선수가 이동 없이 닿는 반경(m), step·reach: 후보 자리 간격(m)과 단계 수, deviationWeight: 기본 자리에서 멀어지는 벌점, minGain: 사람이 기본 자리에 있을 때보다 벌점이 이만큼 나빠지고, 옮겨서 이만큼 좋아질 때만 옮김, bounds: 역할별 설 수 있는 x 범위(자기 코트 방향 좌표).
        fill: {
            enabled: true,
            gridStep: 0.5,
            slow: 0.5,
            reaction: 0.1,
            reachRadius: 0.3,
            step: 0.75,
            reach: 2,
            deviationWeight: 0.012,
            minGain: 0.15,
            bounds: {
                receiver: { x: [-5.7, -3.6] },
                setter: { x: [-4.5, -2.2] },
                attacker: { x: [-3.5, -1.0] },
            },
        },
        receive: {
            claimLead: 0.75,
            commitLead: 0.1,
            claimSlack: 0.25,
            coverDistance: 1.25,
            hysteresis: 0.16,
            braking: 0.18,
            // 사람이 발차기를 누른 채 받을 공을 향해 달릴 때, 받는 자리(stance)에 멈추도록 속도만 줄여 준다(방향은 그대로).
            // window: 착지 몇 초 전부터, brake: 남은 거리(m)당 허용 입력 크기, cone: 입력이 자리 방향과 이룰 최소 내적(이보다 벗어나면 돕지 않는다).
            assist: { window: 0.9, brake: 2.2, cone: 0.35, minInput: 0.25 },
        },
        toss: {
            receiveOffset: 0.8,
            incomingOffset: 0.8,
            airContactHeight: 3.6,
            // 동료에게 보내는 지면 토스의 목표 보정(m): dx는 동료보다 네트 쪽, dz는 옆쪽으로 둔다.
            aim: { dx: 0.7, dz: 0 },
            // 세트 목표점이 공격수 기준점 둘레의 직사각형 안에서 흩어지는 반 길이(m): 능력별 [토스 능력 기본값(50), 최대값(100)]. 앞뒤(x)는 좁고 좌우(z)는 넓다(simulation/game.js tossSpread).
            spread: { half: { x: [0.3, 0.1], z: [1.0, 0.25] } },
            ground: { lead: 0.3, followThrough: 0.15, window: 0.45 },
            lowAttack: { minHeight: 2.65, maxHeight: 3.0, contactLead: 0.64, kickDelay: 0.16 },
            attack: {
                offset: 0.65,
                lateral: 0.1,
                positionRadius: 0.55,
                minLead: 0.16,
                maxLead: 0.65,
                checkLead: 0.6,
                kickDelay: 0.08,
                minHeight: 3.1,
                maxHeight: 3.7,
                preparation: { brakeLead: 0.3, driftRadius: 0.35, apexMargin: 0.3 },
            },
        },
    },
    visual: {
        // 접촉·착지 효과의 변주(무늬·방향)를 이벤트에서 뽑는 난수의 시드. 표시 전용이라 경기에 영향이 없다.
        effectSeed: 7,
        receiveGuide: {
            groundHeight: 0.07,
            contactRadius: 0.1,
            contactMinPixels: 16,
            actorWidth: 0.38,
            colors: { ai: 0x9ad3e5, human: 0xd8f2ae },
            opacity: { active: 0.8, waiting: 0.4 },
        },
        attackGuide: {
            maxLead: 1.6,
            groundHeight: 0.065,
            contactRadius: 0.1,
            contactMinPixels: 16,
            foot: { length: 0.28, width: 0.1, spacing: 0.22 },
            colors: { approach: 0xc0e2d8, ready: 0xfff0ba },
            opacity: { approach: 0.5, ready: 0.94 },
        },
        camera: {
            fov: 48,
            distance: 9.5,
            elevation: 4.6,
            focusHeight: 1.6,
            focusAhead: 2.2,
            follow: 7,
            ballWeight: 0.28,
            maxLateral: 2.3,
            maxDistance: 20,
            frameMargin: 0.78,
            topInset: 120,
            narrowTopInset: 188,
            narrowWidth: 700,
            near: 0.1,
            far: 100,
            orbit: { sensitivity: 0.006, minPitch: 0.14, maxPitch: 1.13 },
        },
        // 접촉 효과(타격감 가이드 §3·§6: 국소 hitflash·squash 먼저, 카메라 흔들림은 가장 센 사건 하나만). 화면에 그림을 덧붙이지 않고 쇼크웨이브 왜곡·명암, 공 눌림·늘어남,
        // 공·닿은 부위 반짝임, 표시 히트스톱, 기기 진동으로 접촉을 전한다. styles의 이름은 timing.windows와 normal, spike, 접촉 종류(takrawContactKind가 고른다:
        // serve·receive·save·set·drive·body·ground)다. 연관 수치는 기준값(wave.amount·intensity.referenceSpeed)에서 배율로 파생한다.
        impact: {
            // 쇼크웨이브: 접점에서 퍼지며 뒤 화면을 굴절시키고(왜곡) 띠 앞쪽을 밝게·바로 뒤를 어둡게(명암) 한다. 반지름 = radius × (start + styles.waveScale × reach × 확대 곡선 × √세기),
            // 확대 곡선 1-(1-q)^growth(4면 수명의 30%에 76%). 시작 반지름 start가 공(반지름 0.095m)보다 바깥이라 공 자체는 일그러지지 않고, 화면 상한에 걸려도 시작 반지름은 줄지 않는다.
            // 세기 w = styles.wave(1이 기준, 0.75·0.5·0.25·0.1 배율) × 접촉 세기. 왜곡 = amount × w^distortPower(세기에 가파르게 묶여 약한 접촉은 몸이 휘어 보이지 않는다),
            // 명암 = styles.shade × 접촉 세기(약한 접촉도 코트 바닥에서 읽히도록 약한 파동은 왜곡 배율과 따로 정한다). amount: 세기 1일 때 최대 밀림(화면 높이 비율), maxSlope: 밀림이 띠 폭의 이 비율을 넘지 않는다(상한에 걸려 띠가 좁아져도 화면이 접히지 않는다),
            // front: 띠 바깥 가장자리의 부드러움(폭 비율), shade: 띠 앞쪽 ×(1+light)·바로 뒤 ×(1-dark), maxScreen: 반지름 상한(화면 짧은 변 비율), minPixels: 띠 폭 하한(px),
            // lifeShare: 파동 수명 = 효과 수명 × lifeShare, max: 동시 파동 수(넘치면 가장 오래된 것부터 버린다).
            wave: {
                radius: 0.13,
                start: 2.2,
                reach: 1.2,
                width: 0.5,
                amount: 0.02,
                distortPower: 2,
                maxSlope: 0.35,
                fade: 1.6,
                front: 0.5,
                growth: 4,
                lifeShare: 0.6,
                shade: { light: 0.08, dark: 0.06 },
                maxScreen: 0.3,
                minPixels: 6,
                max: 5,
            },
            // 접촉 순간 ms 동안 공과 닿은 부위의 재질을 흰색 glow(emissive 세기)만큼 밝게(몸에 맞은 접촉은 제외).
            flash: { ms: 75, glow: 0.4 },
            // 바닥 튕김 직후 life 초 동안 공 그림자가 scale만큼 커지고 opacity만큼 진해졌다 돌아온다.
            shadow: { life: 0.25, scale: 0.7, opacity: 0.6 },
            // 사용자 팀 접촉의 기기 진동. byStyle[이름] = { ms: 진동 길이, strong·weak: 게임패드 진동 세기 0~1 }. 동작 줄이기에서는 끈다.
            rumble: {
                byStyle: {
                    normal: { ms: 15, strong: 0.2, weak: 0.2 },
                    good: { ms: 25, strong: 0.4, weak: 0.3 },
                    perfect: { ms: 40, strong: 0.7, weak: 0.4 },
                    spike: { ms: 60, strong: 1, weak: 0.6 },
                    serve: { ms: 30, strong: 0.5, weak: 0.3 },
                    receive: { ms: 20, strong: 0.3, weak: 0.5 },
                    save: { ms: 35, strong: 0.5, weak: 0.5 },
                    set: { ms: 10, strong: 0.15, weak: 0.1 },
                    drive: { ms: 30, strong: 0.5, weak: 0.3 },
                    ground: { ms: 30, strong: 0.4, weak: 0.4 },
                },
            },
            // 세기: 원천 속도(m/s, foot은 발 속도 × footWeight) ÷ referenceSpeed를 min~max로 자른 값. 파동 크기·눌림에 곱하고 수명에는 제곱근을 곱한다.
            intensity: { referenceSpeed: 10, footWeight: 2, min: 0.65, max: 1.5 },
            // 아슬아슬한 받아내기: 서브가 아닌 발 접촉이 이 높이(m, 공 중심)보다 낮으면 save로 한 단계 강조한다.
            clutchHeight: 0.5,
            // 표시 전용 히트스톱 뒤 따라잡기: 멈춘 시간 × catchUp 동안 멈춘 포즈에서 지금 포즈로 섞는다.
            displayCatchUp: 2,
            // styles 공통: life(초), wave: 왜곡 세기 배율(없으면 파동 없음), shade: 명암 세기 배율(wave와 함께), waveScale: 파동 최대 크기 배율, hold: 효과를 첫 모습으로 유지하는 시간(초),
            //   shake: 카메라 진동(CSS px, 초), fovPunch: 화면 확대(시야각 비율), squash: 공이 맞은 방향으로 눌리는 비율(0~1, 외형만), pop: 큰 글자 문구,
            //   displayHold: 표시 전용 히트스톱(초, 내 화면의 선수·공 포즈만 멈춘다), intensity: 세기 원천(foot·ball·incoming, 없으면 1).
            // styles 선택: squashDecay·squashFreq: 눌림 복원 감쇠(1/초)·진동(rad/초, 기본 13·34), squashAxis: 'up'이면 위아래로 눌린다(기본 발 속도 축).
            styles: {
                [TAKRAW_TIMING_GRADES.normal]: {
                    life: 0.25,
                    wave: 0.5,
                    shade: 0.5,
                    waveScale: 2.1,
                    hold: 0,
                    shake: null,
                    fovPunch: 0,
                    squash: 0.12,
                    pop: null,
                },
                [TAKRAW_TIMING_GRADES.good]: {
                    life: 0.32,
                    wave: 0.5,
                    shade: 0.5,
                    waveScale: 2.8,
                    hold: 0,
                    shake: null,
                    fovPunch: 0.012,
                    squash: 0.17,
                    pop: null,
                    intensity: 'foot',
                },
                [TAKRAW_TIMING_GRADES.perfect]: {
                    life: 0.45,
                    wave: 0.75,
                    shade: 0.75,
                    waveScale: 3.6,
                    hold: 0.07,
                    shake: { amplitude: 3, duration: 0.2 },
                    fovPunch: 0.025,
                    squash: 0.24,
                    pop: null,
                    displayHold: 0.07,
                    intensity: 'foot',
                },
                spike: {
                    life: 0.62,
                    wave: 1,
                    shade: 1,
                    waveScale: 5.4,
                    hold: 0.09,
                    shake: { amplitude: 6, duration: 0.3 },
                    fovPunch: 0.06,
                    squash: 0.34,
                    pop: 'SPIKE!',
                    displayHold: 0.09,
                    intensity: 'foot',
                },
                // 서브 차기: 랠리의 시작. 일반 접촉보다 크고 스파이크보다 작다.
                serve: {
                    life: 0.34,
                    wave: 0.5,
                    shade: 0.5,
                    waveScale: 2.6,
                    hold: 0,
                    shake: null,
                    fovPunch: 0.01,
                    squash: 0.2,
                    pop: null,
                    intensity: 'ball',
                },
                // 리시브: 들어온 공을 죽인다. 바깥으로 터지는 파동 대신 깊게 눌렸다 느리게 복원한다.
                receive: {
                    life: 0.4,
                    wave: 0.25,
                    shade: 1.5,
                    waveScale: 1.7,
                    hold: 0,
                    shake: null,
                    fovPunch: 0,
                    squash: 0.34,
                    squashDecay: 7,
                    squashFreq: 18,
                    pop: null,
                    intensity: 'incoming',
                },
                // 아슬아슬한 받아내기(clutchHeight 아래): 리시브보다 한 단계 강하게, 짧게 멈춘다.
                save: {
                    life: 0.48,
                    wave: 0.5,
                    shade: 1.5,
                    waveScale: 2.4,
                    hold: 0.05,
                    shake: { amplitude: 2.5, duration: 0.16 },
                    fovPunch: 0.012,
                    squash: 0.4,
                    squashDecay: 7,
                    squashFreq: 18,
                    pop: null,
                    displayHold: 0.06,
                    intensity: 'incoming',
                },
                // 토스(세트): 가볍고 또렷한 "톡".
                set: {
                    life: 0.24,
                    wave: 0.1,
                    shade: 1.5,
                    waveScale: 1.4,
                    hold: 0,
                    shake: null,
                    fovPunch: 0,
                    squash: 0.1,
                    squashDecay: 18,
                    squashFreq: 42,
                    pop: null,
                    intensity: 'ball',
                },
                // 스파이크가 아닌 공격성 접촉(세 번째 넘기기·공중 발차기): good 등급 정도.
                drive: {
                    life: 0.32,
                    wave: 0.5,
                    shade: 0.5,
                    waveScale: 2.6,
                    hold: 0,
                    shake: null,
                    fovPunch: 0.008,
                    squash: 0.18,
                    pop: null,
                    intensity: 'foot',
                },
                // 발이 아닌 몸(허벅지·몸통·머리): 둔탁하게. 파동·반짝임 없이 공 눌림만.
                body: {
                    life: 0.22,
                    waveScale: 1,
                    hold: 0,
                    shake: null,
                    fovPunch: 0,
                    squash: 0.1,
                    squashDecay: 20,
                    squashFreq: 24,
                    pop: null,
                },
                // 공이 바닥에 닿음: 위아래로 눌리고 약한 파동이 퍼진다.
                ground: {
                    life: 0.36,
                    wave: 0.25,
                    shade: 1.5,
                    waveScale: 3.4,
                    hold: 0,
                    shake: null,
                    fovPunch: 0,
                    squash: 0.3,
                    squashAxis: 'up',
                    squashDecay: 15,
                    squashFreq: 30,
                    pop: null,
                    intensity: 'ball',
                },
            },
        },
        // 공 비행 늘어남(외형만): 표시 속도가 minSpeed 아래면 없고 maxSpeed에서 max배. 나머지 축은 부피 보존으로 줄인다.
        // smoothing: 속도 평활 시간(초), resetDistance: 한 프레임에 이보다 멀리 가면 끊긴 장면으로 보고 속도를 지운다(m).
        ball: {
            stretch: { minSpeed: 5, maxSpeed: 14, max: 1.22, smoothing: 0.03, resetDistance: 1.2 },
        },
        // 스파이크 속성 연출: 스파이크를 친 팀 학교의 속성(schools.js TAKRAW_ELEMENTS의 id)으로 고른다. 쇼크웨이브 위에 작은 입자 구름을 공이 나가는 반대쪽에만 더한다.
        // life: 속성 입자의 최대 수명(초). colors: 입자 색 4개(0xRRGGBB, 채도 높고 중간 밝기, 흰색은 포인트만), edge: 입자 테두리 색.
        // parts: shape(dot·diamond·leaf·shard·crescent·hex·flake·star·bolt·streak), n(개수), c(색 번호), speed(m/s), up(위 방향 가산), g(중력, 음수면 떠오름),
        //   size(m), life(위 life 비율), delay(비율), spin(rad/s), dir(burst 사방·up 위쪽 부채·flat 수평·swirl 접촉점 둘레 회전), grow(끝 배율), flicker(깜빡임).
        // 모든 속성의 입자 합은 maxParticles 이하이고, 입자는 tick·sequence 시드로 배치한다(Math.random 없음).
        impactElements: {
            life: 1.2,
            maxParticles: 40,
            rim: 1.35, // 입자 바깥 어두운 테두리(edge 색) 배율: 밝은 배경에서 윤곽이 보이게 한다
            ballMargin: 0.16, // 입자가 공 중심에서 이 거리(m) 밖에서 시작한다(공 반지름 .095 + 여유)
            cloud: 0.4, // 구름 배율: 입자 크기와 퍼지는 거리를 줄인다(공 표면 간격 ballMargin은 지킨다). 공이 나가는 쪽 입자는 반대편으로 접는다
            ballMask: 1.15, // 공 화면 반지름의 이 배 안에서는 입자를 그리지 않는다(어느 카메라에서도 공이 구름에 가려지지 않는다)
            byElement: {
                grass: {
                    colors: [0x00deb1, 0x33ff74, 0x88ff33, 0xffd033],
                    edge: 0x007059,
                    parts: [
                        {
                            shape: 'leaf',
                            n: 14,
                            c: 1,
                            speed: 1.44,
                            up: 0.5,
                            g: 0.9,
                            size: 0.24,
                            life: 1,
                            spin: 5,
                            dir: 'burst',
                        },
                        {
                            shape: 'dot',
                            n: 10,
                            c: 3,
                            speed: 0.4,
                            up: 0.35,
                            g: -0.12,
                            size: 0.09,
                            life: 1,
                            spin: 0,
                            dir: 'burst',
                        },
                    ],
                },
                fire: {
                    colors: [0xffc633, 0xff8433, 0xff3412, 0xa63011],
                    edge: 0x705100,
                    parts: [
                        {
                            shape: 'shard',
                            n: 10,
                            c: 1,
                            speed: 1.28,
                            up: 0.9,
                            g: -0.5,
                            size: 0.272,
                            life: 0.8,
                            spin: 0,
                            dir: 'up',
                        },
                        {
                            shape: 'dot',
                            n: 20,
                            c: 0,
                            speed: 1.6,
                            up: 0.7,
                            g: -0.35,
                            size: 0.07,
                            life: 1,
                            spin: 0,
                            dir: 'burst',
                            flicker: true,
                        },
                        {
                            shape: 'dot',
                            n: 5,
                            c: 3,
                            speed: 0.48,
                            up: 0.5,
                            g: -0.2,
                            size: 0.12,
                            life: 0.85,
                            delay: 0.15,
                            spin: 0,
                            dir: 'up',
                            grow: 2,
                        },
                    ],
                },
                water: {
                    colors: [0x003dba, 0x33a2ff, 0x33afff, 0xffffff],
                    edge: 0x002570,
                    parts: [
                        {
                            shape: 'dot',
                            n: 18,
                            c: 1,
                            speed: 1.76,
                            up: 0.9,
                            g: 2.2,
                            size: 0.108,
                            life: 0.9,
                            spin: 0,
                            dir: 'burst',
                        },
                        {
                            shape: 'dot',
                            n: 12,
                            c: 3,
                            speed: 1.12,
                            up: 0.1,
                            g: 1.2,
                            size: 0.064,
                            life: 0.7,
                            spin: 0,
                            dir: 'flat',
                        },
                    ],
                },
                lightning: {
                    colors: [0xffcd33, 0xffe333, 0xffffff, 0x0c83ab],
                    edge: 0x705500,
                    parts: [
                        {
                            shape: 'bolt',
                            n: 5,
                            c: 1,
                            speed: 1.44,
                            up: 0.2,
                            g: 0,
                            size: 0.48,
                            life: 0.45,
                            spin: 0,
                            dir: 'burst',
                            flicker: true,
                        },
                        {
                            shape: 'streak',
                            n: 22,
                            c: 0,
                            speed: 3.84,
                            up: 0.3,
                            g: 0,
                            size: 0.9,
                            life: 0.35,
                            spin: 0,
                            dir: 'burst',
                        },
                    ],
                },
                moon: {
                    colors: [0x8e5fd0, 0xb48cf0, 0xffd84a, 0xffffff],
                    edge: 0x3a2670,
                    parts: [
                        {
                            shape: 'crescent',
                            n: 3,
                            c: 1,
                            speed: 2.4,
                            up: 0.2,
                            g: 0,
                            size: 0.34,
                            life: 0.6,
                            spin: 3,
                            dir: 'flat',
                        },
                        {
                            shape: 'star',
                            n: 6,
                            c: 2,
                            speed: 0.8,
                            up: 0.5,
                            g: -0.1,
                            size: 0.16,
                            life: 1,
                            spin: 2,
                            dir: 'burst',
                            flicker: true,
                        },
                        {
                            shape: 'dot',
                            n: 24,
                            c: 3,
                            speed: 0.56,
                            up: 0.4,
                            g: -0.1,
                            size: 0.058,
                            life: 1,
                            spin: 0,
                            dir: 'burst',
                        },
                    ],
                },
                sun: {
                    colors: [0xff9f1c, 0xffcc33, 0xffd833, 0xffffff],
                    edge: 0x704100,
                    parts: [
                        {
                            shape: 'streak',
                            n: 12,
                            c: 1,
                            speed: 2.88,
                            up: 0,
                            g: 0,
                            size: 1.5,
                            life: 0.6,
                            spin: 0,
                            dir: 'burst',
                        },
                        {
                            shape: 'hex',
                            n: 5,
                            c: 2,
                            speed: 0.96,
                            up: 0.2,
                            g: 0,
                            size: 0.22,
                            life: 0.8,
                            spin: 0,
                            dir: 'burst',
                            grow: 1.6,
                        },
                        {
                            shape: 'star',
                            n: 14,
                            c: 3,
                            speed: 0.72,
                            up: 0.3,
                            g: -0.05,
                            size: 0.128,
                            life: 1,
                            spin: 1.5,
                            dir: 'burst',
                            flicker: true,
                        },
                    ],
                },
                ice: {
                    colors: [0x33c1ff, 0x33c5ff, 0xffffff, 0x0081c7],
                    edge: 0x004e70,
                    parts: [
                        {
                            shape: 'flake',
                            n: 1,
                            c: 2,
                            speed: 0,
                            up: 0,
                            g: 0,
                            size: 0.8,
                            life: 0.5,
                            spin: 0.8,
                            dir: 'burst',
                            grow: 1.3,
                        },
                        {
                            shape: 'shard',
                            n: 12,
                            c: 1,
                            speed: 2.08,
                            up: 0.5,
                            g: 1.4,
                            size: 0.24,
                            life: 0.85,
                            spin: 0,
                            dir: 'burst',
                        },
                        {
                            shape: 'dot',
                            n: 14,
                            c: 2,
                            speed: 0.56,
                            up: 0.2,
                            g: 0.5,
                            size: 0.064,
                            life: 1,
                            spin: 0,
                            dir: 'burst',
                        },
                    ],
                },
                earth: {
                    colors: [0x9a6b3a, 0x6b4a2a, 0xc89a4a, 0x4a3a2a],
                    edge: 0x3a2616,
                    parts: [
                        {
                            shape: 'diamond',
                            n: 8,
                            c: 1,
                            speed: 1.6,
                            up: 0.9,
                            g: 2.6,
                            size: 0.224,
                            life: 0.9,
                            spin: 6,
                            dir: 'burst',
                        },
                        {
                            shape: 'dot',
                            n: 6,
                            c: 2,
                            speed: 0.64,
                            up: 0.15,
                            g: -0.05,
                            size: 0.18,
                            life: 0.9,
                            spin: 0,
                            dir: 'flat',
                            grow: 2,
                        },
                        {
                            shape: 'dot',
                            n: 14,
                            c: 0,
                            speed: 1.76,
                            up: 0.7,
                            g: 2.8,
                            size: 0.076,
                            life: 0.8,
                            spin: 0,
                            dir: 'burst',
                        },
                    ],
                },
                wind: {
                    colors: [0x4fb6c8, 0xffffff, 0x2f8fb5, 0x7fd45a],
                    edge: 0x1f5f7a,
                    parts: [
                        {
                            shape: 'crescent',
                            n: 3,
                            c: 0,
                            speed: 1.92,
                            up: 0,
                            g: 0,
                            size: 0.36,
                            life: 0.7,
                            spin: 4,
                            dir: 'swirl',
                            grow: 1.5,
                        },
                        {
                            shape: 'streak',
                            n: 10,
                            c: 1,
                            speed: 2.56,
                            up: 0.1,
                            g: 0,
                            size: 1.35,
                            life: 0.6,
                            spin: 0,
                            dir: 'swirl',
                        },
                        {
                            shape: 'leaf',
                            n: 10,
                            c: 3,
                            speed: 1.6,
                            up: 0.2,
                            g: 0.1,
                            size: 0.16,
                            life: 1,
                            spin: 7,
                            dir: 'swirl',
                        },
                    ],
                },
                dark: {
                    colors: [0x2a2238, 0x7a3fd0, 0xa070ff, 0x0e0b14],
                    edge: 0x1c0f3a,
                    parts: [
                        {
                            shape: 'dot',
                            n: 14,
                            c: 1,
                            speed: 1.6,
                            up: 0.3,
                            g: 0,
                            size: 0.16,
                            life: 0.9,
                            spin: 0,
                            dir: 'burst',
                        },
                        {
                            shape: 'streak',
                            n: 3,
                            c: 2,
                            speed: 0.8,
                            up: 0.2,
                            g: 0,
                            size: 2.1,
                            life: 0.5,
                            spin: 0,
                            dir: 'flat',
                            flicker: true,
                        },
                        {
                            shape: 'dot',
                            n: 8,
                            c: 0,
                            speed: 0.4,
                            up: 0.5,
                            g: -0.2,
                            size: 0.2,
                            life: 0.9,
                            delay: 0.1,
                            spin: 0,
                            dir: 'up',
                            grow: 1.8,
                        },
                    ],
                },
            },
        },
        // 화면 흔들림의 상한(CSS px). 여러 접촉이 겹쳐도 가장 센 하나만 쓰고 이 값을 넘지 않는다.
        shakeCap: 6,
        // 지면·득점 연출. life는 초, count는 입자 수.
        field: {
            land: { life: 0.55, puffs: 7, minSpeed: 2.2, color: 0xf3ecd6, radius: 0.55 },
            confetti: {
                life: 1.6,
                count: 44,
                height: 2.4,
                spread: 3.2,
                colors: [0xffd75e, 0xff7f6e, 0x62d0c0, 0xfff3c4],
            },
        },
        colors: { ground: 0xece7d9, ball: 0xffcd61 },
    },
});

export {
    TAKRAW_VERSION,
    TAKRAW_GAME_NAME,
    TAKRAW_PRODUCT_NAME,
    TAKRAW_DIAGNOSTIC_NAME,
    TAKRAW_ID,
    TAKRAW_CONFIG,
    TAKRAW_ROLE,
    TAKRAW_ROLES,
    TAKRAW_ROLE_NAMES,
    TAKRAW_TIMING_GRADES,
    takrawAthleteEffects,
};
