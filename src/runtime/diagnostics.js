import { DiagnosticRing, redactDiagnostic } from '@bloom-gamekit/debug-tools';
import { TAKRAW_PRODUCT_NAME, TAKRAW_DIAGNOSTIC_NAME } from '../config/game.js';
import { LOCALE } from '../i18n/locale.js';

/**
 * 오류 기록의 단일 원본(gamekit DiagnosticRing)과 치명 오류 화면의 진단 복사 글.
 * 해제할 자원은 없다(링은 메모리 기록뿐).
 */
function createRuntimeDiagnostics({ version }) {
    const ring = new DiagnosticRing({ release: version });

    /** 예외를 원본 그대로 기록하고 돌려준다. 문자열 같은 값만 Error로 바꾼다. */
    function recordError(error, source, visibility = 'blocking') {
        const value = error instanceof Error ? error : new Error(String(error));
        ring.report(value, { kind: source, origin: source, visibility });
        console.error(`[${TAKRAW_PRODUCT_NAME.en}]`, source, value);
        return value;
    }

    /**
     * 치명 오류 화면의 "진단 복사"가 클립보드에 넣는 글. 지금 상태 + 던져진 원래 예외(스택) + 연결 기록.
     * 오류 기록(format)은 링이 이미 가린 JSON이라 그대로 두고(redactDiagnostic은 JSON을 통째로 지운다), 나머지 글만 경로·토큰을 가린다.
     * stateLines는 세션 상태 줄(모드·단계·tick), networkHistory는 연결 기록 줄이다.
     * hitches는 RenderStats의 튄 프레임 글(hitchText)이다. 숫자와 고정 이름뿐이라 가리지 않고 길이도 줄이지 않는다.
     */
    function report({ stateLines, networkHistory, hitches = '' }) {
        const state = [
            `${TAKRAW_DIAGNOSTIC_NAME} ${version}`,
            ...stateLines,
            `locale=${LOCALE.locale} viewport=${innerWidth}x${innerHeight} dpr=${devicePixelRatio} touch=${matchMedia('(pointer: coarse)').matches}`,
            `ua=${navigator.userAgent}`,
        ].join('\n');
        return [
            redactDiagnostic(state, 1200),
            ...(hitches ? [hitches] : []),
            ring.format(),
            ...(networkHistory.length
                ? [redactDiagnostic(`network:\n${networkHistory.join('\n')}`, 4000)]
                : []),
        ].join('\n');
    }

    return {
        recordError,
        report,
        errors: () => ring.snapshot().errors,
    };
}

export { createRuntimeDiagnostics };
