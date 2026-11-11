import { profiles } from '@bloom-gamekit/rollback';
import { hashBytes } from '@bloom-gamekit/deterministic';
import {
    TAKRAW_SCHOOLS,
    takrawOpponents,
    takrawSchool,
    takrawWatchSchools,
} from '../config/schools.js';
import { TAKRAW_RUNTIME } from '../config/runtime.js';
import { LOCALE } from '../i18n/locale.js';
import { roleName } from '../i18n/messages/match.js';

/** 클럽 편성(선수 이름이 TextPair)을 시뮬레이션이 받는 문자열 이름으로. 시뮬레이션은 언어를 모른다. */
const localizedTeam = (team) =>
    team && {
        ...team,
        players: team.players.map((player) => ({ ...player, name: LOCALE.text(player.name) })),
    };

/**
 * 경기 하나의 두 학교·두 팀·AI 성향·시드. 아무 상태도 바꾸지 않는다.
 * home·homeTeam·randomSeed는 필요한 모드에서만 부르는 조회 함수다(관전·온라인은 클럽을 읽지 않고, 정해진 시드가 있으면 난수를 뽑지 않는다).
 *   내 학교는 저장된 값이다. 온라인은 두 사람의 화면이 같도록 고정 학교 쌍을 쓴다. 퀵 대전(도전 학교 없음)의 상대는 가장 높은 단계다.
 *   경기마다 AI 성향·서브가 달라지도록 시드를 정한다. 온라인은 두 사람이 같은 방 코드에서 같은 시드를 얻고, 혼자 하는 경기는 새 값이다.
 */
function takrawMatchSetup({
    mode,
    home,
    homeTeam,
    campaignSchoolId,
    watchSeed,
    roomCode,
    debugSeed,
    randomSeed,
}) {
    const watching = mode === 'watch';
    const homeSchool =
        mode === 'online' || watching
            ? TAKRAW_SCHOOLS[0]
            : takrawSchool(home()) || TAKRAW_SCHOOLS[0];
    const opponents = takrawOpponents(homeSchool.id);
    const opponent =
        opponents.find((school) => school.id === campaignSchoolId) ||
        opponents[opponents.length - 1];
    const schoolAi = mode === 'match' ? opponent.ai : null;
    return {
        schools: watching
            ? takrawWatchSchools(watchSeed)
            : [homeSchool, mode === 'match' ? opponent : opponents[0]],
        home: ['match', 'training'].includes(mode) ? localizedTeam(homeTeam()) : null,
        away: schoolAi
            ? {
                  name: LOCALE.text(opponent.name),
                  players: schoolAi.players.map((preset) => ({
                      id: `${opponent.id}-${preset.role}`,
                      name: roleName(preset.role, LOCALE.locale),
                      role: preset.role,
                      stats: { ...preset.stats },
                  })),
              }
            : null,
        temperaments: [null, schoolAi?.temperament || null],
        seed: watching
            ? watchSeed
            : mode === 'online'
              ? hashBytes(new TextEncoder().encode(roomCode))
              : mode === 'training'
                ? undefined
                : mode === 'match' && debugSeed !== null
                  ? debugSeed
                  : randomSeed(),
    };
}

/** 롤백 세션 프로필. 온라인은 롤백, 혼자·로컬 2인은 지연 없는 락스텝이다. */
function takrawSessionProfile({ online, tickRate }) {
    return online
        ? {
              ...profiles.action,
              mode: 'rollback',
              tickRate,
              baseInputDelayTicks: 1,
              minInputDelayTicks: 0,
              maxInputDelayTicks: 6,
              rollbackWindowTicks: TAKRAW_RUNTIME.network.rollbackWindow,
              stateHistorySize: TAKRAW_RUNTIME.network.historySize,
              checksumInterval: tickRate,
              maxCatchupSteps: TAKRAW_RUNTIME.clock.maxCatchupSteps,
              maxSnapshotBytes: TAKRAW_RUNTIME.network.maxSnapshotBytes,
              maxHistoryBytes: TAKRAW_RUNTIME.network.maxHistoryBytes,
              maxReplayBytes: TAKRAW_RUNTIME.network.maxReplayBytes,
          }
        : {
              ...profiles.lockstep,
              mode: 'lockstep',
              tickRate,
              baseInputDelayTicks: 0,
              minInputDelayTicks: 0,
              maxInputDelayTicks: 0,
              adaptiveInputDelay: false,
              pacingPolicy: 'none',
              maxCatchupSteps: TAKRAW_RUNTIME.clock.maxCatchupSteps,
          };
}

export { takrawMatchSetup, takrawSessionProfile };
