import { test, expect } from 'playwright/test';
import { TakrawClub } from '../src/club/club.js';
import { TAKRAW_SCHOOLS, TAKRAW_LADDER, takrawOpponents, takrawPickHome } from '../src/config/schools.js';

// random 0 → 내 학교는 로스터 첫 학교(sprout), 상대는 나머지 9곳이다.
const newClub = () => new TakrawClub({ random: () => 0 }), HOME = takrawPickHome(0), OPPONENTS = takrawOpponents(HOME);

test('첫 클리어 포인트: 저장 복구·동일 경기 재시도·재클리어는 중복 지급하지 않는다', async () => {
  const club = newClub();
  club.record = club._default();
  club._mutate = async mutate => {
    const next = structuredClone(club.record), result = mutate(next);
    if (result !== false) { club._validate(next); club.record = next; }
    return { changed: result !== false };
  };
  let number = 0;
  const award = (schoolId, won = true, id = (++number).toString(16).padStart(32, '0')) => club.rewardMatch({id,won,mode:'match',schoolId});
  try {
    const initial = club.record.trainingPoints, amount = OPPONENTS[0].firstClearTrainingPoints;
    const id = 'e'.repeat(32);
    await award(OPPONENTS[0].id,true,id); expect(club.record.trainingPoints).toBe(initial+amount);
    await award(OPPONENTS[0].id,true,id); expect(club.record.trainingPoints).toBe(initial+amount);
    club.record = structuredClone(club.record); club._validate(club.record);
    await award(OPPONENTS[0].id); expect(club.record.trainingPoints).toBe(initial+amount);
    expect(club.record.lastReward.trainingPoints).toBe(0);
    await award(OPPONENTS[1].id,false); expect(club.record.trainingPoints).toBe(initial+amount);
    await award(OPPONENTS[1].id); expect(club.record.trainingPoints).toBe(initial+amount+OPPONENTS[1].firstClearTrainingPoints);
    const before = club.record.trainingPoints;
    await award(null); expect(club.record.trainingPoints).toBe(before+3);
  } finally {club.dispose();}
});

test('도장깨기 형식: 구 저장 호환과 내 학교·상대 순서·중복·형식 검증', () => {
  const club = newClub();
  try {
    const record = club._default(), { campaign, ...legacy } = record, [first, second] = OPPONENTS.map(school => school.id);
    expect(campaign).toEqual({ home: HOME, cleared: [] });
    expect(() => club._validate(legacy)).not.toThrow();
    expect(() => club._validate({ ...record, campaign: { cleared: [] } })).not.toThrow(); // 내 학교가 없던 이전 저장본
    expect(() => club._validate({ ...record, campaign: { home: HOME, cleared: [first, second] } })).not.toThrow();
    for (const bad of [null, 3, [], {}, { cleared: null }, { home: HOME }, { home: 'unknown', cleared: [] }, { home: HOME, cleared: [HOME] },
      { home: HOME, cleared: [second] }, { home: HOME, cleared: [first, first] }, { home: HOME, cleared: new Array(1) }, { home: HOME, cleared: [], extra: true }]) {
      expect(() => club._validate({ ...record, campaign: bad })).toThrow();
    }
  } finally { club.dispose(); }
});

test('내 학교: 처음 정해지면 상대 목록에서 빠지고 단계는 난이도 순이다', () => {
  expect(OPPONENTS).toHaveLength(TAKRAW_SCHOOLS.length - 1);
  for (const school of TAKRAW_SCHOOLS) {
    const list = takrawOpponents(school.id);
    expect(list.map(value => value.id)).not.toContain(school.id);
    expect(list.map(value => value.stage)).toEqual(TAKRAW_LADDER.map(row => row.stage));
    expect(list.map(value => value.ai)).toEqual(TAKRAW_LADDER.map(row => row.ai)); // 학교는 외형만, 난이도는 단계가 정한다.
  }
  for (let i = 0; i < 1000; i++) expect(TAKRAW_SCHOOLS.some(school => school.id === takrawPickHome(i / 1000))).toBeTruthy();
  expect(takrawPickHome(0)).toBe(TAKRAW_SCHOOLS[0].id); expect(takrawPickHome(0.999999)).toBe(TAKRAW_SCHOOLS.at(-1).id);
  const abilities = TAKRAW_LADDER.map(row => row.ai.players[0].stats.defense);
  expect([...abilities].sort((a, b) => a - b)).toEqual(abilities);
});

test('도장깨기 승리: 순서 해금·재도전·실패·보상 재시도 중복 방지', async () => {
  const club = newClub();
  club.record = club._default();
  club._mutate = async mutate => {
    const next = structuredClone(club.record), result = mutate(next);
    if (result !== false) { club._validate(next); club.record = next; }
    return { changed: result !== false };
  };
  let number = 0;
  const result = (schoolId, won = true, id = (++number).toString(16).padStart(32, '0')) => club.rewardMatch({ id, mode:'match', won, schoolId });
  try {
    await expect(result(OPPONENTS[1].id)).rejects.toThrow();
    await result(OPPONENTS[0].id, false); expect(club.getView().campaign.cleared).toEqual([]);
    const id = 'f'.repeat(32);
    await result(OPPONENTS[0].id, true, id); await result(OPPONENTS[0].id, true, id);
    expect(club.getView().campaign.cleared).toEqual([OPPONENTS[0].id]);
    await result(OPPONENTS[0].id); expect(club.getView().campaign.cleared).toEqual([OPPONENTS[0].id]);
    await result(OPPONENTS[1].id); expect(club.getView().campaign.cleared).toEqual([OPPONENTS[0].id,OPPONENTS[1].id]);
  } finally { club.dispose(); }
});

