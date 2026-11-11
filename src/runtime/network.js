import { TAKRAW_VERSION } from '../config/game.js';
import { RUNTIME } from '../i18n/messages/runtime.js';

/**
 * 연결 실패 원인별 화면 문구(error)와 연결 카드 단계 이름(phase). 키가 connectionCause가 돌려주는 원인이고,
 * 문구·단계·지표(trackConnectionFailure)가 이 분류 하나를 쓴다.
 */
const CONNECTION_CAUSES = Object.freeze({
    secure: { error: RUNTIME.errSecure, phase: RUNTIME.phaseBrowser },
    sync: { error: RUNTIME.errSync, phase: RUNTIME.phaseSyncFailed },
    version: { error: RUNTIME.errVersion, phase: RUNTIME.phaseVersionFailed },
    relay: { error: RUNTIME.errRelay, phase: RUNTIME.phaseRelayFailed },
    peer: { error: RUNTIME.errPeer, phase: RUNTIME.phasePeerFailed },
    other: { error: RUNTIME.errOther, phase: RUNTIME.phaseFailed },
});

/**
 * gamekit가 코드를 주는 실패의 원인. 코드는 transport 방 오류의 Error.code(version-mismatch)와
 * rollback 세션 failure.reason(join-rejected의 incompatible-session)이다. 코드가 없는 실패는 connectionCause가 메시지로 분류한다.
 */
const CONNECTION_CAUSE_BY_CODE = Object.freeze({
    'version-mismatch': 'version',
    'incompatible-session': 'version',
});

/**
 * 연결 실패의 원인. 화면 문구·단계 이름·지표(trackConnectionFailure)가 같은 분류를 쓴다.
 * code는 gamekit가 준 실패 코드다. 코드가 없거나 모르는 코드면 메시지(raw)를 정규식으로 분류한다.
 * 코드를 주지 않는 실패(릴레이·WebRTC·브라우저 보안 오류와 자유 형식 reason)는 아직 정규식으로 분류한다.
 */
function connectionCause(raw, code) {
    const coded = CONNECTION_CAUSE_BY_CODE[code];
    if (coded) return coded;
    if (/WebCrypto|secure randomness|secure context|HTTPS|crypto\.subtle/i.test(raw))
        return 'secure';
    if (/bootstrap|checkpoint|snapshot|membership-failed/i.test(raw)) return 'sync';
    if (/version|contract|handshake|protocol|simulationVersion|mismatch|incompatible/i.test(raw))
        return 'version';
    if (/No Nostr relay|signaling|relay|publication|Nostr/i.test(raw)) return 'relay';
    if (/WebRTC|ICE|peer|transport|connection/i.test(raw)) return 'peer';
    return 'other';
}

function connectionText(error) {
    return String(error?.message || error || 'unknown')
        .replace(/\s+/g, ' ')
        .slice(0, 180);
}

function readableConnectionError(error, code = error?.code) {
    const raw = connectionText(error);
    return CONNECTION_CAUSES[connectionCause(raw, code)].error({
        detail: raw,
        version: TAKRAW_VERSION,
    });
}

/** 연결 오류 카드의 단계 이름. 원인을 알면 그 원인을 말한다. */
function failurePhase(cause) {
    return CONNECTION_CAUSES[cause].phase();
}

export { connectionCause, connectionText, readableConnectionError, failurePhase };
