import { TAKRAW_CONFIG } from '../config/game.js';
import { TakrawGame } from '../simulation/game.js';
import { TAKRAW_RUNTIME } from '../config/runtime.js';
import { TakrawHighlightShadow } from './highlight-shadow.js';

// 리플레이 그림자 경기를 메인 스레드 밖에서 계산한다. 워커에는 import map이 없으므로 Rapier·gamekit deterministic 주소는 메인이 풀어서 넘긴다.
let shadow = null;
let codec = null;
let queue = Promise.resolve();

async function handle(message) {
    if (message.type === 'init') {
        const loaded = await import(message.rapierUrl),
            RAPIER = loaded.default ?? loaded;
        await RAPIER.init();
        const deterministic = await import(message.deterministicUrl);
        codec = deterministic.createValueCodec();
        const time = deterministic.tickTime({ tickRate: TAKRAW_CONFIG.simulation.tickRate });
        shadow = new TakrawHighlightShadow(
            new TakrawGame({ RAPIER, config: TAKRAW_CONFIG, deterministic, time }),
            (data, transfer) => self.postMessage(data, transfer),
            Math.max(1, time.ceilTicks(TAKRAW_RUNTIME.highlight.batchMs)),
        );
        self.postMessage({ type: 'ready' });
    } else if (message.type === 'reset') shadow.reset();
    else if (message.type === 'anchor') shadow.anchor(codec.decode(message.bytes));
    else if (message.type === 'input') shadow.push(message.frame, message.target);
    else if (message.type === 'play') shadow.start(message.play);
}

self.onmessage = (event) => {
    queue = queue
        .then(() => handle(event.data))
        .catch((error) =>
            self.postMessage({ type: 'error', message: String(error?.stack || error) }),
        );
};
