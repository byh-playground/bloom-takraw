// 시뮬레이션 이벤트를 소리 id와 재생 변수(세기·좌우·음높이)로 옮긴다.
// 표시 전용이다. 시뮬레이션 상태를 읽거나 바꾸지 않고, 난수는 호출자가 넘긴다(롤백·재생에 영향이 없다).

import { TAKRAW_KICK_SOUND } from '../config/runtime.js';

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** 접촉 하나의 소리 id. 스파이크 > 발이 아닌 몸 > 발(속도 단계 × 타이밍 등급). */
function takrawKickSoundId(event, reference) {
    if (event.spike) return 'kickSpike';
    if (!String(event.part || '').startsWith('foot')) return 'kickBody';
    // 단계 이름·기준과 등급 접미사는 소리 정의와 같은 표(config/runtime.js TAKRAW_KICK_SOUND)에서 온다.
    const level = TAKRAW_KICK_SOUND.levels.find(
        (item) => event.speed / reference < item.below,
    ).name;
    return `kick${level}${TAKRAW_KICK_SOUND.gradeSuffix[event.timing?.grade] ?? ''}`;
}

/**
 * 이벤트 하나의 sound 저널 payload. 소리가 없는 이벤트는 null.
 * viewTeam: 화면을 보는 팀(화면 오른쪽은 1P가 +z, 2P가 -z). random: 0..1 난수 함수.
 * 득점·서브 신호는 음정이 있는 소리라 가운데에서 그대로 낸다(음높이 변주 없음).
 * 깊이감: 보는 사람에게서 먼 코트 끝일수록 음량이 distanceDrop(0..1)만큼까지 작아진다(카메라는 1P가 -x, 2P가 +x 쪽).
 */
function takrawSoundPayload(
    event,
    {
        reference,
        halfWidth,
        halfLength,
        viewTeam,
        panSpread,
        detuneCents,
        distanceDrop,
        random,
        matchPoint,
    },
) {
    const soundId = {
        touch: takrawKickSoundId(event, reference),
        land: 'land',
        net: 'net',
        serve: 'serve',
        point: matchPoint ? 'matchPoint' : 'point',
    }[event.type];
    if (!soundId) return null;
    const signal = event.type === 'point' || event.type === 'serve';
    const side = viewTeam === 1 ? -1 : 1;
    const far = clamp((side * (event.position?.x ?? 0)) / halfLength, -1, 1);
    const distance = 1 - (distanceDrop * (far + 1)) / 2;
    // 발차기 세기는 소리 단계가 나타내므로 음량은 좁게만 움직인다.
    const strength = signal
        ? 0.8
        : clamp((0.45 + (0.55 * event.speed) / reference) * distance, 0.2, 1);
    const pan =
        event.type === 'point'
            ? 0
            : clamp((side * (event.position?.z ?? 0)) / halfWidth, -1, 1) * panSpread;
    const detune = signal ? 0 : (random() - 0.5) * 2 * detuneCents;
    return { soundId, strength, pan, detune };
}

export { takrawSoundPayload };
