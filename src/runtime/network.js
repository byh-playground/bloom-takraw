import { createNostrDynamicRoom } from '@bloom-gamekit/transport';
import { TAKRAW_VERSION, TAKRAW_DIAGNOSTIC_NAME } from '../config/game.js';
import { TAKRAW_RUNTIME } from '../config/runtime.js';
import { LOCALE } from '../i18n/locale.js';
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

/**
 * 온라인 연결: 연결 표시 snapshot(유일한 writer), 연결 수명주기(connection), 방(room), 방 세대(epoch)를 소유한다.
 * epoch는 세션이 멈출 때마다(reset) 올라가 이전 연결의 비동기 콜백(방 만들기·재연결·상태 알림)을 무효로 만든다.
 * 통지(구독자 하나):
 *   onChange(snapshot): snapshot이 바뀔 때(→ 화면 연결 표시)
 *   onRosterChange(): 세션 인원이 바뀔 때(→ 세션 시계 재기준·조작 해제)
 *   onFirstConnected(): 두 사람이 처음 모였을 때(→ 경기 화면)
 *   onHandshakeTimeout(): 참가·동기화가 시간을 넘겼을 때(→ 세션 종료). 그 뒤 시간 초과 오류를 표시한다.
 * 조회: trackFailure(category, target, action, props)는 지금 모드를 붙여 지표로 보낸다. isDisposed()는 런타임 종료 여부.
 */
class NetworkLink {
    constructor({
        activeRoom,
        resumeAdapter,
        recordError,
        trackFailure,
        isDisposed,
        onChange,
        onRosterChange,
        onFirstConnected,
        onHandshakeTimeout,
    }) {
        this.activeRoom = activeRoom;
        this.resumeAdapter = resumeAdapter;
        this.recordError = recordError;
        this.trackFailure = trackFailure;
        this.isDisposed = isDisposed;
        this.onChange = onChange;
        this.onRosterChange = onRosterChange;
        this.onFirstConnected = onFirstConnected;
        this.onHandshakeTimeout = onHandshakeTimeout;
        this.snapshot = Object.freeze({
            state: 'idle',
            code: '',
            message: '',
            count: 0,
            phase: RUNTIME.phaseIdle(),
            hint: '',
            diagnostics: '',
        });
        this.connection = {
            abort: null,
            history: [],
            handshake: { startedAtMs: 0 },
            observedFailure: null,
            warning: { message: '', atMs: 0 },
            retry: { pending: new Map(), nextCheckAtMs: 0 },
            rosterSize: 0,
            gameShown: false,
            maintenance: { nextAtMs: 0 },
        };
        this.room = null;
        this.epoch = 0;
    }
    /** 연결 표시 snapshot을 바꾸는 유일한 경로. UI는 받은 frozen snapshot을 그대로 그린다. */
    set(patch) {
        this.snapshot = Object.freeze({ ...this.snapshot, ...patch });
        this.onChange(this.snapshot);
    }

    /** 연결 기록 한 줄(진단 복사·연결 창 로그). */
    event(name, detail = '') {
        const history = this.connection.history;
        const entry = `${new Date().toLocaleTimeString(LOCALE.locale, { hour12: false })} · ${String(name).slice(0, 80)}${detail ? ` · ${String(detail).slice(0, 180)}` : ''}`;
        history.push(entry);
        if (history.length > 28) history.shift();
        this.set({
            diagnostics: `${TAKRAW_DIAGNOSTIC_NAME} ${TAKRAW_VERSION} · ${location.protocol} · secure=${window.isSecureContext}\n${history.join('\n')}`,
        });
    }

    /** 연결 기록 줄의 사본(진단 복사 글). */
    history() {
        return this.connection.history.slice();
    }

    /** 방 역할(host·join). 방이 없으면 undefined. */
    get role() {
        return this.room?.role;
    }

    /** 마지막으로 연 방({ role, room }), 없으면 null·undefined. */
    savedRoom() {
        return this.activeRoom.data?.room;
    }

    /** 부팅 때 방 복귀 정보를 읽는다. 읽지 못하면 오류 값을 돌려준다(연결 창에 알린다). */
    loadResume() {
        return this.activeRoom.load().then(
            (data) => data.room,
            (error) => {
                this.recordError(error, 'resume-load');
                this.event('resume-unavailable', error.message);
                return error;
            },
        );
    }

    /** 이 브라우저가 온라인을 할 수 있는지. 못 하면 오류를 표시·기록하고 false. */
    preflight() {
        if (
            window.isSecureContext &&
            globalThis.crypto?.subtle &&
            typeof globalThis.WebSocket === 'function' &&
            typeof globalThis.RTCPeerConnection === 'function'
        )
            return true;
        this.set({
            state: 'error',
            phase: RUNTIME.phaseBrowser(),
            code: '',
            count: 0,
            message: RUNTIME.netBrowser(),
            hint: RUNTIME.netSameVersion(),
        });
        this.trackFailure('unsupported', 'browser', 'block');
        this.event(
            'preflight-failed',
            `secure=${window.isSecureContext} crypto=${!!globalThis.crypto?.subtle} rtc=${typeof globalThis.RTCPeerConnection}`,
        );
        return false;
    }

    /**
     * 방을 만들거나 들어간다. 그사이 세션이 멈췄으면(epoch가 바뀜) 방을 닫고 null을 돌려준다.
     * 방 만들기가 던진 원래 예외는 그대로 올라간다(호출자가 failConnect로 표시한다).
     */
    async openRoom({ action, roomCode, resuming }) {
        const token = this.epoch,
            connection = this.connection;
        connection.abort = new AbortController();
        this.event('connect-start', `role=${action} version=${TAKRAW_VERSION}`);
        this.set({
            state: 'connecting',
            canResume: resuming,
            phase: resuming
                ? RUNTIME.phaseResuming()
                : action === 'host'
                  ? RUNTIME.phaseHosting()
                  : RUNTIME.phaseJoining(),
            code: action === 'join' ? roomCode : '',
            count: 0,
            hint: '',
            message: action === 'host' ? RUNTIME.netHosting() : RUNTIME.netJoining(),
        });
        const capability = await createNostrDynamicRoom({
            role: action,
            room: roomCode,
            namespace: TAKRAW_RUNTIME.network.namespace,
            resume: { adapter: this.resumeAdapter, key: `room:${roomCode}`, reset: !resuming },
            maxPlayers: 2,
            timeoutMs: TAKRAW_RUNTIME.network.timeout,
            peerTimeoutMs: TAKRAW_RUNTIME.network.peerTimeout,
            relays: TAKRAW_RUNTIME.network.relays,
            rtcConfig: { iceServers: TAKRAW_RUNTIME.network.iceServers },
            signal: connection.abort.signal,
            onStatus: (event) => {
                if (token !== this.epoch) return;
                this.roomStatus(event);
            },
        });
        if (token !== this.epoch || this.isDisposed()) {
            capability.close();
            return null;
        }
        this.room = capability;
        if (!resuming) this.remember({ role: action, room: capability.room });
        this.set({ canResume: true });
        this.event('room-created', `room=${capability.room} role=${action}`);
        return capability;
    }

    /**
     * 방 만들기·입장이 실패했다. 원인별로 기록·지표·표시한다. stopSession()은 세션을 멈추되 방 복귀 정보는 남긴다.
     * 표시하는 연결 기록은 세션을 멈추기 전의 것이다.
     */
    failConnect(error, action, stopSession) {
        this.event('connect-error', String(error?.message || error));
        this.recordError(error, 'network');
        const cause = connectionCause(connectionText(error), error?.code);
        this.trackConnectionFailure(cause, 'connect');
        const diagnostics = this.snapshot.diagnostics;
        stopSession();
        this.set({
            state: 'error',
            phase: failurePhase(cause),
            count: 0,
            code: '',
            diagnostics,
            message: readableConnectionError(error),
            hint: action === 'join' ? RUNTIME.netJoinHint() : RUNTIME.netHostHint(),
        });
    }

    /** 온라인 세션을 열었다. 참가 대기 시간을 처음부터 재고 상태를 바로 정비한다. */
    sessionOpened(session) {
        this.connection.handshake.startedAtMs = 0;
        this.event(
            'session-open',
            `role=${this.room?.role || '?'} players=${session.players.length}`,
        );
        this.maintain(session, performance.now(), true);
    }

    /**
     * 온라인 세션의 연결 상태를 정비한다(기존 deadline pump에서 80ms 간격, force면 즉시).
     * 끊긴 상대 재연결(1초 제한), 실패 원인 기록, 참가 시간 초과, 인원 변화, 표시 갱신, 첫 연결 화면 전환.
     */
    maintain(session, now = performance.now(), force = false) {
        const connection = this.connection;
        if (!force && now < connection.maintenance.nextAtMs) return;
        connection.maintenance.nextAtMs = now + TAKRAW_RUNTIME.hud.interval;
        this.reconnectPeers(session);
        const room = this.room;
        const count = session.players.length;
        const failed = session.failure;
        let state;
        let message;
        let phase;
        const linkCount = room?.transports?.size || 0;
        if (failed) {
            state = 'error';
            const cause = connectionCause(
                connectionText(failed.reason || failed.type || 'session sync failed'),
                failed.reason,
            );
            phase = failurePhase(cause);
            if (connection.observedFailure !== failed) {
                connection.observedFailure = failed;
                this.event('session-failed', `${failed.type || 'failed'} ${failed.reason || ''}`);
                this.recordError(new Error(JSON.stringify(failed)), 'session');
                this.trackConnectionFailure(cause, 'session');
            }
            message = readableConnectionError(
                failed.reason || failed.type || 'session sync failed',
                failed.reason,
            );
        } else if (
            count === 2 &&
            (linkCount < 1 || ['interrupted', 'disconnected'].includes(session.status))
        ) {
            state = 'connecting';
            phase = RUNTIME.phaseReconnecting();
            message = RUNTIME.netReconnecting();
        } else if (!session.ready) {
            state = 'connecting';
            phase = linkCount ? RUNTIME.phaseSyncing() : RUNTIME.phaseWaitingPeer();
            message = linkCount ? RUNTIME.netSyncing() : RUNTIME.netPreparing();
        } else if (count < 2) {
            state = 'listening';
            phase = RUNTIME.phaseWaitingFriend();
            message = RUNTIME.netShareCode();
        } else {
            state = 'connected';
            phase = RUNTIME.phaseConnected();
            message = RUNTIME.netConnected();
            connection.warning.message = '';
        }
        if (state === 'connecting' && linkCount && !connection.handshake.startedAtMs)
            connection.handshake.startedAtMs = performance.now();
        if (state !== 'connecting' || !linkCount) connection.handshake.startedAtMs = 0;
        if (
            state === 'connecting' &&
            linkCount &&
            connection.handshake.startedAtMs &&
            performance.now() - connection.handshake.startedAtMs >
                TAKRAW_RUNTIME.network.handshakeTimeout
        ) {
            const error = new Error('온라인 세션 참가/동기화 시간 초과');
            this.event('session-timeout', error.message);
            this.recordError(error, 'session-timeout');
            this.trackFailure('network', 'timeout', 'fail', { phase: 'handshake' });
            this.onHandshakeTimeout();
            this.set({
                state: 'error',
                phase: RUNTIME.phaseTimeout(),
                count: 0,
                code: '',
                message: RUNTIME.netTimeout(),
                hint: RUNTIME.netVersionHint({ version: TAKRAW_VERSION }),
            });
            return;
        }
        if (count !== connection.rosterSize) {
            connection.rosterSize = count;
            this.onRosterChange();
        }
        const hint =
            state === 'connected'
                ? ''
                : connection.warning.message && performance.now() - connection.warning.atMs < 20000
                  ? connection.warning.message
                  : '';
        const network = this.snapshot;
        if (
            network.state !== state ||
            network.count !== count ||
            network.message !== message ||
            network.phase !== phase ||
            network.hint !== hint
        ) {
            this.set({ state, code: room?.room || network.code, count, message, phase, hint });
        }
        if (state === 'connected' && !connection.gameShown) {
            connection.gameShown = true;
            this.onFirstConnected();
        }
    }

    /** 새 방은 transport의 reset처럼 이전 복귀 정보(읽지 못한 기록 포함)를 버리고 이 방을 쓴다. */
    remember(value) {
        return this.activeRoom
            .reset()
            .then(() =>
                this.activeRoom.update((draft) => {
                    draft.room = value;
                }),
            )
            .catch((error) => this.resumeSaveFailed(error));
    }

    /** 이 방으로 돌아오지 않는다(명시적 퇴장·새 방). */
    forget() {
        this.room?.forgetResume();
        if (!this.activeRoom.data?.room) return;
        this.activeRoom
            .update((draft) => {
                draft.room = null;
            })
            .catch((error) => this.resumeSaveFailed(error));
    }

    /**
     * 세션이 멈출 때의 연결 정리: 방 복귀 정보 버리기(preserveResume가 아니면), 세대 올리기, 진행 중인 방 만들기 취소,
     * 수명주기 값 초기화. 방 자체는 세션을 닫은 뒤 closeRoom()으로 닫는다(세션이 방을 쓰고 있으므로 이 순서를 지킨다).
     */
    reset({ preserveResume = false } = {}) {
        if (!preserveResume) this.forget();
        this.epoch += 1;
        const connection = this.connection;
        connection.retry.pending.clear();
        connection.retry.nextCheckAtMs = 0;
        connection.maintenance.nextAtMs = 0;
        connection.abort?.abort();
        connection.abort = null;
        connection.rosterSize = 0;
        connection.gameShown = false;
        connection.handshake.startedAtMs = 0;
        connection.observedFailure = null;
        connection.warning.message = '';
        connection.warning.atMs = 0;
    }

    closeRoom() {
        this.room?.close();
        this.room = null;
    }

    /** diagnostics().network: 표시 snapshot과 세션·방 연결 상태. */
    diagnostics(session) {
        return {
            ...this.snapshot,
            session: session?.status || null,
            ready: Boolean(session?.ready),
            players: session?.players.slice() || [],
            roomConnections: this.room?.transports?.size || 0,
            roomMetrics: this.room?.metrics || null,
        };
    }

    /** 진행 중인 방 만들기를 취소하고 방을 닫는다(방 복귀 정보는 남긴다). */
    dispose() {
        this.reset({ preserveResume: true });
        this.closeRoom();
    }

    /** 방 상태 알림 하나(릴레이·상대 연결·복귀 저장 실패). */
    roomStatus(event) {
        const connection = this.connection;
        const reason = event.reason || event.message || '';
        if (event.type === 'signaler' && event.status === 'connected') {
            this.event('relay-connected', event.relay || '');
            this.set({ phase: RUNTIME.phaseRelay() });
        } else if (event.type === 'signaler' && event.status === 'error') {
            // 릴레이 하나의 실패는 다른 릴레이가 이어 가므로 기록만 한다. 모두 실패하면 openRoom이 던진 오류를 failConnect가 띄운다.
            this.event('relay-error', `${event.relay || ''} ${reason}`.trim());
        } else if (event.type === 'peer-failed' || event.type === 'signal-error') {
            connection.warning.message = readableConnectionError(reason || event.type);
            connection.warning.atMs = performance.now();
            this.event(event.type, reason);
            this.set({ hint: connection.warning.message });
        } else if (event.type === 'resume-save-failed') {
            this.resumeSaveFailed(event.error);
        } else if (['peer-connected', 'room-ready', 'peer-disconnected'].includes(event.type)) {
            this.event(event.type, reason);
            if (event.type === 'peer-connected') this.set({ phase: RUNTIME.phasePeer(), hint: '' });
        }
    }

    /** 끊긴 상대에게 다시 연결한다(1초에 한 번). 응답은 그사이 세션이 바뀌지 않았을 때만 반영한다. */
    reconnectPeers(session) {
        const connection = this.connection,
            room = this.room;
        const now = performance.now();
        if (!room || !session || session.failure || now < connection.retry.nextCheckAtMs) return;
        connection.retry.nextCheckAtMs = now + 1000;
        for (const id of session.players) {
            if (
                id === session.localPlayerId ||
                room.transports.has(id) ||
                connection.retry.pending.has(id)
            )
                continue;
            const token = this.epoch,
                capability = room;
            connection.retry.pending.set(id, true);
            this.event('reconnect-start');
            capability
                .reconnect(id)
                .catch((error) => {
                    if (token === this.epoch) this.event('reconnect-retry', error.message);
                })
                .finally(() => {
                    if (token === this.epoch) connection.retry.pending.delete(id);
                });
        }
    }

    /** 방 복귀 정보를 쓰지 못하면 연결 창의 안내 줄에 알린다. 경기는 그대로 이어지고 새로고침 뒤 복귀만 안 된다. */
    resumeSaveFailed(error) {
        this.recordError(error, 'resume-save');
        this.event('resume-save-failed', `${error?.kind || ''} ${error?.message || error}`);
        this.set({ hint: RUNTIME.netResumeSaveFailed() });
    }

    /** 연결 오류를 원인별로 분류해 보낸다. phase: connect(방 만들기·입장) | session(온라인 세션 중) */
    trackConnectionFailure(cause, phase) {
        if (cause === 'sync') this.trackFailure('fault', 'sync', 'fail', { phase });
        else if (cause === 'version')
            this.trackFailure('unsupported', 'version', 'block', { phase });
        else this.trackFailure('network', cause, 'fail', { phase });
    }
}

export { NetworkLink, connectionCause, connectionText, readableConnectionError, failurePhase };
