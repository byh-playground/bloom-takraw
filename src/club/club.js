/** 선수·편성·경제·영속 상태의 단일 소유자. 경기 물리 상태는 저장하지 않는다. */
// TOBE(learning) 학습 비용: `learning.cost`는 능력치 훈련과 같은 trainingPoints를 쓴다. 학습이 경기에 도움이 되는 것으로 확인되면 별도 포인트 분리 여부를 결정한다(docs/learning-tobe.md ⑥).
import { takrawGenerateCard } from './generator.js';
import { TAKRAW_SCHOOLS, takrawOpponents, takrawPickHome, takrawSchool } from '../config/schools.js';

const TAKRAW_CLUB_RULES = Object.freeze({
  initial: { credits: 600, trainingPoints: 6 },
  capacity: 9, nameLength: 18, training: { cost: 1, growth: 0.033, exponent: 1.5 },
  // 선수 뽑기: 1회 cost(C)로 weights 비율의 등급을 뽑고, presetShare 확률로 프리셋 카드(없으면 생성)에서 고른다.
  // 선수단이 가득 차 합류하지 못하면 refund(P)로 환급하거나 후보와 교체한다.
  draw: { cost: 300, weights: { common: 70, rare: 25, hero: 5 }, refund: { common: 1, rare: 2, hero: 5 }, presetShare: 0.4 },
  // 후보 선수를 팔면 등급별 환급(draw.refund)에 쌓은 훈련 레벨 × levelRefund를 더해 훈련 포인트로 돌려받는다. 선수단은 minRoster명 밑으로 줄일 수 없다.
  sell: { minRoster: 3, levelRefund: 1 },
  rarities: [{ id: 'common', name: '일반' }, { id: 'rare', name: '희귀' }, { id: 'hero', name: '영웅' }],
  // 생성 선수: base에서 0~rest만큼 흩어지고, peaks개의 능력치가 range 안으로 솟는다. 역할의 핵심 능력치(focus)부터 솟는다.
  generation: { base: 50,
    rarity: { common: { peaks: 2, range: [68, 78], rest: 12 }, rare: { peaks: 3, range: [76, 86], rest: 16 }, hero: { peaks: 4, range: [84, 94], rest: 20 } },
    focus: { receiver: ['defense', 'recovery', 'mobility'], setter: ['setting', 'flexibility', 'mobility'], attacker: ['power', 'jump', 'flexibility'] },
    phrases: { mobility: '빠른 발', jump: '높은 점프', power: '강한 타격', flexibility: '유연한 공중 제어', setting: '정교한 토스', defense: '든든한 수비', recovery: '빠른 회복' } }, learning: { cost: 1, epochs: 100, policyLength: 1024 },
  rewards: { win: { credits: 180, trainingPoints: 3 }, loss: { credits: 100, trainingPoints: 2 } },
  roles: [{ id: 'receiver', name: '리시버' }, { id: 'setter', name: '세터' }, { id: 'attacker', name: '공격수' }],
  stats: [
    { id: 'mobility', name: '기동력', radar: true, effect: '지상 이동 속도·가속' },
    { id: 'jump', name: '도약', radar: true, effect: '점프 시작 속도' },
    { id: 'power', name: '타격', radar: true, effect: '발등 근접 타격의 힘 상한' },
    { id: 'flexibility', name: '공중 제어', radar: true, effect: '공중 이동 입력의 가속' },
    { id: 'setting', name: '토스', radar: true, effect: '지상 발차기의 힘 상한' },
    { id: 'defense', name: '수비', radar: true, effect: '리시브 충격에 따른 자세 흔들림 감소' },
    { id: 'recovery', name: '회복', radar: true, effect: '넘어진 뒤 일어나는 자세 구동' },
  ],
});

/** 훈련 레벨 하나가 모든 능력치에 곱하는 배율. 첫 레벨은 약 5%, 레벨이 오를수록 증가율이 완만히 줄고, 상한은 없다. */
const takrawTrainingFactor = (level, rule = TAKRAW_CLUB_RULES.training) => (1 + rule.growth * level) ** rule.exponent;

const takrawClubStats = values => Object.fromEntries(TAKRAW_CLUB_RULES.stats.map(stat => [stat.id, values[stat.id] ?? 50]));
const TAKRAW_CLUB_PLAYERS = Object.freeze([
  { id: 'han-gyeol', starter: true, rarity: 'common', name: '한결', tag: '든든한 수비', preferredRole: 'receiver', stats: takrawClubStats({ defense: 74, recovery: 68 }) },
  { id: 'yun-seo', starter: true, rarity: 'common', name: '윤서', tag: '차분한 연결', preferredRole: 'setter', stats: takrawClubStats({ defense: 58, recovery: 62 }) },
  { id: 'i-deun', starter: true, rarity: 'common', name: '이든', tag: '균형 잡힌 공격', preferredRole: 'attacker', stats: takrawClubStats({}) },
  { id: 'ha-rin', rarity: 'common', name: '하린', tag: '빠른 공간 커버', preferredRole: 'attacker', stats: takrawClubStats({ mobility: 84, flexibility: 78, defense: 58, recovery: 60 }) },
  { id: 'do-yun', rarity: 'common', name: '도윤', tag: '높은 타점', preferredRole: 'attacker', stats: takrawClubStats({ mobility: 54, jump: 78, power: 78, defense: 52, recovery: 56 }) },
  { id: 'si-on', rarity: 'common', name: '시온', tag: '힘 있는 토스', preferredRole: 'setter', stats: takrawClubStats({ mobility: 62, setting: 84, defense: 72, recovery: 62 }) },
  { id: 'na-rae', name: '나래', tag: '넓은 수비 범위', preferredRole: 'receiver', rarity: 'rare', stats: takrawClubStats({ mobility: 76, flexibility: 62, setting: 54, defense: 88, recovery: 78 }) },
  { id: 'tae-o', name: '태오', tag: '강력한 공중 타격', preferredRole: 'attacker', rarity: 'hero', stats: takrawClubStats({ mobility: 58, jump: 86, power: 86, flexibility: 72, recovery: 58 }) },
  { id: 'ra-on', name: '라온', tag: '빠른 세팅', preferredRole: 'setter', rarity: 'rare', stats: takrawClubStats({ mobility: 74, flexibility: 58, setting: 88, defense: 70, recovery: 72 }) },
]);

/** 0 이상 1 미만의 난수 하나(내 학교 추첨용). 경기 시뮬레이션과 무관하다. */
function takrawRandomUnit() {
  const crypto = globalThis.crypto;
  return crypto?.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 : Math.random();
}

class TakrawClub {
  constructor({ onChange = null, indexedDB = globalThis.indexedDB, random = takrawRandomUnit } = {}) {
    this.random = random; this.storage = indexedDB; this.onChange = onChange; this.db = null; this.record = null;
    this.status = 'loading'; this.message = '팀을 불러오고 있어요.'; this.disposed = false;
    this.pending = Promise.resolve(); this.channel = null; this.externalRevision = -1;
    this.metrics = { reads: 0, writes: 0, bytes: 0, copyMs: 0, serializationMs: 0, restoreMs: 0, readMs: 0, writeMs: 0 };
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        this.channel = new BroadcastChannel('bloom-takraw-club');
        this.channel.onmessage = event => {
          if (!Number.isSafeInteger(event.data?.revision) || this.disposed) return;
          this.externalRevision = Math.max(this.externalRevision, event.data.revision);
          if (this.record && this.externalRevision > this.record.revision) {
            this.status = 'conflict'; this.message = '다른 탭에서 팀이 바뀌었어요. 최신 저장을 불러오세요.'; this._notify();
          }
        };
      }
    } catch { this.channel = null; }
  }

  _clock() { return globalThis.performance?.now() ?? Date.now(); }
  _copy(value) { const start = this._clock(); const copy = structuredClone(value); this.metrics.copyMs += this._clock() - start; return copy; }
  _notify() { if (!this.disposed) this.onChange?.(this.getView()); }
  _error(message, kind = 'validation') { const error = new Error(message); error.kind = kind; return error; }
  _normalizeName(value) { return String(value ?? '').replace(/\s+/gu, ' ').trim(); }
  _default() {
    return { schema: 1, revision: 0, name: '블룸 클럽', ...TAKRAW_CLUB_RULES.initial,
      owned: TAKRAW_CLUB_PLAYERS.filter(player => player.starter).map(player => player.id), trained: {}, levels: {}, cards: {}, pending: null, gacha: { runs: 0 },
      lineup: { receiver: 'han-gyeol', setter: 'yun-seo', attacker: 'i-deun' },
      record: { played: 0, won: 0, lost: 0 }, rewards: [], lastReward: null, learning: { runs: 0, policy: null }, campaign: { home: takrawPickHome(this.random()), cleared: [] } };
  }

  _validate(record) {
    const start = this._clock(), fail = () => { throw this._error('저장된 팀 형식을 확인할 수 없어요. 기존 데이터는 보존했어요.', 'storage'); };
    const integer = value => Number.isSafeInteger(value) && value >= 0;
    if (!record || record.schema !== 1 || !integer(record.revision) || typeof record.name !== 'string' ||
      this._normalizeName(record.name) !== record.name || [...record.name].length < 1 || [...record.name].length > TAKRAW_CLUB_RULES.nameLength ||
      !integer(record.credits) || !integer(record.trainingPoints) || !Array.isArray(record.owned) ||
      record.owned.length < 3 || record.owned.length > TAKRAW_CLUB_RULES.capacity || new Set(record.owned).size !== record.owned.length ||
      record.owned.some(id => !this._known(record, id)) ||
      !record.lineup || new Set(Object.values(record.lineup)).size !== 3 || Object.keys(record.lineup).length !== 3 ||
      TAKRAW_CLUB_RULES.roles.some(role => !record.owned.includes(record.lineup[role.id])) ||
      !record.trained || typeof record.trained !== 'object' || Array.isArray(record.trained) ||
      !record.record || !['played','won','lost'].every(key => integer(record.record[key])) || record.record.played !== record.record.won + record.record.lost ||
      !Array.isArray(record.rewards) || record.rewards.length !== record.record.played || new Set(record.rewards).size !== record.rewards.length ||
      record.rewards.some(id => typeof id !== 'string' || !/^[a-f\d]{32}$/.test(id))) fail();
    // 선택 필드: 이전 저장본에는 없다. 있으면 형식을 엄격히 확인한다.
    if (record.learning !== undefined) {
      const learning = record.learning, policy = learning?.policy;
      if (!learning || typeof learning !== 'object' || !integer(learning.runs) ||
        !(policy === null || (typeof policy === 'string' && policy.length <= TAKRAW_CLUB_RULES.learning.policyLength && /^[A-Za-z\d+/]+={0,2}$/.test(policy))) ||
        (policy === null) !== (learning.runs === 0)) fail();
    }
    if (record.campaign !== undefined) {
      const campaign = record.campaign, keys = campaign && typeof campaign === 'object' && !Array.isArray(campaign) ? Object.keys(campaign) : [];
      // 내 학교(home)가 없는 이전 저장본은 읽을 수 있고, 불러올 때 한 번 학교를 정해 바꾼다(_transaction).
      const legacy = keys.length === 1 && keys[0] === 'cleared';
      if (!(legacy || (keys.length === 2 && Object.hasOwn(campaign, 'home') && Object.hasOwn(campaign, 'cleared'))) || !Array.isArray(campaign.cleared)) fail();
      if (legacy) { if (campaign.cleared.length > TAKRAW_SCHOOLS.length || Array.from(campaign.cleared).some((id, index) => id !== TAKRAW_SCHOOLS[index].id)) fail(); }
      else {
        const list = takrawSchool(campaign.home) ? takrawOpponents(campaign.home) : null;
        if (!list || campaign.cleared.length > list.length || Array.from(campaign.cleared).some((id, index) => id !== list[index].id)) fail();
      }
    }
    if (record.cards !== undefined) {
      const cards = record.cards, stats = TAKRAW_CLUB_RULES.stats.map(stat => stat.id);
      const validCard = (id, card) => card && typeof card === 'object' && card.id === id && /^gen-\d+$/.test(id) &&
        typeof card.name === 'string' && card.name.length >= 1 && card.name.length <= 8 && typeof card.tag === 'string' && card.tag.length <= 40 &&
        TAKRAW_CLUB_RULES.roles.some(role => role.id === card.preferredRole) && TAKRAW_CLUB_RULES.rarities.some(rarity => rarity.id === card.rarity) &&
        Number.isSafeInteger(card.number) && card.number >= 0 && card.number <= 99 && card.stats && typeof card.stats === 'object' &&
        Object.keys(card.stats).length === stats.length && stats.every(key => Number.isSafeInteger(card.stats[key]) && card.stats[key] >= 0 && card.stats[key] <= 100);
      if (!cards || typeof cards !== 'object' || Array.isArray(cards) ||
        Object.entries(cards).some(([id, card]) => !validCard(id, card) || !(record.owned.includes(id) || record.pending === id))) fail();
    }
    if (record.pending !== undefined && record.pending !== null && (typeof record.pending !== 'string' || !this._known(record, record.pending) || record.owned.includes(record.pending))) fail();
    if (record.gacha !== undefined && !(record.gacha && typeof record.gacha === 'object' && integer(record.gacha.runs))) fail();
    if (record.levels !== undefined) {
      const levels = record.levels;
      if (!levels || typeof levels !== 'object' || Array.isArray(levels) ||
        Object.entries(levels).some(([id, level]) => !record.owned.includes(id) || !Number.isSafeInteger(level) || level < 1)) fail();
    }
    for (const [id, training] of Object.entries(record.trained)) {
      const player = TAKRAW_CLUB_PLAYERS.find(value => value.id === id);
      if (!record.owned.includes(id) || !player || !training || typeof training !== 'object' || Array.isArray(training)) fail();
      for (const [stat, amount] of Object.entries(training)) if (!Object.hasOwn(player.stats, stat) || !integer(amount) || amount + player.stats[stat] > 100) fail();
    }
    if (record.lastReward !== null) {
      const receipt = record.lastReward;
      if (!receipt || !record.rewards.includes(receipt.id) || typeof receipt.won !== 'boolean') fail();
      const base = TAKRAW_CLUB_RULES.rewards[receipt.won ? 'win' : 'loss'];
      if (receipt.credits !== base.credits) fail();
      if (receipt.schoolId === undefined) { if (receipt.trainingPoints !== base.trainingPoints) fail(); }
      else {
        const index = (record.campaign?.home ? takrawOpponents(record.campaign.home) : TAKRAW_SCHOOLS).findIndex(school => school.id === receipt.schoolId);
        // 영수증의 과거 금액은 임시 보상값 변경 뒤에도 읽는다. 지급 판정은 cleared뿐이다.
        if (index < 0 || !integer(receipt.trainingPoints) || (!receipt.won && receipt.trainingPoints !== 0) ||
            !record.campaign || index > record.campaign.cleared.length ||
            (receipt.won && !record.campaign.cleared.includes(receipt.schoolId))) fail();
      }
    }
    this.metrics.restoreMs += this._clock() - start; return record;
  }

  _open() {
    if (this.db) return Promise.resolve(this.db);
    if (!this.storage) return Promise.reject(this._error('이 브라우저에서 팀 저장을 사용할 수 없어요. 저장 권한을 확인해 주세요.', 'storage'));
    return new Promise((resolve, reject) => {
      let ended = false, request;
      try { request = this.storage.open('bloom-takraw-club', 1); }
      catch (error) { reject(this._error('팀 저장소를 열지 못했어요. 브라우저 저장 권한을 확인해 주세요.', 'storage')); return; }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('club')) request.result.createObjectStore('club');
      };
      request.onblocked = () => { ended = true; reject(this._error('다른 탭에서 저장소를 사용 중이에요. 다른 게임 탭을 닫고 다시 불러오세요.', 'storage')); };
      request.onerror = () => { ended = true; reject(this._error('팀 저장소를 열지 못했어요. 브라우저 저장 권한을 확인해 주세요.', 'storage')); };
      request.onsuccess = () => {
        if (ended || this.disposed) { request.result.close(); if (!ended) reject(this._error('팀 관리가 종료되었어요.', 'storage')); return; }
        this.db = request.result;
        this.db.onversionchange = () => { this.db?.close(); this.db = null; this.status = 'conflict'; this.message = '팀 저장소가 다른 탭에서 바뀌었어요. 다시 불러오세요.'; this._notify(); };
        resolve(this.db);
      };
    });
  }

  _transaction({ create = false, expected = null, mutate = null } = {}) {
    return new Promise((resolve, reject) => {
      const started = this._clock(); let tx, failure = null, result = null, changed = false;
      try { tx = this.db.transaction('club', create || mutate ? 'readwrite' : 'readonly'); }
      catch { reject(this._error('팀 저장에 접근할 수 없어요. 다시 불러와 주세요.', 'storage')); return; }
      tx.onabort = () => reject(failure || this._error(tx.error?.name === 'QuotaExceededError' ? '저장 공간이 부족해 변경을 저장하지 못했어요. 기존 팀은 보존했어요.' : '변경을 저장하지 못했어요. 기존 팀은 보존했어요.', 'storage'));
      tx.onerror = () => { /* onabort가 최종 실패를 소유한다. */ };
      tx.oncomplete = () => { this.metrics[changed ? 'writeMs' : 'readMs'] += this._clock() - started; resolve({ record: result, changed }); };
      const store = tx.objectStore('club'); this.metrics.reads++;
      const request = store.get('my-team');
      request.onsuccess = () => {
        try {
          const current = request.result;
          if (current === undefined) {
            if (!create) throw this._error('저장된 팀을 찾을 수 없어요. 기존 화면을 유지했어요.', 'storage');
            result = this._default(); this._validate(result); store.add(result, 'my-team'); this.metrics.writes++; changed = true; return;
          }
          this._validate(current);
          if (create && !current.campaign?.home) {
            // 내 학교가 없는 저장본: 처음 불러올 때 한 번 정한다. 도전 기록은 단계 구성이 바뀌어 새로 시작하고, 이전 영수증은 비운다.
            const next = this._copy(current);
            next.campaign = { home: takrawPickHome(this.random()), cleared: [] }; next.lastReward = null; next.revision++;
            this._validate(next); store.put(next, 'my-team'); this.metrics.writes++; result = next; changed = true; return;
          }
          if (expected !== null && current.revision !== expected) throw this._error('다른 탭에서 팀이 바뀌었어요. 최신 저장을 불러오세요.', 'conflict');
          result = current;
          if (!mutate) return;
          const next = this._copy(current); changed = mutate(next) !== false;
          if (!changed) return;
          next.revision++; this._validate(next); store.put(next, 'my-team'); this.metrics.writes++; result = next;
        } catch (error) { failure = error; tx.abort(); }
      };
    });
  }

  _commit(result, message) {
    this.record = result.record;
    this.status = this.externalRevision > this.record.revision ? 'conflict' : 'ready';
    this.message = this.status === 'conflict' ? '다른 탭에서 팀이 바뀌었어요. 최신 저장을 불러오세요.' : message;
    const started = this._clock(); this.metrics.bytes = new TextEncoder().encode(JSON.stringify(this.record)).length;
    this.metrics.serializationMs += this._clock() - started;
    if (result.changed) { try { this.channel?.postMessage({ revision: this.record.revision }); } catch { /* 알림 실패가 저장 성공을 취소하지 않는다. */ } }
    this._notify(); return { changed: result.changed, view: this.getView() };
  }

  _queue(operation) {
    const run = this.pending.then(async () => {
      if (this.disposed) throw this._error('팀 관리가 종료되었어요.', 'storage');
      try { return await operation(); }
      catch (error) {
        this.status = error.kind === 'conflict' ? 'conflict' : error.kind === 'validation' && this.record ? 'ready' : 'error';
        this.message = error.message || '팀 변경을 저장하지 못했어요.'; this._notify(); throw error;
      }
    });
    this.pending = run.catch(() => {}); return run;
  }

  load() {
    return this._queue(async () => {
      this.status = 'loading'; this.message = '팀을 불러오고 있어요.'; this._notify();
      await this._open(); return this._commit(await this._transaction({ create: true }), '팀을 불러왔어요. 편성은 다음 경기부터 적용돼요.');
    });
  }

  refresh() {
    return this._queue(async () => {
      this.status = 'loading'; this.message = '최신 저장을 불러오고 있어요.'; this._notify();
      await this._open(); return this._commit(await this._transaction({ create: !this.record }), '최신 팀을 불러왔어요.');
    });
  }

  _mutate(mutate, message) {
    return this._queue(async () => {
      if (!this.record || this.status !== 'ready') throw this._error('최신 팀을 먼저 불러와 주세요.', this.status === 'conflict' ? 'conflict' : 'storage');
      this.status = 'saving'; this.message = '팀을 저장하고 있어요.'; this._notify();
      return this._commit(await this._transaction({ expected: this.record.revision, mutate }), message);
    });
  }

  rename(value) {
    const name = this._normalizeName(value);
    return this._mutate(record => {
      if ([...name].length < 1 || [...name].length > TAKRAW_CLUB_RULES.nameLength) throw this._error(`팀 이름은 1~${TAKRAW_CLUB_RULES.nameLength}자로 입력하세요.`);
      if (name === record.name) return false; record.name = name;
    }, '팀 이름을 저장했어요.');
  }

  assign(role, playerId) {
    return this._mutate(record => {
      if (!TAKRAW_CLUB_RULES.roles.some(value => value.id === role) || !record.owned.includes(playerId)) throw this._error('편성할 선수와 자리를 확인해 주세요.');
      const previousRole = TAKRAW_CLUB_RULES.roles.find(value => record.lineup[value.id] === playerId)?.id;
      if (previousRole === role) return false;
      if (previousRole) record.lineup[previousRole] = record.lineup[role];
      record.lineup[role] = playerId;
    }, '편성을 저장했어요. 다음 경기와 연습부터 적용돼요.');
  }

  /** 훈련 포인트 1개로 선수의 훈련 레벨을 한 단계 올린다. 모든 능력치가 함께 오른다. */
  train(playerId) {
    return this._mutate(record => {
      const rule = TAKRAW_CLUB_RULES.training;
      if (!record.owned.includes(playerId)) throw this._error('훈련할 선수를 확인해 주세요.');
      if (record.trainingPoints < rule.cost) throw this._error('훈련 포인트가 부족해요. AI 대전을 완료하면 받을 수 있어요.');
      record.levels ??= {};
      record.levels[playerId] = (record.levels[playerId] || 0) + 1;
      record.trainingPoints -= rule.cost;
    }, '훈련을 저장했어요. 다음 경기와 연습부터 적용돼요.');
  }

  /** 저장된 카드 또는 프리셋 선수 하나. 생성 선수는 저장 기록의 cards에만 있다. */
  _card(id) { return TAKRAW_CLUB_PLAYERS.find(value => value.id === id) ?? this.record?.cards?.[id]; }
  _known(record, id) { return TAKRAW_CLUB_PLAYERS.some(value => value.id === id) || !!record.cards?.[id]; }

  _rollRarity() {
    const weights = Object.entries(TAKRAW_CLUB_RULES.draw.weights), total = weights.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = this.random() * total;
    for (const [rarity, weight] of weights) { if ((roll -= weight) < 0) return rarity; }
    return weights[weights.length - 1][0];
  }

  /**
   * 코인 1회분으로 선수를 뽑는다. 결과는 이 저장 한 번에 확정되므로 연출 도중 새로고침해도 되돌릴 수 없다.
   * 선수단에 자리가 있으면 바로 합류하고, 가득 차면 pending으로 남겨 resolveDraw가 정리할 때까지 다음 뽑기를 막는다.
   */
  async draw() {
    const rules = TAKRAW_CLUB_RULES, rule = rules.draw; let drawn = null;
    const result = await this._mutate(record => {
      if (record.pending) throw this._error('먼저 지난 뽑기 결과를 정리해 주세요.');
      if (record.credits < rule.cost) throw this._error(`뽑기에 ${rule.cost - record.credits} C가 더 필요해요.`);
      const rarity = this._rollRarity();
      const presets = TAKRAW_CLUB_PLAYERS.filter(player => !player.starter && player.rarity === rarity && !record.owned.includes(player.id));
      record.gacha ??= { runs: 0 }; record.cards ??= {};
      let id;
      if (presets.length && this.random() < rule.presetShare) id = presets[Math.floor(this.random() * presets.length)].id;
      else {
        id = `gen-${record.gacha.runs + 1}`;
        const names = record.owned.map(owned => (TAKRAW_CLUB_PLAYERS.find(value => value.id === owned) ?? record.cards[owned])?.name);
        const numbers = Object.values(record.cards).map(card => card.number);
        record.cards[id] = takrawGenerateCard({ id, rarity, random: this.random, rules, takenNames: names, takenNumbers: numbers });
      }
      record.gacha.runs++; record.credits -= rule.cost;
      const joined = record.owned.length < rules.capacity;
      if (joined) record.owned.push(id); else record.pending = id;
      drawn = { id, rarity, joined };
    }, '선수를 뽑았어요.');
    return { ...result, drawn };
  }

  /** 선수 한 명을 팔았을 때 받는 훈련 포인트: 등급 환급 + 쌓은 훈련 레벨. */
  _sellValue(record, id) {
    const rules = TAKRAW_CLUB_RULES, rarity = this._card(id)?.rarity ?? 'common';
    return rules.draw.refund[rarity] + (record.levels?.[id] || 0) * rules.sell.levelRefund;
  }

  /** 후보 선수를 팔아 훈련 포인트로 바꾼다. 출전 선수는 팔 수 없고, 선수단은 최소 인원 밑으로 줄지 않는다. */
  sell(playerId) {
    let value = 0;
    return this._mutate(record => {
      const rules = TAKRAW_CLUB_RULES;
      if (!record.owned.includes(playerId)) throw this._error('판매할 선수를 확인해 주세요.');
      if (Object.values(record.lineup).includes(playerId)) throw this._error('출전 선수는 팔 수 없어요. 후보와 교체한 뒤 판매해 주세요.');
      if (record.owned.length <= rules.sell.minRoster) throw this._error(`선수단에는 최소 ${rules.sell.minRoster}명이 남아야 해요.`);
      value = this._sellValue(record, playerId);
      record.trainingPoints += value;
      record.owned.splice(record.owned.indexOf(playerId), 1);
      delete record.cards?.[playerId]; delete record.trained[playerId]; delete record.levels?.[playerId];
    }, '선수를 팔았어요.').then(result => ({ ...result, sold: value }));
  }

  /** 가득 차서 남겨 둔 뽑기 결과를 정리한다. release가 있으면 그 후보와 교체하고, 없으면 환급 포인트를 받는다. */
  resolveDraw({ release = null } = {}) {
    return this._mutate(record => {
      const rules = TAKRAW_CLUB_RULES, id = record.pending;
      if (!id) throw this._error('정리할 뽑기 결과가 없어요.');
      const card = this._card(id);
      const drop = playerId => { // 생성 선수는 카드째 지우고 훈련 기록도 함께 정리한다.
        delete record.cards?.[playerId]; delete record.trained[playerId]; delete record.levels?.[playerId];
      };
      if (release === null) { record.trainingPoints += rules.draw.refund[card.rarity]; drop(id); }
      else {
        if (!record.owned.includes(release) || Object.values(record.lineup).includes(release)) throw this._error('교체할 후보 선수를 확인해 주세요.');
        record.owned.splice(record.owned.indexOf(release), 1); drop(release); record.owned.push(id);
      }
      record.pending = null;
    }, release === null ? '환급 포인트를 받았어요.' : '후보와 교체했어요.');
  }

  rewardMatch({ id, won, mode, schoolId = null } = {}) {
    if (mode !== 'match' || typeof won !== 'boolean' || typeof id !== 'string' || !/^[a-f\d]{32}$/.test(id)) return Promise.reject(this._error('완료된 AI 대전의 보상 정보가 필요해요.'));
    if (this.record?.rewards.includes(id)) return Promise.resolve({ changed: false, view: this.getView() });
    return this._mutate(record => {
      if (record.rewards.includes(id)) return false;
      const baseReward = TAKRAW_CLUB_RULES.rewards[won ? 'win' : 'loss'];
      let trainingPoints = baseReward.trainingPoints;
      if (schoolId !== null) {
        const campaign = record.campaign, opponents = campaign?.home ? takrawOpponents(campaign.home) : [], schoolIndex = opponents.findIndex(school => school.id === schoolId);
        if (schoolIndex < 0) throw this._error('도전한 학교를 확인해 주세요.');
        trainingPoints = 0;
        if (schoolIndex > campaign.cleared.length) throw this._error('앞 학교를 먼저 클리어해 주세요.');
        if (won && schoolIndex === campaign.cleared.length) {
          trainingPoints = opponents[schoolIndex].firstClearTrainingPoints;
          campaign.cleared.push(schoolId);
        }
      }
      const reward = { ...baseReward, trainingPoints };
      record.credits += reward.credits; record.trainingPoints += reward.trainingPoints;
      record.record.played++; record.record[won ? 'won' : 'lost']++; record.rewards.push(id);
      record.lastReward = { id, won, ...reward, ...(schoolId === null ? {} : { schoolId }) };
    }, '경기 보상을 저장했어요.');
  }

  /** 훈련 포인트 1개로 받기 학습 한 번(100 epoch)을 마친 정책을 저장한다. policy는 양자화한 정책의 base64다. */
  learn(policy) {
    const rule = TAKRAW_CLUB_RULES.learning;
    if (typeof policy !== 'string' || !policy || policy.length > rule.policyLength || !/^[A-Za-z\d+/]+={0,2}$/.test(policy)) return Promise.reject(this._error('저장할 학습 결과를 확인해 주세요.'));
    return this._mutate(record => {
      if (record.trainingPoints < rule.cost) throw this._error('훈련 포인트가 부족해요. AI 대전을 완료하면 받을 수 있어요.');
      record.trainingPoints -= rule.cost;
      const learning = record.learning ?? { runs: 0, policy: null };
      record.learning = { runs: learning.runs + 1, policy };
    }, '학습 결과를 저장했어요. 다음 AI 대전·연습부터 적용돼요.');
  }

  /** 저장된 학습 정책(base64)과 누적 학습 횟수. 학습한 적이 없으면 null이다. */
  learnedPolicy() {
    const learning = this.record?.learning;
    return learning?.policy ? { policy: learning.policy, runs: learning.runs } : null;
  }

  _player(id) {
    const base = this._card(id), number = base.number ?? TAKRAW_CLUB_PLAYERS.findIndex(value => value.id === id) + 1;
    const level = this.record?.levels?.[id] || 0, factor = takrawTrainingFactor(level);
    return { ...base, number, level, sellValue: this.record ? this._sellValue(this.record, id) : 0, stats: Object.fromEntries(Object.entries(base.stats).map(([key, value]) => [key, Math.round((value + (this.record?.trained[id]?.[key] || 0)) * factor)])), role: TAKRAW_CLUB_RULES.roles.find(role => this.record?.lineup[role.id] === id)?.id || null };
  }

  getView() {
    const record = this.record;
    return { status: this.status, message: this.message, teamName: record?.name || '', credits: record?.credits || 0,
      trainingPoints: record?.trainingPoints || 0, roster: record ? record.owned.map(id => this._player(id)) : [], lineup: { ...record?.lineup },
      draw: { ...TAKRAW_CLUB_RULES.draw, runs: record?.gacha?.runs || 0, pending: record?.pending ? this._player(record.pending) : null },
      record: record ? { ...record.record } : { played: 0, won: 0, lost: 0 }, learning: { runs: record?.learning?.runs || 0 }, lastReward: record?.lastReward ? { ...record.lastReward } : null,
      campaign: { home: record?.campaign?.home || null, cleared: [...(record?.campaign?.cleared || [])] }, revision: record?.revision ?? null };
  }

  matchTeam() {
    if (!this.record) return null;
    return { name: this.record.name, players: TAKRAW_CLUB_RULES.roles.map(({ id: role }) => {
      const player = this._player(this.record.lineup[role]); return { id: player.id, name: player.name, role, stats: { ...player.stats } };
    }) };
  }

  diagnostics() { return { status: this.status, revision: this.record?.revision ?? null, ...this.metrics, bytesMeaning: '저장 레코드 JSON UTF-8 크기 추정값. IndexedDB 실제 디스크 사용량과 다릅니다.' }; }
  dispose() { this.disposed = true; this.channel?.close(); this.channel = null; this.db?.close(); this.db = null; this.onChange = null; }
}

export { TAKRAW_CLUB_RULES, TAKRAW_CLUB_PLAYERS, TakrawClub, takrawTrainingFactor };
