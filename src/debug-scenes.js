/**
 * 주소로 여는 확인용 장면(`?debug=1&scene=이름&tick=N&…`). 일반 플레이에서는 로드되지 않는다.
 * 호스트는 파라미터를 해석하지 않으므로 값의 형식은 각 장면이 정하고, 틀리면 그대로 실패한다.
 */
/** 내 학교(campaign.home)와 levels·cards·gacha·pending이 없던 옛 형식의 팀 저장. 지금 형식이 아니라 읽지 못하는 저장으로 처리된다. */
const OLD_FORMAT_TEAM_SAVE = Object.freeze({
    schema: 1,
    revision: 4,
    name: '옛 팀',
    credits: 600,
    trainingPoints: 6,
    owned: ['han-gyeol', 'yun-seo', 'i-deun'],
    trained: {},
    lineup: { receiver: 'han-gyeol', setter: 'yun-seo', attacker: 'i-deun' },
    record: { played: 0, won: 0, lost: 0 },
    rewards: [],
    lastReward: null,
    campaign: { cleared: [] },
});

export function createDebugScenes({
    config,
    openWatch,
    pulse,
    render,
    renderFrom,
    ballPosition,
    read,
    stateHash,
    openClub,
    showClub,
    openMatch,
    readReplay,
    ballScreen,
}) {
    const QUANTUM = 1000 / config.simulation.tickRate;
    const scenes = {
        /**
         * 시드 하나의 AI 대 AI 경기를 debug-tools 가상 시계로 틱 단위로 진행한다. 시드는 관전 범위(0~maxSeed) 안의 아무 정수다.
         * 일반 관전과 달리 첫 1점 뒤에 다시 열지 않으므로 state()의 tick은 요청한 tick이다(득점 뒤에도 경기가 이어진다).
         */
        watch({ seed }, { freezeClock }) {
            if (!openWatch(seed)) throw new Error(`watch needs an integer seed in range: ${seed}`);
            // 표시·연출이 읽는 시계도 틱에서 나오게 해, 같은 주소가 항상 같은 장면을 만든다. 시계는 호스트가 되돌린다.
            const clock = freezeClock();
            return {
                step() {
                    const before = read().tick;
                    // 첫 pulse는 루프의 시간 기준만 잡을 수 있어 한 번 더 부른다.
                    for (let attempt = 0; attempt < 3 && read().tick === before; attempt++) {
                        clock.advance(QUANTUM);
                        pulse(clock.now());
                    }
                    if (read().tick !== before + 1)
                        throw new Error(`step advanced ${read().tick - before} ticks`);
                },
                render: () => render(clock.now()),
                // screen: 공의 화면 위치(CSS px). 캡처를 공 주변으로 자를 때 쓴다.
                state: () => ({ ...read(), screen: ballScreen() }),
                // 경기 전체 상태(game.save())의 해시. 두 체크아웃에서 같은 주소를 열어 결과가 비트 단위로 같은지 본다.
                hash: stateHash,
            };
        },
        /**
         * watch와 같은 재생을 고정 카메라로 그리고 화면 HUD를 숨긴다(아이콘·공유 이미지용 장면 캡처).
         * camera는 `x,y,z,tx,ty,tz,fov`(카메라 위치, 바라보는 점, 세로 시야각 도)이며 바라보는 점은 공 위치 기준의 상대 좌표다.
         * aim=world면 바라보는 점이 월드 좌표다(카메라가 공을 따라 돌지 않아 접점 효과의 크기 변화를 그대로 본다).
         */
        spike({ seed, camera, aim }, context) {
            const values = String(camera).split(',').map(Number);
            if (values.length !== 7 || !values.every(Number.isFinite))
                throw new Error(`spike needs camera=x,y,z,tx,ty,tz,fov: ${camera}`);
            const [x, y, z, tx, ty, tz, fov] = values;
            if (aim !== undefined && aim !== 'world')
                throw new Error(`spike aim must be world: ${aim}`);
            const watch = scenes.watch({ seed }, context);
            const style = document.createElement('style');
            style.textContent = '#app > :not(#court-canvas){display:none!important}';
            document.head.append(style);
            return {
                step: watch.step,
                render() {
                    watch.render();
                    const ball = ballPosition();
                    if (!ball) throw new Error('spike needs a ball on screen');
                    const origin = aim === 'world' ? { x: 0, y: 0, z: 0 } : ball;
                    renderFrom({
                        position: { x, y, z },
                        target: { x: origin.x + tx, y: origin.y + ty, z: origin.z + tz },
                        fov,
                    });
                },
                state: () => ({ ...read(), ball: ballPosition() }),
                hash: watch.hash,
                dispose() {
                    style.remove();
                },
            };
        },
        /**
         * 시드를 고정한 AI 대전을 실제 시간으로 연다(가상 시계 없음). 득점 리플레이는 워커가 계산해 보내므로 틱 단위로 멈춰 재현하지 않는다.
         * every=1이면 모든 득점을 리플레이한다.
         */
        match({ seed, every }) {
            if (!/^\d+$/.test(seed ?? '')) throw new Error(`match needs an integer seed: ${seed}`);
            if (!openMatch(Number(seed), every === '1')) throw new Error('match could not start');
            return { state: () => ({ ...read(), replay: readReplay() }) };
        },
        /**
         * 시드로 만든 새 클럽(메모리 저장)을 팀 관리 화면으로 연다. 실제 저장은 건드리지 않는다.
         * credits가 있으면 코인을 그 값으로 두고, draws가 있으면 그 뒤 그 횟수만큼 뽑는다(코인이 모자라면 게임 규칙대로 실패).
         * unreadable=1이면 옛 형식의 저장이 이미 있는 것으로 시작해 "읽지 못한 저장 → 기록 지우고 새로 시작" 화면을 연다.
         */
        async club({ seed, credits, draws, unreadable }) {
            if (!/^\d+$/.test(seed ?? '')) throw new Error(`club needs an integer seed: ${seed}`);
            const club = await openClub(
                Number(seed),
                unreadable === '1' ? OLD_FORMAT_TEAM_SAVE : null,
            );
            if (credits !== undefined)
                await club.debugMutate((record) => {
                    record.credits = Number(credits);
                });
            if (draws !== undefined)
                for (let drawn = 0; drawn < Number(draws); drawn++) await club.draw();
            showClub();
            const view = () => club.getView();
            return {
                state: () => ({
                    status: view().status,
                    locked: view().locked,
                    teamName: view().teamName,
                    credits: view().credits,
                    home: view().campaign.home,
                    roster: view().roster.map((player) => player.name),
                    pending: view().draw.pending?.name ?? null,
                }),
            };
        },
    };
    return scenes;
}
