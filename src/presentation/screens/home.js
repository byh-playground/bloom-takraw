import { createTextSetter } from '../markup.js';
import { UI } from '../../i18n/messages/ui.js';

/** 처음 화면의 안쪽 단계와 그 부모 화면. 뒤로 버튼·Esc·브라우저 뒤로가 같은 길을 간다. */
const HOME_PARENT = { start: '', multi: 'start' };

/** 처음 화면(home-panel): 보이는 단계(view), 시작 버튼의 사용 가능 여부, 팀 요약 줄. */
class TakrawHomeScreen {
    constructor() {
        this.view = 'main';
        this.back = document.getElementById('home-back');
        this.text = createTextSetter();
    }

    /** 처음 화면 안쪽 단계(start·multi)인가. */
    isStep(screen) {
        return HOME_PARENT[screen] !== undefined;
    }

    /** 지금 단계의 한 단계 위 화면('' = 처음). */
    parent() {
        return HOME_PARENT[this.view];
    }

    /** 메인 화면의 계층(처음 → 게임 시작 → 멀티플레이) 중 보일 단계를 고른다. 한 번에 한 단계만 보이고, 뒤로 버튼은 헤더의 고정 자리에서 한 단계 위로 간다. */
    setView(view, focus = true) {
        this.view = view;
        document.body.dataset.homeView = view;
        for (const node of document.querySelectorAll('[data-home-view]'))
            node.hidden = node.dataset.homeView !== view;
        this.back.hidden = view === 'main';
        if (focus)
            document
                .querySelector(`[data-home-view="${view}"] button`)
                ?.focus({ preventScroll: true });
    }

    /** 처음 화면에서 보이는 단계의 주소. 대화상자를 닫으면 이 단계로 돌아온다. */
    route() {
        return this.view === 'main' ? '' : this.view;
    }

    updateStartButtons(canStart) {
        for (const button of document.querySelectorAll('.start-button')) {
            const mode = button.dataset.startMode;
            button.disabled = !canStart(mode);
        }
    }

    /** 홈의 팀 관리 버튼 아래 요약 줄. 불러오는 중·저장 중·오류는 상태를, 준비되면 팀 이름과 인원을 보인다. */
    setClubSummary(value) {
        const status = {
            loading: UI.clubLoadingHome,
            saving: UI.clubSavingHome,
            conflict: UI.clubConflictHome,
            error: value.locked ? UI.clubLockedHome : UI.clubErrorHome,
        }[value.status];
        this.text(
            'club-home-summary',
            status
                ? status()
                : value.teamName
                  ? UI.clubSummary({ name: value.teamName, count: value.roster.length })
                  : UI.clubHint(),
        );
    }
}

export { TakrawHomeScreen };
