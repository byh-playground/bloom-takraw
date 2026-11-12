import { takrawWatchSchools } from '../config/schools.js';
import { TAKRAW_TRAINING_LESSONS } from '../simulation/training.js';
import { takrawIdentitySchools } from '../simulation/identity.js';
import { TAKRAW_HUMAN_ROLE, takrawHumanPlayerId } from '../simulation/roster.js';
import { takrawTrainingCoach } from '../presentation/training-coach.js';
import { LOCALE } from '../i18n/locale.js';
import { RUNTIME } from '../i18n/messages/runtime.js';
import { TAKRAW_MODE_POLICY, TAKRAW_RUNTIME } from '../config/runtime.js';
import { TAKRAW_MODES } from '../simulation/modes.js';
import { roleName } from '../i18n/messages/match.js';

// physics.js가 내는 선수 상태(standing·moving·airborne·kicking·overhead·falling·recovering)의 문구. moving은 접지 여부로 정한다.
const PLAYER_STATE_LABELS = Object.freeze({
    standing: RUNTIME.stateReady,
    airborne: RUNTIME.stateAir,
    falling: RUNTIME.stateFall,
    kicking: RUNTIME.stateKick,
    overhead: RUNTIME.stateSpike,
    recovering: RUNTIME.stateGettingUp,
});

/**
 * 경기 HUD 한 장면(ui.update가 받는 값). 시뮬레이션 뷰와 세션 사실에서만 만들고 아무것도 바꾸지 않는다.
 *   view: game.getView(), team: 보는 팀, tick: 관전 표시용 경기 틱, matchReward·campaignSchoolId: 이 경기의 보상 상태,
 *   connection: 연결 표시 문구, maxLead: 연습 안내 예측 범위(config.visual.attackGuide.maxLead)
 */
function takrawHudModel({
    view,
    mode,
    team,
    watchSeed,
    tick,
    matchReward,
    campaignSchoolId,
    connection,
    maxLead,
}) {
    const selectedId = view.state.selected?.[team] ?? takrawHumanPlayerId(team);
    const player = view.players.find((candidate) => candidate.id === selectedId);
    const policy = TAKRAW_MODE_POLICY[mode];
    const motion = TAKRAW_TRAINING_LESSONS.find((lesson) => lesson.id === player?.motionId),
        attacker = roleName(TAKRAW_HUMAN_ROLE, LOCALE.locale);
    return {
        ...view.state,
        // 시뮬레이션은 연습 사실만 내고, 단계·문구·진행 막대는 coach가 표시 설정으로 만든다.
        training: takrawTrainingCoach(view.training, { maxLead }),
        teamPlay: view.teamPlay?.[team] || null,
        teamNames: policy?.watchSeed
            ? takrawWatchSchools(watchSeed).map((school) => LOCALE.text(school.name))
            : view.teamNames,
        teamColors: policy?.announcesTeam
            ? takrawIdentitySchools(view.teamSchools).map((school) => school.uniform.primary)
            : policy?.watchSeed
              ? takrawWatchSchools(watchSeed).map((school) => school.uniform.primary)
              : null,
        matchReward,
        campaignSchoolId,
        localTeam: team,
        selectedName: player?.name
            ? RUNTIME.playerOf({ name: player.name, role: attacker })
            : attacker,
        selectedState: motion
            ? LOCALE.text(motion.title)
            : player
              ? (
                    PLAYER_STATE_LABELS[player.state] ||
                    (player.grounded ? RUNTIME.stateReady : RUNTIME.stateAir)
                )()
              : '',
        kickHeld: Boolean(player?.kickHeld),
        jumpHeld: Boolean(player?.jumpHeld),
        tossReady: Boolean(player?.tossReady),
        tossCharge: Number(player?.tossCharge) || 0,
        connection: policy?.room ? connection : '',
        watch: policy?.watchSeed ? { seed: watchSeed, tick } : null,
    };
}

/**
 * HUD를 다시 그릴 때인지 정하는 시계. 훈련은 코치 표시가 따라오도록 최소 30Hz, 나머지는 hud.interval 간격이다.
 * invalidate()는 다음 프레임에 바로 그리게 한다(경기 시작·보상 저장 결과).
 */
class HudClock {
    constructor() {
        this.at = -Infinity;
    }

    invalidate() {
        this.at = -Infinity;
    }

    /** 그릴 때면 시각을 기록하고 true. */
    due(now, mode) {
        const interval = TAKRAW_MODES[mode]?.drill
            ? Math.min(TAKRAW_RUNTIME.hud.interval, 1000 / 30)
            : TAKRAW_RUNTIME.hud.interval;
        if (now - this.at < interval) return false;
        this.at = now;
        return true;
    }
}

export { takrawHudModel, HudClock };
