import { ActionState, createDOMInput } from '@bloom-gamekit/input';
import { takrawPhaseCount, takrawPhaseOf } from '../simulation/input-edges.js';

const ACTION_NAMES = Object.freeze(['left', 'right', 'forward', 'back', 'jump', 'kick']);
/** 위상을 싣는 버튼. 이동 축·조준은 이어지는 값이라 위상이 없다. */
const BUTTONS = Object.freeze(['jump', 'kick']);
/** 키보드로 누르는 버튼(키 코드 → 버튼). 누른·뗀 시각을 적는 데만 쓴다(눌림 상태는 createDOMInput이 정한다). */
const BUTTON_KEYS = Object.freeze({ Space: 'jump' });

/**
 * 이 기기의 입력: 키·포인터 장치(createDOMInput), 행동 상태, 터치 패드 축, 발차기 조준, 마우스 카메라 회전, 마지막으로 만든 입력 바이트.
 * 명령(점프·발차기 누름·뗌)의 순서는 세션이 정한다. 여기서는 edge와 그 위상(틱 안 칸 번호, simulation/input-edges.js)만 돌려준다.
 * 위상은 버튼을 실제로 누른·뗀 시각(이벤트를 받은 순간의 performance.now)으로 정한다. 다음 틱의 같은 위상에 적용되어 누름에서 적용까지가 늘 한 틱이다.
 * 발차기와 조준은 화면의 발차기 버튼(touch-controls)에서만 들어온다. 키보드는 조준 값을 만들지 않는다.
 *   onPointer(event): 캔버스 포인터 이벤트마다 부른다(오디오 잠금 해제·리플레이 건너뛰기·카메라 회전은 세션이 정한다).
 */
class RuntimeInput {
    constructor({ canvas, config, time, onPointer }) {
        this.canvas = canvas;
        this.simulation = config.simulation;
        this.tickMs = 1000 / time.tickRate;
        this.phases = takrawPhaseCount(config.simulation, time.tickRate);
        // 버튼마다 마지막으로 누른·뗀 시각(ms). sample이 edge를 읽을 때 위상으로 바꾸고 지운다.
        this.stamps = Object.fromEntries(
            BUTTONS.map((name) => [name, { press: null, release: null }]),
        );
        this.onKey = (event) => {
            const button = BUTTON_KEYS[event.code];
            if (button && !event.repeat) this.stamp(button, event.type === 'keydown');
        };
        window.addEventListener('keydown', this.onKey, true);
        window.addEventListener('keyup', this.onKey, true);
        this.size = config.input.size;
        this.axisScale = config.input.axisScale;
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
            },
            pointerButtons: { 2: 'cameraOrbit' },
            touchAction: 'none',
            onPointer,
        });
    }

    /**
     * 한 틱의 입력 바이트와 버튼 edge. allowed가 아니면 바이트는 0이고 edge도 없다.
     * movement(right, back)는 화면 기준 이동을 월드 축으로 바꾼다(보는 팀 기준).
     * tickEndMs는 이 입력이 들어갈 틱을 계산할 시각(시뮬 루프의 다음 마감)이다. 그 앞 한 틱 구간 안의 위치가 위상이 된다.
     * edges: 버튼마다 { press, release } 위상(없으면 -1).
     */
    sample({ allowed, movement, tickEndMs }) {
        const input = new Uint8Array(this.size);
        const edges = {
            jump: { press: -1, release: -1 },
            kick: { press: -1, release: -1 },
        };
        const now = performance.now(),
            tickStartMs = tickEndMs - this.tickMs;
        const phaseAt = (stamp) =>
            takrawPhaseOf((stamp ?? now) - tickStartMs, this.simulation, this.phases);
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
            for (const name of BUTTONS) {
                const stamps = this.stamps[name];
                if (samples[name].pressed) edges[name].press = phaseAt(stamps.press);
                if (samples[name].released) edges[name].release = phaseAt(stamps.release);
            }
        }
        for (const name of BUTTONS) this.stamps[name].press = this.stamps[name].release = null;
        this.actions.consume();
        this.lastInput = input.slice();
        return { input, edges };
    }

    /** 터치 버튼(점프·발차기) 하나의 눌림. source는 손가락 식별자다. */
    setTouch(action, source, down) {
        this.stamp(action, Boolean(down));
        this.actions.set(action, `touch:${source}`, Boolean(down));
    }

    /** 버튼을 누른·뗀 시각을 적는다. 한 표본 구간에 여러 번이면 첫 누름과 마지막 뗌을 남긴다. */
    stamp(button, down) {
        const stamps = this.stamps[button],
            now = performance.now();
        if (down) stamps.press ??= now;
        else stamps.release = now;
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
        window.removeEventListener('keydown', this.onKey, true);
        window.removeEventListener('keyup', this.onKey, true);
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
