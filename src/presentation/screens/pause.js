import { UI } from '../../i18n/messages/ui.js';
import { escape } from '../markup.js';

/** 일시 정지 화면(대화상자 pause): 계속하기·다시 시작·처음으로. 온라인 경기는 다시 시작 대신 안내를 둔다. */
class TakrawPauseScreen {
    constructor({ mode, close, quit, callbacks }) {
        this.mode = mode;
        this.close = close;
        this.quit = quit;
        this.callbacks = callbacks;
    }

    heading() {
        const online = this.mode() === 'online';
        return [
            online ? UI.pauseKickerOnline() : UI.pauseKicker(),
            online ? UI.pauseTitleOnline() : UI.pauseTitle(),
        ];
    }

    content() {
        return `<div class="pause-menu"><button type="button" class="primary-small" data-dialog-action="close">${escape(UI.resume())}</button>${this.mode() !== 'online' ? `<button type="button" class="secondary-small" data-dialog-action="restart">${escape(UI.restart())}</button>` : `<p class="key-tip">${escape(UI.onlinePauseTip())}</p>`}<button type="button" class="secondary-small" data-dialog-action="quit">${escape(UI.toHome())}</button></div>`;
    }

    click(event) {
        const button = event.target.closest('[data-dialog-action]');
        if (!button) return;
        const action = button.dataset.dialogAction;
        if (action === 'close') this.close();
        if (action === 'restart') {
            this.callbacks.onRestart?.();
            this.close();
        }
        if (action === 'quit') this.quit();
    }
}

export { TakrawPauseScreen };
