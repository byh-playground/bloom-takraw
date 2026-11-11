import { LOCALE } from '../locale.js';
import { TAKRAW_CLUB_RULES } from '../../club/club.js';
import { TAKRAW_TRAINING_LESSONS } from '../../simulation/game.js';

/**
 * 시뮬레이션이 내는 message(id, values)의 문장(docs/i18n.md). 값의 own은 보는 팀 기준이고, team(0|1)은 화면이 own으로 바꿔 넘긴다.
 * 조작 이름은 PC 기준(좌클·left click)이다. 터치 화면은 touchControlText가 바꾼다.
 */

/** 역할 id → 이름. 모르는 선수(null)는 동료다. */
const roleName = (role, locale) =>
    TAKRAW_CLUB_RULES.roles.find((value) => value.id === role)?.name[locale] ??
    { ko: '동료', en: 'Teammate' }[locale];
const ko = (role) => roleName(role, 'ko');
const en = (role) => roleName(role, 'en');
const enLower = (role) => en(role).toLowerCase();
const lessonTitle = (id, locale) =>
    TAKRAW_TRAINING_LESSONS.find((lesson) => lesson.id === id)?.title[locale];

/** 득점 사유 코드(game.js awardPoint). */
const REASON = LOCALE.messages({
    underNet: { ko: '네트 아래 통과', en: 'Under the net' },
    out: { ko: '아웃', en: 'Out' },
    nextToss: { ko: '다음 토스를 준비합니다.', en: 'Getting the next set ready.' },
    serveLine: { ko: '서브 라인 반칙', en: 'Service line fault' },
    hand: { ko: '핸드 반칙', en: 'Hand ball' },
    fourthTouch: { ko: '네 번째 터치', en: 'Fourth touch' },
    grounded: { ko: '코트에 공이 닿았습니다.', en: 'The ball hit the court.' },
    netTouch: { ko: '네트 터치', en: 'Net touch' },
});
const reasonText = (reason) => REASON[reason]();

const teamKo = (own) => (own ? '우리 팀' : '상대 팀');
/** 지난 연습의 결과(game.js finishTraining의 code·values). */
const RESULT = {
    success: {
        title: {
            ko: ({ motionId, quick }) =>
                `${quick ? '속공 · ' : ''}${lessonTitle(motionId, 'ko') ?? '스파이크'} 성공!`,
            en: ({ motionId, quick }) =>
                `${quick ? 'Quick · ' : ''}${lessonTitle(motionId, 'en') ?? 'Spike'}: success!`,
        },
        detail: {
            ko: '발로 내려찍어 네트 위로 보냈어요. 같은 타이밍을 한 번 더 기억하세요.',
            en: 'You struck it down over the net. Remember that timing.',
        },
    },
    set: {
        title: { ko: '세터가 다시 올릴게요', en: 'The setter will try again' },
        detail: {
            ko: '이번 공은 연습할 높이로 연결되지 않았어요. 새 토스에서 다시 준비하세요.',
            en: 'That set didn’t reach practice height. Get ready for a new one.',
        },
    },
    motion: {
        title: {
            ko: ({ other }) => (other ? '다른 발차기로 맞았어요' : '공중 발차기를 이어 보세요'),
            en: ({ other }) =>
                other ? 'You hit it with a different kick' : 'Follow through with an air kick',
        },
        detail: {
            ko: ({ downward }) =>
                downward
                    ? '점프 전에 좌클을 유지해 발을 올리고, 누른 채 점프하세요.'
                    : '발자국에서 점프한 뒤 좌클을 유지하세요. 공중의 실제 발 타격으로 연습 결과를 확인해요.',
            en: ({ downward }) =>
                downward
                    ? 'Hold left click before jumping to raise your foot, and jump while holding it.'
                    : 'Jump from the footprints, then hold left click. The result is judged by a real foot strike in the air.',
        },
    },
    out: {
        title: {
            ko: ({ reason }) =>
                reason === 'out' ? '내려찍었지만 코트를 벗어났어요' : '내려찍기 동작까지 성공',
            en: ({ reason }) =>
                reason === 'out' ? 'Struck down, but it went out' : 'The downward strike worked',
        },
        detail: {
            ko: ({ reason }) =>
                `${reasonText(reason)} · 다음 공은 타점과 발차기 유지 시간을 조금 조절해 보세요.`,
            en: ({ reason }) =>
                `${reasonText(reason)} · Next time adjust the contact point and how long you hold the kick.`,
        },
    },
    net: {
        title: { ko: '내려찍기까지 성공', en: 'The downward strike worked' },
        detail: {
            ko: '발로 내려찍었지만 네트 위로 통과하지 못했어요. 실제 타격 높이와 공이 나간 각도를 확인하세요.',
            en: 'You struck it down, but it didn’t clear the net. Check your contact height and the ball’s angle.',
        },
    },
    angle: {
        title: { ko: '발에 맞았어요', en: 'It hit your foot' },
        detail: {
            ko: '발 접촉이 내려가는 공격으로 이어지지 않았어요. 다음 토스에서 몸의 이동을 줄이고 공 옆에 발을 돌릴 공간을 준비하세요.',
            en: 'The foot contact didn’t become a downward attack. Next set, move less and leave room beside the ball to swing.',
        },
    },
    body: {
        title: {
            ko: ({ shin }) => (shin ? '정강이에 맞았어요' : '몸에 먼저 닿았어요'),
            en: ({ shin }) => (shin ? 'It hit your shin' : 'It hit your body first'),
        },
        detail: {
            ko: '공 바로 아래보다 바닥 발자국에서 준비하세요. 공과 몸 사이에 발을 돌릴 공간이 필요해요.',
            en: 'Set up on the footprints, not right under the ball. You need room between the ball and your body to swing.',
        },
    },
    jump: {
        title: { ko: '이번 공에서는 점프하지 않았어요', en: 'You didn’t jump for that ball' },
        detail: {
            ko: '발자국으로 이동한 뒤 속도를 줄여 보세요. 점프 안내가 열리면 표시된 높이에 맞춰 짧게 누르거나 유지하세요.',
            en: 'Move to the footprints and slow down. When the jump cue opens, tap or hold to match the height shown.',
        },
    },
    kick: {
        title: { ko: '발차기도 함께 해 보세요', en: 'Add a kick too' },
        detail: {
            ko: ({ downward }) =>
                downward
                    ? '좌클을 먼저 누른 채 점프해야 올려 둔 발로 내려찍을 수 있어요.'
                    : '점프 후 “지금 발차기” 안내에 좌클을 눌러 유지하세요.',
            en: ({ downward }) =>
                downward
                    ? 'Hold left click before you jump so the raised foot can strike down.'
                    : 'After jumping, press and hold left click on the “Kick now!” cue.',
        },
    },
    miss: {
        title: {
            ko: ({ prehold }) =>
                prehold ? '점프 전에 발을 먼저 올려 보세요' : '공과 발이 만나지 않았어요',
            en: ({ prehold }) =>
                prehold ? 'Raise your foot before you jump' : 'Your foot missed the ball',
        },
        detail: {
            ko: ({ prehold }) =>
                prehold
                    ? '이번에는 점프와 같거나 뒤에 좌클을 눌렀어요. 다음 공은 이동 중 선행 좌클 안내부터 따라 보세요.'
                    : '타점 표시는 준비를 돕는 예측이에요. 다음 토스에서 이동 속도를 줄이고 공 옆의 준비 위치를 맞춰 보세요.',
            en: ({ prehold }) =>
                prehold
                    ? 'You pressed left click with or after the jump. Next ball, follow the early left-click cue while moving.'
                    : 'The contact marker is a prediction to help you prepare. Next set, move more slowly and match the ready spot beside the ball.',
        },
    },
};
const RESULT_TITLE = LOCALE.messages(
    Object.fromEntries(Object.entries(RESULT).map(([code, value]) => [code, value.title])),
);
const RESULT_DETAIL = LOCALE.messages(
    Object.fromEntries(Object.entries(RESULT).map(([code, value]) => [code, value.detail])),
);

/** 점프 버튼 안내(연습 cue 앞에 붙는다). */
const JUMP = {
    tap: { ko: '점프 버튼은 짧게 누르고 떼세요.', en: 'Tap the jump button.' },
    hold: { ko: '점프 버튼도 잠깐 유지하세요.', en: 'Hold the jump button briefly too.' },
    release: { ko: '점프 버튼은 놓아도 돼요.', en: 'You can let go of jump.' },
};
const ADJUSTMENT = {
    hit: { ko: ' · 타격 확인', en: ' · Hit confirmed' },
    reach: { ko: ' · 높이·거리를 맞춰 보세요', en: ' · Match height and distance' },
    adapt: { ko: ' · 다리 조절 중', en: ' · Adjusting the legs' },
};

const MATCH = LOCALE.messages({
    // 경기 상태 줄(state.lastMessage)
    trainingStart: {
        ko: '공의 옆에 서서 점프와 발차기를 맞춰 보세요.',
        en: 'Stand beside the ball and time your jump and kick.',
    },
    firstServe: { ko: '첫 서브를 준비합니다.', en: 'Getting ready for the first serve.' },
    waitingOpponent: {
        ko: '상대가 입장하면 경기가 시작됩니다.',
        en: 'The match starts when your opponent joins.',
    },
    nextBall: { ko: '다음 공을 준비합니다.', en: 'Getting the next ball ready.' },
    serve: {
        ko: ({ own }) => `${teamKo(own)} 서브`,
        en: ({ own }) => (own ? 'Your serve' : 'Opponent’s serve'),
    },
    quickToss: {
        ko: '낮고 빠른 토스가 옵니다. 점프를 짧게 누르고 바로 차세요.',
        en: 'A low, fast set is coming. Tap jump and kick right away.',
    },
    highToss: {
        ko: '세터가 높게 올립니다. 바닥 발자국에서 준비하세요.',
        en: 'The setter is lifting it high. Get ready on the footprints.',
    },
    serveTossHuman: {
        ko: '서브 · 공 던지기를 짧게 누르면 낮게, 꾹 누르면 높게 위로 올라갑니다. 달리면서 던지면 공이 달리는 방향으로 날아갑니다. 던지기 전에 엔드라인 안쪽을 밟으면 반칙입니다.',
        en: 'Serve · Tap the toss for a low throw, hold it for a high one. Throw while running and the ball carries that way. Stepping inside the end line before the toss is a fault.',
    },
    serveCheck: { ko: '서브 · 공의 위치를 확인하세요.', en: 'Serve · Watch where the ball is.' },
    serveRising: {
        ko: '서브 · 공이 올라갑니다. 점프와 발차기로 차세요.',
        en: 'Serve · The ball is up. Jump and kick it.',
    },
    spike: { ko: '스파이크!', en: 'Spike!' },
    setToTeammate: { ko: '아군에게 받아 올리세요.', en: 'Set it up for a teammate.' },
    sendOver: { ko: '상대 코트로 넘기세요.', en: 'Send it over the net.' },
    tossToAttacker: {
        ko: '공격수에게 토스 · 점프 타이밍을 맞추세요.',
        en: 'Set to the attacker · time your jump.',
    },
    receiveToTeammate: {
        ko: '아군에게 리시브 · 다음 토스를 준비하세요.',
        en: 'Received to a teammate · get ready for the next set.',
    },
    trainingPoint: {
        ko: ({ reason }) => `${reasonText(reason)} · 다시 도전해 보세요.`,
        en: ({ reason }) => `${reasonText(reason)} · Try again.`,
    },
    point: {
        ko: ({ own, reason }) => `${teamKo(own)} 득점 · ${reasonText(reason)}`,
        en: ({ own, reason }) =>
            `${own ? 'Your point' : 'Opponent’s point'} · ${reasonText(reason)}`,
    },
    matchWin: {
        ko: ({ own }) => `${teamKo(own)} 승리!`,
        en: ({ own }) => (own ? 'You win!' : 'The opponent wins!'),
    },
    setWin: {
        ko: ({ own }) => `${teamKo(own)} 세트 획득 · 다음 세트를 준비합니다.`,
        en: ({ own }) => `${own ? 'You take' : 'The opponent takes'} the set · next set coming up.`,
    },

    // 팀 플레이 안내(getTeamPlay의 title·detail)
    playWin: {
        ko: ({ own }) => `${teamKo(own)} 승리`,
        en: ({ own }) => (own ? 'You win' : 'Opponent wins'),
    },
    playPoint: {
        ko: ({ own }) => `${teamKo(own)} 득점`,
        en: ({ own }) => (own ? 'Your point' : 'Opponent’s point'),
    },
    playOverpassPoint: {
        ko: ({ own, reason }) =>
            `${own ? '우리' : '상대'} 토스가 길어 네트를 넘었어요 · ${reasonText(reason)}`,
        en: ({ own, reason }) =>
            `${own ? 'Your' : 'Their'} set went long over the net · ${reasonText(reason)}`,
    },
    pointReason: { ko: ({ reason }) => reasonText(reason), en: ({ reason }) => reasonText(reason) },
    playServeReady: {
        ko: ({ own }) => `${teamKo(own)} 서브 준비`,
        en: ({ own }) => (own ? 'Your serve is next' : 'Opponent to serve'),
    },
    playServeReadyDetail: {
        ko: '서브는 상대 코트로 · 리시브 뒤에는 동료에게 연결해요.',
        en: 'Serve into their court · after a receive, pass to a teammate.',
    },
    playReceive: {
        ko: ({ human, role, motion }) =>
            `${human ? '내' : ko(role)} ${{ slide: '슬라이딩 리시브', lunge: '옆으로 뻗어 받는 중', cushion: '발로 받아 올리는 중', ready: '리시브 준비' }[motion]}`,
        en: ({ human, role, motion }) =>
            `${human ? 'You' : en(role)} · ${{ slide: 'sliding receive', lunge: 'stretching for it', cushion: 'receiving with the foot', ready: 'ready to receive' }[motion]}`,
    },
    playReceiveHuman: {
        ko: '좌클을 유지해 받으세요. 동료는 다음 공을 커버해요.',
        en: 'Hold left click to receive. Your teammates cover the next ball.',
    },
    playReceiveReachable: {
        ko: '빈 공간으로 이동해 좌클을 누르면 직접 받아낼 수 있어요.',
        en: 'Move into the open space and left click to receive it yourself.',
    },
    playReceiveFar: {
        ko: '먼 공을 따라가는 중이에요. 가까운 빈 공간을 직접 커버해 보세요.',
        en: 'Chasing a far ball. Try covering the nearby open space yourself.',
    },
    playSpike: {
        ko: ({ own, third }) => `${teamKo(own)} ${third ? '세 번째 터치 · ' : ''}스파이크`,
        en: ({ own, third }) =>
            `${own ? 'Your' : 'Opponent’s'} ${third ? 'third-touch ' : ''}spike`,
    },
    playSpikeCrossed: {
        ko: '실제 발 타격으로 네트를 넘겼어요. 다음 공을 준비하세요.',
        en: 'A real foot strike sent it over the net. Get ready for the next ball.',
    },
    playSpikeAir: {
        ko: '공중에서 발로 타격했어요. 공이 넘어가는 궤적을 확인하세요.',
        en: 'Struck with the foot in the air. Watch the ball’s path over the net.',
    },
    playOverpassOwn: {
        ko: '토스가 길어 상대 코트로 넘어갔어요',
        en: 'The set went long into their court',
    },
    playOverpassTheirs: {
        ko: '상대 토스가 우리 코트로 넘어왔어요',
        en: 'Their set came over into our court',
    },
    playOverpassOwnDetail: {
        ko: ({ from, to }) => `${ko(from)}가 ${ko(to)}에게 올리던 공이에요. 다음 공을 수비하세요.`,
        en: ({ from, to }) =>
            `It was a set from the ${enLower(from)} to the ${enLower(to)}. Defend the next ball.`,
    },
    playOverpassTheirsDetail: {
        ko: '반환을 선택한 공이 아니라 빗나간 토스예요. 받을 자리를 잡으세요.',
        en: 'That was a stray set, not a chosen return. Get into position to receive.',
    },
    playMishit: {
        ko: ({ own }) => `${own ? '우리' : '상대'} 토스가 빗맞았어요`,
        en: ({ own }) => `${own ? 'Your' : 'Their'} set was mishit`,
    },
    playMishitDetail: {
        ko: ({ from, to }) =>
            `${ko(from)}가 ${ko(to)}에게 연결하려던 공이에요. 공의 위치를 확인하세요.`,
        en: ({ from, to }) =>
            `The ${enLower(from)} meant to set the ${enLower(to)}. Watch where the ball is.`,
    },
    playFourthTouch: {
        ko: '같은 팀이 추가로 닿으면 네 번째 터치 반칙이에요.',
        en: 'One more touch by the same team is a fourth-touch fault.',
    },
    playLastTouchLeft: {
        ko: '남은 터치 1회 · 다음 타격은 상대 코트로 보내야 해요.',
        en: 'One touch left · the next hit must go over.',
    },
    playRecoveringAttacker: {
        ko: '공격수가 일어날 수 있도록 높은 토스를 준비해요. 회복 뒤 공격할 자리로 이동하세요.',
        en: 'A high set gives the attacker time to get up. Move to your attack spot once you recover.',
    },
    playCoverRecovering: {
        ko: '받을 선수가 자세를 회복 중이라 다른 동료에게 연결해요.',
        en: 'The intended receiver is recovering, so it goes to another teammate.',
    },
    playCoverFar: {
        ko: '받을 선수가 멀어 가까운 동료에게 연결해요.',
        en: 'The intended receiver is too far, so it goes to a closer teammate.',
    },
    playMoveToFootprint: {
        ko: '바닥 발자국으로 이동해 점프 타이밍을 맞추세요.',
        en: 'Move to the footprints and time your jump.',
    },
    playBuildAttack: {
        ko: '리시브 → 세터 → 공격수 순서로 공격을 준비해요.',
        en: 'Building the attack: receiver → setter → attacker.',
    },
    playPass: {
        ko: ({ from, to, pending }) =>
            `${ko(from)} → ${ko(to)} ${pending ? '받아 올리는 중' : '토스'}`,
        en: ({ from, to, pending }) => `${en(from)} → ${en(to)} ${pending ? 'receiving' : 'set'}`,
    },
    playServe: {
        ko: ({ own }) => `${teamKo(own)} 서브`,
        en: ({ own }) => (own ? 'Your serve' : 'Opponent’s serve'),
    },
    playServeDetail: {
        ko: '서브 첫 타격은 상대 코트로 보내요.',
        en: 'The first hit of the serve goes into their court.',
    },
    playContactsDone: {
        ko: ({ own, contacts }) => `${teamKo(own)} ${contacts}회 타격 완료`,
        en: ({ own, contacts }) =>
            `${own ? 'You have' : 'The opponent has'} used all ${contacts} touches`,
    },
    playLastTouch: {
        ko: ({ own }) => (own ? '마지막 터치 · 상대 코트로' : '상대 마지막 터치 · 우리 코트로'),
        en: ({ own }) => (own ? 'Last touch · send it over' : 'Their last touch · coming to us'),
    },
    playLastTouchDetail: {
        ko: ({ own, used }) =>
            `${own ? '우리 팀이' : '상대 팀이'} 이미 ${used}회 접촉했어요. 다음 타격은 네트를 넘어야 해요.`,
        en: ({ own, used }) =>
            `${own ? 'Your team has' : 'They have'} already touched it ${used} times. The next hit must cross the net.`,
    },
    playAttackReady: {
        ko: ({ own }) => (own ? '공격수 · 스파이크 준비' : '상대 공격수 · 스파이크 준비'),
        en: ({ own }) => (own ? 'Attacker · spike ready' : 'Their attacker · spike ready'),
    },
    playAttackReadyDetail: {
        ko: '공과의 거리·점프 높이·발차기 타이밍을 맞추세요.',
        en: 'Match your distance to the ball, jump height and kick timing.',
    },
    playDefendSpike: { ko: '상대가 내려칠 공을 수비하세요.', en: 'Defend against their spike.' },
    playWatchSetter: {
        ko: ({ role }) => `${ko(role)}가 올릴 공을 보고 공격할 자리를 잡으세요.`,
        en: ({ role }) => `Watch the ${enLower(role)}’s set and get into attack position.`,
    },
    playLinkTouches: {
        ko: '남은 터치로 리시브와 토스를 연결해요.',
        en: 'Use the remaining touches to link receive and set.',
    },
    playTossReady: {
        ko: ({ own, from, to }) => `${own ? '' : '상대 '}${ko(from)} → ${ko(to)} 토스 준비`,
        en: ({ own, from, to }) => `${own ? '' : 'Their '}${en(from)} → ${en(to)} · set coming`,
    },
    playAttackBuild: { ko: '우리 팀 공격 준비', en: 'Building your attack' },
    playReceiving: { ko: '상대 공을 받는 중', en: 'Receiving their ball' },
    playDefaultDetail: {
        ko: ({ contacts }) => `리시브 → 세터 → 공격수 · 팀당 최대 ${contacts}회 접촉이에요.`,
        en: ({ contacts }) => `Receiver → setter → attacker · up to ${contacts} touches per team.`,
    },

    // 연습 안내(getTraining의 cue·detail·motionStatus)
    motionStatus: {
        ko: ({ motionId, adjustment }) =>
            `${lessonTitle(motionId, 'ko')}${adjustment ? ADJUSTMENT[adjustment].ko : ''}`,
        en: ({ motionId, adjustment }) =>
            `${lessonTitle(motionId, 'en')}${adjustment ? ADJUSTMENT[adjustment].en : ''}`,
    },
    motionAuto: {
        ko: '공과 몸의 위치에 맞춰 동작을 골라요',
        en: 'The move is picked from the ball and your position',
    },
    motionLesson: {
        ko: ({ lesson }) => `${lessonTitle(lesson, 'ko')} 동작을 연습해요`,
        en: ({ lesson }) => `Practicing: ${lessonTitle(lesson, 'en')}`,
    },
    lessonSequence: {
        ko: ({ lesson }) => TAKRAW_TRAINING_LESSONS.find((item) => item.id === lesson).sequence.ko,
        en: ({ lesson }) => TAKRAW_TRAINING_LESSONS.find((item) => item.id === lesson).sequence.en,
    },
    resultTitle: {
        ko: ({ code, ...values }) => RESULT_TITLE[code](values),
        en: ({ code, ...values }) => RESULT_TITLE[code](values),
    },
    resultDetail: {
        ko: ({ code, ...values }) => RESULT_DETAIL[code](values),
        en: ({ code, ...values }) => RESULT_DETAIL[code](values),
    },
    none: { ko: '', en: '' },
    cueRetry: { ko: '다시 도전해 보세요', en: 'Try again' },
    cueWaitSet: { ko: '세터의 토스를 기다리세요', en: 'Wait for the setter’s set' },
    detailWaitSet: {
        ko: '바닥 발자국과 타점은 예상 위치예요. 공이 올라오면 이동해 준비하세요.',
        en: 'The footprints and contact point are predictions. Move into place once the ball goes up.',
    },
    cueNextToss: { ko: '다음 토스를 준비합니다', en: 'Getting the next set ready' },
    cueStruckDown: { ko: '내려찍었어요!', en: 'Struck down!' },
    cueFoot: { ko: '발에 닿았어요', en: 'It hit your foot' },
    cueShin: { ko: '정강이에 맞았어요', en: 'It hit your shin' },
    cueBody: { ko: '몸에 먼저 닿았어요', en: 'It hit your body first' },
    detailWatchNet: {
        ko: '공이 네트를 넘는지 확인하세요.',
        en: 'See whether the ball clears the net.',
    },
    detailRetryTiming: {
        ko: '다음 토스에서 위치와 타이밍을 다시 맞춰 보세요.',
        en: 'Adjust your position and timing on the next set.',
    },
    cueLanding: { ko: '발차기 뒤 착지를 준비하세요', en: 'Get ready to land after the kick' },
    cueStriking: {
        ko: '좌클 유지 · 공을 향해 차고 있어요',
        en: 'Hold left click · kicking toward the ball',
    },
    cueRaising: { ko: '좌클 유지 · 발을 올리고 있어요', en: 'Hold left click · raising your foot' },
    detailLanding: { ko: '공의 진행과 착지를 확인하세요.', en: 'Watch the ball and your landing.' },
    detailKeepKick: {
        ko: ({ jump }) => `${JUMP[jump].ko} 좌클을 유지해 발차기를 이어가세요.`,
        en: ({ jump }) => `${JUMP[jump].en} Hold left click to follow through.`,
    },
    cueRise: { ko: '조금 더 떠오르세요', en: 'Rise a little more' },
    cueHoldKick: { ko: '좌클을 유지하세요', en: 'Keep holding left click' },
    cueKickNow: { ko: '지금 발차기!', en: 'Kick now!' },
    detailWaitKick: {
        ko: ({ jump }) => `${JUMP[jump].ko} 발차기 안내를 기다리세요.`,
        en: ({ jump }) => `${JUMP[jump].en} Wait for the kick cue.`,
    },
    detailPressKick: {
        ko: ({ jump }) => `${JUMP[jump].ko} 좌클을 눌러 유지하면 실제 발이 공을 향해 움직여요.`,
        en: ({ jump }) =>
            `${JUMP[jump].en} Press and hold left click and your foot swings at the ball.`,
    },
    cueBesideBall: { ko: '공의 옆에서 준비하세요', en: 'Get ready beside the ball' },
    detailGuideSoon: {
        ko: '공이 올라오면 바닥 발자국과 점프 안내가 나타납니다.',
        en: 'Footprints and the jump cue appear once the ball goes up.',
    },
    cueKeepRaised: {
        ko: '좌클 유지 · 발을 올려 두세요',
        en: 'Hold left click · keep your foot raised',
    },
    cuePressFirst: { ko: '좌클을 먼저 누르세요', en: 'Press left click first' },
    detailPrehold: {
        ko: '발자국으로 이동하는 동안 먼저 좌클을 누르세요. 발을 올린 채 속도를 줄이고 점프를 준비해요.',
        en: 'Press left click while moving to the footprints. Keep the foot up, slow down and get ready to jump.',
    },
    cueMoveToFootprint: {
        ko: ({ holding }) =>
            holding ? '좌클 유지 · 발자국으로 이동하세요' : '발자국으로 이동하세요',
        en: ({ holding }) =>
            holding ? 'Hold left click · move to the footprints' : 'Move to the footprints',
    },
    detailPrediction: {
        ko: '표시는 공이 올 위치의 예측이에요. 공 옆에서 발을 돌릴 공간을 준비하세요.',
        en: 'The markers predict where the ball will arrive. Leave room beside the ball to swing your foot.',
    },
    cueBrake: {
        ko: ({ holding }) =>
            holding ? '좌클 유지 · 이동 속도를 줄이세요' : '이동키를 놓고 속도를 줄이세요',
        en: ({ holding }) =>
            holding ? 'Hold left click · slow down' : 'Let go of the move keys and slow down',
    },
    detailBrake: {
        ko: '몸이 아직 타점을 지나갈 속도로 움직이고 있어요. 발자국 안에서 이동을 멈춘 뒤 점프 안내를 확인하세요.',
        en: 'You are still moving fast enough to run past the contact point. Stop inside the footprints, then watch for the jump cue.',
    },
    cueJumpNow: { ko: '지금 점프!', en: 'Jump now!' },
    detailJumpNow: {
        ko: ({ downward, short }) =>
            downward
                ? short
                    ? '좌클을 유지한 채 점프 버튼을 짧게 누르고 떼세요.'
                    : '좌클을 유지한 채 점프 버튼도 잠깐 유지하세요.'
                : short
                  ? '낮은 공이에요. 점프 버튼을 짧게 누르고 뗀 뒤 발차기 안내를 보세요.'
                  : '점프 버튼을 잠깐 유지한 뒤 발차기 안내를 보세요.',
        en: ({ downward, short }) =>
            downward
                ? short
                    ? 'Keep holding left click and tap jump.'
                    : 'Keep holding left click and hold jump briefly too.'
                : short
                  ? 'A low ball. Tap jump, then watch for the kick cue.'
                  : 'Hold jump briefly, then watch for the kick cue.',
    },
    cueWaitJump: { ko: '좌클 유지 · 점프를 기다리세요', en: 'Hold left click · wait to jump' },
    detailWaitJump: {
        ko: '올려 둔 발을 유지하며 점프 안내를 확인하세요.',
        en: 'Keep the foot raised and watch for the jump cue.',
    },
    cueJumpTiming: { ko: '점프 타이밍을 기다리세요', en: 'Wait for the jump timing' },
    detailOrder: {
        ko: ({ downward }) =>
            downward ? '좌클 준비 → 점프 순서입니다.' : '점프 → 공중에서 좌클 순서입니다.',
        en: ({ downward }) =>
            downward ? 'Order: left click ready → jump.' : 'Order: jump → left click in the air.',
    },
});

/** message(id, values)를 이 언어의 문장으로. team(0|1)이 있으면 localTeam 기준의 own으로 바꾼다. */
function matchText(ref, localTeam = 0) {
    if (!ref) return '';
    const values =
        'team' in ref.values ? { ...ref.values, own: ref.values.team === localTeam } : ref.values;
    return MATCH[ref.id](values);
}

/** 터치 화면의 조작 이름. 문구 원본은 PC 기준이다. */
const TOUCH_CONTROLS = {
    ko: [[/좌클/g, '발차기 버튼']],
    en: [
        [/\bLeft click\b/g, 'Kick button'],
        [/\bleft click\b/g, 'the kick button'],
        [/\bleft-click\b/g, 'kick-button'],
    ],
};
const touchControlText = (value) =>
    TOUCH_CONTROLS[LOCALE.locale].reduce(
        (text, [pattern, replacement]) => text.replace(pattern, replacement),
        value,
    );

export { matchText, roleName, touchControlText };
