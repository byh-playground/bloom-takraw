import { TAKRAW_CLUB_RULES, takrawTrainingFactor } from '../../club/club.js';
import { say, escape } from '../markup.js';
import { UI, clubText } from '../../i18n/messages/ui.js';

/** 후보 카드를 왼쪽으로 밀 때: 판매 버튼이 드러나는 폭(px)과, 이만큼(카드 폭 비율) 넘게 밀면 바로 파는 지점. */
const TAKRAW_SELL_REVEAL_PX = 96,
    TAKRAW_SELL_FULL_RATIO = 0.62;

function clubRoleName(role) {
    const value = TAKRAW_CLUB_RULES.roles.find((item) => item.id === role);
    return value ? say(value.name) : UI.bench();
}

function clubShirt(player) {
    const number = player.number;
    return `<span class="club-shirt" data-role="${player.preferredRole}" aria-hidden="true"><svg viewBox="0 0 64 72"><path d="M20 5 12 9 2 23 14 33 19 27 18 65H46L45 27 50 33 62 23 52 9 44 5C42 11 37 14 32 14S22 11 20 5Z" fill="currentColor" stroke="none"/><path d="M20 5C22 12 27 16 32 16S42 12 44 5M20 26V61M44 26V61" fill="none" stroke="rgba(255,255,255,.42)" stroke-width="2"/><text x="32" y="46" fill="#fff" stroke="none" text-anchor="middle" font-size="22" font-weight="750">${String(number).padStart(2, '0')}</text></svg></span>`;
}

/** 가장 큰 능력치가 바깥 고리에 닿도록 눈금 상한을 25 단위로 올린다(기본 100). */
function clubScaleTop(stats) {
    return Math.max(100, Math.ceil(Math.max(...Object.values(stats)) / 25) * 25);
}

function clubRadar(player, stats) {
    const axes = TAKRAW_CLUB_RULES.stats,
        center = { x: 180, y: 151 },
        radius = 94,
        top = clubScaleTop(stats),
        rings = [1, 2, 3, 4].map((step) => (top * step) / 4);
    const point = (index, value, scale = radius) => {
        const angle = -Math.PI / 2 + (index * Math.PI * 2) / axes.length;
        return {
            x: center.x + (Math.cos(angle) * scale * value) / top,
            y: center.y + (Math.sin(angle) * scale * value) / top,
        };
    };
    const polygon = (values) =>
        axes
            .map((stat, index) => {
                const p = point(index, values[stat.id]);
                return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
            })
            .join(' ');
    const grids = rings
        .map(
            (value) =>
                `<polygon points="${polygon(Object.fromEntries(axes.map((stat) => [stat.id, value])))}"/>`,
        )
        .join('');
    const spokes = axes
        .map((stat, index) => {
            const p = point(index, top);
            return `<line x1="${center.x}" y1="${center.y}" x2="${p.x}" y2="${p.y}"/>`;
        })
        .join('');
    const labels = axes
        .map((stat, index) => {
            const p = point(index, top, 126),
                anchor =
                    Math.abs(p.x - center.x) < 12 ? 'middle' : p.x > center.x ? 'start' : 'end';
            return `<text class="radar-label" x="${p.x}" y="${p.y - 4}" text-anchor="${anchor}">${escape(say(stat.name))}</text><text class="radar-value" x="${p.x}" y="${p.y + 15}" text-anchor="${anchor}">${stats[stat.id]}</text>`;
        })
        .join('');
    const dots = axes
        .map((stat, index) => {
            const p = point(index, stats[stat.id]);
            return `<circle cx="${p.x}" cy="${p.y}" r="3.5"/>`;
        })
        .join('');
    const description = axes.map((stat) => `${say(stat.name)} ${stats[stat.id]}`).join('. ');
    return `<svg class="club-radar" viewBox="0 0 360 310" role="img" aria-labelledby="club-radar-title club-radar-description">
      <title id="club-radar-title">${escape(UI.radarTitle({ name: say(player.name) }))}</title><desc id="club-radar-description">${escape(UI.radarScale({ top, description }))}</desc>
      <g class="radar-grid">${grids}</g><g class="radar-axis">${spokes}</g>
      <g class="radar-baseline">${rings.map((value) => `<text class="radar-ring-label" x="185" y="${center.y - (radius * value) / top + 4}">${value}</text>`).join('')}<text class="radar-ring-label" x="185" y="164">0</text></g>
      <polygon class="radar-current" points="${polygon(stats)}"/><g class="radar-dot">${dots}</g>${labels}
    </svg>`;
}

/** 두 선수의 능력치 차이 중 가장 큰 둘. 편성을 바꾸기 전에 무엇이 달라지는지 보여 준다. */
function clubDelta(player, other) {
    const changes = TAKRAW_CLUB_RULES.stats
        .map((stat) => ({
            name: say(stat.name),
            change: player.stats[stat.id] - other.stats[stat.id],
        }))
        .filter((item) => item.change)
        .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
        .slice(0, 2);
    if (!changes.length) return `<span>${escape(UI.statsEqual())}</span>`;
    return changes
        .map(
            (item) =>
                `<span class="${item.change > 0 ? 'positive' : 'negative'}">${escape(item.name)} ${item.change > 0 ? '+' : '−'}${Math.abs(item.change)}</span>`,
        )
        .join(' ');
}

/** 하단 고정 줄. 왼쪽에 상태 한 줄, 오른쪽에 이 화면의 버튼 하나. */
function clubBar(summary, button) {
    return `<footer class="club-bar"><span>${escape(summary)}</span>${button}</footer>`;
}

function clubRarityName(rarity) {
    return say(TAKRAW_CLUB_RULES.rarities.find((value) => value.id === rarity).name);
}

/** 선발이면 "<자리> 선발", 아니면 "후보". */
function clubPlayerBadge(player) {
    return player.role ? UI.roleStarter({ role: clubRoleName(player.role) }) : UI.bench();
}

/** 등급 확률을 합계 대비 %로. 화면에 그대로 공개한다. */
function clubOddsText() {
    const weights = Object.entries(TAKRAW_CLUB_RULES.draw.weights),
        total = weights.reduce((sum, [, weight]) => sum + weight, 0);
    return weights
        .map(
            ([rarity, weight]) =>
                `${clubRarityName(rarity)} ${Math.round((weight / total) * 1000) / 10}%`,
        )
        .join(' · ');
}

/**
 * 팀 관리 화면(대화상자 club): 팀 정보(club, runtime이 setClub으로 넘긴 조회 결과)와 화면 안의 선택·저장 중·안내·밀기 상태를 가진다.
 * 팀 정보를 바꾸는 곳은 set·merge 둘뿐이다. 뽑기 연출은 생성 때 받은 draw-stage에 맡긴다.
 */
class TakrawClubScreen {
    constructor({
        node,
        back,
        listen,
        drawStage,
        isOpen,
        inGame,
        navigate,
        updateStartButtons,
        callbacks,
    }) {
        this.node = node;
        this.back = back;
        this.drawStage = drawStage;
        this.isOpen = isOpen;
        this.inGame = inGame;
        this.navigate = navigate;
        this.updateStartButtons = updateStartButtons;
        this.callbacks = callbacks;
        this.club = {
            status: 'loading',
            message: { id: 'loading', values: {} },
            roster: [],
            draw: { pending: null },
            lineup: {},
            record: {},
        };
        // pick: 편성 교체 중인 선택({ type: 'player' | 'slot', id }), detail: 능력치를 펼친 선수 id. 모두 화면 안에서만 산다.
        this.selection = {
            tab: 'roster',
            pick: null,
            detail: null,
            opener: null,
            rename: false,
            nameDraft: null,
            nameError: '',
            resetConfirm: false,
            scroll: {},
        };
        this.busy = false;
        this.notice = '';
        for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'])
            listen(node, type, (event) => this.swipe(type, event));
        listen(node, 'keydown', (event) => this.swipeKey(event));
        listen(node, 'input', (event) => {
            if (event.target.id !== 'club-name') return;
            this.selection.nameDraft = event.target.value;
            this.selection.nameError = '';
            event.target.removeAttribute('aria-invalid');
            const error = document.getElementById('club-name-error');
            if (error) error.textContent = '';
        });
        listen(node, 'submit', (event) => {
            if (event.target.id !== 'club-name-form') return;
            event.preventDefault();
            this.action('rename', { name: document.getElementById('club-name').value });
        });
    }

    heading() {
        return [UI.clubKicker(), UI.clubTitle()];
    }

    /** runtime이 넘긴 팀 조회 결과로 바꾼다(ui.setClub). */
    set(value) {
        this.club = value;
    }

    /** 저장 동작이 돌려준 조회 결과(일부 필드)를 덮어쓴다. */
    merge(view) {
        this.club = { ...this.club, ...view };
    }

    /** 선수 상세를 연 선수 id(없으면 null). */
    get detail() {
        return this.selection.detail;
    }

    /** 주소의 선수 id로 상세를 고른다. 이전 값을 돌려준다. */
    selectDetail(item) {
        const previous = this.selection.detail;
        this.selection.detail = item || null;
        return previous;
    }

    /** 열려 있던 팀 관리 화면에서 상세를 열거나 닫았을 때 다시 그린다. */
    followDetail(item, previous) {
        // 상세에서 돌아오면 상세를 연 ⓘ(선발 칸이든 선수 카드든)로 포커스를 돌려준다.
        const opener = item ? null : this.selection.opener || `info-${previous}`;
        if (!item) this.selection.opener = null;
        this.render(item ? 'detail-heading' : opener, true);
    }

    /** 대화상자가 닫힐 때: 열려 있었으면 위치·포커스를 기억하고, 초기화 확인은 접는다. */
    hide(open) {
        if (open) this.remember();
        this.selection.resetConfirm = false;
    }

    remember() {
        const content = this.node;
        this.selection.scroll = Object.fromEntries(
            ['club-list', 'club-detail'].map((id) => [
                id,
                document.getElementById(id)?.scrollTop || 0,
            ]),
        );
        this.selection.scroll.dialog = content.scrollTop;
        const active = document.activeElement;
        const focus = content.contains(active)
            ? active?.dataset?.clubFocus || active?.id || null
            : null;
        if (focus) this.selection.focus = focus;
    }

    restore() {
        for (const [id, scroll] of Object.entries(this.selection.scroll)) {
            const node = id === 'dialog' ? this.node : document.getElementById(id);
            if (node) node.scrollTop = scroll;
        }
    }

    restoreFocus() {
        if (!this.selection.focus) return false;
        const nodes = [...this.node.querySelectorAll('[data-club-focus], [id]')];
        const usable = (node) => node && !node.disabled && node.getClientRects().length;
        const find = (identity) =>
            nodes.find((node) => node.dataset.clubFocus === identity || node.id === identity);
        let next = find(this.selection.focus);
        if (!usable(next)) {
            next = [find('detail-heading'), find(`tab-${this.selection.tab}`)].find(usable);
        }
        if (usable(next)) {
            next.focus({ preventScroll: true });
            return true;
        }
        return false;
    }

    render(focus = null, resetDetail = false) {
        if (!this.isOpen()) return;
        this.remember();
        if (focus) this.selection.focus = focus;
        if (resetDetail) {
            this.selection.scroll['club-detail'] = 0;
            this.selection.scroll.dialog = 0;
        }
        const name = document.getElementById('club-name');
        const caret =
            name && document.activeElement === name
                ? [name.selectionStart, name.selectionEnd]
                : null;
        if (name) this.selection.nameDraft = name.value;
        this.node.innerHTML = this.content();
        this.back.hidden = !document.getElementById('club-detail');
        const nextName = document.getElementById('club-name');
        if (caret && nextName && !nextName.disabled) {
            nextName.focus({ preventScroll: true });
            nextName.setSelectionRange(...caret);
        } else this.restoreFocus();
        this.restore();
    }

    lockReason() {
        if (this.inGame()) return UI.lockInGame();
        if (this.busy || this.club.status === 'saving') return UI.lockSaving();
        if (this.club.status !== 'ready') return clubText(this.club.message) || UI.lockLoad();
        return '';
    }

    /** 선수 한 명을 한 줄로: 등번호 셔츠 · 이름(등급) · 대표 능력치 둘(자리를 고르는 중이면 그 자리 선수와의 차이) · 상태. 추천 자리·성격은 ⓘ 상세에 있다. */
    card(player, { selected = false, recommended = false, badge = '', note = '' }) {
        const name = say(player.name),
            peaks = TAKRAW_CLUB_RULES.stats
                .slice()
                .sort((a, b) => player.stats[b.id] - player.stats[a.id])
                .slice(0, 2);
        return `<div class="club-card-row ${player.role ? '' : 'is-sellable'}" data-player="${player.id}">${player.role ? '' : `<button type="button" class="club-sell-reveal" tabindex="-1" data-club-action="sell" data-value="${player.id}" aria-label="${escape(UI.sellLabel({ name, value: player.sellValue }))}"><b>${escape(UI.sell())}</b><small>+${player.sellValue} P</small></button>`}<button type="button" class="club-card ${selected ? 'selected' : ''} ${recommended ? 'recommended' : ''}" data-club-action="select" data-value="${player.id}" data-club-focus="player-${player.id}" aria-pressed="${selected}">${clubShirt(player)}<span class="club-card-copy"><strong>${escape(name)}${player.rarity === 'common' ? '' : ` <span class="club-rarity" data-rarity="${player.rarity}">${clubRarityName(player.rarity)}</span>`}</strong>${note ? `<span class="club-card-note">${note}</span>` : `<span class="club-card-peaks">${peaks.map((stat) => `${escape(say(stat.name))} <b>${player.stats[stat.id]}</b>`).join(' · ')}</span>`}</span><span class="club-card-badge">${escape(badge)}</span></button><button type="button" class="club-info" data-club-action="info" data-value="${player.id}" data-club-focus="info-${player.id}" aria-label="${escape(UI.infoLabel({ name }))}">ⓘ</button></div>`;
    }

    /** 선발 자리 3칸. 선수나 자리를 먼저 누르면 놓을 수 있는 쪽이 켜지고 능력치 차이가 보인다. */
    lineupContent() {
        const c = this.club,
            pick = this.selection.pick,
            picked =
                pick?.type === 'player' ? c.roster.find((value) => value.id === pick.id) : null;
        const slots = TAKRAW_CLUB_RULES.roles
            .map((role) => {
                const starter = c.roster.find((value) => value.id === c.lineup[role.id]);
                if (!starter)
                    return `<button type="button" disabled><small>${escape(say(role.name))}</small><strong>${escape(UI.slotLoading())}</strong></button>`;
                const current = picked?.id === starter.id,
                    selected = pick?.type === 'slot' && pick.id === role.id,
                    recommended = !!picked && !current && picked.preferredRole === role.id;
                const note =
                    picked && !current
                        ? `${recommended ? `<span class="club-chip">${escape(UI.recommended())}</span>` : ''}${clubDelta(picked, starter)}`
                        : `<span>${escape(current ? UI.starting() : role.id === 'attacker' ? UI.directControl() : UI.teammate())}</span>`;
                // 선발 칸에도 선수 카드와 같은 ⓘ가 있다. 칸 자체는 자리 선택 버튼이라 ⓘ는 그 옆에 따로 둔다.
                return `<div class="club-slot"><button type="button" class="${selected ? 'selected' : ''} ${recommended ? 'recommended' : ''}" ${current ? 'disabled' : ''} aria-pressed="${selected}" data-club-action="slot" data-value="${role.id}" data-club-focus="lineup-${role.id}"><small>${escape(say(role.name))}</small><strong>${escape(say(starter.name))}</strong><span class="club-slot-note">${note}</span></button><button type="button" class="club-info" data-club-action="info" data-value="${starter.id}" data-club-focus="lineup-info-${role.id}" aria-label="${escape(UI.infoLabel({ name: say(starter.name) }))}">ⓘ</button></div>`;
            })
            .join('');
        const hint = picked
            ? UI.pickPlayerHint({ name: say(picked.name) })
            : pick?.type === 'slot'
              ? UI.pickSlotHint({ role: clubRoleName(pick.id) })
              : UI.lineupHint();
        return `<div class="club-lineup" aria-label="${escape(UI.currentLineup())}">${slots}</div><p class="club-hint">${escape(hint)}</p>`;
    }

    rosterCards() {
        const c = this.club,
            pick = this.selection.pick,
            slotOccupant =
                pick?.type === 'slot'
                    ? c.roster.find((value) => value.id === c.lineup[pick.id])
                    : null;
        return c.roster
            .map((player) => {
                const selected = pick?.type === 'player' && pick.id === player.id,
                    current = slotOccupant?.id === player.id;
                const recommended = !!slotOccupant && !current && player.preferredRole === pick.id;
                const badge = current ? UI.currentSpot() : clubPlayerBadge(player);
                const note =
                    slotOccupant && !current
                        ? `${recommended ? `<span class="club-chip">${escape(UI.recommended())}</span>` : ''}${clubDelta(player, slotOccupant)}`
                        : '';
                return this.card(player, { selected, recommended, badge, note });
            })
            .join('');
    }

    trainBar(player) {
        const c = this.club,
            rule = TAKRAW_CLUB_RULES.training,
            lock = this.lockReason(),
            points = c.trainingPoints || 0;
        const gain = Math.round(
            (takrawTrainingFactor(player.level + 1) / takrawTrainingFactor(player.level) - 1) * 100,
        );
        const summary = UI.trainSummary({ level: player.level, gain, points });
        return clubBar(
            lock || (points < rule.cost ? UI.noPoints({ summary }) : summary),
            `<button type="button" class="primary-small" ${lock || points < rule.cost ? 'disabled' : ''} data-club-action="train" data-value="${player.id}" data-club-focus="train">${escape(UI.train({ cost: rule.cost }))}</button>`,
        );
    }

    detailContent(player) {
        const badge = clubPlayerBadge(player);
        return `<div class="club-detail-heading"><div class="club-player-title"><strong tabindex="-1" data-club-focus="detail-heading">${escape(say(player.name))}</strong><span class="club-badge">${escape(badge)}</span><span class="club-rarity" data-rarity="${player.rarity}">${escape(clubRarityName(player.rarity))}</span></div><p>${escape(UI.detailTag({ tag: say(player.tag), role: clubRoleName(player.preferredRole) }))}</p></div>
      <div class="club-radar-view">${clubRadar(player, player.stats)}</div>
      ${this.trainBar(player)}`;
    }

    /** 뽑기 탭: 카드팩 그림, 공개 확률, 하단 고정 뽑기 버튼. 가득 차 남겨 둔 결과가 있으면 이어 보기 버튼이 대신 선다. */
    drawContent() {
        const c = this.club,
            rule = TAKRAW_CLUB_RULES.draw,
            reward = TAKRAW_CLUB_RULES.rewards,
            lock = this.lockReason(),
            pending = c.draw?.pending;
        const shortage = Math.max(0, rule.cost - (c.credits || 0));
        const refunds = TAKRAW_CLUB_RULES.rarities
            .map((rarity) => `${say(rarity.name)} ${rule.refund[rarity.id]} P`)
            .join(' · ');
        const body = `<div class="club-draw"><div class="draw-pack-art" aria-hidden="true"><i></i><b>?</b></div>
      <p class="draw-odds">${escape(clubOddsText())}</p>
      <p class="draw-note">${escape(UI.drawJoinNote({ refunds }))}</p>
      <p class="draw-note">${escape(UI.drawCreditsNote({ winC: reward.win.credits, winP: reward.win.trainingPoints, lossC: reward.loss.credits, lossP: reward.loss.trainingPoints }))}</p></div>`;
        if (pending)
            return (
                body +
                clubBar(
                    UI.drawPending(),
                    `<button type="button" class="primary-small" ${lock ? 'disabled' : ''} data-club-action="draw-resume" data-club-focus="draw-button">${escape(UI.drawResume())}</button>`,
                )
            );
        const summary =
            lock ||
            (shortage
                ? UI.creditsShort({ short: shortage, credits: c.credits || 0 })
                : UI.drawStatus({ credits: c.credits || 0, runs: c.draw?.runs || 0 }));
        return (
            body +
            clubBar(
                summary,
                `<button type="button" class="primary-small" ${lock || shortage ? 'disabled' : ''} data-club-action="draw" data-club-focus="draw-button">${escape(UI.draw({ cost: rule.cost }))}</button>`,
            )
        );
    }

    content() {
        const c = this.club,
            selection = this.selection,
            rules = TAKRAW_CLUB_RULES;
        const lock = this.lockReason(),
            isDraw = selection.tab === 'draw';
        const detail = selection.detail
            ? c.roster.find((value) => value.id === selection.detail)
            : null;
        const name = selection.rename
            ? `<form id="club-name-form" class="club-name-form"><label for="club-name">${escape(UI.nameLabel({ max: rules.nameLength }))}</label><input id="club-name" data-club-focus="club-name" type="text" aria-describedby="club-name-error" ${selection.nameError ? 'aria-invalid="true"' : ''} value="${escape(selection.nameDraft ?? c.teamName)}" placeholder="${escape(UI.namePlaceholder())}" maxlength="36" ${lock ? 'disabled' : ''} autocomplete="off"><button type="submit" class="primary-small" ${lock ? 'disabled' : ''}>${escape(UI.save())}</button><button type="button" class="secondary-small" data-club-action="rename-cancel" data-club-focus="rename-cancel" ${this.busy ? 'disabled' : ''}>${escape(UI.cancel())}</button><span id="club-name-error" class="club-name-error" role="alert">${escape(selection.nameError || '')}</span></form>`
            : `<button type="button" class="club-name-display" ${lock ? 'disabled' : ''} data-club-action="rename-edit" data-club-focus="rename-edit" aria-label="${escape(UI.rename({ name: c.teamName || UI.myTeam() }))}"><span>${escape(c.teamName || UI.myTeam())}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14Z"/></svg></button>`;
        const passiveStatus =
            !this.inGame() &&
            !this.busy &&
            c.status === 'ready' &&
            !this.notice &&
            c.pendingReward?.status !== 'error';
        // 읽지 못한 저장은 원본을 두고, 사용자가 확인한 뒤에만 지우고 새로 시작한다(club.reset).
        const confirming = c.locked && selection.resetConfirm && !this.busy;
        const statusMessage = this.inGame()
            ? UI.inGameLineup()
            : this.busy
              ? UI.lockSaving()
              : confirming
                ? UI.resetClubConfirm()
                : c.status !== 'ready'
                  ? clubText(c.message)
                  : this.notice || clubText(c.message);
        const statusActions = c.locked
            ? confirming
                ? `<button type="button" class="primary-small" data-club-action="reset" data-club-focus="reset-delete">${escape(UI.resetClubDelete())}</button><button type="button" class="secondary-small" data-club-action="reset-cancel" data-club-focus="reset-cancel">${escape(UI.cancel())}</button>`
                : `<button type="button" class="secondary-small" ${this.busy ? 'disabled' : ''} data-club-action="reset-ask" data-club-focus="reset">${escape(UI.resetClub())}</button>`
            : ['error', 'conflict'].includes(c.status)
              ? `<button type="button" class="secondary-small" ${this.busy ? 'disabled' : ''} data-club-action="refresh" data-club-focus="refresh">${escape(UI.refresh())}</button>`
              : '';
        const empty = c.status === 'loading' ? UI.rosterLoading() : UI.rosterEmpty();
        const body = detail
            ? `<section id="club-detail" class="club-detail" aria-label="${escape(UI.playerDetail())}">${this.detailContent(detail)}</section>`
            : `<div class="club-navigation"><div class="club-tabs" role="group" aria-label="${escape(UI.clubMenu())}"><button type="button" class="${!isDraw ? 'selected' : ''}" data-club-action="tab" data-value="roster" data-club-focus="tab-roster" aria-pressed="${!isDraw}">${escape(UI.rosterTab())} <span>${c.roster.length}</span></button><button type="button" class="${isDraw ? 'selected' : ''}" data-club-action="tab" data-value="draw" data-club-focus="tab-draw" aria-pressed="${isDraw}">${escape(UI.drawTab())}</button></div><span class="club-capacity">${escape(UI.capacity({ count: c.roster.length, max: rules.capacity }))}</span></div>
      ${isDraw ? this.drawContent() : `${this.lineupContent()}<div id="club-list" class="club-list">${this.rosterCards() || `<p class="club-empty">${empty}</p>`}</div>`}`;
        return `<div class="club-layout"><div class="club-summary"><div class="club-identity">${name}<span class="club-record">${escape(UI.record({ won: c.record.won || 0, lost: c.record.lost || 0 }))}</span></div><div class="club-wallet"><div class="club-resource"><small>${escape(UI.coins())}</small><b>${c.credits || 0} <span>C</span></b></div><div class="club-resource"><small>${escape(UI.trainingPoints())}</small><b>${c.trainingPoints || 0} <span>P</span></b></div></div></div>
      <div class="club-status" data-status="${c.status}" data-passive="${passiveStatus}" role="status" aria-live="polite" aria-atomic="true"><span>${escape(statusMessage)}</span>${statusActions}${c.pendingReward?.status === 'error' ? `<button type="button" class="secondary-small" data-club-action="reward" data-club-focus="reward">${escape(UI.rewardRetry())}</button>` : ''}</div>
      ${body}</div>`;
    }

    press(button) {
        if (button.disabled) return;
        const action = button.dataset.clubAction,
            value = button.dataset.value,
            selection = this.selection,
            pick = selection.pick;
        if (action === 'select') {
            if (pick?.type === 'slot') this.action('assign', { role: pick.id, playerId: value });
            else {
                selection.pick = pick?.id === value ? null : { type: 'player', id: value };
                this.render(`player-${value}`);
            }
        }
        if (action === 'slot') {
            if (pick?.type === 'player') this.action('assign', { role: value, playerId: pick.id });
            else {
                selection.pick = pick?.id === value ? null : { type: 'slot', id: value };
                this.render(`lineup-${value}`);
            }
        }
        if (action === 'info') {
            selection.pick = null;
            selection.opener = button.dataset.clubFocus;
            this.navigate('club', value);
        }
        if (action === 'tab') {
            if (!['roster', 'draw'].includes(value)) return;
            selection.tab = value;
            selection.pick = null;
            this.render(`tab-${value}`, true);
        }
        if (action === 'rename-edit') {
            if (this.lockReason()) return;
            selection.rename = true;
            selection.nameDraft = this.club.teamName;
            selection.nameError = '';
            this.render('club-name');
        }
        if (action === 'rename-cancel') {
            selection.rename = false;
            selection.nameDraft = null;
            selection.nameError = '';
            this.render('rename-edit');
        }
        if (action === 'train') this.action('train', { playerId: value });
        if (action === 'sell') this.action('sell', { playerId: value });
        if (action === 'draw') this.action('draw');
        if (action === 'draw-resume' && this.club.draw?.pending)
            this.drawStage.open(this.club.draw.pending, { joined: false, phase: 'front' });
        if (action === 'refresh') this.action('refresh');
        if (action === 'reset-ask' || action === 'reset-cancel') {
            selection.resetConfirm = action === 'reset-ask';
            this.render(selection.resetConfirm ? 'reset-cancel' : 'reset');
        }
        if (action === 'reset') this.action('reset');
        if (action === 'reward') this.callbacks.onRewardRetry?.();
    }

    /** 선수·자리 선택을 화면 안에서만 풀어 준다. 저장된 편성은 바뀌지 않는다. */
    clearPick() {
        if (!this.selection.pick) return;
        this.selection.pick = null;
        this.render();
    }

    async action(action, payload = {}) {
        if (this.busy) return;
        const reason = ['refresh', 'reset'].includes(action) ? '' : this.lockReason();
        if (reason) {
            this.notice = reason;
            this.render();
            return;
        }
        this.busy = true;
        this.notice = '';
        this.selection.resetConfirm = false;
        this.render();
        let focus = null,
            drawn = null;
        try {
            const result = await this.callbacks.onClubAction?.(action, payload);
            if (result?.view) {
                this.merge(result.view);
                this.notice = clubText(result.view.message);
                this.updateStartButtons();
            }
            if (action === 'assign') {
                this.selection.pick = null;
                focus = `lineup-${payload.role}`;
            }
            if (action === 'train') focus = 'train';
            if (action === 'reset') focus = 'rename-edit';
            if (action === 'sell') focus = 'tab-roster';
            if (action === 'rename' && result) {
                this.selection.rename = false;
                this.selection.nameDraft = null;
                this.selection.nameError = '';
                focus = 'rename-edit';
            }
            if (action === 'draw') {
                drawn = result?.drawn;
                focus = 'draw-button';
            }
            if (action === 'resolve') {
                const id = this.drawStage.card?.id;
                this.drawStage.close();
                if (payload.release) {
                    this.showNewPlayer(id);
                    focus = `player-${id}`;
                } else focus = 'tab-draw';
            }
        } catch (error) {
            this.notice = clubText(error) || UI.saveFailed();
            if (action === 'rename' && error.kind === 'validation') {
                this.selection.nameError = this.notice;
                focus = 'club-name';
            }
        } finally {
            this.busy = false;
            this.render(focus, action === 'draw');
            if (action === 'resolve' && payload.release)
                document.querySelector('.club-card.selected')?.scrollIntoView({ block: 'nearest' });
        }
        if (drawn) {
            const card =
                this.club.roster.find((value) => value.id === drawn.id) ?? this.club.draw?.pending;
            if (card) this.drawStage.open(card, { joined: drawn.joined });
        }
    }

    /** 새로 합류한 선수를 선수단 탭에서 선택된 상태로 보여 준다. */
    showNewPlayer(id) {
        Object.assign(this.selection, {
            tab: 'roster',
            detail: null,
            pick: { type: 'player', id },
        });
    }

    /**
     * 선수 카드 밀어서 판매: 후보 카드를 왼쪽으로 밀면 판매 버튼이 드러나고, 더 밀면 바로 판다.
     * 세로 스크롤과 탭은 그대로 두려고 가로로 확실히 움직였을 때만 끌기로 본다. 출전 선수는 밀어도 팔리지 않는다.
     */
    swipe(type, event) {
        const state = this.swipeState;
        if (type === 'pointerdown') {
            const row = event.target.closest('.club-card-row');
            if (
                !row ||
                event.target.closest('.club-sell-reveal') ||
                (event.pointerType === 'mouse' && event.button !== 0)
            )
                return;
            for (const other of document.querySelectorAll('.club-card-row.is-open'))
                if (other !== row) this.swipeSet(other, 0);
            this.swipeState = {
                row,
                id: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                base: row.classList.contains('is-open') ? -TAKRAW_SELL_REVEAL_PX : 0,
                drag: false,
                dx: 0,
            };
            return;
        }
        if (!state || state.id !== event.pointerId) return;
        const sellable = state.row.classList.contains('is-sellable'),
            width = state.row.offsetWidth;
        if (type === 'pointermove') {
            const dx = event.clientX - state.x,
                dy = event.clientY - state.y;
            if (!state.drag) {
                if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.5) {
                    if (Math.abs(dy) > 10) this.swipeState = null;
                    return;
                }
                state.drag = true;
                state.row.setPointerCapture?.(event.pointerId);
                state.row.classList.add('is-dragging');
            }
            state.dx = dx;
            if (sellable)
                this.swipeSet(state.row, Math.max(-width, Math.min(0, state.base + dx)), true);
            return;
        }
        this.swipeState = null;
        state.row.classList.remove('is-dragging');
        if (!state.drag) return;
        this.swipeEnd = performance.now(); // 끌기 직후 따라오는 클릭은 카드 선택으로 보지 않는다
        if (type === 'pointercancel') {
            if (sellable) this.swipeSet(state.row, 0);
            return;
        }
        if (!sellable) {
            if (state.dx < -40) {
                this.notice = UI.sellStarter();
                this.render();
            }
            return;
        }
        const offset = Math.max(-width, Math.min(0, state.base + state.dx));
        if (offset <= -width * TAKRAW_SELL_FULL_RATIO) {
            if (!this.lockReason()) {
                this.swipeSet(state.row, -width);
                this.action('sell', { playerId: state.row.dataset.player });
                return;
            }
        }
        this.swipeSet(
            state.row,
            offset < -TAKRAW_SELL_REVEAL_PX / 2 && !this.lockReason() ? -TAKRAW_SELL_REVEAL_PX : 0,
        );
    }

    /** 카드를 offset(px, 0 이하)만큼 밀어 둔다. 밀려 있으면 판매 버튼을 키보드·보조기기가 닿게 한다. */
    swipeSet(row, offset, live = false) {
        row.style.setProperty('--dx', `${offset}px`);
        const open = offset <= -TAKRAW_SELL_REVEAL_PX && !live,
            reveal = row.querySelector('.club-sell-reveal');
        if (!live) row.classList.toggle('is-open', open);
        row.classList.toggle('is-full', offset <= -row.offsetWidth * TAKRAW_SELL_FULL_RATIO);
        if (reveal) reveal.tabIndex = open ? 0 : -1;
    }

    /** 키보드: 후보 카드에서 Delete를 누르면 판매 버튼이 드러나고 포커스가 옮겨 간다. Esc·Delete로 다시 닫는다. */
    swipeKey(event) {
        const row = event.target.closest?.('.club-card-row.is-sellable');
        if (!row || this.lockReason()) return;
        if (event.code === 'Delete' && event.target.closest('.club-card')) {
            event.preventDefault();
            this.swipeSet(row, -TAKRAW_SELL_REVEAL_PX);
            row.querySelector('.club-sell-reveal')?.focus();
        } else if (event.code === 'Escape' && row.classList.contains('is-open')) {
            event.preventDefault();
            event.stopPropagation();
            this.swipeSet(row, 0);
            row.querySelector('.club-card')?.focus();
        }
    }

    /** 뽑기 연출의 확인: 새로 합류한 선수를 선수단 탭에서 선택된 상태로 보인다. */
    showJoined(id) {
        this.showNewPlayer(id);
        this.render(`player-${id}`);
        document.querySelector('.club-card.selected')?.scrollIntoView({ block: 'nearest' });
    }

    click(event) {
        if (
            performance.now() - (this.swipeEnd || 0) < 350 &&
            event.target.closest('.club-card-row')
        ) {
            event.preventDefault();
            return;
        }
        const openRow = event.target.closest('.club-card-row.is-open');
        if (openRow && !event.target.closest('.club-sell-reveal')) {
            event.preventDefault();
            this.swipeSet(openRow, 0);
            return;
        }
        const button = event.target.closest('[data-club-action]');
        if (button) {
            this.press(button);
            return;
        }
        if (!event.target.closest('input, form, summary, footer')) this.clearPick();
    }
}

export { TakrawClubScreen, clubShirt, clubRadar, clubRarityName, clubRoleName };
