/**
 * 버튼 edge(점프·발차기의 누름·뗌)와 틱 안 위상의 단일 정의. 사람(runtime/input.js)·AI·네트워크·리플레이가 같은 형식을 쓴다.
 *
 * 위상: 한 틱을 simulation.kickStepMs 격자로 나눈 칸 번호(0부터, 칸 수는 설정에서 파생). edge는 그 칸의 물리 걸음 시작에 적용된다.
 * 위상을 갖는 것은 버튼 edge뿐이다. 이동 축·조준처럼 이어지는 값은 위상이 없고 틱 단위다.
 *
 * 명령 payload: [edge 코드, 위상]. 한 틱에 버튼마다 누름 하나·뗌 하나까지 싣는다.
 * 입력 바이트의 버튼 비트는 그 틱이 끝날 때 눌려 있는지다. 틱 시작 상태는 edge와 이 비트에서 정해져(takrawDecodeStroke) 따로 저장하지 않는다.
 */
const TAKRAW_EDGE_COMMANDS = Object.freeze({
    jumpPress: 1,
    kickPress: 2,
    jumpRelease: 5,
    kickRelease: 6,
});

/** 한 틱의 위상 칸 수. kickStepMs가 틱 길이를 나누어떨어지지 않으면 실패한다. */
function takrawPhaseCount(simulation, tickRate) {
    const count = 1000 / (tickRate * simulation.kickStepMs);
    if (Math.abs(count - Math.round(count)) > 1e-9 || count < 1 || count > 255)
        throw new RangeError(
            `kickStepMs ${simulation.kickStepMs}ms does not divide one tick (${count} phases)`,
        );
    return Math.round(count);
}

/** 틱(구간) 시작에서 elapsedMs 지난 시각의 위상. 구간 밖은 첫 칸·마지막 칸으로 자른다. */
function takrawPhaseOf(elapsedMs, simulation, count) {
    return Math.max(0, Math.min(count - 1, Math.floor(elapsedMs / simulation.kickStepMs)));
}

/**
 * 한 버튼의 한 틱 동작(stroke): start(틱 시작에 눌려 있는지), on(누름 위상, 없으면 -1), off(뗌 위상, 없으면 -1).
 * 순서는 start가 정한다: 눌려 있지 않았으면 누름→뗌, 눌려 있었으면 뗌→다시 누름.
 */
const TAKRAW_NO_STROKE = Object.freeze({ start: false, on: -1, off: -1 });

/**
 * 명령의 edge 위상과 틱 끝 버튼 비트로 stroke를 만든다.
 * 누름·뗌이 모두 있으면 위상이 앞선 쪽이 먼저고, 같은 칸이면 비트가 정한다(끝에 눌려 있으면 뗌→누름, 아니면 누름→뗌).
 */
function takrawDecodeStroke(on, off, heldAtEnd) {
    let start;
    if (on >= 0 && off >= 0) start = on === off ? heldAtEnd : off < on;
    else if (on >= 0) start = false;
    else if (off >= 0) start = true;
    else start = heldAtEnd;
    return { start, on, off };
}

/**
 * 위상 phase의 걸음에서 버튼이 눌려 있는지. 누른 칸에서는 반드시 눌려 있다(같은 칸의 뗌은 다음 칸에 적용).
 * phase가 칸 수 이상이면 틱이 끝난 뒤의 상태다.
 */
function takrawStrokeHeld(stroke, phase) {
    const { start, on, off } = stroke;
    if (start) {
        if (off < 0) return true;
        return phase < off || (on >= 0 && phase >= Math.max(on, off));
    }
    if (on < 0) return false;
    return phase >= on && (off < 0 || phase < Math.max(off, on + 1));
}

/** 이 틱 어느 걸음에서든 눌려 있는지(틱 단위 판단용). */
function takrawStrokeActive(stroke) {
    return stroke.start ? stroke.off !== 0 || stroke.on >= 0 : stroke.on >= 0;
}

/** 틱 시작이 아닌 곳에서 상태가 바뀌는지. 참이면 그 틱은 위상 격자(kickStepMs 걸음)로 돌아야 한다. */
function takrawStrokePhased(stroke) {
    return stroke.on > 0 || stroke.off > 0 || (stroke.on >= 0 && stroke.off >= 0);
}

/**
 * 원하는 상태 want(위상)에서 stroke를 만든다(AI). 원하는 상태가 처음 바뀌는 칸에 edge를 둔다(누름·뗌 하나씩까지).
 */
function takrawStrokeFromWant(start, count, want) {
    let held = start,
        on = -1,
        off = -1;
    for (let phase = 0; phase < count; phase++) {
        const wanted = want(phase);
        if (wanted && !held && on < 0) {
            on = phase;
            held = true;
        } else if (!wanted && held && off < 0) {
            off = phase;
            held = false;
        }
    }
    return { start, on, off };
}

export {
    TAKRAW_EDGE_COMMANDS,
    TAKRAW_NO_STROKE,
    takrawPhaseCount,
    takrawPhaseOf,
    takrawDecodeStroke,
    takrawStrokeHeld,
    takrawStrokeActive,
    takrawStrokePhased,
    takrawStrokeFromWant,
};
