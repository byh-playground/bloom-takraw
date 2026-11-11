/**
 * 선수·편성·경제·영속 상태의 단일 소유자. 경기 물리 상태는 저장하지 않는다.
 * 규칙·프리셋의 이름은 TextPair이고, 상태 문구(message)와 오류는 코드 + 값이다. 문구는 화면(presentation/club-text.js)이 언어별로 만든다(docs/i18n.md).
 */
// TOBE(learning) 학습 비용: `learning.cost`는 능력치 훈련과 같은 trainingPoints를 쓴다. 학습이 경기에 도움이 되는 것으로 확인되면 별도 포인트 분리 여부를 결정한다(docs/learning-tobe.md ⑥).
import { takrawGenerateCard, takrawCardTag } from './generator.js';
import { TAKRAW_NAMES } from './names.js';
import {
    TAKRAW_SCHOOLS,
    takrawOpponents,
    takrawPickHome,
    takrawSchool,
} from '../config/schools.js';

const TAKRAW_CLUB_RULES = Object.freeze({
    initial: { credits: 600, trainingPoints: 6 },
    capacity: 9,
    nameLength: 18,
    training: { cost: 1, growth: 0.033, exponent: 1.5 },
    // 선수 뽑기: 1회 cost(C)로 weights 비율의 등급을 뽑고, presetShare 확률로 프리셋 카드(없으면 생성)에서 고른다.
    // 선수단이 가득 차 합류하지 못하면 refund(P)로 환급하거나 후보와 교체한다.
    draw: {
        cost: 300,
        weights: { common: 70, rare: 25, hero: 5 },
        refund: { common: 1, rare: 2, hero: 5 },
        presetShare: 0.4,
    },
    // 후보 선수를 팔면 등급별 환급(draw.refund)에 쌓은 훈련 레벨 × levelRefund를 더해 훈련 포인트로 돌려받는다. 선수단은 minRoster명 밑으로 줄일 수 없다.
    sell: { minRoster: 3, levelRefund: 1 },
    rarities: [
        { id: 'common', name: { ko: '일반', en: 'Common' } },
        { id: 'rare', name: { ko: '희귀', en: 'Rare' } },
        { id: 'hero', name: { ko: '영웅', en: 'Hero' } },
    ],
    // 생성 선수: base에서 0~rest만큼 흩어지고, peaks개의 능력치가 range 안으로 솟는다. 역할의 핵심 능력치(focus)부터 솟는다.
    generation: {
        base: 50,
        rarity: {
            common: { peaks: 2, range: [68, 78], rest: 12 },
            rare: { peaks: 3, range: [76, 86], rest: 16 },
            hero: { peaks: 4, range: [84, 94], rest: 20 },
        },
        focus: {
            receiver: ['defense', 'recovery', 'mobility'],
            setter: ['setting', 'flexibility', 'mobility'],
            attacker: ['power', 'jump', 'flexibility'],
        },
        // 생성 선수의 특징은 저장하지 않고 원래 능력치 상위 두 개의 문구로 그때 만든다(generator.js takrawCardTag).
        phrases: {
            mobility: { ko: '빠른 발', en: 'Quick feet' },
            jump: { ko: '높은 점프', en: 'High jump' },
            power: { ko: '강한 타격', en: 'Hard hitter' },
            flexibility: { ko: '유연한 공중 제어', en: 'Agile in the air' },
            setting: { ko: '정교한 토스', en: 'Precise sets' },
            defense: { ko: '든든한 수비', en: 'Solid defense' },
            recovery: { ko: '빠른 회복', en: 'Fast recovery' },
        },
    },
    learning: { cost: 1, epochs: 100, policyLength: 1024 },
    rewards: {
        win: { credits: 180, trainingPoints: 3 },
        loss: { credits: 100, trainingPoints: 2 },
    },
    roles: [
        { id: 'receiver', name: { ko: '리시버', en: 'Receiver' } },
        { id: 'setter', name: { ko: '세터', en: 'Setter' } },
        { id: 'attacker', name: { ko: '공격수', en: 'Attacker' } },
    ],
    stats: [
        {
            id: 'mobility',
            name: { ko: '기동력', en: 'Mobility' },
            radar: true,
            effect: { ko: '지상 이동 속도·가속', en: 'Ground speed and acceleration' },
        },
        {
            id: 'jump',
            name: { ko: '도약', en: 'Jump' },
            radar: true,
            effect: { ko: '점프 시작 속도', en: 'Take-off speed' },
        },
        {
            id: 'power',
            name: { ko: '타격', en: 'Power' },
            radar: true,
            effect: { ko: '발등 근접 타격의 힘 상한', en: 'Maximum force of close instep strikes' },
        },
        {
            id: 'flexibility',
            name: { ko: '공중 제어', en: 'Air control' },
            radar: true,
            effect: {
                ko: '공중 이동 입력의 가속',
                en: 'Acceleration from movement input in the air',
            },
        },
        {
            id: 'setting',
            name: { ko: '토스', en: 'Setting' },
            radar: true,
            effect: { ko: '지상 발차기의 힘 상한', en: 'Maximum force of ground kicks' },
        },
        {
            id: 'defense',
            name: { ko: '수비', en: 'Defense' },
            radar: true,
            effect: {
                ko: '리시브 충격에 따른 자세 흔들림 감소',
                en: 'Less wobble when receiving a hard ball',
            },
        },
        {
            id: 'recovery',
            name: { ko: '회복', en: 'Recovery' },
            radar: true,
            effect: { ko: '넘어진 뒤 일어나는 자세 구동', en: 'Getting back up after a fall' },
        },
    ],
});

/** 훈련 레벨 하나가 모든 능력치에 곱하는 배율. 첫 레벨은 약 5%, 레벨이 오를수록 증가율이 완만히 줄고, 상한은 없다. */
const takrawTrainingFactor = (level, rule = TAKRAW_CLUB_RULES.training) =>
    (1 + rule.growth * level) ** rule.exponent;

const takrawClubStats = (values) =>
    Object.fromEntries(TAKRAW_CLUB_RULES.stats.map((stat) => [stat.id, values[stat.id] ?? 50]));
const TAKRAW_CLUB_PLAYERS = Object.freeze([
    {
        id: 'han-gyeol',
        starter: true,
        rarity: 'common',
        name: TAKRAW_NAMES.get('한결'),
        tag: { ko: '든든한 수비', en: 'Solid defense' },
        preferredRole: 'receiver',
        stats: takrawClubStats({ defense: 74, recovery: 68 }),
    },
    {
        id: 'yun-seo',
        starter: true,
        rarity: 'common',
        name: TAKRAW_NAMES.get('윤서'),
        tag: { ko: '차분한 연결', en: 'Calm link-up' },
        preferredRole: 'setter',
        stats: takrawClubStats({ defense: 58, recovery: 62 }),
    },
    {
        id: 'i-deun',
        starter: true,
        rarity: 'common',
        name: TAKRAW_NAMES.get('이든'),
        tag: { ko: '균형 잡힌 공격', en: 'Balanced attack' },
        preferredRole: 'attacker',
        stats: takrawClubStats({}),
    },
    {
        id: 'ha-rin',
        rarity: 'common',
        name: TAKRAW_NAMES.get('하린'),
        tag: { ko: '빠른 공간 커버', en: 'Quick court coverage' },
        preferredRole: 'attacker',
        stats: takrawClubStats({ mobility: 84, flexibility: 78, defense: 58, recovery: 60 }),
    },
    {
        id: 'do-yun',
        rarity: 'common',
        name: TAKRAW_NAMES.get('도윤'),
        tag: { ko: '높은 타점', en: 'High contact point' },
        preferredRole: 'attacker',
        stats: takrawClubStats({ mobility: 54, jump: 78, power: 78, defense: 52, recovery: 56 }),
    },
    {
        id: 'si-on',
        rarity: 'common',
        name: TAKRAW_NAMES.get('시온'),
        tag: { ko: '힘 있는 토스', en: 'Powerful sets' },
        preferredRole: 'setter',
        stats: takrawClubStats({ mobility: 62, setting: 84, defense: 72, recovery: 62 }),
    },
    {
        id: 'na-rae',
        name: TAKRAW_NAMES.get('나래'),
        tag: { ko: '넓은 수비 범위', en: 'Wide defensive range' },
        preferredRole: 'receiver',
        rarity: 'rare',
        stats: takrawClubStats({
            mobility: 76,
            flexibility: 62,
            setting: 54,
            defense: 88,
            recovery: 78,
        }),
    },
    {
        id: 'tae-o',
        name: TAKRAW_NAMES.get('태오'),
        tag: { ko: '강력한 공중 타격', en: 'Powerful air strikes' },
        preferredRole: 'attacker',
        rarity: 'hero',
        stats: takrawClubStats({
            mobility: 58,
            jump: 86,
            power: 86,
            flexibility: 72,
            recovery: 58,
        }),
    },
    {
        id: 'ra-on',
        name: TAKRAW_NAMES.get('라온'),
        tag: { ko: '빠른 세팅', en: 'Quick setting' },
        preferredRole: 'setter',
        rarity: 'rare',
        stats: takrawClubStats({
            mobility: 74,
            flexibility: 58,
            setting: 88,
            defense: 70,
            recovery: 72,
        }),
    },
]);

/** 상태 문구·오류의 값. id는 presentation/club-text.js의 키다. */
const clubMessage = (id, values = {}) => Object.freeze({ id, values: Object.freeze(values) });

/** 0 이상 1 미만의 난수 하나(내 학교 추첨용). 경기 시뮬레이션과 무관하다. */
function takrawRandomUnit() {
    const crypto = globalThis.crypto;
    return crypto?.getRandomValues
        ? crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296
        : Math.random();
}

class TakrawClub {
    /**
     * openSave(options)는 저장 모듈의 createSave에 저장소 어댑터를 붙여 save를 연다. 어댑터는 호출한 쪽이 고른다(실제 저장 또는 디버그 메모리).
     * defaultName은 새 팀의 이름이다. 저장되는 문자열이라 처음 저장할 때의 페이지 언어로 정해진다.
     */
    constructor({ onChange = null, openSave = null, random = takrawRandomUnit, defaultName } = {}) {
        if (typeof defaultName !== 'string' || !defaultName)
            throw new TypeError('defaultName 필요');
        this.random = random;
        this.openSave = openSave;
        this.save = null;
        this.onChange = onChange;
        this.record = null;
        this.defaultName = defaultName;
        this.status = 'loading';
        this.message = clubMessage('loading');
        this.disposed = false;
        this.pending = Promise.resolve();
        this.stopExternal = null;
        this.metrics = { reads: 0, writes: 0, bytes: 0 };
    }

    _notify() {
        if (!this.disposed) this.onChange?.(this.getView());
    }
    /** 오류의 code·values는 화면 문구의 키와 값이고, message는 개발용으로 code를 그대로 둔다. */
    _error(code, kind = 'validation', values = {}) {
        const error = new Error(code);
        error.kind = kind;
        error.code = code;
        error.values = values;
        return error;
    }
    _normalizeName(value) {
        return String(value ?? '')
            .replace(/\s+/gu, ' ')
            .trim();
    }
    _default() {
        return {
            name: this.defaultName,
            ...TAKRAW_CLUB_RULES.initial,
            owned: TAKRAW_CLUB_PLAYERS.filter((player) => player.starter).map(
                (player) => player.id,
            ),
            trained: {},
            levels: {},
            cards: {},
            pending: null,
            gacha: { runs: 0 },
            lineup: { receiver: 'han-gyeol', setter: 'yun-seo', attacker: 'i-deun' },
            record: { played: 0, won: 0, lost: 0 },
            rewards: [],
            lastReward: null,
            learning: { runs: 0, policy: null },
            campaign: { home: takrawPickHome(this.random()), cleared: [] },
        };
    }

    _validate(record) {
        const fail = () => {
            throw this._error('unreadable', 'storage');
        };
        const integer = (value) => Number.isSafeInteger(value) && value >= 0;
        if (
            !record ||
            typeof record.name !== 'string' ||
            this._normalizeName(record.name) !== record.name ||
            [...record.name].length < 1 ||
            [...record.name].length > TAKRAW_CLUB_RULES.nameLength ||
            !integer(record.credits) ||
            !integer(record.trainingPoints) ||
            !Array.isArray(record.owned) ||
            record.owned.length < 3 ||
            record.owned.length > TAKRAW_CLUB_RULES.capacity ||
            new Set(record.owned).size !== record.owned.length ||
            record.owned.some((id) => !this._known(record, id)) ||
            !record.lineup ||
            new Set(Object.values(record.lineup)).size !== 3 ||
            Object.keys(record.lineup).length !== 3 ||
            TAKRAW_CLUB_RULES.roles.some(
                (role) => !record.owned.includes(record.lineup[role.id]),
            ) ||
            !record.trained ||
            typeof record.trained !== 'object' ||
            Array.isArray(record.trained) ||
            !record.record ||
            !['played', 'won', 'lost'].every((key) => integer(record.record[key])) ||
            record.record.played !== record.record.won + record.record.lost ||
            !Array.isArray(record.rewards) ||
            record.rewards.length !== record.record.played ||
            new Set(record.rewards).size !== record.rewards.length ||
            record.rewards.some((id) => typeof id !== 'string' || !/^[a-f\d]{32}$/.test(id))
        )
            fail();
        // 선택 필드: 이전 저장본에는 없다. 있으면 형식을 엄격히 확인한다.
        if (record.learning !== undefined) {
            const learning = record.learning,
                policy = learning?.policy;
            if (
                !learning ||
                typeof learning !== 'object' ||
                !integer(learning.runs) ||
                !(
                    policy === null ||
                    (typeof policy === 'string' &&
                        policy.length <= TAKRAW_CLUB_RULES.learning.policyLength &&
                        /^[A-Za-z\d+/]+={0,2}$/.test(policy))
                ) ||
                (policy === null) !== (learning.runs === 0)
            )
                fail();
        }
        if (record.campaign !== undefined) {
            const campaign = record.campaign,
                keys =
                    campaign && typeof campaign === 'object' && !Array.isArray(campaign)
                        ? Object.keys(campaign)
                        : [];
            // 내 학교(home)가 없는 이전 저장본은 읽을 수 있고, 불러올 때 한 번 학교를 정해 바꾼다(_read).
            // introSeen(도장깨기 첫 소개를 봤는지)은 있어도 없어도 되는 값이라 키 개수에서 뺀다.
            const base = keys.filter((key) => key !== 'introSeen');
            if (keys.includes('introSeen') && typeof campaign.introSeen !== 'boolean') fail();
            const legacy = base.length === 1 && base[0] === 'cleared';
            if (
                !(
                    legacy ||
                    (base.length === 2 &&
                        Object.hasOwn(campaign, 'home') &&
                        Object.hasOwn(campaign, 'cleared'))
                ) ||
                !Array.isArray(campaign.cleared)
            )
                fail();
            if (legacy) {
                if (
                    campaign.cleared.length > TAKRAW_SCHOOLS.length ||
                    Array.from(campaign.cleared).some(
                        (id, index) => id !== TAKRAW_SCHOOLS[index].id,
                    )
                )
                    fail();
            } else {
                const list = takrawSchool(campaign.home) ? takrawOpponents(campaign.home) : null;
                if (
                    !list ||
                    campaign.cleared.length > list.length ||
                    Array.from(campaign.cleared).some((id, index) => id !== list[index].id)
                )
                    fail();
            }
        }
        if (record.cards !== undefined) {
            const cards = record.cards,
                stats = TAKRAW_CLUB_RULES.stats.map((stat) => stat.id);
            const validCard = (id, card) =>
                card &&
                typeof card === 'object' &&
                card.id === id &&
                /^gen-\d+$/.test(id) &&
                typeof card.name === 'string' &&
                TAKRAW_NAMES.has(card.name) &&
                TAKRAW_CLUB_RULES.roles.some((role) => role.id === card.preferredRole) &&
                TAKRAW_CLUB_RULES.rarities.some((rarity) => rarity.id === card.rarity) &&
                Number.isSafeInteger(card.number) &&
                card.number >= 0 &&
                card.number <= 99 &&
                card.stats &&
                typeof card.stats === 'object' &&
                Object.keys(card.stats).length === stats.length &&
                stats.every(
                    (key) =>
                        Number.isSafeInteger(card.stats[key]) &&
                        card.stats[key] >= 0 &&
                        card.stats[key] <= 100,
                );
            if (
                !cards ||
                typeof cards !== 'object' ||
                Array.isArray(cards) ||
                Object.entries(cards).some(
                    ([id, card]) =>
                        !validCard(id, card) ||
                        !(record.owned.includes(id) || record.pending === id),
                )
            )
                fail();
        }
        if (
            record.pending !== undefined &&
            record.pending !== null &&
            (typeof record.pending !== 'string' ||
                !this._known(record, record.pending) ||
                record.owned.includes(record.pending))
        )
            fail();
        if (
            record.gacha !== undefined &&
            !(record.gacha && typeof record.gacha === 'object' && integer(record.gacha.runs))
        )
            fail();
        if (record.levels !== undefined) {
            const levels = record.levels;
            if (
                !levels ||
                typeof levels !== 'object' ||
                Array.isArray(levels) ||
                Object.entries(levels).some(
                    ([id, level]) =>
                        !record.owned.includes(id) || !Number.isSafeInteger(level) || level < 1,
                )
            )
                fail();
        }
        for (const [id, training] of Object.entries(record.trained)) {
            const player = TAKRAW_CLUB_PLAYERS.find((value) => value.id === id);
            if (
                !record.owned.includes(id) ||
                !player ||
                !training ||
                typeof training !== 'object' ||
                Array.isArray(training)
            )
                fail();
            for (const [stat, amount] of Object.entries(training))
                if (
                    !Object.hasOwn(player.stats, stat) ||
                    !integer(amount) ||
                    amount + player.stats[stat] > 100
                )
                    fail();
        }
        if (record.lastReward !== null) {
            const receipt = record.lastReward;
            if (
                !receipt ||
                !record.rewards.includes(receipt.id) ||
                typeof receipt.won !== 'boolean'
            )
                fail();
            const base = TAKRAW_CLUB_RULES.rewards[receipt.won ? 'win' : 'loss'];
            if (receipt.credits !== base.credits) fail();
            if (receipt.schoolId === undefined) {
                if (receipt.trainingPoints !== base.trainingPoints) fail();
            } else {
                const index = (
                    record.campaign?.home ? takrawOpponents(record.campaign.home) : TAKRAW_SCHOOLS
                ).findIndex((school) => school.id === receipt.schoolId);
                // 영수증의 과거 금액은 임시 보상값 변경 뒤에도 읽는다. 지급 판정은 cleared뿐이다.
                if (
                    index < 0 ||
                    !integer(receipt.trainingPoints) ||
                    (!receipt.won && receipt.trainingPoints !== 0) ||
                    !record.campaign ||
                    index > record.campaign.cleared.length ||
                    (receipt.won && !record.campaign.cleared.includes(receipt.schoolId))
                )
                    fail();
            }
        }
        return record;
    }

    /** 저장 모듈의 실패를 화면 문구 코드로 옮긴다. 게임 규칙 오류(kind 'validation')는 자기 코드를 그대로 쓴다. */
    _saveMessage(error) {
        const id = {
            conflict: 'conflict',
            unreadable: 'unreadable',
            storage: /quota/i.test(error.message) ? 'quota' : 'storage',
            closed: 'closed',
        }[error.kind];
        return id ? clubMessage(id) : error.code ? clubMessage(error.code, error.values) : null;
    }

    _open() {
        if (this.save) return this.save;
        if (!this.openSave) throw this._error('noStorage', 'storage');
        this.save = this.openSave({
            key: 'my-team',
            version: 1,
            create: () => this._default(),
            validate: (record) => this._validate(record),
        });
        this.stopExternal = this.save.onExternalChange(() => {
            if (this.disposed) return;
            this.status = 'conflict';
            this.message = this._saveMessage({ kind: 'conflict' });
            this._notify();
        });
        return this.save;
    }

    _commit(data, changed, message) {
        this.record = data;
        this.status = 'ready';
        this.message = message;
        this.metrics.bytes = new TextEncoder().encode(JSON.stringify(data)).length;
        this._notify();
        return { changed, view: this.getView() };
    }

    _queue(operation) {
        const run = this.pending.then(async () => {
            if (this.disposed) throw this._error('closed', 'storage');
            try {
                return await operation();
            } catch (error) {
                this.status =
                    error.kind === 'conflict'
                        ? 'conflict'
                        : error.kind === 'validation' && this.record
                          ? 'ready'
                          : 'error';
                this.message = this._saveMessage(error) || clubMessage('saveFailed');
                this._notify();
                throw error;
            }
        });
        this.pending = run.catch(() => {});
        return run;
    }

    /** 저장을 읽는다. 내 학교(home)가 없는 이전 저장본은 이때 한 번 학교를 정하고, 단계 구성이 바뀌어 도전 기록과 영수증을 새로 시작한다. */
    async _read(message) {
        const save = this._open();
        this.metrics.reads++;
        let data = await save.load();
        if (!data.campaign?.home) {
            data = await save.update((next) => {
                next.campaign = { home: takrawPickHome(this.random()), cleared: [] };
                next.lastReward = null;
            });
            this.metrics.writes++;
        }
        return this._commit(data, false, message);
    }

    load() {
        return this._queue(async () => {
            this.status = 'loading';
            this.message = clubMessage('loading');
            this._notify();
            return this._read(clubMessage('loaded'));
        });
    }

    refresh() {
        return this._queue(async () => {
            this.status = 'loading';
            this.message = clubMessage('refreshing');
            this._notify();
            return this._read(clubMessage('refreshed'));
        });
    }

    _mutate(mutate, message) {
        return this._queue(async () => {
            if (!this.record || this.status !== 'ready')
                throw this._error('loadFirst', this.status === 'conflict' ? 'conflict' : 'storage');
            this.status = 'saving';
            this.message = clubMessage('saving');
            this._notify();
            let changed = true;
            const data = await this.save.update((record) => {
                changed = mutate(record) !== false;
                return changed;
            });
            if (changed) this.metrics.writes++;
            return this._commit(data, changed, message);
        });
    }

    rename(value) {
        const name = this._normalizeName(value);
        return this._mutate((record) => {
            if ([...name].length < 1 || [...name].length > TAKRAW_CLUB_RULES.nameLength)
                throw this._error('nameLength', 'validation', {
                    max: TAKRAW_CLUB_RULES.nameLength,
                });
            if (name === record.name) return false;
            record.name = name;
        }, clubMessage('renamed'));
    }

    assign(role, playerId) {
        return this._mutate((record) => {
            if (
                !TAKRAW_CLUB_RULES.roles.some((value) => value.id === role) ||
                !record.owned.includes(playerId)
            )
                throw this._error('assignInvalid');
            const previousRole = TAKRAW_CLUB_RULES.roles.find(
                (value) => record.lineup[value.id] === playerId,
            )?.id;
            if (previousRole === role) return false;
            if (previousRole) record.lineup[previousRole] = record.lineup[role];
            record.lineup[role] = playerId;
        }, clubMessage('assigned'));
    }

    /** 훈련 포인트 1개로 선수의 훈련 레벨을 한 단계 올린다. 모든 능력치가 함께 오른다. */
    train(playerId) {
        return this._mutate((record) => {
            const rule = TAKRAW_CLUB_RULES.training;
            if (!record.owned.includes(playerId)) throw this._error('trainInvalid');
            if (record.trainingPoints < rule.cost) throw this._error('pointsShort');
            record.levels ??= {};
            record.levels[playerId] = (record.levels[playerId] || 0) + 1;
            record.trainingPoints -= rule.cost;
        }, clubMessage('trained'));
    }

    /** 저장된 카드 또는 프리셋 선수 하나. 생성 선수는 저장 기록의 cards에만 있다. */
    _card(id) {
        return TAKRAW_CLUB_PLAYERS.find((value) => value.id === id) ?? this.record?.cards?.[id];
    }
    _known(record, id) {
        return TAKRAW_CLUB_PLAYERS.some((value) => value.id === id) || !!record.cards?.[id];
    }

    _rollRarity() {
        const weights = Object.entries(TAKRAW_CLUB_RULES.draw.weights),
            total = weights.reduce((sum, [, weight]) => sum + weight, 0);
        let roll = this.random() * total;
        for (const [rarity, weight] of weights) {
            if ((roll -= weight) < 0) return rarity;
        }
        return weights[weights.length - 1][0];
    }

    /**
     * 코인 1회분으로 선수를 뽑는다. 결과는 이 저장 한 번에 확정되므로 연출 도중 새로고침해도 되돌릴 수 없다.
     * 선수단에 자리가 있으면 바로 합류하고, 가득 차면 pending으로 남겨 resolveDraw가 정리할 때까지 다음 뽑기를 막는다.
     */
    async draw() {
        const rules = TAKRAW_CLUB_RULES,
            rule = rules.draw;
        let drawn = null;
        const result = await this._mutate((record) => {
            if (record.pending) throw this._error('drawPending');
            if (record.credits < rule.cost)
                throw this._error('creditsShort', 'validation', {
                    short: rule.cost - record.credits,
                });
            const rarity = this._rollRarity();
            const presets = TAKRAW_CLUB_PLAYERS.filter(
                (player) =>
                    !player.starter &&
                    player.rarity === rarity &&
                    !record.owned.includes(player.id),
            );
            record.gacha ??= { runs: 0 };
            record.cards ??= {};
            let id;
            if (presets.length && this.random() < rule.presetShare)
                id = presets[Math.floor(this.random() * presets.length)].id;
            else {
                id = `gen-${record.gacha.runs + 1}`;
                // 이름 겹침은 생성 카드의 저장 문자열과 프리셋 이름의 ko로 비교한다.
                const names = record.owned.map((owned) => {
                    const player = TAKRAW_CLUB_PLAYERS.find((value) => value.id === owned);
                    return player ? player.name.ko : record.cards[owned]?.name;
                });
                const numbers = Object.values(record.cards).map((card) => card.number);
                record.cards[id] = takrawGenerateCard({
                    id,
                    rarity,
                    random: this.random,
                    rules,
                    takenNames: names,
                    takenNumbers: numbers,
                });
            }
            record.gacha.runs++;
            record.credits -= rule.cost;
            const joined = record.owned.length < rules.capacity;
            if (joined) record.owned.push(id);
            else record.pending = id;
            drawn = { id, rarity, joined };
        }, clubMessage('drawn'));
        return { ...result, drawn };
    }

    /** 도장깨기 첫 소개를 봤다고 저장한다. 이미 봤으면 그대로 둔다. */
    seeCampaignIntro() {
        return this._mutate((record) => {
            if (!record.campaign?.home) throw this._error('loadFirst');
            record.campaign.introSeen = true;
        }, clubMessage('campaignIntroSeen'));
    }

    /** 선수 한 명을 팔았을 때 받는 훈련 포인트: 등급 환급 + 쌓은 훈련 레벨. */
    _sellValue(record, id) {
        const rules = TAKRAW_CLUB_RULES,
            rarity = this._card(id)?.rarity ?? 'common';
        return rules.draw.refund[rarity] + (record.levels?.[id] || 0) * rules.sell.levelRefund;
    }

    /** 후보 선수를 팔아 훈련 포인트로 바꾼다. 출전 선수는 팔 수 없고, 선수단은 최소 인원 밑으로 줄지 않는다. */
    sell(playerId) {
        let value = 0;
        return this._mutate((record) => {
            const rules = TAKRAW_CLUB_RULES;
            if (!record.owned.includes(playerId)) throw this._error('sellInvalid');
            if (Object.values(record.lineup).includes(playerId)) throw this._error('sellStarter');
            if (record.owned.length <= rules.sell.minRoster)
                throw this._error('minRoster', 'validation', { min: rules.sell.minRoster });
            value = this._sellValue(record, playerId);
            record.trainingPoints += value;
            record.owned.splice(record.owned.indexOf(playerId), 1);
            delete record.cards?.[playerId];
            delete record.trained[playerId];
            delete record.levels?.[playerId];
        }, clubMessage('sold')).then((result) => ({ ...result, sold: value }));
    }

    /** 가득 차서 남겨 둔 뽑기 결과를 정리한다. release가 있으면 그 후보와 교체하고, 없으면 환급 포인트를 받는다. */
    resolveDraw({ release = null } = {}) {
        return this._mutate(
            (record) => {
                const rules = TAKRAW_CLUB_RULES,
                    id = record.pending;
                if (!id) throw this._error('noPending');
                const card = this._card(id);
                const drop = (playerId) => {
                    // 생성 선수는 카드째 지우고 훈련 기록도 함께 정리한다.
                    delete record.cards?.[playerId];
                    delete record.trained[playerId];
                    delete record.levels?.[playerId];
                };
                if (release === null) {
                    record.trainingPoints += rules.draw.refund[card.rarity];
                    drop(id);
                } else {
                    if (
                        !record.owned.includes(release) ||
                        Object.values(record.lineup).includes(release)
                    )
                        throw this._error('releaseInvalid');
                    record.owned.splice(record.owned.indexOf(release), 1);
                    drop(release);
                    record.owned.push(id);
                }
                record.pending = null;
            },
            clubMessage(release === null ? 'refunded' : 'replaced'),
        );
    }

    rewardMatch({ id, won, mode, schoolId = null } = {}) {
        if (
            mode !== 'match' ||
            typeof won !== 'boolean' ||
            typeof id !== 'string' ||
            !/^[a-f\d]{32}$/.test(id)
        )
            return Promise.reject(this._error('rewardInvalid'));
        if (this.record?.rewards.includes(id))
            return Promise.resolve({ changed: false, view: this.getView() });
        return this._mutate((record) => {
            if (record.rewards.includes(id)) return false;
            const baseReward = TAKRAW_CLUB_RULES.rewards[won ? 'win' : 'loss'];
            let trainingPoints = baseReward.trainingPoints;
            if (schoolId !== null) {
                const campaign = record.campaign,
                    opponents = campaign?.home ? takrawOpponents(campaign.home) : [],
                    schoolIndex = opponents.findIndex((school) => school.id === schoolId);
                if (schoolIndex < 0) throw this._error('schoolInvalid');
                trainingPoints = 0;
                if (schoolIndex > campaign.cleared.length) throw this._error('schoolLocked');
                if (won && schoolIndex === campaign.cleared.length) {
                    trainingPoints = opponents[schoolIndex].firstClearTrainingPoints;
                    campaign.cleared.push(schoolId);
                }
            }
            const reward = { ...baseReward, trainingPoints };
            record.credits += reward.credits;
            record.trainingPoints += reward.trainingPoints;
            record.record.played++;
            record.record[won ? 'won' : 'lost']++;
            record.rewards.push(id);
            record.lastReward = { id, won, ...reward, ...(schoolId === null ? {} : { schoolId }) };
        }, clubMessage('rewarded'));
    }

    /** 훈련 포인트 1개로 받기 학습 한 번(100 epoch)을 마친 정책을 저장한다. policy는 양자화한 정책의 base64다. */
    learn(policy) {
        const rule = TAKRAW_CLUB_RULES.learning;
        if (
            typeof policy !== 'string' ||
            !policy ||
            policy.length > rule.policyLength ||
            !/^[A-Za-z\d+/]+={0,2}$/.test(policy)
        )
            return Promise.reject(this._error('policyInvalid'));
        return this._mutate((record) => {
            if (record.trainingPoints < rule.cost) throw this._error('pointsShort');
            record.trainingPoints -= rule.cost;
            const learning = record.learning ?? { runs: 0, policy: null };
            record.learning = { runs: learning.runs + 1, policy };
        }, clubMessage('learned'));
    }

    /** 저장된 학습 정책(base64)과 누적 학습 횟수. 학습한 적이 없으면 null이다. */
    learnedPolicy() {
        const learning = this.record?.learning;
        return learning?.policy ? { policy: learning.policy, runs: learning.runs } : null;
    }

    /** 저장 기록과 무관하게 프리셋 선수 하나를 화면용으로 만든다(소개영상의 뽑기 연출). */
    preview(id) {
        return this._player(id);
    }

    /** 화면용 선수. name·tag는 TextPair다. 생성 카드는 저장한 ko 이름으로 짝을 찾고, 특징은 원래 능력치로 만든다. */
    _player(id) {
        const card = this._card(id),
            generated = typeof card.name === 'string';
        const base = generated
                ? {
                      ...card,
                      name: TAKRAW_NAMES.get(card.name),
                      tag: takrawCardTag(card.stats, TAKRAW_CLUB_RULES),
                  }
                : card,
            number = base.number ?? TAKRAW_CLUB_PLAYERS.findIndex((value) => value.id === id) + 1;
        const level = this.record?.levels?.[id] || 0,
            factor = takrawTrainingFactor(level);
        return {
            ...base,
            number,
            level,
            sellValue: this.record ? this._sellValue(this.record, id) : 0,
            stats: Object.fromEntries(
                Object.entries(base.stats).map(([key, value]) => [
                    key,
                    Math.round((value + (this.record?.trained[id]?.[key] || 0)) * factor),
                ]),
            ),
            role:
                TAKRAW_CLUB_RULES.roles.find((role) => this.record?.lineup[role.id] === id)?.id ||
                null,
        };
    }

    getView() {
        const record = this.record;
        return {
            status: this.status,
            message: this.message,
            teamName: record?.name || '',
            credits: record?.credits || 0,
            trainingPoints: record?.trainingPoints || 0,
            roster: record ? record.owned.map((id) => this._player(id)) : [],
            lineup: { ...record?.lineup },
            draw: {
                ...TAKRAW_CLUB_RULES.draw,
                runs: record?.gacha?.runs || 0,
                pending: record?.pending ? this._player(record.pending) : null,
            },
            record: record ? { ...record.record } : { played: 0, won: 0, lost: 0 },
            learning: { runs: record?.learning?.runs || 0 },
            lastReward: record?.lastReward ? { ...record.lastReward } : null,
            campaign: {
                home: record?.campaign?.home || null,
                cleared: [...(record?.campaign?.cleared || [])],
                introSeen: !!record?.campaign?.introSeen,
            },
            revision: this.save?.revision ?? null,
        };
    }

    matchTeam() {
        if (!this.record) return null;
        return {
            name: this.record.name,
            players: TAKRAW_CLUB_RULES.roles.map(({ id: role }) => {
                const player = this._player(this.record.lineup[role]);
                return { id: player.id, name: player.name, role, stats: { ...player.stats } };
            }),
        };
    }

    /** 디버그 장면이 저장 바깥에서 값을 고친다(확인용 주소 전용). */
    debugMutate(mutate) {
        return this._mutate(mutate, clubMessage('debugChanged'));
    }

    diagnostics() {
        return {
            status: this.status,
            revision: this.save?.revision ?? null,
            ...this.metrics,
            bytesMeaning:
                '저장 레코드 JSON UTF-8 크기 추정값. IndexedDB 실제 디스크 사용량과 다릅니다.',
        };
    }
    dispose() {
        this.disposed = true;
        this.stopExternal?.();
        this.save?.dispose();
        this.save = null;
        this.onChange = null;
    }
}

export { TAKRAW_CLUB_RULES, TAKRAW_CLUB_PLAYERS, TakrawClub, takrawTrainingFactor };
