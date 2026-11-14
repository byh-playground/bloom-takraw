import fs from 'node:fs';
import { TAKRAW_RUNTIME } from '../src/config/runtime.js';

const ORIGIN = new URL(TAKRAW_RUNTIME.metrics.endpoint).origin;
const LOCK = JSON.parse(fs.readFileSync(new URL('../gamekit.lock.json', import.meta.url)));
// 재계산 도구는 게임이 쓰지 않아 import map에 없다. 같은 dist 커밋에서 직접 불러온다.
const REPLAY_URL = `https://cdn.jsdelivr.net/gh/byh-playground/bloom-gamekit@${LOCK.distCommit}/replay.js`;

/** 지표 요청을 가로채 기록한다. 시험은 운영 수집 서버로 보내지 않는다. */
export async function captureMetrics(context) {
    const batches = [];
    await context.route(
        (url) => url.origin === ORIGIN,
        async (route) => {
            const request = route.request();
            if (request.method() === 'POST') batches.push(JSON.parse(request.postData()));
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: '{"ok":true}',
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
            });
        },
    );
    return {
        batches,
        /** 보낸 사람 행동 이벤트를 `분류:대상:동작`으로 */
        events: () =>
            batches.flatMap((batch) =>
                batch.events
                    .filter((event) => event.type === 'event')
                    .map((event) => `${event.category}:${event.target}:${event.action}`),
            ),
        /** 세션 시작마다 모듈이 붙인 언어·화면 구간·터치 여부 */
        sessionStarts: () =>
            batches.flatMap((batch) =>
                batch.events
                    .filter((event) => event.type === 'session_start')
                    .map((event) => event.props),
            ),
    };
}

/** 지금 세션의 경기 기록을 새 게임에서 구간마다 다시 돌려 기록된 hash와 비교한다. */
export function replaySession(page) {
    return page.evaluate(async (url) => {
        const [
            { playReplay },
            { TakrawGame },
            { TAKRAW_CONFIG },
            deterministic,
            { default: RAPIER },
        ] = await Promise.all([
            import(url),
            import('/src/simulation/game.js'),
            import('/src/config/game.js'),
            import('@bloom-gamekit/deterministic'),
            import('rapier'),
        ]);
        const codec = deterministic.createValueCodec(),
            replay = window.__takraw.session.exportReplay();
        return replay.segments.map((segment) => {
            const game = new TakrawGame({
                RAPIER,
                config: TAKRAW_CONFIG,
                deterministic,
                time: deterministic.tickTime({ tickRate: TAKRAW_CONFIG.simulation.tickRate }),
            });
            try {
                const played = playReplay({
                    replay: segment,
                    adapter: {
                        saveInto: (out) => codec.encodeInto(game.save(), out),
                        load: (bytes) => game.load(codec.decode(bytes)),
                        validateSnapshot: () => true,
                        step: (context) => game.step(context),
                    },
                });
                return {
                    epoch: segment.membershipEpoch,
                    ticks: segment.tick,
                    inputChangeBytes: segment.inputChanges.length,
                    same: played.tick === segment.tick && played.hash === segment.hash,
                };
            } finally {
                game.dispose();
            }
        });
    }, REPLAY_URL);
}
