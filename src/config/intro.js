import { TAKRAW_PRODUCT_NAME } from './game.js';
import { TAKRAW_RUNTIME } from './runtime.js';

/**
 * 소개영상 = 관전 모드의 시드 한 경기 + 조작 자막. 자막은 경기 틱에 맞춰 바뀐다.
 * tick은 시드 36 랠리의 실제 사건 틱이다(서브 75, 리시브 163, 토스 326, 스파이크 393, 받아내기 436, 득점 772).
 * 시드를 바꾸면 tick 표를 다시 맞춰야 한다. tests/watch.spec.js가 이 사건 틱을 고정한다.
 * 조작 이름은 마우스 기준이며, 터치 화면에서는 intro.js가 터치 이름으로 바꾼다.
 */
const TAKRAW_INTRO = Object.freeze({
  title: TAKRAW_PRODUCT_NAME,
  seed: TAKRAW_RUNTIME.watch.showcaseSeed,
  tickRate: 60,
  durationMs: 22000,
  chapters: Object.freeze([
    { tick: 0, title: '발끝에서 시작되는 랠리', caption: 'AI 두 팀이 실제 규칙으로 겨룬 경기예요. 내 선수는 언제나 공격수예요.' },
    { tick: 80, title: '서브', caption: '서브는 상대 코트로 보내요. 우리 팀 서브에서는 좌클로 공을 던져 올려요.' },
    { tick: 250, title: '리시브 → 토스 → 스파이크', caption: '리시버가 받아 올리고, 세터가 토스하고, 공격수가 마무리해요.' },
    { tick: 335, title: '점프 · Space', caption: '타점에 맞춰 길게 누를수록 높게 뛰어요.' },
    { tick: 380, title: '발차기 · 좌클', caption: '누르는 동안 발에 힘을 줘요. 공중에서 누르면 내려찍는 스파이크가 돼요.' },
    { tick: 420, title: '아슬아슬한 받아내기', caption: '스파이크를 0.05초 여유로 받아냈어요. 공은 지면에서 0.39m 위였어요.' },
    { tick: 510, title: '이동 · W A S D', caption: '공이 떨어질 빈 공간으로 먼저 달려가 받아내요.' },
    { tick: 650, title: '받아내고, 다시 때리고', caption: '스파이크를 받아내는 랠리가 두 번 더 이어졌어요.' },
    { tick: 772, title: '득점', caption: '한 랠리가 끝나면 점수가 올라가요. 코랄 팀이 가져갔어요.' },
    { tick: 850, title: '기본 조작', caption: 'W A S D 이동 · Space 점프 · 좌클 발차기 · 우클 드래그 시점' },
  ]),
  // 터치 화면에서 바꿀 말. 자막과 제목 모두 같은 표로 바꾼다.
  touchWords: Object.freeze([['W A S D', '왼쪽 패드'], ['Space', '점프 버튼'], ['좌클', '발차기 버튼'], ['우클 드래그 시점', '카메라 자동 추적']]),
});

export { TAKRAW_INTRO };
