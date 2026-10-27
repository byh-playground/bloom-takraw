import { test, expect } from 'playwright/test';
import { TAKRAW_CONFIG } from '../src/config/game.js';
import { TakrawGame } from '../src/simulation/game.js';
import { seedFromText } from '../src/simulation/ai-brain.js';

// 온라인 동기 시험: 두 피어가 같은 방 코드·같은 입력으로 같은 상태를 만드는지, 롤백(저장→복원→재실행)이 끊김 없는 진행과 같은지 확인한다.
// 네트워크 전송은 포함하지 않는다(전송 계층은 gamekit 소유). 시뮬레이션의 결정론과 스냅샷 완전성만 본다.
const rapierPath = process.env.RAPIER_MODULE;
test.skip(!rapierPath, 'RAPIER_MODULE이 없어 건너뜀');
const loadRapier = async () => { const loaded = await import(rapierPath); const RAPIER = loaded.default ?? loaded; await RAPIER.init(); return RAPIER; };

const TICKS = 3600, EVERY = 300;
const fingerprint = game => {
  const text = JSON.stringify(game.save());
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${h >>> 0}`;
};

/** 틱 번호만으로 정해지는 두 사람의 입력(이동·점프·발차기·눌림 명령). 같은 틱이면 항상 같다. */
function framesAt(tick) {
  const bits = (salt) => { let h = Math.imul((tick * 2654435761) ^ salt, 0x85ebca6b); h ^= h >>> 15; return h >>> 0; };
  const byte = value => value & 255;
  const entry = (playerId, salt) => {
    const r = bits(salt), phase = Math.floor(tick / 40);
    const hold = bits(salt + phase * 7) % 5; // 40틱 단위로 이동 방향이 바뀐다
    const input = new Uint8Array(6);
    input[0] = byte(hold === 0 ? 0 : hold === 1 ? 127 : hold === 2 ? -127 : (r >>> 3));
    input[1] = byte(hold === 3 ? 100 : hold === 4 ? -100 : (r >>> 11));
    input[2] = ((r >>> 5) % 9 === 0 ? 1 : 0) | ((r >>> 9) % 7 === 0 ? 2 : 0);
    const commands = [];
    if (input[2] & 1) commands.push({ payload: [1] });
    if (input[2] & 2) commands.push({ payload: [2] });
    return { playerId, input, commands };
  };
  return { tick, tickRate: 60, inputs: [entry('a', 1), entry('b', 2)] };
}

async function peer(room) {
  const game = new TakrawGame({ RAPIER: await loadRapier(), config: TAKRAW_CONFIG });
  game.reset('online', undefined, seedFromText(room));
  return game;
}

test('두 피어: 같은 방 코드·같은 입력이면 매 구간 상태가 같다', async () => {
  const a = await peer('ROOM-7Q'), b = await peer('ROOM-7Q');
  for (let tick = 1; tick <= TICKS; tick++) {
    a.step(framesAt(tick)); b.step(framesAt(tick));
    if (tick % EVERY === 0) expect(fingerprint(a), `tick ${tick}`).toBe(fingerprint(b));
  }
  expect(a.metrics.contacts).toBeGreaterThan(0);
  expect(a.state.rally).toBeGreaterThan(0);
  a.dispose(); b.dispose();
});

test('방 코드가 다르면 경기 전개가 달라진다(변주가 실제로 있다)', async () => {
  const a = await peer('ROOM-7Q'), b = await peer('ROOM-9X');
  for (let tick = 1; tick <= 1500; tick++) { a.step(framesAt(tick)); b.step(framesAt(tick)); }
  expect(fingerprint(a)).not.toBe(fingerprint(b));
  a.dispose(); b.dispose();
});

test('롤백: 저장 시점으로 되돌려 같은 입력을 다시 실행하면 끊김 없는 진행과 같다', async () => {
  const straight = await peer('ROOM-7Q'), rolled = await peer('ROOM-7Q');
  const prints = [], SAVE_AT = 1000;
  let snapshot = null;
  for (let tick = 1; tick <= TICKS; tick++) {
    straight.step(framesAt(tick));
    if (tick % EVERY === 0) prints.push([tick, fingerprint(straight)]);
  }
  for (let tick = 1; tick <= TICKS; tick++) {
    if (tick === SAVE_AT) snapshot = structuredClone(rolled.save());
    rolled.step(framesAt(tick));
    if (tick === SAVE_AT + 200) {
      // 예측이 틀렸다고 가정: 잘못된 입력으로 40틱 더 진행한 뒤 저장 시점으로 되돌린다.
      for (let wrong = tick + 1; wrong <= tick + 40; wrong++) rolled.step(framesAt(wrong + 5000));
      expect(rolled.validate(snapshot)).toBe(true);
      rolled.load(structuredClone(snapshot));
      for (let again = SAVE_AT; again <= tick; again++) rolled.step(framesAt(again));
    }
    if (tick % EVERY === 0) expect(fingerprint(rolled), `tick ${tick}`).toBe(prints.find(([t]) => t === tick)[1]);
  }
  straight.dispose(); rolled.dispose();
});

test('새 피어가 스냅샷으로 합류해도 이후 상태가 같다(재접속·중도 참여)', async () => {
  const host = await peer('ROOM-7Q');
  for (let tick = 1; tick <= 1400; tick++) host.step(framesAt(tick));
  const joiner = new TakrawGame({ RAPIER: await loadRapier(), config: TAKRAW_CONFIG });
  const snapshot = structuredClone(host.save());
  expect(joiner.validate(snapshot)).toBe(true);
  joiner.load(snapshot);
  for (let tick = 1401; tick <= 2600; tick++) {
    host.step(framesAt(tick)); joiner.step(framesAt(tick));
    if (tick % EVERY === 0) expect(fingerprint(joiner), `tick ${tick}`).toBe(fingerprint(host));
  }
  host.dispose(); joiner.dispose();
});

test('다시 시작 명령: 두 피어가 같은 새 시드로 같은 경기를 시작한다', async () => {
  const a = await peer('ROOM-7Q'), b = await peer('ROOM-7Q');
  const restart = tick => { const frame = framesAt(tick); frame.inputs[0].commands.push({ payload: [4] }); return frame; };
  for (let tick = 1; tick <= 900; tick++) { a.step(framesAt(tick)); b.step(framesAt(tick)); }
  const before = a.state.seed;
  a.step(restart(901)); b.step(restart(901));
  expect(a.state.seed).toBe(b.state.seed);
  expect(a.state.seed).not.toBe(before);
  expect(a.state.score).toEqual([0, 0]);
  for (let tick = 902; tick <= 2000; tick++) { a.step(framesAt(tick)); b.step(framesAt(tick)); }
  expect(fingerprint(a)).toBe(fingerprint(b));
  a.dispose(); b.dispose();
});
