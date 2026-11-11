import {
    TAKRAW_TRAINING_LESSONS,
    TAKRAW_TRAINING_TEMPOS,
    takrawTrainingLesson,
} from '../simulation/training.js';
import { say, createTextSetter } from './markup.js';
import { UI } from '../i18n/messages/ui.js';
import { matchText } from '../i18n/messages/match.js';

/** 연습 패널: 레슨·토스 선택과 안내(단계·문구·진행 막대). 상태는 DOM뿐이다. */
class TakrawTrainingPanel {
    constructor({ listen, callbacks, controlText }) {
        this.controlText = controlText;
        this.text = createTextSetter();
        const lessonSelect = document.getElementById('training-lesson');
        lessonSelect.replaceChildren();
        for (const lesson of TAKRAW_TRAINING_LESSONS) {
            const option = document.createElement('option');
            option.value = lesson.id;
            option.textContent = say(lesson.title);
            lessonSelect.appendChild(option);
        }
        listen(lessonSelect, 'change', () => callbacks.onTrainingLesson?.(lessonSelect.value));
        const tempoSelect = document.getElementById('training-tempo');
        tempoSelect.replaceChildren();
        for (const tempo of TAKRAW_TRAINING_TEMPOS) {
            const option = document.createElement('option');
            option.value = tempo.id;
            option.textContent = say(tempo.title);
            tempoSelect.appendChild(option);
        }
        listen(tempoSelect, 'change', () => callbacks.onTrainingTempo?.(tempoSelect.value));
    }

    /** 연습 안내 표현값(presentation/training-coach.js가 만든 coach)을 그린다. */
    update(training) {
        // 점프 전에 발을 먼저 올리는 레슨은 발차기 단계에서 남은 시간 대신 점프 안내를 보인다.
        const prehold = takrawTrainingLesson(training.lesson).prehold;
        const lessonSelect = document.getElementById('training-lesson');
        if (lessonSelect.value !== training.lesson) lessonSelect.value = training.lesson;
        const tempoSelect = document.getElementById('training-tempo');
        if (tempoSelect.value !== training.tempo) tempoSelect.value = training.tempo;
        this.text('training-sequence', this.controlText(say(training.sequence)));
        this.text('training-motion', this.controlText(matchText(training.motionStatus)));
        this.text(
            'training-count',
            UI.trainingCount({ count: Math.max(1, training.attempt || 0) }),
        );
        const stages = {
            ready: UI.stageReady,
            set: UI.stageSet,
            position: UI.stagePosition,
            brake: UI.stageBrake,
            jump: UI.stageJump,
            kick: UI.stageKick,
            contact: UI.stageContact,
            result: UI.stageResult,
        };
        this.text(
            'training-stage',
            stages[training.stage]?.() ||
                (training.title ? say(training.title) : UI.modeTraining()),
        );
        this.text('training-cue', this.controlText(matchText(training.cue)));
        this.text('training-detail', this.controlText(matchText(training.detail)));
        this.text('training-successes', UI.trainingSuccesses({ count: training.successes || 0 }));
        const coach = document.getElementById('training-coach');
        const tone = training.tone || 'neutral';
        if (coach.dataset.tone !== tone) coach.dataset.tone = tone;
        const progress = Math.round(Math.max(0, Math.min(1, Number(training.progress) || 0)) * 100);
        const timing = document.getElementById('training-timing');
        if (timing.getAttribute('aria-valuenow') !== String(progress)) {
            timing.setAttribute('aria-valuenow', String(progress));
            timing.style.setProperty('--timing', `${progress}%`);
        }
        let label = UI.timingDefault();
        if (training.stage === 'ready' || training.stage === 'set') label = UI.timingSetting();
        else if (training.stage === 'result') label = UI.timingNext();
        else if (training.stage === 'contact') label = UI.timingContact();
        else if (training.stage === 'brake') label = UI.timingBrake();
        else if (training.stage === 'jump')
            label = training.shortJump ? UI.timingJumpTap() : UI.timingJumpHold();
        else if (training.stage === 'kick' && training.tone === 'retry')
            label = UI.timingKickRetry();
        else if (training.stage === 'kick' && !prehold)
            label =
                Number.isFinite(training.kickIn) && training.kickIn > 0
                    ? UI.timingKickIn({ value: training.kickIn })
                    : UI.timingKickHold();
        else if (Number.isFinite(training.jumpIn) && training.jumpIn > 0)
            label = UI.timingJumpIn({ value: training.jumpIn });
        else if (training.stage === 'kick') label = UI.timingJumpWithKick();
        this.text('training-timing-label', this.controlText(label));
        timing.setAttribute('aria-valuetext', this.controlText(label));
    }
}

export { TakrawTrainingPanel };
