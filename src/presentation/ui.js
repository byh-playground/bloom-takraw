import { TAKRAW_ELEMENTS, TAKRAW_SCHOOLS, takrawOpponents, takrawSchool } from '../config/schools.js';
import { takrawMatchStatus } from './match-status.js';
import { TAKRAW_RUNTIME } from '../config/runtime.js';
import { TAKRAW_VERSION, TAKRAW_GAME_NAME, TAKRAW_PRODUCT_NAME, TAKRAW_CONFIG } from '../config/game.js';
import { TAKRAW_CLUB_RULES, takrawTrainingFactor } from '../club/club.js';
import { TAKRAW_TRAINING_LESSONS, TAKRAW_TRAINING_TEMPOS } from '../simulation/game.js';

/** 처음 화면의 안쪽 단계와 그 부모 주소. 뒤로 버튼·Esc·브라우저 뒤로가 같은 길을 간다. */
const HOME_PARENT = { start: '', multi: 'start' };

/** 뽑기 연출에서 카드팩이 흔들리는 시간(ms). 건너뛰기·움직임 줄이기는 이 구간을 건너뛴다. */
const TAKRAW_DRAW_PACK_MS = 1500;

/** 후보 카드를 왼쪽으로 밀 때: 판매 버튼이 드러나는 폭(px)과, 이만큼(카드 폭 비율) 넘게 밀면 바로 파는 지점. */
const TAKRAW_SELL_REVEAL_PX = 96, TAKRAW_SELL_FULL_RATIO = 0.62;

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
    this.homeShown = false; this.homeView = 'main';
    this.copyTimer = null;
    this.cache = new Map();
    this.club = { status: 'loading', message: '팀을 불러오고 있어요.', roster: [], draw: { pending: null }, lineup: {}, record: {} };
    // pick: 편성 교체 중인 선택({ type: 'player' | 'slot', id }), detail: 능력치를 펼친 선수 id. 모두 화면 안에서만 산다.
    this.clubSelection = { tab: 'roster', pick: null, detail: null, rename: false, nameDraft: null, nameError: '', scroll: {} };
    this.campaignIntro = { step: 0, replay: false }; // 도장깨기 소개 카드: 몇 번째 장인지, 이미 본 뒤 다시 보는 중인지
    this.clubBusy = false; this.clubNotice = ''; this.drawStage = null; this.drawTimer = 0;
    this.nodes = {};
    for (const id of ['home-panel','match-hud','modal-layer','dialog-panel','dialog-title','dialog-kicker','dialog-content','boot-status','boot-message','reload-button','home-back','dialog-back','draw-stage','touch-controls','move-pad','move-thumb','local-guide','watch-form','training-actions','end-actions','connection-indicator']) this.nodes[id] = document.getElementById(id);
    this.coarse = window.matchMedia('(pointer: coarse)');
    this.text('version-label', TAKRAW_VERSION);
    for (const id of ['sets-0', 'sets-1']) document.getElementById(id).hidden = TAKRAW_CONFIG.rules.sets === 1;
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
    const watchSeed = () => document.getElementById('watch-seed');
    this.listen(document.getElementById('watch-form'), 'submit', event => { event.preventDefault(); this.callbacks.onWatch?.(watchSeed().value); });
    for (const button of document.querySelectorAll('[data-watch-step]')) this.listen(button, 'click', () => {
      watchSeed().value = Math.max(0, Number(watchSeed().value || 0) + Number(button.dataset.watchStep)); this.callbacks.onWatch?.(watchSeed().value);
    });
    const featured = document.getElementById('watch-featured');
    featured.replaceChildren(new Option('추천 경기', ''), ...TAKRAW_RUNTIME.watch.featured.map(item => new Option(`${item.seed} · ${item.label}`, item.seed)));
    this.listen(featured, 'change', () => { if (featured.value) { watchSeed().value = featured.value; this.callbacks.onWatch?.(featured.value); } });
    click('watch-random', () => { watchSeed().value = Math.floor(Math.random() * (TAKRAW_RUNTIME.watch.randomMax + 1)); this.callbacks.onWatch?.(watchSeed().value); });
    click('start-watch', () => this.start('watch'));
    click('open-campaign', () => this.navigate('campaign'));
    click('start-training', () => this.start('training'));
    click('start-local', () => this.start('local'));
    click('open-network', () => { this.callbacks.onStart?.('online'); this.navigate('network'); });
    for (const button of document.querySelectorAll('[data-home-go]')) this.listen(button, 'click', () => this.navigate(button.dataset.homeGo));
    click('home-back', () => this.navigate(HOME_PARENT[this.homeView]));
    click('dialog-back', () => this.navigate('club'));
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
    const tempoSelect = document.getElementById('training-tempo');
    tempoSelect.replaceChildren();
    for (const tempo of TAKRAW_TRAINING_TEMPOS) {
      const option = document.createElement('option');
      option.value = tempo.id; option.textContent = tempo.title;
      tempoSelect.appendChild(option);
    }
    this.listen(tempoSelect, 'change', () => this.callbacks.onTrainingTempo?.(tempoSelect.value));
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
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) this.listen(this.nodes['dialog-content'], type, event => this.swipe(type, event));
    this.listen(this.nodes['dialog-content'], 'keydown', event => this.swipeKey(event));
    this.listen(this.nodes['draw-stage'], 'click', event => this.drawClick(event));
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
      if (event.code === 'Escape' && this.drawStage) { event.preventDefault(); this.drawEscape(); return; }
      if (event.code === 'Escape') { event.preventDefault(); if (this.dialog === 'club' && this.clubSelection.detail) this.navigate('club'); else if (this.dialog) this.closeDialog(); else if (this.inGame) this.navigate('pause'); else if (this.homeView !== 'main') this.navigate(HOME_PARENT[this.homeView]); }
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

  /** 메인 화면의 계층(처음 → 게임 시작 → 멀티플레이) 중 보일 단계를 고른다. 한 번에 한 단계만 보이고, 뒤로 버튼은 헤더의 고정 자리에서 한 단계 위로 간다. */
  setHomeView(view, focus = true) {
    this.homeView = view; document.body.dataset.homeView = view;
    for (const node of document.querySelectorAll('[data-home-view]')) node.hidden = node.dataset.homeView !== view;
    this.nodes['home-back'].hidden = view === 'main';
    if (focus) document.querySelector(`[data-home-view="${view}"] button`)?.focus({ preventScroll: true });
  }

  /** 처음 화면에서 보이는 단계의 주소. 대화상자를 닫으면 이 단계로 돌아온다. */
  homeRoute() { return this.homeView === 'main' ? '' : this.homeView; }

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
    this.nodes['touch-controls'].hidden = !this.inGame || !this.coarse.matches || this.mode === 'watch';
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
    if (this.homeShown) this.setHomeView('main', false); // 부팅 중에 먼저 누른 단계는 첫 표시 때 유지한다
    const initialDialog = !this.homeShown && !this.inGame && ['settings','network','club','campaign'].includes(this.dialog) ? this.dialog : '';
    this.homeShown = true;
    this.releaseTouch(); this.inGame = false; this.hideDialog(false);
    document.body.classList.add('is-home'); document.body.dataset.mode = 'home';
    this.nodes['home-panel'].hidden = false; this.nodes['match-hud'].hidden = true; this.nodes['touch-controls'].hidden = true;
    this.nodes['connection-indicator'].hidden = true; this.nodes['watch-form'].hidden = true;
    // 소개영상 호스트는 부팅 직후 이 주소를 읽어 소개를 연다. 호스트가 붙기 전에 지우지 않는다.
    if (this.currentRoute() !== 'showcase') this.setRoute(initialDialog || this.homeRoute(), true);
    if (initialDialog) this.openDialog(initialDialog);
  }

  showGame(mode) {
    this.inGame = true; this.mode = mode; this.hideDialog(true); this.setHomeView('main', false);
    document.body.classList.remove('is-home'); document.body.dataset.mode = mode;
    this.nodes['home-panel'].hidden = true; this.nodes['match-hud'].hidden = false;
    this.nodes['touch-controls'].hidden = !this.coarse.matches || mode === 'watch'; this.nodes['watch-form'].hidden = mode !== 'watch'; this.nodes['training-actions'].hidden = mode !== 'training';
    this.nodes['local-guide'].hidden = mode !== 'local'; this.nodes['end-actions'].hidden = true;
    document.querySelector('.scoreboard').classList.toggle('is-training', mode === 'training');
    this.text('team-label-0', mode === 'local' ? '1P · 청록' : '우리 팀'); // 온라인·관전은 경기가 시작되면 알려 온 팀 이름·학교 이름으로 바뀐다
    this.text('team-label-1', mode === 'local' ? '2P · 코랄' : '상대 팀');
    this.text('match-type', { training: '스파이크 연습', match: 'AI 대전', local: '로컬 2인', online: '온라인 1대1', watch: 'AI 관전' }[mode]);
    this.setRoute('play'); this.canvas.focus({ preventScroll: true });
  }

  setRoute(route, replace = false) {
    const next = `#/${route}`;
    if (window.location.hash !== next) window.history[replace ? 'replaceState' : 'pushState'](null, '', next);
  }

  navigate(route) { this.setRoute(route); this.applyRoute(); }

  currentRoute() { return window.location.hash.replace(/^#\/?/, '').split('?')[0]; }

  applyRoute() {
    const route = this.currentRoute();
    if (route === 'showcase') return; // 소개영상 호스트가 이 주소를 소유한다.
    if (HOME_PARENT[route] !== undefined) {
      if (this.inGame) { this.setRoute('play', true); return; }
      this.hideDialog(true); this.setHomeView(route, false); return;
    }
    const [page, param] = route.split('/');
    if (['settings','pause','network','club','campaign'].includes(page)) {
      if (page === 'pause' && !this.inGame) { this.setRoute('', true); this.hideDialog(false); return; }
      const wasOpen = this.dialog === page, previous = this.clubSelection.detail;
      if (page === 'club') this.clubSelection.detail = param || null;
      this.openDialog(page);
      if (wasOpen && page === 'club') this.renderClub(param ? 'detail-heading' : `info-${previous}`, true);
    } else {
      if (!route && this.inGame) { this.quit(); return; }
      this.hideDialog(true);
      if (!route && !this.inGame) this.setHomeView('main', false);
      if ((route && route !== 'play') || (route === 'play' && !this.inGame)) this.setRoute(this.inGame ? 'play' : '', true);
    }
  }

  openDialog(route) {
    if (this.dialog === route) return;
    if (!this.dialog) { this.previousFocus = document.activeElement; this.releaseTouch(); if (this.inGame) this.callbacks.onPause?.(true); }
    this.dialog = route; this.nodes['modal-layer'].hidden = false; this.nodes['dialog-back'].hidden = true;
    const meta = { club:['선수단 · 편성 · 훈련','내 팀 관리'], settings:['내게 맞는 플레이','설정'], pause:[this.mode === 'online' ? '경기는 계속 진행돼요' : '잠깐 숨 고르기', this.mode === 'online' ? '경기 메뉴' : '일시 정지'], network:['둘이서, 하나의 코트','친구와 온라인 1대1'] }[route];
    this.nodes['dialog-panel'].classList.toggle('is-club', route === 'club');
    this.nodes['modal-layer'].classList.toggle('is-club-layer', route === 'club');
    const heading = meta || ['하나씩 도전하는 우리 팀', '도장깨기'];
    this.nodes['dialog-kicker'].textContent = heading[0]; this.nodes['dialog-title'].textContent = heading[1];
    this.nodes['dialog-content'].innerHTML = this[`${route}Content`](); this.nodes['dialog-content'].scrollTop = 0;
    if (route === 'network') this.renderNetwork();
    if (route === 'club') this.restoreClubPosition();
    queueMicrotask(() => {
      if (route !== 'club' || !this.restoreClubFocus()) document.getElementById('dialog-close').focus({ preventScroll: true });
    });
  }

  closeDialog() {
    if (this.dialog === 'network' && !this.inGame && ['listening','connecting'].includes(this.network.state)) this.callbacks.onNetwork?.('close');
    this.hideDialog(true); this.setRoute(this.inGame ? 'play' : this.homeRoute());
  }

  hideDialog(resume) {
    if (this.dialog === 'club') this.rememberClubPosition();
    if (this.drawStage) this.closeDrawStage();
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

  campaignUniform(school, big = false) {
    const hex = value => `#${value.toString(16).padStart(6, '0')}`;
    return `<span class="campaign-uniform ${big ? 'is-big' : ''}" aria-label="${this.escape(school.name)} 유니폼" style="--uniform-primary:${hex(school.uniform.primary)};--uniform-secondary:${hex(school.uniform.secondary)}"></span>`;
  }

  /**
   * 첫 도장깨기 소개 3장: 내 학교와 선발 → 앞으로 만날 학교는 모른다 → 첫 상대.
   * 학교가 모두 몇 곳인지, 다음 학교가 어디인지는 일부러 알려 주지 않는다(이길 때마다 하나씩 나타난다).
   */
  campaignIntroContent(home, first) {
    const intro = this.campaignIntro, step = intro.step, elementName = school => TAKRAW_ELEMENTS.find(element => element.id === school.element)?.name || '';
    const names = ['receiver', 'setter', 'attacker'].map(role => this.club.roster.find(player => player.id === this.club.lineup?.[role])?.name).filter(Boolean);
    const pages = [
      `<h3>우리 학교는 ${this.escape(home.name)}예요</h3><p>${elementName(home)} 속성의 학교예요. 선수 셋이면 충분해요.</p>
        <div class="intro-trio">${names.map(name => `<span>${this.campaignUniform(home, true)}<small>${this.escape(name)}</small></span>`).join('')}</div>`,
      `<h3>어떤 학교가 기다릴까요?</h3><p>이길 때마다 다음 학교가 모습을 드러내요.</p>
        <div class="intro-trio"><span class="campaign-uniform is-big is-mystery" role="img" aria-label="아직 모르는 학교"></span></div>`,
      `<h3>첫 상대는 ${this.escape(first.name)}</h3>
        <article class="campaign-card">${this.campaignUniform(first)}<div><h3>1단계 · ${this.escape(first.name)}</h3><p>${elementName(first)} 속성 · 도전 가능</p></div></article>
        <p>이기면 훈련 포인트를 받고, 다음 학교가 나타나요.</p>`,
    ];
    const last = step === pages.length - 1;
    return `<section class="campaign-intro" aria-label="도장깨기 소개 ${step + 1}/${pages.length}">
      <div class="intro-head"><button type="button" class="secondary-small" data-campaign-intro="skip">건너뛰기</button></div>
      ${pages[step]}
      <div class="intro-dots" aria-hidden="true">${pages.map((_, i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('')}</div>
      <button type="button" class="primary-small intro-next" data-campaign-intro="${last ? 'done' : 'next'}">${last ? '도전하기' : '다음'}</button></section>`;
  }

  campaignContent() {
    const cleared = new Set(this.club.campaign?.cleared || []), ready = this.club.status === 'ready' && !this.inGame;
    const home = takrawSchool(this.club.campaign?.home), elementName = school => TAKRAW_ELEMENTS.find(element => element.id === school.element)?.name || '';
    if (!home) return '<p>팀을 불러온 뒤 도전할 수 있어요.</p>';
    const list = takrawOpponents(home.id), count = list.filter(school => cleared.has(school.id)).length;
    if (this.club.status === 'ready' && (this.campaignIntro.replay || (!this.club.campaign.introSeen && count === 0))) return this.campaignIntroContent(home, list[0]);
    // 깬 학교와 지금 도전할 학교까지만 보여 준다. 그다음은 이름 없는 한 칸이고, 전체 단계 수는 어디에도 쓰지 않는다.
    const shown = list.slice(0, count + 1), hidden = count + 1 < list.length;
    const cards = shown.map(school => {
      const done = cleared.has(school.id);
      return `<article class="campaign-card">${this.campaignUniform(school)}<div><h3>${school.stage}단계 · ${this.escape(school.name)}</h3><p>${elementName(school)} 속성 · ${done ? '클리어' : '도전 가능'}</p><small>${done ? '훈련 포인트 수령 완료' : `첫 클리어 ${school.firstClearTrainingPoints} P · 임시 보상`}</small></div><button type="button" class="primary-small" data-campaign-school="${school.id}" ${!ready ? 'disabled' : ''}>${done ? '재도전' : '도전'}</button></article>`;
    }).join('');
    const mystery = hidden ? `<article class="campaign-card is-mystery"><span class="campaign-uniform is-mystery" aria-hidden="true"></span><div><h3>${count + 2}단계 · ???</h3><p>다음에 만날 학교</p></div><button type="button" class="primary-small" disabled>잠김</button></article>` : '';
    return `<p>내 학교는 <b>${this.escape(home.name)}</b>(${elementName(home)} 속성)예요. 이기면 다음 학교가 나타나요.</p><div class="campaign-list">${cards}${mystery}</div>${count === list.length ? '<p>모든 학교를 클리어했어요!</p>' : ''}<button type="button" class="secondary-small" data-campaign-intro="replay">소개 다시 보기</button>`;
  }

  /** 소개 카드 조작: 다음 장으로, 또는 마치고 저장한다(건너뛰기·도전하기 모두 '봤음'으로 저장). */
  async campaignIntroClick(action) {
    const intro = this.campaignIntro, render = () => { if (this.dialog === 'campaign') this.nodes['dialog-content'].innerHTML = this.campaignContent(); };
    if (action === 'next') { intro.step += 1; render(); return; }
    if (action === 'replay') { intro.step = 0; intro.replay = true; render(); return; }
    intro.step = 0; intro.replay = false; render();
    try {
      const result = await this.callbacks.onClubAction?.('campaign-intro');
      if (result?.view) this.club = { ...this.club, ...result.view };
    } catch { /* 저장하지 못해도 목록은 보인다. 다음에 다시 소개가 나올 수 있다. */ }
    render();
  }

  setClub(value) {
    this.club = value; this.updateStartButtons();
    const status = { loading:'팀을 불러오는 중', saving:'팀을 저장하는 중', conflict:'다른 탭에서 변경됨 · 최신 저장 불러오기', error:'팀 저장 확인 필요 · 관리에서 다시 불러오기' }[value.status];
    this.text('club-home-summary', status || (value.teamName ? `${value.teamName} · 선수 ${value.roster.length}명` : '선수단 · 편성 · 훈련'));
    if (this.dialog === 'club') this.renderClub();
    if (this.dialog === 'campaign') {
      const content = this.nodes['dialog-content'], scroll = content.scrollTop;
      content.innerHTML = this.campaignContent(); content.scrollTop = scroll;
    }
  }

  rememberClubPosition() {
    const content = this.nodes['dialog-content'];
    this.clubSelection.scroll = Object.fromEntries(['club-list','club-detail'].map(id => [id, document.getElementById(id)?.scrollTop || 0]));
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
      next = [find('detail-heading'), find(`tab-${this.clubSelection.tab}`)].find(usable);
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
    this.nodes['dialog-back'].hidden = !document.getElementById('club-detail');
    const nextName = document.getElementById('club-name');
    if (caret && nextName && !nextName.disabled) {
      nextName.focus({ preventScroll: true }); nextName.setSelectionRange(...caret);
    } else this.restoreClubFocus();
    this.restoreClubPosition();
  }

  clubRoleName(role) { return TAKRAW_CLUB_RULES.roles.find(value => value.id === role)?.name || '후보'; }
  clubLockReason() {
    if (this.inGame) return '팀 변경은 처음 화면에서 할 수 있어요.';
    if (this.clubBusy || this.club.status === 'saving') return '팀을 저장하고 있어요.';
    if (this.club.status !== 'ready') return this.club.message || '팀을 먼저 불러와 주세요.';
    return '';
  }

  clubShirt(player) {
    const number = player.number;
    return `<span class="club-shirt" data-role="${player.preferredRole}" aria-hidden="true"><svg viewBox="0 0 64 72"><path d="M20 5 12 9 2 23 14 33 19 27 18 65H46L45 27 50 33 62 23 52 9 44 5C42 11 37 14 32 14S22 11 20 5Z" fill="currentColor" stroke="none"/><path d="M20 5C22 12 27 16 32 16S42 12 44 5M20 26V61M44 26V61" fill="none" stroke="rgba(255,255,255,.42)" stroke-width="2"/><text x="32" y="46" fill="#fff" stroke="none" text-anchor="middle" font-size="22" font-weight="750">${String(number).padStart(2,'0')}</text></svg></span>`;
  }

  /** 가장 큰 능력치가 바깥 고리에 닿도록 눈금 상한을 25 단위로 올린다(기본 100). */
  clubScaleTop(stats) { return Math.max(100, Math.ceil(Math.max(...Object.values(stats)) / 25) * 25); }

  clubRadar(player, stats) {
    const axes = TAKRAW_CLUB_RULES.stats, center = { x:180, y:151 }, radius = 94, top = this.clubScaleTop(stats), rings = [1, 2, 3, 4].map(step => top * step / 4);
    const point = (index, value, scale = radius) => {
      const angle = -Math.PI / 2 + index * Math.PI * 2 / axes.length;
      return { x:center.x + Math.cos(angle) * scale * value / top, y:center.y + Math.sin(angle) * scale * value / top };
    };
    const polygon = values => axes.map((stat, index) => { const p = point(index, values[stat.id]); return `${p.x.toFixed(2)},${p.y.toFixed(2)}`; }).join(' ');
    const grids = rings.map(value => `<polygon points="${polygon(Object.fromEntries(axes.map(stat => [stat.id,value])))}"/>`).join('');
    const spokes = axes.map((stat, index) => { const p = point(index,top); return `<line x1="${center.x}" y1="${center.y}" x2="${p.x}" y2="${p.y}"/>`; }).join('');
    const labels = axes.map((stat,index) => {
      const p = point(index,top,126), anchor = Math.abs(p.x - center.x) < 12 ? 'middle' : p.x > center.x ? 'start' : 'end';
      return `<text class="radar-label" x="${p.x}" y="${p.y - 4}" text-anchor="${anchor}">${this.escape(stat.name)}</text><text class="radar-value" x="${p.x}" y="${p.y + 15}" text-anchor="${anchor}">${stats[stat.id]}</text>`;
    }).join('');
    const dots = axes.map((stat,index) => { const p = point(index,stats[stat.id]); return `<circle cx="${p.x}" cy="${p.y}" r="3.5"/>`; }).join('');
    const description = axes.map(stat => `${stat.name} ${stats[stat.id]}`).join('. ');
    return `<svg class="club-radar" viewBox="0 0 360 310" role="img" aria-labelledby="club-radar-title club-radar-description">
      <title id="club-radar-title">${this.escape(player.name)} 능력치</title><desc id="club-radar-description">0부터 ${top}까지 같은 눈금. ${this.escape(description)}.</desc>
      <g class="radar-grid">${grids}</g><g class="radar-axis">${spokes}</g>
      <g class="radar-baseline">${rings.map(value => `<text class="radar-ring-label" x="185" y="${center.y - radius * value / top + 4}">${value}</text>`).join('')}<text class="radar-ring-label" x="185" y="164">0</text></g>
      <polygon class="radar-current" points="${polygon(stats)}"/><g class="radar-dot">${dots}</g>${labels}
    </svg>`;
  }

  /** 두 선수의 능력치 차이 중 가장 큰 둘. 편성을 바꾸기 전에 무엇이 달라지는지 보여 준다. */
  clubDelta(player, other) {
    const changes = TAKRAW_CLUB_RULES.stats.map(stat => ({ name:stat.name, change:player.stats[stat.id] - other.stats[stat.id] }))
      .filter(item => item.change).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 2);
    if (!changes.length) return '<span>능력치 동일</span>';
    return changes.map(item => `<span class="${item.change > 0 ? 'positive' : 'negative'}">${this.escape(item.name)} ${item.change > 0 ? '+' : '−'}${Math.abs(item.change)}</span>`).join(' ');
  }

  clubCard(player, { selected = false, recommended = false, badge = '', note = '' }) {
    const escape = value => this.escape(value), peaks = TAKRAW_CLUB_RULES.stats.slice().sort((a,b) => player.stats[b.id] - player.stats[a.id]).slice(0,2);
    return `<div class="club-card-row ${player.role ? '' : 'is-sellable'}" data-player="${player.id}">${player.role ? '' : `<button type="button" class="club-sell-reveal" tabindex="-1" data-club-action="sell" data-value="${player.id}" aria-label="${escape(player.name)} 판매, ${player.sellValue} P 받음"><b>판매</b><small>+${player.sellValue} P</small></button>`}<button type="button" class="club-card ${selected ? 'selected' : ''} ${recommended ? 'recommended' : ''}" data-club-action="select" data-value="${player.id}" data-club-focus="player-${player.id}" aria-pressed="${selected}">${this.clubShirt(player)}<span class="club-card-copy"><strong>${escape(player.name)}${player.rarity === 'common' ? '' : ` <span class="club-rarity" data-rarity="${player.rarity}">${this.clubRarityName(player.rarity)}</span>`}</strong><small>추천 ${this.clubRoleName(player.preferredRole)} · ${escape(player.tag)}</small><span class="club-card-peaks">${peaks.map(stat => `${escape(stat.name)} <b>${player.stats[stat.id]}</b>`).join(' · ')}</span>${note ? `<span class="club-card-note">${note}</span>` : ''}</span><span class="club-card-badge">${escape(badge)}</span></button><button type="button" class="club-info" data-club-action="info" data-value="${player.id}" data-club-focus="info-${player.id}" aria-label="${escape(player.name)} 능력치 자세히 보기">ⓘ</button></div>`;
  }

  /** 선발 자리 3칸. 선수나 자리를 먼저 누르면 놓을 수 있는 쪽이 켜지고 능력치 차이가 보인다. */
  clubLineupContent() {
    const c = this.club, pick = this.clubSelection.pick, picked = pick?.type === 'player' ? c.roster.find(value => value.id === pick.id) : null;
    const slots = TAKRAW_CLUB_RULES.roles.map(role => {
      const starter = c.roster.find(value => value.id === c.lineup[role.id]);
      if (!starter) return `<button type="button" disabled><small>${role.name}</small><strong>불러오는 중</strong></button>`;
      const current = picked?.id === starter.id, selected = pick?.type === 'slot' && pick.id === role.id, recommended = !!picked && !current && picked.preferredRole === role.id;
      const note = picked && !current ? `${recommended ? '<span class="club-chip">추천</span>' : ''}${this.clubDelta(picked, starter)}` : `<span>${current ? '선발 중' : role.id === 'attacker' ? '직접 조작' : '동료'}</span>`;
      return `<button type="button" class="${selected ? 'selected' : ''} ${recommended ? 'recommended' : ''}" ${current ? 'disabled' : ''} aria-pressed="${selected}" data-club-action="slot" data-value="${role.id}" data-club-focus="lineup-${role.id}"><small>${role.name}</small><strong>${this.escape(starter.name)}</strong><span class="club-slot-note">${note}</span></button>`;
    }).join('');
    const hint = picked ? `${picked.name} 선수가 갈 자리를 누르세요.` : pick?.type === 'slot' ? `${this.clubRoleName(pick.id)} 자리에 올 선수를 누르세요.` : '선수나 자리를 눌러 선발을 바꿔요. 후보는 왼쪽으로 밀면 팔 수 있어요.';
    return `<div class="club-lineup" aria-label="현재 선발">${slots}</div><p class="club-hint">${this.escape(hint)}</p>`;
  }

  clubRosterCards() {
    const c = this.club, pick = this.clubSelection.pick, slotOccupant = pick?.type === 'slot' ? c.roster.find(value => value.id === c.lineup[pick.id]) : null;
    return c.roster.map(player => {
      const selected = pick?.type === 'player' && pick.id === player.id, current = slotOccupant?.id === player.id;
      const recommended = !!slotOccupant && !current && player.preferredRole === pick.id;
      const badge = current ? '현재 자리' : player.role ? `${this.clubRoleName(player.role)} 선발` : '후보';
      const note = slotOccupant && !current ? `${recommended ? '<span class="club-chip">추천</span>' : ''}${this.clubDelta(player, slotOccupant)}` : '';
      return this.clubCard(player, { selected, recommended, badge, note });
    }).join('');
  }

  /** 하단 고정 줄. 왼쪽에 상태 한 줄, 오른쪽에 이 화면의 버튼 하나. */
  clubBar(summary, button) { return `<footer class="club-bar"><span>${this.escape(summary)}</span>${button}</footer>`; }

  clubRarityName(rarity) { return TAKRAW_CLUB_RULES.rarities.find(value => value.id === rarity)?.name || ''; }

  /** 등급 확률을 합계 대비 %로. 화면에 그대로 공개한다. */
  clubOddsText() {
    const weights = Object.entries(TAKRAW_CLUB_RULES.draw.weights), total = weights.reduce((sum, [, weight]) => sum + weight, 0);
    return weights.map(([rarity, weight]) => `${this.clubRarityName(rarity)} ${Math.round(weight / total * 1000) / 10}%`).join(' · ');
  }

  clubTrainBar(player) {
    const c = this.club, rule = TAKRAW_CLUB_RULES.training, lock = this.clubLockReason(), points = c.trainingPoints || 0;
    const gain = Math.round((takrawTrainingFactor(player.level + 1) / takrawTrainingFactor(player.level) - 1) * 100);
    const summary = `훈련 레벨 ${player.level} · 모든 능력치 약 +${gain}% · 보유 ${points} P`;
    return this.clubBar(lock || (points < rule.cost ? `훈련 포인트가 없어요 · ${summary}` : summary), `<button type="button" class="primary-small" ${lock || points < rule.cost ? 'disabled' : ''} data-club-action="train" data-value="${player.id}" data-club-focus="train">훈련 · ${rule.cost} P</button>`);
  }

  clubDetailContent(player) {
    const escape = value => this.escape(value), badge = player.role ? `${this.clubRoleName(player.role)} 선발` : '후보';
    return `<div class="club-detail-heading"><div class="club-player-title"><strong tabindex="-1" data-club-focus="detail-heading">${escape(player.name)}</strong><span class="club-badge">${escape(badge)}</span><span class="club-rarity" data-rarity="${player.rarity}">${this.clubRarityName(player.rarity)}</span></div><p>${escape(player.tag)} · 추천 ${this.clubRoleName(player.preferredRole)}</p></div>
      <div class="club-radar-view">${this.clubRadar(player, player.stats)}</div>
      ${this.clubTrainBar(player)}`;
  }



  /** 뽑기 탭: 카드팩 그림, 공개 확률, 하단 고정 뽑기 버튼. 가득 차 남겨 둔 결과가 있으면 이어 보기 버튼이 대신 선다. */
  clubDrawContent() {
    const c = this.club, rule = TAKRAW_CLUB_RULES.draw, lock = this.clubLockReason(), pending = c.draw?.pending;
    const shortage = Math.max(0, rule.cost - (c.credits || 0));
    const refunds = TAKRAW_CLUB_RULES.rarities.map(rarity => `${rarity.name} ${rule.refund[rarity.id]} P`).join(' · ');
    const body = `<div class="club-draw"><div class="draw-pack-art" aria-hidden="true"><i></i><b>?</b></div>
      <p class="draw-odds">${this.escape(this.clubOddsText())}</p>
      <p class="draw-note">뽑은 선수는 바로 선수단에 합류해요. 선수단이 가득 차면 환급(${refunds})을 받거나 후보와 교체해요.</p></div>`;
    if (pending) return body + this.clubBar('지난 뽑기 결과를 아직 정리하지 않았어요.', `<button type="button" class="primary-small" ${lock ? 'disabled' : ''} data-club-action="draw-resume" data-club-focus="draw-button">결과 이어 보기</button>`);
    const summary = lock || (shortage ? `${shortage} C 부족 · 보유 ${c.credits || 0} C` : `보유 ${c.credits || 0} C · 뽑은 횟수 ${c.draw?.runs || 0}회`);
    return body + this.clubBar(summary, `<button type="button" class="primary-small" ${lock || shortage ? 'disabled' : ''} data-club-action="draw" data-club-focus="draw-button">뽑기 · ${rule.cost} C</button>`);
  }

  clubContent() {
    const c = this.club, selection = this.clubSelection, rules = TAKRAW_CLUB_RULES, escape = value => this.escape(value);
    const lock = this.clubLockReason(), isDraw = selection.tab === 'draw';
    const detail = selection.detail ? c.roster.find(value => value.id === selection.detail) : null;
    const name = selection.rename ? `<form id="club-name-form" class="club-name-form"><label for="club-name">팀 이름 · 최대 ${rules.nameLength}자</label><input id="club-name" data-club-focus="club-name" type="text" aria-describedby="club-name-error" ${selection.nameError ? 'aria-invalid="true"' : ''} value="${escape(selection.nameDraft ?? c.teamName)}" placeholder="팀 이름" maxlength="36" ${lock ? 'disabled' : ''} autocomplete="off"><button type="submit" class="primary-small" ${lock ? 'disabled' : ''}>저장</button><button type="button" class="secondary-small" data-club-action="rename-cancel" data-club-focus="rename-cancel" ${this.clubBusy ? 'disabled' : ''}>취소</button><span id="club-name-error" class="club-name-error" role="alert">${escape(selection.nameError || '')}</span></form>` : `<button type="button" class="club-name-display" ${lock ? 'disabled' : ''} data-club-action="rename-edit" data-club-focus="rename-edit" aria-label="${escape(c.teamName || '내 팀')} 이름 바꾸기"><span>${escape(c.teamName || '내 팀')}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14Z"/></svg></button>`;
    const passiveStatus = !this.inGame && !this.clubBusy && c.status === 'ready' && !this.clubNotice && c.pendingReward?.status !== 'error';
    const statusMessage = this.inGame ? '현재 경기는 시작할 때의 편성을 사용해요. 팀 변경은 처음 화면에서 할 수 있어요.' : this.clubBusy ? '팀을 저장하고 있어요.' : c.status !== 'ready' ? c.message : this.clubNotice || c.message;
    const empty = c.status === 'loading' ? '선수 정보를 불러오고 있어요.' : '선수가 없어요.';
    const body = detail ? `<section id="club-detail" class="club-detail" aria-label="선수 상세">${this.clubDetailContent(detail)}</section>`
      : `<div class="club-navigation"><div class="club-tabs" role="group" aria-label="팀 관리 메뉴"><button type="button" class="${!isDraw ? 'selected' : ''}" data-club-action="tab" data-value="roster" data-club-focus="tab-roster" aria-pressed="${!isDraw}">선수단 <span>${c.roster.length}</span></button><button type="button" class="${isDraw ? 'selected' : ''}" data-club-action="tab" data-value="draw" data-club-focus="tab-draw" aria-pressed="${isDraw}">선수 뽑기</button></div><span class="club-capacity">선수 ${c.roster.length} / ${rules.capacity}명</span></div>
      ${isDraw ? this.clubDrawContent() : `${this.clubLineupContent()}<div id="club-list" class="club-list">${this.clubRosterCards() || `<p class="club-empty">${empty}</p>`}</div>`}`;
    return `<div class="club-layout"><div class="club-summary"><div class="club-identity">${name}<span class="club-record">${c.record.won || 0}승 ${c.record.lost || 0}패 · 나만의 ${TAKRAW_GAME_NAME} 팀</span></div><div class="club-wallet"><div class="club-resource"><small>코인</small><b>${c.credits || 0} <span>C</span></b></div><div class="club-resource"><small>훈련 포인트</small><b>${c.trainingPoints || 0} <span>P</span></b></div></div></div>
      <div class="club-status" data-status="${c.status}" data-passive="${passiveStatus}" role="status" aria-live="polite" aria-atomic="true"><span>${escape(statusMessage)}</span>${['error','conflict'].includes(c.status) ? `<button type="button" class="secondary-small" ${this.clubBusy ? 'disabled' : ''} data-club-action="refresh" data-club-focus="refresh">최신 저장 불러오기</button>` : ''}${c.pendingReward?.status === 'error' ? '<button type="button" class="secondary-small" data-club-action="reward" data-club-focus="reward">보상 저장 재시도</button>' : ''}</div>
      ${body}${detail || isDraw ? '' : '<p class="club-footnote">다음 AI 대전·연습부터 적용 · 현재 브라우저에 저장<br>AI 대전 완료 보상: 승리 180 C·3 P / 패배 100 C·2 P</p>'}</div>`;
  }

  clubClick(button) {
    if (button.disabled) return;
    const action = button.dataset.clubAction, value = button.dataset.value, selection = this.clubSelection, pick = selection.pick;
    if (action === 'select') {
      if (pick?.type === 'slot') this.clubAction('assign', { role:pick.id, playerId:value });
      else { selection.pick = pick?.id === value ? null : { type:'player', id:value }; this.renderClub(`player-${value}`); }
    }
    if (action === 'slot') {
      if (pick?.type === 'player') this.clubAction('assign', { role:value, playerId:pick.id });
      else { selection.pick = pick?.id === value ? null : { type:'slot', id:value }; this.renderClub(`lineup-${value}`); }
    }
    if (action === 'info') { selection.pick = null; this.navigate(`club/${value}`); }
    if (action === 'tab') {
      if (!['roster','draw'].includes(value)) return;
      selection.tab = value; selection.pick = null; this.renderClub(`tab-${value}`, true);
    }
    if (action === 'rename-edit') { if (this.clubLockReason()) return; selection.rename = true; selection.nameDraft = this.club.teamName; selection.nameError = ''; this.renderClub('club-name'); }
    if (action === 'rename-cancel') { selection.rename = false; selection.nameDraft = null; selection.nameError = ''; this.renderClub('rename-edit'); }
    if (action === 'train') this.clubAction('train', { playerId:value });
    if (action === 'sell') this.clubAction('sell', { playerId:value });
    if (action === 'draw') this.clubAction('draw');
    if (action === 'draw-resume' && this.club.draw?.pending) this.openDrawStage(this.club.draw.pending, { joined:false, phase:'front' });
    if (action === 'refresh') this.clubAction('refresh');
    if (action === 'reward') this.callbacks.onRewardRetry?.();
  }

  /** 선수·자리 선택을 화면 안에서만 풀어 준다. 저장된 편성은 바뀌지 않는다. */
  clubClearPick() {
    if (!this.clubSelection.pick) return;
    this.clubSelection.pick = null; this.renderClub();
  }

  async clubAction(action, payload = {}) {
    if (this.clubBusy) return;
    const reason = action === 'refresh' ? '' : this.clubLockReason();
    if (reason) { this.clubNotice = reason; this.renderClub(); return; }
    this.clubBusy = true; this.clubNotice = ''; this.renderClub();
    let focus = null, drawn = null;
    try {
      const result = await this.callbacks.onClubAction?.(action, payload);
      if (result?.view) { this.club = { ...this.club, ...result.view }; this.clubNotice = result.view.message || ''; this.updateStartButtons(); }
      if (action === 'assign') { this.clubSelection.pick = null; focus = `lineup-${payload.role}`; }
      if (action === 'train') focus = 'train';
      if (action === 'sell') focus = 'tab-roster';
      if (action === 'rename' && result) { this.clubSelection.rename = false; this.clubSelection.nameDraft = null; this.clubSelection.nameError = ''; focus = 'rename-edit'; }
      if (action === 'draw') { drawn = result?.drawn; focus = 'draw-button'; }
      if (action === 'resolve') {
        const id = this.drawStage?.card.id; this.closeDrawStage();
        if (payload.release) { this.showNewPlayer(id); focus = `player-${id}`; } else focus = 'tab-draw';
      }
    } catch (error) {
      this.clubNotice = error.message || '변경을 저장하지 못했어요. 다시 확인해 주세요.';
      if (action === 'rename' && error.kind === 'validation') { this.clubSelection.nameError = this.clubNotice; focus = 'club-name'; }
    } finally {
      this.clubBusy = false; this.renderClub(focus, action === 'draw');
      if (action === 'resolve' && payload.release) document.querySelector('.club-card.selected')?.scrollIntoView({ block: 'nearest' });
    }
    if (drawn) {
      const card = this.club.roster.find(value => value.id === drawn.id) ?? this.club.draw?.pending;
      if (card) this.openDrawStage(card, { joined: drawn.joined });
    }
  }

  /** 뽑기 연출: 카드팩 흔들림 → 카드 뒷면 → 탭해서 뒤집기 → 공개. 결과는 이미 저장돼 있어 연출은 보여 주기만 한다. */
  openDrawStage(card, { joined, phase = 'pack' }) {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches, node = this.nodes['draw-stage'];
    window.clearTimeout(this.drawTimer);
    this.drawStage = { card, joined, phase: phase === 'pack' && reduced ? 'back' : phase };
    node.hidden = false; node.innerHTML = this.drawStageContent(); node.querySelector('.draw-backdrop').dataset.phase = this.drawStage.phase;
    if (this.drawStage.phase === 'pack') this.drawTimer = window.setTimeout(() => this.setDrawPhase('back'), TAKRAW_DRAW_PACK_MS);
    this.focusDrawStage();
  }

  setDrawPhase(phase) {
    if (!this.drawStage) return;
    window.clearTimeout(this.drawTimer);
    this.drawStage.phase = phase; this.nodes['draw-stage'].querySelector('.draw-backdrop').dataset.phase = phase;
    this.focusDrawStage();
  }

  focusDrawStage() {
    const phase = this.drawStage?.phase, selector = { pack: '.draw-skip', back: '.draw-card', front: '[data-draw-action]:not(.draw-skip):not(.draw-card)' }[phase];
    this.nodes['draw-stage'].querySelector(selector)?.focus({ preventScroll: true });
  }

  closeDrawStage() {
    window.clearTimeout(this.drawTimer); this.drawStage = null;
    this.nodes['draw-stage'].hidden = true; this.nodes['draw-stage'].replaceChildren();
  }

  drawStageContent() {
    const { card, joined } = this.drawStage, escape = value => this.escape(value), rules = TAKRAW_CLUB_RULES;
    const bench = this.club.roster.filter(value => !value.role);
    const front = `<span class="draw-face draw-front"><span class="draw-front-head">${this.clubShirt(card)}<span><strong>${escape(card.name)}</strong><small>${escape(card.tag)}</small></span></span><span class="club-rarity" data-rarity="${card.rarity}">${this.clubRarityName(card.rarity)} · 추천 ${this.clubRoleName(card.preferredRole)}</span>${this.clubRadar(card, card.stats)}</span>`;
    const result = joined
      ? `<p>${escape(card.name)} 선수가 팀에 합류했어요.</p><button type="button" class="primary-small" data-draw-action="done">확인</button>`
      : `<p>선수단이 가득 찼어요 (${this.club.roster.length} / ${rules.capacity}명). 새 선수를 어떻게 할까요?</p>
         <button type="button" class="secondary-small" data-draw-action="refund">환급 · ${rules.draw.refund[card.rarity]} P 받기</button>
         <span class="draw-swap-title">후보와 교체</span><div class="draw-swap">${bench.map(value => `<button type="button" class="secondary-small" data-draw-action="release" data-value="${value.id}"><b>${escape(value.name)}</b><small>${this.clubRarityName(value.rarity)} · ${this.clubRoleName(value.preferredRole)}</small></button>`).join('')}</div>
         <button type="button" class="draw-later" data-draw-action="later">나중에 정하기</button>`;
    return `<div class="draw-backdrop" data-rarity="${card.rarity}" data-phase="pack">
      <button type="button" class="draw-skip" data-draw-action="skip">건너뛰기</button>
      <div class="draw-pack" aria-hidden="true"><i></i><b>?</b></div>
      <button type="button" class="draw-card" data-draw-action="flip" aria-label="카드 뒤집기"><span class="draw-card-inner"><span class="draw-face draw-back"><b>?</b><small>눌러서 뒤집기</small></span>${front}</span></button>
      <div class="draw-result" role="status">${result}</div></div>`;
  }

  /** Esc: 공개 전이면 건너뛰고, 공개 뒤에는 닫는다(가득 차 정리하지 않은 결과는 뽑기 탭의 이어 보기로 남는다). */
  drawEscape() {
    if (this.drawStage.phase !== 'front') this.setDrawPhase('front');
    else this.drawClick({ target: this.nodes['draw-stage'].querySelector(this.drawStage.joined ? '[data-draw-action="done"]' : '[data-draw-action="later"]') });
  }

  /** 새로 합류한 선수를 선수단 탭에서 선택된 상태로 보여 준다. */
  showNewPlayer(id) { Object.assign(this.clubSelection, { tab: 'roster', detail: null, pick: { type: 'player', id } }); }

  drawClick(event) {
    const button = event.target.closest('[data-draw-action]'); if (!button || !this.drawStage || this.clubBusy) return;
    const action = button.dataset.drawAction, phase = this.drawStage.phase;
    if (action === 'skip' && phase !== 'front') this.setDrawPhase('front');
    if (action === 'flip' && phase === 'back') this.setDrawPhase('front');
    if (action === 'done') { const id = this.drawStage.card.id; this.closeDrawStage(); this.showNewPlayer(id); this.renderClub(`player-${id}`); document.querySelector('.club-card.selected')?.scrollIntoView({ block: 'nearest' }); }
    if (action === 'later') { this.closeDrawStage(); this.renderClub('draw-button'); }
    if (action === 'refund') this.clubAction('resolve', {});
    if (action === 'release') this.clubAction('resolve', { release: button.dataset.value });
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
      <p class="room-help">양쪽 모두 ${TAKRAW_PRODUCT_NAME} ${TAKRAW_VERSION}로 접속해야 해요. HTTPS 사이트 사용을 권장합니다. 네트워크에 따라 WebRTC 연결이 제한될 수 있어요.</p>
      <details class="network-debug"><summary>연결 진단</summary><pre id="network-log" aria-label="최근 연결 이벤트"></pre><button type="button" class="secondary-small" data-dialog-action="copy-network-log">진단 복사</button></details>
      <div class="dialog-actions"><button type="button" class="primary-small" data-dialog-action="resume" id="resume-room" hidden>이전 경기 다시 연결</button><button type="button" class="secondary-small" data-dialog-action="close-network">연결 닫기</button></div>`;
  }

  /**
   * 선수 카드 밀어서 판매: 후보 카드를 왼쪽으로 밀면 판매 버튼이 드러나고, 더 밀면 바로 판다.
   * 세로 스크롤과 탭은 그대로 두려고 가로로 확실히 움직였을 때만 끌기로 본다. 출전 선수는 밀어도 팔리지 않는다.
   */
  swipe(type, event) {
    const state = this.swipeState;
    if (type === 'pointerdown') {
      const row = event.target.closest('.club-card-row');
      if (!row || event.target.closest('.club-sell-reveal') || (event.pointerType === 'mouse' && event.button !== 0)) return;
      for (const other of document.querySelectorAll('.club-card-row.is-open')) if (other !== row) this.swipeSet(other, 0);
      this.swipeState = { row, id: event.pointerId, x: event.clientX, y: event.clientY, base: row.classList.contains('is-open') ? -TAKRAW_SELL_REVEAL_PX : 0, drag: false, dx: 0 };
      return;
    }
    if (!state || state.id !== event.pointerId) return;
    const sellable = state.row.classList.contains('is-sellable'), width = state.row.offsetWidth;
    if (type === 'pointermove') {
      const dx = event.clientX - state.x, dy = event.clientY - state.y;
      if (!state.drag) {
        if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.5) { if (Math.abs(dy) > 10) this.swipeState = null; return; }
        state.drag = true; state.row.setPointerCapture?.(event.pointerId); state.row.classList.add('is-dragging');
      }
      state.dx = dx;
      if (sellable) this.swipeSet(state.row, Math.max(-width, Math.min(0, state.base + dx)), true);
      return;
    }
    this.swipeState = null;
    state.row.classList.remove('is-dragging');
    if (!state.drag) return;
    this.swipeEnd = performance.now(); // 끌기 직후 따라오는 클릭은 카드 선택으로 보지 않는다
    if (type === 'pointercancel') { if (sellable) this.swipeSet(state.row, 0); return; }
    if (!sellable) {
      if (state.dx < -40) { this.clubNotice = '출전 선수는 팔 수 없어요. 후보와 교체한 뒤 판매할 수 있어요.'; this.renderClub(); }
      return;
    }
    const offset = Math.max(-width, Math.min(0, state.base + state.dx));
    if (offset <= -width * TAKRAW_SELL_FULL_RATIO) { if (!this.clubLockReason()) { this.swipeSet(state.row, -width); this.clubAction('sell', { playerId: state.row.dataset.player }); return; } }
    this.swipeSet(state.row, offset < -TAKRAW_SELL_REVEAL_PX / 2 && !this.clubLockReason() ? -TAKRAW_SELL_REVEAL_PX : 0);
  }

  /** 카드를 offset(px, 0 이하)만큼 밀어 둔다. 밀려 있으면 판매 버튼을 키보드·보조기기가 닿게 한다. */
  swipeSet(row, offset, live = false) {
    row.style.setProperty('--dx', `${offset}px`);
    const open = offset <= -TAKRAW_SELL_REVEAL_PX && !live, reveal = row.querySelector('.club-sell-reveal');
    if (!live) row.classList.toggle('is-open', open);
    row.classList.toggle('is-full', offset <= -row.offsetWidth * TAKRAW_SELL_FULL_RATIO);
    if (reveal) reveal.tabIndex = open ? 0 : -1;
  }

  /** 키보드: 후보 카드에서 Delete를 누르면 판매 버튼이 드러나고 포커스가 옮겨 간다. Esc·Delete로 다시 닫는다. */
  swipeKey(event) {
    const row = event.target.closest?.('.club-card-row.is-sellable');
    if (!row || this.clubLockReason()) return;
    if (event.code === 'Delete' && event.target.closest('.club-card')) { event.preventDefault(); this.swipeSet(row, -TAKRAW_SELL_REVEAL_PX); row.querySelector('.club-sell-reveal')?.focus(); }
    else if (event.code === 'Escape' && row.classList.contains('is-open')) { event.preventDefault(); event.stopPropagation(); this.swipeSet(row, 0); row.querySelector('.club-card')?.focus(); }
  }

  dialogClick(event) {
    if (performance.now() - (this.swipeEnd || 0) < 350 && event.target.closest('.club-card-row')) { event.preventDefault(); return; }
    const openRow = event.target.closest('.club-card-row.is-open');
    if (openRow && !event.target.closest('.club-sell-reveal')) { event.preventDefault(); this.swipeSet(openRow, 0); return; }
    const intro = event.target.closest('[data-campaign-intro]');
    if (intro) { this.campaignIntroClick(intro.dataset.campaignIntro); return; }
    const challenge = event.target.closest('[data-campaign-school]');
    if (challenge) { if (!challenge.disabled) this.callbacks.onCampaign?.(challenge.dataset.campaignSchool); return; }
    const clubButton = event.target.closest('[data-club-action]');
    if (clubButton) { this.clubClick(clubButton); return; }
    if (this.dialog === 'club' && !event.target.closest('input, form, summary, footer')) this.clubClearPick();
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
    if (action === 'close-network') { this.callbacks.onNetwork?.('close'); this.hideDialog(true); this.setRoute(this.inGame ? 'play' : this.homeRoute()); }
    if (action === 'copy-code') this.copyText(this.network.code, button);
    if (action === 'copy-network-log') this.copyText(document.getElementById('network-log')?.textContent || '', button);
  }

  async copyText(value, button) {
    const label = button.textContent;
    try { await navigator.clipboard.writeText(value); button.textContent = '복사했어요'; }
    catch { const input = document.getElementById('room-code'); if (input && value === this.network.code) { input.focus(); input.select(); } button.textContent = '내용을 선택해 복사하세요'; }
    if (this.copyTimer) window.clearTimeout(this.copyTimer);
    this.copyTimer = window.setTimeout(() => { if (button.isConnected) button.textContent = label; this.copyTimer = null; }, 1800);
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

  /** 큰 글자 팝업("SPIKE!" 등). 반환된 토큰으로 hideHitPop하면 그 표시만 지운다. */
  showHitPop(text, team) {
    const pop = document.getElementById('hit-pop');
    this.text('hit-pop', text);
    pop.dataset.team = String(team === 1 ? 1 : 0);
    pop.hidden = false;
    pop.style.animation = 'none'; void pop.offsetWidth; pop.style.animation = '';
    this.hitPopToken = { text };
    return this.hitPopToken;
  }

  hideHitPop(token) {
    if (!token || this.hitPopToken !== token) return;
    this.hitPopToken = null;
    document.getElementById('hit-pop').hidden = true;
  }

  hideTiming(token) {
    if (!token || this.timingToken !== token) return;
    this.timingToken = null;
    document.getElementById('timing-badge').hidden = true;
  }

  update(hud) {
    if (!hud) return;
    this.text('score-0', hud.score?.[0] ?? 0); this.text('score-1', hud.score?.[1] ?? 0);
    document.getElementById('set-number').hidden = TAKRAW_CONFIG.rules.sets === 1 && this.mode !== 'training'; // 훈련은 이 칸을 안내 문구로 쓴다.
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
    if (hud.teamNames && this.mode !== 'local') {
      this.text('team-label-0', hud.teamNames[0]); this.text('team-label-1', hud.teamNames[1]);
    }
    this.updateTeamColors(hud);
    this.text('selected-state', hud.selectedState || '준비');
    const status = takrawMatchStatus(hud, TAKRAW_CONFIG.rules), banner = document.getElementById('match-banner');
    const teamName = team => document.getElementById(`team-label-${team}`).textContent;
    banner.textContent = status.matchPointTeams.length ? (status.matchPointTeams.length === 2 ? '양 팀 매치 포인트' :
      `${teamName(status.matchPointTeams[0])} 매치 포인트`) : status.deuce ? `${hud.score[0]} : ${hud.score[1]} · 듀스` : '';
    banner.hidden = this.mode === 'training' || !banner.textContent;
    document.getElementById('jump-light').classList.toggle('held', !!hud.jumpHeld); document.getElementById('kick-light').classList.toggle('held', !!hud.kickHeld);
    const meter = document.getElementById('toss-meter'); meter.hidden = !hud.tossReady; meter.querySelector('i').style.width = `${Math.round(100 * (hud.tossCharge || 0))}%`;
    const kickButton = document.querySelector('.touch-kick'), label = hud.tossReady ? ['공 던지기', '꾹 · 높게'] : ['발차기', '누르고 유지'];
    if (kickButton.dataset.label !== label[0]) { kickButton.dataset.label = label[0]; kickButton.firstChild.textContent = label[0]; kickButton.querySelector('small').textContent = label[1]; }
    if (this.mode === 'training' && hud.training) this.updateTraining(hud.training);
    if (hud.watch) {
      const input = document.getElementById('watch-seed');
      if (document.activeElement !== input && input.value !== String(hud.watch.seed)) input.value = hud.watch.seed;
      this.text('watch-tick', `틱 ${hud.watch.tick}`);
      const featured = document.getElementById('watch-featured'); if (featured.value !== String(hud.watch.seed)) featured.value = [...featured.options].some(option => option.value === String(hud.watch.seed)) ? String(hud.watch.seed) : '';
    }
    const ended = hud.phase === 'finished'; this.nodes['end-actions'].hidden = !ended;
    this.nodes['end-actions'].dataset.result = hud.matchWinner === (hud.localTeam || 0) ? 'win' : 'loss';
    if (ended) {
      const winnerSchool = hud.matchWinner === 0 ? takrawSchool(this.club.campaign?.home) || TAKRAW_SCHOOLS[0] :
        TAKRAW_SCHOOLS.find(value => value.name === hud.teamNames?.[1]) || TAKRAW_SCHOOLS[1];
      const accent = hud.teamColors?.[hud.matchWinner] ?? winnerSchool.uniform.primary;
      this.nodes['end-actions'].style.setProperty('--result-accent', `#${accent.toString(16).padStart(6, '0')}`);
    }
    const school = TAKRAW_SCHOOLS.find(value => value.id === hud.campaignSchoolId), schoolResult = document.getElementById('school-result');
    schoolResult.hidden = !ended || !school;
    if (school && ended) {
      const clear = hud.matchReward?.status === 'saved' ? 'CLEAR' : hud.matchReward?.status === 'error' ? '저장 재시도 필요' : '클리어 저장 중';
      schoolResult.textContent = hud.matchWinner === 0 ? `${school.name} 격파 · ${clear}` : `${school.name} · 다시 도전해요`;
    }
    this.text('match-reward', hud.matchReward?.message || '');
    document.getElementById('reward-retry').hidden = hud.matchReward?.status !== 'error';
    if (ended) this.text('match-result', this.mode === 'local' ? `${hud.matchWinner === 0 ? '1P' : '2P'} 팀 승리` : ['online', 'watch'].includes(this.mode) ? `${hud.teamNames?.[hud.matchWinner] ?? '상대 팀'} 승리` : hud.matchWinner === 0 ? '우리 팀 승리!' : '패배 · 다시 도전해요');
  }

  /** 온라인·관전 점수판: 팀 이름 옆에 그 학교 유니폼 색 점을 찍고, 내 쪽에는 '나' 표시를 단다. */
  updateTeamColors(hud) {
    const colored = ['online', 'watch'].includes(this.mode) && Array.isArray(hud.teamColors);
    document.querySelectorAll('.score-team').forEach((node, team) => {
      const color = colored ? `#${hud.teamColors[team].toString(16).padStart(6, '0')}` : '';
      if (node.dataset.dot !== color) { node.dataset.dot = color; if (color) node.style.setProperty('--team-dot', color); else node.style.removeProperty('--team-dot'); }
      const me = this.mode === 'online' && hud.localTeam === team ? 'true' : '';
      if ((node.dataset.me || '') !== me) { if (me) node.dataset.me = me; else delete node.dataset.me; }
    });
  }

  updateTraining(training) {
    const downward = training.lesson === 'downward';
    const lessonSelect = document.getElementById('training-lesson');
    if (lessonSelect.value !== training.lesson) lessonSelect.value = training.lesson;
    const tempoSelect = document.getElementById('training-tempo');
    if (tempoSelect.value !== training.tempo) tempoSelect.value = training.tempo;
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

  dispose() { this.releaseTouch(); window.clearTimeout(this.drawTimer); if (this.copyTimer) window.clearTimeout(this.copyTimer); this.controller.abort(); }
}

export { TakrawUI };
