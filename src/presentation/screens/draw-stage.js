import { TAKRAW_CLUB_RULES } from '../../club/club.js';
import { say, escape } from '../markup.js';
import { UI } from '../../i18n/messages/ui.js';
import { clubShirt, clubRadar, clubRarityName, clubRoleName } from './club.js';

/** 뽑기 연출에서 카드팩이 흔들리는 시간(ms). 건너뛰기·움직임 줄이기는 이 구간을 건너뛴다. */
const TAKRAW_DRAW_PACK_MS = 1500;
const TAKRAW_SHOWCASE_FLIP_MS = 900;

/**
 * 뽑기 연출 레이어(#draw-stage): 지금 보이는 카드와 단계(stage), 단계 타이머, 소개영상이 띄운 장면(scene)을 가진다.
 * 결과는 이미 저장돼 있어 보여 주기만 한다. 확인·나중에·정리는 생성 때 받은 콜백으로 팀 화면에 넘긴다.
 */
class TakrawDrawStage {
    constructor({ showcase, club, busy, onDone, onLater, onResolve }) {
        this.node = document.getElementById('draw-stage');
        this.showcase = showcase;
        this.club = club;
        this.busy = busy;
        this.onDone = onDone;
        this.onLater = onLater;
        this.onResolve = onResolve;
        this.stage = null;
        this.timer = 0;
        this.scene = ''; // 소개영상 대본이 띄운 게임 화면(draw)
    }

    /** 연출이 떠 있는가. */
    get active() {
        return Boolean(this.stage);
    }

    /** 떠 있는 카드(없으면 undefined). */
    get card() {
        return this.stage?.card;
    }

    /** 뽑기 연출: 카드팩 흔들림 → 카드 뒷면 → 탭해서 뒤집기 → 공개. 결과는 이미 저장돼 있어 연출은 보여 주기만 한다. */
    open(card, { joined, phase = 'pack' }) {
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches,
            node = this.node;
        window.clearTimeout(this.timer);
        this.stage = { card, joined, phase: phase === 'pack' && reduced ? 'back' : phase };
        node.hidden = false;
        node.innerHTML = this.content();
        node.querySelector('.draw-backdrop').dataset.phase = this.stage.phase;
        if (this.stage.phase === 'pack')
            this.timer = window.setTimeout(() => this.setPhase('back'), TAKRAW_DRAW_PACK_MS);
        this.focus();
    }

    setPhase(phase) {
        if (!this.stage) return;
        window.clearTimeout(this.timer);
        this.stage.phase = phase;
        this.node.querySelector('.draw-backdrop').dataset.phase = phase;
        // 소개영상에서는 아무도 누르지 않으므로 뒷면을 잠깐 보여 준 뒤 스스로 뒤집는다.
        if (this.showcase && phase === 'back')
            this.timer = window.setTimeout(() => this.setPhase('front'), TAKRAW_SHOWCASE_FLIP_MS);
        this.focus();
    }

    focus() {
        const phase = this.stage?.phase,
            selector = {
                pack: '.draw-skip',
                back: '.draw-card',
                front: '[data-draw-action]:not(.draw-skip):not(.draw-card)',
            }[phase];
        this.node.querySelector(selector)?.focus({ preventScroll: true });
    }

    close() {
        window.clearTimeout(this.timer);
        this.stage = null;
        this.node.hidden = true;
        this.node.replaceChildren();
    }

    content() {
        const { card, joined } = this.stage,
            rules = TAKRAW_CLUB_RULES;
        const bench = this.club().roster.filter((value) => !value.role);
        const front = `<span class="draw-face draw-front"><span class="draw-front-head">${clubShirt(card)}<span><strong>${escape(say(card.name))}</strong><small>${escape(say(card.tag))}</small></span></span><span class="club-rarity" data-rarity="${card.rarity}">${escape(UI.rarityRole({ rarity: clubRarityName(card.rarity), role: clubRoleName(card.preferredRole) }))}</span>${clubRadar(card, card.stats)}</span>`;
        const result = joined
            ? `<p>${escape(UI.joined({ name: say(card.name) }))}</p><button type="button" class="primary-small" data-draw-action="done">${escape(UI.ok())}</button>`
            : `<p>${escape(UI.rosterFull({ count: this.club().roster.length, max: rules.capacity }))}</p>
         <button type="button" class="secondary-small" data-draw-action="refund">${escape(UI.refund({ points: rules.draw.refund[card.rarity] }))}</button>
         <span class="draw-swap-title">${escape(UI.swapTitle())}</span><div class="draw-swap">${bench.map((value) => `<button type="button" class="secondary-small" data-draw-action="release" data-value="${value.id}"><b>${escape(say(value.name))}</b><small>${escape(clubRarityName(value.rarity))} · ${escape(clubRoleName(value.preferredRole))}</small></button>`).join('')}</div>
         <button type="button" class="draw-later" data-draw-action="later">${escape(UI.later())}</button>`;
        return `<div class="draw-backdrop" data-rarity="${card.rarity}" data-phase="pack">
      <button type="button" class="draw-skip" data-draw-action="skip">${escape(UI.skip())}</button>
      <div class="draw-pack" aria-hidden="true"><i></i><b>?</b></div>
      <button type="button" class="draw-card" data-draw-action="flip" aria-label="${escape(UI.flip())}"><span class="draw-card-inner"><span class="draw-face draw-back"><b>?</b><small>${escape(UI.tapToFlip())}</small></span>${front}</span></button>
      <div class="draw-result" role="status">${result}</div></div>`;
    }

    /** Esc: 공개 전이면 건너뛰고, 공개 뒤에는 닫는다(가득 차 정리하지 않은 결과는 뽑기 탭의 이어 보기로 남는다). */
    escape() {
        if (this.stage.phase !== 'front') this.setPhase('front');
        else
            this.click({
                target: this.node.querySelector(
                    this.stage.joined ? '[data-draw-action="done"]' : '[data-draw-action="later"]',
                ),
            });
    }

    click(event) {
        const button = event.target.closest('[data-draw-action]');
        if (!button || !this.stage || this.busy()) return;
        const action = button.dataset.drawAction,
            phase = this.stage.phase;
        if (action === 'skip' && phase !== 'front') this.setPhase('front');
        if (action === 'flip' && phase === 'back') this.setPhase('front');
        if (action === 'done') {
            const id = this.stage.card.id;
            this.close();
            this.onDone(id);
        }
        if (action === 'later') {
            this.close();
            this.onLater();
        }
        if (action === 'refund') this.onResolve({});
        if (action === 'release') this.onResolve({ release: button.dataset.value });
    }

    /** 소개영상 화면 전용: 경기 위에 실제 뽑기 연출을 띄운다(card 없으면 닫는다). 결과는 저장하지 않고 보여 주기만 한다. */
    showScene(card) {
        if (card) this.open(card, { joined: true });
        else this.close();
        this.scene = card ? 'draw' : '';
    }

    dispose() {
        window.clearTimeout(this.timer);
    }
}

export { TakrawDrawStage };
