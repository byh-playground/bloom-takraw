// 학교 이름·색상·AI 프리셋은 출시 전 임시값입니다. 학교 데이터의 단일 출처입니다.
import { TAKRAW_CONFIG } from './game.js';

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
const school = (id, name, primary, secondary, stripe, sock, hairColor, shape, venueColors, aiProfile, firstClearTrainingPoints) => Object.freeze({
  id, name, uniform: Object.freeze({ primary, secondary, stripe, sock }),
  hair: Object.freeze({ color: hairColor, shape }), backnumber: Object.freeze([1, 2, 3]),
  ai: aiProfile,
  firstClearTrainingPoints, // 출시 전 임시 보상. 지급 여부는 campaign.cleared만 사용한다.
  venue: Object.freeze({ ...venueColors, banners: Object.freeze([name, `${name} 세팍타크로부`, '함께 뛰는 우리 학교']) }),
});
const TAKRAW_SCHOOLS = Object.freeze([
  school('sprout', '새싹고', 0x39a58f, 0xe7f7dc, 0x214f49, 0xf6edcf, 0x37483f, 'round',
    venue(0x467b6f, 0x598c7d, 0xf6f0d9, [0x669c83, 0xe4d6aa, 0x809f8d], 0xe8eee3), ai([.25,.55], [.55,.8], 1.1, .8, 50), 3),
  school('flame', '불꽃고', 0xe27e62, 0xffe5b4, 0x725347, 0xffdfba, 0x544b3b, 'crest',
    venue(0xa65f50, 0xbd7865, 0xffe8bd, [0xe27e62, 0xffdfba, 0xa85e50], 0xf4e8dd), ai([.01,.05], [1,1.3], .04, .04, 100, true), 4),
  school('wave', '파도고', 0x344f86, 0xd9efff, 0x1d2e54, 0xa9c9ed, 0x25313e, 'bob',
    venue(0x3b5e82, 0x557e9c, 0xe3f2fa, [0x344f86, 0xa9c9ed, 0x6a87a3], 0xe1eaf0), ai([.15,.35], [.8,1.1], .7, .5, 58), 5),
  school('bolt', '번개고', 0xf2c94c, 0x35464c, 0x5e5741, 0xffeab3, 0x483c30, 'crest',
    venue(0x97874c, 0xb1a367, 0xfff1be, [0xf2c94c, 0x5e5741, 0xffeab3], 0xeeeede), ai([.04,.12], [1,1.4], .15, .15, 86, true), 6),
  school('moon', '달빛고', 0x9270b6, 0xeee3ff, 0x4d3b67, 0xd4bee9, 0x34303f, 'bob',
    venue(0x75628f, 0x9680ac, 0xf2e8ff, [0x9270b6, 0xd4bee9, 0x6d5a85], 0xeae4ef), ai([.08,.22], [1,1.4], .35, .3, 66), 8),
]);
export { TAKRAW_SCHOOLS };
