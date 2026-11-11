import { LOCALE, LOCALE_NAMES } from '../../i18n/locale.js';
import { UI } from '../../i18n/messages/ui.js';
import { escape } from '../markup.js';

/**
 * 설정 화면(대화상자 settings): 소리·그래픽 품질 값과 소리 저장 상태, 앱 설치 가능 여부를 가진다.
 * 값이 바뀌면 생성 때 받은 callbacks(onSetting 등)로 runtime에 알린다.
 */
class TakrawSettingsScreen {
    constructor({ node, coarse, inGame, isOpen, close, callbacks }) {
        this.node = node;
        this.coarse = coarse;
        this.inGame = inGame;
        this.isOpen = isOpen;
        this.close = close;
        this.callbacks = callbacks;
        this.values = { sound: true, quality: 'high' };
        this.sound = { locked: false, message: '' }; // 소리 설정 저장 상태. 읽지 못하면 locked, 실패 문구는 message.
        this.installable = false; // PWA 설치 창을 띄울 수 있을 때 true(registerPwa의 onInstallable)
    }

    heading() {
        return [UI.settingsKicker(), UI.settingsTitle()];
    }

    /** 열려 있을 때만 다시 그린다. */
    refresh() {
        if (this.isOpen()) this.node.innerHTML = this.content();
    }

    setInstallable(installable) {
        this.installable = installable;
        this.refresh();
    }

    setSound({ on = this.values.sound, locked = this.sound.locked, message = this.sound.message }) {
        this.values.sound = on;
        this.sound = { locked, message };
        this.refresh();
    }

    content() {
        const status = this.sound.message
            ? `<p class="room-status error" role="status">${escape(this.sound.message)}</p>`
            : '';
        // 언어는 페이지를 읽을 때 한 번 정한다. 고르면 저장하고 새로고침하므로 경기 중에는 막는다.
        const languages = Object.entries(LOCALE_NAMES)
            .map(
                ([code, name]) =>
                    `<button type="button" lang="${code}" class="${LOCALE.locale === code ? 'selected' : ''}" aria-pressed="${LOCALE.locale === code}" ${this.inGame() ? 'disabled' : ''} data-dialog-action="locale" data-value="${code}">${escape(name)}</button>`,
            )
            .join('');
        return `<div class="settings-row"><div><strong>${escape(UI.sound())}</strong><small>${escape(UI.soundHint())}</small></div><button type="button" class="toggle-button" role="switch" aria-label="${escape(UI.sound())}" aria-checked="${this.values.sound}" ${this.sound.locked ? 'disabled' : ''} data-dialog-action="sound"></button></div>${status}
      <div class="settings-row"><div><strong>${escape(UI.quality())}</strong><small>${escape(UI.qualityHint())}</small></div><div class="segmented" role="group" aria-label="${escape(UI.quality())}"><button type="button" class="${this.values.quality === 'low' ? 'selected' : ''}" aria-pressed="${this.values.quality === 'low'}" data-dialog-action="quality" data-value="low">${escape(UI.qualityLow())}</button><button type="button" class="${this.values.quality === 'high' ? 'selected' : ''}" aria-pressed="${this.values.quality === 'high'}" data-dialog-action="quality" data-value="high">${escape(UI.qualityHigh())}</button></div></div>
      <div class="settings-row"><div><strong>${escape(UI.camera())}</strong><small>${escape(this.coarse.matches ? UI.cameraTouch() : UI.cameraMouse())}</small></div><button type="button" class="secondary-small" data-dialog-action="camera-reset">${escape(UI.cameraReset())}</button></div>
      <div class="settings-row"><div><strong>${escape(UI.language())}</strong><small>${escape(this.inGame() ? UI.languageLocked() : UI.languageHint())}</small></div><div class="segmented" role="group" aria-label="${escape(UI.language())}">${languages}</div></div>
      ${this.installable ? `<div class="settings-row"><div><strong>${escape(UI.install())}</strong><small>${escape(UI.installHint())}</small></div><button type="button" class="secondary-small" data-dialog-action="install">${escape(UI.installButton())}</button></div>` : ''}
      <p class="key-tip">${escape(UI.qualityTip())}</p><div class="dialog-actions"><button type="button" class="primary-small" data-dialog-action="close">${escape(UI.done())}</button></div>`;
    }

    click(event) {
        const button = event.target.closest('[data-dialog-action]');
        if (!button) return;
        const action = button.dataset.dialogAction;
        if (action === 'close') this.close();
        if (action === 'sound') {
            this.values.sound = !this.values.sound;
            button.setAttribute('aria-checked', String(this.values.sound));
            this.callbacks.onSetting?.('sound', this.values.sound);
        }
        if (action === 'camera-reset') this.callbacks.onCameraReset?.();
        if (action === 'install') this.callbacks.onInstall?.();
        if (action === 'locale' && !this.inGame() && button.dataset.value !== LOCALE.locale)
            LOCALE.choose(button.dataset.value);
        if (action === 'quality') {
            this.values.quality = button.dataset.value;
            for (const option of button.parentElement.children) {
                const selected = option.dataset.value === this.values.quality;
                option.classList.toggle('selected', selected);
                option.setAttribute('aria-pressed', String(selected));
            }
            this.callbacks.onSetting?.('quality', this.values.quality);
        }
    }
}

export { TakrawSettingsScreen };
