import { TAKRAW_CONFIG } from '../config/game.js';
import { impactStyleKey } from './impact.js';

/**
 * 접촉 진동(표시 전용): 모바일 navigator.vibrate와 게임패드 vibrationActuator.
 * 길이·세기는 접촉 연출 이름별 표(visual.impact.rumble.byStyle)를 따르고, 호출하는 쪽이 사용자 조작 팀의 접촉만 넘긴다.
 * 동작 줄이기 설정에서는 진동하지 않는다(진동을 따로 끄는 설정은 없다). 지원하지 않는 기기에서는 아무 일도 없다.
 */
class TakrawRumble {
    constructor({ reducedMotion = () => false } = {}) {
        this.reducedMotion = reducedMotion;
        this.table = TAKRAW_CONFIG.visual.impact.rumble.byStyle;
        this.styles = TAKRAW_CONFIG.visual.impact.styles;
    }

    play(payload) {
        if (this.reducedMotion() || payload.kind === 'body') return;
        const pattern = this.table[impactStyleKey(this.styles, payload)];
        if (!pattern) return;
        navigator.vibrate?.(pattern.ms);
        for (const pad of navigator.getGamepads?.() ?? [])
            pad?.vibrationActuator?.playEffect?.('dual-rumble', {
                duration: pattern.ms,
                strongMagnitude: pattern.strong,
                weakMagnitude: pattern.weak,
            });
    }
}

export { TakrawRumble };
