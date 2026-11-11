import { createLoop, createDeadlineScheduler } from '@bloom-gamekit/simloop';
import { createRoomSession } from '@bloom-gamekit/rollback';
import { TAKRAW_VERSION } from '../config/game.js';
import { TAKRAW_MODE_POLICY, TAKRAW_RUNTIME } from '../config/runtime.js';
import { TAKRAW_MODES } from '../simulation/modes.js';
import { takrawEncodeIdentity, takrawIdentitySchools } from '../simulation/identity.js';
import { RUNTIME } from '../i18n/messages/runtime.js';
import { PresentationFeed } from './presentation-feed.js';
import { MatchEventJournal } from './match-events.js';
import { HighlightController } from './highlight-controller.js';
import { takrawHudModel, HudClock } from './hud-model.js';
import { takrawMatchSetup, takrawSessionProfile } from './match-setup.js';

/**
 * 경기 세션 하나의 수명주기: 모드·일시정지·실패·세션 세대(run)·rollback 세션·시뮬 루프·deadline pump·최신 뷰·대기 명령,
 * 관전 시드·반복 지점, 도장깨기 상대, 확인용 시드, 입력 관찰 예약, 시뮬 시간 통계(stats), HUD 시계를 소유한다(DEV-001).
 * 표시 통로(PresentationFeed)·경기 이벤트(MatchEventJournal)·득점 리플레이(HighlightController)도 세션이 만들고 쓴다.
 *
 * 부팅 순서 때문에 두 단계로 준비한다. 생성자는 화면·물리가 없어도 되는 의존만 받고(UI 콜백이 세션 메서드를 바로 가리킬 수 있게),
 * attach()가 부팅 끝에 화면(ui)·게임·뷰·코덱·오디오·입력을 받아 표시 통로와 이벤트 저널을 만든다. 준비 전 경기는 열리지 않는다(canStart).
 *
 * run은 stop()마다 올라가 이전 세션의 비동기 콜백(세션 이벤트·pump·관전 재시작·방 만들기)을 무효로 만든다.
 * 위 계층 상태는 조회 함수로만 읽는다: getClub()·isReady()·isDisposed(). 위로 보내는 명령은 publishClub()·clearStatus()다.
 */
class MatchSession {
    constructor({
        config,
        metrics,
        net,
        rewards,
        record,
        recordError,
        trackFailure,
        getClub,
        isReady,
        isDisposed,
        publishClub,
        clearStatus,
    }) {
        this.config = config;
        this.metrics = metrics;
        this.net = net;
        this.rewards = rewards;
        this.record = record;
        this.recordError = recordError;
        this.trackFailure = trackFailure;
        this.getClub = getClub;
        this.isReady = isReady;
        this.isDisposed = isDisposed;
        this.publishClub = publishClub;
        this.clearStatus = clearStatus;

        this.ui = null;
        this.game = null;
        this.view = null;
        this.codec = null;
        this.audio = null;
        this.input = null;
        this.feed = null;
        this.events = null;

        this.mode = null;
        this.paused = false;
        this.failed = false;
        this.run = 0;
        this.session = null;
        this.loop = null;
        this.pump = null;
        this.latestView = null;
        this.pendingCommands = [];
        this.identitySent = false; // 온라인에서 내 팀 이름·학교를 이 세션에서 이미 알렸는지
        this.watch = {
            seed: TAKRAW_RUNTIME.watch.showcaseSeed,
            repeat: true, // 첫 1점 뒤 같은 시드를 처음부터 다시 연다. 확인용 장면은 끄고 요청한 tick까지 이어서 진행한다.
            point: { tick: null, restarting: false },
        };
        this.campaignSchoolId = null;
        this.debugMatchSeed = null; // 확인용 장면(scene=match)이 고정한 AI 대전 시드
        this.observationPending = false;
        this.releasing = false;
        this.stats = { frames: 0, steps: 0, simulationMs: 0, maxSimulationMs: 0, backlogDrops: 0 };
        this.hud = new HudClock();
        this.highlight = new HighlightController({
            tickRate: config.simulation.tickRate,
            showReplay: (reason) => this.ui.showReplay(reason),
            snapCamera: () => this.view.snapCamera(),
            onPlaybackChange: (active) => {
                this.releaseControls();
                this.loop?.resetTiming();
                if (active) this.pump?.stop();
                else if (!this.paused) {
                    this.pump?.start();
                    this.pump?.wake();
                }
            },
        });
    }

    /** 부팅 끝: 화면·게임·뷰·코덱·오디오·입력을 받고 표시 통로와 경기 이벤트 저널을 만든다. */
    attach({ ui, game, view, codec, audio, input }) {
        this.ui = ui;
        this.game = game;
        this.view = view;
        this.codec = codec;
        this.audio = audio;
        this.input = input;
        this.feed = new PresentationFeed({ stepMs: 1000 / this.config.simulation.tickRate });
        this.events = new MatchEventJournal({
            config: this.config,
            view,
            ui,
            audio,
            perspective: () => ({ mode: this.mode, team: this.localTeam() }),
        });
    }

    /** 처음 화면 뒤에 보이는 빈 코트. 부팅 끝에 한 번. */
    showIdleCourt() {
        this.game.reset('match');
        this.refreshView();
        this.resetPresentation();
        this.feed.publish(this.latestView, true);
    }

    get watchSeed() {
        return this.watch.seed;
    }

    get lastInput() {
        return this.input?.lastInput;
    }

    get lastContact() {
        return this.events?.lastContact ?? null;
    }

    /** 최신 뷰 캐시를 다시 읽는다. 갱신 시점: load·applyMembership·step·reconciled·membership-committed·recovered·경기 시작·처음 화면. */
    refreshView() {
        this.latestView = this.game.getView();
    }

    canStart(nextMode) {
        if (!this.isReady() || this.isDisposed() || this.failed) return false;
        const policy = TAKRAW_MODE_POLICY[nextMode];
        if (!policy) return false;
        return policy.clubTeam ? this.getClub()?.status === 'ready' : true;
    }

    localTeam() {
        const session = this.session;
        if (!session || !TAKRAW_MODE_POLICY[this.mode]?.room) return 0;
        return this.game.teamById?.[session.localPlayerId] ?? 0;
    }

    controlsAllowed() {
        const session = this.session;
        return Boolean(
            this.isReady() &&
            session?.ready &&
            !this.paused &&
            !this.highlight.active &&
            !session.failure &&
            (!TAKRAW_MODES[this.mode]?.waitsForPeers || session.players.length === 2),
        );
    }

    clearDeviceState() {
        this.input?.clear();
    }

    releaseControls() {
        if (this.releasing) return;
        this.releasing = true;
        try {
            this.clearDeviceState();
            this.loop?.releaseInput();
        } finally {
            this.releasing = false;
        }
    }

    observeSoon() {
        if (!this.loop || this.observationPending || this.isDisposed()) return;
        this.observationPending = true;
        queueMicrotask(() => {
            this.observationPending = false;
            if (!this.loop || this.isDisposed()) return;
            try {
                this.loop.observeInput(performance.now());
                this.pump?.wake();
            } catch (error) {
                this.simulationFailed(error);
            }
        });
    }

    /** 탭이 다시 보일 때 시뮬 시계를 지금에 맞춘다. */
    resyncClock() {
        this.loop?.resetTiming();
        this.pump?.rebase();
        this.pump?.wake();
    }

    /** 온라인 인원이 바뀌었다: 시뮬 시계를 다시 잡고 눌린 조작을 놓는다. */
    resyncAfterRoster() {
        this.loop?.resetTiming();
        this.pump?.rebase();
        this.releaseControls();
    }

    getInput() {
        const commands = this.pendingCommands
            .splice(0)
            .map((code) => ({ payload: Uint8Array.of(code) }));
        const session = this.session;
        if (
            TAKRAW_MODE_POLICY[this.mode]?.announcesTeam &&
            !this.identitySent &&
            session?.ready &&
            session.players.length === 2
        ) {
            // 두 사람이 모이면 내 팀 이름·학교를 한 번 알린다(표시 전용)
            this.identitySent = true;
            this.metrics.track('match', this.mode, 'start');
            const mine = this.getClub().getView();
            commands.push({
                payload: takrawEncodeIdentity(
                    mine.campaign.home,
                    mine.teamName || RUNTIME.myTeam(),
                ),
            });
        }
        // 명령 순서: [대기 명령..., 팀 알림?, 점프(1), 발차기(2), 2P 점프(11), 2P 발차기(12)]. 바꾸면 네트워크·경기 기록 바이트가 바뀐다.
        const { input: bytes, edges } = this.input.sample({
            allowed: this.controlsAllowed(),
            local2p: Boolean(TAKRAW_MODES[this.mode]?.secondaryInput),
            // Both local players share the same screen; online peers each see their
            // own team from behind. Only world-space input crosses the network.
            movement: (right, back) => this.view.screenMovement(right, back, this.localTeam()),
        });
        if (edges.jump) commands.push({ payload: Uint8Array.of(1) });
        if (edges.kick) commands.push({ payload: Uint8Array.of(2) });
        if (edges.p2Jump) commands.push({ payload: Uint8Array.of(11) });
        if (edges.p2Kick) commands.push({ payload: Uint8Array.of(12) });
        return { input: bytes, commands };
    }

    /** 보간 표시를 처음부터 다시 시작한다(경기 시작·처음 화면 복귀). 득점 연출·응원과 마지막 접촉도 함께 지운다. */
    resetPresentation() {
        this.feed.reset();
        this.view.scoreMotion.reset();
        this.view.resetCheer();
        this.events.forgetContact();
    }

    maintainNetwork(now = performance.now(), force = false) {
        if (!TAKRAW_MODE_POLICY[this.mode]?.room || !this.session) return;
        this.net.maintain(this.session, now, force);
    }

    observeMatchResult() {
        this.rewards.observe({ mode: this.mode, state: this.latestView?.state });
    }

    observeMetricsMatch() {
        if (this.isDisposed()) return;
        this.record.observe({
            session: this.session,
            state: this.latestView?.state,
            mode: this.mode,
            schoolId: () => this.rewards.schoolId,
            localTeam: () => this.localTeam(),
        });
    }

    hudModel() {
        return takrawHudModel({
            view: this.latestView,
            mode: this.mode,
            team: this.localTeam(),
            watchSeed: this.watch.seed,
            tick: this.game.state.tick,
            matchReward: this.rewards.hudReward(),
            campaignSchoolId: this.rewards.schoolId || null,
            connection: this.net.snapshot.message,
            maxLead: this.config.visual.attackGuide.maxLead,
        });
    }

    /** 다음 프레임에 HUD를 바로 다시 그린다. */
    invalidateHud() {
        this.hud.invalidate();
    }

    /** 재생 장면을 그린다. 그릴 장면이 없으면(끝남·첫 장면 대기) false라 멈춘 실제 경기를 그대로 그린다. */
    renderHighlight(now) {
        const replay = this.highlight.frame(now, this.paused);
        if (!replay) return false;
        const latestView = this.latestView;
        this.events?.update(now);
        this.view.render(
            replay.poses,
            { ...latestView, state: { ...latestView.state, ...replay.state } },
            now,
            {
                team: this.localTeam(),
                mode: this.mode,
                replay: { orbit: TAKRAW_RUNTIME.highlight.camera },
            },
        );
        return true;
    }

    /** 한 장면을 그린다(시뮬 루프의 render 단계, 세션이 없으면 그리기 주기가 직접). */
    render(now = performance.now()) {
        const { view, feed, highlight } = this;
        if (!view || !feed?.ready || !this.latestView) return;
        if (highlight.active && !highlight.running) highlight.end();
        if (highlight.active && this.renderHighlight(now)) {
            this.stats.frames += 1;
            return;
        }
        const latestView = this.latestView;
        feed.publish(latestView, false, now);
        this.events.confirm(this.session);
        this.events.update(now);
        if (TAKRAW_MODE_POLICY[this.mode]?.announcesTeam)
            view.setSchools(takrawIdentitySchools(latestView.teamSchools));
        view.render(feed.frame(now), latestView, now, { team: this.localTeam(), mode: this.mode });
        this.stats.frames += 1;
        if (this.hud.due(now, this.mode) && this.mode) this.ui.update(this.hudModel());
    }

    /** 그리기 주기의 한 프레임: 입력을 관찰하고 시뮬 루프(없으면 직접) 그리기. 예외는 실행 실패로 처리한다. */
    frame(now) {
        try {
            this.loop?.observeInput(now);
            if (this.loop) this.loop.render();
            else this.render(now);
        } catch (error) {
            this.simulationFailed(error);
        }
    }

    /** 확인용 장면: 가상 시계로 틱을 직접 진행한다. */
    pulse(now) {
        this.loop.pulse(now, { render: false, input: false });
    }

    /** 확인용 장면: 실시간 진행(deadline pump)을 멈춘다. */
    freezeRealtime() {
        this.pump.stop();
    }

    /** 부팅 실패: 실시간 진행을 멈춘다. */
    stopPump() {
        this.pump?.stop();
    }

    simulationFailed(error, kind = 'simulation') {
        if (this.failed) return error;
        this.failed = true;
        const value = this.recordError(error, 'simulation', 'fatal');
        this.trackFailure('fault', kind, 'fail');
        this.pump?.stop();
        this.loop?.stop();
        this.releaseControls();
        if (TAKRAW_MODE_POLICY[this.mode]?.room) {
            this.net.set({ state: 'error', message: RUNTIME.netStopped() });
        }
        this.ui.showFatal(RUNTIME.runFailed());
        return value;
    }

    /**
     * 세션을 멈춘다: 연결 정리(net.reset) → 세대 올리기 → 조작 해제 → pump·루프 정지 → 세션 닫기 → 방 닫기 → 이벤트·리플레이 정리.
     * 방은 세션이 쓰고 있으므로 세션을 닫은 뒤 닫는다.
     */
    stop({ preserveResume = false } = {}) {
        this.net.reset({ preserveResume });
        this.run += 1;
        this.releaseControls();
        this.pump?.stop();
        this.loop?.stop();
        this.pump = null;
        this.loop = null;
        this.session?.close();
        this.session = null;
        this.net.closeRoom();
        this.events?.close();
        this.highlight.stop();
        this.pendingCommands.length = 0;
        this.paused = false;
        this.failed = false;
        this.mode = null;
    }

    onSessionEvent(event, token) {
        if (token !== this.run || this.isDisposed()) return;
        const { events, feed } = this;
        if (event.type === 'rollback') {
            events.beginRollback(event.from);
            feed.invalidate('rollback');
        } else if (event.type === 'reconciled') {
            events.endRollback();
            this.refreshView();
            feed.invalidate('rollback');
        } else if (event.type === 'membership-committed' || event.type === 'recovered') {
            events.replace();
            this.refreshView();
            feed.invalidate('reset');
            if (event.type === 'membership-committed') this.record.membershipCommitted();
            this.loop?.resetTiming();
            this.pump?.rebase();
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
            this.net.event(`session:${event.type}`, event.reason || `tick=${event.tick ?? '?'}`);
        }
        // fatal은 단계가 던진 원래 예외를 곧바로 다시 던지므로 그 예외가 onError로 올라온다. 여기서 감싸 먼저 실패 처리하면 원래 예외가 버려진다.
        // desync-unrecoverable은 던져진 예외가 없어 세션이 알려 준 사실로 직접 만든 오류다.
        if (event.type === 'desync-unrecoverable')
            this.simulationFailed(new Error(event.reason || event.type), 'desync');
    }

    /** rollback 세션이 부르는 게임 어댑터. 호출 순서(특히 step)는 네트워크·경기 기록 바이트와 이어져 있어 바꾸지 않는다. */
    sessionAdapter(online) {
        const { game, codec, highlight, stats } = this;
        let firstCheckpointReadback = true;
        return {
            saveInto: (out) => codec.encodeInto(game.save(), out),
            load: (bytes) => {
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
                    this.net.event(
                        identical ? 'checkpoint-verified' : 'checkpoint-mismatch',
                        `physics=${physicalSame ? 'equal' : 'different'} bytes=${bytes.length}/${replay.length}`,
                    );
                }
                this.refreshView();
                this.feed.invalidate('reset');
            },
            validateSnapshot(bytes) {
                try {
                    return game.validate(codec.decode(bytes));
                } catch {
                    return false;
                }
            },
            applyMembership: (change) => {
                game.applyMembership(change);
                highlight.reset();
                this.refreshView();
            },
            step: (context) => {
                const begin = performance.now();
                highlight.anchorIfNeeded(game, codec, this.mode);
                game.step(context);
                this.refreshView();
                this.events.emit(context, this.latestView);
                highlight.record(context, this.latestView);
                const elapsed = performance.now() - begin;
                stats.steps += 1;
                stats.simulationMs += elapsed;
                stats.maxSimulationMs = Math.max(stats.maxSimulationMs, elapsed);
            },
        };
    }

    open(nextMode, capability, token) {
        const { game, view } = this;
        this.mode = nextMode;
        const policy = TAKRAW_MODE_POLICY[nextMode],
            flags = TAKRAW_MODES[nextMode];
        const recorded = this.record.begin(nextMode);
        // 상대를 기다리는 경기(온라인)의 시작은 두 사람이 모였을 때(identitySent) 남긴다.
        if (!flags.waitsForPeers) this.metrics.track('match', nextMode, 'start');
        this.watch.point = { tick: null, restarting: false };
        const setup = takrawMatchSetup({
            mode: nextMode,
            home: () => this.getClub().getView().campaign.home,
            homeTeam: () => this.getClub().matchTeam(),
            campaignSchoolId: this.campaignSchoolId,
            watchSeed: this.watch.seed,
            roomCode: capability?.room,
            debugSeed: this.debugMatchSeed,
            randomSeed: () => crypto.getRandomValues(new Uint32Array(1))[0],
        });
        view.setSchools(setup.schools);
        this.paused = false;
        this.audio?.setBackground(TAKRAW_RUNTIME.bgm.levelRampMs);
        if (policy.rewards) this.rewards.begin({ schoolId: this.campaignSchoolId });
        else this.rewards.clear();
        game.setTeams(setup.home, setup.away);
        game.setTemperaments(setup.temperaments);
        game.reset(nextMode, undefined, setup.seed);
        this.refreshView();
        this.resetPresentation();
        this.events.replace();
        const online = policy.room;
        const session = this.createSession(online, capability, recorded, token);
        this.session = session;
        const loop = this.createSimLoop(session, token, flags, policy);
        this.loop = loop;
        this.pump = this.createPump(token, flags);
        this.feed.publish(this.latestView, true);
        loop.observeInput(performance.now());
        this.pump.start();
        this.clearStatus();
        if (online) this.net.sessionOpened(session);
        else {
            this.ui.showGame(nextMode);
            this.ui.canvas.focus({ preventScroll: true });
            this.net.set({ state: 'idle', code: '', message: '', count: 0 });
        }
        this.hud.invalidate();
        this.audio.unlock();
    }

    /** open 1단계: 롤백 세션을 만든다. 온라인은 방(capability)에 붙고, 혼자·로컬 2인은 지연 없는 로컬 세션이다. */
    createSession(online, capability, recorded, token) {
        const { config } = this;
        const adapter = this.sessionAdapter(online);
        const profile = takrawSessionProfile({ online, tickRate: config.simulation.tickRate });
        this.identitySent = false;
        return createRoomSession({
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
            onEvent: (event) => this.onSessionEvent(event, token),
        });
    }

    /** open 2단계: 세션을 진행하는 시뮬 루프. 진행 조건은 세션 준비·실패 없음·상대 대기(waitsForPeers)·멈춤(holdsSimulation)이다. */
    createSimLoop(session, token, flags, policy) {
        return createLoop({
            session,
            rates: {
                baseHz: TAKRAW_RUNTIME.clock.baseHz,
                inputHz: TAKRAW_RUNTIME.clock.inputHz,
                renderHz: TAKRAW_RUNTIME.clock.renderHz,
            },
            getInput: () => this.getInput(),
            canObserveInput: () => Boolean(this.session?.ready && !this.session.failure),
            canAdvance: () =>
                Boolean(
                    this.session?.ready &&
                    !this.session.failure &&
                    (!flags.waitsForPeers || this.session.players.length === 2) &&
                    (!policy.holdsSimulation || (!this.paused && !this.highlight.active)),
                ),
            onAdvance: () => {
                this.feed.publish(this.latestView);
                this.events.confirm(this.session);
                this.observeMatchResult();
                this.observeMetricsMatch();
                this.observeWatchLoop(token);
                this.highlight.tryBegin(this.mode);
            },
            onInputRelease: () => this.clearDeviceState(),
            onError: (error) => this.simulationFailed(error),
            onBacklogDrop: () => {
                this.stats.backlogDrops += 1;
            },
            render: () => this.render(performance.now()),
        });
    }

    /** open 3단계: 루프 마감에 맞춰 입력·진행·연결 정비를 부르는 pump. 입장 대기 중에는 방 정비만 inputHz로 돈다. */
    createPump(token, flags) {
        let maintenanceDeadline = null;
        return createDeadlineScheduler({
            getDeadlineMs: () => {
                // 입장 대기는 simulation debt를 따라잡는 시간이 아니다. 방 정비만 60Hz로 유지한다.
                const current = this.session;
                if (
                    current &&
                    (!current.ready || (flags.waitsForPeers && current.players.length < 2))
                ) {
                    return maintenanceDeadline;
                }
                return this.loop?.nextDeadlineMs ?? null;
            },
            pulse: (now) => {
                if (!this.loop || token !== this.run) return;
                maintenanceDeadline = now + 1000 / TAKRAW_RUNTIME.clock.inputHz;
                this.loop.pollInput(now);
                this.loop.pulse(now, { render: false, input: false });
                // Network commands belong to the existing pump, not to rendering.
                this.maintainNetwork(now);
            },
        });
    }

    /** 관전은 그 시드의 첫 1점만 반복한다. 득점 뒤 loopHoldMs가 지나면 같은 시드를 처음부터 다시 연다(루프 콜백 안에서 세션을 부수지 않도록 한 박자 늦춘다). */
    observeWatchLoop(token) {
        const point = this.watch.point;
        if (
            !TAKRAW_MODE_POLICY[this.mode]?.loopsFirstPoint ||
            !this.watch.repeat ||
            point.restarting
        )
            return;
        const { score, tick } = this.game.state;
        if (score[0] + score[1] < 1) return;
        point.tick ??= tick;
        if (
            tick - point.tick <
            (TAKRAW_RUNTIME.watch.loopHoldMs / 1000) * this.config.simulation.tickRate
        )
            return;
        point.restarting = true;
        setTimeout(() => {
            if (token === this.run && TAKRAW_MODE_POLICY[this.mode]?.loopsFirstPoint)
                this.startWatch(this.watch.seed);
        }, 0);
    }

    /**
     * 시드 하나가 AI 대 AI 경기 하나다. 팀·성향은 기본값이라 저장소를 읽거나 쓰지 않는다.
     * repeat가 false면 첫 1점 뒤에 다시 열지 않고 경기를 이어 간다(확인용 장면: 요청한 tick의 상태를 그대로 보고한다).
     */
    startWatch(seed, { repeat = true } = {}) {
        const value = Number(seed);
        if (
            !Number.isInteger(value) ||
            value < 0 ||
            value > TAKRAW_RUNTIME.watch.maxSeed ||
            !this.isReady()
        )
            return false;
        this.watch.seed = value;
        this.watch.repeat = repeat;
        this.startLocal('watch');
        return true;
    }

    startLocal(nextMode) {
        if (!this.canStart(nextMode)) {
            this.publishClub();
            return;
        }
        this.audio.unlock();
        this.observeMatchResult();
        this.stop();
        try {
            this.open(nextMode, null, this.run);
        } catch (error) {
            this.simulationFailed(error);
        }
    }

    /** 메뉴에서 고른 경기는 도장깨기 상대를 비운다. */
    clearCampaign() {
        this.campaignSchoolId = null;
    }

    /** 도장깨기 한 판(상대 학교 schoolId). 확인은 호출자가 한다. */
    startCampaign(schoolId) {
        this.campaignSchoolId = schoolId;
        this.startLocal('match');
    }

    /** 확인용 장면: 시드를 고정한 AI 대전. every면 모든 득점을 리플레이한다(판정 기준만 낮추고 재생 방식은 그대로다). */
    openDebugMatch(seed, every) {
        this.debugMatchSeed = seed;
        if (every) this.highlight.replayEveryScore();
        this.startLocal('match');
        return this.mode === 'match';
    }

    async connect(action, code, resuming = false) {
        const net = this.net;
        if (!this.isReady() || this.isDisposed()) return;
        if (action === 'close') {
            this.quit();
            return;
        }
        if (action === 'resume') {
            const saved = net.savedRoom();
            if (saved) return this.connect(saved.role, saved.room, true);
            net.set({ state: 'error', canResume: false, message: RUNTIME.netNoResume() });
            return;
        }
        if (action !== 'host' && action !== 'join') return;
        this.metrics.track('online', resuming ? 'resume' : action, 'click');
        const roomCode = String(
            code ||
                (action === 'host'
                    ? String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0')
                    : ''),
        ).trim();
        if (action === 'join' && !/^\d{4}$/.test(roomCode)) {
            net.set({ state: 'error', message: RUNTIME.netEnterCode(), count: 0 });
            return;
        }
        if (!net.preflight()) return;
        this.audio.unlock();
        this.stop({ preserveResume: resuming });
        const token = this.run;
        let capability;
        try {
            capability = await net.openRoom({ action, roomCode, resuming });
            if (!capability) return;
            this.open('online', capability, token);
        } catch (error) {
            capability?.close();
            if (token !== this.run || this.isDisposed()) return;
            net.failConnect(error, action, () => this.stop({ preserveResume: true }));
        }
    }

    /** 훈련 명령(과제·속도) 하나를 다음 입력에 싣는다. 조작할 수 없을 때는 무시한다. */
    trainingCommand(command) {
        if (!TAKRAW_MODES[this.mode]?.drill || !this.controlsAllowed()) return;
        this.releaseControls();
        this.pendingCommands.push(command);
        this.observeSoon();
        this.ui.canvas.focus({ preventScroll: true });
    }

    restart() {
        const mode = this.mode;
        if (!mode) return;
        this.metrics.track('match', mode, 'restart');
        const restart = TAKRAW_MODE_POLICY[mode].restart;
        if (restart === 'command') {
            this.releaseControls();
            this.pendingCommands.push(4);
            this.observeSoon();
            this.ui.canvas.focus({ preventScroll: true });
            return;
        }
        if (restart === 'hostCommand') {
            const session = this.session;
            if (!session?.ready || session.players.length !== 2) return;
            if (this.localTeam() !== 0) return;
            this.pendingCommands.push(4);
            this.observeSoon();
        } else this.startLocal(mode);
    }

    quit() {
        if (!this.isReady() || this.isDisposed()) return;
        const { game } = this;
        if (this.mode) this.metrics.track('match', this.mode, 'quit');
        this.observeMatchResult();
        this.stop();
        this.audio?.setBackground(TAKRAW_RUNTIME.bgm.levelRampMs);
        this.rewards.clear();
        this.campaignSchoolId = null;
        game.setTeams(null, null);
        game.setTemperaments();
        game.reset('match');
        this.refreshView();
        this.resetPresentation();
        this.feed.publish(this.latestView, true);
        this.clearStatus();
        this.ui.showHome();
        this.publishClub();
        this.net.set({
            state: 'idle',
            code: '',
            message: '',
            count: 0,
            phase: RUNTIME.phaseIdle(),
            hint: '',
            canResume: false,
        });
    }

    setPaused(value) {
        this.paused = Boolean(value);
        this.releaseControls();
        if (TAKRAW_MODE_POLICY[this.mode]?.holdsSimulation ?? true) {
            this.loop?.resetTiming();
            if (this.paused) this.pump?.stop();
            else {
                this.pump?.start();
                this.pump?.wake();
            }
        }
        this.audio?.setBackground(TAKRAW_RUNTIME.bgm.levelRampMs);
    }

    /** 득점 리플레이를 보여 주는 중인지(화면을 누르면 건너뛴다). */
    get replayActive() {
        return this.highlight.active;
    }

    skipReplay() {
        this.highlight.end();
    }

    replayState() {
        return this.highlight.replayState();
    }

    /** diagnostics().simulation: 부팅 이후 누적 시뮬 시간 통계. */
    simulationDiagnostics() {
        const stats = this.stats;
        return { ...stats, averageMs: stats.steps ? stats.simulationMs / stats.steps : 0 };
    }

    highlightDiagnostics() {
        return this.highlight.diagnostics();
    }

    /** stop() 뒤에 부른다. 리플레이 worker를 닫고 이벤트 저널·표시 통로를 놓는다. */
    dispose() {
        this.highlight.dispose();
        this.events?.dispose();
        this.feed?.dispose();
    }
}

export { MatchSession };
