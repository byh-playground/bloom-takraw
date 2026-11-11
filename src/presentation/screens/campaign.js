import { TAKRAW_ELEMENTS, takrawOpponents, takrawSchool } from '../../config/schools.js';
import { say, escape } from '../markup.js';
import { UI } from '../../i18n/messages/ui.js';

/**
 * 도장깨기 화면(대화상자 campaign): 학교 목록과 첫 진입 소개 카드. 소개 카드의 장 번호만 이 화면이 가진다.
 * 팀 정보는 조회 함수(club)로 읽고, 소개를 본 뒤 저장 결과는 mergeClub으로 팀 화면에 넘긴다.
 */
class TakrawCampaignScreen {
    constructor({ node, club, mergeClub, inGame, isOpen, callbacks }) {
        this.node = node;
        this.club = club;
        this.mergeClub = mergeClub;
        this.inGame = inGame;
        this.isOpen = isOpen;
        this.callbacks = callbacks;
        this.intro = { step: 0, replay: false }; // 도장깨기 소개 카드: 몇 번째 장인지, 이미 본 뒤 다시 보는 중인지
    }

    heading() {
        return [UI.campaignKicker(), UI.campaignTitle()];
    }

    uniform(school, big = false) {
        const hex = (value) => `#${value.toString(16).padStart(6, '0')}`;
        return `<span class="campaign-uniform ${big ? 'is-big' : ''}" aria-label="${escape(UI.uniform({ school: say(school.name) }))}" style="--uniform-primary:${hex(school.uniform.primary)};--uniform-secondary:${hex(school.uniform.secondary)}"></span>`;
    }

    /**
     * 첫 도장깨기 소개 3장: 내 학교와 선발 → 앞으로 만날 학교는 모른다 → 첫 상대.
     * 학교가 모두 몇 곳인지, 다음 학교가 어디인지는 일부러 알려 주지 않는다(이길 때마다 하나씩 나타난다).
     */
    introContent(home, first) {
        const intro = this.intro,
            step = intro.step,
            element = (school) => say(this.schoolElement(school));
        const names = ['receiver', 'setter', 'attacker']
            .map(
                (role) =>
                    this.club().roster.find((player) => player.id === this.club().lineup?.[role])
                        ?.name,
            )
            .filter(Boolean)
            .map(say);
        const pages = [
            `<h3>${escape(UI.introHome({ school: say(home.name) }))}</h3><p>${escape(UI.introTrio({ element: element(home) }))}</p>
        <div class="intro-trio">${names.map((name) => `<span>${this.uniform(home, true)}<small>${escape(name)}</small></span>`).join('')}</div>`,
            `<h3>${escape(UI.introMysteryTitle())}</h3><p>${escape(UI.introMystery())}</p>
        <div class="intro-trio"><span class="campaign-uniform is-big is-mystery" role="img" aria-label="${escape(UI.mysterySchool())}"></span></div>`,
            `<h3>${escape(UI.introFirst({ school: say(first.name) }))}</h3>
        <article class="campaign-card">${this.uniform(first)}<div><h3>${escape(UI.stageSchool({ stage: 1, school: say(first.name) }))}</h3><p>${escape(UI.elementOpen({ element: element(first) }))}</p></div></article>
        <p>${escape(UI.introReward())}</p>`,
        ];
        const last = step === pages.length - 1;
        return `<section class="campaign-intro" aria-label="${escape(UI.introLabel({ step: step + 1, total: pages.length }))}">
      <div class="intro-head"><button type="button" class="secondary-small" data-campaign-intro="skip">${escape(UI.skip())}</button></div>
      ${pages[step]}
      <div class="intro-dots" aria-hidden="true">${pages.map((_, i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('')}</div>
      <button type="button" class="primary-small intro-next" data-campaign-intro="${last ? 'done' : 'next'}">${escape(last ? UI.challengeStart() : UI.next())}</button></section>`;
    }

    /** 학교의 속성 이름(TextPair). */
    schoolElement(school) {
        return TAKRAW_ELEMENTS.find((element) => element.id === school.element).name;
    }

    content() {
        const cleared = new Set(this.club().campaign?.cleared || []),
            ready = this.club().status === 'ready' && !this.inGame();
        const home = takrawSchool(this.club().campaign?.home),
            element = (school) => say(this.schoolElement(school));
        if (!home) return `<p>${escape(UI.campaignNeedsTeam())}</p>`;
        const list = takrawOpponents(home.id),
            count = list.filter((school) => cleared.has(school.id)).length;
        if (
            this.club().status === 'ready' &&
            (this.intro.replay || (!this.club().campaign.introSeen && count === 0))
        )
            return this.introContent(home, list[0]);
        // 깬 학교와 지금 도전할 학교까지만 보여 준다. 그다음은 이름 없는 한 칸이고, 전체 단계 수는 어디에도 쓰지 않는다.
        const shown = list.slice(0, count + 1),
            hidden = count + 1 < list.length;
        const cards = shown
            .map((school) => {
                const done = cleared.has(school.id);
                return `<article class="campaign-card">${this.uniform(school)}<div><h3>${escape(UI.stageSchool({ stage: school.stage, school: say(school.name) }))}</h3><p>${escape((done ? UI.elementCleared : UI.elementOpen)({ element: element(school) }))}</p><small>${escape(done ? UI.rewardCollected() : UI.firstClear({ points: school.firstClearTrainingPoints }))}</small></div><button type="button" class="primary-small" data-campaign-school="${school.id}" ${!ready ? 'disabled' : ''}>${escape(done ? UI.rechallenge() : UI.challenge())}</button></article>`;
            })
            .join('');
        const mystery = hidden
            ? `<article class="campaign-card is-mystery"><span class="campaign-uniform is-mystery" aria-hidden="true"></span><div><h3>${escape(UI.mysteryStage({ stage: count + 2 }))}</h3><p>${escape(UI.nextSchool())}</p></div><button type="button" class="primary-small" disabled>${escape(UI.locked())}</button></article>`
            : '';
        return `<p>${UI.campaignHome({ school: escape(say(home.name)), element: escape(element(home)) })}</p><div class="campaign-list">${cards}${mystery}</div>${count === list.length ? `<p>${escape(UI.allCleared())}</p>` : ''}<button type="button" class="secondary-small" data-campaign-intro="replay">${escape(UI.introReplay())}</button>`;
    }

    /** 소개 카드 조작: 다음 장으로, 또는 마치고 저장한다(건너뛰기·도전하기 모두 '봤음'으로 저장). */
    async introClick(action) {
        const intro = this.intro,
            render = () => {
                if (this.isOpen()) this.node.innerHTML = this.content();
            };
        if (action === 'next') {
            intro.step += 1;
            render();
            return;
        }
        if (action === 'replay') {
            intro.step = 0;
            intro.replay = true;
            render();
            return;
        }
        intro.step = 0;
        intro.replay = false;
        render();
        try {
            const result = await this.callbacks.onClubAction?.('campaign-intro');
            if (result?.view) this.mergeClub(result.view);
        } catch {
            /* 저장하지 못해도 목록은 보인다. 다음에 다시 소개가 나올 수 있다. */
        }
        render();
    }

    /** 팀 정보가 바뀌면 스크롤 위치를 지키며 다시 그린다. */
    refresh() {
        const scroll = this.node.scrollTop;
        this.node.innerHTML = this.content();
        this.node.scrollTop = scroll;
    }

    click(event) {
        const intro = event.target.closest('[data-campaign-intro]');
        if (intro) {
            this.introClick(intro.dataset.campaignIntro);
            return;
        }
        const challenge = event.target.closest('[data-campaign-school]');
        if (challenge && !challenge.disabled)
            this.callbacks.onCampaign?.(challenge.dataset.campaignSchool);
    }
}

export { TakrawCampaignScreen };
