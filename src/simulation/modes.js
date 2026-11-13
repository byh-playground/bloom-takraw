/**
 * 경기 모드별 능력의 단일 출처. 시뮬레이션은 모드 이름 대신 이 값을 읽는다(DEV-004).
 * 모드 이름은 runtime이 game.reset(mode)로 넘기고 스냅샷(mode)에 저장되며, 프로필은 이름에서 파생한다.
 * 플래그 하나는 한 가지 뜻이고, 어느 분기가 어느 플래그를 읽는지는 docs/architecture.md의 표가 정리한다.
 * 리플레이 워커도 game.js를 통해 이 파일을 읽으므로 상대 import만 쓴다.
 *
 * - humanInput: 팀별로 사람 입력을 받는가(받지 않는 팀은 들어온 입력을 버리고 AI가 조종한다).
 * - waitsForPeers: 두 사람이 모일 때까지 경기를 멈추고 기다린다(온라인).
 * - repeatable: 같은 상황을 반복한다(시드를 받지 않고 고정 시드, 토스 흩어짐 없음).
 * - drill: 랠리가 연습 시도다. 연습 기록·레슨/토스 명령·세터 공급·연습 시간과 문구·같은 공 재시도·시간 초과·
 *   토스 뒤 공격 안내·세터만 움직이는 AI를 연습 규칙이 정한다.
 * - serve: 랠리가 서브로 시작한다(서브 자리 배치·사람 서버·서브 발차기 목표).
 * - scoring: 점수·세트·서브권이 바뀐다.
 * - defense: 받기 수비 배정과 사람 받기 보조가 있다(배정 해제·다시 판단 포함).
 * - formation: 사람 팀의 AI 동료가 대형 자리를 채운다.
 * - teamPlay: 팀 시점의 플레이 안내를 낸다.
 * - aiTeams: 팀별로 AI 선수가 움직이는가.
 */
const defineMode = (profile) =>
    Object.freeze({
        ...profile,
        humanInput: Object.freeze(profile.humanInput),
        aiTeams: Object.freeze(profile.aiTeams),
    });

const MATCH_RULES = Object.freeze({
    waitsForPeers: false,
    repeatable: false,
    drill: false,
    serve: true,
    scoring: true,
    defense: true,
    formation: true,
    teamPlay: true,
    aiTeams: [true, true],
});

const TAKRAW_MODES = Object.freeze({
    match: defineMode({ ...MATCH_RULES, humanInput: [true, false] }),
    online: defineMode({ ...MATCH_RULES, humanInput: [true, true], waitsForPeers: true }),
    watch: defineMode({ ...MATCH_RULES, humanInput: [false, false] }),
    training: defineMode({
        humanInput: [true, false],
        waitsForPeers: false,
        repeatable: true,
        drill: true,
        serve: false,
        scoring: false,
        defense: false,
        formation: false,
        teamPlay: false,
        aiTeams: [true, false],
    }),
});

/** 모드 이름의 프로필. 모르는 이름이면 오류다. */
function takrawModeProfile(mode) {
    const profile = Object.hasOwn(TAKRAW_MODES, mode) ? TAKRAW_MODES[mode] : null;
    if (!profile) throw new Error(`알 수 없는 경기 모드: ${mode}`);
    return profile;
}

export { TAKRAW_MODES, takrawModeProfile };
