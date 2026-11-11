/**
 * 선수 id 배치의 단일 출처. 팀 t의 선수는 id t*3 .. t*3+2이고, 슬롯 순서는 리시버·세터·공격수다.
 * 사람이 직접 조종하는 선수는 각 팀의 공격수다(경기 시작 때 선택 선수 [2, 5]).
 * 시뮬레이션·물리·화면이 id에서 팀·슬롯을 읽을 때 이 함수를 쓴다.
 */
const TAKRAW_ROLES = Object.freeze(['receiver', 'setter', 'attacker']);
const TAKRAW_TEAM_SIZE = TAKRAW_ROLES.length;
const TAKRAW_ATTACKER_SLOT = TAKRAW_ROLES.indexOf('attacker');

/** 팀의 슬롯(0 리시버, 1 세터, 2 공격수)에 있는 선수 id. */
const takrawPlayerId = (team, slot) => team * TAKRAW_TEAM_SIZE + slot;
const takrawTeamOf = (playerId) => Math.floor(playerId / TAKRAW_TEAM_SIZE);
const takrawSlotOf = (playerId) => playerId % TAKRAW_TEAM_SIZE;
/** 팀 하나의 선수 id 목록. 매 프레임 부르는 곳에서 배열을 새로 만들지 않도록 미리 만들어 둔다. */
const TAKRAW_TEAM_PLAYER_IDS = Object.freeze(
    [0, 1].map((team) =>
        Object.freeze(TAKRAW_ROLES.map((role, slot) => takrawPlayerId(team, slot))),
    ),
);
/** 스파이크 연습에서 토스를 올려 주는 선수: 사람 팀(0)의 세터. */
const TAKRAW_TRAINING_SETTER_ID = takrawPlayerId(0, TAKRAW_ROLES.indexOf('setter'));
/** 공격수인 선수인가. */
const takrawIsAttacker = (playerId) => takrawSlotOf(playerId) === TAKRAW_ATTACKER_SLOT;
/** 사람이 조종하는 선수(팀의 공격수) id. */
const takrawHumanPlayerId = (team) => takrawPlayerId(team, TAKRAW_ATTACKER_SLOT);
/** 두 팀의 조종 선수 id. 상태에 담겨 바뀌고 저장되므로 부를 때마다 새 배열이다. */
const takrawHumanPlayerIds = () => [takrawHumanPlayerId(0), takrawHumanPlayerId(1)];

export {
    TAKRAW_ROLES,
    TAKRAW_TEAM_SIZE,
    TAKRAW_TEAM_PLAYER_IDS,
    TAKRAW_TRAINING_SETTER_ID,
    takrawPlayerId,
    takrawTeamOf,
    takrawSlotOf,
    takrawIsAttacker,
    takrawHumanPlayerId,
    takrawHumanPlayerIds,
};
