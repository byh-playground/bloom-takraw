import { takrawOpponents } from './config/schools.js';
import * as THREE from 'three';
import RAPIER from 'rapier';
import { createLoop, createDeadlineScheduler } from '@bloom-gamekit/simloop';
import { createRoomSession } from '@bloom-gamekit/rollback';
import { createNostrDynamicRoom } from '@bloom-gamekit/transport';
import * as deterministic from '@bloom-gamekit/deterministic';
import { createSave, memoryAdapter } from '@bloom-gamekit/save';
import { registerPwa } from '@bloom-gamekit/pwa';
import {
    createMetrics,
    HttpAdapter,
    MemoryAdapter,
    SessionReplayRecorder,
} from '@bloom-gamekit/metrics';

import {
    TAKRAW_VERSION,
    TAKRAW_PRODUCT_NAME,
    TAKRAW_DIAGNOSTIC_NAME,
    TAKRAW_ID,
    TAKRAW_CONFIG,
} from './config/game.js';
import { createRuntimeDiagnostics } from './runtime/diagnostics.js';
import { createRuntimeStores } from './runtime/stores.js';
import { RuntimeAudio, takrawBgmLevel } from './runtime/audio.js';
import { RuntimeInput } from './runtime/input.js';
import { PresentationFeed } from './runtime/presentation-feed.js';
import { MatchEventJournal } from './runtime/match-events.js';
import { HighlightController } from './runtime/highlight-controller.js';
import { TAKRAW_RUNTIME } from './config/runtime.js';
import { TAKRAW_CLUB_RULES, TakrawClub } from './club/club.js';
import { TakrawGame } from './simulation/game.js';
import { TAKRAW_TRAINING_LESSONS, TAKRAW_TRAINING_TEMPOS } from './simulation/training.js';
import { takrawEncodeIdentity, takrawIdentitySchools } from './simulation/identity.js';
import { takrawHumanPlayerIds } from './simulation/roster.js';
import { TakrawView } from './presentation/view.js';
import { takrawUnitStream } from './simulation/random.js';
import { TakrawUI } from './presentation/ui.js';
import { TakrawIntro } from './presentation/intro.js';
import { TAKRAW_LAUNCH } from './launch.js';
import { LOCALE } from './i18n/locale.js';
import { RUNTIME } from './i18n/messages/runtime.js';
import {
    connectionCause,
    connectionText,
    failurePhase,
    readableConnectionError,
} from './runtime/network.js';
import { takrawHudModel } from './runtime/hud-model.js';
import { takrawMatchSetup, takrawSessionProfile } from './runtime/match-setup.js';

async function bootTakraw() {
    const config = TAKRAW_CONFIG;
    const stepMs = 1000 / config.simulation.tickRate;
    const dependencyState = Object.fromEntries(
        [
            'three',
            'rapier',
            '@bloom-gamekit/input',
            '@bloom-gamekit/simloop',
            '@bloom-gamekit/interpolation',
            '@bloom-gamekit/rollback',
            '@bloom-gamekit/transport',
            '@bloom-gamekit/audio',
            '@bloom-gamekit/presentation-events',
            '@bloom-gamekit/deterministic',
            '@bloom-gamekit/object-pool',
        ].map((name) => [name, { url: import.meta.resolve(name), state: 'ready' }]),
    );
    const diagnostics = createRuntimeDiagnostics({ version: TAKRAW_VERSION });
    const recordError = diagnostics.recordError;
    const listeners = [];
    const pendingCommands = [];
    let identitySent = false; // 온라인에서 내 팀 이름·학교를 이 세션에서 이미 알렸는지
    const stats = { frames: 0, steps: 0, simulationMs: 0, maxSimulationMs: 0, backlogDrops: 0 };
    const clubSession = { team: null, match: null, reward: null };
    let campaignSchoolId = null;
    const rewards = { jobs: [], running: false, timer: null };

    let ui;
    let club;
    let game;
    let view;
    let input = null;
    let audio;
    let codec;
    let session = null;
    let room = null;
    let loop = null;
    let pump = null;
    let feed = null;
    let events = null;
    let latestView = null;
    let intro = null;
    let mode = null;
    const demo = TAKRAW_LAUNCH.showcaseDemo;
    if (demo) document.body.dataset.showcase = '';
    const isolated = TAKRAW_LAUNCH.isolated;
    // 지표도 격리 장면에서는 메모리에만 남긴다. 개발자 본인 플레이는 수집 서버가 접속 키로 나중에 거른다.
    const metrics = createMetrics({
        game: TAKRAW_ID,
        version: TAKRAW_VERSION,
        locale: LOCALE.locale,
        adapter: isolated ? new MemoryAdapter() : new HttpAdapter(TAKRAW_RUNTIME.metrics.endpoint),
    });
    let metricsMatch = null; // 기록 중인 세션의 경기 관측: { ordinal, finishedAt, recorded }
    let watchSeed = TAKRAW_RUNTIME.watch.showcaseSeed;
    let watchPoint = { tick: null, restarting: false };
    const highlight = new HighlightController({
        tickRate: config.simulation.tickRate,
        showReplay: (reason) => ui.showReplay(reason),
        snapCamera: () => view.snapCamera(),
        onPlaybackChange(active) {
            releaseControls();
            loop?.resetTiming();
            if (active) pump?.stop();
            else if (!paused) {
                pump?.start();
                pump?.wake();
            }
        },
    });
    let debugMatchSeed = null; // 확인용 장면(scene=match)이 고정한 AI 대전 시드
    let bootstrapStage = 'interface';
    let disposed = false;
    let failed = false;
    let paused = false;
    let releasing = false;
    let observationPending = false;
    let run = 0;
    let animation = 0;
    let renderTime = -Infinity;
    let hudTime = -Infinity;
    let network = Object.freeze({
        state: 'idle',
        code: '',
        message: '',
        count: 0,
        phase: RUNTIME.phaseIdle(),
        hint: '',
        diagnostics: '',
    });
    const connection = {
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

    function isReady() {
        return bootstrapStage === 'ready';
    }

    function canStart(nextMode) {
        if (!isReady() || disposed || failed) return false;
        if (nextMode === 'match' || nextMode === 'training') return club?.status === 'ready';
        return nextMode === 'local' || nextMode === 'online' || nextMode === 'watch';
    }

    // 상태 줄을 비울 때(경기 시작·처음 화면 복귀)도 PWA 오류 알림은 남긴다.
    let appNotice = null;
    function showBootStatus(message = '', isError = false) {
        if (!message && !isError && appNotice)
            ui.setBootStatus({ phase: bootstrapStage, ...appNotice });
        else ui.setBootStatus({ phase: bootstrapStage, message, isError });
    }
    function showAppNotice(notice) {
        appNotice = notice;
        showBootStatus();
    }

    // 설치·오프라인 시작(sw.js). 새로고침하면 항상 최신 버전이라 업데이트 알림은 없다. 격리 장면(?debug, ?showcaseDemo=1)과 iframe 안은 등록하지 않는다. 오류는 처음 화면의 상태 줄에, 설치는 설정 창에 둔다.
    let pwa = null;
    // 다른 페이지의 iframe 안(itch.io 임베드 등)에서는 설치할 수 없고, 같은 출처를 나눠 쓰는 다른 게임과 캐시가 섞일 수 있어 등록하지 않는다.
    const embedded = TAKRAW_LAUNCH.embedded;
    function startPwa() {
        pwa = registerPwa({
            serviceWorker: './sw.js',
            onError: (error) => pwaFailed(error),
            onInstallable: () => ui.setInstallable(true),
        });
    }
    function pwaFailed(error) {
        recordError(error, 'pwa');
        showAppNotice({
            message: RUNTIME.pwaFailed({ detail: error?.message || error }),
            isError: true,
            reload: false,
        });
    }
    async function installPwa() {
        ui.setInstallable(false);
        try {
            await pwa.install();
        } catch (error) {
            pwaFailed(error);
        }
    }

    const stores = createRuntimeStores({ isolated });
    const { resume: resumeAdapter, activeRoom, soundSettings, openClubSave } = stores;

    /** 방 복귀 정보를 쓰지 못하면 연결 창의 안내 줄에 알린다. 경기는 그대로 이어지고 새로고침 뒤 복귀만 안 된다. */
    function resumeSaveFailed(error) {
        recordError(error, 'resume-save');
        networkEvent('resume-save-failed', `${error?.kind || ''} ${error?.message || error}`);
        setNetwork({ hint: RUNTIME.netResumeSaveFailed() });
    }

    /** 새 방은 transport의 reset처럼 이전 복귀 정보(읽지 못한 기록 포함)를 버리고 이 방을 쓴다. */
    function rememberRoom(value) {
        return activeRoom
            .reset()
            .then(() =>
                activeRoom.update((draft) => {
                    draft.room = value;
                }),
            )
            .catch(resumeSaveFailed);
    }

    function forgetRoom() {
        room?.forgetResume();
        if (!activeRoom.data?.room) return;
        activeRoom
            .update((draft) => {
                draft.room = null;
            })
            .catch(resumeSaveFailed);
    }

    function maintainConnections() {
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
            const token = run,
                capability = room;
            connection.retry.pending.set(id, true);
            networkEvent('reconnect-start');
            capability
                .reconnect(id)
                .catch((error) => {
                    if (token === run) networkEvent('reconnect-retry', error.message);
                })
                .finally(() => {
                    if (token === run) connection.retry.pending.delete(id);
                });
        }
    }

    function networkEvent(name, detail = '') {
        const entry = `${new Date().toLocaleTimeString(LOCALE.locale, { hour12: false })} · ${String(name).slice(0, 80)}${detail ? ` · ${String(detail).slice(0, 180)}` : ''}`;
        connection.history.push(entry);
        if (connection.history.length > 28) connection.history.shift();
        setNetwork({
            diagnostics: `${TAKRAW_DIAGNOSTIC_NAME} ${TAKRAW_VERSION} · ${location.protocol} · secure=${window.isSecureContext}\n${connection.history.join('\n')}`,
        });
    }

    /**
     * 놀이를 멈춘 실패를 성격별 분류로 지표에 보낸다(README "게임 지표"). 오류 메시지·스택은 보내지 않는다.
     *   fault/<simulation·desync·sync>/fail: 게임 결함 의심
     *   network/<relay·peer·secure·other·timeout>/fail: 연결 사정
     *   unsupported/<browser·version>/block: 이 환경이나 버전 조합으로는 온라인을 할 수 없음
     */
    function trackFailure(category, target, action, props = {}) {
        metrics.track(category, target, action, { mode: mode || 'menu', ...props });
    }

    /** 연결 오류를 원인별로 분류해 보낸다. phase: connect(방 만들기·입장) | session(온라인 세션 중) */
    function trackConnectionFailure(cause, phase) {
        if (cause === 'sync') trackFailure('fault', 'sync', 'fail', { phase });
        else if (cause === 'version') trackFailure('unsupported', 'version', 'block', { phase });
        else trackFailure('network', cause, 'fail', { phase });
    }

    function listen(target, type, callback, options) {
        target.addEventListener(type, callback, options);
        listeners.push(() => target.removeEventListener(type, callback, options));
    }

    function diagnosticReport() {
        return diagnostics.report({
            stateLines: [
                `mode=${mode ?? 'menu'} phase=${latestView?.state.phase ?? 'loading'} tick=${session?.tick ?? latestView?.state.tick ?? 0}`,
            ],
            networkHistory: connection.history,
        });
    }

    /** 소리 설정을 쓰지 못하면 설정 창의 효과음 줄에 알린다. 소리는 바꾼 대로 나고 저장만 안 된 상태다. */
    function soundSaveFailed(error) {
        recordError(error, 'sound-settings-save');
        const known = {
            conflict: RUNTIME.soundConflict,
            unreadable: RUNTIME.soundUnreadable,
            storage: RUNTIME.soundStorage,
        }[error?.kind];
        ui.setSound({
            message: known ? known() : RUNTIME.soundFailed({ detail: error?.message || error }),
        });
    }

    function setNetwork(value) {
        network = Object.freeze({ ...network, ...value });
        ui?.setNetwork(network);
    }

    function publishClub() {
        if (disposed || !club || !ui) return;
        const pending =
            rewards.jobs.find((job) => job.status === 'error') || rewards.jobs[0] || null;
        ui.setClub({
            ...club.getView(),
            pendingReward: pending ? { status: pending.status, message: pending.message } : null,
        });
    }

    function matchId() {
        const bytes = new Uint8Array(16);
        globalThis.crypto.getRandomValues(bytes);
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    }

    function observeMatchResult() {
        const match = clubSession.match,
            state = latestView?.state;
        if (
            disposed ||
            mode !== 'match' ||
            !match ||
            match.finished ||
            state?.phase !== 'finished' ||
            ![0, 1].includes(state.matchWinner)
        )
            return;
        match.finished = true;
        const won = state.matchWinner === 0,
            reward = TAKRAW_CLUB_RULES.rewards[won ? 'win' : 'loss'];
        const job = {
            id: match.id,
            won,
            mode: 'match',
            schoolId: match.schoolId,
            status: 'queued',
            message: RUNTIME.rewardSaving(),
            ...reward,
        };
        rewards.jobs.push(job);
        clubSession.reward = job;
        // 완료 관측은 한 번만 한다. 영속 I/O는 시뮬레이션 콜백 밖에서 실행한다.
        scheduleRewards();
    }

    // 끝난 경기 하나를 지표로 남긴다. 온라인은 예측한 끝을 남기지 않도록 그 tick이 확정된 뒤에 남긴다.
    // 두 사람이 같은 matchId(방 세션·roster 세대·그 세대에서 끝난 순번)를 보내 서버에 한 행만 남는다.
    function observeMetricsMatch() {
        const state = latestView?.state,
            track = metricsMatch;
        if (disposed || !session || !track) return;
        if (state?.phase !== 'finished' || ![0, 1].includes(state.matchWinner)) {
            track.finishedAt = null;
            track.recorded = false;
            return;
        }
        if (track.recorded) return;
        track.finishedAt ??= session.tick;
        if (session.resimulating || session.confirmedTick + 1 < track.finishedAt) return;
        track.recorded = true;
        const online = mode === 'online';
        const recorder = new SessionReplayRecorder({
            session,
            mode,
            ...(online
                ? { matchId: `${session.sessionId}:${session.epoch}:${track.ordinal}` }
                : {}),
        });
        track.ordinal += 1;
        try {
            metrics.recordMatch(recorder, {
                winner: state.matchWinner,
                sets: [...state.sets],
                score: [...state.score],
                ticks: state.tick,
                seed: state.seed,
                ...(mode === 'match' ? { schoolId: clubSession.match?.schoolId ?? null } : {}),
                ...(online ? { localTeam: localTeam() } : {}),
            });
        } catch (error) {
            recordError(error, 'metrics-match');
        }
    }

    function scheduleRewards(retry = false) {
        if (disposed) return;
        if (retry)
            for (const job of rewards.jobs) if (job.status === 'error') job.status = 'queued';
        if (
            rewards.running ||
            rewards.timer !== null ||
            !rewards.jobs.some((job) => job.status === 'queued')
        )
            return;
        rewards.timer = window.setTimeout(() => {
            rewards.timer = null;
            saveRewards();
        }, 0);
    }

    async function saveRewards() {
        if (disposed || rewards.running) return;
        rewards.running = true;
        try {
            let job;
            while (!disposed && (job = rewards.jobs.find((value) => value.status === 'queued'))) {
                job.status = 'saving';
                job.message = RUNTIME.rewardSaving();
                publishClub();
                hudTime = -Infinity;
                try {
                    await club.rewardMatch({
                        id: job.id,
                        won: job.won,
                        mode: job.mode,
                        schoolId: job.schoolId,
                    });
                    const actual = club.getView().lastReward;
                    job.status = 'saved';
                    if (actual?.id === job.id) {
                        job.credits = actual.credits;
                        job.trainingPoints = actual.trainingPoints;
                        job.message = RUNTIME.rewardSaved({
                            credits: job.credits,
                            points: job.trainingPoints,
                        });
                    } else job.message = RUNTIME.rewardAlready();
                    rewards.jobs.splice(rewards.jobs.indexOf(job), 1);
                } catch (error) {
                    job.status = 'error';
                    job.message = RUNTIME.rewardFailed();
                    recordError(error, 'club-reward');
                }
                if (clubSession.match?.id === job.id) clubSession.reward = job;
            }
        } finally {
            rewards.running = false;
            publishClub();
            hudTime = -Infinity;
            scheduleRewards();
        }
    }

    async function retryReward() {
        if (disposed || !club) return;
        try {
            await club.refresh();
            scheduleRewards(true);
        } catch (error) {
            recordError(error, 'club-refresh');
        }
    }

    async function clubAction(action, payload = {}) {
        if (!club || disposed) return null;
        if (action === 'refresh') return club.refresh();
        if (mode || ui.inGame) throw new Error('팀 변경은 처음 화면에서 할 수 있어요.');
        if (action === 'rename') return club.rename(payload.name);
        if (action === 'assign') return club.assign(payload.role, payload.playerId);
        if (action === 'train') return club.train(payload.playerId);
        if (action === 'sell') return club.sell(payload.playerId);
        if (action === 'reset') return club.reset();
        if (action === 'campaign-intro') return club.seeCampaignIntro();
        if (action === 'draw') return club.draw();
        if (action === 'resolve') return club.resolveDraw({ release: payload.release ?? null });
        throw new Error('팀 관리 동작을 확인해 주세요.');
    }

    function localTeam() {
        if (!session || mode !== 'online') return 0;
        return game.teamById?.[session.localPlayerId] ?? 0;
    }

    function controlsAllowed() {
        return Boolean(
            isReady() &&
            session?.ready &&
            !paused &&
            !highlight.active &&
            !session.failure &&
            (mode !== 'online' || session.players.length === 2),
        );
    }

    function clearDeviceState() {
        input?.clear();
    }

    function releaseControls() {
        if (releasing) return;
        releasing = true;
        try {
            clearDeviceState();
            loop?.releaseInput();
        } finally {
            releasing = false;
        }
    }

    function observeSoon() {
        if (!loop || observationPending || disposed) return;
        observationPending = true;
        queueMicrotask(() => {
            observationPending = false;
            if (!loop || disposed) return;
            try {
                loop.observeInput(performance.now());
                pump?.wake();
            } catch (error) {
                simulationFailed(error);
            }
        });
    }

    function resetCamera() {
        view?.resetCamera();
        observeSoon();
    }

    function getInput() {
        const commands = pendingCommands
            .splice(0)
            .map((code) => ({ payload: Uint8Array.of(code) }));
        if (mode === 'online' && !identitySent && session?.ready && session.players.length === 2) {
            // 두 사람이 모이면 내 팀 이름·학교를 한 번 알린다(표시 전용)
            identitySent = true;
            metrics.track('match', 'online', 'start');
            const mine = club.getView();
            commands.push({
                payload: takrawEncodeIdentity(
                    mine.campaign.home,
                    mine.teamName || RUNTIME.myTeam(),
                ),
            });
        }
        // 명령 순서: [대기 명령..., 팀 알림?, 점프(1), 발차기(2), 2P 점프(11), 2P 발차기(12)]. 바꾸면 네트워크·경기 기록 바이트가 바뀐다.
        const { input: bytes, edges } = input.sample({
            allowed: controlsAllowed(),
            local2p: mode === 'local',
            // Both local players share the same screen; online peers each see their
            // own team from behind. Only world-space input crosses the network.
            movement: (right, back) => view.screenMovement(right, back, localTeam()),
        });
        if (edges.jump) commands.push({ payload: Uint8Array.of(1) });
        if (edges.kick) commands.push({ payload: Uint8Array.of(2) });
        if (edges.p2Jump) commands.push({ payload: Uint8Array.of(11) });
        if (edges.p2Kick) commands.push({ payload: Uint8Array.of(12) });
        return { input: bytes, commands };
    }

    /** 보간 표시를 처음부터 다시 시작한다(경기 시작·처음 화면 복귀). 득점 연출·응원과 마지막 접촉도 함께 지운다. */
    function resetPresentation() {
        feed.reset();
        view.scoreMotion.reset();
        view.resetCheer();
        events.forgetContact();
    }

    function maintainNetwork(now = performance.now(), force = false) {
        if (mode !== 'online' || !session) return;
        if (!force && now < connection.maintenance.nextAtMs) return;
        connection.maintenance.nextAtMs = now + TAKRAW_RUNTIME.hud.interval;
        maintainConnections();
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
                networkEvent('session-failed', `${failed.type || 'failed'} ${failed.reason || ''}`);
                recordError(new Error(JSON.stringify(failed)), 'session');
                trackConnectionFailure(cause, 'session');
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
            networkEvent('session-timeout', error.message);
            recordError(error, 'session-timeout');
            trackFailure('network', 'timeout', 'fail', { phase: 'handshake' });
            stopSession();
            setNetwork({
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
            loop?.resetTiming();
            pump?.rebase();
            releaseControls();
        }
        const hint =
            state === 'connected'
                ? ''
                : connection.warning.message && performance.now() - connection.warning.atMs < 20000
                  ? connection.warning.message
                  : '';
        if (
            network.state !== state ||
            network.count !== count ||
            network.message !== message ||
            network.phase !== phase ||
            network.hint !== hint
        ) {
            setNetwork({ state, code: room?.room || network.code, count, message, phase, hint });
        }
        if (state === 'connected' && !connection.gameShown) {
            connection.gameShown = true;
            ui.showGame('online');
            ui.canvas.focus({ preventScroll: true });
        }
    }

    function selectedHud() {
        return takrawHudModel({
            view: latestView,
            mode,
            team: localTeam(),
            watchSeed,
            tick: game.state.tick,
            matchReward:
                clubSession.match?.id === clubSession.reward?.id ? clubSession.reward : null,
            campaignSchoolId: clubSession.match?.schoolId || null,
            connection: network.message,
            maxLead: config.visual.attackGuide.maxLead,
        });
    }

    /** 재생 장면을 그린다. 그릴 장면이 없으면(끝남·첫 장면 대기) false라 멈춘 실제 경기를 그대로 그린다. */
    function renderHighlight(now) {
        const replay = highlight.frame(now, paused);
        if (!replay) return false;
        events?.update(now);
        view.render(
            replay.poses,
            { ...latestView, state: { ...latestView.state, ...replay.state } },
            now,
            { team: localTeam(), mode, replay: { orbit: TAKRAW_RUNTIME.highlight.camera } },
        );
        return true;
    }

    function renderScene(now = performance.now()) {
        if (!view || !feed?.ready || !latestView) return;
        if (highlight.active && !highlight.running) highlight.end();
        if (highlight.active && renderHighlight(now)) {
            stats.frames += 1;
            return;
        }
        feed.publish(latestView, false, now);
        events.confirm(session);
        events.update(now);
        if (mode === 'online') view.setSchools(takrawIdentitySchools(latestView.teamSchools));
        view.render(feed.frame(now), latestView, now, { team: localTeam(), mode });
        stats.frames += 1;
        const hudInterval =
            mode === 'training'
                ? Math.min(TAKRAW_RUNTIME.hud.interval, 1000 / 30)
                : TAKRAW_RUNTIME.hud.interval;
        if (now - hudTime >= hudInterval) {
            hudTime = now;
            if (mode) ui.update(selectedHud());
        }
    }

    function frame() {
        if (disposed) return;
        animation = requestAnimationFrame(frame);
        if (failed) return;
        // 표본 수신과 표시에는 같은 단조 시계를 쓴다. RAF timestamp는 직전 입력보다 오래될 수 있다.
        const now = performance.now();
        if (now - renderTime + 0.5 < 1000 / TAKRAW_RUNTIME.clock.renderHz) return;
        renderTime = now;
        try {
            loop?.observeInput(now);
            if (loop) loop.render();
            else renderScene(now);
        } catch (error) {
            simulationFailed(error);
        }
    }

    function simulationFailed(error, kind = 'simulation') {
        if (failed) return error;
        failed = true;
        const value = recordError(error, 'simulation', 'fatal');
        trackFailure('fault', kind, 'fail');
        pump?.stop();
        loop?.stop();
        releaseControls();
        if (mode === 'online') {
            setNetwork({ state: 'error', message: RUNTIME.netStopped() });
        }
        ui.showFatal(RUNTIME.runFailed());
        return value;
    }

    function stopSession({ preserveResume = false } = {}) {
        if (!preserveResume) forgetRoom();
        run += 1;
        connection.retry.pending.clear();
        connection.retry.nextCheckAtMs = 0;
        connection.maintenance.nextAtMs = 0;
        connection.abort?.abort();
        connection.abort = null;
        releaseControls();
        pump?.stop();
        loop?.stop();
        pump = null;
        loop = null;
        session?.close();
        session = null;
        room?.close();
        room = null;
        events?.close();
        highlight.stop();
        pendingCommands.length = 0;
        paused = false;
        failed = false;
        mode = null;
        connection.rosterSize = 0;
        connection.gameShown = false;
        connection.handshake.startedAtMs = 0;
        connection.observedFailure = null;
        connection.warning.message = '';
        connection.warning.atMs = 0;
    }

    function onSessionEvent(event, token) {
        if (token !== run || disposed) return;
        if (event.type === 'rollback') {
            events.beginRollback(event.from);
            feed.invalidate('rollback');
        } else if (event.type === 'reconciled') {
            events.endRollback();
            latestView = game.getView();
            feed.invalidate('rollback');
        } else if (event.type === 'membership-committed' || event.type === 'recovered') {
            events.replace();
            latestView = game.getView();
            feed.invalidate('reset');
            if (event.type === 'membership-committed' && metricsMatch) metricsMatch.ordinal = 0;
            loop?.resetTiming();
            pump?.rebase();
        }
        if (
            [
                'membership-committed',
                'peer-disconnected',
                'recovered',
                'fatal',
                'desync-unrecoverable',
            ].includes(event.type)
        ) {
            networkEvent(`session:${event.type}`, event.reason || `tick=${event.tick ?? '?'}`);
        }
        // fatal은 단계가 던진 원래 예외를 곧바로 다시 던지므로 그 예외가 onError로 올라온다. 여기서 감싸 먼저 실패 처리하면 원래 예외가 버려진다.
        // desync-unrecoverable은 던져진 예외가 없어 세션이 알려 준 사실로 직접 만든 오류다.
        if (event.type === 'desync-unrecoverable')
            simulationFailed(new Error(event.reason || event.type), 'desync');
    }

    function openSession(nextMode, capability, token) {
        mode = nextMode;
        const recorded = TAKRAW_RUNTIME.metrics.modes.includes(nextMode);
        metricsMatch = recorded ? { ordinal: 0, finishedAt: null, recorded: false } : null;
        // 온라인 경기 시작은 두 사람이 모였을 때(identitySent) 남긴다.
        if (nextMode !== 'online') metrics.track('match', nextMode, 'start');
        watchPoint = { tick: null, restarting: false };
        const setup = takrawMatchSetup({
            mode: nextMode,
            home: () => club.getView().campaign.home,
            homeTeam: () => club.matchTeam(),
            campaignSchoolId,
            watchSeed,
            roomCode: capability?.room,
            debugSeed: debugMatchSeed,
            randomSeed: () => crypto.getRandomValues(new Uint32Array(1))[0],
        });
        view.setSchools(setup.schools);
        paused = false;
        audio?.setBackground(TAKRAW_RUNTIME.bgm.levelRampMs);
        clubSession.team = setup.home;
        clubSession.match =
            nextMode === 'match'
                ? { id: matchId(), finished: false, schoolId: campaignSchoolId }
                : null;
        clubSession.reward = null;
        game.setTeams(clubSession.team, setup.away);
        game.setTemperaments(setup.temperaments);
        game.reset(nextMode, undefined, setup.seed);
        latestView = game.getView();
        resetPresentation();
        events.replace();
        const online = nextMode === 'online';
        let firstCheckpointReadback = true;
        const adapter = {
            saveInto: (out) => codec.encodeInto(game.save(), out),
            load(bytes) {
                const data = codec.decode(bytes);
                if (!game.validate(data)) throw new Error('Invalid Takraw snapshot');
                game.load(data);
                highlight.reset();
                if (online && firstCheckpointReadback) {
                    firstCheckpointReadback = false;
                    const replay = codec.encode(game.save());
                    const identical =
                        bytes.length === replay.length &&
                        bytes.every((value, index) => value === replay[index]);
                    const actual = identical ? data : codec.decode(replay);
                    const physicalSame =
                        data.physics.snapshot.length === actual.physics.snapshot.length &&
                        data.physics.snapshot.every(
                            (value, index) => value === actual.physics.snapshot[index],
                        );
                    networkEvent(
                        identical ? 'checkpoint-verified' : 'checkpoint-mismatch',
                        `physics=${physicalSame ? 'equal' : 'different'} bytes=${bytes.length}/${replay.length}`,
                    );
                }
                latestView = game.getView();
                feed.invalidate('reset');
            },
            validateSnapshot(bytes) {
                try {
                    return game.validate(codec.decode(bytes));
                } catch {
                    return false;
                }
            },
            applyMembership(change) {
                game.applyMembership(change);
                highlight.reset();
                latestView = game.getView();
            },
            step(context) {
                const begin = performance.now();
                highlight.anchorIfNeeded(game, codec, mode);
                game.step(context);
                latestView = game.getView();
                events.emit(context, latestView);
                highlight.record(context, latestView);
                const elapsed = performance.now() - begin;
                stats.steps += 1;
                stats.simulationMs += elapsed;
                stats.maxSimulationMs = Math.max(stats.maxSimulationMs, elapsed);
            },
        };
        const profile = takrawSessionProfile({ online, tickRate: config.simulation.tickRate });
        identitySent = false;
        session = createRoomSession({
            mode: online ? 'online' : 'local',
            ...(online ? { room: capability } : { localPlayerId: 'local', localFastPath: true }),
            simulationVersion: TAKRAW_VERSION,
            seed: TAKRAW_RUNTIME.network.sessionSeed,
            inputSize: config.input.size,
            adapter,
            profile,
            recordReplay: recorded,
            membership: {
                maxPlayers: 2,
                transitionTimeoutMs: TAKRAW_RUNTIME.network.transitionTimeout,
                reconnectGraceMs: TAKRAW_RUNTIME.network.reconnectGrace,
                maxCatchupSteps: TAKRAW_RUNTIME.clock.maxCatchupSteps,
            },
            onEvent: (event) => onSessionEvent(event, token),
        });
        loop = createLoop({
            session,
            rates: {
                baseHz: TAKRAW_RUNTIME.clock.baseHz,
                inputHz: TAKRAW_RUNTIME.clock.inputHz,
                renderHz: TAKRAW_RUNTIME.clock.renderHz,
            },
            getInput,
            canObserveInput: () => Boolean(session?.ready && !session.failure),
            canAdvance: () =>
                Boolean(
                    session?.ready &&
                    !session.failure &&
                    (online ? session.players.length === 2 : !paused && !highlight.active),
                ),
            onAdvance() {
                feed.publish(latestView);
                events.confirm(session);
                observeMatchResult();
                observeMetricsMatch();
                observeWatchLoop(token);
                highlight.tryBegin(mode);
            },
            onInputRelease: clearDeviceState,
            onError: (error) => simulationFailed(error),
            onBacklogDrop() {
                stats.backlogDrops += 1;
            },
            render: () => renderScene(performance.now()),
        });
        let maintenanceDeadline = null;
        pump = createDeadlineScheduler({
            getDeadlineMs: () => {
                // 입장 대기는 simulation debt를 따라잡는 시간이 아니다. 방 정비만 60Hz로 유지한다.
                if (session && (!session.ready || (online && session.players.length < 2))) {
                    return maintenanceDeadline;
                }
                return loop?.nextDeadlineMs ?? null;
            },
            pulse(now) {
                if (!loop || token !== run) return;
                maintenanceDeadline = now + 1000 / TAKRAW_RUNTIME.clock.inputHz;
                loop.pollInput(now);
                loop.pulse(now, { render: false, input: false });
                // Network commands belong to the existing pump, not to rendering.
                maintainNetwork(now);
            },
        });
        feed.publish(latestView, true);
        loop.observeInput(performance.now());
        pump.start();
        showBootStatus('', false);
        if (online) {
            connection.handshake.startedAtMs = 0;
            networkEvent(
                'session-open',
                `role=${room?.role || '?'} players=${session.players.length}`,
            );
            maintainNetwork(performance.now(), true);
        } else {
            ui.showGame(nextMode);
            ui.canvas.focus({ preventScroll: true });
            setNetwork({ state: 'idle', code: '', message: '', count: 0 });
        }
        hudTime = -Infinity;
        audio.unlock();
    }

    /** 관전은 그 시드의 첫 1점만 반복한다. 득점 뒤 loopHoldMs가 지나면 같은 시드를 처음부터 다시 연다(루프 콜백 안에서 세션을 부수지 않도록 한 박자 늦춘다). */
    function observeWatchLoop(token) {
        if (mode !== 'watch' || watchPoint.restarting) return;
        const { score, tick } = game.state;
        if (score[0] + score[1] < 1) return;
        watchPoint.tick ??= tick;
        if (
            tick - watchPoint.tick <
            (TAKRAW_RUNTIME.watch.loopHoldMs / 1000) * config.simulation.tickRate
        )
            return;
        watchPoint.restarting = true;
        setTimeout(() => {
            if (token === run && mode === 'watch') startWatch(watchSeed);
        }, 0);
    }

    /** 시드 하나가 AI 대 AI 경기 하나다. 팀·성향은 기본값이라 저장소를 읽거나 쓰지 않는다. */
    function startWatch(seed) {
        const value = Number(seed);
        if (
            !Number.isInteger(value) ||
            value < 0 ||
            value > TAKRAW_RUNTIME.watch.maxSeed ||
            !isReady()
        )
            return false;
        watchSeed = value;
        startLocal('watch');
        return true;
    }

    function startLocal(nextMode) {
        if (!canStart(nextMode)) {
            publishClub();
            return;
        }
        audio.unlock();
        observeMatchResult();
        stopSession();
        try {
            openSession(nextMode, null, run);
        } catch (error) {
            simulationFailed(error);
        }
    }

    async function connect(action, code, resuming = false) {
        if (!isReady() || disposed) return;
        if (action === 'close') {
            quit();
            return;
        }
        if (action === 'resume') {
            const saved = activeRoom.data?.room;
            if (saved) return connect(saved.role, saved.room, true);
            setNetwork({ state: 'error', canResume: false, message: RUNTIME.netNoResume() });
            return;
        }
        if (action !== 'host' && action !== 'join') return;
        metrics.track('online', resuming ? 'resume' : action, 'click');
        const roomCode = String(
            code ||
                (action === 'host'
                    ? String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0')
                    : ''),
        ).trim();
        if (action === 'join' && !/^\d{4}$/.test(roomCode)) {
            setNetwork({ state: 'error', message: RUNTIME.netEnterCode(), count: 0 });
            return;
        }
        if (
            !window.isSecureContext ||
            !globalThis.crypto?.subtle ||
            typeof globalThis.WebSocket !== 'function' ||
            typeof globalThis.RTCPeerConnection !== 'function'
        ) {
            setNetwork({
                state: 'error',
                phase: RUNTIME.phaseBrowser(),
                code: '',
                count: 0,
                message: RUNTIME.netBrowser(),
                hint: RUNTIME.netSameVersion(),
            });
            trackFailure('unsupported', 'browser', 'block');
            networkEvent(
                'preflight-failed',
                `secure=${window.isSecureContext} crypto=${!!globalThis.crypto?.subtle} rtc=${typeof globalThis.RTCPeerConnection}`,
            );
            return;
        }
        audio.unlock();
        stopSession({ preserveResume: resuming });
        const token = run;
        connection.abort = new AbortController();
        networkEvent('connect-start', `role=${action} version=${TAKRAW_VERSION}`);
        setNetwork({
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
        let capability;
        try {
            capability = await createNostrDynamicRoom({
                role: action,
                room: roomCode,
                namespace: TAKRAW_RUNTIME.network.namespace,
                resume: { adapter: resumeAdapter, key: `room:${roomCode}`, reset: !resuming },
                maxPlayers: 2,
                timeoutMs: TAKRAW_RUNTIME.network.timeout,
                peerTimeoutMs: TAKRAW_RUNTIME.network.peerTimeout,
                relays: TAKRAW_RUNTIME.network.relays,
                rtcConfig: { iceServers: TAKRAW_RUNTIME.network.iceServers },
                signal: connection.abort.signal,
                onStatus(event) {
                    if (token !== run) return;
                    const reason = event.reason || event.message || '';
                    if (event.type === 'signaler' && event.status === 'connected') {
                        networkEvent('relay-connected', event.relay || '');
                        setNetwork({ phase: RUNTIME.phaseRelay() });
                    } else if (event.type === 'signaler' && event.status === 'error') {
                        // 릴레이 하나의 실패는 다른 릴레이가 이어 가므로 기록만 한다. 모두 실패하면 아래 catch가 오류를 띄운다.
                        networkEvent('relay-error', `${event.relay || ''} ${reason}`.trim());
                    } else if (event.type === 'peer-failed' || event.type === 'signal-error') {
                        connection.warning.message = readableConnectionError(reason || event.type);
                        connection.warning.atMs = performance.now();
                        networkEvent(event.type, reason);
                        setNetwork({ hint: connection.warning.message });
                    } else if (event.type === 'resume-save-failed') {
                        resumeSaveFailed(event.error);
                    } else if (
                        ['peer-connected', 'room-ready', 'peer-disconnected'].includes(event.type)
                    ) {
                        networkEvent(event.type, reason);
                        if (event.type === 'peer-connected')
                            setNetwork({ phase: RUNTIME.phasePeer(), hint: '' });
                    }
                },
            });
            if (token !== run || disposed) {
                capability.close();
                return;
            }
            room = capability;
            if (!resuming) rememberRoom({ role: action, room: capability.room });
            setNetwork({ canResume: true });
            networkEvent('room-created', `room=${capability.room} role=${action}`);
            openSession('online', capability, token);
        } catch (error) {
            capability?.close();
            if (token !== run || disposed) return;
            networkEvent('connect-error', String(error?.message || error));
            recordError(error, 'network');
            const cause = connectionCause(connectionText(error), error?.code);
            trackConnectionFailure(cause, 'connect');
            const diagnostics = network.diagnostics;
            stopSession({ preserveResume: true });
            setNetwork({
                state: 'error',
                phase: failurePhase(cause),
                count: 0,
                code: '',
                diagnostics,
                message: readableConnectionError(error),
                hint: action === 'join' ? RUNTIME.netJoinHint() : RUNTIME.netHostHint(),
            });
        }
    }

    function restart() {
        if (!mode) return;
        metrics.track('match', mode, 'restart');
        if (mode === 'training') {
            releaseControls();
            pendingCommands.push(4);
            observeSoon();
            ui.canvas.focus({ preventScroll: true });
            return;
        }
        if (mode === 'online') {
            if (!session?.ready || session.players.length !== 2) return;
            if (localTeam() !== 0) return;
            pendingCommands.push(4);
            observeSoon();
        } else startLocal(mode);
    }

    function quit() {
        if (!isReady() || disposed) return;
        if (mode) metrics.track('match', mode, 'quit');
        observeMatchResult();
        stopSession();
        audio?.setBackground(TAKRAW_RUNTIME.bgm.levelRampMs);
        clubSession.team = null;
        clubSession.match = null;
        clubSession.reward = null;
        campaignSchoolId = null;
        game.setTeams(null, null);
        game.setTemperaments();
        game.reset('match');
        latestView = game.getView();
        resetPresentation();
        feed.publish(latestView, true);
        showBootStatus('', false);
        ui.showHome();
        publishClub();
        setNetwork({
            state: 'idle',
            code: '',
            message: '',
            count: 0,
            phase: RUNTIME.phaseIdle(),
            hint: '',
            canResume: false,
        });
    }

    function setPaused(value) {
        paused = Boolean(value);
        releaseControls();
        if (mode !== 'online') {
            loop?.resetTiming();
            if (paused) pump?.stop();
            else {
                pump?.start();
                pump?.wake();
            }
        }
        audio?.setBackground(TAKRAW_RUNTIME.bgm.levelRampMs);
    }

    const runtime = Object.freeze({
        get game() {
            return game;
        },
        get session() {
            return session;
        },
        get view() {
            return view;
        },
        get ready() {
            return isReady();
        },
        watch: startWatch,
        /** 소개영상 화면(?showcaseDemo=1)에서만: 대본이 장마다 게임 화면을 띄운다. draw는 intro.drawCard 선수의 뽑기 연출, none은 닫기. */
        showcase(scene, intro) {
            if (!demo || !ui) return false;
            if (scene === 'draw') return ui.showcaseDraw(club.preview(intro.drawCard));
            return scene === 'none' && ui.showcaseDraw(null);
        },
        diagnostics() {
            return {
                product: TAKRAW_PRODUCT_NAME.en,
                version: TAKRAW_VERSION,
                status: config.status,
                ready: isReady(),
                bootstrapStage,
                mode,
                paused,
                failed,
                environment: {
                    secureContext: window.isSecureContext,
                    webCrypto: Boolean(globalThis.crypto?.subtle),
                },
                dependencies: { ...dependencyState },
                tick: session?.tick ?? latestView?.state.tick ?? 0,
                phase: latestView?.state.phase || 'loading',
                selected: latestView?.state.selected?.slice() || takrawHumanPlayerIds(),
                physics: {
                    players: game?.physics.players.length || 0,
                    entities: latestView?.entities.length || 0,
                },
                input: Array.from(input?.lastInput ?? new Uint8Array(config.input.size)),
                network: {
                    ...network,
                    session: session?.status || null,
                    ready: Boolean(session?.ready),
                    players: session?.players.slice() || [],
                    roomConnections: room?.transports?.size || 0,
                    roomMetrics: room?.metrics || null,
                },
                session: session?.metrics || null,
                audio: audio?.snapshot() || null,
                club: club?.diagnostics() || null,
                rewards: {
                    pending: rewards.jobs.length,
                    saving: rewards.running,
                    failed: rewards.jobs.filter((job) => job.status === 'error').length,
                },
                simulation: {
                    ...stats,
                    averageMs: stats.steps ? stats.simulationMs / stats.steps : 0,
                },
                lastContact: events?.lastContact ?? null,
                highlight: highlight.diagnostics(),
                errors: diagnostics.errors(),
            };
        },
        dispose() {
            if (disposed) return;
            stopSession({ preserveResume: true });
            disposed = true;
            bootstrapStage = 'disposed';
            cancelAnimationFrame(animation);
            for (const remove of listeners.splice(0)) remove();
            if (rewards.timer !== null) window.clearTimeout(rewards.timer);
            rewards.timer = null;
            intro?.dispose();
            pwa?.dispose();
            club?.dispose();
            ui?.dispose();
            input?.dispose();
            audio?.dispose();
            stores.dispose();
            view?.dispose();
            highlight.dispose();
            game?.physics.dispose();
        },
    });
    window.__takraw = runtime;

    ui = new TakrawUI(
        {
            canStart,
            onStart(nextMode) {
                metrics.track('menu', nextMode, 'click');
                campaignSchoolId = null;
                if (nextMode === 'watch') {
                    startWatch(watchSeed);
                    return;
                }
                if (nextMode === 'online') {
                    setNetwork({ state: 'idle', count: 0, message: RUNTIME.netChoose() });
                } else startLocal(nextMode);
            },
            onRestart: restart,
            diagnosticText: diagnosticReport,
            onWatch: (seed) => {
                metrics.track('menu', 'watch_seed', 'click');
                campaignSchoolId = null;
                startWatch(seed);
            },
            onCampaign(schoolId) {
                metrics.track('menu', 'campaign', 'click', { schoolId });
                const { home, cleared } = club.getView().campaign,
                    index = home
                        ? takrawOpponents(home).findIndex((school) => school.id === schoolId)
                        : -1;
                if (index < 0 || index > cleared.length || !canStart('match')) return;
                campaignSchoolId = schoolId;
                startLocal('match');
            },
            onClubAction(action, payload) {
                if (action !== 'refresh') metrics.track('club', action, 'click');
                return clubAction(action, payload);
            },
            onRewardRetry: retryReward,
            onTrainingLesson(lesson) {
                const option = TAKRAW_TRAINING_LESSONS.find((item) => item.id === lesson);
                if (mode !== 'training' || !controlsAllowed() || !option) return;
                releaseControls();
                pendingCommands.push(option.command);
                observeSoon();
                ui.canvas.focus({ preventScroll: true });
            },
            onTrainingTempo(tempo) {
                const option = TAKRAW_TRAINING_TEMPOS.find((item) => item.id === tempo);
                if (mode !== 'training' || !controlsAllowed() || !option) return;
                releaseControls();
                pendingCommands.push(option.command);
                observeSoon();
                ui.canvas.focus({ preventScroll: true });
            },
            onCameraReset: resetCamera,
            onInstall: installPwa,
            onPause: setPaused,
            onReplaySkip: () => highlight.end(),
            onQuit: quit,
            onSetting(key, value) {
                if (key === 'sound') audio?.setMuted(!value);
                if (key === 'quality') view?.setQuality(value);
            },
            onNetwork: connect,
            onTouch(action, source, down) {
                if (!input || !['jump', 'kick'].includes(action)) return;
                if (down && !controlsAllowed()) return;
                input.setTouch(action, source, down);
                if (down) audio.unlock();
                observeSoon();
            },
            onAxis(x, z) {
                input?.setAxis(x, z, controlsAllowed());
                observeSoon();
            },
        },
        network,
    );
    const clubName = LOCALE.text({ ko: '블룸 클럽', en: 'Bloom Club' }); // 새 클럽의 이름. 처음 만든 언어로 저장되고, 이후 사용자가 바꾼다.
    club = new TakrawClub({ onChange: publishClub, openSave: openClubSave, defaultName: clubName });
    const clubLoad = club.load().catch((error) => {
        recordError(error, 'club-load');
        return null;
    });
    // 소리 설정: 읽지 못하면 기본값으로 바꾸지 않는다. 원본을 그대로 두고 소리를 끈 채 설정 창에 알린다.
    const soundLoad = soundSettings.load().then(
        () => true,
        (error) => {
            recordError(error, 'sound-settings-load');
            return false;
        },
    );
    const activeRoomLoad = activeRoom.load().then(
        (data) => data.room,
        (error) => {
            recordError(error, 'resume-load');
            networkEvent('resume-unavailable', error.message);
            return error;
        },
    );
    listen(window, 'pagehide', () => runtime.dispose());
    // BFCache에서는 이미 정리한 물리·저장 연결을 새 부팅으로 복원한다.
    window.addEventListener('pageshow', (event) => {
        if (event.persisted) window.location.reload();
    });
    showBootStatus(RUNTIME.bootCourt());

    try {
        await clubLoad;
        bootstrapStage = 'physics';
        showBootStatus(RUNTIME.bootPlayers());
        if (!RAPIER || typeof RAPIER.init !== 'function') throw new Error('Rapier entry contract');
        await RAPIER.init();
        game = new TakrawGame({ RAPIER, config, deterministic });
        bootstrapStage = 'graphics';
        view = new TakrawView({ THREE, canvas: ui.canvas, config });
        bootstrapStage = 'controls';
        codec = deterministic.createValueCodec();
        const soundReady = await soundLoad;
        audio = new RuntimeAudio({
            settings: soundReady ? soundSettings : null,
            onSaveError: soundSaveFailed,
            level: () => takrawBgmLevel({ mode, paused }),
            recordError,
        });
        if (soundReady) ui.setSound({ on: !audio.muted, locked: false, message: '' });
        else ui.setSound({ on: false, locked: true, message: RUNTIME.soundLocked() });
        feed = new PresentationFeed({ stepMs });
        events = new MatchEventJournal({
            config,
            view,
            ui,
            audio,
            perspective: () => ({ mode, team: localTeam() }),
        });
        view.setQuality(ui.settings.quality);
        input = new RuntimeInput({
            canvas: ui.canvas,
            config,
            onPointer(event) {
                if (event.type === 'down') audio.unlock();
                if (event.type === 'down' && highlight.active) {
                    highlight.end();
                    return;
                }
                input.orbit(event, controlsAllowed(), view);
                observeSoon();
            },
        });
        listen(document, 'keydown', (event) => {
            if (event.code !== 'KeyC' || event.repeat || !controlsAllowed()) return;
            if (event.target?.closest?.('input,textarea,select,button,[contenteditable="true"]'))
                return;
            event.preventDefault();
            resetCamera();
        });
        listen(document, 'pointerdown', () => audio.unlock(), { capture: true });
        listen(document, 'keydown', () => audio.unlock(), { capture: true });
        listen(document, 'keydown', observeSoon);
        listen(document, 'keyup', observeSoon);
        listen(window, 'blur', releaseControls);
        listen(document, 'visibilitychange', () => {
            if (document.hidden) releaseControls();
            else {
                loop?.resetTiming();
                pump?.rebase();
                pump?.wake();
            }
        });
        listen(window, 'resize', () => view.resize());
        game.reset('match');
        latestView = game.getView();
        resetPresentation();
        feed.publish(latestView, true);
        bootstrapStage = 'ready';
        showBootStatus('', false);
        ui.showHome();
        animation = requestAnimationFrame(frame);
        if (!isolated && !embedded) startPwa();
        const query = new URLSearchParams(location.search),
            watchParam = query.get(TAKRAW_RUNTIME.watch.param);
        if (watchParam !== null && /^\d+$/.test(watchParam)) startWatch(watchParam);
        if (TAKRAW_LAUNCH.debug) {
            // 확인용 주소(`?debug=1&scene=…`)일 때만 불러온다. 실시간 구동을 멈추고 가상 시계로 틱을 직접 진행한다.
            const [{ installDebugHost }, { createDebugScenes }] = await Promise.all([
                import('@bloom-gamekit/debug-tools'),
                import('./debug-scenes.js'),
            ]);
            installDebugHost({
                scenes: createDebugScenes({
                    config,
                    openWatch(seed) {
                        if (!startWatch(seed)) return false;
                        cancelAnimationFrame(animation);
                        pump.stop();
                        return true;
                    },
                    pulse: (now) => loop.pulse(now, { render: false, input: false }),
                    render: (now) => renderScene(now),
                    renderFrom: (camera) => view.renderFrom(camera),
                    ballPosition: () => view.ballPosition(),
                    read: () => ({
                        mode,
                        seed: watchSeed,
                        tick: game.state.tick,
                        score: [...game.state.score],
                    }),
                    stateHash: () => deterministic.hashBytes(codec.encode(game.save())),
                    async openClub(seed, stored = null) {
                        // 시드에서 나온 난수로 새 클럽을 메모리 저장에 만든다(내 학교·뽑기 결과가 시드로 정해진다).
                        // stored가 있으면 메모리 저장에 그 레코드가 이미 있는 것으로 시작한다(읽지 못하는 저장의 화면 확인용).
                        club.dispose();
                        club = new TakrawClub({
                            onChange: publishClub,
                            openSave: stored
                                ? (options) =>
                                      createSave({
                                          ...options,
                                          adapter: memoryAdapter({ [options.key]: stored }),
                                      })
                                : openClubSave,
                            defaultName: clubName,
                            random: takrawUnitStream(new deterministic.SeededPRNG(seed)),
                        });
                        await club.load().catch((error) => {
                            if (!stored) throw error;
                            recordError(error, 'club-load');
                        });
                        return club;
                    },
                    showClub() {
                        cancelAnimationFrame(animation);
                        ui.navigate('club');
                    },
                    openMatch(seed, every) {
                        debugMatchSeed = seed;
                        // every: 모든 득점을 리플레이한다(화면 확인용). 판정 기준만 낮추고 재생 방식은 그대로다.
                        if (every) highlight.replayEveryScore();
                        startLocal('match');
                        return mode === 'match';
                    },
                    readReplay: () => highlight.replayState(),
                }),
            });
        }
        if (!demo) {
            // 소개영상이 열려 있는 동안 뒤의 경기는 멈춘다(호스트 요구). 닫으면 이전 상태로 돌아간다.
            let resume = false;
            intro = new TakrawIntro({
                playSelector: '#start-match',
                launcher: '.home-description',
            });
            listen(window, 'bloom-showcase-opened', () => {
                resume = Boolean(mode) && !paused;
                if (resume) setPaused(true);
            });
            listen(window, 'bloom-showcase-closed', () => {
                if (resume) setPaused(false);
                resume = false;
            });
        }
        // 이전 경기가 있으면 연결 창을 열어 다시 연결한다. 복귀 정보를 읽지 못했으면 같은 창에 알린다.
        const saved = await activeRoomLoad;
        if (saved) ui.openDialog('network');
        if (saved instanceof Error)
            setNetwork({
                state: 'error',
                canResume: false,
                phase: RUNTIME.phaseResume(),
                message: RUNTIME.netResumeUnreadable(),
            });
        else if (saved) void connect(saved.role, saved.room, true);
        return runtime;
    } catch (error) {
        recordError(error, 'bootstrap');
        pump?.stop();
        const message =
            bootstrapStage === 'graphics' && /webgl/i.test(String(error?.message || error))
                ? RUNTIME.bootWebgl()
                : RUNTIME.bootFailed();
        bootstrapStage = 'failed';
        ui.showFatal(message);
        throw error;
    }
}

export { bootTakraw };
