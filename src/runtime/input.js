import { ActionState, createDOMInput } from '@bloom-gamekit/input';

const ACTION_NAMES = Object.freeze(['left', 'right', 'forward', 'back', 'jump', 'kick']);

/**
 * 이 기기의 입력: 키·포인터 장치(createDOMInput), 행동 상태, 터치 패드 축, 발차기 조준, 마우스 카메라 회전, 마지막으로 만든 입력 바이트.
 * 명령(점프·발차기 눌림)의 순서는 세션이 정한다. 여기서는 눌림 엣지만 돌려준다.
 * 발차기 버튼은 누른·뗀 시각을 적어 두었다가, 그 엣지를 읽는 순간까지 지난 시간(ms, 정수)을 함께 돌려준다. 입력은 틱 시작에만 적용되므로
 * 시뮬레이션이 "누른 길이가 결과인 것"(서브 공 던지기 모으기)을 틱 수가 아니라 실제 누른 길이로 계산하는 데 쓴다.
 * 발차기와 조준은 화면의 발차기 버튼(touch-controls)에서만 들어온다. 키보드는 조준 값을 만들지 않는다.
 *   onPointer(event): 캔버스 포인터 이벤트마다 부른다(오디오 잠금 해제·리플레이 건너뛰기·카메라 회전은 세션이 정한다).
 */
class RuntimeInput {
    constructor({ canvas, config, onPointer }) {
        this.canvas = canvas;
        this.size = config.input.size;
        this.axisScale = config.input.axisScale;
        this.samples = Object.fromEntries(ACTION_NAMES.map((name) => [name, {}]));
        this.axis = { x: 0, z: 0 };
        this.aim = { x: 0, y: 0 };
        this.cameraDrag = { pointer: null, x: 0, y: 0 };
        this.lastInput = new Uint8Array(this.size);
        // 발차기 버튼을 마지막으로 누른·뗀 시각(performance.now, ms). sample이 엣지를 읽을 때 지난 시간으로 바꾸고 지운다.
        this.kickStamp = { press: null, release: null };
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
            },
            pointerButtons: { 2: 'cameraOrbit' },
            touchAction: 'none',
            onPointer,
        });
    }

    /**
     * 한 틱의 입력 바이트와 눌림 엣지. allowed가 아니면 바이트는 0이고 엣지도 없다.
     * movement(right, back)는 화면 기준 이동을 월드 축으로 바꾼다(보는 팀 기준).
     * edges.kickPressMs·kickReleaseMs: 이 표본 구간에 발차기를 누른·뗀 뒤 지금까지 지난 시간(ms, 0~255 정수). 그 엣지가 없으면 -1.
     */
    sample({ allowed, movement }) {
        const input = new Uint8Array(this.size);
        const edges = { jump: false, kick: false, kickPressMs: -1, kickReleaseMs: -1 };
        const now = performance.now(),
            elapsed = (stamp) =>
                stamp === null ? 0 : Math.max(0, Math.min(255, Math.round(now - stamp)));
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
            if (samples.kick.held) {
                input[3] = this.encodeAxis(this.aim.x);
                input[4] = this.encodeAxis(this.aim.y);
            }
            edges.jump = samples.jump.pressed;
            edges.kick = samples.kick.pressed;
            if (samples.kick.pressed) edges.kickPressMs = elapsed(this.kickStamp.press);
            if (samples.kick.released) edges.kickReleaseMs = elapsed(this.kickStamp.release);
        }
        this.kickStamp.press = this.kickStamp.release = null;
        this.actions.consume();
        this.lastInput = input.slice();
        return { input, edges };
    }

    /** 터치 버튼(점프·발차기) 하나의 눌림. source는 손가락 식별자다. */
    setTouch(action, source, down) {
        // 한 표본 구간에 여러 번이면 첫 누름과 마지막 뗌을 남긴다.
        if (action === 'kick') {
            if (down) this.kickStamp.press ??= performance.now();
            else this.kickStamp.release = performance.now();
        }
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
}

export { RuntimeInput };
