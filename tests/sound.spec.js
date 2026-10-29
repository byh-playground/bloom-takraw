import { test, expect } from 'playwright/test';
import { TAKRAW_CONFIG } from '../src/config/game.js';
import { TAKRAW_RUNTIME } from '../src/config/runtime.js';
import { takrawKickSoundId, takrawSoundPayload } from '../src/presentation/sound.js';

const reference = TAKRAW_RUNTIME.feedback.soundReferenceSpeed;
const sounds = TAKRAW_RUNTIME.audio.sounds;
const touch = (extra = {}) => ({ type: 'touch', part: 'footR', speed: reference * 0.6, position: { x: 0, y: 1, z: 0 }, ...extra });
const options = (extra = {}) => ({
  reference, halfWidth: TAKRAW_CONFIG.court.halfWidth, halfLength: TAKRAW_CONFIG.court.halfLength, viewTeam: 0,
  panSpread: TAKRAW_RUNTIME.feedback.soundPanSpread, detuneCents: TAKRAW_RUNTIME.feedback.soundDetuneCents,
  distanceDrop: TAKRAW_RUNTIME.feedback.soundDistanceDrop,
  random: () => 0.5, matchPoint: false, ...extra,
});

test('발차기 소리: 스파이크 > 발이 아닌 몸 > 공 속도 단계 × 타이밍 등급 순으로 고른다', () => {
  expect(takrawKickSoundId(touch({ spike: true, part: 'lowerLegR' }), reference)).toBe('kickSpike');
  for (const part of ['lowerLegR', 'upperLegL', 'pelvis', 'torso', 'head']) expect(takrawKickSoundId(touch({ part }), reference)).toBe('kickBody');
  expect(takrawKickSoundId(touch({ speed: reference * 0.2 }), reference)).toBe('kickSoft');
  expect(takrawKickSoundId(touch({ speed: reference * 0.6 }), reference)).toBe('kickMedium');
  expect(takrawKickSoundId(touch({ speed: reference * 1.4 }), reference)).toBe('kickHard');
  expect(takrawKickSoundId(touch({ speed: reference * 0.2, timing: { grade: 'good' } }), reference)).toBe('kickSoftGood');
  expect(takrawKickSoundId(touch({ speed: reference * 1.4, timing: { grade: 'perfect' } }), reference)).toBe('kickHardPerfect');
  expect(takrawKickSoundId(touch({ timing: { grade: 'miss' } }), reference)).toBe('kickMedium');
});

test('고른 소리 id는 모두 오디오 설정에 있고 재생 변수는 모듈이 받는 범위 안이다', () => {
  const seen = new Set();
  const events = [];
  for (const part of ['footR', 'lowerLegL', 'torso']) for (const ratio of [0.1, 0.6, 1.5]) for (const grade of [undefined, 'good', 'perfect'])
    for (const spike of [false, true]) events.push(touch({ part, spike, speed: reference * ratio, timing: grade && { grade } }));
  for (const type of ['land', 'net', 'serve', 'point']) events.push({ type, speed: reference, position: { x: 3, y: 0, z: 2 } });
  for (const event of events) for (const viewTeam of [0, 1]) for (const matchPoint of [false, true]) for (const random of [() => 0, () => 0.999]) {
    const payload = takrawSoundPayload(event, options({ viewTeam, matchPoint, random }));
    seen.add(payload.soundId);
    expect(sounds[payload.soundId], payload.soundId).toBeTruthy();
    expect(payload.strength).toBeGreaterThan(0); expect(payload.strength).toBeLessThanOrEqual(1);
    expect(Math.abs(payload.pan)).toBeLessThanOrEqual(1);
    expect(Math.abs(payload.detune)).toBeLessThanOrEqual(TAKRAW_RUNTIME.feedback.soundDetuneCents);
  }
  // 설정의 발차기 소리 12종(단계 3×등급 3 + 몸 + 스파이크)이 모두 실제로 골라질 수 있다.
  for (const id of Object.keys(sounds).filter(name => name.startsWith('kick'))) expect(seen.has(id), id).toBe(true);
  expect(takrawSoundPayload({ type: 'unknown', speed: 1, position: {} }, options())).toBeNull();
});

test('좌우: 화면 오른쪽이 1P는 +z, 2P는 -z이고 득점 함성은 가운데, 음정 있는 신호는 음높이를 흔들지 않는다', () => {
  const at = z => touch({ position: { x: 0, y: 1, z } });
  const right = takrawSoundPayload(at(TAKRAW_CONFIG.court.halfWidth), options({ viewTeam: 0 })).pan;
  expect(right).toBeCloseTo(TAKRAW_RUNTIME.feedback.soundPanSpread);
  expect(takrawSoundPayload(at(TAKRAW_CONFIG.court.halfWidth), options({ viewTeam: 1 })).pan).toBeCloseTo(-right);
  expect(takrawSoundPayload(at(0), options()).pan).toBe(0);
  const point = takrawSoundPayload({ type: 'point', speed: 0, position: { x: 0, y: 0, z: 2 } }, options({ random: () => 1 }));
  expect(point).toMatchObject({ soundId: 'point', pan: 0, detune: 0 });
  expect(takrawSoundPayload({ type: 'point', speed: 0, position: {} }, options({ matchPoint: true })).soundId).toBe('matchPoint');
  expect(takrawSoundPayload({ type: 'serve', speed: 0, position: { z: 1 } }, options({ random: () => 1 })).detune).toBe(0);
  const low = takrawSoundPayload(touch(), options({ random: () => 0 })).detune, high = takrawSoundPayload(touch(), options({ random: () => 1 })).detune;
  expect(low).toBeCloseTo(-TAKRAW_RUNTIME.feedback.soundDetuneCents); expect(high).toBeCloseTo(TAKRAW_RUNTIME.feedback.soundDetuneCents);
});

test('깊이감: 보는 사람에게서 먼 코트 끝일수록 작게 나고 1P와 2P는 가까운 쪽이 반대다', () => {
  const at = x => touch({ position: { x, y: 1, z: 0 } });
  const halfLength = TAKRAW_CONFIG.court.halfLength, drop = TAKRAW_RUNTIME.feedback.soundDistanceDrop;
  const near = takrawSoundPayload(at(-halfLength), options({ viewTeam: 0 })).strength;
  const mid = takrawSoundPayload(at(0), options({ viewTeam: 0 })).strength;
  const far = takrawSoundPayload(at(halfLength), options({ viewTeam: 0 })).strength;
  expect(near).toBeGreaterThan(mid); expect(mid).toBeGreaterThan(far);
  expect(far / near).toBeCloseTo(1 - drop, 1);
  // 2P는 +x 쪽에서 보므로 같은 위치의 먼·가까움이 뒤바뀐다.
  expect(takrawSoundPayload(at(halfLength), options({ viewTeam: 1 })).strength).toBeCloseTo(near);
  expect(takrawSoundPayload(at(-halfLength), options({ viewTeam: 1 })).strength).toBeCloseTo(far);
  // 득점·서브 신호는 거리와 무관하다.
  const point = x => takrawSoundPayload({ type: 'point', speed: 0, position: { x, z: 0 } }, options()).strength;
  expect(point(halfLength)).toBe(point(-halfLength));
});

test('배경 음악: 곡 파일·크레딧·베드 설정이 서로 맞고 소리는 작게 깔리도록 제한돼 있다', async () => {
  const fs = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { bgm, audio } = TAKRAW_RUNTIME;
  const file = fileURLToPath(bgm.url);
  const bytes = fs.readFileSync(file);
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('OggS');
  expect(bytes.length).toBeLessThan(1024 * 1024);
  // 곡을 바꾸면 출처 표기도 같이 바뀌어야 한다.
  expect(fs.readFileSync(new URL('../assets/audio/CREDITS.md', import.meta.url), 'utf8')).toContain((await import('node:path')).basename(file));
  const layer = audio.beds.bgm.layers[0];
  expect(layer).toMatchObject({ kind: 'buffer', bufferId: 'bgm' });
  expect(audio.categories[audio.beds.bgm.category]).toBeTruthy();
  expect(bgm.level).toBeGreaterThan(0); expect(bgm.level).toBeLessThanOrEqual(0.8);
  // 홈에는 효과음이 없어 조금 더 크게 둘 수 있지만 1을 넘지 않는다.
  expect(bgm.homeLevel).toBeGreaterThanOrEqual(bgm.level); expect(bgm.homeLevel).toBeLessThanOrEqual(1);
  // 곡 안의 크기 편차를 레이어 컴프레서로 줄인다. 자동 보정으로 커지므로 gain은 1보다 작게 둔다.
  expect(layer.compressor.ratio).toBeGreaterThan(1); expect(layer.gain).toBeLessThan(1);
  // 곡의 노이즈 퍼커션(0~3초·20~22초)이 거칠게 들리지 않도록 고음을 덜어 내는 로우패스가 걸려 있다.
  expect(layer).toMatchObject({ type: 'lowpass' }); expect(layer.hz).toBeLessThanOrEqual(3000);
  expect(bgm.pausedLevel).toBeLessThan(bgm.level);
  for (const duck of Object.values(bgm.duck)) {
    expect(duck.depth).toBeGreaterThan(0); expect(duck.depth).toBeLessThan(1);
    expect(duck.holdMs).toBeGreaterThan(0); expect(duck.releaseMs).toBeGreaterThan(0);
  }
  // 득점은 일반 타격보다 깊고 길게 비워 득점 소리가 들리게 한다.
  expect(bgm.duck.point.depth).toBeLessThan(bgm.duck.touch.depth);
  expect(bgm.duck.point.holdMs + bgm.duck.point.releaseMs).toBeGreaterThan(bgm.duck.touch.holdMs + bgm.duck.touch.releaseMs);
});
