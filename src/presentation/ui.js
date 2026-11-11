import { TAKRAW_VERSION } from '../config/game.js';
import { copyDiagnostic } from '@bloom-gamekit/debug-tools';
import { createNavigation } from '@bloom-gamekit/navigation';
import { takrawRoute } from './routes.js';
import { LOCALE, LOCALE_NAMES } from '../i18n/locale.js';
import { UI } from '../i18n/messages/ui.js';
import { touchControlText } from '../i18n/messages/match.js';
import { escape } from './markup.js';
import { TakrawTouchControls } from './touch-controls.js';
import { TakrawMatchHud } from './match-hud.js';
import { TakrawTrainingPanel } from './training-panel.js';
import { TakrawHomeScreen } from './screens/home.js';
import { TakrawClubScreen } from './screens/club.js';
import { TakrawCampaignScreen } from './screens/campaign.js';
import { TakrawDrawStage } from './screens/draw-stage.js';

class TakrawUI {
    constructor(callbacks, network) {
        this.callbacks = callbacks;
        this.canvas = document.getElementById('court-canvas');
        this.canvas.tabIndex = -1;
        this.settings = { sound: true, quality: 'high' };
        this.sound = { locked: false, message: '' }; // 소리 설정 저장 상태. 읽지 못하면 locked, 실패 문구는 message.
        this.installable = false; // PWA 설치 창을 띄울 수 있을 때 true(registerPwa의 onInstallable)
        this.inGame = false;
        this.mode = 'match';
        this.dialog = '';
        this.network = network;
        this.controller = new AbortController();
        this.previousFocus = null;
        this.homeShown = false;
        this.copyTimer = null;
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
        };
        // 주소와 브라우저 이력은 gamekit navigation이 소유한다. 이력 복원(뒤로·앞으로·주소 입력)에만 화면을 맞추고,
        // 내부 이동은 navigate가 주소를 바꾼 뒤 직접 화면을 맞춘다.
        this.routes = createNavigation({ normalize: takrawRoute });
        this.routes.subscribe((route, { source }) => {
            if (source === 'history') this.applyRoute(route);
        });
        this.bind();
        this.syncInputMode();
        this.applyRoute(this.routes.snapshot());
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
        const controlText = (value) => (this.coarse.matches ? touchControlText(value) : value);
        this.hud = new TakrawMatchHud({
            listen: (...args) => this.listen(...args),
            click,
            callbacks: this.callbacks,
            controlText,
            homeSchool: () => this.screens.club.club.campaign?.home,
        });
        this.training = new TakrawTrainingPanel({
            listen: (...args) => this.listen(...args),
            callbacks: this.callbacks,
            controlText,
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
        this.installable = installable;
        if (this.dialog === 'settings')
            this.nodes['dialog-content'].innerHTML = this.settingsContent();
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
        if (this.routes.snapshot().screen !== 'showcase')
            this.setRoute(initialDialog || this.home.route(), true);
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
        if (screen === 'main') this.home.setView('main', false);
        // 처음 화면은 해시 없는 주소로, play(알 수 없는 주소 포함)는 지금 상태의 주소로 교정한다.
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
        const online = this.mode === 'online';
        const meta = {
            club: [UI.clubKicker(), UI.clubTitle()],
            settings: [UI.settingsKicker(), UI.settingsTitle()],
            pause: [
                online ? UI.pauseKickerOnline() : UI.pauseKicker(),
                online ? UI.pauseTitleOnline() : UI.pauseTitle(),
            ],
            network: [UI.networkKicker(), UI.networkTitle()],
        }[route];
        this.nodes['dialog-panel'].classList.toggle('is-club', route === 'club');
        this.nodes['modal-layer'].classList.toggle('is-club-layer', route === 'club');
        const heading = meta || [UI.campaignKicker(), UI.campaignTitle()];
        this.nodes['dialog-kicker'].textContent = heading[0];
        this.nodes['dialog-title'].textContent = heading[1];
        this.nodes['dialog-content'].innerHTML = this.screens[route]
            ? this.screens[route].content()
            : this[`${route}Content`]();
        this.nodes['dialog-content'].scrollTop = 0;
        if (route === 'network') this.renderNetwork();
        if (route === 'club') this.screens.club.restore();
        queueMicrotask(() => {
            if (route !== 'club' || !this.screens.club.restoreFocus())
                document.getElementById('dialog-close').focus({ preventScroll: true });
        });
    }

    closeDialog() {
        if (
            this.dialog === 'network' &&
            !this.inGame &&
            ['listening', 'connecting'].includes(this.network.state)
        )
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
        if (this.copyTimer) {
            window.clearTimeout(this.copyTimer);
            this.copyTimer = null;
        }
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
    setSound({
        on = this.settings.sound,
        locked = this.sound.locked,
        message = this.sound.message,
    }) {
        this.settings.sound = on;
        this.sound = { locked, message };
        if (this.dialog === 'settings')
            this.nodes['dialog-content'].innerHTML = this.settingsContent();
    }

    settingsContent() {
        const status = this.sound.message
            ? `<p class="room-status error" role="status">${escape(this.sound.message)}</p>`
            : '';
        // 언어는 페이지를 읽을 때 한 번 정한다. 고르면 저장하고 새로고침하므로 경기 중에는 막는다.
        const languages = Object.entries(LOCALE_NAMES)
            .map(
                ([code, name]) =>
                    `<button type="button" lang="${code}" class="${LOCALE.locale === code ? 'selected' : ''}" aria-pressed="${LOCALE.locale === code}" ${this.inGame ? 'disabled' : ''} data-dialog-action="locale" data-value="${code}">${escape(name)}</button>`,
            )
            .join('');
        return `<div class="settings-row"><div><strong>${escape(UI.sound())}</strong><small>${escape(UI.soundHint())}</small></div><button type="button" class="toggle-button" role="switch" aria-label="${escape(UI.sound())}" aria-checked="${this.settings.sound}" ${this.sound.locked ? 'disabled' : ''} data-dialog-action="sound"></button></div>${status}
      <div class="settings-row"><div><strong>${escape(UI.quality())}</strong><small>${escape(UI.qualityHint())}</small></div><div class="segmented" role="group" aria-label="${escape(UI.quality())}"><button type="button" class="${this.settings.quality === 'low' ? 'selected' : ''}" aria-pressed="${this.settings.quality === 'low'}" data-dialog-action="quality" data-value="low">${escape(UI.qualityLow())}</button><button type="button" class="${this.settings.quality === 'high' ? 'selected' : ''}" aria-pressed="${this.settings.quality === 'high'}" data-dialog-action="quality" data-value="high">${escape(UI.qualityHigh())}</button></div></div>
      <div class="settings-row"><div><strong>${escape(UI.camera())}</strong><small>${escape(this.coarse.matches ? UI.cameraTouch() : UI.cameraMouse())}</small></div><button type="button" class="secondary-small" data-dialog-action="camera-reset">${escape(UI.cameraReset())}</button></div>
      <div class="settings-row"><div><strong>${escape(UI.language())}</strong><small>${escape(this.inGame ? UI.languageLocked() : UI.languageHint())}</small></div><div class="segmented" role="group" aria-label="${escape(UI.language())}">${languages}</div></div>
      ${this.installable ? `<div class="settings-row"><div><strong>${escape(UI.install())}</strong><small>${escape(UI.installHint())}</small></div><button type="button" class="secondary-small" data-dialog-action="install">${escape(UI.installButton())}</button></div>` : ''}
      <p class="key-tip">${escape(UI.qualityTip())}</p><div class="dialog-actions"><button type="button" class="primary-small" data-dialog-action="close">${escape(UI.done())}</button></div>`;
    }

    pauseContent() {
        return `<div class="pause-menu"><button type="button" class="primary-small" data-dialog-action="close">${escape(UI.resume())}</button>${this.mode !== 'online' ? `<button type="button" class="secondary-small" data-dialog-action="restart">${escape(UI.restart())}</button>` : `<p class="key-tip">${escape(UI.onlinePauseTip())}</p>`}<button type="button" class="secondary-small" data-dialog-action="quit">${escape(UI.toHome())}</button></div>`;
    }

    networkContent() {
        return `<p>${escape(UI.networkIntroA())}<br>${escape(UI.networkIntroB())}</p><div class="network-form"><button type="button" class="primary-small" data-dialog-action="host">${escape(UI.host())} <span aria-hidden="true">＋</span></button></div><div class="network-divider">${escape(UI.orJoin())}</div>
      <form id="join-form" class="network-form"><label for="room-input">${escape(UI.roomInputLabel())}</label><input id="room-input" class="network-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="numeric" maxlength="4" placeholder="${escape(UI.roomPlaceholder())}"><button type="button" class="secondary-small" data-dialog-action="join">${escape(UI.join())}</button></form>
      <div id="room-status" class="room-status" role="status" hidden><strong id="network-phase" class="network-phase">${escape(UI.connectionReady())}</strong><span id="room-status-message"></span><div id="room-code-line" class="room-code-line" hidden><input id="room-code" aria-label="${escape(UI.myRoomCode())}" readonly><button type="button" data-dialog-action="copy-code">${escape(UI.copy())}</button></div><small id="network-hint" class="network-hint" hidden></small></div>
      <p class="room-help">${escape(UI.roomHelp({ version: TAKRAW_VERSION }))}</p>
      <details class="network-debug"><summary>${escape(UI.diagnostics())}</summary><pre id="network-log" aria-label="${escape(UI.networkLog())}"></pre><button type="button" class="secondary-small" data-dialog-action="copy-network-log">${escape(UI.copyDiagnostics())}</button></details>
      <div class="dialog-actions"><button type="button" class="primary-small" data-dialog-action="resume" id="resume-room" hidden>${escape(UI.resumeRoom())}</button><button type="button" class="secondary-small" data-dialog-action="close-network">${escape(UI.closeNetwork())}</button></div>`;
    }

    dialogClick(event) {
        if (this.dialog === 'club' || this.dialog === 'campaign') {
            this.screens[this.dialog].click(event);
            return;
        }
        const button = event.target.closest('[data-dialog-action]');
        if (!button) return;
        const action = button.dataset.dialogAction;
        if (action === 'close') this.closeDialog();
        if (action === 'restart') {
            this.callbacks.onRestart?.();
            this.closeDialog();
        }
        if (action === 'quit') this.quit();
        if (action === 'sound') {
            this.settings.sound = !this.settings.sound;
            button.setAttribute('aria-checked', String(this.settings.sound));
            this.callbacks.onSetting?.('sound', this.settings.sound);
        }
        if (action === 'camera-reset') this.callbacks.onCameraReset?.();
        if (action === 'install') this.callbacks.onInstall?.();
        if (action === 'locale' && !this.inGame && button.dataset.value !== LOCALE.locale)
            LOCALE.choose(button.dataset.value);
        if (action === 'quality') {
            this.settings.quality = button.dataset.value;
            for (const option of button.parentElement.children) {
                const selected = option.dataset.value === this.settings.quality;
                option.classList.toggle('selected', selected);
                option.setAttribute('aria-pressed', String(selected));
            }
            this.callbacks.onSetting?.('quality', this.settings.quality);
        }
        if (action === 'host') this.callbacks.onNetwork?.('host');
        if (action === 'resume') this.callbacks.onNetwork?.('resume');
        if (action === 'join') {
            const input = document.getElementById('room-input'),
                code = input.value.trim();
            if (!code) {
                input.focus();
                input.setCustomValidity(UI.enterRoomCode());
                input.reportValidity();
                input.setCustomValidity('');
                return;
            }
            this.callbacks.onNetwork?.('join', code);
        }
        if (action === 'close-network') {
            this.callbacks.onNetwork?.('close');
            this.hideDialog(true);
            this.setRoute(this.inGame ? 'play' : this.home.route());
        }
        if (action === 'copy-code') this.copyText(this.network.code, button);
        if (action === 'copy-network-log')
            this.copyText(document.getElementById('network-log')?.textContent || '', button);
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
        if (this.diagnosticTimer) window.clearTimeout(this.diagnosticTimer);
        this.diagnosticTimer = window.setTimeout(() => {
            if (button.isConnected) button.textContent = label;
            this.diagnosticTimer = null;
        }, 1800);
    }

    async copyText(value, button) {
        const label = button.textContent;
        try {
            await navigator.clipboard.writeText(value);
            button.textContent = UI.copied();
        } catch {
            const input = document.getElementById('room-code');
            if (input && value === this.network.code) {
                input.focus();
                input.select();
            }
            button.textContent = UI.copyManually();
        }
        if (this.copyTimer) window.clearTimeout(this.copyTimer);
        this.copyTimer = window.setTimeout(() => {
            if (button.isConnected) button.textContent = label;
            this.copyTimer = null;
        }, 1800);
    }

    setNetwork(value) {
        this.network = value;
        this.renderNetwork();
        const indicator = this.nodes['connection-indicator'];
        indicator.hidden = ['idle', 'closed', ''].includes(this.network.state);
        indicator.querySelector('span').textContent =
            this.network.state === 'connected'
                ? UI.friendConnected()
                : this.network.message || UI.connecting();
        indicator.querySelector('i').style.background =
            this.network.state === 'error'
                ? '#ba6548'
                : this.network.state === 'connected'
                  ? '#238468'
                  : '#c69a49';
    }

    renderNetwork() {
        if (this.dialog !== 'network') return;
        const status = document.getElementById('room-status');
        status.hidden = !this.network.message && !this.network.code;
        status.classList.toggle('error', this.network.state === 'error');
        document.getElementById('room-status-message').textContent =
            this.network.message || UI.waitingFriend();
        document.getElementById('network-phase').textContent =
            this.network.phase || UI.connectionState();
        const hint = document.getElementById('network-hint');
        hint.hidden = !this.network.hint;
        hint.textContent = this.network.hint || '';
        const log = document.getElementById('network-log');
        if (log) log.textContent = this.network.diagnostics || UI.noLog();
        document.getElementById('room-code-line').hidden = !this.network.code;
        document.getElementById('room-code').value = this.network.code || '';
        document.getElementById('resume-room').hidden =
            !this.network.canResume || this.network.state === 'connecting';
        const busy = ['connecting', 'listening', 'connected'].includes(this.network.state);
        for (const button of this.nodes['dialog-content'].querySelectorAll(
            '[data-dialog-action="host"],[data-dialog-action="join"]',
        ))
            button.disabled = busy;
        document.getElementById('join-form').onsubmit = (event) => {
            event.preventDefault();
            this.nodes['dialog-content'].querySelector('[data-dialog-action="join"]').click();
        };
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

    showReplay(reason) {
        this.hud.showReplay(reason);
    }

    /** runtime이 HUD 간격마다 부른다. 점수판·안내(match-hud), 터치 버튼(touch-controls), 연습 패널(training-panel). */
    update(hud) {
        if (!hud) return;
        this.hud.update(hud, this.mode);
        this.touch.update(hud, this.showcase);
        if (this.mode === 'training' && hud.training) this.training.update(hud.training);
    }

    dispose() {
        this.touch.release();
        this.drawStage.dispose();
        if (this.copyTimer) window.clearTimeout(this.copyTimer);
        this.controller.abort();
        this.routes.dispose();
    }
}

export { TakrawUI };
