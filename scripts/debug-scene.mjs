// 확인용 주소 장면(`?debug=1&scene=…`, src/debug-scenes.js) 하나를 헤드리스 Chromium으로 열어 state·hash를 출력한다.
// 판정하지 않는 도구다(시험이 아님). 실행기는 gamekit debug-tools의 runDebugScene(scripts/vendor/gamekit/debug-scene.mjs,
// gamekit.lock.json의 tools에 dist commit·SHA-256 고정)이고, 이 파일은 체크아웃 하나를 여는 방법만 넘긴다.
//
//   node scripts/debug-scene.mjs "scene=watch&seed=1252&tick=844" --compare ../bloom-takraw-base
//   node scripts/debug-scene.mjs "scene=spike&seed=22591&tick=581&camera=…" --capture out.png
//
// 옵션(--ticks·--state·--capture·--compare·--compare-query·--repeat·--heap·--gpu·--json)은 gamekit debug-tools README를 따른다.
// 주소에는 항상 `debug=1`이 붙으므로 격리 장면(메모리 저장·지표 미전송)으로만 열린다.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { runDebugScene } from './vendor/gamekit/debug-scene.mjs';

const require = createRequire(import.meta.url);

await runDebugScene({
    chromium,
    argv: process.argv.slice(2),
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    // 각 체크아웃은 자기 원본 서버(scripts/dev-server.cjs)로 연다. GameKit·Three.js·Rapier는 그 체크아웃의 import map 고정 주소에서 받는다.
    async serve(checkout) {
        const server = require(path.join(checkout, 'scripts', 'dev-server.cjs')).createServer(
            checkout,
        );
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        return {
            url: `http://127.0.0.1:${server.address().port}/`,
            close: () =>
                new Promise((resolve) => {
                    server.close(resolve);
                    server.closeAllConnections();
                }),
        };
    },
    viewport: { width: 1280, height: 720 },
    fields: ['tick', 'score'],
});
