import { TAKRAW_VERSION } from '../config/game.js';
import { TAKRAW_MODES } from '../simulation/modes.js';
import { copyDiagnostic } from '@bloom-gamekit/debug-tools';
import { createNavigation } from '@bloom-gamekit/navigation';
import { takrawRoute } from './routes.js';
import { UI } from '../i18n/messages/ui.js';
import { TakrawTouchControls } from './touch-controls.js';
import { TakrawMatchHud } from './match-hud.js';
import { TakrawTrainingPanel } from './training-panel.js';
import { TakrawHomeScreen } from './screens/home.js';
import { TakrawClubScreen } from './screens/club.js';
import { TakrawCampaignScreen } from './screens/campaign.js';
import { TakrawDrawStage } from './screens/draw-stage.js';
import { TakrawSettingsScreen } from './screens/settings.js';
import { TakrawPauseScreen } from './screens/pause.js';
import { TakrawNetworkScreen } from './screens/network.js';

class TakrawUI {
    constructor(callbacks, network) {
        this.callbacks = callbacks;
        this.canvas = document.getElementById('court-canvas');
        this.canvas.tabIndex = -1;
        this.inGame = false;
        this.mode = 'match';
        this.dialog = '';
        this.controller = new AbortController();
        this.previousFocus = null;
        this.diagnosticTimer = null; // 진단 복사 버튼 글을 되돌리는 타이머
        this.homeShown = false;
        this.nodes = {};
        for (const id of [
            'home-panel',
            'modal-layer',
            'dialog-panel',
            'dialog-title',
            'dialog-kicker',
            'dialog-content',
            'boot-status',
            'boot-message',
            'reload-button',
            'fatal-panel',
            'fatal-message',
            'copy-diagnostic-button',
            'diagnostic-text',
            'dialog-back',
            'draw-stage',
            'connection-indicator',
        ])
            this.nodes[id] = document.getElementById(id);
        this.coarse = window.matchMedia('(pointer: coarse)');
        this.showcase = 'showcase' in document.body.dataset; // 소개영상 iframe 안의 게임(?showcaseDemo=1)
        document.getElementById('version-label').textContent = TAKRAW_VERSION;
        this.home = new TakrawHomeScreen();
        const listen = (...args) => this.listen(...args),
            content = this.nodes['dialog-content'];
        this.drawStage = new TakrawDrawStage({
            showcase: this.showcase,
            club: () => this.screens.club.club,
            busy: () => this.screens.club.busy,
            onDone: (id) => this.screens.club.showJoined(id),
            onLater: () => this.screens.club.render('draw-button'),
            onResolve: (payload) => this.screens.club.action('resolve', payload),
        });
        // 대화상자 화면. 키는 주소의 화면 이름(applyRoute·openDialog·dialogClick이 같은 키를 쓴다).
        this.screens = {
            club: new TakrawClubScreen({
                node: content,
                back: this.nodes['dialog-back'],
                listen,
                drawStage: this.drawStage,
                isOpen: () => this.dialog === 'club',
                inGame: () => this.inGame,
                navigate: (screen, item) => this.navigate(screen, item),
                updateStartButtons: () => this.updateStartButtons(),
                callbacks: this.callbacks,
            }),
            campaign: new TakrawCampaignScreen({
                node: content,
                club: () => this.screens.club.club,
                mergeClub: (view) => this.screens.club.merge(view),
                inGame: () => this.inGame,
                isOpen: () => this.dialog === 'campaign',
                callbacks: this.callbacks,
            }),
            settings: new TakrawSettingsScreen({
                node: content,
                coarse: this.coarse,
                inGame: () => this.inGame,
                isOpen: () => this.dialog === 'settings',
                close: () => this.closeDialog(),
                callbacks: this.callbacks,
            }),
            pause: new TakrawPauseScreen({
                mode: () => this.mode,
                close: () => this.closeDialog(),
                quit: () => this.quit(),
                callbacks: this.callbacks,
            }),
            network: new TakrawNetworkScreen({
                node: content,
                indicator: this.nodes['connection-indicator'],
                value: network,
                isOpen: () => this.dialog === 'network',
                // 방 닫기 버튼: 연결은 이미 닫았으니 창만 닫는다.
                hide: () => {
                    this.hideDialog(true);
                    this.setRoute(this.inGame ? 'play' : this.home.route());
                },
                callbacks: this.callbacks,
            }),
        };
        // 주소와 브라우저 이력은 gamekit navigation이 소유한다. 이력 복원(뒤로·앞으로·주소 입력)에만 화면을 맞추고,
        // 내부 이동은 navigate가 주소를 바꾼 뒤 직접 화면을 맞춘다.
        this.routes = createNavigation({ normalize: takrawRoute });
        // 화면 이동 지표(onScreen)도 주소가 확정되는 이 한 곳에서 받는다. 같은 화면 반복은 받는 쪽(runtime)이 거른다.
        this.routes.subscribe((route, { source }) => {
            this.callbacks.onScreen?.(route.screen);
            if (source === 'history') this.applyRoute(route);
        });
        this.bind();
        this.syncInputMode();
        this.applyRoute(this.routes.snapshot());
        // 처음 주소('' = main)는 발행되지 않아 처음 화면 진입을 여기서 한 번 알린다.
        this.callbacks.onScreen?.(this.routes.snapshot().screen);
    }

    /** 소리·그래픽 품질 설정 값(runtime이 settings.quality를 읽는다). 설정 화면이 가진다. */
    get settings() {
        return this.screens.settings.values;
    }

    listen(node, type, listener, options = {}) {
        node.addEventListener(type, listener, { ...options, signal: this.controller.signal });
    }

    bind() {
        const click = (id, fn) => {
            const button = document.getElementById(id);
            this.listen(button, 'click', fn);
            // Browsers synthesize clicks only for the primary touch. Menus must also
            // work with a second finger while the movement pad is being held.
            this.listen(button, 'pointerup', (event) => {
                if (event.pointerType !== 'touch' || event.isPrimary) return;
                const bounds = button.getBoundingClientRect();
                if (
                    event.clientX < bounds.left ||
                    event.clientX > bounds.right ||
                    event.clientY < bounds.top ||
                    event.clientY > bounds.bottom ||
                    button.disabled
                )
                    return;
                event.preventDefault();
                fn(event);
            });
        };
        this.hud = new TakrawMatchHud({
            listen: (...args) => this.listen(...args),
            click,
            callbacks: this.callbacks,
            homeSchool: () => this.screens.club.club.campaign?.home,
        });
        this.training = new TakrawTrainingPanel({
            listen: (...args) => this.listen(...args),
            callbacks: this.callbacks,
        });
        click('start-match', () => this.start('match'));
        click('start-watch', () => this.start('watch'));
        click('open-campaign', () => this.navigate('campaign'));
        click('start-training', () => this.start('training'));
        click('start-local', () => this.start('local'));
        click('open-network', () => {
            this.callbacks.onStart?.('online');
            this.navigate('network');
        });
        for (const button of document.querySelectorAll('[data-home-go]'))
            this.listen(button, 'click', () => this.navigate(button.dataset.homeGo));
        click('home-back', () => this.navigate(this.home.parent()));
        click('dialog-back', () => this.navigate('club'));
        click('open-club', () => this.navigate('club'));
        click('reward-retry', () => this.callbacks.onRewardRetry?.());
        click('settings-button', () => this.navigate('settings'));
        click('pause-button', () => this.navigate('pause'));
        click('replay-skip', () => this.callbacks.onReplaySkip?.());
        click('dialog-close', () => this.closeDialog());
        click('reload-button', () => window.location.reload());
        click('copy-diagnostic-button', () => this.copyDiagnosticReport());
        click('fatal-reload', () => window.location.reload());
        click('rematch-button', () => this.callbacks.onRestart?.());
        click('training-reset', () => this.callbacks.onRestart?.());
        click('result-home', () => this.quit());
        click('dismiss-rotate', () =>
            document.getElementById('rotate-note').classList.add('dismissed'),
        );
        this.listen(document.querySelector('.wordmark'), 'click', (event) => {
            event.preventDefault();
            this.quit();
        });
        this.listen(window, 'blur', () => this.touch.release());
        this.listen(window, 'resize', () => this.touch.release());
        this.listen(this.coarse, 'change', () => this.syncInputMode());
        this.listen(document, 'visibilitychange', () => {
            if (document.hidden) this.touch.release();
        });
        this.listen(this.nodes['modal-layer'], 'pointerdown', (event) => {
            if (event.target === this.nodes['modal-layer']) this.closeDialog();
        });
        this.listen(this.nodes['dialog-content'], 'click', (event) => this.dialogClick(event));
        this.listen(this.nodes['draw-stage'], 'click', (event) => this.drawStage.click(event));
        this.listen(document, 'keydown', (event) => {
            // 리플레이 중에는 Esc·Space·Enter가 건너뛰기다. 일시 정지 창은 리플레이가 끝난 뒤 연다.
            if (
                this.hud.replaying &&
                !this.dialog &&
                !event.repeat &&
                ['Escape', 'Space', 'Enter', 'NumpadEnter'].includes(event.code)
            ) {
                event.preventDefault();
                this.callbacks.onReplaySkip?.();
                return;
            }
            if (event.code === 'Escape' && this.drawStage.active) {
                event.preventDefault();
                this.drawStage.escape();
                return;
            }
            if (event.code === 'Escape') {
                event.preventDefault();
                if (this.dialog === 'club' && this.screens.club.detail) this.navigate('club');
                else if (this.dialog) this.closeDialog();
                else if (this.inGame) this.navigate('pause');
                else if (this.home.view !== 'main') this.navigate(this.home.parent());
            }
            if (this.dialog && event.code === 'Tab') this.trapFocus(event);
        });
        this.touch = new TakrawTouchControls({
            listen: (...args) => this.listen(...args),
            coarse: this.coarse,
            callbacks: this.callbacks,
            inGame: () => this.inGame,
            dialogOpen: () => !!this.dialog,
            replaying: () => this.hud.replaying,
        });
    }

    start(mode) {
        if (this.callbacks.canStart(mode)) this.callbacks.onStart?.(mode);
    }

    updateStartButtons() {
        this.home.updateStartButtons(this.callbacks.canStart);
    }

    syncInputMode() {
        this.touch.release();
        this.touch.sync(this.inGame, this.mode, this.showcase);
    }

    /**
     * 처음 화면의 상태 줄. 오류는 기본으로 "다시 열기"를 붙이고, reload: false면 버튼 없이 띄운다.
     * 준비를 마친 뒤에는 문구가 있을 때만 보인다(PWA 오류).
     */
    setBootStatus({ phase, message, isError, reload = isError }) {
        this.nodes['boot-message'].textContent = message;
        this.nodes['boot-status'].classList.toggle('error', isError);
        this.nodes['boot-status'].classList.toggle(
            'ready',
            phase === 'ready' && !isError && !message,
        );
        this.nodes['reload-button'].hidden = !reload;
        this.updateStartButtons();
    }

    /** 브라우저가 설치를 허락했을 때만 설정 창에 앱 설치 줄을 둔다. */
    setInstallable(installable) {
        this.screens.settings.setInstallable(installable);
    }

    showHome() {
        if (this.homeShown) this.home.setView('main', false); // 부팅 중에 먼저 누른 단계는 첫 표시 때 유지한다
        const initialDialog =
            !this.homeShown &&
            !this.inGame &&
            ['settings', 'network', 'club', 'campaign'].includes(this.dialog)
                ? this.dialog
                : '';
        this.homeShown = true;
        this.touch.release();
        this.inGame = false;
        this.hideDialog(false);
        document.body.classList.add('is-home');
        document.body.dataset.mode = 'home';
        this.nodes['home-panel'].hidden = false;
        this.hud.hide();
        this.touch.sync(false, this.mode, this.showcase);
        this.nodes['connection-indicator'].hidden = true;
        // 소개영상 호스트는 부팅 직후 이 주소를 읽어 소개를 연다. 호스트가 붙기 전에 지우지 않는다.
        // 처음 표시 전에 연 팀 관리 화면은 선수 상세(#/club/<선수 id>)까지 주소에 남긴다.
        if (this.routes.snapshot().screen !== 'showcase')
            this.setRoute(
                initialDialog || this.home.route(),
                true,
                initialDialog === 'club' ? this.screens.club.detail : null,
            );
        if (initialDialog) this.openDialog(initialDialog);
    }

    showGame(mode) {
        this.inGame = true;
        this.mode = mode;
        this.hideDialog(true);
        this.home.setView('main', false);
        document.body.classList.remove('is-home');
        document.body.dataset.mode = mode;
        this.nodes['home-panel'].hidden = true;
        this.hud.show(mode);
        this.touch.sync(true, mode, this.showcase);
        this.setRoute('play');
        this.canvas.focus({ preventScroll: true });
    }

    /** 화면 주소를 바꾼다. 화면 이동은 이력 추가(push), 교정은 replace. 처음 화면('' 또는 'main')은 해시 없는 주소다. */
    setRoute(screen, replace = false, item = null) {
        this.routes[replace ? 'replace' : 'navigate']({ screen: screen || 'main', item });
    }

    navigate(screen, item = null) {
        this.setRoute(screen, false, item);
        this.applyRoute(this.routes.snapshot());
    }

    /** 주소({ screen, item }, routes.js가 정규화)에 화면을 맞춘다. 이력 복원과 내부 이동이 함께 쓴다. */
    applyRoute(route) {
        const { screen, item } = route;
        if (screen === 'showcase') return; // 소개영상 호스트가 이 주소를 소유한다.
        if (this.home.isStep(screen)) {
            if (this.inGame) {
                this.setRoute('play', true);
                return;
            }
            this.hideDialog(true);
            this.home.setView(screen, false);
            return;
        }
        if (['settings', 'pause', 'network', 'club', 'campaign'].includes(screen)) {
            if (screen === 'pause' && !this.inGame) {
                this.setRoute('', true);
                this.hideDialog(false);
                this.home.setView('main', false);
                return;
            }
            const wasOpen = this.dialog === screen,
                previous = screen === 'club' ? this.screens.club.selectDetail(item) : null;
            this.openDialog(screen);
            if (wasOpen && screen === 'club') this.screens.club.followDetail(item, previous);
            return;
        }
        if (screen === 'main' && this.inGame) {
            this.quit();
            return;
        }
        this.hideDialog(true);
        // 경기 중이 아닌데 읽힌 play(알 수 없는 주소 포함)도 주소가 처음 화면으로 교정되므로 화면도 처음 화면으로 맞춘다.
        if (!this.inGame) this.home.setView('main', false);
        // 처음 화면은 해시 없는 주소로, play는 지금 상태의 주소로 교정한다.
        this.setRoute(this.inGame ? 'play' : '', true);
    }

    openDialog(route) {
        if (this.dialog === route) return;
        if (!this.dialog) {
            this.previousFocus = document.activeElement;
            this.touch.release();
            if (this.inGame) this.callbacks.onPause?.(true);
        }
        this.dialog = route;
        this.nodes['modal-layer'].hidden = false;
        this.nodes['dialog-back'].hidden = true;
        const screen = this.screens[route];
        this.nodes['dialog-panel'].classList.toggle('is-club', route === 'club');
        this.nodes['modal-layer'].classList.toggle('is-club-layer', route === 'club');
        const heading = screen.heading();
        this.nodes['dialog-kicker'].textContent = heading[0];
        this.nodes['dialog-title'].textContent = heading[1];
        this.nodes['dialog-content'].innerHTML = screen.content();
        this.nodes['dialog-content'].scrollTop = 0;
        if (route === 'network') this.screens.network.render();
        if (route === 'club') {
            this.screens.club.syncBack();
            this.screens.club.restore();
        }
        queueMicrotask(() => {
            if (route !== 'club' || !this.screens.club.restoreFocus())
                document.getElementById('dialog-close').focus({ preventScroll: true });
        });
    }

    closeDialog() {
        if (this.dialog === 'network' && !this.inGame && this.screens.network.waiting)
            this.callbacks.onNetwork?.('close');
        this.hideDialog(true);
        this.setRoute(this.inGame ? 'play' : this.home.route());
    }

    hideDialog(resume) {
        this.screens.club.hide(this.dialog === 'club');
        // 소개영상의 뽑기 장면은 관전이 랠리를 다시 열어도(showGame) 대본이 닫을 때까지 남는다.
        if (this.drawStage.active && !this.drawStage.scene) this.drawStage.close();
        const wasOpen = !!this.dialog;
        this.dialog = '';
        this.nodes['modal-layer'].hidden = true;
        this.nodes['modal-layer'].classList.remove('is-club-layer');
        this.screens.network.clearCopyTimer();
        if (wasOpen && resume && this.inGame) this.callbacks.onPause?.(false);
        if (wasOpen && this.previousFocus?.isConnected)
            this.previousFocus.focus({ preventScroll: true });
    }

    quit() {
        this.callbacks.onQuit?.();
        this.showHome();
    }

    trapFocus(event) {
        const nodes = [
            ...this.nodes['dialog-panel'].querySelectorAll(
                'button,input,select,textarea,summary,a[href],[tabindex]',
            ),
        ].filter((node) => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length);
        if (!nodes.length) return;
        const first = nodes[0],
            last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    /** runtime이 팀 조회 결과를 넘긴다. 홈 요약·시작 버튼·열린 팀 관리/도장깨기 화면을 갱신한다. */
    setClub(value) {
        this.screens.club.set(value);
        this.updateStartButtons();
        this.home.setClubSummary(value);
        if (this.dialog === 'club') this.screens.club.render();
        if (this.dialog === 'campaign') this.screens.campaign.refresh();
    }

    /** 소개영상 화면 전용(?showcaseDemo=1): 경기 위에 실제 뽑기 연출을 띄운다(card 없으면 닫는다). */
    showcaseDraw(card) {
        if (!this.showcase) return false;
        this.drawStage.showScene(card);
        this.nodes['modal-layer'].hidden = !card;
        this.nodes['dialog-panel'].hidden = Boolean(card);
        document.body.dataset.showcaseScene = this.drawStage.scene;
        return true;
    }

    /** 소리 설정 저장의 현재 값과 상태를 받는다. 설정 창이 열려 있으면 바로 다시 그린다. */
    setSound(sound) {
        this.screens.settings.setSound(sound);
    }

    /** 대화상자 안 클릭은 열린 화면이 처리한다. */
    dialogClick(event) {
        this.screens[this.dialog]?.click(event);
    }

    /** 치명 오류: 경기 중에도 보이는 패널. 멈춘 화면에 아무 말이 없지 않게 하고, 진단을 바로 복사해 알릴 수 있게 한다. */
    showFatal(message) {
        this.nodes['fatal-message'].textContent = message;
        this.nodes['fatal-panel'].hidden = false;
        this.nodes['copy-diagnostic-button'].focus({ preventScroll: true });
    }

    /** 오류 진단을 클립보드로. 복사가 막히면 선택된 글상자를 보여 직접 복사하게 한다. */
    async copyDiagnosticReport() {
        const button = this.nodes['copy-diagnostic-button'],
            area = this.nodes['diagnostic-text'],
            label = button.textContent;
        area.value = this.callbacks.diagnosticText?.() ?? '';
        area.hidden = false;
        const result = await copyDiagnostic(area.value, {
            clipboard: navigator.clipboard,
            textarea: area,
        });
        area.hidden = result.copied;
        button.textContent = result.copied ? UI.copied() : UI.copyManually();
        this.clearDiagnosticTimer();
        this.diagnosticTimer = window.setTimeout(() => {
            if (button.isConnected) button.textContent = label;
            this.diagnosticTimer = null;
        }, 1800);
    }

    clearDiagnosticTimer() {
        if (this.diagnosticTimer) window.clearTimeout(this.diagnosticTimer);
        this.diagnosticTimer = null;
    }

    /** runtime이 연결 상태를 넘긴다. 화면 위 연결 표시와 열린 친구와 하기 창을 갱신한다. */
    setNetwork(value) {
        this.screens.network.set(value);
    }

    /** 접촉 타이밍 등급 표시. 반환된 토큰으로 hideTiming하면 그 표시만 지운다(match-hud.js). */
    showTiming(timing) {
        return this.hud.showTiming(timing);
    }

    hideTiming(token) {
        this.hud.hideTiming(token);
    }

    showHitPop(text, team) {
        return this.hud.showHitPop(text, team);
    }

    hideHitPop(token) {
        this.hud.hideHitPop(token);
    }

    /** 득점 팀 점수 숫자가 한 번 튄다. */
    bumpScore(team) {
        this.hud.bumpScore(team);
    }

    showReplay(reason) {
        this.hud.showReplay(reason);
    }

    /** runtime이 HUD 간격마다 부른다. 점수판·안내(match-hud), 터치 버튼(touch-controls), 연습 패널(training-panel). */
    update(hud) {
        if (!hud) return;
        this.hud.update(hud, this.mode);
        this.touch.update(hud, this.showcase);
        if (TAKRAW_MODES[this.mode]?.drill && hud.training) this.training.update(hud.training);
    }

    dispose() {
        this.touch.release();
        this.drawStage.dispose();
        this.screens.network.clearCopyTimer();
        this.clearDiagnosticTimer();
        this.controller.abort();
        this.routes.dispose();
    }
}

export { TakrawUI };
