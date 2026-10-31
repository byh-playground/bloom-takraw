import { TAKRAW_PRODUCT_NAME, TAKRAW_CONFIG } from './game.js';
import { TAKRAW_RUNTIME } from './runtime.js';
import { TAKRAW_LADDER } from './schools.js';

/**
 * 소개영상 = 관전 모드의 시드 한 경기 + 장마다 한 줄 문구. 설명은 화면이 하고 글은 한 줄만 쓴다.
 * 조작은 글로 쓰지 않는다. 영상 속 공격수가 누르는 동안 기기의 조작 표시(PC 표시등·모바일 터치 버튼)가 눌린다.
 * tick 장은 시드 36 랠리의 실제 사건 틱에 맞춰 바뀐다(서브 75, 리시브 163, 토스 326, 스파이크 393, 받아내기 436, 득점 772).
 * 시드를 바꾸면 tick 표를 다시 맞춰야 한다. tests/watch.spec.js가 이 사건 틱을 고정한다.
 * 관전은 득점 뒤 loopHoldMs가 지나면 같은 랠리를 처음부터 다시 연다. 시스템 소개 장은 틱 대신 득점 장이 뜬 뒤 afterMs가 지나면 바뀐다.
 * (느린 기기에서 득점이 늦게 와도 득점 장을 덮지 않는다.)
 */
const TAKRAW_INTRO = Object.freeze({
  title: TAKRAW_PRODUCT_NAME,
  seed: TAKRAW_RUNTIME.watch.showcaseSeed,
  tickRate: 60,
  durationMs: 24000,
  chapters: Object.freeze([
    { id: 'opening', tick: 0, title: '3대3 발 배구' },
    { id: 'serve', tick: 80, title: '서브' },
    { id: 'rally', tick: 250, title: '받고, 올리고, 때리고' },
    { id: 'jump', tick: 335, title: '길게 누르면 높이 점프' },
    { id: 'kick', tick: 380, title: '공중에서 차면 스파이크' },
    { id: 'dig', tick: 420, title: '아슬아슬, 막아 냈다!' },
    { id: 'move', tick: 510, title: '떨어질 자리로 먼저' },
    { id: 'again', tick: 650, title: '랠리는 계속된다' },
    { id: 'point', tick: 772, title: `득점! ${TAKRAW_CONFIG.rules.points}점 먼저 내면 승리` },
    { id: 'recruit', afterMs: 2200, title: '선수를 뽑아 팀을 꾸리고' },
    { id: 'train', afterMs: 5200, title: '편성하고 훈련해 키우고' },
    { id: 'campaign', afterMs: 8200, title: `학교 ${TAKRAW_LADDER.length}곳을 차례로 꺾자` },
  ]),
});

export { TAKRAW_INTRO };
