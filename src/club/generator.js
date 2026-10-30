import { TAKRAW_NAME_POOL } from './names-ko.js';

/** 뽑기용 선수 생성기. 등급이 정해진 뒤 이름·역할·능력치·특징을 난수 함수 하나로 만든다. 규칙 수치는 TAKRAW_CLUB_RULES.generation이 소유한다. */

const pick = (list, random) => list[Math.floor(random() * list.length)];
const between = (low, high, random) => low + Math.floor(random() * (high - low + 1));
function shuffled(list, random) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

/**
 * 등급(rarity)에 맞는 새 선수 카드 하나를 만든다.
 * 능력치는 기본값에서 조금씩 흩어지고, 등급이 높을수록 역할의 핵심 능력치가 더 많고 높게 솟는다.
 * @param {{ id: string, rarity: string, random: () => number, rules: object, takenNames?: string[], takenNumbers?: number[] }} input
 */
function takrawGenerateCard({ id, rarity, random, rules, takenNames = [], takenNumbers = [] }) {
  const generation = rules.generation, spec = generation.rarity[rarity];
  if (!spec) throw new Error('알 수 없는 등급이에요.');
  const role = pick(rules.roles, random).id, focus = generation.focus[role];
  const others = rules.stats.map(stat => stat.id).filter(key => !focus.includes(key));
  const peaks = [...shuffled(focus, random), ...shuffled(others, random)].slice(0, spec.peaks);
  const stats = Object.fromEntries(rules.stats.map(stat => [stat.id, generation.base + between(0, spec.rest, random)]));
  for (const key of peaks) stats[key] = between(spec.range[0], spec.range[1], random);
  const top = Object.entries(stats).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([key]) => generation.phrases[key]);
  const names = pickFreshName(takenNames, random);
  const number = freeNumber(takenNumbers, random);
  return { id, name: names, tag: top.join(' · '), preferredRole: role, rarity, number, stats };
}

/** 이미 쓰는 이름은 몇 번 피해서 뽑고, 풀이 모자라면 겹침을 허용한다. */
function pickFreshName(taken, random) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const name = pick(TAKRAW_NAME_POOL, random);
    if (!taken.includes(name)) return name;
  }
  return pick(TAKRAW_NAME_POOL, random);
}

function freeNumber(taken, random) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const number = between(10, 99, random);
    if (!taken.includes(number)) return number;
  }
  return between(10, 99, random);
}

export { takrawGenerateCard };
