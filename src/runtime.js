import { takrawOpponents } from './config/schools.js';
import * as THREE from 'three';
import RAPIER from 'rapier';
import * as deterministic from '@bloom-gamekit/deterministic';
import { createSave, memoryAdapter } from '@bloom-gamekit/save';
import { registerPwa } from '@bloom-gamekit/pwa';
import { createMetrics, HttpAdapter, MemoryAdapter } from '@bloom-gamekit/metrics';

import { TAKRAW_VERSION, TAKRAW_PRODUCT_NAME, TAKRAW_ID, TAKRAW_CONFIG } from './config/game.js';
import { createRuntimeDiagnostics } from './runtime/diagnostics.js';
import { createRuntimeStores } from './runtime/stores.js';
import { RuntimeAudio, takrawBgmLevel } from './runtime/audio.js';
import { RuntimeInput } from './runtime/input.js';
import { MatchRewards } from './runtime/rewards.js';
import { MatchRecord } from './runtime/match-record.js';
import { NetworkLink } from './runtime/network.js';
import { MatchSession } from './runtime/match-session.js';
import { RenderLoop } from './runtime/render-loop.js';
import { BootStatus } from './runtime/boot-status.js';
import { TAKRAW_MODE_POLICY, TAKRAW_RUNTIME } from './config/runtime.js';
import { TakrawClub } from './club/club.js';
import { TakrawGame } from './simulation/game.js';
import { TAKRAW_TRAINING_LESSONS, TAKRAW_TRAINING_TEMPOS } from './simulation/training.js';
import { takrawHumanPlayerIds } from './simulation/roster.js';
import { TakrawView } from './presentation/view.js';
import { takrawUnitStream } from './simulation/random.js';
import { TakrawUI } from './presentation/ui.js';
import { TakrawIntro } from './presentation/intro.js';
import { TAKRAW_LAUNCH } from './launch.js';
import { LOCALE } from './i18n/locale.js';
import { RUNTIME } from './i18n/messages/runtime.js';

/**
 * 런타임 조립 지점. 모듈을 만들고 서로의 콜백·조회 함수를 잇고, 화면(UI) 콜백·window.__takraw·확인용 장면·PWA를 연결한다.
 * 이 함수가 직접 소유하는 상태는 disposed, club 참조(확인용 장면이 바꿔 끼운다), 부팅 중 만든 자원(game·view·codec·audio·input·intro·pwa)뿐이다.
 * 경기 상태는 MatchSession, 연결은 NetworkLink, 그리기 주기는 RenderLoop, 부팅 단계는 BootStatus가 소유한다(docs/architecture.md).
 */
/**
 * 화면(TakrawUI)이 부르는 콜백 묶음. 화면은 부팅 초기에 만들어지고 오디오·뷰·입력은 그 뒤에 생기므로 조회 함수(get*)로 읽는다.
 * 클럽은 확인용 장면이 바꿔 끼울 수 있어 역시 조회 함수로 읽는다.
 */
function takrawUiCallbacks({
    match,
    net,
    metrics,
    rewards,
    clubAction,
    resetCamera,
    installPwa,
    diagnosticReport,
    getClub,
    getAudio,
    getView,
    getInput,
}) {
    // 화면 이동 지표: 주소가 확정될 때마다 오지만 같은 화면에 다시 들어온 것(교정·재렌더)은 보내지 않는다.
    let lastScreen = null;
    return {
        onScreen(screen) {
            if (screen === lastScreen || screen === 'showcase') return;
            lastScreen = screen;
            metrics.track('screen', screen, 'enter');
        },
        canStart: (nextMode) => match.canStart(nextMode),
        onStart(nextMode) {
            metrics.track('menu', nextMode, 'click');
            match.clearCampaign();
            const policy = TAKRAW_MODE_POLICY[nextMode];
            if (policy.watchSeed) {
                match.startWatch(match.watchSeed);
                return;
            }
            if (policy.room) {
                net.set({ state: 'idle', count: 0, message: RUNTIME.netChoose() });
            } else match.startLocal(nextMode);
        },
        onRestart: () => match.restart(),
        diagnosticText: diagnosticReport,
        onWatch: (seed) => {
            metrics.track('menu', 'watch_seed', 'click');
            match.clearCampaign();
            match.startWatch(seed);
        },
        onCampaign(schoolId) {
            metrics.track('menu', 'campaign', 'click', { schoolId });
            const { home, cleared } = getClub().getView().campaign,
                index = home
                    ? takrawOpponents(home).findIndex((school) => school.id === schoolId)
                    : -1;
            if (index < 0 || index > cleared.length || !match.canStart('match')) return;
            match.startCampaign(schoolId);
        },
        onClubAction(action, payload) {
            if (action !== 'refresh') metrics.track('club', action, 'click');
            return clubAction(action, payload);
        },
        onRewardRetry: () => rewards.retry(),
        onTrainingLesson(lesson) {
            const option = TAKRAW_TRAINING_LESSONS.find((item) => item.id === lesson);
            if (option) match.trainingCommand(option.command);
        },
        onTrainingTempo(tempo) {
            const option = TAKRAW_TRAINING_TEMPOS.find((item) => item.id === tempo);
            if (option) match.trainingCommand(option.command);
        },
        onCameraReset: resetCamera,
        onInstall: installPwa,
        onPause: (value) => match.setPaused(value),
        onReplaySkip: () => match.skipReplay(),
        onQuit: () => match.quit(),
        onSetting(key, value) {
            if (key === 'sound') getAudio()?.setMuted(!value);
            if (key === 'quality') getView()?.setQuality(value);
        },
        onNetwork: (action, code, resuming) => match.connect(action, code, resuming),
        onTouch(action, source, down) {
            const input = getInput();
            if (!input || !['jump', 'kick'].includes(action)) return;
            if (down && !match.controlsAllowed()) return;
            input.setTouch(action, source, down);
            if (down) getAudio().unlock();
            match.observeSoon();
        },
        onAxis(x, z) {
            getInput()?.setAxis(x, z, match.controlsAllowed());
            match.observeSoon();
        },
        onAim(x, y) {
            getInput()?.setAim(x, y, match.controlsAllowed());
        },
    };
}

/** 확인용 주소(`?debug=1&scene=…`)일 때만 불러와 장면을 연결한다. 실시간 구동을 멈추고 가상 시계로 틱을 직접 진행한다. */
async function installTakrawDebugScenes({
    config,
    match,
    renderLoop,
    ui,
    game,
    view,
    codec,
    getClub,
    setClub,
    publishClub,
    openClubSave,
    clubName,
    recordError,
}) {
    const [{ installDebugHost }, { createDebugScenes }] = await Promise.all([
        import('@bloom-gamekit/debug-tools'),
        import('./debug-scenes.js'),
    ]);
    installDebugHost({
        scenes: createDebugScenes({
            config,
            openWatch(seed) {
                // 관전의 첫 1점 반복(다시 열기)을 끈다. 다시 열면 요청한 tick이 아니라 tick 0을 보고하게 된다.
                if (!match.startWatch(seed, { repeat: false })) return false;
                renderLoop.stop();
                match.freezeRealtime();
                return true;
            },
            pulse: (now) => match.pulse(now),
            render: (now) => match.render(now),
            renderFrom: (camera) => view.renderFrom(camera),
            ballPosition: () => view.ballPosition(),
            read: () => ({
                mode: match.mode,
                // 지금 경기의 시드. 관전은 관전 시드와 같고, 확인용 AI 대전(scene=match)은 고정한 시드다.
                seed: game.state.seed,
                tick: game.state.tick,
                score: [...game.state.score],
            }),
            stateHash: () => deterministic.hashBytes(codec.encode(game.save())),
            async openClub(seed, stored = null) {
                // 시드에서 나온 난수로 새 클럽을 메모리 저장에 만든다(내 학교·뽑기 결과가 시드로 정해진다).
                // stored가 있으면 메모리 저장에 그 레코드가 이미 있는 것으로 시작한다(읽지 못하는 저장의 화면 확인용).
                getClub().dispose();
                const club = new TakrawClub({
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
                setClub(club);
                await club.load().catch((error) => {
                    if (!stored) throw error;
                    recordError(error, 'club-load');
                });
                return club;
            },
            showClub() {
                renderLoop.stop();
                ui.navigate('club');
            },
            openMatch: (seed, every) => match.openDebugMatch(seed, every),
            ballScreen: () => view.ballScreen(),
            readReplay: () => match.replayState(),
        }),
    });
}

async function bootTakraw() {
    const config = TAKRAW_CONFIG;
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

    let ui;
    let club;
    let game;
    let view;
    let input = null;
    let audio;
    let codec;
    let intro = null;
    let disposed = false;
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
    const rewards = new MatchRewards({
        getClub: () => club,
        recordError,
        onChange() {
            publishClub();
            match.invalidateHud();
        },
    });
    const record = new MatchRecord({ metrics, recordError });
    const boot = new BootStatus({ render: (status) => ui.setBootStatus(status) });

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
        boot.notice({
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

    /**
     * 온라인 연결(표시 snapshot·연결 수명주기·방). 세션이 멈출 때 reset()·closeRoom()으로 함께 정리한다.
     * ui는 아직 없을 수 있어(부팅 순서) 통지는 ui?로 받는다.
     */
    const net = new NetworkLink({
        activeRoom,
        resumeAdapter,
        recordError,
        trackFailure,
        isDisposed: () => disposed,
        onChange: (snapshot) => ui?.setNetwork(snapshot),
        onRosterChange() {
            match.resyncAfterRoster();
        },
        onFirstConnected() {
            ui.showGame('online');
            ui.canvas.focus({ preventScroll: true });
        },
        onHandshakeTimeout: () => match.stop(),
    });

    const match = new MatchSession({
        config,
        metrics,
        net,
        rewards,
        record,
        recordError,
        trackFailure,
        getClub: () => club,
        isReady: () => boot.ready,
        isDisposed: () => disposed,
        publishClub,
        clearStatus: () => boot.show('', false),
    });

    const renderLoop = new RenderLoop({
        hz: TAKRAW_RUNTIME.clock.renderHz,
        blocked: () => match.failed,
        onFrame: (now) => match.frame(now),
    });

    /**
     * 놀이를 멈춘 실패를 성격별 분류로 지표에 보낸다(README "게임 지표"). 오류 메시지·스택은 보내지 않는다.
     *   fault/<simulation·desync·sync>/fail: 게임 결함 의심
     *   network/<relay·peer·secure·other·timeout>/fail: 연결 사정
     *   unsupported/<browser·version>/block: 이 환경이나 버전 조합으로는 온라인을 할 수 없음
     */
    function trackFailure(category, target, action, props = {}) {
        metrics.track(category, target, action, { mode: match.mode || 'menu', ...props });
    }

    /** 부팅 지표. loadMs는 페이지 시작부터 준비까지, 나머지는 단계별 걸린 ms(pre는 이 함수가 시작되기 전 모듈 로딩, 100ms 단위로 내린다). */
    function trackBoot(ready) {
        const m = bootMarks,
            round = (ms) => Math.round(ms / 100) * 100;
        metrics.track('boot', 'ready', 'done', {
            loadMs: round(ready),
            pre: round(m.start),
            club: round(m.club - m.start),
            phys: round(m.physics - m.club),
            gfx: round(m.graphics - m.physics),
            ctl: round(ready - m.graphics),
        });
    }

    function listen(target, type, callback, options) {
        target.addEventListener(type, callback, options);
        listeners.push(() => target.removeEventListener(type, callback, options));
    }

    function diagnosticReport() {
        const latestView = match.latestView;
        return diagnostics.report({
            stateLines: [
                `mode=${match.mode ?? 'menu'} phase=${latestView?.state.phase ?? 'loading'} tick=${match.session?.tick ?? latestView?.state.tick ?? 0}`,
                view?.renderStats.line() ?? 'render: not ready',
            ],
            hitches: view?.renderStats.metrics.hitchText() ?? '',
            traces: view?.renderStats.metrics.traceText() ?? '',
            networkHistory: net.history(),
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

    function publishClub() {
        if (disposed || !club || !ui) return;
        ui.setClub({ ...club.getView(), pendingReward: rewards.pending() });
    }

    async function clubAction(action, payload = {}) {
        if (!club || disposed) return null;
        if (action === 'refresh') return club.refresh();
        if (match.mode || ui.inGame) throw new Error('팀 변경은 처음 화면에서 할 수 있어요.');
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

    function resetCamera() {
        view?.resetCamera();
        match.observeSoon();
    }

    const runtime = Object.freeze({
        get game() {
            return game;
        },
        get session() {
            return match.session;
        },
        get view() {
            return view;
        },
        get ready() {
            return boot.ready;
        },
        watch: (seed) => match.startWatch(seed),
        /** 소개영상 화면(?showcaseDemo=1)에서만: 대본이 장마다 게임 화면을 띄운다. draw는 intro.drawCard 선수의 뽑기 연출, none은 닫기. */
        showcase(scene, intro) {
            if (!demo || !ui) return false;
            if (scene === 'draw') return ui.showcaseDraw(club.preview(intro.drawCard));
            return scene === 'none' && ui.showcaseDraw(null);
        },
        diagnostics() {
            const session = match.session,
                latestView = match.latestView;
            return {
                product: TAKRAW_PRODUCT_NAME.en,
                version: TAKRAW_VERSION,
                status: config.status,
                ready: boot.ready,
                bootstrapStage: boot.stage,
                mode: match.mode,
                paused: match.paused,
                failed: match.failed,
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
                input: Array.from(match.lastInput ?? new Uint8Array(config.input.size)),
                network: net.diagnostics(session),
                session: session?.metrics || null,
                audio: audio?.snapshot() || null,
                club: club?.diagnostics() || null,
                rewards: rewards.diagnostics(),
                simulation: match.simulationDiagnostics(),
                lastContact: match.lastContact,
                render: view?.renderStats.snapshot() ?? null,
                hitches: view?.renderStats.metrics.hitches() ?? [],
                traces: view?.renderStats.metrics.traces() ?? [],
                highlight: match.highlightDiagnostics(),
                errors: diagnostics.errors(),
            };
        },
        /** 정리 순서: 세션·연결 → 그리기 주기 → 리스너 → 보상 → 소개 → PWA → 클럽 → 화면 → 입력 → 오디오 → 저장소 → 뷰 → 리플레이 → 물리. */
        dispose() {
            if (disposed) return;
            match.stop({ preserveResume: true });
            net.dispose();
            disposed = true;
            boot.dispose();
            renderLoop.dispose();
            for (const remove of listeners.splice(0)) remove();
            rewards.dispose();
            intro?.dispose();
            pwa?.dispose();
            club?.dispose();
            ui?.dispose();
            input?.dispose();
            audio?.dispose();
            stores.dispose();
            view?.dispose();
            match.dispose();
            game?.physics.dispose();
        },
    });
    window.__takraw = runtime;

    ui = new TakrawUI(
        takrawUiCallbacks({
            match,
            net,
            metrics,
            rewards,
            clubAction,
            resetCamera,
            installPwa,
            diagnosticReport,
            getClub: () => club,
            getAudio: () => audio,
            getView: () => view,
            getInput: () => input,
        }),
        net.snapshot,
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
    const activeRoomLoad = net.loadResume();
    listen(window, 'pagehide', () => runtime.dispose());
    // BFCache에서는 이미 정리한 물리·저장 연결을 새 부팅으로 복원한다.
    window.addEventListener('pageshow', (event) => {
        if (event.persisted) window.location.reload();
    });
    boot.show(RUNTIME.bootCourt());
    // 부팅 지표(boot:ready:done): 단계가 끝난 시각(페이지 시작 기준)을 모아 준비되면 한 번 보낸다.
    const bootMarks = { start: performance.now() };
    const bootMark = (stage) => (bootMarks[stage] = performance.now());

    try {
        await clubLoad;
        bootMark('club');
        boot.advance('physics');
        boot.show(RUNTIME.bootPlayers());
        if (!RAPIER || typeof RAPIER.init !== 'function') throw new Error('Rapier entry contract');
        await RAPIER.init();
        game = new TakrawGame({ RAPIER, config, deterministic });
        bootMark('physics');
        boot.advance('graphics');
        view = new TakrawView({ THREE, canvas: ui.canvas, config });
        bootMark('graphics');
        boot.advance('controls');
        codec = deterministic.createValueCodec();
        const soundReady = await soundLoad;
        audio = new RuntimeAudio({
            settings: soundReady ? soundSettings : null,
            onSaveError: soundSaveFailed,
            level: () => takrawBgmLevel({ mode: match.mode, paused: match.paused }),
            recordError,
        });
        if (soundReady) ui.setSound({ on: !audio.muted, locked: false, message: '' });
        else ui.setSound({ on: false, locked: true, message: RUNTIME.soundLocked() });
        view.setQuality(ui.settings.quality);
        input = new RuntimeInput({
            canvas: ui.canvas,
            config,
            onPointer(event) {
                if (event.type === 'down') audio.unlock();
                if (event.type === 'down' && match.replayActive) {
                    match.skipReplay();
                    return;
                }
                input.orbit(event, match.controlsAllowed(), view);
                match.observeSoon();
            },
        });
        match.attach({ ui, game, view, codec, audio, input });
        listen(document, 'keydown', (event) => {
            if (event.code !== 'KeyC' || event.repeat || !match.controlsAllowed()) return;
            if (event.target?.closest?.('input,textarea,select,button,[contenteditable="true"]'))
                return;
            event.preventDefault();
            resetCamera();
        });
        listen(document, 'pointerdown', () => audio.unlock(), { capture: true });
        listen(document, 'keydown', () => audio.unlock(), { capture: true });
        listen(document, 'keydown', () => match.observeSoon());
        listen(document, 'keyup', () => match.observeSoon());
        listen(window, 'blur', () => match.releaseControls());
        listen(document, 'visibilitychange', () => {
            if (document.hidden) match.releaseControls();
            else {
                // 숨겨진 동안의 간격은 튄 프레임이 아니다.
                view.renderStats.metrics.skipInterval();
                match.resyncClock();
            }
        });
        listen(window, 'resize', () => view.resize());
        match.showIdleCourt();
        // 로딩 단계에서 처음 화면을 한 번 그려 선수·공을 만들고, 경기 중 처음 쓰일 셰이더·복사 텍스처를 미리 만든다(DEV-032).
        match.render();
        view.warmUp();
        boot.advance('ready');
        boot.show('', false);
        ui.showHome();
        trackBoot(bootMark('ready'));
        renderLoop.start();
        if (!isolated && !embedded) startPwa();
        const query = new URLSearchParams(location.search),
            watchParam = query.get(TAKRAW_RUNTIME.watch.param);
        if (watchParam !== null && /^\d+$/.test(watchParam)) match.startWatch(watchParam);
        if (TAKRAW_LAUNCH.debug)
            await installTakrawDebugScenes({
                config,
                match,
                renderLoop,
                ui,
                game,
                view,
                codec,
                getClub: () => club,
                setClub: (next) => {
                    club = next;
                },
                publishClub,
                openClubSave,
                clubName,
                recordError,
            });
        if (!demo) {
            // 소개영상이 열려 있는 동안 뒤의 경기는 멈춘다(호스트 요구). 닫으면 이전 상태로 돌아간다.
            let resume = false;
            intro = new TakrawIntro({
                playSelector: '#start-match',
                launcher: '.home-description',
            });
            listen(window, 'bloom-showcase-opened', () => {
                resume = Boolean(match.mode) && !match.paused;
                if (resume) match.setPaused(true);
            });
            listen(window, 'bloom-showcase-closed', () => {
                if (resume) match.setPaused(false);
                resume = false;
            });
        }
        // 이전 경기가 있으면 연결 창을 열어 다시 연결한다. 복귀 정보를 읽지 못했으면 같은 창에 알린다.
        const saved = await activeRoomLoad;
        if (saved) ui.openDialog('network');
        if (saved instanceof Error)
            net.set({
                state: 'error',
                canResume: false,
                phase: RUNTIME.phaseResume(),
                message: RUNTIME.netResumeUnreadable(),
            });
        else if (saved) void match.connect(saved.role, saved.room, true);
        return runtime;
    } catch (error) {
        recordError(error, 'bootstrap');
        match.stopPump();
        const message =
            boot.stage === 'graphics' && /webgl/i.test(String(error?.message || error))
                ? RUNTIME.bootWebgl()
                : RUNTIME.bootFailed();
        boot.advance('failed');
        ui.showFatal(message);
        throw error;
    }
}

export { bootTakraw };
