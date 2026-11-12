import { UI } from '../i18n/messages/ui.js';
import { TAKRAW_MODES } from '../simulation/modes.js';

// 발차기 버튼 배구공 그림(index.html 인라인 SVG)의 좌표: viewBox -4..104(한 변 box), 공 원의 중심·반지름.
const BALL = Object.freeze({ box: 108, center: 50, radius: 49 });

/**
 * 화면 조작(이동 패드·점프·발차기 버튼). 눌린 포인터는 이 객체만 가진다.
 * 발차기 버튼(공 모양)은 PC(마우스)·터치 모두 쓰고, 이동 패드·점프 버튼은 터치 화면에서만 보인다(PC는 키보드).
 * 발차기 버튼에서 마지막으로 누른 포인터의 위치가 조준이다(onAim, 버튼 원 기준 -1..1, 위 +). 손가락을 움직이면 따라가고 모두 떼면 가운데다.
 * 게임 상태는 생성 때 받은 조회 함수로만 읽고, 입력은 runtime 콜백(onTouch·onAxis·onAim·onReplaySkip)으로 보낸다.
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
        this.kick = this.node.querySelector('.touch-kick');
        this.mark = this.kick.querySelector('.kick-mark');
        this.pointer = null;
        this.active = new Map();
        this.aimPointers = []; // 발차기 버튼을 누른 포인터(누른 순서). 마지막 것이 조준한다.
        listen(this.kick, 'pointermove', (event) => {
            if (event.pointerId !== this.aimPointers.at(-1)) return;
            event.preventDefault();
            this.aimAt(event);
        });
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
                // 조준을 먼저 보내 첫 틱의 발차기 바이트에 누른 지점이 들어가게 한다.
                if (button === this.kick) {
                    this.aimPointers.push(event.pointerId);
                    this.aimAt(event);
                }
                this.callbacks.onTouch?.(button.dataset.touch, source, true);
            });
            const up = (event) => {
                const state = this.active.get(event.pointerId);
                if (!state) return;
                event.preventDefault();
                this.callbacks.onTouch?.(state.action, state.source, false);
                this.active.delete(event.pointerId);
                if (state.button === this.kick) this.dropAim(event.pointerId);
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

    /** 발차기 버튼 위 포인터 위치를 조준(-1..1, 오른쪽·위 +, 공 그림 밖은 테두리로)으로 바꿔 보내고 표시한다. 기준 원은 그려진 공(BALL)이다. */
    aimAt(event) {
        const rect = this.kick.getBoundingClientRect(),
            radius = Math.max(1, (Math.min(rect.width, rect.height) * BALL.radius) / BALL.box);
        let x = (event.clientX - rect.left - rect.width / 2) / radius,
            y = (rect.top + rect.height / 2 - event.clientY) / radius;
        const length = Math.hypot(x, y);
        if (length > 1) {
            x /= length;
            y /= length;
        }
        this.callbacks.onAim?.(x, y);
        this.showAim(x, y);
    }

    /** 발차기 버튼을 누른 포인터 하나를 뗀다. 남은 포인터가 있으면 그 위치는 다음 움직임에 갱신되고, 없으면 가운데로 돌린다. */
    dropAim(pointerId) {
        this.aimPointers = this.aimPointers.filter((id) => id !== pointerId);
        if (this.aimPointers.length) return;
        this.callbacks.onAim?.(0, 0);
        this.showAim(null);
    }

    /** 누른 지점 표시(공 그림 위 접촉 점). 입력과 무관한 그리기만 한다. null이면 숨긴다. */
    showAim(x, y) {
        this.kick.classList.toggle('is-aiming', x !== null);
        if (x === null) return;
        this.mark.setAttribute(
            'transform',
            `translate(${(BALL.center + x * BALL.radius).toFixed(2)} ${(BALL.center - y * BALL.radius).toFixed(2)})`,
        );
    }

    /** 눌린 터치 버튼·이동 패드를 모두 놓는다(창 이탈·회전·대화상자 열기). */
    release() {
        const active = [...this.active.entries()],
            pointer = this.pointer;
        this.active.clear();
        this.pointer = null;
        this.thumb.style.transform = '';
        this.callbacks.onAxis?.(0, 0);
        this.aimPointers = [];
        this.callbacks.onAim?.(0, 0);
        this.showAim(null);
        for (const [id, state] of active) {
            state.button.classList.remove('is-down');
            this.callbacks.onTouch?.(state.action, state.source, false);
            if (state.button.hasPointerCapture(id)) state.button.releasePointerCapture(id);
        }
        if (pointer !== null && this.pad.hasPointerCapture(pointer))
            this.pad.releasePointerCapture(pointer);
    }

    /**
     * 사람이 조작하는 경기 중에 보인다. 관전은 소개영상 화면에서만 보인다(영상 속 눌림 표시).
     * 터치가 아닌 화면(PC)은 발차기 버튼만 보이고(CSS) 이동·점프는 키보드다. PC 소개영상은 버튼 대신 표시등(drive-feedback)으로 보여 준다.
     */
    sync(inGame, mode, showcase) {
        const flags = TAKRAW_MODES[mode];
        this.node.hidden =
            !inGame ||
            (showcase && !this.coarse.matches) ||
            (flags && !flags.humanInput.includes(true) && !showcase);
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
        const kickButton = this.kick,
            label = hud.tossReady ? UI.tossThrow() : UI.kick();
        if (kickButton.dataset.label !== label) {
            kickButton.dataset.label = label;
            kickButton.querySelector('.kick-label').textContent = label;
        }
    }
}

export { TakrawTouchControls };
