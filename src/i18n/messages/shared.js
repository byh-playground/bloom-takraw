import { TAKRAW_ROLE_NAMES } from '../../config/game.js';

/**
 * 여러 문구 표(PAGE·UI·RUNTIME)가 같은 대상을 같은 말로 부르는 TextPair. 한 곳에서 정의해 표들이 이름만 달리 가리킨다.
 * 문구가 우연히 같을 뿐 다른 자리·다른 뜻이면 여기 두지 않고 각 표에 따로 둔다(예: 건너뛰기, 팀 저장 중 안내).
 */
const SHARED = Object.freeze({
    settings: Object.freeze({ ko: '설정', en: 'Settings' }),
    campaign: Object.freeze({ ko: '도장깨기', en: 'School Challenge' }),
    modeTraining: Object.freeze({ ko: '스파이크 연습', en: 'Spike practice' }),
    modeWatch: Object.freeze({ ko: 'AI 관전', en: 'Watch AI' }),
    copyDiagnostics: Object.freeze({ ko: '진단 복사', en: 'Copy diagnostics' }),
    kick: Object.freeze({ ko: '발차기', en: 'Kick' }),
    toss: Object.freeze({ ko: '공 던지기', en: 'Toss' }),
    attacker: TAKRAW_ROLE_NAMES.attacker,
    rewardRetry: Object.freeze({ ko: '보상 저장 재시도', en: 'Retry saving reward' }),
    featured: Object.freeze({ ko: '추천 경기', en: 'Featured matches' }),
    stateReady: Object.freeze({ ko: '준비', en: 'Ready' }),
});

export { SHARED };
