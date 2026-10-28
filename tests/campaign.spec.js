import { test, expect } from 'playwright/test';
import { TakrawClub } from '../src/club/club.js';
import { TAKRAW_SCHOOLS } from '../src/config/schools.js';

test('첫 클리어 포인트: 저장 복구·동일 경기 재시도·재클리어는 중복 지급하지 않는다', async () => {
  const club = new TakrawClub({});
  const legacy = club._default(); delete legacy.campaign; club.record = legacy;
  club._mutate = async mutate => {
    const next = structuredClone(club.record), result = mutate(next);
    if (result !== false) { club._validate(next); club.record = next; }
    return { changed: result !== false };
  };
  let number = 0;
  const award = (schoolId, won = true, id = (++number).toString(16).padStart(32, '0')) => club.rewardMatch({id,won,mode:'match',schoolId});
  try {
    const initial = club.record.trainingPoints, amount = TAKRAW_SCHOOLS[0].firstClearTrainingPoints;
    const id = 'e'.repeat(32);
    await award('sprout',true,id); expect(club.record.trainingPoints).toBe(initial+amount);
    await award('sprout',true,id); expect(club.record.trainingPoints).toBe(initial+amount);
    club.record = structuredClone(club.record); club._validate(club.record);
    await award('sprout'); expect(club.record.trainingPoints).toBe(initial+amount);
    expect(club.record.lastReward.trainingPoints).toBe(0);
    await award('flame',false); expect(club.record.trainingPoints).toBe(initial+amount);
    await award('flame'); expect(club.record.trainingPoints).toBe(initial+amount+TAKRAW_SCHOOLS[1].firstClearTrainingPoints);
    const before = club.record.trainingPoints;
    await award(null); expect(club.record.trainingPoints).toBe(before+3);
  } finally {club.dispose();}
});

test('도장깨기 형식: 구 저장 호환과 학교 순서·중복·형식 검증', () => {
  const club = new TakrawClub({});
  try {
    const record = club._default(), { campaign, ...legacy } = record;
    expect(campaign).toEqual({ cleared: [] });
    expect(() => club._validate(legacy)).not.toThrow();
    expect(() => club._validate({ ...record, campaign: { cleared: ['sprout', 'flame'] } })).not.toThrow();
    for (const bad of [null, 3, [], {}, {cleared:null}, {cleared:['unknown']}, {cleared:['flame']},
      {cleared:['sprout','sprout']}, {cleared:new Array(1)}, {cleared:[],extra:true}]) {
      expect(() => club._validate({ ...record, campaign: bad })).toThrow();
    }
  } finally { club.dispose(); }
});

test('도장깨기 승리: 순서 해금·재도전·실패·보상 재시도 중복 방지', async () => {
  const club = new TakrawClub({});
  club.record = club._default();
  club._mutate = async mutate => {
    const next = structuredClone(club.record), result = mutate(next);
    if (result !== false) { club._validate(next); club.record = next; }
    return { changed: result !== false };
  };
  let number = 0;
  const result = (schoolId, won = true, id = (++number).toString(16).padStart(32, '0')) => club.rewardMatch({ id, mode:'match', won, schoolId });
  try {
    await expect(result('flame')).rejects.toThrow();
    await result('sprout', false); expect(club.getView().campaign.cleared).toEqual([]);
    const id = 'f'.repeat(32);
    await result('sprout', true, id); await result('sprout', true, id);
    expect(club.getView().campaign.cleared).toEqual(['sprout']);
    await result('sprout'); expect(club.getView().campaign.cleared).toEqual(['sprout']);
    await result('flame'); expect(club.getView().campaign.cleared).toEqual(['sprout','flame']);
  } finally { club.dispose(); }
});

