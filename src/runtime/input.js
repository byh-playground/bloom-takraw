import { ActionState, createDOMInput } from '@bloom-gamekit/input';

const ACTION_NAMES = Object.freeze([
    'left',
    'right',
    'forward',
    'back',
    'jump',
    'kick',
    'p2Left',
    'p2Right',
    'p2Forward',
    'p2Back',
    'p2Jump',
    'p2Kick',
]);

/**
 * 이 기기의 입력: 키·포인터 장치(createDOMInput), 행동 상태, 터치 패드 축, 발차기 조준, 마우스 카메라 회전, 마지막으로 만든 입력 바이트.
 * 명령(점프·발차기 눌림)의 순서는 세션이 정한다. 여기서는 눌림 엣지만 돌려준다.
 * 발차기와 조준은 화면의 발차기 버튼(touch-controls)에서만 들어온다. 키보드는 조준 값을 만들지 않는다(2P 발차기는 늘 가운데).
 *   onPointer(event): 캔버스 포인터 이벤트마다 부른다(오디오 잠금 해제·리플레이 건너뛰기·카메라 회전은 세션이 정한다).
 */
class RuntimeInput {
    constructor({ canvas, config, onPointer }) {
        this.canvas = canvas;
        this.size = config.input.size;
        this.stride = config.input.stride;
        this.axisScale = config.input.axisScale;
        this.aimSteps = config.input.aimSteps;
        this.samples = Object.fromEntries(ACTION_NAMES.map((name) => [name, {}]));
        this.axis = { x: 0, z: 0 };
        this.aim = { x: 0, y: 0 };
        this.cameraDrag = { pointer: null, x: 0, y: 0 };
        this.lastInput = new Uint8Array(this.size);
        this.actions = new ActionState();
        canvas.tabIndex = 0;
        this.device = createDOMInput({
            target: canvas,
            state: this.actions,
            keys: {
                KeyA: 'left',
                KeyD: 'right',
                KeyW: 'forward',
                KeyS: 'back',
                Space: 'jump',
                ArrowLeft: 'p2Left',
                ArrowRight: 'p2Right',
                ArrowUp: 'p2Forward',
                ArrowDown: 'p2Back',
                Enter: 'p2Jump',
                Numpad0: 'p2Jump',
                ShiftRight: 'p2Kick',
            },
            pointerButtons: { 2: 'cameraOrbit' },
            touchAction: 'none',
            onPointer,
        });
    }

    /**
     * 한 틱의 입력 바이트와 눌림 엣지. allowed가 아니면 바이트는 0이고 엣지도 없다.
     * movement(right, back)는 화면 기준 이동을 월드 축으로 바꾼다(보는 팀 기준).
     */
    sample({ allowed, local2p, movement }) {
        const input = new Uint8Array(this.size);
        const edges = { jump: false, kick: false, p2Jump: false, p2Kick: false };
        const samples = this.samples;
        for (const name of ACTION_NAMES) this.actions.sampleInto(name, samples[name]);
        if (allowed) {
            this.writeMovement(
                input,
                0,
                movement(
                    Number(samples.right.held) - Number(samples.left.held) + this.axis.x,
                    Number(samples.back.held) - Number(samples.forward.held) + this.axis.z,
                ),
            );
            input[2] = (samples.jump.held ? 1 : 0) | (samples.kick.held ? 2 : 0);
            input[3] = samples.kick.held ? this.encodeAim(this.aim) : 0;
            edges.jump = samples.jump.pressed;
            edges.kick = samples.kick.pressed;
            if (local2p) {
                const p2 = this.stride;
                this.writeMovement(
                    input,
                    p2,
                    movement(
                        Number(samples.p2Right.held) - Number(samples.p2Left.held),
                        Number(samples.p2Back.held) - Number(samples.p2Forward.held),
                    ),
                );
                input[p2 + 2] = (samples.p2Jump.held ? 1 : 0) | (samples.p2Kick.held ? 2 : 0);
                edges.p2Jump = samples.p2Jump.pressed;
                edges.p2Kick = samples.p2Kick.pressed;
            }
        }
        this.actions.consume();
        this.lastInput = input.slice();
        return { input, edges };
    }

    /** 터치 버튼(점프·발차기) 하나의 눌림. source는 손가락 식별자다. */
    setTouch(action, source, down) {
        this.actions.set(action, `touch:${source}`, Boolean(down));
    }

    /** 발차기 버튼을 누르고 있는 지점(버튼 원 기준 가로 오른쪽 +, 세로 위 +, -1..1). 조작할 수 없을 때는 가운데로 둔다. */
    setAim(x, y, allowed) {
        this.aim.x = allowed ? Math.max(-1, Math.min(1, x)) : 0;
        this.aim.y = allowed ? Math.max(-1, Math.min(1, y)) : 0;
    }

    /** 터치 이동 패드 축. 조작할 수 없을 때는 0으로 둔다. */
    setAxis(x, z, allowed) {
        this.axis.x = allowed ? Math.max(-1, Math.min(1, x)) : 0;
        this.axis.z = allowed ? Math.max(-1, Math.min(1, z)) : 0;
    }

    /** 오른쪽 버튼 마우스 끌기로 카메라를 돌린다. 조작할 수 없거나 끌기가 끝나면 회전 표시를 끈다. */
    orbit(event, allowed, view) {
        const rotating =
            allowed &&
            event.active &&
            event.pointerType === 'mouse' &&
            (event.buttons & 2) !== 0 &&
            !['up', 'cancel'].includes(event.type);
        if (!rotating) {
            this.cameraDrag.pointer = null;
            this.canvas.classList.remove('is-orbiting');
            return;
        }
        if (this.cameraDrag.pointer === event.pointerId) {
            view.orbitBy(event.x - this.cameraDrag.x, event.y - this.cameraDrag.y);
        } else this.canvas.focus({ preventScroll: true });
        this.cameraDrag.pointer = event.pointerId;
        this.cameraDrag.x = event.x;
        this.cameraDrag.y = event.y;
        this.canvas.classList.add('is-orbiting');
    }

    /** 눌린 키·버튼·축·카메라 끌기를 모두 놓는다(포커스 잃음·일시 정지·세션 종료). */
    clear() {
        this.axis.x = 0;
        this.axis.z = 0;
        this.aim.x = 0;
        this.aim.y = 0;
        this.cameraDrag.pointer = null;
        this.canvas.classList.remove('is-orbiting');
        this.actions.releaseAll();
        this.device.releaseAll();
        this.actions.consume();
        this.lastInput = new Uint8Array(this.size);
    }

    dispose() {
        this.device.dispose();
    }

    writeMovement(input, offset, movement) {
        input[offset] = this.encodeAxis(movement.x);
        input[offset + 1] = this.encodeAxis(movement.z);
    }

    encodeAxis(value) {
        return Math.round(Math.max(-1, Math.min(1, value)) * this.axisScale) & 255;
    }

    /** 조준 한 바이트: 가로·세로를 -aimSteps..aimSteps 정수로 양자화해 상위·하위 4비트(2의 보수)에 담는다. 가운데는 0이다. */
    encodeAim(aim) {
        const step = (value) => Math.round(value * this.aimSteps) & 15;
        return (step(aim.x) << 4) | step(aim.y);
    }
}

export { RuntimeInput };
