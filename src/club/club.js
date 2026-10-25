/** 선수·편성·경제·영속 상태의 단일 소유자. 경기 물리 상태는 저장하지 않는다. */
const TAKRAW_CLUB_RULES = Object.freeze({
  initial: { credits: 600, trainingPoints: 6 },
  capacity: 9, nameLength: 18, training: { cost: 1, increase: 2, maximum: 100 },
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

const takrawClubStats = values => Object.fromEntries(TAKRAW_CLUB_RULES.stats.map(stat => [stat.id, values[stat.id] ?? 50]));
const TAKRAW_CLUB_PLAYERS = Object.freeze([
  { id: 'han-gyeol', name: '한결', tag: '든든한 수비', preferredRole: 'receiver', stats: takrawClubStats({ defense: 74, recovery: 68 }) },
  { id: 'yun-seo', name: '윤서', tag: '차분한 연결', preferredRole: 'setter', stats: takrawClubStats({ defense: 58, recovery: 62 }) },
  { id: 'i-deun', name: '이든', tag: '균형 잡힌 공격', preferredRole: 'attacker', stats: takrawClubStats({}) },
  { id: 'ha-rin', name: '하린', tag: '빠른 공간 커버', preferredRole: 'attacker', stats: takrawClubStats({ mobility: 84, flexibility: 78, defense: 58, recovery: 60 }) },
  { id: 'do-yun', name: '도윤', tag: '높은 타점', preferredRole: 'attacker', stats: takrawClubStats({ mobility: 54, jump: 78, power: 78, defense: 52, recovery: 56 }) },
  { id: 'si-on', name: '시온', tag: '힘 있는 토스', preferredRole: 'setter', stats: takrawClubStats({ mobility: 62, setting: 84, defense: 72, recovery: 62 }) },
  { id: 'na-rae', name: '나래', tag: '넓은 수비 범위', preferredRole: 'receiver', price: 360, stats: takrawClubStats({ mobility: 76, flexibility: 62, setting: 54, defense: 88, recovery: 78 }) },
  { id: 'tae-o', name: '태오', tag: '강력한 공중 타격', preferredRole: 'attacker', price: 480, stats: takrawClubStats({ mobility: 58, jump: 86, power: 86, flexibility: 72, recovery: 58 }) },
  { id: 'ra-on', name: '라온', tag: '빠른 세팅', preferredRole: 'setter', price: 420, stats: takrawClubStats({ mobility: 74, flexibility: 58, setting: 88, defense: 70, recovery: 72 }) },
]);

class TakrawClub {
  constructor({ onChange = null, indexedDB = globalThis.indexedDB } = {}) {
    this.storage = indexedDB; this.onChange = onChange; this.db = null; this.record = null;
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
      owned: TAKRAW_CLUB_PLAYERS.filter(player => !player.price).map(player => player.id), trained: {},
      lineup: { receiver: 'han-gyeol', setter: 'yun-seo', attacker: 'i-deun' },
      record: { played: 0, won: 0, lost: 0 }, rewards: [], lastReward: null };
  }

  _validate(record) {
    const start = this._clock(), fail = () => { throw this._error('저장된 팀 형식을 확인할 수 없어요. 기존 데이터는 보존했어요.', 'storage'); };
    const integer = value => Number.isSafeInteger(value) && value >= 0;
    if (!record || record.schema !== 1 || !integer(record.revision) || typeof record.name !== 'string' ||
      this._normalizeName(record.name) !== record.name || [...record.name].length < 1 || [...record.name].length > TAKRAW_CLUB_RULES.nameLength ||
      !integer(record.credits) || !integer(record.trainingPoints) || !Array.isArray(record.owned) ||
      record.owned.length < 3 || record.owned.length > TAKRAW_CLUB_RULES.capacity || new Set(record.owned).size !== record.owned.length ||
      record.owned.some(id => !TAKRAW_CLUB_PLAYERS.some(player => player.id === id)) ||
      !record.lineup || new Set(Object.values(record.lineup)).size !== 3 || Object.keys(record.lineup).length !== 3 ||
      TAKRAW_CLUB_RULES.roles.some(role => !record.owned.includes(record.lineup[role.id])) ||
      !record.trained || typeof record.trained !== 'object' || Array.isArray(record.trained) ||
      !record.record || !['played','won','lost'].every(key => integer(record.record[key])) || record.record.played !== record.record.won + record.record.lost ||
      !Array.isArray(record.rewards) || record.rewards.length !== record.record.played || new Set(record.rewards).size !== record.rewards.length ||
      record.rewards.some(id => typeof id !== 'string' || !/^[a-f\d]{32}$/.test(id))) fail();
    for (const [id, training] of Object.entries(record.trained)) {
      const player = TAKRAW_CLUB_PLAYERS.find(value => value.id === id);
      if (!record.owned.includes(id) || !player || !training || typeof training !== 'object' || Array.isArray(training)) fail();
      for (const [stat, amount] of Object.entries(training)) if (!Object.hasOwn(player.stats, stat) || !integer(amount) || amount + player.stats[stat] > 100) fail();
    }
    if (record.lastReward !== null && (!record.lastReward || !record.rewards.includes(record.lastReward.id) || typeof record.lastReward.won !== 'boolean' ||
      ['credits','trainingPoints'].some(key => record.lastReward[key] !== TAKRAW_CLUB_RULES.rewards[record.lastReward.won ? 'win' : 'loss'][key]))) fail();
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

  train(playerId, stat) {
    return this.allocate(playerId, { [stat]: 1 });
  }

  allocate(playerId, allocations, { revision = null } = {}) {
    // UI의 임시 배분을 호출 시 고정한다. 저장 큐를 기다리는 동안 외부에서 바꿀 수 없다.
    const entries = allocations && typeof allocations === 'object' && !Array.isArray(allocations)
      ? Object.entries(allocations).map(([stat, points]) => [stat, points]) : null;
    return this._mutate(record => {
      const player = TAKRAW_CLUB_PLAYERS.find(value => value.id === playerId), rule = TAKRAW_CLUB_RULES.training;
      if (!record.owned.includes(playerId) || !player || !entries) throw this._error('훈련할 선수와 배분할 포인트를 확인해 주세요.');
      if (revision !== null && (!Number.isSafeInteger(revision) || revision < 0)) throw this._error('훈련 계획의 저장 버전을 확인해 주세요.');
      if (revision !== null && revision !== record.revision) throw this._error('팀 정보가 바뀌었어요. 현재 능력치와 포인트를 확인하고 다시 배분해 주세요.');
      const updates = []; let cost = 0;
      for (const [stat, points] of entries) {
        if (!Object.hasOwn(player.stats, stat) || !Number.isSafeInteger(points) || points < 0) throw this._error('배분 포인트는 능력치별로 0 이상의 정수여야 해요.');
        if (!points) continue;
        const amount = record.trained[playerId]?.[stat] || 0, current = player.stats[stat] + amount;
        if (current >= rule.maximum) throw this._error('이미 최대 능력치예요.');
        if (points > Math.ceil((rule.maximum - current) / rule.increase)) throw this._error('최대 능력치를 넘지 않도록 배분 포인트를 줄여 주세요.');
        cost += points * rule.cost;
        updates.push([stat, amount + Math.min(points * rule.increase, rule.maximum - current)]);
      }
      if (!updates.length) return false;
      if (!Number.isSafeInteger(cost) || record.trainingPoints < cost) throw this._error('훈련 포인트가 부족해요. AI 대전을 완료하면 받을 수 있어요.');
      record.trained[playerId] ??= {};
      for (const [stat, amount] of updates) record.trained[playerId][stat] = amount;
      record.trainingPoints -= cost;
    }, '능력치 배분을 저장했어요. 다음 경기와 연습부터 적용돼요.');
  }

  recruit(playerId) {
    return this._mutate(record => {
      const player = TAKRAW_CLUB_PLAYERS.find(value => value.id === playerId);
      if (!player?.price) throw this._error('영입할 선수를 확인해 주세요.');
      if (record.owned.includes(playerId)) throw this._error('이미 우리 팀 선수예요.');
      if (record.owned.length >= TAKRAW_CLUB_RULES.capacity) throw this._error('선수단이 가득 찼어요. 최대 9명까지 함께할 수 있어요.');
      if (record.credits < player.price) throw this._error(`영입에 ${player.price - record.credits} C가 더 필요해요.`);
      record.credits -= player.price; record.owned.push(playerId);
    }, '선수를 영입했어요. 원하는 자리에 편성해 보세요.');
  }

  rewardMatch({ id, won, mode } = {}) {
    if (mode !== 'match' || typeof won !== 'boolean' || typeof id !== 'string' || !/^[a-f\d]{32}$/.test(id)) return Promise.reject(this._error('완료된 AI 대전의 보상 정보가 필요해요.'));
    if (this.record?.rewards.includes(id)) return Promise.resolve({ changed: false, view: this.getView() });
    return this._mutate(record => {
      if (record.rewards.includes(id)) return false;
      const reward = TAKRAW_CLUB_RULES.rewards[won ? 'win' : 'loss'];
      record.credits += reward.credits; record.trainingPoints += reward.trainingPoints;
      record.record.played++; record.record[won ? 'won' : 'lost']++; record.rewards.push(id);
      record.lastReward = { id, won, ...reward };
    }, '경기 보상을 저장했어요.');
  }

  _player(id) {
    const base = TAKRAW_CLUB_PLAYERS.find(value => value.id === id);
    return { ...base, stats: Object.fromEntries(Object.entries(base.stats).map(([key, value]) => [key, value + (this.record?.trained[id]?.[key] || 0)])),
      trained: { ...this.record?.trained[id] }, role: TAKRAW_CLUB_RULES.roles.find(role => this.record?.lineup[role.id] === id)?.id || null };
  }

  getView() {
    const record = this.record;
    return { status: this.status, message: this.message, teamName: record?.name || '', credits: record?.credits || 0,
      trainingPoints: record?.trainingPoints || 0, roster: record ? record.owned.map(id => this._player(id)) : [], lineup: { ...record?.lineup },
      scouts: record ? TAKRAW_CLUB_PLAYERS.filter(player => player.price && !record.owned.includes(player.id)).map(player => this._player(player.id)) : [],
      record: record ? { ...record.record } : { played: 0, won: 0, lost: 0 }, lastReward: record?.lastReward ? { ...record.lastReward } : null,
      revision: record?.revision ?? null };
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

export { TAKRAW_CLUB_RULES, TAKRAW_CLUB_PLAYERS, TakrawClub };
