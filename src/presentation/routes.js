/**
 * 화면 주소(gamekit navigation의 `{ screen, item }`)의 허용 목록. 처음 화면(main)은 해시 없는 주소다.
 * - 대화상자 화면은 뒤에 붙은 항목을 무시하고, 항목을 쓰는 곳은 선수 상세(`#/club/<선수 id>`)뿐이다.
 * - `showcase`는 소개영상 호스트(gamekit scenario)가 소유하는 주소라 남기기만 하고 UI는 반응하지 않는다.
 * - 알 수 없는 화면(항목이 붙은 처음 화면 단계·경기·소개 포함)은 `play`로 읽는다.
 *   경기 중이면 `#/play`로, 아니면 처음 화면 주소로 교정된다(ui.js applyRoute).
 */
const DIALOGS = ['settings', 'pause', 'network', 'club', 'campaign'];
const SCREENS = ['main', 'start', 'multi', 'play', 'showcase'];

function takrawRoute(route) {
    const known = DIALOGS.includes(route.screen) || (SCREENS.includes(route.screen) && !route.item);
    const screen = known ? route.screen : 'play';
    return { screen, item: screen === 'club' ? route.item : null, query: '' };
}

export { takrawRoute };
