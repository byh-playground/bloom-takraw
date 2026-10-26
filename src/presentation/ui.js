import { TAKRAW_VERSION } from '../config/game.js';
import { TAKRAW_CLUB_RULES, TAKRAW_CLUB_PLAYERS } from '../club/club.js';
import { TAKRAW_TRAINING_LESSONS } from '../simulation/game.js';

class TakrawUI {
  constructor(callbacks, network) {
    this.callbacks = callbacks;
    this.canvas = document.getElementById('court-canvas');
    this.canvas.tabIndex = -1;
    this.settings = { sound: true, quality: 'high' };
    this.inGame = false;
    this.mode = 'match';
    this.dialog = '';
    this.network = network;
    this.controller = new AbortController();
    this.touch = { pointer: null, active: new Map() };
    this.previousFocus = null;
    this.homeShown = false;
    this.copyTimer = null;
    this.cache = new Map();
    this.club = { status: 'loading', message: '팀을 불러오고 있어요.', roster: [], scouts: [], lineup: {}, record: {} };
    this.clubSelection = { tab: 'roster', player: 'i-deun', stat: 'power', filter: 'all', compare: 'none', detail: false,
      rename: false, nameDraft: null, nameError: '', players: { roster: 'i-deun', scouts: null }, scroll: {} };
    this.clubDraft = null; this.clubBusy = false; this.clubNotice = ''; this.clubNoticeType = 'status';
    this.nodes = {};
    for (const id of ['home-panel','match-hud','modal-layer','dialog-panel','dialog-title','dialog-kicker','dialog-content','boot-status','boot-message','reload-button','touch-controls','move-pad','move-thumb','local-guide','training-actions','end-actions','connection-indicator']) this.nodes[id] = document.getElementById(id);
    this.coarse = window.matchMedia('(pointer: coarse)');
    this.text('version-label', TAKRAW_VERSION);
    this.bind();
    this.syncInputMode();
    this.applyRoute();
  }

  listen(node, type, listener, options = {}) {
    node.addEventListener(type, listener, { ...options, signal: this.controller.signal });
  }

  bind() {
    const click = (id, fn) => {
      const button = document.getElementById(id);
      this.listen(button, 'click', fn);
      // Browsers synthesize clicks only for the primary touch. Menus must also
      // work with a second finger while the movement pad is being held.
      this.listen(button, 'pointerup', event => {
        if (event.pointerType !== 'touch' || event.isPrimary) return;
        const bounds = button.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right ||
            event.clientY < bounds.top || event.clientY > bounds.bottom || button.disabled) return;
        event.preventDefault(); fn(event);
      });
    };
    click('start-match', () => this.start('match'));
    click('start-training', () => this.start('training'));
    click('start-local', () => this.start('local'));
    click('open-network', () => { this.callbacks.onStart?.('online'); this.navigate('network'); });
    click('help-button', () => this.navigate('help'));
    click('club-button', () => this.navigate('club'));
    click('open-club', () => this.navigate('club'));
    click('reward-retry', () => this.callbacks.onRewardRetry?.());
    click('settings-button', () => this.navigate('settings'));
    click('pause-button', () => this.navigate('pause'));
    click('dialog-close', () => this.closeDialog());
    click('reload-button', () => window.location.reload());
    click('rematch-button', () => this.callbacks.onRestart?.());
    click('training-reset', () => this.callbacks.onRestart?.());
    const lessonSelect = document.getElementById('training-lesson');
    lessonSelect.replaceChildren();
    for (const lesson of TAKRAW_TRAINING_LESSONS) {
      const option = document.createElement('option');
      option.value = lesson.id; option.textContent = lesson.title;
      lessonSelect.appendChild(option);
    }
    this.listen(lessonSelect, 'change', () => this.callbacks.onTrainingLesson?.(lessonSelect.value));
    click('result-home', () => this.quit());
    click('dismiss-rotate', () => document.getElementById('rotate-note').classList.add('dismissed'));
    this.listen(document.querySelector('.wordmark'), 'click', event => { event.preventDefault(); this.quit(); });
    this.listen(window, 'hashchange', () => this.applyRoute());
    this.listen(window, 'blur', () => this.releaseTouch());
    this.listen(window, 'resize', () => this.releaseTouch());
    this.listen(this.coarse, 'change', () => this.syncInputMode());
    this.listen(document, 'visibilitychange', () => { if (document.hidden) this.releaseTouch(); });
    this.listen(this.nodes['modal-layer'], 'pointerdown', event => { if (event.target === this.nodes['modal-layer']) this.closeDialog(); });
    this.listen(this.nodes['dialog-content'], 'click', event => this.dialogClick(event));
    this.listen(this.nodes['dialog-content'], 'change', event => {
      if (event.target.dataset.clubChange !== 'compare') return;
      this.clubSelection.compare = event.target.value; this.renderClub('club-compare');
    });
    this.listen(this.nodes['dialog-content'], 'input', event => {
      if (event.target.id !== 'club-name') return;
      this.clubSelection.nameDraft = event.target.value; this.clubSelection.nameError = '';
      event.target.removeAttribute('aria-invalid');
      const error = document.getElementById('club-name-error'); if (error) error.textContent = '';
    });
    this.listen(this.nodes['dialog-content'], 'submit', event => {
      if (event.target.id !== 'club-name-form') return;
      event.preventDefault(); this.clubAction('rename', { name: document.getElementById('club-name').value });
    });
    this.listen(document, 'keydown', event => {
      if (event.code === 'Escape') { event.preventDefault(); if (this.dialog) this.closeDialog(); else if (this.inGame) this.navigate('pause'); }
      if (this.dialog && event.code === 'Tab') this.trapFocus(event);
    });
    for (const button of document.querySelectorAll('[data-touch]')) {
      this.listen(button, 'pointerdown', event => {
        event.preventDefault(); event.stopPropagation();
        if (!this.inGame || this.dialog) return;
        button.setPointerCapture(event.pointerId);
        const source = `touch:${event.pointerId}`;
        this.touch.active.set(event.pointerId, { button, action: button.dataset.touch, source });
        button.classList.add('is-down');
        this.callbacks.onTouch?.(button.dataset.touch, source, true);
      });
      const up = event => {
        const state = this.touch.active.get(event.pointerId);
        if (!state) return;
        event.preventDefault();
        this.callbacks.onTouch?.(state.action, state.source, false);
        this.touch.active.delete(event.pointerId);
        state.button.classList.toggle('is-down', [...this.touch.active.values()].some(item => item.button === state.button));
      };
      for (const type of ['pointerup','pointercancel','lostpointercapture']) this.listen(button, type, up);
      this.listen(button, 'contextmenu', event => event.preventDefault());
    }
    const pad = this.nodes['move-pad'];
    this.listen(pad, 'pointerdown', event => {
      if (!this.inGame || this.dialog || this.touch.pointer !== null) return;
      event.preventDefault(); event.stopPropagation(); this.touch.pointer = event.pointerId;
      pad.setPointerCapture(event.pointerId); this.moveTouch(event);
    });
    this.listen(pad, 'pointermove', event => { if (event.pointerId === this.touch.pointer) { event.preventDefault(); this.moveTouch(event); } });
    const up = event => {
      if (event.pointerId !== this.touch.pointer) return;
      this.touch.pointer = null; this.nodes['move-thumb'].style.transform = ''; this.callbacks.onAxis?.(0, 0);
    };
    for (const type of ['pointerup','pointercancel','lostpointercapture']) this.listen(pad, type, up);
    this.listen(pad, 'contextmenu', event => event.preventDefault());
  }

  start(mode) { if (this.callbacks.canStart(mode)) this.callbacks.onStart?.(mode); }

  updateStartButtons() {
    for (const button of document.querySelectorAll('.start-button')) {
      const mode = button.dataset.startMode;
      button.disabled = !this.callbacks.canStart(mode);
    }
  }

  moveTouch(event) {
    const rect = this.nodes['move-pad'].getBoundingClientRect();
    const thumb = this.nodes['move-thumb'].getBoundingClientRect();
    const radius = Math.max(1, (Math.min(rect.width, rect.height) - Math.max(thumb.width, thumb.height)) / 2);
    let x = (event.clientX - rect.left - rect.width / 2) / radius, z = (event.clientY - rect.top - rect.height / 2) / radius;
    const length = Math.hypot(x, z);
    if (length > 1) { x /= length; z /= length; }
    this.nodes['move-thumb'].style.transform = `translate(${x * radius}px,${z * radius}px)`;
    // A circular dead zone preserves direction when the thumb leaves centre.
    const strength = Math.max(0, (Math.min(length, 1) - .12) / .88);
    const scale = length > 0 ? strength / Math.min(length, 1) : 0;
    this.callbacks.onAxis?.(x * scale, z * scale);
  }

  releaseTouch() {
    const active = [...this.touch.active.entries()], pointer = this.touch.pointer;
    this.touch.active.clear(); this.touch.pointer = null; this.nodes['move-thumb'].style.transform = ''; this.callbacks.onAxis?.(0, 0);
    for (const [id, state] of active) {
      state.button.classList.remove('is-down'); this.callbacks.onTouch?.(state.action, state.source, false);
      if (state.button.hasPointerCapture(id)) state.button.releasePointerCapture(id);
    }
    if (pointer !== null && this.nodes['move-pad'].hasPointerCapture(pointer)) this.nodes['move-pad'].releasePointerCapture(pointer);
  }

  syncInputMode() {
    this.releaseTouch();
    this.nodes['touch-controls'].hidden = !this.inGame || !this.coarse.matches;
  }

  controlText(value) {
    return this.coarse.matches ? value.replaceAll('좌클', '발차기 버튼') : value;
  }

  setBootStatus({ phase, message, isError }) {
    this.nodes['boot-message'].textContent = message;
    this.nodes['boot-status'].classList.toggle('error', isError); this.nodes['boot-status'].classList.toggle('ready', phase === 'ready' && !isError);
    this.nodes['reload-button'].hidden = !isError;
    this.updateStartButtons();
  }

  showHome() {
    const initialDialog = !this.homeShown && !this.inGame && ['help','settings','network','club'].includes(this.dialog) ? this.dialog : '';
    this.homeShown = true;
    this.releaseTouch(); this.inGame = false; this.hideDialog(false);
    document.body.classList.add('is-home'); document.body.dataset.mode = 'home';
    this.nodes['home-panel'].hidden = false; this.nodes['match-hud'].hidden = true; this.nodes['touch-controls'].hidden = true;
    this.nodes['connection-indicator'].hidden = true; this.setRoute(initialDialog, true);
    if (initialDialog) this.openDialog(initialDialog);
  }

  showGame(mode) {
    this.inGame = true; this.mode = mode; this.hideDialog(true);
    document.body.classList.remove('is-home'); document.body.dataset.mode = mode;
    this.nodes['home-panel'].hidden = true; this.nodes['match-hud'].hidden = false;
    this.nodes['touch-controls'].hidden = !this.coarse.matches; this.nodes['training-actions'].hidden = mode !== 'training';
    this.nodes['local-guide'].hidden = mode !== 'local'; this.nodes['end-actions'].hidden = true;
    document.querySelector('.scoreboard').classList.toggle('is-training', mode === 'training');
    this.text('team-label-0', mode === 'local' ? '1P · 청록' : mode === 'online' ? '청록 팀' : '우리 팀');
    this.text('team-label-1', mode === 'local' ? '2P · 코랄' : mode === 'online' ? '코랄 팀' : '상대 팀');
    this.text('match-type', { training: '스파이크 연습', match: 'AI 대전', local: '로컬 2인', online: '온라인 1대1' }[mode]);
    this.setRoute('play'); this.canvas.focus({ preventScroll: true });
  }

  setRoute(route, replace = false) {
    const next = `#/${route}`;
    if (window.location.hash !== next) window.history[replace ? 'replaceState' : 'pushState'](null, '', next);
  }

  navigate(route) { this.setRoute(route); this.applyRoute(); }

  applyRoute() {
    const route = window.location.hash.replace(/^#\/?/, '').split('?')[0];
    if (['help','settings','pause','network','club'].includes(route)) {
      if (route === 'pause' && !this.inGame) { this.setRoute('', true); this.hideDialog(false); return; }
      this.openDialog(route);
    } else {
      if (!route && this.inGame) { this.quit(); return; }
      this.hideDialog(true);
      if ((route && route !== 'play') || (route === 'play' && !this.inGame)) this.setRoute(this.inGame ? 'play' : '', true);
    }
  }

  openDialog(route) {
    if (this.dialog === route) return;
    if (!this.dialog) { this.previousFocus = document.activeElement; this.releaseTouch(); if (this.inGame) this.callbacks.onPause?.(true); }
    this.dialog = route; this.nodes['modal-layer'].hidden = false;
    const meta = { help:['플레이 가이드','발끝의 타이밍'], club:['선수단 · 편성 · 훈련','내 팀 관리'], settings:['내게 맞는 플레이','설정'], pause:[this.mode === 'online' ? '경기는 계속 진행돼요' : '잠깐 숨 고르기', this.mode === 'online' ? '경기 메뉴' : '일시 정지'], network:['둘이서, 하나의 코트','친구와 온라인 1대1'] }[route];
    this.nodes['dialog-panel'].classList.toggle('is-club', route === 'club');
    this.nodes['modal-layer'].classList.toggle('is-club-layer', route === 'club');
    this.nodes['dialog-kicker'].textContent = meta[0]; this.nodes['dialog-title'].textContent = meta[1];
    this.nodes['dialog-content'].innerHTML = this[`${route}Content`](); this.nodes['dialog-content'].scrollTop = 0;
    if (route === 'network') this.renderNetwork();
    if (route === 'help') this.refreshDiagnostics();
    if (route === 'club') this.restoreClubPosition();
    queueMicrotask(() => {
      if (route !== 'club' || !this.restoreClubFocus()) document.getElementById('dialog-close').focus({ preventScroll: true });
    });
  }

  closeDialog() {
    if (this.dialog === 'network' && !this.inGame && ['listening','connecting'].includes(this.network.state)) this.callbacks.onNetwork?.('close');
    this.hideDialog(true); this.setRoute(this.inGame ? 'play' : '');
  }

  hideDialog(resume) {
    if (this.dialog === 'club') this.rememberClubPosition();
    const wasOpen = !!this.dialog; this.dialog = ''; this.nodes['modal-layer'].hidden = true;
    this.nodes['modal-layer'].classList.remove('is-club-layer');
    if (this.copyTimer) { window.clearTimeout(this.copyTimer); this.copyTimer = null; }
    if (wasOpen && resume && this.inGame) this.callbacks.onPause?.(false);
    if (wasOpen && this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
  }

  quit() { this.callbacks.onQuit?.(); this.showHome(); }

  trapFocus(event) {
    const nodes = [...this.nodes['dialog-panel'].querySelectorAll('button,input,select,textarea,summary,a[href],[tabindex]')]
      .filter(node => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length);
    if (!nodes.length) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  escape(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char])); }

  setClub(value) {
    this.club = value; this.updateStartButtons();
    const status = { loading:'팀을 불러오는 중', saving:'팀을 저장하는 중', conflict:'다른 탭에서 변경됨 · 최신 저장 불러오기', error:'팀 저장 확인 필요 · 관리에서 다시 불러오기' }[value.status];
    this.text('club-home-summary', status || (value.teamName ? `${value.teamName} · 선수 ${value.roster.length}명` : '선수단 · 편성 · 훈련'));
    if (this.dialog === 'club') this.renderClub();
  }

  rememberClubPosition() {
    const content = this.nodes['dialog-content'];
    this.clubSelection.scroll = Object.fromEntries(['club-list','club-detail','club-stats'].map(id => [id, document.getElementById(id)?.scrollTop || 0]));
    this.clubSelection.scroll.dialog = content.scrollTop;
    const active = document.activeElement;
    const focus = content.contains(active) ? active?.dataset?.clubFocus || active?.id || null : null;
    if (focus) this.clubSelection.focus = focus;
  }

  restoreClubPosition() {
    for (const [id, scroll] of Object.entries(this.clubSelection.scroll)) {
      const node = id === 'dialog' ? this.nodes['dialog-content'] : document.getElementById(id);
      if (node) node.scrollTop = scroll;
    }
  }

  restoreClubFocus() {
    if (!this.clubSelection.focus) return false;
    const nodes = [...this.nodes['dialog-content'].querySelectorAll('[data-club-focus], [id]')];
    const usable = node => node && !node.disabled && node.getClientRects().length;
    const find = identity => nodes.find(node => node.dataset.clubFocus === identity || node.id === identity);
    let next = find(this.clubSelection.focus);
    if (!usable(next)) {
      const stat = this.clubSelection.focus.match(/^(?:increase|decrease|allocation)-(.+)$/)?.[1] || this.clubSelection.stat;
      next = [find(`decrease-${stat}`), find(`increase-${stat}`), find(`allocation-${stat}`), find('detail-heading'), find(`tab-${this.clubSelection.tab}`)].find(usable);
    }
    if (usable(next)) { next.focus({ preventScroll: true }); return true; }
    return false;
  }

  renderClub(focus = null, resetDetail = false) {
    if (this.dialog !== 'club') return;
    this.rememberClubPosition();
    if (focus) this.clubSelection.focus = focus;
    if (resetDetail) { this.clubSelection.scroll['club-detail'] = 0; this.clubSelection.scroll.dialog = 0; }
    const name = document.getElementById('club-name');
    const caret = name && document.activeElement === name ? [name.selectionStart, name.selectionEnd] : null;
    if (name) this.clubSelection.nameDraft = name.value;
    this.nodes['dialog-content'].innerHTML = this.clubContent();
    const nextName = document.getElementById('club-name');
    if (caret && nextName && !nextName.disabled) {
      nextName.focus({ preventScroll: true }); nextName.setSelectionRange(...caret);
    } else this.restoreClubFocus();
    this.restoreClubPosition();
  }

  clubRoleName(role) { return TAKRAW_CLUB_RULES.roles.find(value => value.id === role)?.name || '후보'; }
  clubDraftPoints() { return this.clubDraft ? Object.values(this.clubDraft.allocations).reduce((sum, value) => sum + value, 0) : 0; }
  clubDraftStale() { return !!this.clubDraft && this.clubDraft.revision !== this.club.revision; }
  clubLockReason(allowDraft = false) {
    if (this.inGame) return '팀 변경은 처음 화면에서 할 수 있어요.';
    if (this.clubBusy || this.club.status === 'saving') return '팀을 저장하고 있어요.';
    if (this.club.status !== 'ready') return this.club.message || '팀을 먼저 불러와 주세요.';
    if (this.clubDraft && !allowDraft) return '미적용 배분을 먼저 적용하거나 취소해 주세요.';
    return '';
  }

  clubStatDescription(id) {
    return { mobility:'지상 이동 속도', jump:'점프 탄력', power:'공중 발차기 힘', flexibility:'공중 위치 조절',
      setting:'토스에 싣는 힘', defense:'강타에 버티는 자세', recovery:'넘어진 뒤 일어나기' }[id] || '';
  }

  clubShirt(player) {
    const number = TAKRAW_CLUB_PLAYERS.findIndex(value => value.id === player.id) + 1;
    return `<span class="club-shirt" data-role="${player.preferredRole}" aria-hidden="true"><svg viewBox="0 0 64 72"><path d="M20 5 12 9 2 23 14 33 19 27 18 65H46L45 27 50 33 62 23 52 9 44 5C42 11 37 14 32 14S22 11 20 5Z" fill="currentColor" stroke="none"/><path d="M20 5C22 12 27 16 32 16S42 12 44 5M20 26V61M44 26V61" fill="none" stroke="rgba(255,255,255,.42)" stroke-width="2"/><text x="32" y="46" fill="#fff" stroke="none" text-anchor="middle" font-size="22" font-weight="750">${String(number).padStart(2,'0')}</text></svg></span>`;
  }

  clubRadar(player, stats, comparison, projected) {
    const axes = TAKRAW_CLUB_RULES.stats, center = { x:180, y:151 }, radius = 94;
    const point = (index, value, scale = radius) => {
      const angle = -Math.PI / 2 + index * Math.PI * 2 / axes.length;
      return { x:center.x + Math.cos(angle) * scale * value / 100, y:center.y + Math.sin(angle) * scale * value / 100 };
    };
    const polygon = values => axes.map((stat, index) => { const p = point(index, values[stat.id]); return `${p.x.toFixed(2)},${p.y.toFixed(2)}`; }).join(' ');
    const grids = [25,50,75,100].map(value => `<polygon points="${polygon(Object.fromEntries(axes.map(stat => [stat.id,value])))}"/>`).join('');
    const spokes = axes.map((stat, index) => { const p = point(index,100); return `<line x1="${center.x}" y1="${center.y}" x2="${p.x}" y2="${p.y}"/>`; }).join('');
    const labels = axes.map((stat,index) => {
      const p = point(index,100,126), anchor = Math.abs(p.x - center.x) < 12 ? 'middle' : p.x > center.x ? 'start' : 'end';
      return `<text class="radar-label" x="${p.x}" y="${p.y - 4}" text-anchor="${anchor}">${this.escape(stat.name)}</text><text class="radar-value" x="${p.x}" y="${p.y + 15}" text-anchor="${anchor}">${stats[stat.id]}</text>`;
    }).join('');
    const dots = axes.map((stat,index) => { const p = point(index,stats[stat.id]); return `<circle cx="${p.x}" cy="${p.y}" r="3.5"/>`; }).join('');
    const description = axes.map(stat => `${stat.name} ${stats[stat.id]}${comparison ? `, 비교 ${comparison.stats[stat.id]}` : ''}`).join('. ');
    return `<svg class="club-radar" viewBox="0 0 360 310" role="img" aria-labelledby="club-radar-title club-radar-description">
      <title id="club-radar-title">${this.escape(player.name)} ${projected ? '배분 후 ' : ''}능력치</title><desc id="club-radar-description">0부터 100까지 같은 눈금. ${this.escape(description)}.</desc>
      <g class="radar-grid">${grids}</g><g class="radar-axis">${spokes}</g>
      <g class="radar-baseline">${[25,50,75,100].map(value => `<text class="radar-ring-label" x="185" y="${center.y - radius * value / 100 + 4}">${value}</text>`).join('')}<text class="radar-ring-label" x="185" y="164">0</text></g>
      ${comparison ? `<polygon class="radar-compare" points="${polygon(comparison.stats)}"/>` : ''}<polygon class="radar-current" points="${polygon(stats)}"/><g class="radar-dot">${dots}</g>${labels}
    </svg>`;
  }

  clubDetailContent(player, isScout) {
    const c = this.club, rules = TAKRAW_CLUB_RULES, selection = this.clubSelection, escape = value => this.escape(value);
    const ownedDraft = this.clubDraft?.playerId === player.id, draft = ownedDraft ? this.clubDraft.allocations : {}, cost = this.clubDraftPoints() * rules.training.cost;
    const projected = ownedDraft && cost > 0, stale = this.clubDraftStale();
    const stats = Object.fromEntries(rules.stats.map(stat => [stat.id, Math.min(rules.training.maximum, player.stats[stat.id] + (draft[stat.id] || 0) * rules.training.increase)]));
    const defaultCompare = c.roster.find(value => value.id === c.lineup[player.preferredRole]);
    const selectedCompare = selection.compare === 'auto' ? (isScout ? defaultCompare : null) : c.roster.find(value => value.id === selection.compare && value.id !== player.id);
    const comparison = projected ? { name:'현재 능력치', stats:player.stats } : selectedCompare || null;
    const compareLabel = projected ? '현재 능력치' : comparison ? `${comparison.name}${comparison.role ? ` · ${this.clubRoleName(comparison.role)} 선발` : ' · 후보'}` : '';
    const lock = this.clubLockReason(), editLock = this.clubLockReason(true) || (this.clubDraft && !ownedDraft ? '다른 선수의 미적용 배분을 먼저 적용하거나 취소해 주세요.' : stale ? '팀 정보가 바뀌었어요. 배분을 취소한 뒤 다시 정해 주세요.' : '');
    const available = (c.trainingPoints || 0) - cost;
    const comparisonOptions = `${isScout && defaultCompare ? `<option value="auto" ${selection.compare === 'auto' ? 'selected' : ''}>현재 ${this.clubRoleName(player.preferredRole)} · ${escape(defaultCompare.name)}</option>` : ''}<option value="none" ${selection.compare === 'none' || (!isScout && selection.compare === 'auto') ? 'selected' : ''}>비교 안 함</option>${c.roster.filter(value => value.id !== player.id).map(value => `<option value="${value.id}" ${selection.compare === value.id ? 'selected' : ''}>${escape(value.name)} · ${value.role ? `${this.clubRoleName(value.role)} 선발` : '후보'}</option>`).join('')}`;
    const delta = (a,b) => { const change = a-b; return `<small class="${change > 0 ? 'positive' : change < 0 ? 'negative' : 'neutral'}">${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(change)}${change === 0 ? ' · 동일' : ''}</small>`; };
    const rows = rules.stats.map(stat => {
      const value = player.stats[stat.id], next = stats[stat.id], points = draft[stat.id] || 0;
      const atMax = next >= rules.training.maximum, increaseDisabled = !!editLock || atMax || available < rules.training.cost;
      const decreaseDisabled = this.clubBusy || !ownedDraft || !points;
      const increaseReason = editLock || (atMax ? '최대 능력치예요.' : available < rules.training.cost ? '남은 훈련 포인트가 없어요.' : `${stat.name}에 ${rules.training.cost} P 배분`);
      return `<div class="club-stat-row" data-changed="${points > 0}" data-club-focus="allocation-${stat.id}" tabindex="-1">
        <div class="club-stat-label"><span>${escape(stat.name)}</span><small class="club-stat-effect">${this.clubStatDescription(stat.id)}</small></div>
        <div class="club-stat-value"><b>${points ? `${value}<span aria-hidden="true"> → </span><span class="sr-only">에서 </span>${next}` : value}</b>${points ? `<small class="positive">+${next-value} · ${points * rules.training.cost} P</small>` : comparison ? delta(value,comparison.stats[stat.id]) : value >= rules.training.maximum ? '<small>최대</small>' : '<small>/ 100</small>'}</div>
        ${isScout ? `<span class="club-comparison-stat">${comparison ? `${escape(comparison.name)}<b>${comparison.stats[stat.id]}</b>` : ''}</span>` : `<div class="club-stepper" role="group" aria-label="${escape(stat.name)} 포인트 배분"><button type="button" ${decreaseDisabled ? 'disabled' : ''} data-club-action="decrease" data-value="${stat.id}" data-club-focus="decrease-${stat.id}" aria-label="${escape(stat.name)} 미적용 배분 1 포인트 줄이기">−</button><span class="club-step-value" aria-label="${points} 포인트 배분">${points}</span><button type="button" ${increaseDisabled ? 'disabled' : ''} data-club-action="increase" data-value="${stat.id}" data-club-focus="increase-${stat.id}" aria-label="${escape(stat.name)} 1 포인트 배분" title="${escape(increaseReason)}">＋</button></div>`}
        <span class="club-stat-bar" aria-hidden="true"><span style="width:${next}%"></span></span></div>`;
    }).join('');
    const chart = `<div class="club-visual"><div class="club-compare-control"><label for="club-compare">${projected ? '배분 전과 비교' : '선수 비교'}</label><select id="club-compare" data-club-change="compare" data-club-focus="club-compare" ${projected ? 'disabled' : ''}>${projected ? '<option>현재 능력치와 비교</option>' : comparisonOptions}</select></div>
      ${this.clubRadar(player,stats,comparison,projected)}<div class="club-legend"><span class="legend-current"><i aria-hidden="true"></i>${projected ? '배분 후' : escape(player.name)}</span>${comparison ? `<span class="legend-compare"><i aria-hidden="true"></i>${escape(compareLabel)}</span>` : ''}</div><p class="club-scale-note">50 기본 · 100 최대</p>
</div>`;
    let footer;
    if (isScout) {
      const shortage = Math.max(0,player.price - (c.credits || 0)), full = c.roster.length >= rules.capacity;
      const reason = lock || (full ? '선수단이 가득 찼어요.' : shortage ? `${shortage} C가 더 필요해요. AI 대전을 완료하면 코인을 받아요.` : '영입한 선수는 후보로 합류해요. 원하는 선발 자리에 배치하세요.');
      footer = `<footer class="club-commit" data-mode="recruit"><div class="club-recruit-summary"><div><label>보유 코인</label><b>${c.credits || 0} C</b></div><div><label>영입 비용</label><b>${player.price} C</b></div><div><label>영입 후 잔액</label><b>${shortage ? `${shortage} C 부족` : `${c.credits - player.price} C`}</b></div><div><label>영입 후 선수단</label><b>${Math.min(rules.capacity,c.roster.length + 1)} / ${rules.capacity}명</b></div></div><div class="club-action-buttons"><button type="button" class="primary-small" ${lock || shortage || full ? 'disabled' : ''} data-club-action="recruit" data-club-focus="recruit">${player.price} C로 영입</button></div><p class="club-action-note">${escape(reason)}</p></footer>`;
    } else {
      const placement = rules.roles.map(role => {
        const current = c.roster.find(value => value.id === c.lineup[role.id]), selected = player.role === role.id;
        const label = selected ? '선발 중' : player.role ? '자리 교환' : '선발로 배치';
        return `<button type="button" class="${selected ? 'selected' : ''}" ${lock || selected ? 'disabled' : ''} data-club-action="assign" data-value="${role.id}" data-club-focus="assign-${role.id}" aria-label="${escape(player.name)} ${role.name}${selected ? ' 선발 중' : player.role ? ` · ${escape(current?.name || '')} ↔ 자리 교환` : ` 선발로 배치 · ${escape(current?.name || '')} → 후보`}"><small>${role.name}${role.id === 'attacker' ? ' · 직접 조작' : ''}</small><strong>${label}</strong>${!selected ? `<small>현재 ${escape(current?.name || '없음')}</small>` : ''}</button>`;
      }).join('');
      const trainReason = editLock || (!c.trainingPoints ? '훈련 포인트가 없어요. AI 대전을 완료하면 받을 수 있어요.' : available <= 0 ? '포인트를 모두 배분했어요. 내용을 확인하고 적용하세요.' : '적용 전에는 포인트가 사용되지 않아요.');
      footer = `<div class="club-section-heading"><h3>선발 배치</h3><small>공격수를 직접 조작해요</small></div><div class="club-placement">${placement}</div><p class="club-placement-note">${escape(lock || (player.role ? '다른 자리를 선택하면 두 선수가 서로 자리를 바꿔요.' : '선발로 배치하면 기존 선수는 후보로 이동해요.'))}</p>
        <footer class="club-commit" data-mode="roster" data-pending="${ownedDraft && cost > 0}"><div class="club-budget"><b>${ownedDraft ? cost : 0} P 배분 <span aria-hidden="true">·</span> ${Math.max(0,available)} P 남음</b><span>보유 ${c.trainingPoints || 0} P · 1 P로 능력치 +${rules.training.increase}</span></div><div class="club-action-buttons"><button type="button" class="secondary-small" ${!ownedDraft || this.clubBusy ? 'disabled' : ''} data-club-action="draft-reset" data-club-focus="draft-reset">배분 취소</button><button type="button" class="primary-small" ${editLock || !ownedDraft || !cost ? 'disabled' : ''} data-club-action="allocate" data-club-focus="apply">${ownedDraft && cost ? `${cost} P 적용` : '배분 적용'}</button></div><p class="club-action-note">${escape(trainReason)}</p></footer>`;
    }
    return `<div class="club-detail-heading"><button type="button" class="club-back" data-club-action="back" data-club-focus="back">← 선수 목록</button><div><div class="club-player-title"><strong tabindex="-1" data-club-focus="detail-heading">${escape(player.name)}</strong><span class="club-badge">${isScout ? '영입 후보' : player.role ? `${this.clubRoleName(player.role)} 선발` : '후보'}</span></div><p>${escape(player.tag)} · 추천 ${this.clubRoleName(player.preferredRole)}</p></div></div>
      <div class="club-analysis">${chart}<section class="club-stat-editor"><div class="club-section-heading"><h3>${isScout ? '능력치 비교' : '능력치 배분'}</h3><small>${isScout ? comparison ? `${escape(comparison.name)} 대비 차이` : '모든 능력치 0–100' : '1 P = +2 · 최대 100'}</small></div><div id="club-stats" class="club-stat-list" data-editable="${!isScout}">${rows}</div></section></div>${footer}`;
  }

  clubContent() {
    const c = this.club, selection = this.clubSelection, rules = TAKRAW_CLUB_RULES, escape = value => this.escape(value);
    const lock = this.clubLockReason(), isScout = selection.tab === 'scouts';
    const allPlayers = isScout ? c.scouts : c.roster;
    const pool = allPlayers.filter(player => selection.filter === 'all' || player.preferredRole === selection.filter);
    const player = pool.find(value => value.id === selection.player) || pool[0];
    if (player) { selection.player = player.id; selection.players[selection.tab] = player.id; }
    const cards = pool.map(value => {
      const peaks = rules.stats.slice().sort((a,b) => value.stats[b.id] - value.stats[a.id]).slice(0,2), selected = player?.id === value.id;
      return `<button type="button" class="club-card ${selected ? 'selected' : ''}" data-club-action="select" data-value="${value.id}" data-club-focus="player-${value.id}" aria-pressed="${selected}">${this.clubShirt(value)}<span class="club-card-copy"><strong>${escape(value.name)}</strong><small>추천 ${this.clubRoleName(value.preferredRole)} · ${escape(value.tag)}</small><span class="club-card-peaks">${peaks.map(stat => `${escape(stat.name)} <b>${value.stats[stat.id]}</b>`).join(' · ')}</span></span><span class="club-card-badge">${isScout ? `${value.price} C` : value.role ? `${this.clubRoleName(value.role)} 선발` : '후보'}</span></button>`;
    }).join('');
    const name = selection.rename ? `<form id="club-name-form" class="club-name-form"><label for="club-name">팀 이름 · 최대 ${rules.nameLength}자</label><input id="club-name" data-club-focus="club-name" type="text" aria-describedby="club-name-error" ${selection.nameError ? 'aria-invalid="true"' : ''} value="${escape(selection.nameDraft ?? c.teamName)}" placeholder="팀 이름" maxlength="36" ${lock ? 'disabled' : ''} autocomplete="off"><button type="submit" class="primary-small" ${lock ? 'disabled' : ''}>저장</button><button type="button" class="secondary-small" data-club-action="rename-cancel" data-club-focus="rename-cancel" ${this.clubBusy ? 'disabled' : ''}>취소</button><span id="club-name-error" class="club-name-error" role="alert">${escape(selection.nameError || '')}</span></form>` : `<button type="button" class="club-name-display" ${lock ? 'disabled' : ''} data-club-action="rename-edit" data-club-focus="rename-edit" aria-label="${escape(c.teamName || '내 팀')} 이름 바꾸기"><span>${escape(c.teamName || '내 팀')}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14Z"/></svg></button>`;
    const draftPlayer = c.roster.find(value => value.id === this.clubDraft?.playerId), draftCost = this.clubDraftPoints() * rules.training.cost;
    const draftBanner = this.clubDraft ? `<div class="club-draft-banner" data-stale="${this.clubDraftStale()}" data-current="${!isScout && player?.id === this.clubDraft.playerId && selection.detail && !this.clubDraftStale()}"><span><strong>${escape(draftPlayer?.name || '선수')} ${draftCost} P 미적용</strong><small>${this.clubDraftStale() ? '팀 정보가 바뀌었어요. 배분을 취소한 뒤 최신 능력치로 다시 정해 주세요.' : '내용을 확인하고 적용하거나 취소해 주세요.'}</small></span><div><button type="button" class="secondary-small" data-club-action="draft-return" data-club-focus="draft-return">배분으로 돌아가기</button><button type="button" class="secondary-small" ${this.clubBusy ? 'disabled' : ''} data-club-action="draft-reset" data-club-focus="draft-global-reset">취소</button></div></div>` : '';
    const passiveStatus = !this.inGame && !this.clubBusy && c.status === 'ready' && (!this.clubNotice || this.clubNoticeType === 'preview') && c.pendingReward?.status !== 'error';
    const statusMessage = this.inGame ? '현재 경기는 시작할 때의 편성을 사용해요. 팀 변경은 처음 화면에서 할 수 있어요.' : this.clubBusy ? '팀을 저장하고 있어요.' : c.status !== 'ready' ? c.message : this.clubNotice || c.message;
    const empty = c.status === 'loading' ? '선수 정보를 불러오고 있어요.' : isScout && !c.scouts.length ? '모든 영입 선수가 우리 팀에 합류했어요.' : '이 역할의 선수가 없어요. 전체 선수를 확인해 보세요.';
    return `<div class="club-layout" data-detail="${selection.detail}"><div class="club-summary"><div class="club-identity">${name}<span class="club-record">${c.record.won || 0}승 ${c.record.lost || 0}패 · 나만의 세팍타크로 팀</span></div><div class="club-wallet"><div class="club-resource"><small>영입 코인</small><b>${c.credits || 0} <span>C</span></b></div><div class="club-resource"><small>훈련 포인트</small><b>${c.trainingPoints || 0} <span>P</span></b></div></div></div>
      <div class="club-lineup" aria-label="현재 선발">${rules.roles.map(role => { const starter = c.roster.find(value => value.id === c.lineup[role.id]); return `<button type="button" data-club-action="lineup" data-value="${starter?.id || ''}" data-club-focus="lineup-${role.id}" ${!starter ? 'disabled' : ''}><small>${role.name}</small><strong>${escape(starter?.name || '불러오는 중')}</strong><span class="club-badge">${role.id === 'attacker' ? '직접 조작' : '동료'}</span></button>`; }).join('')}</div>
      <div class="club-status" data-status="${c.status}" data-passive="${passiveStatus}" role="status" aria-live="polite" aria-atomic="true"><span>${escape(statusMessage)}</span>${['error','conflict'].includes(c.status) ? `<button type="button" class="secondary-small" ${this.clubBusy ? 'disabled' : ''} data-club-action="refresh" data-club-focus="refresh">최신 저장 불러오기</button>` : ''}${c.pendingReward?.status === 'error' ? '<button type="button" class="secondary-small" data-club-action="reward" data-club-focus="reward">보상 저장 재시도</button>' : ''}</div>${draftBanner}
      <div class="club-navigation"><div class="club-tabs" role="group" aria-label="팀 관리 메뉴"><button type="button" class="${!isScout ? 'selected' : ''}" data-club-action="tab" data-value="roster" data-club-focus="tab-roster" aria-pressed="${!isScout}">선수단 <span>${c.roster.length}</span></button><button type="button" class="${isScout ? 'selected' : ''}" data-club-action="tab" data-value="scouts" data-club-focus="tab-scouts" aria-pressed="${isScout}">선수 영입 <span>${c.scouts.length}</span></button></div><span class="club-capacity">선수 ${c.roster.length} / ${rules.capacity}명</span></div>
      <div class="club-workspace" data-detail="${selection.detail}"><div class="club-roster-column"><div class="club-filter" role="group" aria-label="추천 역할로 선수 찾기">${[{id:'all',name:'전체'},...rules.roles.slice().reverse()].map(role => `<button type="button" class="${selection.filter === role.id ? 'selected' : ''}" data-club-action="filter" data-value="${role.id}" data-club-focus="filter-${role.id}" aria-pressed="${selection.filter === role.id}">${role.name}</button>`).join('')}</div><div id="club-list" class="club-list">${cards || `<p class="club-empty">${empty}</p>`}</div></div><section id="club-detail" class="club-detail" aria-label="선수 상세">${player ? this.clubDetailContent(player,isScout) : `<p class="club-empty">${empty}</p>`}</section></div>
      <p class="club-footnote">다음 AI 대전·연습부터 적용 · 현재 브라우저에 저장<br>AI 대전 완료 보상: 승리 180 C·3 P / 패배 100 C·2 P</p></div>`;
  }

  clubAdjust(stat, direction) {
    const player = this.club.roster.find(value => value.id === this.clubSelection.player), rules = TAKRAW_CLUB_RULES;
    if (!player || !rules.stats.some(value => value.id === stat) || this.clubBusy) return;
    if (this.clubDraft && this.clubDraft.playerId !== player.id) return;
    const count = this.clubDraft?.allocations[stat] || 0;
    if (direction > 0) {
      if (this.clubLockReason(true) || this.clubDraftStale()) return;
      const remaining = (this.club.trainingPoints || 0) - this.clubDraftPoints() * rules.training.cost;
      if (remaining < rules.training.cost || player.stats[stat] + count * rules.training.increase >= rules.training.maximum) return;
      this.clubDraft ??= { playerId:player.id, revision:this.club.revision, allocations:{} };
      this.clubDraft.allocations[stat] = count + 1;
    } else {
      if (!count) return;
      if (count === 1) delete this.clubDraft.allocations[stat]; else this.clubDraft.allocations[stat] = count - 1;
      if (!this.clubDraftPoints()) this.clubDraft = null;
    }
    this.clubSelection.stat = stat; this.clubSelection.detail = true; this.clubNoticeType = 'preview';
    this.clubNotice = `${player.name} · ${this.clubDraftPoints() * rules.training.cost} P 배분 중. 적용할 때 저장돼요.`;
    this.renderClub(`${direction > 0 ? 'increase' : 'decrease'}-${stat}`);
  }

  clubClick(button) {
    if (button.disabled) return;
    const action = button.dataset.clubAction, value = button.dataset.value, selection = this.clubSelection;
    if (action === 'select' || action === 'lineup') {
      if (action === 'lineup') { selection.tab = 'roster'; selection.filter = 'all'; }
      selection.player = value; selection.players[selection.tab] = value; selection.detail = true; selection.compare = selection.tab === 'scouts' ? 'auto' : 'none';
      this.renderClub('detail-heading',true);
    }
    if (action === 'tab') {
      if (!['roster','scouts'].includes(value)) return;
      selection.tab = value; selection.player = selection.players[value]; selection.filter = 'all'; selection.detail = false; selection.compare = value === 'scouts' ? 'auto' : 'none';
      this.renderClub(`tab-${value}`,true);
    }
    if (action === 'filter') {
      selection.filter = value; selection.detail = false; this.renderClub(`filter-${value}`);
      const list = document.getElementById('club-list'); if (list) list.scrollTop = 0;
    }
    if (action === 'back') { selection.detail = false; this.renderClub(`player-${selection.player}`); }
    if (action === 'rename-edit') { if (this.clubLockReason()) return; selection.rename = true; selection.nameDraft = this.club.teamName; selection.nameError = ''; this.renderClub('club-name'); }
    if (action === 'rename-cancel') { selection.rename = false; selection.nameDraft = null; selection.nameError = ''; this.renderClub('rename-edit'); }
    if (action === 'increase' || action === 'decrease') this.clubAdjust(value,action === 'increase' ? 1 : -1);
    if (action === 'draft-return' && this.clubDraft) { selection.tab = 'roster'; selection.filter = 'all'; selection.player = this.clubDraft.playerId; selection.players.roster = selection.player; selection.compare = 'none'; selection.detail = true; this.renderClub('detail-heading',true); }
    if (action === 'draft-reset' && !this.clubBusy) { this.clubDraft = null; this.clubNoticeType = 'status'; this.clubNotice = '미적용 배분을 취소했어요.'; this.renderClub(`allocation-${selection.stat}`); }
    if (action === 'assign') this.clubAction('assign', { role:value, playerId:selection.player });
    if (action === 'allocate' && this.clubDraft) this.clubAction('allocate', { playerId:this.clubDraft.playerId, allocations:{ ...this.clubDraft.allocations }, revision:this.clubDraft.revision });
    if (action === 'recruit') this.clubAction('recruit', { playerId:selection.player });
    if (action === 'refresh') this.clubAction('refresh');
    if (action === 'reward') this.callbacks.onRewardRetry?.();
  }

  async clubAction(action, payload = {}) {
    if (this.clubBusy) return;
    const isAllocation = action === 'allocate', reason = action === 'refresh' ? '' : this.clubLockReason(isAllocation);
    if (reason || (isAllocation && (!this.clubDraft || this.clubDraft.playerId !== payload.playerId || this.clubDraftStale()))) {
      this.clubNoticeType = 'status'; this.clubNotice = reason || '팀 정보가 바뀌었어요. 미적용 배분을 취소한 뒤 다시 정해 주세요.'; this.renderClub(); return;
    }
    const submittedDraft = isAllocation ? this.clubDraft : null;
    this.clubBusy = true; this.clubNoticeType = 'status'; this.clubNotice = ''; this.renderClub();
    let focus = null;
    try {
      const result = await this.callbacks.onClubAction?.(action, payload);
      if (result?.view) { this.club = { ...this.club, ...result.view }; this.clubNotice = result.view.message || ''; this.updateStartButtons(); }
      if (isAllocation && result?.changed && this.clubDraft === submittedDraft) {
        this.clubDraft = null; this.clubNotice = '능력치 배분을 저장했어요. 다음 경기부터 적용돼요.'; focus = `allocation-${this.clubSelection.stat}`;
      }
      if (action === 'rename' && result) { this.clubSelection.rename = false; this.clubSelection.nameDraft = null; this.clubSelection.nameError = ''; focus = 'rename-edit'; }
      if (action === 'recruit' && result?.changed) {
        this.clubSelection.tab = 'roster'; this.clubSelection.filter = 'all'; this.clubSelection.player = payload.playerId; this.clubSelection.players.roster = payload.playerId; this.clubSelection.detail = true; this.clubSelection.compare = 'none';
        this.clubNotice = '선수를 영입했어요. 아래에서 선발로 배치할 수 있어요.'; focus = 'detail-heading';
      }
    } catch (error) {
      this.clubNotice = error.message || '변경을 저장하지 못했어요. 다시 확인해 주세요.';
      if (action === 'rename' && error.kind === 'validation') { this.clubSelection.nameError = this.clubNotice; focus = 'club-name'; }
    } finally {
      this.clubBusy = false; this.renderClub(focus,action === 'recruit');
    }
  }

  helpContent() {
    return this.controlText(`<p class="lead-note">내 선수는 언제나 공격수.<br>동료의 토스에 맞춰 거리, 점프 높이, 발차기 타이밍을 잡으세요.</p>
      <h3>동료가 받아 올리면, 내가 마무리해요</h3>
      <p>리시버는 뒤쪽, 세터는 중앙, 내 공격수는 앞쪽에서 시작해요. 동료가 리시브와 토스를 연결하면, 앞쪽 공격수로 타점에 맞춰 이동하고 점프·발차기를 직접 조작해요. AI 공격수도 수비 중에는 앞쪽에서 다음 토스를 준비해요. 스파이크 연습도 같은 대형에서 네 가지 발차기를 반복해 익힐 수 있어요.</p>
      <h3>동료는 언제 토스하고, 언제 넘기나요?</h3>
      <p>기본 연결은 <strong>리시브 담당 → 세터 → 공격수</strong>예요. 우리 팀이 이미 두 번 받았다면 다음이 마지막인 세 번째 터치이므로 상대 코트로 넘겨요. 공격수가 넘어져 회복 중이거나 멀리 떨어져 있으면 가까운 동료에게 이어서 공을 살려요. 서브도 상대 코트로 보내요.</p>
      <p>점수판 아래에서 어느 팀의 몇 번째 터치인지, 누구에게 토스하는지와 그 이유를 확인하세요. 토스를 시도해도 발이나 정강이에 빗맞으면 공이 상대 코트로 넘어갈 수 있어요. 이때는 <strong>토스가 길어 넘어간 경우</strong>와 <strong>마지막 터치라 넘기는 경우</strong>를 구분해 알려줘요.</p>
      <h3>기본 조작</h3>
      <div class="control-row"><kbd>${this.coarse.matches ? '왼쪽 패드' : 'W A S D'}</kbd><span><strong>화면 방향으로 이동</strong><small>${this.coarse.matches ? '가려는 방향으로 밀고, 손을 떼면 멈춰요.' : 'W·S는 화면 앞뒤, A·D는 좌우예요.'} 공중에서도 조금 움직일 수 있어요.</small></span></div>
      <div class="control-row"><kbd>${this.coarse.matches ? '점프' : 'Space'}</kbd><span><strong>누르는 즉시 점프</strong><small>일찍 떼면 낮게, 길게 누르면 높게 뛰어요.</small></span></div>
      <div class="control-row"><kbd>좌클</kbd><span><strong>누르는 동안 발에 힘</strong><small>누르는 즉시 발이 공을 향해 움직이고, 누르는 동안 힘을 계속 줘요. 짧게 눌러 툭 받거나 길게 유지해 힘을 더하세요.</small></span></div>
      ${this.coarse.matches ? '<p>카메라는 공과 내 선수를 따라가요. 설정의 ‘시점 초기화’로 기본 시점으로 돌아올 수 있어요.</p>' : '<div class="control-row"><kbd>우클 드래그</kbd><span><strong>카메라 각도 조절</strong><small>좌우로 돌리거나 위아래 각도를 바꿔 공과 발의 거리를 보세요. 이동도 바뀐 화면 방향을 따라가요. C를 누르면 기본 시점으로 돌아와요.</small></span></div>'}
      <h3>빈 공간은 내가 리시브해요</h3>
      <p>공격수로 빈 공간에 이동한 뒤 지상에서 좌클을 누르면 직접 받아 올려요. 가까운 공은 쿠션 리시브, 옆 공은 다리를 뻗는 런지로 받아요. 낮고 먼 수비 공을 향해 이동하면서 좌클을 유지하면 닿을 수 있는 범위에서 슬라이딩으로 이어져요. 버튼을 놓으면 추가 발 구동이 멈추고 몸의 관성은 남아요.</p>
      <p>유저가 실제로 받을 수 있는 위치에서 준비하면 AI 동료가 후속 공을 커버해요. 방향을 바꾸거나 놓치면 AI가 다시 받으러 들어와요. 아군 세터의 정상 공격 토스에는 슬라이딩이 나가지 않으며, 점프 발차기는 스파이크와 블로킹으로 이어져요. 점수판 아래 안내와 수비 표식에서 현재 받을 선수를 확인하세요.</p>
      <p>리시브 때부터 계속 누르면 받아 올릴 방향을 이어가므로, 직접 받은 뒤에는 좌클을 놓고 공격 자리로 돌아와 세터 토스에 맞춰 새로 좌클을 누른 채 점프하거나 점프한 뒤 눌러 공격을 준비하세요.</p>
      <h3>땅에서는 받아 올리고, 공중에서는 내려찍기</h3>
      <p>지상에서 발차기하면 공을 받아 올려요. 좌클을 미리 누른 채 점프하면 올려둔 발을 이어서 내려찍어요. 점프한 뒤 누르면 공까지의 거리·높이와 현재 몸 자세에 맞춰 사선 회전, 가위치기, 540도 회전으로 이어져요. 발이 아직 낮으면 올릴 시간이 필요해요. 점프와 발차기를 함께 눌러도 돼요.</p>
      <p>공중 발차기는 타점에 맞춰 자세를 조절하고, 거리가 조금 모자라면 정해진 한도 안에서 실제 다리가 부드럽게 늘어나요. 누르는 동안 준비한 길이를 유지하고, 차고 난 뒤나 버튼을 놓으면 서서히 돌아와요. 화면에 보이는 발이 실제로 공에 닿아야 맞아요. 발이 도착할 시간을 남겨 두고 점프와 좌클을 시작하세요. 큰 거리 차이와 너무 늦은 입력은 빗나갈 수 있어요.</p>
      <p>발차기 뒤에는 몸이 흐트러진 채 떨어질 수 있어요. 바닥에 닿으면 스스로 균형을 회복하고 일어나요. 동료는 같은 규칙으로 리시브하고 공을 살려요.</p>
      <h3>네 가지 발차기를 연습해요</h3>
      <p><strong>상황에 맞춰 차기:</strong> 경기처럼 공과 몸의 위치에 따라 동작을 골라요. 한 가지를 반복하려면 연습할 동작 메뉴에서 선택하세요. 조작은 모두 같은 점프와 발차기 버튼이에요.</p>
      ${TAKRAW_TRAINING_LESSONS.filter(lesson => lesson.id !== 'auto').map(lesson => `<p><strong>${lesson.title}:</strong> ${lesson.sequence}. ${lesson.detail}</p>`).join('')}
      <p>바닥 발자국에서 이동을 멈추고, 고리가 닫히면 점프하세요. 내려찍기는 먼저 좌클을 유지하고, 다른 회전킥은 점프 뒤 공중 타점의 고리에 맞춰 좌클을 유지해요. 낮은 공은 점프를 짧게, 높은 공은 길게 누르세요. 시도가 끝나면 결과를 보고 자동으로 이어지는 토스나 ‘다시 토스’로 반복하세요.</p>
      <h3>공의 높이와 거리 읽기</h3><p>카메라는 우리 팀 뒤에서 공격수와 공을 함께 보여줘요. 공 아래 바닥 링으로 앞뒤·좌우 위치를, 공까지 이어지는 점선과 눈금으로 높이를 확인하세요. 점프할 때 카메라가 몸을 따라 위로 올라가지 않아 공과 발의 높이를 비교할 수 있어요.</p>
      <p>바닥의 발자국은 점프를 준비할 위치, 공중의 작은 십자는 예상 타점이에요. 발자국 안에 자리 잡고 점프 시점이 가까워지면 둘레가 밝은 원으로 이어져요. 공이 다른 선수나 네트에 닿으면 예상 위치도 바뀌어요. 표시는 준비를 돕는 안내이며, 점프 높이와 발차기 타이밍은 직접 맞춰야 해요.</p>
      <h3>경기 규칙</h3><ul class="rule-list"><li>각 진영에 선수 3명. 유저는 자기 팀 공격수 한 명을 조작하고, 동료 두 명은 AI가 움직여요.</li><li>손·팔을 제외한 신체 부위로 공을 넘겨요. 한 팀은 최대 3번까지 공에 닿을 수 있어요.</li><li>공이 코트 바닥에 닿거나, 상대 코트 밖으로 나가거나, 팀이 네 번 터치하면 점수가 나요.</li><li>네트에 몸이 닿으면 반칙이에요. 서브는 점수마다 번갈아 해요.</li><li>15점을 먼저 얻으면 세트 승리. 14 대 14에서는 17점을 먼저 얻는 팀이 이겨요. 두 세트를 먼저 이기면 경기 승리예요.</li></ul>
      <h3>로컬 2인 · 두 번째 플레이어</h3><p>두 번째 플레이어는 코랄 팀 공격수를 조작해요. 두 사람 모두 같은 화면 방향으로 움직여요.</p><p class="key-tip"><kbd>방향키</kbd> 이동 · <kbd>Enter</kbd> 또는 <kbd>숫자패드 0</kbd> 점프<br><kbd>오른쪽 Shift</kbd> 발차기</p>
      <h3>터치 화면</h3><p>왼쪽 스틱으로 이동하고 오른쪽 점프·발차기 버튼을 누르세요. 두 버튼을 함께 누를 수 있어요. 가로 화면에서 코트와 공의 높이를 보기 편해요.</p>
      <h3>내 팀을 꾸려요</h3><p>내 팀 관리에서 선수를 선택해 리시버·세터·공격수에 편성하고, 훈련과 스카우트로 선수단을 성장시키세요. 선발 선수를 다른 자리에 배치하면 두 선수가 자리를 바꿔요. 후보 선수를 넣으면 기존 선발은 후보가 돼요. 추천 역할과 관계없이 세 자리에 자유롭게 배치할 수 있어요.</p>
      <p>능력치 50이 기본이며 100까지 훈련해요. 1 P를 사용하면 선택한 능력치가 2 올라요. AI 대전을 끝내면 승리 180 C·3 P, 패배 100 C·2 P를 받아요. 경기 도중 나가기, 연습, 로컬·온라인 대전에는 보상이 없어요. 내 편성과 훈련은 새 AI 대전·연습에 적용되고, 로컬·온라인은 양 팀 모두 기본 능력치로 경기해요.</p>
      <p>팀은 현재 브라우저에 저장돼요. 이름 저장·편성·훈련·영입·경기 보상 완료 시 저장하며, 계정이나 다른 기기로 자동 동기화하지 않아요. 다른 탭에서 변경했다면 최신 저장을 불러오세요. 보상 저장에 실패하면 재시도 버튼을 사용하세요. 저장 완료 전에 탭을 닫으면 미저장 보상을 잃을 수 있어요.</p>
      <details class="diagnostics"><summary>실행 정보 · 문제 신고에 사용</summary><p>문제가 생긴 화면의 상태를 복사해 전달할 수 있어요.</p><div class="dialog-actions"><button type="button" class="secondary-small" data-dialog-action="diagnostics-refresh">새로고침</button><button type="button" class="secondary-small" data-dialog-action="diagnostics-copy">실행 정보 복사</button></div><pre id="diagnostics-output">실행 정보를 준비하고 있어요.</pre></details>`);
  }

  settingsContent() {
    return `<div class="settings-row"><div><strong>효과음</strong><small>발끝의 접촉과 랠리의 리듬</small></div><button type="button" class="toggle-button" role="switch" aria-label="효과음" aria-checked="${this.settings.sound}" data-dialog-action="sound"></button></div>
      <div class="settings-row"><div><strong>화면 품질</strong><small>느린 기기에서는 가볍게</small></div><div class="segmented" role="group" aria-label="화면 품질"><button type="button" class="${this.settings.quality === 'low' ? 'selected' : ''}" aria-pressed="${this.settings.quality === 'low'}" data-dialog-action="quality" data-value="low">가볍게</button><button type="button" class="${this.settings.quality === 'high' ? 'selected' : ''}" aria-pressed="${this.settings.quality === 'high'}" data-dialog-action="quality" data-value="high">선명하게</button></div></div>
      <div class="settings-row"><div><strong>카메라</strong><small>${this.coarse.matches ? '공과 선수를 따라가는 기본 시점' : '우클릭 드래그로 회전 · C로 기본 시점'}</small></div><button type="button" class="secondary-small" data-dialog-action="camera-reset">시점 초기화</button></div>
      <p class="key-tip">화면 품질을 바꿔도 공의 움직임과 경기 규칙은 같아요.</p><div class="dialog-actions"><button type="button" class="primary-small" data-dialog-action="close">완료</button></div>`;
  }

  pauseContent() {
    return `<div class="pause-menu"><button type="button" class="primary-small" data-dialog-action="close">경기 계속하기</button>${this.mode !== 'online' ? '<button type="button" class="secondary-small" data-dialog-action="restart">처음부터 다시</button>' : '<p class="key-tip">온라인 경기에서는 메뉴를 열어도 상대의 경기가 계속돼요.</p>'}<button type="button" class="secondary-small" data-dialog-action="quit">처음 화면으로</button></div>`;
  }

  networkContent() {
    return `<p>방을 만들고 코드를 친구에게 전달하세요.<br>한 명이 들어오면 1대1 경기가 시작돼요.</p><div class="network-form"><button type="button" class="primary-small" data-dialog-action="host">새 방 만들기 <span aria-hidden="true">＋</span></button></div><div class="network-divider">또는 코드로 참가</div>
      <form id="join-form" class="network-form"><label for="room-input">친구에게 받은 방 코드</label><input id="room-input" class="network-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="numeric" maxlength="4" placeholder="4자리 방 코드"><button type="button" class="secondary-small" data-dialog-action="join">방에 참가하기</button></form>
      <div id="room-status" class="room-status" role="status" hidden><strong id="network-phase" class="network-phase">연결 준비</strong><span id="room-status-message"></span><div id="room-code-line" class="room-code-line" hidden><input id="room-code" aria-label="내 방 코드" readonly><button type="button" data-dialog-action="copy-code">복사</button></div><small id="network-hint" class="network-hint" hidden></small></div>
      <p class="room-help">양쪽 모두 블룸 세팍타크로 ${TAKRAW_VERSION}로 접속해야 해요. HTTPS 사이트 사용을 권장합니다. 네트워크에 따라 WebRTC 연결이 제한될 수 있어요.</p>
      <details class="network-debug"><summary>연결 진단</summary><pre id="network-log" aria-label="최근 연결 이벤트"></pre><button type="button" class="secondary-small" data-dialog-action="copy-network-log">진단 복사</button></details>
      <div class="dialog-actions"><button type="button" class="primary-small" data-dialog-action="resume" id="resume-room" hidden>이전 경기 다시 연결</button><button type="button" class="secondary-small" data-dialog-action="close-network">연결 닫기</button></div>`;
  }

  dialogClick(event) {
    const clubButton = event.target.closest('[data-club-action]');
    if (clubButton) { this.clubClick(clubButton); return; }
    const button = event.target.closest('[data-dialog-action]'); if (!button) return;
    const action = button.dataset.dialogAction;
    if (action === 'close') this.closeDialog();
    if (action === 'restart') { this.callbacks.onRestart?.(); this.closeDialog(); }
    if (action === 'quit') this.quit();
    if (action === 'sound') { this.settings.sound = !this.settings.sound; button.setAttribute('aria-checked', String(this.settings.sound)); this.callbacks.onSetting?.('sound', this.settings.sound); }
    if (action === 'camera-reset') this.callbacks.onCameraReset?.();
    if (action === 'quality') {
      this.settings.quality = button.dataset.value;
      for (const option of button.parentElement.children) { const selected = option.dataset.value === this.settings.quality; option.classList.toggle('selected', selected); option.setAttribute('aria-pressed', String(selected)); }
      this.callbacks.onSetting?.('quality', this.settings.quality);
    }
    if (action === 'host') this.callbacks.onNetwork?.('host');
    if (action === 'resume') this.callbacks.onNetwork?.('resume');
    if (action === 'join') {
      const input = document.getElementById('room-input'), code = input.value.trim();
      if (!code) { input.focus(); input.setCustomValidity('방 코드를 입력하세요.'); input.reportValidity(); input.setCustomValidity(''); return; }
      this.callbacks.onNetwork?.('join', code);
    }
    if (action === 'close-network') { this.callbacks.onNetwork?.('close'); this.hideDialog(true); this.setRoute(this.inGame ? 'play' : ''); }
    if (action === 'copy-code') this.copyText(this.network.code, button);
    if (action === 'copy-network-log') this.copyText(document.getElementById('network-log')?.textContent || '', button);
    if (action === 'diagnostics-refresh') this.refreshDiagnostics();
    if (action === 'diagnostics-copy') { this.refreshDiagnostics(); this.copyText(document.getElementById('diagnostics-output').textContent, button); }
  }

  async copyText(value, button) {
    const label = button.textContent;
    try { await navigator.clipboard.writeText(value); button.textContent = '복사했어요'; }
    catch { const input = document.getElementById('room-code'); if (input && value === this.network.code) { input.focus(); input.select(); } button.textContent = '내용을 선택해 복사하세요'; }
    if (this.copyTimer) window.clearTimeout(this.copyTimer);
    this.copyTimer = window.setTimeout(() => { if (button.isConnected) button.textContent = label; this.copyTimer = null; }, 1800);
  }

  refreshDiagnostics() {
    const node = document.getElementById('diagnostics-output'); if (!node) return;
    try { node.textContent = JSON.stringify(this.callbacks.onDiagnostics(), null, 2); }
    catch (error) { node.textContent = `실행 정보 조회 오류: ${error.message}`; }
  }

  setNetwork(value) {
    this.network = value; this.renderNetwork();
    const indicator = this.nodes['connection-indicator']; indicator.hidden = ['idle','closed',''].includes(this.network.state);
    indicator.querySelector('span').textContent = this.network.state === 'connected' ? '친구와 연결됨' : this.network.message || '연결 준비 중';
    indicator.querySelector('i').style.background = this.network.state === 'error' ? '#ba6548' : this.network.state === 'connected' ? '#238468' : '#c69a49';
  }

  renderNetwork() {
    if (this.dialog !== 'network') return;
    const status = document.getElementById('room-status'); status.hidden = !this.network.message && !this.network.code;
    status.classList.toggle('error', this.network.state === 'error');
    document.getElementById('room-status-message').textContent = this.network.message || '친구를 기다리고 있어요.';
    document.getElementById('network-phase').textContent = this.network.phase || '연결 상태';
    const hint = document.getElementById('network-hint');
    hint.hidden = !this.network.hint;
    hint.textContent = this.network.hint || '';
    const log = document.getElementById('network-log');
    if (log) log.textContent = this.network.diagnostics || '연결 기록이 없어요.';
    document.getElementById('room-code-line').hidden = !this.network.code;
    document.getElementById('room-code').value = this.network.code || '';
    document.getElementById('resume-room').hidden = !this.network.canResume || this.network.state === 'connecting';
    const busy = ['connecting','listening','connected'].includes(this.network.state);
    for (const button of this.nodes['dialog-content'].querySelectorAll('[data-dialog-action="host"],[data-dialog-action="join"]')) button.disabled = busy;
    document.getElementById('join-form').onsubmit = event => { event.preventDefault(); this.nodes['dialog-content'].querySelector('[data-dialog-action="join"]').click(); };
  }

  text(id, value) {
    const string = value == null ? '' : String(value); if (this.cache.get(id) === string) return;
    this.cache.set(id, string); const node = document.getElementById(id); if (node) node.textContent = string;
  }

  /**
   * 접촉 타이밍 등급을 표시한다. 반환된 토큰으로 hideTiming하면 그 표시만 지운다.
   * 짧은 간격의 접촉이 겹쳐도 먼저 끝난 표시가 나중 표시를 지우지 않는다.
   */
  showTiming(timing) {
    const labels = { perfect: '퍼펙트', good: '굿' };
    const label = labels[timing.grade] || (timing.error < 0 ? '빠름' : '늦음');
    const milliseconds = Math.round(timing.error * 1000);
    const badge = document.getElementById('timing-badge');
    this.text('timing-grade', label);
    this.text('timing-offset', `${milliseconds > 0 ? '+' : ''}${milliseconds}ms`);
    badge.dataset.grade = timing.grade;
    badge.hidden = false;
    badge.style.animation = 'none'; void badge.offsetWidth; badge.style.animation = '';
    this.timingToken = { grade: timing.grade };
    return this.timingToken;
  }

  hideTiming(token) {
    if (!token || this.timingToken !== token) return;
    this.timingToken = null;
    document.getElementById('timing-badge').hidden = true;
  }

  update(hud) {
    if (!hud) return;
    this.text('score-0', hud.score?.[0] ?? 0); this.text('score-1', hud.score?.[1] ?? 0);
    this.text('set-number', this.mode === 'training' ? '높은 토스 · 네 가지 발차기' : `${hud.set ?? 1}세트`);
    for (let team = 0; team < 2; team++) { const count = hud.sets?.[team] ?? 0, node = document.getElementById(`sets-${team}`); for (let i = 0; i < node.children.length; i++) node.children[i].classList.toggle('won', i < count); node.setAttribute('aria-label', `${count}세트 획득`); }
    const phases = { ready:'서브 준비', rally:'랠리 진행 중', point:'다음 랠리 준비', finished:'경기 종료' };
    this.text('rally-status', this.mode === 'training' ? '스파이크 연습' : phases[hud.phase] || '경기 준비');
    const touch = document.querySelector('#touch-indicator b'), touches = String(hud.touches ?? 0); if (touch.textContent !== touches) touch.textContent = touches;
    this.text('touch-team', hud.possession === 0 || hud.possession === 1 ?
      `${hud.possession === hud.localTeam ? '우리 팀' : '상대 팀'} 터치` : '터치');
    const teamPlay = hud.teamPlay, notice = teamPlay?.title || hud.lastMessage || '';
    this.text('rally-notice', notice);
    this.text('rally-detail', this.controlText(teamPlay?.detail || ''));
    const callout = document.getElementById('rally-callout'), tone = teamPlay?.tone || 'neutral';
    callout.hidden = !notice;
    if (callout.dataset.tone !== tone) callout.dataset.tone = tone;
    this.text('selected-name', hud.selectedName || '공격수');
    if (hud.teamNames && !['local', 'online'].includes(this.mode)) {
      this.text('team-label-0', hud.teamNames[0]); this.text('team-label-1', hud.teamNames[1]);
    }
    this.text('selected-state', hud.selectedState || '준비');
    document.getElementById('jump-light').classList.toggle('held', !!hud.jumpHeld); document.getElementById('kick-light').classList.toggle('held', !!hud.kickHeld);
    if (this.mode === 'training' && hud.training) this.updateTraining(hud.training);
    const ended = hud.phase === 'finished'; this.nodes['end-actions'].hidden = !ended;
    this.text('match-reward', hud.matchReward?.message || '');
    document.getElementById('reward-retry').hidden = hud.matchReward?.status !== 'error';
    if (ended) this.text('match-result', this.mode === 'local' ? `${hud.matchWinner === 0 ? '1P' : '2P'} 팀 승리` : this.mode === 'online' ? `${hud.matchWinner === 0 ? '청록' : '코랄'} 팀 승리` : hud.matchWinner === 0 ? '우리 팀 승리!' : '다음 경기를 노려봐요');
  }

  updateTraining(training) {
    const downward = training.lesson === 'downward';
    const lessonSelect = document.getElementById('training-lesson');
    if (lessonSelect.value !== training.lesson) lessonSelect.value = training.lesson;
    this.text('training-sequence', this.controlText(training.sequence));
    this.text('training-motion', training.motionStatus);
    this.text('training-count', `${Math.max(1, training.attempt || 0)}번째 토스`);
    const stages = { ready: '토스 준비', set: '세터의 토스', position: '자리 잡기', brake: '이동 멈추기', jump: '점프 타이밍', kick: '발차기 타이밍', contact: '타격', result: '이번 시도' };
    this.text('training-stage', stages[training.stage] || training.title || '스파이크 연습');
    this.text('training-cue', this.controlText(training.cue));
    this.text('training-detail', this.controlText(training.detail));
    this.text('training-successes', `성공 ${training.successes || 0}회`);
    const coach = document.getElementById('training-coach');
    const tone = training.tone || 'neutral';
    if (coach.dataset.tone !== tone) coach.dataset.tone = tone;
    const progress = Math.round(Math.max(0, Math.min(1, Number(training.progress) || 0)) * 100);
    const timing = document.getElementById('training-timing');
    if (timing.getAttribute('aria-valuenow') !== String(progress)) {
      timing.setAttribute('aria-valuenow', String(progress));
      timing.style.setProperty('--timing', `${progress}%`);
    }
    let label = '바닥 발자국과 공중 타점을 확인하세요';
    if (training.stage === 'ready' || training.stage === 'set') label = '세터가 공을 올리는 중';
    else if (training.stage === 'result') label = '잠시 후 다음 토스';
    else if (training.stage === 'contact') label = '실제 타격 결과를 확인하는 중';
    else if (training.stage === 'brake') label = '이동을 놓고 자세를 잡으세요';
    else if (training.stage === 'jump') label = training.shortJump ? '점프 버튼을 짧게 누르고 떼세요' : '점프 버튼을 눌러 유지하세요';
    else if (training.stage === 'kick' && training.tone === 'retry') label = '현재 높이와 발까지의 거리를 확인하세요';
    else if (training.stage === 'kick' && !downward) label = Number.isFinite(training.kickIn) && training.kickIn > 0 ? `발차기까지 ${(Math.ceil(training.kickIn * 10) / 10).toFixed(1)}초` : '좌클을 유지하세요';
    else if (Number.isFinite(training.jumpIn) && training.jumpIn > 0) label = `점프까지 ${(Math.ceil(training.jumpIn * 10) / 10).toFixed(1)}초`;
    else if (training.stage === 'kick') label = '좌클을 유지한 채 점프하세요';
    this.text('training-timing-label', this.controlText(label));
    timing.setAttribute('aria-valuetext', this.controlText(label));
  }

  dispose() { this.releaseTouch(); if (this.copyTimer) window.clearTimeout(this.copyTimer); this.controller.abort(); }
}

export { TakrawUI };
