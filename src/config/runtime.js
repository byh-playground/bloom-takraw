import { TAKRAW_ID, TAKRAW_TIMING_GRADES } from './game.js';

// 발차기 한 번은 네 층이다. 낮은 쿵(thump)은 무게를, 중음 몸통(body, 삼각파)은 작은 스피커에서도 들리는 울림을,
// 슬랩(slap)과 클릭(click)은 발이 공에 닿는 순간의 "탁"을 맡는다. 공 속도가 세질수록 모든 층이 커지고 길어지고 밝아진다.
// (이전 소리는 사실상 120~500Hz 사인파 하나라 2kHz 위 에너지가 0이었고, 단계별 음량 차이도 2dB뿐이었다.)
// below: 공 속도 / 기준 속도가 이 값 미만이면 그 단계다. 단계 이름·기준은 TAKRAW_KICK_SOUND로 내보내 src/presentation/sound.js가 소리 id를 고른다.
const KICK_LEVELS = {
    Soft: {
        below: 0.45,
        layers: [
            { kind: 'tone', hz: 150, end: 70, ms: 80, gain: 0.3, type: 'sine' },
            { kind: 'tone', hz: 240, end: 130, ms: 50, gain: 0.3, type: 'triangle' },
            { kind: 'noise', hz: 2200, ms: 28, gain: 0.12 },
            { kind: 'noise', hz: 6000, ms: 7, gain: 0.25 },
        ],
    },
    Medium: {
        below: 0.8,
        layers: [
            { kind: 'tone', hz: 170, end: 62, ms: 95, gain: 0.45, type: 'sine' },
            { kind: 'tone', hz: 280, end: 130, ms: 60, gain: 0.45, type: 'triangle' },
            { kind: 'noise', hz: 2800, ms: 38, gain: 0.2 },
            { kind: 'noise', hz: 7000, ms: 8, gain: 0.45 },
        ],
    },
    Hard: {
        below: Infinity,
        layers: [
            { kind: 'tone', hz: 200, end: 52, ms: 130, gain: 0.62, type: 'sine' },
            { kind: 'tone', hz: 330, end: 140, ms: 75, gain: 0.6, type: 'triangle' },
            { kind: 'noise', hz: 3400, ms: 50, gain: 0.3 },
            { kind: 'noise', hz: 8000, ms: 10, gain: 0.7 },
            { kind: 'tone', hz: 1100, end: 520, ms: 35, gain: 0.14, type: 'triangle' },
        ],
    },
};

// 타이밍 등급이 높을수록 같은 단계 위에 높은 음을 더한다. timing: 접촉 타이밍 판정의 등급 이름(TAKRAW_TIMING_GRADES, 없으면 등급 없는 기본 소리).
const KICK_GRADES = {
    '': { timing: undefined, layers: [] },
    Good: {
        timing: TAKRAW_TIMING_GRADES.good,
        layers: [{ kind: 'tone', hz: 880, end: 880, ms: 70, gain: 0.22, type: 'sine', delay: 20 }],
    },
    Perfect: {
        timing: TAKRAW_TIMING_GRADES.perfect,
        layers: [
            { kind: 'tone', hz: 988, end: 1319, ms: 90, gain: 0.28, type: 'sine', delay: 15 },
            { kind: 'tone', hz: 1760, end: 1760, ms: 140, gain: 0.18, type: 'sine', delay: 70 },
        ],
    },
};

// 소리 id를 고르는 쪽(sound.js)이 읽는 단계 이름·기준과 등급 접미사. 소리 정의(KICK_SOUNDS)와 같은 표에서 나오므로 이름이 어긋날 수 없다.
const TAKRAW_KICK_SOUND = Object.freeze({
    levels: Object.freeze(
        Object.entries(KICK_LEVELS).map(([name, { below }]) => Object.freeze({ name, below })),
    ),
    gradeSuffix: Object.freeze(
        Object.fromEntries(
            Object.entries(KICK_GRADES)
                .filter(([, { timing }]) => timing)
                .map(([suffix, { timing }]) => [timing, suffix]),
        ),
    ),
});

// kickSoft·kickSoftGood·kickSoftPerfect … kickHardPerfect(9개). 단계×등급 조합은 src/presentation/sound.js가 고른다.
const KICK_SOUNDS = Object.fromEntries(
    Object.entries(KICK_LEVELS).flatMap(([level, { layers }]) =>
        Object.entries(KICK_GRADES).map(([grade, extra]) => [
            `kick${level}${grade}`,
            { category: 'impact', priority: 3, layers: [...layers, ...extra.layers] },
        ]),
    ),
);

// 득점 신호: 반짝이는 두 음 + 짧은 합성 함성. 가장 보상적인 순간이라 타격보다 크게 둔다.
const POINT_LAYERS = [
    { kind: 'tone', hz: 620, end: 620, ms: 95, gain: 0.85, type: 'sine' },
    { kind: 'tone', hz: 830, end: 830, ms: 160, gain: 0.75, type: 'sine', delay: 95 },
    { kind: 'noise', hz: 2400, ms: 380, gain: 0.5, delay: 80 },
    { kind: 'tone', hz: 190, end: 260, ms: 320, gain: 0.2, type: 'triangle', delay: 90 },
    { kind: 'tone', hz: 285, end: 365, ms: 340, gain: 0.17, type: 'triangle', delay: 105 },
];

/**
 * 경기 모드별 runtime·화면 정책의 단일 출처. runtime·presentation은 모드 이름을 비교하지 않고 이 표나
 * 시뮬레이션 프로필(simulation/modes.js TAKRAW_MODES)의 플래그를 읽는다. 시뮬레이션 규칙과 같은 지식(사람 입력·
 * 상대 대기·연습·득점)은 프로필을 읽고, 여기에는 runtime·화면에만 있는 뜻을 둔다. 플래그 하나는 한 가지 뜻이다.
 * 어느 분기가 어느 플래그를 읽는지는 docs/architecture.md 「모드 정책」 표가 정리한다. 모드가 없으면(처음 화면) 표에 없으므로 `?.`로 읽는다.
 *
 * - clubTeam: 내 팀 편성(팀 관리 선수)으로 경기한다. 팀 저장이 준비돼야 시작할 수 있다.
 * - ownSchool: 내 학교(팀 관리에서 고른 학교)로 경기한다. 아니면 기본 학교다.
 * - opponentSchool: 상대가 도장깨기 학교(학교 AI 선수·성향)다. 경기 기록에 학교 id가 붙는다.
 * - watchSeed: 관전 시드 하나가 두 학교·시드·HUD 팀 이름과 색을 정한다(시드 입력칸).
 * - loopsFirstPoint: 첫 1점 뒤 같은 시드를 처음부터 다시 연다.
 * - room: 온라인 방 세션이다(롤백·연결 카드·내 팀 번호·방 코드 시드).
 * - announcesTeam: 두 사람이 모이면 팀 이름·학교를 서로 알리고, 그 학교로 색·모델을 칠한다.
 * - namedTeams: 점수판 팀 이름이 학교·팀 이름이다(색 점, 「○○ 승리」 결과).
 * - holdsSimulation: 이 기기가 시뮬레이션을 멈출 수 있다(일시 정지·리플레이 동안 진행을 멈춘다).
 * - restart: 다시 시작의 방법. 'command'는 같은 세션에 재시작 명령, 'hostCommand'는 방장만 재시작 명령, 'reopen'은 세션을 새로 연다.
 * - rewards: 경기 결과로 팀 보상을 저장한다.
 * - replay: 득점 리플레이를 보여 준다.
 * - recorded: 게임 지표에 경기 기록을 남긴다.
 * - scoreMotion: 결정타 득점 연출(점수 모션)을 한다.
 */
const MODE_POLICY_DEFAULTS = Object.freeze({
    clubTeam: false,
    ownSchool: false,
    opponentSchool: false,
    watchSeed: false,
    loopsFirstPoint: false,
    room: false,
    announcesTeam: false,
    namedTeams: false,
    holdsSimulation: true,
    restart: 'reopen',
    rewards: false,
    replay: false,
    recorded: false,
    scoreMotion: false,
});
const definePolicy = (policy) => Object.freeze({ ...MODE_POLICY_DEFAULTS, ...policy });
const TAKRAW_MODE_POLICY = Object.freeze({
    match: definePolicy({
        clubTeam: true,
        ownSchool: true,
        opponentSchool: true,
        rewards: true,
        replay: true,
        recorded: true,
        scoreMotion: true,
    }),
    online: definePolicy({
        room: true,
        announcesTeam: true,
        namedTeams: true,
        holdsSimulation: false,
        restart: 'hostCommand',
        recorded: true,
    }),
    watch: definePolicy({ watchSeed: true, loopsFirstPoint: true, namedTeams: true }),
    training: definePolicy({ clubTeam: true, ownSchool: true, restart: 'command' }),
});

const TAKRAW_RUNTIME = Object.freeze({
    // 관전: 같은 시드는 같은 AI 대 AI 경기를 만든다. showcaseSeed는 소개영상의 명경기다.
    watch: {
        param: 'watch',
        showcaseSeed: 1252,
        maxSeed: 0xffffffff,
        randomMax: 9999,
        // 관전은 첫 득점까지의 한 판만 보여준다. 득점 뒤 이만큼 결과를 보여주고 같은 시드를 처음부터 다시 시작한다.
        loopHoldMs: 2500,
        // 일괄 탐색(시드 0~3000, v0.17.0 난수)으로 고른 명경기. 관전은 첫 점만 보여 주므로 첫 점 랠리로 고른다:
        // 스파이크 결정타로 끝나고 두 팀 모두 스파이크했고 받아내기 3번 이상인 랠리 중 터치 + 2×받아내기가 큰 순서.
        // closest = 스파이크를 받아낼 때 공이 지면에 닿기까지 남은 가장 짧은 시간(초, 소개영상 시드),
        // digs·touches = 첫 점 랠리의 받아내기 횟수·터치 수. 문구는 화면(ui.js)이 언어별로 만든다.
        featured: [
            { seed: 1252, closest: 0.05 },
            { seed: 365, digs: 7, touches: 19 },
            { seed: 2132, digs: 6, touches: 21 },
            { seed: 1164, digs: 7, touches: 18 },
        ],
    },
    // 득점 리플레이(경기 시작 상태 + 입력으로 다시 계산): 스파이크 결정타이거나 터치가 longRallyTouches 이상인 랠리로 득점하면, 득점 틱 + tailMs에서 경기를 멈추고 그 장면을 다시 그린다.
    // 구간은 끝에서 leadTouches번째 터치의 leadMs 앞부터(최대 maxSeconds초)다. 스파이크 앞 slowBeforeMs~뒤 slowAfterMs는 slowRate 배속이다.
    // 시간은 ms로 적고, 틱 번호로 구간을 자르는 리플레이(presentation/highlight.js)에 넘길 때 runtime/highlight-controller.js가 한 번 틱으로 올림한다.
    // 카메라는 측면 중계 각도(yaw·pitch, 라디안)다. 온라인은 상대와 시계를 맞춰야 하므로 멈출 수 없어 제외한다.
    // 게임 지표(gamekit metrics). 경기 기록은 TAKRAW_MODE_POLICY의 recorded 모드만 남긴다(관전·훈련 제외). 키 표는 README "게임 지표".
    metrics: {
        endpoint: 'https://bloom-metrics.byh-playground.workers.dev',
    },
    // 리플레이 대상 모드는 TAKRAW_MODE_POLICY의 replay다.
    highlight: {
        longRallyTouches: 10,
        leadTouches: 3,
        leadMs: 250,
        maxSeconds: 4,
        tailMs: 667,
        slowBeforeMs: 133,
        slowAfterMs: 500,
        slowRate: 0.35,
        camera: { yaw: 1.05, pitch: 0.36 },
        // batchMs: 워커가 계산한 포즈를 이 시간(ms)만큼 묶어 보낸다.
        batchMs: 67,
        // 워커가 이 시간(ms) 동안 다음 장면을 보내지 않으면 리플레이를 끝내고 경기를 이어 간다.
        stallMs: 1000,
    },
    // maxCatchupMs: 한 번의 루프 깨움에서 따라잡는 시뮬레이션 시간 상한(ms). 롤백 세션 프로필의 maxCatchupSteps(틱 수)로는 올림해 넘긴다(runtime/match-setup.js).
    // baseHz는 tickRate(config/game.js)·inputHz·renderHz로 나누어떨어져야 한다(gamekit simloop clockRates).
    clock: { baseHz: 120, inputHz: 60, renderHz: 60, maxCatchupMs: 66 },
    network: {
        // 신호 릴레이에서 방을 찾는 이름공간(게임 식별자). 다른 게임과 방 코드가 섞이지 않게 한다.
        namespace: TAKRAW_ID,
        // 온라인·로컬 롤백 세션이 두 피어와 맞추는 초기 시드(createRoomSession). 경기 변주 시드와는 별개다.
        sessionSeed: 7,
        timeout: 45000,
        peerTimeout: 25000,
        handshakeTimeout: 45000,
        // 신호 전달 전용 공개 Nostr 릴레이(경기는 WebRTC). 하나라도 붙으면 방을 열 수 있어 여러 곳을 둔다.
        // 2026-11-03 실측: 각 릴레이 하나만으로 두 브라우저 입장 성공한 곳만. relay.damus.io(응답 없음)·offchain.pub(방 메시지 전달 실패)은 뺐다.
        relays: [
            'wss://relay.primal.net',
            'wss://nos.lol',
            'wss://nostr.mom',
            'wss://relay.nostr.net',
            'wss://nostr.oxtr.dev',
        ],
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun.cloudflare.com:3478' },
        ],
        transitionTimeout: 20000,
        reconnectGrace: 90000,
        // 롤백·입력 지연·체크섬은 ms로 적고, 틱 개수를 요구하는 롤백 세션 프로필에 넘길 때 올림한다(runtime/match-setup.js).
        // rollbackWindowMs: 되돌려 다시 계산할 수 있는 가장 먼 과거, historyMs: 보관하는 상태 기록 길이(롤백 창보다 길어야 한다).
        // inputDelayMs: 온라인 입력 지연 기본값·최대값, checksumIntervalMs: 두 피어가 상태를 비교하는 간격.
        rollbackWindowMs: 400,
        historyMs: 2134,
        inputDelayMs: { base: 17, max: 100 },
        checksumIntervalMs: 1000,
        maxSnapshotBytes: 2 * 1024 * 1024,
        maxHistoryBytes: 64 * 1024 * 1024,
        maxReplayBytes: 8 * 1024 * 1024,
    },
    // badge: 접촉 타이밍 등급 표시가 남는 시간(ms)
    // soundPanSpread: 코트 끝에서의 좌우 치우침(0..1), soundDetuneCents: 같은 소리가 반복돼도 단조롭지 않게 매번 ±이 만큼 음높이를 흔든다.
    // soundDistanceDrop: 상대 코트 끝에서의 음량 감소 비율(0..1). 가까운 소리는 크고 먼 소리는 작아 깊이감이 난다.
    feedback: {
        duration: 430,
        badge: 900,
        // retentionMs: 확정 전 표시 사건(접촉 효과·소리)을 롤백 대비로 보관하는 시간. 틱 번호로 지우는 gamekit 큐에는 올림해 넘긴다.
        retentionMs: 3000,
        soundReferenceSpeed: 14,
        soundPanSpread: 0.7,
        soundDetuneCents: 150,
        soundDistanceDrop: 0.35,
    },
    // 배경 음악: 첫 제스처 뒤로 홈에서도 경기 중에도 작게 깔린다. 곡은 효과음 아래에 머물도록 작게 두고(level, 홈은 효과음이 없어 조금 크게 homeLevel),
    // 타격 순간에는 잠깐 더 낮춰(duck) 타격음이 곡의 멜로디(200~400Hz)에 묻히지 않게 한다. 득점 소리는 더 깊고 길게 비운다.
    // 곡은 CC0 "Head in the Sand"(assets/audio/CREDITS.md). 불러오지 못하면 음악만 없고 게임은 그대로 돌아간다.
    bgm: {
        url: new URL('../../assets/audio/head-in-the-sand.ogg', import.meta.url).href,
        level: 0.7,
        homeLevel: 0.9,
        pausedLevel: 0.35,
        fadeMs: 1500,
        levelRampMs: 300,
        duck: {
            touch: { depth: 0.55, holdMs: 90, releaseMs: 260 },
            point: { depth: 0.35, holdMs: 500, releaseMs: 700 },
        },
    },
    hud: { interval: 80 },
    audio: {
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
            // 접촉 종류별 소리(src/presentation/sound.js가 고른다).
            // 리시브: 들어온 공을 받아 죽이는 낮고 둔한 "퍽". 쿵을 길게, 밝은 클릭 대신 낮게 깎은 잡음.
            kickReceive: {
                category: 'impact',
                priority: 3,
                layers: [
                    { kind: 'tone', hz: 140, end: 58, ms: 120, gain: 0.5, type: 'sine' },
                    { kind: 'tone', hz: 230, end: 120, ms: 70, gain: 0.4, type: 'triangle' },
                    { kind: 'noise', hz: 1100, ms: 55, gain: 0.26 },
                    { kind: 'noise', hz: 3200, ms: 10, gain: 0.12 },
                ],
            },
            // 아슬아슬한 받아내기: 리시브 위에 짧은 밝은 확인음(살려냈다는 표식).
            kickSave: {
                category: 'impact',
                priority: 4,
                layers: [
                    { kind: 'tone', hz: 150, end: 52, ms: 150, gain: 0.6, type: 'sine' },
                    { kind: 'tone', hz: 240, end: 110, ms: 85, gain: 0.5, type: 'triangle' },
                    { kind: 'noise', hz: 1300, ms: 70, gain: 0.32 },
                    { kind: 'noise', hz: 5200, ms: 12, gain: 0.3 },
                    {
                        kind: 'tone',
                        hz: 784,
                        end: 1046,
                        ms: 90,
                        gain: 0.16,
                        type: 'sine',
                        delay: 30,
                    },
                ],
            },
            // 토스: 가볍고 또렷한 "톡". 낮은 쿵을 줄이고 높은 몸통과 짧은 클릭.
            kickSet: {
                category: 'impact',
                priority: 3,
                layers: [
                    { kind: 'tone', hz: 330, end: 210, ms: 45, gain: 0.32, type: 'triangle' },
                    { kind: 'tone', hz: 180, end: 110, ms: 45, gain: 0.18, type: 'sine' },
                    { kind: 'noise', hz: 4200, ms: 16, gain: 0.22 },
                    { kind: 'noise', hz: 7600, ms: 6, gain: 0.32 },
                    { kind: 'tone', hz: 1250, end: 1180, ms: 28, gain: 0.08, type: 'sine' },
                ],
            },
            // 공이 바닥에 닿는 소리: 짧고 둔한 "통". 발차기보다 낮고 클릭이 없다.
            ground: {
                category: 'impact',
                priority: 3,
                layers: [
                    { kind: 'tone', hz: 110, end: 48, ms: 110, gain: 0.5, type: 'sine' },
                    { kind: 'tone', hz: 190, end: 95, ms: 60, gain: 0.35, type: 'triangle' },
                    { kind: 'noise', hz: 700, ms: 60, gain: 0.3 },
                    { kind: 'noise', hz: 2400, ms: 14, gain: 0.14 },
                ],
            },
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
                    ...KICK_LEVELS.Hard.layers,
                    { kind: 'tone', hz: 130, end: 50, ms: 200, gain: 0.45, type: 'sine' },
                    { kind: 'tone', hz: 90, end: 36, ms: 320, gain: 0.3, type: 'sine', delay: 30 },
                    { kind: 'noise', hz: 3600, ms: 80, gain: 0.35 },
                    { kind: 'noise', hz: 6500, ms: 150, gain: 0.18, delay: 20 },
                    {
                        kind: 'tone',
                        hz: 1175,
                        end: 1760,
                        ms: 110,
                        gain: 0.22,
                        type: 'sine',
                        delay: 25,
                    },
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
                    {
                        kind: 'tone',
                        hz: 1040,
                        end: 1300,
                        ms: 80,
                        gain: 0.12,
                        type: 'sine',
                        delay: 10,
                    },
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
                    {
                        kind: 'tone',
                        hz: 988,
                        end: 1175,
                        ms: 120,
                        gain: 0.6,
                        type: 'sine',
                        delay: 260,
                    },
                    {
                        kind: 'tone',
                        hz: 1319,
                        end: 1319,
                        ms: 150,
                        gain: 0.5,
                        type: 'sine',
                        delay: 390,
                    },
                ],
            },
        },
        // 음원 베드: 게임이 읽어 디코드한 곡을 setBuffer('bgm')로 등록하면 루프로 깔린다.
        beds: {
            // 곡 원본을 최대한 그대로 쓰고(컴프레서·로우패스는 거칠게 들려 뺐다, v0.12.76) 이퀄라이저만 조금 다듬는다(v0.12.77, 청취로 고른 "C" 설정).
            // 곡의 0~3초와 20~22초(루프 중간)는 본체와 달리 노이즈 채널 퍼커션이다(무게중심 1.4kHz, 2kHz 이상 25%). 본체는 2kHz 이상이 0~3%, 500Hz~2kHz도 1% 안팎이다.
            // 그래서 500Hz~2.5kHz 이상의 노이즈 대역만 덜어 내면 본체는 거의 그대로(-0.6dB)이고 노이즈 구간의 중고음만 줄어든다(도입부 2kHz 이상 약 -6dB).
            // 같은 구간은 에너지의 25~27%가 40Hz 아래 초저음이다(본체 6%). 작은 스피커가 못 내고 찌그러짐·버징만 만들며 마스터 컴프레서도 누르므로 80Hz 로우컷으로 걷어 낸다.
            bgm: {
                category: 'music',
                layers: [
                    {
                        kind: 'buffer',
                        bufferId: 'bgm',
                        gain: 1,
                        lowCutHz: 80,
                        eq: [
                            { type: 'peaking', hz: 700, gainDb: -3, q: 0.8 },
                            { type: 'peaking', hz: 1400, gainDb: -5, q: 0.7 },
                            { type: 'highshelf', hz: 2500, gainDb: -6 },
                        ],
                    },
                ],
            },
        },
    },
});

export { TAKRAW_RUNTIME, TAKRAW_KICK_SOUND, TAKRAW_MODE_POLICY };
