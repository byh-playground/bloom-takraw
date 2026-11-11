/**
 * 이 페이지를 어떤 맥락으로 열었는지(주소·iframe)의 단일 출처. 페이지를 읽을 때 한 번 정한다.
 *   showcaseDemo: 소개영상 화면(?showcaseDemo=1), debug: 확인용 주소(?debug)
 *   isolated: 위 둘 중 하나. 저장(팀·소리 설정·방 복귀·언어 선택)과 지표를 읽지도 쓰지도 않고 메모리에만 둔다.
 *   embedded: 다른 페이지의 iframe 안(itch.io 임베드 등). 저장은 격리하지 않고 설치(PWA)만 등록하지 않는다.
 */
const query = new URLSearchParams(location.search);
const showcaseDemo = query.get('showcaseDemo') === '1';
const debug = query.has('debug');

const TAKRAW_LAUNCH = Object.freeze({
    showcaseDemo,
    debug,
    isolated: showcaseDemo || debug,
    embedded: window.self !== window.top,
});

export { TAKRAW_LAUNCH };
