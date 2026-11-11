import { TAKRAW_VERSION } from '../../config/game.js';
import { UI } from '../../i18n/messages/ui.js';
import { escape } from '../markup.js';

/**
 * 친구와 하기 화면(대화상자 network)과 화면 위 연결 표시: runtime이 넘긴 연결 상태(value)와 복사 버튼 타이머를 가진다.
 * 방 만들기·참가·닫기는 생성 때 받은 callbacks.onNetwork로 runtime에 넘긴다.
 */
class TakrawNetworkScreen {
    constructor({ node, indicator, value, isOpen, hide, callbacks }) {
        this.node = node;
        this.indicator = indicator;
        this.value = value;
        this.isOpen = isOpen;
        this.hide = hide;
        this.callbacks = callbacks;
        this.copyTimer = null;
    }

    heading() {
        return [UI.networkKicker(), UI.networkTitle()];
    }

    /** 방을 열어 친구를 기다리거나 붙는 중인가(이때 창을 닫으면 연결도 닫는다). */
    get waiting() {
        return ['listening', 'connecting'].includes(this.value.state);
    }

    content() {
        return `<p>${escape(UI.networkIntroA())}<br>${escape(UI.networkIntroB())}</p><div class="network-form"><button type="button" class="primary-small" data-dialog-action="host">${escape(UI.host())} <span aria-hidden="true">＋</span></button></div><div class="network-divider">${escape(UI.orJoin())}</div>
      <form id="join-form" class="network-form"><label for="room-input">${escape(UI.roomInputLabel())}</label><input id="room-input" class="network-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="numeric" maxlength="4" placeholder="${escape(UI.roomPlaceholder())}"><button type="button" class="secondary-small" data-dialog-action="join">${escape(UI.join())}</button></form>
      <div id="room-status" class="room-status" role="status" hidden><strong id="network-phase" class="network-phase">${escape(UI.connectionReady())}</strong><span id="room-status-message"></span><div id="room-code-line" class="room-code-line" hidden><input id="room-code" aria-label="${escape(UI.myRoomCode())}" readonly><button type="button" data-dialog-action="copy-code">${escape(UI.copy())}</button></div><small id="network-hint" class="network-hint" hidden></small></div>
      <p class="room-help">${escape(UI.roomHelp({ version: TAKRAW_VERSION }))}</p>
      <details class="network-debug"><summary>${escape(UI.diagnostics())}</summary><pre id="network-log" aria-label="${escape(UI.networkLog())}"></pre><button type="button" class="secondary-small" data-dialog-action="copy-network-log">${escape(UI.copyDiagnostics())}</button></details>
      <div class="dialog-actions"><button type="button" class="primary-small" data-dialog-action="resume" id="resume-room" hidden>${escape(UI.resumeRoom())}</button><button type="button" class="secondary-small" data-dialog-action="close-network">${escape(UI.closeNetwork())}</button></div>`;
    }

    click(event) {
        const button = event.target.closest('[data-dialog-action]');
        if (!button) return;
        const action = button.dataset.dialogAction;
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
            this.hide();
        }
        if (action === 'copy-code') this.copyText(this.value.code, button);
        if (action === 'copy-network-log')
            this.copyText(document.getElementById('network-log')?.textContent || '', button);
    }

    async copyText(value, button) {
        const label = button.textContent;
        try {
            await navigator.clipboard.writeText(value);
            button.textContent = UI.copied();
        } catch {
            const input = document.getElementById('room-code');
            if (input && value === this.value.code) {
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

    /** 대화상자가 닫힐 때: 복사 버튼 문구를 되돌릴 타이머를 멈춘다. */
    clearCopyTimer() {
        if (this.copyTimer) {
            window.clearTimeout(this.copyTimer);
            this.copyTimer = null;
        }
    }

    set(value) {
        this.value = value;
        this.render();
        const indicator = this.indicator;
        indicator.hidden = ['idle', 'closed', ''].includes(this.value.state);
        indicator.querySelector('span').textContent =
            this.value.state === 'connected'
                ? UI.friendConnected()
                : this.value.message || UI.connecting();
        indicator.querySelector('i').style.background =
            this.value.state === 'error'
                ? '#ba6548'
                : this.value.state === 'connected'
                  ? '#238468'
                  : '#c69a49';
    }

    render() {
        if (!this.isOpen()) return;
        const status = document.getElementById('room-status');
        status.hidden = !this.value.message && !this.value.code;
        status.classList.toggle('error', this.value.state === 'error');
        document.getElementById('room-status-message').textContent =
            this.value.message || UI.waitingFriend();
        document.getElementById('network-phase').textContent =
            this.value.phase || UI.connectionState();
        const hint = document.getElementById('network-hint');
        hint.hidden = !this.value.hint;
        hint.textContent = this.value.hint || '';
        const log = document.getElementById('network-log');
        if (log) log.textContent = this.value.diagnostics || UI.noLog();
        document.getElementById('room-code-line').hidden = !this.value.code;
        document.getElementById('room-code').value = this.value.code || '';
        document.getElementById('resume-room').hidden =
            !this.value.canResume || this.value.state === 'connecting';
        const busy = ['connecting', 'listening', 'connected'].includes(this.value.state);
        for (const button of this.node.querySelectorAll(
            '[data-dialog-action="host"],[data-dialog-action="join"]',
        ))
            button.disabled = busy;
        document.getElementById('join-form').onsubmit = (event) => {
            event.preventDefault();
            this.node.querySelector('[data-dialog-action="join"]').click();
        };
    }
}

export { TakrawNetworkScreen };
