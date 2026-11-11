import { UI } from '../i18n/messages/ui.js';

/**
 * 모바일 터치 조작(이동 패드·점프·발차기 버튼). 눌린 포인터는 이 객체만 가진다.
 * 게임 상태는 생성 때 받은 조회 함수로만 읽고, 입력은 runtime 콜백(onTouch·onAxis·onReplaySkip)으로 보낸다.
 */
class TakrawTouchControls {
    constructor({ listen, coarse, callbacks, inGame, dialogOpen, replaying }) {
        this.coarse = coarse;
        this.callbacks = callbacks;
        this.inGame = inGame;
        this.dialogOpen = dialogOpen;
        this.replaying = replaying;
        this.node = document.getElementById('touch-controls');
        this.pad = document.getElementById('move-pad');
        this.thumb = document.getElementById('move-thumb');
        this.pointer = null;
        this.active = new Map();
        for (const button of document.querySelectorAll('[data-touch]')) {
            listen(button, 'pointerdown', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!this.inGame() || this.dialogOpen()) return;
                if (this.replaying()) {
                    this.callbacks.onReplaySkip?.();
                    return;
                }
                button.setPointerCapture(event.pointerId);
                const source = `touch:${event.pointerId}`;
                this.active.set(event.pointerId, {
                    button,
                    action: button.dataset.touch,
                    source,
                });
                button.classList.add('is-down');
                this.callbacks.onTouch?.(button.dataset.touch, source, true);
            });
            const up = (event) => {
                const state = this.active.get(event.pointerId);
                if (!state) return;
                event.preventDefault();
                this.callbacks.onTouch?.(state.action, state.source, false);
                this.active.delete(event.pointerId);
                state.button.classList.toggle(
                    'is-down',
                    [...this.active.values()].some((item) => item.button === state.button),
                );
            };
            for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
                listen(button, type, up);
            listen(button, 'contextmenu', (event) => event.preventDefault());
        }
        const pad = this.pad;
        listen(pad, 'pointerdown', (event) => {
            if (this.replaying() && this.inGame() && !this.dialogOpen()) {
                event.preventDefault();
                this.callbacks.onReplaySkip?.();
                return;
            }
            if (!this.inGame() || this.dialogOpen() || this.pointer !== null) return;
            event.preventDefault();
            event.stopPropagation();
            this.pointer = event.pointerId;
            pad.setPointerCapture(event.pointerId);
            this.move(event);
        });
        listen(pad, 'pointermove', (event) => {
            if (event.pointerId === this.pointer) {
                event.preventDefault();
                this.move(event);
            }
        });
        const up = (event) => {
            if (event.pointerId !== this.pointer) return;
            this.pointer = null;
            this.thumb.style.transform = '';
            this.callbacks.onAxis?.(0, 0);
        };
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
            listen(pad, type, up);
        listen(pad, 'contextmenu', (event) => event.preventDefault());
    }

    move(event) {
        const rect = this.pad.getBoundingClientRect();
        const thumb = this.thumb.getBoundingClientRect();
        const radius = Math.max(
            1,
            (Math.min(rect.width, rect.height) - Math.max(thumb.width, thumb.height)) / 2,
        );
        let x = (event.clientX - rect.left - rect.width / 2) / radius,
            z = (event.clientY - rect.top - rect.height / 2) / radius;
        const length = Math.hypot(x, z);
        if (length > 1) {
            x /= length;
            z /= length;
        }
        this.thumb.style.transform = `translate(${x * radius}px,${z * radius}px)`;
        // A circular dead zone preserves direction when the thumb leaves centre.
        const strength = Math.max(0, (Math.min(length, 1) - 0.12) / 0.88);
        const scale = length > 0 ? strength / Math.min(length, 1) : 0;
        this.callbacks.onAxis?.(x * scale, z * scale);
    }

    /** 눌린 터치 버튼·이동 패드를 모두 놓는다(창 이탈·회전·대화상자 열기). */
    release() {
        const active = [...this.active.entries()],
            pointer = this.pointer;
        this.active.clear();
        this.pointer = null;
        this.thumb.style.transform = '';
        this.callbacks.onAxis?.(0, 0);
        for (const [id, state] of active) {
            state.button.classList.remove('is-down');
            this.callbacks.onTouch?.(state.action, state.source, false);
            if (state.button.hasPointerCapture(id)) state.button.releasePointerCapture(id);
        }
        if (pointer !== null && this.pad.hasPointerCapture(pointer))
            this.pad.releasePointerCapture(pointer);
    }

    /** 경기 중 터치 기기에서만 보인다. 관전은 소개영상 화면에서만 보인다(영상 속 눌림 표시). */
    sync(inGame, mode, showcase) {
        this.node.hidden = !inGame || !this.coarse.matches || (mode === 'watch' && !showcase);
    }

    /** HUD 갱신: 소개영상의 눌림 표시와 토스 중 발차기 버튼 이름. */
    update(hud, showcase) {
        // 소개영상은 입력을 받지 않고, 영상 속 공격수가 누르는 동안 터치 버튼을 눌린 모양으로 보여 준다.
        if (showcase)
            for (const button of document.querySelectorAll('[data-touch]'))
                button.classList.toggle(
                    'is-down',
                    button.dataset.touch === 'jump' ? !!hud.jumpHeld : !!hud.kickHeld,
                );
        const kickButton = document.querySelector('.touch-kick'),
            label = hud.tossReady ? [UI.tossThrow(), UI.tossHint()] : [UI.kick(), UI.kickHint()];
        if (kickButton.dataset.label !== label[0]) {
            kickButton.dataset.label = label[0];
            kickButton.firstChild.textContent = label[0];
            kickButton.querySelector('small').textContent = label[1];
        }
    }
}

export { TakrawTouchControls };
