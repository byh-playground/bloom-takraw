// 학교 이름·색상은 출시 전 임시값입니다. 학교(외형·속성)와 도전 단계(AI 난이도)의 단일 출처입니다.
// 학교는 이름·색·속성만 가지고, 난이도는 도전 단계(TAKRAW_LADDER)가 정합니다. 내 학교는 처음 저장할 때 한 번 정해지고 상대 목록에서 빠집니다.
import { TAKRAW_CONFIG, TAKRAW_GAME_NAME } from './game.js';

/** 속성의 단일 목록. 학교의 element와 스파이크 연출(game.js visual.impact.elements)이 이 id를 쓴다. */
const TAKRAW_ELEMENTS = Object.freeze([
  { id: 'grass', name: '풀' }, { id: 'fire', name: '불' }, { id: 'water', name: '물' }, { id: 'lightning', name: '번개' }, { id: 'moon', name: '달빛' },
  { id: 'sun', name: '햇빛' }, { id: 'ice', name: '얼음' }, { id: 'earth', name: '땅' }, { id: 'wind', name: '바람' }, { id: 'dark', name: '어둠' },
].map(Object.freeze));

// 성향과 능력 프리셋도 출시 전 임시값이다. 실제 득점 점유율은 검증 문서에 기록한다.
const ai = (reaction, clearance, depth, lateral, ability, stableControl = false) => Object.freeze({
  temperament: Object.freeze({ reaction: Object.freeze(reaction), clearance: Object.freeze(clearance), depth, lateral }),
  players: Object.freeze(['receiver', 'setter', 'attacker'].map((role, index) => Object.freeze({ role,
    stats: Object.freeze(Object.fromEntries(Object.keys(TAKRAW_CONFIG.athletes.bonus).map(key => [key,
      stableControl && ['mobility', 'jump', 'flexibility'].includes(key) ? TAKRAW_CONFIG.athletes.base :
        Math.min(TAKRAW_CONFIG.athletes.max, ability + (ability > TAKRAW_CONFIG.athletes.base && key === ['defense', 'setting', 'power'][index] ? 6 : 0))]))),
  }))),
});
const venue = (court, courtInset, line, shirts, fog) => Object.freeze({ court, courtInset, line,
  shirts: Object.freeze(shirts), fog: Object.freeze({ color: fog, near: 32, far: 68 }) });
const school = (id, name, element, primary, secondary, stripe, sock, hairColor, shape, venueColors) => Object.freeze({
  id, name, element, uniform: Object.freeze({ primary, secondary, stripe, sock }),
  hair: Object.freeze({ color: hairColor, shape }), backnumber: Object.freeze([1, 2, 3]),
  venue: Object.freeze({ ...venueColors, banners: Object.freeze([name, `${name} ${TAKRAW_GAME_NAME}부`, '함께 뛰는 우리 학교']) }),
});

/** 학교 10곳(속성당 1곳). 이 순서가 상대 목록의 순서다. */
const TAKRAW_SCHOOLS = Object.freeze([
  school('sprout', '새싹고', 'grass', 0x39a58f, 0xe7f7dc, 0x214f49, 0xf6edcf, 0x37483f, 'round',
    venue(0x467b6f, 0x598c7d, 0xf6f0d9, [0x669c83, 0xe4d6aa, 0x809f8d], 0xe8eee3)),
  school('flame', '불꽃고', 'fire', 0xe27e62, 0xffe5b4, 0x725347, 0xffdfba, 0x544b3b, 'crest',
    venue(0xa65f50, 0xbd7865, 0xffe8bd, [0xe27e62, 0xffdfba, 0xa85e50], 0xf4e8dd)),
  school('wave', '파도고', 'water', 0x344f86, 0xd9efff, 0x1d2e54, 0xa9c9ed, 0x25313e, 'bob',
    venue(0x3b5e82, 0x557e9c, 0xe3f2fa, [0x344f86, 0xa9c9ed, 0x6a87a3], 0xe1eaf0)),
  school('bolt', '번개고', 'lightning', 0xf2c94c, 0x35464c, 0x5e5741, 0xffeab3, 0x483c30, 'crest',
    venue(0x97874c, 0xb1a367, 0xfff1be, [0xf2c94c, 0x5e5741, 0xffeab3], 0xeeeede)),
  school('moon', '달빛고', 'moon', 0x9270b6, 0xeee3ff, 0x4d3b67, 0xd4bee9, 0x34303f, 'bob',
    venue(0x75628f, 0x9680ac, 0xf2e8ff, [0x9270b6, 0xd4bee9, 0x6d5a85], 0xeae4ef)),
  school('sun', '햇살고', 'sun', 0xf0a030, 0xfff2c8, 0x7a5524, 0xffe9b8, 0x4a3a28, 'round',
    venue(0xc98f45, 0xdcab67, 0xfff4d0, [0xf0a030, 0xfff2c8, 0xb07a30], 0xf6ecd8)),
  school('frost', '서리고', 'ice', 0x7cc7e8, 0xeaf8ff, 0x2f5f7a, 0xd8f0fa, 0x2f3d4a, 'bob',
    venue(0x5f8fa6, 0x7aa5ba, 0xeaf8ff, [0x7cc7e8, 0xd8f0fa, 0x4f7f96], 0xe4eef3)),
  school('earth', '대지고', 'earth', 0xb0834f, 0xf0e0c0, 0x5a4030, 0xe8d5b0, 0x3a2e22, 'crest',
    venue(0x8c6b4a, 0xa3825f, 0xf2e3c4, [0xb0834f, 0xe8d5b0, 0x7a5a3a], 0xece2d2)),
  school('wind', '질풍고', 'wind', 0xb9cddd, 0xffffff, 0x56708a, 0xe8f0f6, 0x3c4650, 'bob',
    venue(0x6f8c9a, 0x8aa6b3, 0xf5fbff, [0xb9cddd, 0xffffff, 0x7d93a6], 0xe6eef3)),
  school('shade', '그림자고', 'dark', 0x5b4a82, 0xd9ccf2, 0x211a33, 0x8f7fb8, 0x1e1a28, 'crest',
    venue(0x3a3550, 0x4b4565, 0xd9ccf2, [0x5b4a82, 0x8f7fb8, 0x2d2640], 0xdcd8e6)),
]);

// 도전 단계의 난이도: 기준 5개(쉬움→어려움)를 단계 수에 맞춰 선형으로 채운다. 단계가 오를수록 반응·간격이 줄고 능력이 오른다.
const LADDER_ANCHORS = Object.freeze([
  { reaction: [.25, .55], clearance: [.55, .8], depth: 1.1, lateral: .8, ability: 50 },
  { reaction: [.15, .35], clearance: [.8, 1.1], depth: .7, lateral: .5, ability: 58 },
  { reaction: [.08, .22], clearance: [1, 1.4], depth: .35, lateral: .3, ability: 66 },
  { reaction: [.04, .12], clearance: [1, 1.4], depth: .15, lateral: .15, ability: 86 },
  { reaction: [.01, .05], clearance: [1, 1.3], depth: .04, lateral: .04, ability: 100 },
]);
const STABLE_FROM_ANCHOR = 3; // 이 기준부터는 이동·점프·공중 제어 능력을 기본값에 묶고 나머지로 강해진다.
const lerp = (a, b, f) => a + (b - a) * f;
const ladderRow = (stage, count) => {
  const position = (stage - 1) / (count - 1) * (LADDER_ANCHORS.length - 1), index = Math.min(LADDER_ANCHORS.length - 2, Math.floor(position)), f = position - index;
  const [a, b] = [LADDER_ANCHORS[index], LADDER_ANCHORS[index + 1]], round = value => Math.round(value * 1000) / 1000;
  return Object.freeze({ stage,
    ai: ai([0, 1].map(i => round(lerp(a.reaction[i], b.reaction[i], f))), [0, 1].map(i => round(lerp(a.clearance[i], b.clearance[i], f))),
      round(lerp(a.depth, b.depth, f)), round(lerp(a.lateral, b.lateral, f)), Math.round(lerp(a.ability, b.ability, f)), position >= STABLE_FROM_ANCHOR),
    firstClearTrainingPoints: Math.round(3 + 5 * (stage - 1) / (count - 1)) }); // 출시 전 임시 보상. 지급 여부는 campaign.cleared만 사용한다.
};
/** 도전 단계(1부터): 내 학교를 뺀 상대 수만큼. */
const TAKRAW_LADDER = Object.freeze(Array.from({ length: TAKRAW_SCHOOLS.length - 1 }, (_, i) => ladderRow(i + 1, TAKRAW_SCHOOLS.length - 1)));

const takrawSchool = id => TAKRAW_SCHOOLS.find(value => value.id === id) || null;
/** 내 학교가 정해지는 규칙의 단일 정의: 0 이상 1 미만의 수 하나로 학교 하나를 고른다. */
const takrawPickHome = unit => TAKRAW_SCHOOLS[Math.min(TAKRAW_SCHOOLS.length - 1, Math.floor(unit * TAKRAW_SCHOOLS.length))].id;
/** 내 학교를 뺀 상대 목록. 로스터 순서대로 도전 단계 1, 2, …가 붙는다. 학교 데이터에 단계의 AI·보상을 합친 값이다. */
const takrawOpponents = homeId => TAKRAW_SCHOOLS.filter(value => value.id !== homeId).map((value, index) => Object.freeze({ ...value, ...TAKRAW_LADDER[index] }));

/** 관전 경기의 두 학교. 시드만으로 정해져 같은 시드는 같은 화면이다. 두 학교는 항상 다르다. */
function takrawWatchSchools(seed) {
  const count = TAKRAW_SCHOOLS.length, home = seed % count, step = 1 + Math.floor(seed / count) % (count - 1);
  return [TAKRAW_SCHOOLS[home], TAKRAW_SCHOOLS[(home + step) % count]];
}

export { TAKRAW_ELEMENTS, TAKRAW_SCHOOLS, TAKRAW_LADDER, takrawSchool, takrawPickHome, takrawOpponents, takrawWatchSchools };
