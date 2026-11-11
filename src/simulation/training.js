/**
 * 연습(스파이크 연습)의 레슨·토스 정의와 연습 규칙의 단일 소유자.
 * 실제 발차기 선택/자세는 물리 계층이 소유한다. title·sequence·detail은 TextPair다.
 * 조작 이름은 PC 기준(좌클)이고 터치 화면은 ui.js controlText가 바꾼다.
 * 리플레이 워커도 game.js를 통해 이 파일을 읽으므로 상대 import만 쓴다.
 */
const defineLesson = (
    id,
    command,
    [titleKo, titleEn],
    [sequenceKo, sequenceEn],
    [detailKo, detailEn],
    extra = {},
) =>
    Object.freeze({
        id,
        command,
        anyMotion: false,
        prehold: false,
        approachScale: 1,
        kickDelayScale: 1,
        ...extra,
        title: Object.freeze({ ko: titleKo, en: titleEn }),
        sequence: Object.freeze({ ko: sequenceKo, en: sequenceEn }),
        detail: Object.freeze({ ko: detailKo, en: detailEn }),
    });

/**
 * 레슨 속성(분기는 레슨 id가 아니라 이 값으로 한다):
 * - anyMotion: 정해진 발차기가 없다. 어떤 동작으로 맞혀도 레슨에 맞고, 동작이 없을 때 안내는 "상황에 맞춰"다.
 * - prehold: 점프 전에 발을 먼저 올려 둔다(내려찍기). 발차기 오차·안내 순서·결과 갈래가 이 값을 따른다.
 * - approachScale: 공격 접근 거리(ai.toss.attack.offset) 배율. kickDelayScale: 점프 뒤 발차기 지연 배율.
 * id는 물리의 발차기 선호(motionPreference)로도 넘어가므로 anyMotion이 아닌 레슨의 id는 모션 클립 id와 같다.
 */
const TAKRAW_TRAINING_LESSONS = Object.freeze([
    defineLesson(
        'auto',
        6,
        ['상황에 맞춰 차기', 'Context kick'],
        [
            '거리와 높이 맞추기 → 점프 → 좌클 유지',
            'Match distance and height → Jump → Hold left click',
        ],
        [
            '공과 몸의 위치에 맞는 발차기로 이어져요. 점프 높이와 누르는 시점을 맞춰 보세요.',
            'You get the kick that fits the ball and your body. Match your jump height and when you press.',
        ],
        { anyMotion: true },
    ),
    defineLesson(
        'downward',
        5,
        ['내려찍기', 'Downward strike'],
        [
            '좌클 먼저 유지 → 점프 → 높은 발로 내려찍기',
            'Hold left click first → Jump → Strike down from a raised foot',
        ],
        [
            '올려 둔 발에서 내려치는 동작을 이어가세요. 공과 몸 사이에 발을 돌릴 공간을 남겨요.',
            'Bring the raised foot down through the ball. Leave room between the ball and your body to swing.',
        ],
        { prehold: true },
    ),
    defineLesson(
        'sideswipe',
        7,
        ['사선 회전킥', 'Diagonal spin kick'],
        [
            '무릎 들고 점프 → 좌클 유지 → 몸을 돌려 사선 타격',
            'Knee up and jump → Hold left click → Turn and strike diagonally',
        ],
        [
            '몸통을 기울여 돌며 뒷발을 사선으로 내려요. 발자국에서 높이와 거리를 먼저 맞추세요.',
            'Lean and turn your torso, bringing the back foot down diagonally. Match height and distance at the footprints first.',
        ],
        { approachScale: 0.75, kickDelayScale: 1.5 },
    ),
    defineLesson(
        'scissors',
        8,
        ['가위치기', 'Scissor kick'],
        [
            '점프 → 좌클 유지 → 다리를 교차해 발등 타격',
            'Jump → Hold left click → Cross your legs and strike with the instep',
        ],
        [
            '공중에서 두 다리를 교차하며 발등을 보내요. 공 바로 아래로 너무 붙지 않게 준비하세요.',
            "Cross both legs in the air and send the instep through. Don't get too close underneath the ball.",
        ],
    ),
    defineLesson(
        'roundhouse540',
        9,
        ['540도 회전킥', '540 spin kick'],
        [
            '점프 → 좌클 유지 → 발등이 앞서는 회전 타격',
            'Jump → Hold left click → Spin with the instep leading',
        ],
        [
            '몸과 다리를 함께 돌려 발등 쪽으로 차요. 높은 토스를 보고 회전할 시간을 확보하세요.',
            'Turn your body and leg together and kick with the instep. Use a high set to give yourself time to spin.',
        ],
    ),
]);

/** 연습 토스의 종류. high는 세터가 높게 올리는 기본 토스, quick은 낮고 빠른 토스(속공)다. 명령 번호는 동작 연습(5~9)·재시작(4)과 겹치지 않는다. */
const TAKRAW_TRAINING_TEMPOS = Object.freeze(
    [
        {
            id: 'high',
            command: 21,
            title: { ko: '높은 토스', en: 'High set' },
            detail: {
                ko: '세터가 높게 올려요. 점프 버튼을 잠깐 유지하며 여유 있게 타이밍을 맞춰요.',
                en: 'The setter lifts it high. Hold the jump button briefly and take your time with the timing.',
            },
        },
        {
            id: 'quick',
            command: 22,
            title: { ko: '속공', en: 'Quick set' },
            detail: {
                ko: '네트 앞으로 낮고 빠르게 와요. 점프 버튼을 짧게 누르고 떼며 바로 발차기를 이어가요.',
                en: 'It comes low and fast in front of the net. Tap the jump button and go straight into the kick.',
            },
        },
    ].map((tempo) =>
        Object.freeze({
            ...tempo,
            title: Object.freeze(tempo.title),
            detail: Object.freeze(tempo.detail),
        }),
    ),
);

/** 레슨 id의 정의. 모르는 id면 null. */
const takrawTrainingLesson = (id) => TAKRAW_TRAINING_LESSONS.find((item) => item.id === id) ?? null;

/**
 * 연습 규칙의 상태 없는 소유자(timing.js의 TakrawTimingJudge와 같은 방식).
 * 기록은 호출자의 경기 상태(state.training)에 두어 스냅샷·롤백에 함께 저장되고,
 * 그 기록을 만들고 바꾸는 곳은 이 클래스의 메서드뿐이다. 언제 부르는지(훅 위치)는 game.js가 정한다.
 */
class TakrawTrainingDrill {
    /** 기록의 레슨 정의. */
    lesson(record) {
        return takrawTrainingLesson(record.lesson);
    }

    /** 이번 시도에서 점프할 때 기억한 준비(낮은/높은 점프·지연). 없거나 지난 시도의 것이면 null. */
    recordedJump(record) {
        return record && record.jumpAt !== null && record.jumpTiming?.attempt === record.attempt
            ? record.jumpTiming
            : null;
    }

    /** 새 연습 기록. 모르는 레슨·토스는 첫 정의(상황에 맞춰 차기·높은 토스)다. */
    createRecord(lesson, tempo) {
        return {
            lesson: TAKRAW_TRAINING_LESSONS.some((item) => item.id === lesson)
                ? lesson
                : TAKRAW_TRAINING_LESSONS[0].id,
            attempt: 0,
            successes: 0,
            tempo: TAKRAW_TRAINING_TEMPOS.some((item) => item.id === tempo)
                ? tempo
                : TAKRAW_TRAINING_TEMPOS[0].id,
            setAt: null,
            jumpAt: null,
            kickAt: null,
            jumpOffset: null,
            kickOffset: null,
            entry: null,
            motionId: null,
            contact: null,
            result: null,
            previousResult: null,
            setApex: 0,
        };
    }

    /** 다음 공을 준비한다(지난 결과는 previousResult로 남는다). */
    clearAttempt(record) {
        record.previousResult = record.result;
        Object.assign(record, {
            setAt: null,
            jumpAt: null,
            kickAt: null,
            jumpOffset: null,
            kickOffset: null,
            entry: null,
            motionId: null,
            contact: null,
            result: null,
            setApex: 0,
        });
    }

    /** 랠리(공 공급)를 시작할 때 시도 번호를 올린다. */
    startAttempt(record) {
        record.attempt++;
    }

    /** 세터의 토스가 공격수에게 올라간 시각(속공은 공급 시각). */
    observeSet(record, time) {
        record.setAt = time;
    }

    /**
     * 사람 선수의 점프·발차기 입력 순간을 시도마다 처음 한 번씩 기록한다.
     * kickError는 점프 기록을 쓴 뒤에 계산해야 같은 값이므로 함수로 받는다.
     */
    recordInput(record, { input, guide, time, jumpError, kickError }) {
        if (input.jumpPressed && record.jumpAt === null) {
            // Remember the displayed low/high preparation for this jump. The ball's
            // prediction can change later, but an airborne player cannot redo it.
            record.jumpTiming = guide
                ? {
                      attempt: record.attempt,
                      shortJump: guide.shortJump,
                      contactLead: guide.contactLead,
                      jumpHold: guide.jumpHold,
                      kickDelay: guide.kickDelay,
                  }
                : null;
            record.jumpAt = time;
            record.jumpOffset = jumpError;
        }
        if ((input.kickPressed || input.kick) && record.kickAt === null) {
            record.kickAt = time;
            record.kickOffset = kickError();
        }
    }

    /** 사람 선수의 접촉. 첫 접촉을 남기고, 몸이 먼저 닿았으면 뒤의 첫 발 접촉으로 바꾼다. */
    observeContact(record, event, player, { netHeight, time }) {
        const foot = /^foot/.test(event.part || '');
        if (record.contact && !(foot && !record.contact.foot)) return;
        record.contact = {
            part: event.part,
            foot,
            downward:
                foot &&
                !!event.footVelocity &&
                event.footVelocity.y < -1 &&
                event.position.y > netHeight,
            height: event.position.y,
            entry: player.kick.airPlan?.entry || null,
            motionId: player.kick.airPlan?.motion?.id || null,
            time,
            outgoing: null,
            crossed: false,
            counted: false,
        };
    }

    /** 물리 substep마다: 토스 꼭짓점, 공중 발차기 진입·동작, 접촉 직후 공의 나가는 속도. */
    observeStep(record, { ball, player }) {
        if (record.setAt !== null && !record.contact)
            record.setApex = Math.max(record.setApex, ball.translation().y);
        if (player.kick.mode === 'air' && player.kick.airPlan) {
            record.entry = player.kick.airPlan.entry;
            record.motionId = player.kick.airPlan.motion?.id || null;
        }
        if (record.contact && !record.contact.outgoing) {
            const v = ball.linvel();
            record.contact.outgoing = { x: v.x, y: v.y, z: v.z };
        }
    }

    /** 접촉한 공이 상대 코트로 네트를 넘은 순간, 네트 위·코트 폭 안으로 넘었는지. */
    observeCrossing(record, crossed) {
        record.contact.crossed = crossed;
    }

    /**
     * 연습 한 번의 결과. code가 결과 종류이고 values는 문구의 갈래(언어와 무관한 값)다. 제목·설명은 화면이 code·values로 만든다
     * (src/i18n/messages/match.js resultTitle·resultDetail).
     */
    finish(record, { reason, pointWinner }) {
        const t = record,
            hit = t.contact;
        const lesson = this.lesson(t);
        const matches = !!hit?.motionId && (lesson.anyMotion || hit.motionId === t.lesson);
        const downward =
            hit?.foot && hit.downward && hit.outgoing?.y < -0.2 && hit.outgoing.x > 0.5;
        let result;
        if (downward && matches && hit.crossed && pointWinner === 0) {
            result = {
                code: 'success',
                values: { motionId: hit.motionId, quick: t.tempo === 'quick' },
                tone: 'success',
            };
            if (!hit.counted) {
                t.successes++;
                hit.counted = true;
            }
        } else if (t.setAt === null) {
            result = { code: 'set', values: {}, tone: 'neutral' };
        } else if (hit?.foot && !matches) {
            result = {
                code: 'motion',
                values: { other: !!hit.motionId, downward: lesson.prehold },
                tone: 'retry',
            };
        } else if (downward && hit.crossed) {
            result = { code: 'out', values: { reason }, tone: 'retry' };
        } else if (downward) {
            result = { code: 'net', values: {}, tone: 'retry' };
        } else if (hit?.foot) {
            result = { code: 'angle', values: {}, tone: 'retry' };
        } else if (hit) {
            result = { code: 'body', values: { shin: /^lowerLeg/.test(hit.part) }, tone: 'retry' };
        } else if (t.jumpAt === null) {
            result = { code: 'jump', values: {}, tone: 'retry' };
        } else if (t.kickAt === null) {
            result = { code: 'kick', values: { downward: lesson.prehold }, tone: 'retry' };
        } else {
            result = {
                code: 'miss',
                values: { prehold: lesson.prehold && t.kickAt >= t.jumpAt },
                tone: 'retry',
            };
        }
        t.result = {
            ...result,
            reason,
            entry: hit?.entry || t.entry,
            motionId: hit?.motionId || t.motionId,
            contact: hit?.part || null,
            jumpOffset: t.jumpOffset,
            kickOffset: t.kickOffset,
        };
    }
}

export {
    TAKRAW_TRAINING_LESSONS,
    TAKRAW_TRAINING_TEMPOS,
    TakrawTrainingDrill,
    takrawTrainingLesson,
};
