import { LOCALE } from '../locale.js';
import { TAKRAW_GAME_NAME, TAKRAW_PRODUCT_NAME } from '../../config/game.js';

/** 화면(presentation/ui.js)의 문구. 이름·학교·속성 같은 모델 데이터는 TextPair 그대로 두고 LOCALE.text로 푼다(docs/i18n.md). */
const seconds = (value) => (Math.ceil(value * 10) / 10).toFixed(1);
const players = (count) =>
    `${LOCALE.number(count)} ${LOCALE.plural(count, { one: 'player', other: 'players' })}`;

const UI = LOCALE.messages({
    // 경기 화면
    local1P: { ko: '1P · 청록', en: '1P · Teal' },
    local2P: { ko: '2P · 코랄', en: '2P · Coral' },
    us: { ko: '우리 팀', en: 'Your team' },
    them: { ko: '상대 팀', en: 'Opponent' },
    modeTraining: { ko: '스파이크 연습', en: 'Spike practice' },
    modeMatch: { ko: 'AI 대전', en: 'vs AI' },
    modeLocal: { ko: '로컬 2인', en: 'Local 2P' },
    modeOnline: { ko: '온라인 1대1', en: 'Online 1-on-1' },
    modeWatch: { ko: 'AI 관전', en: 'Watch AI' },
    trainingSetLabel: { ko: '높은 토스 · 네 가지 발차기', en: 'High set · four kicks' },
    setNumber: { ko: ({ set }) => `${set}세트`, en: ({ set }) => `Set ${set}` },
    setsWon: {
        ko: ({ count }) => `${count}세트 획득`,
        en: ({ count }) => `${count} ${LOCALE.plural(count, { one: 'set', other: 'sets' })} won`,
    },
    phaseReady: { ko: '서브 준비', en: 'Serve ready' },
    phaseRally: { ko: '랠리 진행 중', en: 'Rally on' },
    phasePoint: { ko: '다음 랠리 준비', en: 'Next rally coming' },
    phaseFinished: { ko: '경기 종료', en: 'Match over' },
    phaseIdle: { ko: '경기 준비', en: 'Getting ready' },
    touchTeam: {
        ko: ({ own }) => `${own ? '우리 팀' : '상대 팀'} 터치`,
        en: ({ own }) => (own ? 'Your touches' : 'Their touches'),
    },
    touch: { ko: '터치', en: 'Touches' },
    attacker: { ko: '공격수', en: 'Attacker' },
    stateReady: { ko: '준비', en: 'Ready' },
    bothMatchPoint: { ko: '양 팀 매치 포인트', en: 'Match point for both' },
    matchPoint: {
        ko: ({ team }) => `${team} 매치 포인트`,
        en: ({ team }) => `Match point · ${team}`,
    },
    deuce: { ko: ({ a, b }) => `${a} : ${b} · 듀스`, en: ({ a, b }) => `${a} : ${b} · Deuce` },
    tossThrow: { ko: '공 던지기', en: 'Toss' },
    tossHint: { ko: '꾹 · 높게', en: 'Hold · higher' },
    kick: { ko: '발차기', en: 'Kick' },
    kickHint: { ko: '누르고 유지', en: 'Press and hold' },
    watchTick: { ko: ({ tick }) => `틱 ${tick}`, en: ({ tick }) => `Tick ${tick}` },
    schoolClear: { ko: 'CLEAR', en: 'CLEAR' },
    schoolRetrySave: { ko: '저장 재시도 필요', en: 'Save needs a retry' },
    schoolSaving: { ko: '클리어 저장 중', en: 'Saving the clear' },
    schoolBeaten: {
        ko: ({ school, clear }) => `${school} 격파 · ${clear}`,
        en: ({ school, clear }) => `${school} defeated · ${clear}`,
    },
    schoolLost: {
        ko: ({ school }) => `${school} · 다시 도전해요`,
        en: ({ school }) => `${school} · try again`,
    },
    localWin: { ko: ({ side }) => `${side} 팀 승리`, en: ({ side }) => `${side} team wins` },
    teamWin: { ko: ({ team }) => `${team} 승리`, en: ({ team }) => `${team} wins` },
    youWin: { ko: '우리 팀 승리!', en: 'You win!' },
    youLose: { ko: '패배 · 다시 도전해요', en: 'Defeat · try again' },
    timingPerfect: { ko: '퍼펙트', en: 'Perfect' },
    timingGood: { ko: '굿', en: 'Good' },
    timingEarly: { ko: '빠름', en: 'Early' },
    timingLate: { ko: '늦음', en: 'Late' },
    replaySpike: { ko: '스파이크 결정타', en: 'Winning spike' },
    replayRally: { ko: '긴 랠리', en: 'Long rally' },
    featured: { ko: '추천 경기', en: 'Featured matches' },
    featuredClosest: {
        ko: ({ seed, closest }) => `${seed} · 가장 아슬아슬한 받아내기 · ${closest}초`,
        en: ({ seed, closest }) => `${seed} · Closest dig · ${closest}s`,
    },
    featuredDigs: {
        ko: ({ seed, digs, touches }) => `${seed} · 받아내기 ${digs}번 · ${touches}터치`,
        en: ({ seed, digs, touches }) => `${seed} · ${digs} digs · ${touches} touches`,
    },

    // 연습
    trainingCount: { ko: ({ count }) => `${count}번째 토스`, en: ({ count }) => `Set ${count}` },
    trainingSuccesses: {
        ko: ({ count }) => `성공 ${count}회`,
        en: ({ count }) =>
            `${count} ${LOCALE.plural(count, { one: 'success', other: 'successes' })}`,
    },
    stageReady: { ko: '토스 준비', en: 'Set ready' },
    stageSet: { ko: '세터의 토스', en: 'Setter’s set' },
    stagePosition: { ko: '자리 잡기', en: 'Positioning' },
    stageBrake: { ko: '이동 멈추기', en: 'Stop moving' },
    stageJump: { ko: '점프 타이밍', en: 'Jump timing' },
    stageKick: { ko: '발차기 타이밍', en: 'Kick timing' },
    stageContact: { ko: '타격', en: 'Contact' },
    stageResult: { ko: '이번 시도', en: 'This attempt' },
    timingDefault: {
        ko: '바닥 발자국과 공중 타점을 확인하세요',
        en: 'Check the footprints and the contact point in the air',
    },
    timingSetting: { ko: '세터가 공을 올리는 중', en: 'The setter is lifting the ball' },
    timingNext: { ko: '잠시 후 다음 토스', en: 'Next set in a moment' },
    timingContact: { ko: '실제 타격 결과를 확인하는 중', en: 'Checking the real contact' },
    timingBrake: {
        ko: '이동을 놓고 자세를 잡으세요',
        en: 'Let go of movement and set your stance',
    },
    timingJumpTap: { ko: '점프 버튼을 짧게 누르고 떼세요', en: 'Tap the jump button' },
    timingJumpHold: { ko: '점프 버튼을 눌러 유지하세요', en: 'Press and hold the jump button' },
    timingKickRetry: {
        ko: '현재 높이와 발까지의 거리를 확인하세요',
        en: 'Check your height and the distance to your foot',
    },
    timingKickIn: {
        ko: ({ value }) => `발차기까지 ${seconds(value)}초`,
        en: ({ value }) => `Kick in ${seconds(value)}s`,
    },
    timingKickHold: { ko: '좌클을 유지하세요', en: 'Keep holding left click' },
    timingJumpIn: {
        ko: ({ value }) => `점프까지 ${seconds(value)}초`,
        en: ({ value }) => `Jump in ${seconds(value)}s`,
    },
    timingJumpWithKick: { ko: '좌클을 유지한 채 점프하세요', en: 'Jump while holding left click' },

    // 대화상자 제목
    clubKicker: { ko: '선수단 · 편성 · 훈련', en: 'Roster · Lineup · Training' },
    clubTitle: { ko: '내 팀 관리', en: 'My team' },
    settingsKicker: { ko: '내게 맞는 플레이', en: 'Play your way' },
    settingsTitle: { ko: '설정', en: 'Settings' },
    pauseKickerOnline: { ko: '경기는 계속 진행돼요', en: 'The match keeps going' },
    pauseKicker: { ko: '잠깐 숨 고르기', en: 'Catch your breath' },
    pauseTitleOnline: { ko: '경기 메뉴', en: 'Match menu' },
    pauseTitle: { ko: '일시 정지', en: 'Paused' },
    networkKicker: { ko: '둘이서, 하나의 코트', en: 'Two players, one court' },
    networkTitle: { ko: '친구와 온라인 1대1', en: 'Online 1-on-1 with a friend' },
    campaignKicker: { ko: '하나씩 도전하는 우리 팀', en: 'One school at a time' },
    campaignTitle: { ko: '도장깨기', en: 'School Challenge' },

    // 도장깨기
    uniform: { ko: ({ school }) => `${school} 유니폼`, en: ({ school }) => `${school} uniform` },
    introHome: {
        ko: ({ school }) => `우리 학교는 ${school}예요`,
        en: ({ school }) => `Your school is ${school}`,
    },
    introTrio: {
        ko: ({ element }) => `${element} 속성. 리시버·세터·공격수, 셋이 한 팀이에요.`,
        en: ({ element }) =>
            `${element} element. Receiver, setter and attacker: three players, one team.`,
    },
    introMysteryTitle: { ko: '어떤 학교가 기다릴까요?', en: 'Which school is waiting?' },
    introMystery: { ko: '이기면 다음 학교가 나타나요.', en: 'Win and the next school appears.' },
    mysterySchool: { ko: '아직 모르는 학교', en: 'A school you haven’t met yet' },
    introFirst: {
        ko: ({ school }) => `첫 상대는 ${school}`,
        en: ({ school }) => `First opponent: ${school}`,
    },
    stageSchool: {
        ko: ({ stage, school }) => `${stage}단계 · ${school}`,
        en: ({ stage, school }) => `Stage ${stage} · ${school}`,
    },
    elementOpen: {
        ko: ({ element }) => `${element} 속성 · 도전 가능`,
        en: ({ element }) => `${element} element · open`,
    },
    elementCleared: {
        ko: ({ element }) => `${element} 속성 · 클리어`,
        en: ({ element }) => `${element} element · cleared`,
    },
    introReward: { ko: '이기면 훈련 포인트를 받아요.', en: 'Win to earn training points.' },
    introLabel: {
        ko: ({ step, total }) => `도장깨기 소개 ${step}/${total}`,
        en: ({ step, total }) => `School Challenge intro ${step}/${total}`,
    },
    skip: { ko: '건너뛰기', en: 'Skip' },
    challengeStart: { ko: '도전하기', en: 'Take the challenge' },
    next: { ko: '다음', en: 'Next' },
    campaignNeedsTeam: {
        ko: '팀을 불러온 뒤 도전할 수 있어요.',
        en: 'Load your team to start the challenge.',
    },
    rewardCollected: { ko: '훈련 포인트 수령 완료', en: 'Training points collected' },
    firstClear: {
        ko: ({ points }) => `첫 클리어 ${points} P · 임시 보상`,
        en: ({ points }) => `First clear ${points} P · placeholder reward`,
    },
    rechallenge: { ko: '재도전', en: 'Rematch' },
    challenge: { ko: '도전', en: 'Challenge' },
    mysteryStage: {
        ko: ({ stage }) => `${stage}단계 · ???`,
        en: ({ stage }) => `Stage ${stage} · ???`,
    },
    nextSchool: { ko: '다음에 만날 학교', en: 'The next school you’ll face' },
    locked: { ko: '잠김', en: 'Locked' },
    campaignHome: {
        ko: ({ school, element }) =>
            `내 학교는 <b>${school}</b>(${element} 속성)예요. 이기면 다음 학교가 나타나요.`,
        en: ({ school, element }) =>
            `Your school is <b>${school}</b> (${element} element). Win and the next school appears.`,
    },
    allCleared: { ko: '모든 학교를 클리어했어요!', en: 'You’ve cleared every school!' },
    introReplay: { ko: '소개 다시 보기', en: 'Watch the intro again' },

    // 팀 관리
    clubLoadingHome: { ko: '팀을 불러오는 중', en: 'Loading your team' },
    clubSavingHome: { ko: '팀을 저장하는 중', en: 'Saving your team' },
    clubConflictHome: {
        ko: '다른 탭에서 변경됨 · 최신 저장 불러오기',
        en: 'Changed in another tab · load the latest save',
    },
    clubLockedHome: {
        ko: '저장된 팀을 읽지 못했어요 · 팀 관리에서 새로 시작',
        en: 'The saved team couldn’t be read · start over in Team',
    },
    clubErrorHome: {
        ko: '팀 저장 확인 필요 · 관리에서 다시 불러오기',
        en: 'Check your team save · reload it in Team',
    },
    clubSummary: {
        ko: ({ name, count }) => `${name} · 선수 ${count}명`,
        en: ({ name, count }) => `${name} · ${players(count)}`,
    },
    clubHint: { ko: '선수단 · 편성 · 훈련', en: 'Roster · Lineup · Training' },
    bench: { ko: '후보', en: 'Bench' },
    lockInGame: {
        ko: '팀 변경은 처음 화면에서 할 수 있어요.',
        en: 'You can change your team from the home screen.',
    },
    lockSaving: { ko: '팀을 저장하고 있어요.', en: 'Saving your team.' },
    lockLoad: { ko: '팀을 먼저 불러와 주세요.', en: 'Load your team first.' },
    radarTitle: { ko: ({ name }) => `${name} 능력치`, en: ({ name }) => `${name}’s stats` },
    radarScale: {
        ko: ({ top, description }) => `0부터 ${top}까지 같은 눈금. ${description}.`,
        en: ({ top, description }) => `Same scale from 0 to ${top}. ${description}.`,
    },
    statsEqual: { ko: '능력치 동일', en: 'Same stats' },
    sellLabel: {
        ko: ({ name, value }) => `${name} 판매, ${value} P 받음`,
        en: ({ name, value }) => `Sell ${name} for ${value} P`,
    },
    sell: { ko: '판매', en: 'Sell' },
    infoLabel: {
        ko: ({ name }) => `${name} 능력치 자세히 보기`,
        en: ({ name }) => `See ${name}’s stats`,
    },
    slotLoading: { ko: '불러오는 중', en: 'Loading' },
    recommended: { ko: '추천', en: 'Best fit' },
    starting: { ko: '선발 중', en: 'Starting' },
    directControl: { ko: '직접 조작', en: 'You control' },
    teammate: { ko: '동료', en: 'Teammate' },
    pickPlayerHint: {
        ko: ({ name }) => `${name} 선수가 갈 자리를 누르세요.`,
        en: ({ name }) => `Tap the spot for ${name}.`,
    },
    pickSlotHint: {
        ko: ({ role }) => `${role} 자리에 올 선수를 누르세요.`,
        en: ({ role }) => `Tap the player for the ${role} spot.`,
    },
    lineupHint: {
        ko: '선수나 자리를 눌러 선발을 바꿔요. 후보는 왼쪽으로 밀면 팔 수 있어요.',
        en: 'Tap a player or a spot to change the lineup. Swipe a bench player left to sell.',
    },
    currentLineup: { ko: '현재 선발', en: 'Current lineup' },
    currentSpot: { ko: '현재 자리', en: 'Current spot' },
    roleStarter: {
        ko: ({ role }) => `${role} 선발`,
        en: ({ role }) => `Starting ${role.toLowerCase()}`,
    },
    trainSummary: {
        ko: ({ level, gain, points }) =>
            `훈련 레벨 ${level} · 모든 능력치 약 +${gain}% · 보유 ${points} P`,
        en: ({ level, gain, points }) =>
            `Training level ${level} · all stats about +${gain}% · ${points} P on hand`,
    },
    noPoints: {
        ko: ({ summary }) => `훈련 포인트가 없어요 · ${summary}`,
        en: ({ summary }) => `No training points · ${summary}`,
    },
    train: { ko: ({ cost }) => `훈련 · ${cost} P`, en: ({ cost }) => `Train · ${cost} P` },
    detailTag: {
        ko: ({ tag, role }) => `${tag} · 추천 ${role}`,
        en: ({ tag, role }) => `${tag} · best as ${role.toLowerCase()}`,
    },
    drawJoinNote: {
        ko: ({ refunds }) =>
            `뽑은 선수는 바로 선수단에 합류해요. 선수단이 가득 차면 환급(${refunds})을 받거나 후보와 교체해요.`,
        en: ({ refunds }) =>
            `Drawn players join the roster right away. If the roster is full, take a refund (${refunds}) or swap out a bench player.`,
    },
    drawCreditsNote: {
        ko: ({ winC, winP, lossC, lossP }) =>
            `코인은 AI 대전에서 받아요. 승리 ${winC} C·${winP} P / 패배 ${lossC} C·${lossP} P`,
        en: ({ winC, winP, lossC, lossP }) =>
            `Earn coins from AI matches. Win ${winC} C·${winP} P / Loss ${lossC} C·${lossP} P`,
    },
    drawPending: {
        ko: '지난 뽑기 결과를 아직 정리하지 않았어요.',
        en: 'Your last draw still needs a decision.',
    },
    drawResume: { ko: '결과 이어 보기', en: 'Continue the draw' },
    creditsShort: {
        ko: ({ short, credits }) => `${short} C 부족 · 보유 ${credits} C`,
        en: ({ short, credits }) => `${short} C short · ${credits} C on hand`,
    },
    drawStatus: {
        ko: ({ credits, runs }) => `보유 ${credits} C · 뽑은 횟수 ${runs}회`,
        en: ({ credits, runs }) =>
            `${credits} C on hand · ${runs} ${LOCALE.plural(runs, { one: 'draw', other: 'draws' })} so far`,
    },
    draw: { ko: ({ cost }) => `뽑기 · ${cost} C`, en: ({ cost }) => `Draw · ${cost} C` },
    nameLabel: {
        ko: ({ max }) => `팀 이름 · 최대 ${max}자`,
        en: ({ max }) => `Team name · up to ${max} characters`,
    },
    namePlaceholder: { ko: '팀 이름', en: 'Team name' },
    save: { ko: '저장', en: 'Save' },
    cancel: { ko: '취소', en: 'Cancel' },
    myTeam: { ko: '내 팀', en: 'My team' },
    rename: { ko: ({ name }) => `${name} 이름 바꾸기`, en: ({ name }) => `Rename ${name}` },
    inGameLineup: {
        ko: '현재 경기는 시작할 때의 편성을 사용해요. 팀 변경은 처음 화면에서 할 수 있어요.',
        en: 'This match uses the lineup it started with. You can change your team from the home screen.',
    },
    rosterLoading: { ko: '선수 정보를 불러오고 있어요.', en: 'Loading players.' },
    rosterEmpty: { ko: '선수가 없어요.', en: 'No players yet.' },
    playerDetail: { ko: '선수 상세', en: 'Player details' },
    clubMenu: { ko: '팀 관리 메뉴', en: 'Team menu' },
    rosterTab: { ko: '선수단', en: 'Roster' },
    drawTab: { ko: '선수 뽑기', en: 'Draw players' },
    capacity: {
        ko: ({ count, max }) => `선수 ${count} / ${max}명`,
        en: ({ count, max }) => `${count} / ${max} players`,
    },
    record: {
        ko: ({ won, lost }) => `${won}승 ${lost}패 · 나만의 ${TAKRAW_GAME_NAME.ko} 팀`,
        en: ({ won, lost }) => `${won}W ${lost}L · your own ${TAKRAW_GAME_NAME.en} team`,
    },
    coins: { ko: '코인', en: 'Coins' },
    trainingPoints: { ko: '훈련 포인트', en: 'Training points' },
    refresh: { ko: '최신 저장 불러오기', en: 'Load the latest save' },
    resetClub: { ko: '기록 지우고 새로 시작', en: 'Delete the save and start over' },
    resetClubConfirm: {
        ko: '저장된 팀을 지우고 새로 시작할까요? 지운 기록은 되돌릴 수 없어요.',
        en: 'Delete the saved team and start over? This can’t be undone.',
    },
    resetClubDelete: { ko: '기록 지우기', en: 'Delete the save' },
    rewardRetry: { ko: '보상 저장 재시도', en: 'Retry saving reward' },
    saveFailed: {
        ko: '변경을 저장하지 못했어요. 다시 확인해 주세요.',
        en: 'The change couldn’t be saved. Please check and try again.',
    },
    rarityRole: {
        ko: ({ rarity, role }) => `${rarity} · 추천 ${role}`,
        en: ({ rarity, role }) => `${rarity} · best as ${role.toLowerCase()}`,
    },
    joined: {
        ko: ({ name }) => `${name} 선수가 팀에 합류했어요.`,
        en: ({ name }) => `${name} joined the team.`,
    },
    ok: { ko: '확인', en: 'OK' },
    rosterFull: {
        ko: ({ count, max }) =>
            `선수단이 가득 찼어요 (${count} / ${max}명). 새 선수를 어떻게 할까요?`,
        en: ({ count, max }) =>
            `The roster is full (${count} / ${max}). What should happen to the new player?`,
    },
    refund: {
        ko: ({ points }) => `환급 · ${points} P 받기`,
        en: ({ points }) => `Refund · take ${points} P`,
    },
    swapTitle: { ko: '후보와 교체', en: 'Swap with a bench player' },
    later: { ko: '나중에 정하기', en: 'Decide later' },
    flip: { ko: '카드 뒤집기', en: 'Flip the card' },
    tapToFlip: { ko: '눌러서 뒤집기', en: 'Tap to flip' },
    sellStarter: {
        ko: '출전 선수는 팔 수 없어요. 후보와 교체한 뒤 판매할 수 있어요.',
        en: 'Starters can’t be sold. Swap them to the bench first.',
    },

    // 설정·일시 정지·온라인
    sound: { ko: '효과음', en: 'Sound effects' },
    soundHint: { ko: '발끝의 접촉과 랠리의 리듬', en: 'Every touch and the rhythm of the rally' },
    quality: { ko: '화면 품질', en: 'Graphics quality' },
    qualityHint: { ko: '느린 기기에서는 가볍게', en: 'Go light on slower devices' },
    qualityLow: { ko: '가볍게', en: 'Light' },
    qualityHigh: { ko: '선명하게', en: 'Sharp' },
    camera: { ko: '카메라', en: 'Camera' },
    cameraTouch: {
        ko: '공과 선수를 따라가는 기본 시점',
        en: 'Default view following the ball and players',
    },
    cameraMouse: {
        ko: '우클릭 드래그로 회전 · C로 기본 시점',
        en: 'Right-drag to rotate · C for the default view',
    },
    cameraReset: { ko: '시점 초기화', en: 'Reset view' },
    language: { ko: '언어', en: 'Language' },
    languageHint: { ko: '바꾸면 페이지를 다시 열어요', en: 'Changing it reloads the page' },
    languageLocked: { ko: '경기 중에는 바꿀 수 없어요', en: 'Can’t be changed during a match' },
    install: { ko: '앱으로 설치', en: 'Install as an app' },
    installHint: {
        ko: '홈 화면이나 바탕 화면에서 바로 열어요',
        en: 'Open it straight from your home screen or desktop',
    },
    installButton: { ko: '설치', en: 'Install' },
    qualityTip: {
        ko: '화면 품질을 바꿔도 공의 움직임과 경기 규칙은 같아요.',
        en: 'Changing graphics quality never changes how the ball moves or the rules.',
    },
    done: { ko: '완료', en: 'Done' },
    resume: { ko: '경기 계속하기', en: 'Resume' },
    restart: { ko: '처음부터 다시', en: 'Start over' },
    onlinePauseTip: {
        ko: '온라인 경기에서는 메뉴를 열어도 상대의 경기가 계속돼요.',
        en: 'In an online match the game keeps going for your opponent while the menu is open.',
    },
    toHome: { ko: '처음 화면으로', en: 'Back to home' },
    networkIntroA: {
        ko: '방을 만들고 코드를 친구에게 전달하세요.',
        en: 'Create a room and send the code to a friend.',
    },
    networkIntroB: {
        ko: '한 명이 들어오면 1대1 경기가 시작돼요.',
        en: 'The 1-on-1 match starts when they join.',
    },
    host: { ko: '새 방 만들기', en: 'Create a room' },
    orJoin: { ko: '또는 코드로 참가', en: 'or join with a code' },
    roomInputLabel: { ko: '친구에게 받은 방 코드', en: 'Room code from your friend' },
    roomPlaceholder: { ko: '4자리 방 코드', en: '4-digit room code' },
    join: { ko: '방에 참가하기', en: 'Join the room' },
    connectionReady: { ko: '연결 준비', en: 'Connecting' },
    myRoomCode: { ko: '내 방 코드', en: 'My room code' },
    copy: { ko: '복사', en: 'Copy' },
    roomHelp: {
        ko: ({ version }) =>
            `양쪽 모두 ${TAKRAW_PRODUCT_NAME.ko} ${version}로 접속해야 해요. HTTPS 사이트 사용을 권장합니다. 네트워크에 따라 WebRTC 연결이 제한될 수 있어요.`,
        en: ({ version }) =>
            `Both players need ${TAKRAW_PRODUCT_NAME.en} ${version}. An HTTPS site is recommended. Some networks restrict WebRTC connections.`,
    },
    diagnostics: { ko: '연결 진단', en: 'Connection diagnostics' },
    networkLog: { ko: '최근 연결 이벤트', en: 'Recent connection events' },
    copyDiagnostics: { ko: '진단 복사', en: 'Copy diagnostics' },
    resumeRoom: { ko: '이전 경기 다시 연결', en: 'Reconnect to the last match' },
    closeNetwork: { ko: '연결 닫기', en: 'Close connection' },
    enterRoomCode: { ko: '방 코드를 입력하세요.', en: 'Enter a room code.' },
    copied: { ko: '복사했어요', en: 'Copied' },
    copyManually: { ko: '내용을 선택해 복사하세요', en: 'Select the text and copy it' },
    friendConnected: { ko: '친구와 연결됨', en: 'Connected with your friend' },
    connecting: { ko: '연결 준비 중', en: 'Getting connected' },
    waitingFriend: { ko: '친구를 기다리고 있어요.', en: 'Waiting for your friend.' },
    connectionState: { ko: '연결 상태', en: 'Connection' },
    noLog: { ko: '연결 기록이 없어요.', en: 'No connection events yet.' },
});

/** 팀 관리 모델(club.js)의 상태 문구·오류 코드. */
const CLUB = LOCALE.messages({
    loading: { ko: '팀을 불러오고 있어요.', en: 'Loading your team.' },
    loaded: {
        ko: '팀을 불러왔어요. 편성은 다음 경기부터 적용돼요.',
        en: 'Team loaded. Lineup changes apply from the next match.',
    },
    refreshing: { ko: '최신 저장을 불러오고 있어요.', en: 'Loading the latest save.' },
    refreshed: { ko: '최신 팀을 불러왔어요.', en: 'Loaded the latest team.' },
    saving: { ko: '팀을 저장하고 있어요.', en: 'Saving your team.' },
    saveFailed: { ko: '팀 변경을 저장하지 못했어요.', en: 'Your team change couldn’t be saved.' },
    conflict: {
        ko: '다른 탭에서 팀이 바뀌었어요. 최신 저장을 불러오세요.',
        en: 'Your team changed in another tab. Load the latest save.',
    },
    unreadable: {
        ko: '저장된 팀 형식을 확인할 수 없어요. 기존 데이터는 보존했어요.',
        en: 'The saved team couldn’t be read. Your existing data was kept.',
    },
    quota: {
        ko: '저장 공간이 부족해 변경을 저장하지 못했어요. 기존 팀은 보존했어요.',
        en: 'Not enough storage to save the change. Your existing team was kept.',
    },
    storage: {
        ko: '팀 저장소를 사용할 수 없어요. 브라우저 저장 권한을 확인해 주세요.',
        en: 'Team storage isn’t available. Check your browser’s storage permission.',
    },
    closed: { ko: '팀 관리가 종료되었어요.', en: 'Team management has closed.' },
    noStorage: {
        ko: '이 브라우저에서 팀 저장을 사용할 수 없어요. 저장 권한을 확인해 주세요.',
        en: 'This browser can’t save your team. Check the storage permission.',
    },
    loadFirst: { ko: '최신 팀을 먼저 불러와 주세요.', en: 'Load the latest team first.' },
    nameLength: {
        ko: ({ max }) => `팀 이름은 1~${max}자로 입력하세요.`,
        en: ({ max }) => `Enter a team name of 1–${max} characters.`,
    },
    renamed: { ko: '팀 이름을 저장했어요.', en: 'Team name saved.' },
    assignInvalid: {
        ko: '편성할 선수와 자리를 확인해 주세요.',
        en: 'Check the player and the spot.',
    },
    assigned: {
        ko: '편성을 저장했어요. 다음 경기와 연습부터 적용돼요.',
        en: 'Lineup saved. It applies from the next match and practice.',
    },
    trainInvalid: { ko: '훈련할 선수를 확인해 주세요.', en: 'Check which player to train.' },
    pointsShort: {
        ko: '훈련 포인트가 부족해요. AI 대전을 완료하면 받을 수 있어요.',
        en: 'Not enough training points. Finish an AI match to earn more.',
    },
    trained: {
        ko: '훈련을 저장했어요. 다음 경기와 연습부터 적용돼요.',
        en: 'Training saved. It applies from the next match and practice.',
    },
    drawPending: {
        ko: '먼저 지난 뽑기 결과를 정리해 주세요.',
        en: 'Decide on your last draw first.',
    },
    creditsShort: {
        ko: ({ short }) => `뽑기에 ${short} C가 더 필요해요.`,
        en: ({ short }) => `You need ${short} more C to draw.`,
    },
    drawn: { ko: '선수를 뽑았어요.', en: 'Player drawn.' },
    campaignIntroSeen: { ko: '도장깨기 소개를 확인했어요.', en: 'School Challenge intro seen.' },
    sellInvalid: { ko: '판매할 선수를 확인해 주세요.', en: 'Check which player to sell.' },
    sellStarter: {
        ko: '출전 선수는 팔 수 없어요. 후보와 교체한 뒤 판매해 주세요.',
        en: 'Starters can’t be sold. Swap them to the bench first.',
    },
    minRoster: {
        ko: ({ min }) => `선수단에는 최소 ${min}명이 남아야 해요.`,
        en: ({ min }) => `The roster needs at least ${min} players.`,
    },
    sold: { ko: '선수를 팔았어요.', en: 'Player sold.' },
    noPending: { ko: '정리할 뽑기 결과가 없어요.', en: 'There’s no draw to decide on.' },
    releaseInvalid: {
        ko: '교체할 후보 선수를 확인해 주세요.',
        en: 'Check which bench player to swap.',
    },
    refunded: { ko: '환급 포인트를 받았어요.', en: 'Refund points received.' },
    replaced: { ko: '후보와 교체했어요.', en: 'Swapped with a bench player.' },
    rewardInvalid: {
        ko: '완료된 AI 대전의 보상 정보가 필요해요.',
        en: 'A finished AI match is needed for this reward.',
    },
    schoolInvalid: { ko: '도전한 학교를 확인해 주세요.', en: 'Check which school you challenged.' },
    schoolLocked: { ko: '앞 학교를 먼저 클리어해 주세요.', en: 'Clear the earlier school first.' },
    rewarded: { ko: '경기 보상을 저장했어요.', en: 'Match reward saved.' },
    resetInvalid: {
        ko: '읽지 못한 저장이 없어 지우지 않았어요.',
        en: 'There is no unreadable save, so nothing was deleted.',
    },
    resetDone: {
        ko: '저장을 지우고 새 팀으로 시작했어요.',
        en: 'The save was deleted and a new team has started.',
    },
    debugChanged: { ko: '확인용 값을 바꿨어요.', en: 'Debug value changed.' },
});

/** club.js의 message({ id, values }) 또는 오류(code·values)를 문장으로. */
const clubText = (ref) => {
    const id = ref?.id ?? ref?.code;
    return id in CLUB ? CLUB[id](ref.values) : '';
};

export { UI, clubText };
