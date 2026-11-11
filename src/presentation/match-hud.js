import { TAKRAW_SCHOOLS, takrawSchool } from '../config/schools.js';
import { TAKRAW_MODE_POLICY, TAKRAW_RUNTIME } from '../config/runtime.js';
import { TAKRAW_MODES } from '../simulation/modes.js';
import { TAKRAW_CONFIG, TAKRAW_TIMING_GRADES } from '../config/game.js';
import { takrawMatchStatus } from './match-status.js';
import { say, createTextSetter } from './markup.js';
import { UI } from '../i18n/messages/ui.js';
import { matchText } from '../i18n/messages/match.js';

/**
 * 경기 화면 HUD: 점수판·랠리 안내·선수 상태·접촉 등급·큰 글자 팝업·득점 리플레이 표시·관전 입력칸·경기 끝 창.
 * 상태는 DOM과 리플레이 중 여부(replaying)·표시 토큰뿐이다. 내 학교는 조회 함수(homeSchool)로 읽는다.
 */
class TakrawMatchHud {
    constructor({ listen, click, callbacks, controlText, homeSchool }) {
        this.callbacks = callbacks;
        this.controlText = controlText;
        this.homeSchool = homeSchool;
        this.text = createTextSetter();
        this.node = document.getElementById('match-hud');
        this.endActions = document.getElementById('end-actions');
        this.replaying = false;
        this.timingToken = null;
        this.hitPopToken = null;
        for (const id of ['sets-0', 'sets-1'])
            document.getElementById(id).hidden = TAKRAW_CONFIG.rules.sets === 1;
        const watchSeed = () => document.getElementById('watch-seed');
        listen(document.getElementById('watch-form'), 'submit', (event) => {
            event.preventDefault();
            this.callbacks.onWatch?.(watchSeed().value);
        });
        for (const button of document.querySelectorAll('[data-watch-step]'))
            listen(button, 'click', () => {
                watchSeed().value = Math.max(
                    0,
                    Number(watchSeed().value || 0) + Number(button.dataset.watchStep),
                );
                this.callbacks.onWatch?.(watchSeed().value);
            });
        const featured = document.getElementById('watch-featured');
        const featuredLabel = (item) =>
            item.closest !== undefined ? UI.featuredClosest(item) : UI.featuredDigs(item);
        featured.replaceChildren(
            new Option(UI.featured(), ''),
            ...TAKRAW_RUNTIME.watch.featured.map(
                (item) => new Option(featuredLabel(item), item.seed),
            ),
        );
        listen(featured, 'change', () => {
            if (featured.value) {
                watchSeed().value = featured.value;
                this.callbacks.onWatch?.(featured.value);
            }
        });
        click('watch-random', () => {
            watchSeed().value = Math.floor(Math.random() * (TAKRAW_RUNTIME.watch.randomMax + 1));
            this.callbacks.onWatch?.(watchSeed().value);
        });
    }

    /** 경기를 열 때 모드별 HUD 칸을 고르고 팀 이름 칸을 모드 기본값으로 둔다. */
    show(mode) {
        const policy = TAKRAW_MODE_POLICY[mode],
            flags = TAKRAW_MODES[mode];
        this.node.hidden = false;
        document.getElementById('watch-form').hidden = !policy?.watchSeed;
        document.getElementById('training-actions').hidden = !flags?.drill;
        document.getElementById('local-guide').hidden = !flags?.secondaryInput;
        this.endActions.hidden = true;
        document
            .querySelector('.scoreboard')
            .classList.toggle('is-training', Boolean(flags?.drill));
        this.text('team-label-0', flags?.secondaryInput ? UI.local1P() : UI.us()); // 온라인·관전은 경기가 시작되면 알려 온 팀 이름·학교 이름으로 바뀐다
        this.text('team-label-1', flags?.secondaryInput ? UI.local2P() : UI.them());
        this.text(
            'match-type',
            {
                training: UI.modeTraining,
                match: UI.modeMatch,
                local: UI.modeLocal,
                online: UI.modeOnline,
                watch: UI.modeWatch,
            }[mode](),
        );
    }

    hide() {
        this.node.hidden = true;
        document.getElementById('watch-form').hidden = true;
    }

    /**
     * 접촉 타이밍 등급을 표시한다. 반환된 토큰으로 hideTiming하면 그 표시만 지운다.
     * 짧은 간격의 접촉이 겹쳐도 먼저 끝난 표시가 나중 표시를 지우지 않는다.
     */
    showTiming(timing) {
        const labels = {
            [TAKRAW_TIMING_GRADES.perfect]: UI.timingPerfect,
            [TAKRAW_TIMING_GRADES.good]: UI.timingGood,
        };
        const label = (
            labels[timing.grade] || (timing.error < 0 ? UI.timingEarly : UI.timingLate)
        )();
        const milliseconds = Math.round(timing.error * 1000);
        const badge = document.getElementById('timing-badge');
        this.text('timing-grade', label);
        this.text('timing-offset', `${milliseconds > 0 ? '+' : ''}${milliseconds}ms`);
        badge.dataset.grade = timing.grade;
        badge.hidden = false;
        badge.style.animation = 'none';
        void badge.offsetWidth;
        badge.style.animation = '';
        this.timingToken = { grade: timing.grade };
        return this.timingToken;
    }

    /** 득점 리플레이 표시. reason('spike'|'rally')이면 보이고 null이면 숨긴다. 재생 중에는 화면 어디를 눌러도 건너뛴다. */
    showReplay(reason) {
        this.replaying = !!reason;
        const overlay = document.getElementById('replay-overlay');
        overlay.hidden = !reason;
        if (reason) document.body.dataset.replay = reason;
        else delete document.body.dataset.replay;
        if (reason) {
            this.text('replay-reason', reason === 'spike' ? UI.replaySpike() : UI.replayRally());
            this.hideHitPop(this.hitPopToken);
            this.hideTiming(this.timingToken);
        }
    }

    /** 큰 글자 팝업("SPIKE!" 등). 반환된 토큰으로 hideHitPop하면 그 표시만 지운다. */
    showHitPop(text, team) {
        const pop = document.getElementById('hit-pop');
        this.text('hit-pop', text);
        pop.dataset.team = String(team === 1 ? 1 : 0);
        pop.hidden = false;
        pop.style.animation = 'none';
        void pop.offsetWidth;
        pop.style.animation = '';
        this.hitPopToken = { text };
        return this.hitPopToken;
    }

    hideHitPop(token) {
        if (!token || this.hitPopToken !== token) return;
        this.hitPopToken = null;
        document.getElementById('hit-pop').hidden = true;
    }

    hideTiming(token) {
        if (!token || this.timingToken !== token) return;
        this.timingToken = null;
        document.getElementById('timing-badge').hidden = true;
    }

    update(hud, mode) {
        const policy = TAKRAW_MODE_POLICY[mode],
            flags = TAKRAW_MODES[mode];
        this.text('score-0', hud.score?.[0] ?? 0);
        this.text('score-1', hud.score?.[1] ?? 0);
        document.getElementById('set-number').hidden =
            TAKRAW_CONFIG.rules.sets === 1 && !flags?.drill; // 훈련은 이 칸을 안내 문구로 쓴다.
        this.text(
            'set-number',
            flags?.drill ? UI.trainingSetLabel() : UI.setNumber({ set: hud.set ?? 1 }),
        );
        for (let team = 0; team < 2; team++) {
            const count = hud.sets?.[team] ?? 0,
                node = document.getElementById(`sets-${team}`);
            for (let i = 0; i < node.children.length; i++)
                node.children[i].classList.toggle('won', i < count);
            node.setAttribute('aria-label', UI.setsWon({ count }));
        }
        const phases = {
            ready: UI.phaseReady,
            rally: UI.phaseRally,
            point: UI.phasePoint,
            finished: UI.phaseFinished,
        };
        this.text(
            'rally-status',
            flags?.drill ? UI.modeTraining() : (phases[hud.phase] || UI.phaseIdle)(),
        );
        const touch = document.querySelector('#touch-indicator b'),
            touches = String(hud.touches ?? 0);
        if (touch.textContent !== touches) touch.textContent = touches;
        this.text(
            'touch-team',
            hud.possession === 0 || hud.possession === 1
                ? UI.touchTeam({ own: hud.possession === hud.localTeam })
                : UI.touch(),
        );
        // 팀 안내(teamPlay)는 이미 내 팀 시점이고, 마지막 소식(lastMessage)은 team 값을 내 팀 기준으로 바꿔 읽는다.
        const teamPlay = hud.teamPlay,
            notice = matchText(teamPlay?.title) || matchText(hud.lastMessage, hud.localTeam ?? 0);
        this.text('rally-notice', notice);
        this.text('rally-detail', this.controlText(matchText(teamPlay?.detail)));
        const callout = document.getElementById('rally-callout'),
            tone = teamPlay?.tone || 'neutral';
        callout.hidden = !notice;
        if (callout.dataset.tone !== tone) callout.dataset.tone = tone;
        this.text('selected-name', hud.selectedName || UI.attacker());
        if (hud.teamNames && !flags?.secondaryInput) {
            this.text('team-label-0', hud.teamNames[0] ?? UI.us());
            this.text('team-label-1', hud.teamNames[1] ?? UI.them());
        }
        this.updateTeamColors(hud, mode);
        this.text('selected-state', hud.selectedState || UI.stateReady());
        const status = takrawMatchStatus(hud, TAKRAW_CONFIG.rules),
            banner = document.getElementById('match-banner');
        const teamName = (team) => document.getElementById(`team-label-${team}`).textContent;
        banner.textContent = status.matchPointTeams.length
            ? status.matchPointTeams.length === 2
                ? UI.bothMatchPoint()
                : UI.matchPoint({ team: teamName(status.matchPointTeams[0]) })
            : status.deuce
              ? UI.deuce({ a: hud.score[0], b: hud.score[1] })
              : '';
        banner.hidden = !(flags?.scoring ?? true) || !banner.textContent;
        document.getElementById('jump-light').classList.toggle('held', !!hud.jumpHeld);
        document.getElementById('kick-light').classList.toggle('held', !!hud.kickHeld);
        const meter = document.getElementById('toss-meter');
        meter.hidden = !hud.tossReady;
        meter.querySelector('i').style.width = `${Math.round(100 * (hud.tossCharge || 0))}%`;
        if (hud.watch) {
            const input = document.getElementById('watch-seed');
            if (document.activeElement !== input && input.value !== String(hud.watch.seed))
                input.value = hud.watch.seed;
            this.text('watch-tick', UI.watchTick({ tick: hud.watch.tick }));
            const featured = document.getElementById('watch-featured');
            if (featured.value !== String(hud.watch.seed))
                featured.value = [...featured.options].some(
                    (option) => option.value === String(hud.watch.seed),
                )
                    ? String(hud.watch.seed)
                    : '';
        }
        const ended = hud.phase === 'finished';
        this.endActions.hidden = !ended;
        this.endActions.dataset.result = hud.matchWinner === (hud.localTeam || 0) ? 'win' : 'loss';
        if (ended) {
            const winnerSchool =
                hud.matchWinner === 0
                    ? takrawSchool(this.homeSchool()) || TAKRAW_SCHOOLS[0]
                    : TAKRAW_SCHOOLS.find((value) => say(value.name) === hud.teamNames?.[1]) ||
                      TAKRAW_SCHOOLS[1];
            const accent = hud.teamColors?.[hud.matchWinner] ?? winnerSchool.uniform.primary;
            this.endActions.style.setProperty(
                '--result-accent',
                `#${accent.toString(16).padStart(6, '0')}`,
            );
        }
        const school = TAKRAW_SCHOOLS.find((value) => value.id === hud.campaignSchoolId),
            schoolResult = document.getElementById('school-result');
        schoolResult.hidden = !ended || !school;
        if (school && ended) {
            const clear =
                hud.matchReward?.status === 'saved'
                    ? UI.schoolClear()
                    : hud.matchReward?.status === 'error'
                      ? UI.schoolRetrySave()
                      : UI.schoolSaving();
            schoolResult.textContent =
                hud.matchWinner === 0
                    ? UI.schoolBeaten({ school: say(school.name), clear })
                    : UI.schoolLost({ school: say(school.name) });
        }
        this.text('match-reward', hud.matchReward?.message || '');
        document.getElementById('reward-retry').hidden = hud.matchReward?.status !== 'error';
        const guest = policy?.restart === 'hostCommand' && hud.localTeam !== 0;
        document.getElementById('rematch-button').disabled = guest;
        document.getElementById('rematch-hint').hidden = !(ended && guest);
        if (ended)
            this.text(
                'match-result',
                flags?.secondaryInput
                    ? UI.localWin({ side: hud.matchWinner === 0 ? '1P' : '2P' })
                    : policy?.namedTeams
                      ? UI.teamWin({ team: hud.teamNames?.[hud.matchWinner] ?? UI.them() })
                      : hud.matchWinner === 0
                        ? UI.youWin()
                        : UI.youLose(),
            );
    }

    /** 온라인·관전 점수판: 팀 이름 옆에 그 학교 유니폼 색 점을 찍고, 내 쪽에는 '나' 표시(.me-badge)를 켠다. */
    updateTeamColors(hud, mode) {
        const policy = TAKRAW_MODE_POLICY[mode];
        const colored = Boolean(policy?.namedTeams) && Array.isArray(hud.teamColors);
        document.querySelectorAll('.score-team').forEach((node, team) => {
            const color = colored ? `#${hud.teamColors[team].toString(16).padStart(6, '0')}` : '';
            if (node.dataset.dot !== color) {
                node.dataset.dot = color;
                if (color) node.style.setProperty('--team-dot', color);
                else node.style.removeProperty('--team-dot');
            }
            const me = policy?.room && hud.localTeam === team ? 'true' : '';
            if ((node.dataset.me || '') !== me) {
                if (me) node.dataset.me = me;
                else delete node.dataset.me;
            }
        });
    }
}

export { TakrawMatchHud };
