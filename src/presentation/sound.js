// 시뮬레이션 이벤트를 소리 id와 재생 변수(세기·좌우·음높이)로 옮긴다.
// 표시 전용이다. 시뮬레이션 상태를 읽거나 바꾸지 않고, 난수는 호출자가 넘긴다(롤백·재생에 영향이 없다).

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// 공 속도 / 기준 속도가 below 미만이면 그 단계. config/runtime.js의 KICK_LEVELS 이름과 같아야 한다.
const KICK_LEVELS = [
  { name: 'Soft', below: 0.45 },
  { name: 'Medium', below: 0.8 },
  { name: 'Hard', below: Infinity },
];
const KICK_GRADE_SUFFIX = { perfect: 'Perfect', good: 'Good' };

/** 접촉 하나의 소리 id. 스파이크 > 발이 아닌 몸 > 발(속도 단계 × 타이밍 등급). */
function takrawKickSoundId(event, reference) {
  if (event.spike) return 'kickSpike';
  if (!String(event.part || '').startsWith('foot')) return 'kickBody';
  const level = KICK_LEVELS.find(item => event.speed / reference < item.below).name;
  return `kick${level}${KICK_GRADE_SUFFIX[event.timing?.grade] ?? ''}`;
}

/**
 * 이벤트 하나의 sound 저널 payload. 소리가 없는 이벤트는 null.
 * viewTeam: 화면을 보는 팀(화면 오른쪽은 1P가 +z, 2P가 -z). random: 0..1 난수 함수.
 * 득점·서브 신호는 음정이 있는 소리라 가운데에서 그대로 낸다(음높이 변주 없음).
 */
function takrawSoundPayload(event, { reference, halfWidth, viewTeam, panSpread, detuneCents, random, matchPoint }) {
  const soundId = { touch: takrawKickSoundId(event, reference), land: 'land', net: 'net', serve: 'serve', point: matchPoint ? 'matchPoint' : 'point' }[event.type];
  if (!soundId) return null;
  const signal = event.type === 'point' || event.type === 'serve';
  // 발차기 세기는 소리 단계가 나타내므로 음량은 좁게만 움직인다.
  const strength = signal ? 0.8 : clamp(0.45 + 0.55 * event.speed / reference, 0.35, 1);
  const side = viewTeam === 1 ? -1 : 1;
  const pan = event.type === 'point' ? 0 : clamp(side * (event.position?.z ?? 0) / halfWidth, -1, 1) * panSpread;
  const detune = signal ? 0 : (random() - 0.5) * 2 * detuneCents;
  return { soundId, strength, pan, detune };
}

export { takrawKickSoundId, takrawSoundPayload };
