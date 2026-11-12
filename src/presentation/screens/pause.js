import { UI } from '../../i18n/messages/ui.js';
import { escape } from '../markup.js';
import { TAKRAW_MODE_POLICY } from '../../config/runtime.js';

/** 일시 정지 화면(대화상자 pause): 계속하기·다시 시작·처음으로. 온라인 경기는 다시 시작 대신 안내를 둔다. */
class TakrawPauseScreen {
    constructor({ mode, close, quit, callbacks }) {
        this.mode = mode;
        this.close = close;
        this.quit = quit;
        this.callbacks = callbacks;
    }

    /** 이 기기가 경기를 멈출 수 있는지. 멈출 수 없는 경기(온라인)는 다시 시작 대신 「경기는 계속된다」 안내를 둔다. */
    holdsSimulation() {
        return TAKRAW_MODE_POLICY[this.mode()]?.holdsSimulation ?? true;
    }

    heading() {
        const online = !this.holdsSimulation();
        return [
            online ? UI.pauseKickerOnline() : UI.pauseKicker(),
            online ? UI.pauseTitleOnline() : UI.pauseTitle(),
        ];
    }

    content() {
        return `<div class="pause-menu"><button type="button" class="primary-small" data-dialog-action="close">${escape(UI.resume())}</button>${this.holdsSimulation() ? `<button type="button" class="secondary-small" data-dialog-action="restart">${escape(UI.restart())}</button>` : `<p class="key-tip">${escape(UI.onlinePauseTip())}</p>`}<button type="button" class="secondary-small" data-dialog-action="quit">${escape(UI.toHome())}</button></div>`;
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
