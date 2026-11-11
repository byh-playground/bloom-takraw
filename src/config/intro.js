import { TAKRAW_PRODUCT_NAME, TAKRAW_CONFIG } from './game.js';
import { TAKRAW_RUNTIME } from './runtime.js';

/**
 * 소개영상 = 관전 모드의 시드 한 경기 + 장마다 한 줄 문구. 설명은 화면이 하고 글은 한 줄만 쓴다.
 * 조작은 글로 쓰지 않는다. 영상 속 공격수가 누르는 동안 기기의 조작 표시(PC 표시등·모바일 터치 버튼)가 눌린다.
 * tick 장은 시드 1252 랠리의 실제 사건 틱에 맞춰 바뀐다(서브 75, 서브 차기 177, 리시브 272, 토스 336, 스파이크 404, 받아내기 445,
 * 두 번째 스파이크 514, 마지막 받아내기 740, 득점 844). 장과 사건의 간격은 이전 시드 36의 표와 같다.
 * 시드를 바꾸면 tick 표를 다시 맞춰야 한다. 사건 틱은 `?debug=1&scene=watch&seed=1252&tick=N` 장면으로 확인한다.
 * 관전은 득점 뒤 loopHoldMs가 지나면 같은 랠리를 처음부터 다시 연다. 시스템 소개 장은 틱 대신 바로 앞 장이 뜬 뒤 afterMs가 지나면 바뀐다.
 * (느린 기기에서 득점이 늦게 와도 득점 장을 덮지 않는다.)
 * 장 제목은 TextPair이고 presentation/intro.js가 페이지 언어로 푼다.
 * show가 있는 장은 문구와 함께 게임 화면을 띄운다(draw: 실제 뽑기 연출, none: 닫기). 단계 수처럼 앞으로 볼 내용은 문구로 밝히지 않는다.
 */
const TAKRAW_INTRO = Object.freeze({
    title: TAKRAW_PRODUCT_NAME,
    seed: TAKRAW_RUNTIME.watch.showcaseSeed,
    tickRate: 60,
    durationMs: 30000,
    chapters: Object.freeze(
        [
            { id: 'opening', tick: 0, title: { ko: '3대3 발 배구', en: '3-on-3 Takraw' } },
            { id: 'serve', tick: 80, title: { ko: '서브', en: 'Serve' } },
            {
                id: 'rally',
                tick: 265,
                title: { ko: '받고, 올리고, 때리고', en: 'Receive, set, spike' },
            },
            {
                id: 'jump',
                tick: 345,
                title: { ko: '길게 누르면 높이 점프', en: 'Hold to jump higher' },
            },
            {
                id: 'kick',
                tick: 391,
                title: { ko: '공중에서 차면 스파이크', en: 'Kick in the air to spike' },
            },
            {
                id: 'dig',
                tick: 429,
                title: { ko: '아슬아슬, 막아 냈다!', en: 'Close call, saved!' },
            },
            {
                id: 'move',
                tick: 519,
                title: { ko: '떨어질 자리로 먼저', en: 'Get under the ball first' },
            },
            { id: 'again', tick: 731, title: { ko: '랠리는 계속된다', en: 'The rally goes on' } },
            {
                id: 'point',
                tick: 844,
                title: {
                    ko: `득점! ${TAKRAW_CONFIG.rules.points}점 먼저 내면 승리`,
                    en: `Point! First to ${TAKRAW_CONFIG.rules.points} wins`,
                },
            },
            {
                id: 'recruit',
                afterMs: 2200,
                title: { ko: '동료를 영입하자', en: 'Recruit teammates' },
                show: 'draw',
            },
            {
                id: 'train',
                afterMs: 5200,
                title: { ko: '편성하고 훈련해 키우자', en: 'Build a lineup and train' },
                show: 'none',
            },
            {
                id: 'campaign',
                afterMs: 3000,
                title: { ko: '이기면 다음 학교가 나타난다', en: 'Win to face the next school' },
            },
        ].map((chapter) => Object.freeze({ ...chapter, title: Object.freeze(chapter.title) })),
    ),
    // 영입 장에서 실제 뽑기 연출로 보여 줄 선수(프리셋 영웅). 결과는 저장하지 않는다.
    drawCard: 'tae-o',
});

export { TAKRAW_INTRO };
