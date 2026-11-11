import { createLocale } from '@bloom-gamekit/i18n';

// 페이지 언어와 모든 화면 문구(docs/i18n.md). 언어는 페이지를 읽을 때 한 번 정하고, 바꾸면 저장한 뒤 새로고침한다.
//   순서: ?lang= → 저장한 선택 → 브라우저 언어 첫 일치 → 'en'
// 격리 장면(확인용 주소 ?debug, 소개영상 화면 ?showcaseDemo=1)은 저장한 선택을 읽지도 쓰지도 않는다(runtime.js의 저장 격리와 같은 조건).
const query = new URLSearchParams(location.search);
const LOCALE = createLocale({
    locales: ['ko', 'en'],
    fallback: 'en',
    storageKey: 'bloom-takraw-locale',
    isolated: query.get('showcaseDemo') === '1' || query.has('debug'),
});
/** 언어마다 그 언어로 쓴 이름. 어느 언어 화면에서도 그대로 보인다. */
const LOCALE_NAMES = Object.freeze({ ko: '한국어', en: 'English' });

export { LOCALE, LOCALE_NAMES };
