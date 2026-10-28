// 학교명·팔레트는 출시 전 임시안입니다. 학교 표현의 단일 원본입니다.
const school = (id, name, primary, secondary, stripe, sock, hairColor, shape) => Object.freeze({
  id, name, uniform: Object.freeze({ primary, secondary, stripe, sock }),
  hair: Object.freeze({ color: hairColor, shape }), backnumber: Object.freeze([1, 2, 3]),
});
const TAKRAW_SCHOOLS = Object.freeze([
  school('sprout', '새싹고', 0x39a58f, 0xe7f7dc, 0x214f49, 0xf6edcf, 0x37483f, 'round'),
  school('flame', '불꽃고', 0xe27e62, 0xffe5b4, 0x725347, 0xffdfba, 0x544b3b, 'crest'),
  school('wave', '파도고', 0x344f86, 0xd9efff, 0x1d2e54, 0xa9c9ed, 0x25313e, 'bob'),
  school('bolt', '번개고', 0xf2c94c, 0x35464c, 0x5e5741, 0xffeab3, 0x483c30, 'crest'),
  school('moon', '달빛고', 0x9270b6, 0xeee3ff, 0x4d3b67, 0xd4bee9, 0x34303f, 'bob'),
]);
export { TAKRAW_SCHOOLS };
