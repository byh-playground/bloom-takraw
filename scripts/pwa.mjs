// 설치·오프라인 시작용 PWA 파일을 만든다. `node scripts/pwa.mjs`로 생성, `node scripts/pwa.mjs --check`로 커밋된 결과가 원본과 같은지 확인한다.
// 아이콘·공유 이미지 원본(assets/pwa/*.svg)은 게임 실제 렌더(?debug=1&scene=spike&seed=1&tick=589&camera=…)를 JPEG로 넣은 SVG다.
// camera: 아이콘 -2.2,2.6,7.5,-0.45,-0.75,0,20 / maskable -2.2,2.6,7.5,-0.45,-0.75,0,26 / 공유 이미지 -3.4,2.2,8.5,-2.1,-1.0,0,27 (512·1200x630, deviceScaleFactor 2)
import { chromium } from 'playwright';
import { buildPwa } from './vendor/gamekit/pwa-build.mjs';

await buildPwa({
    chromium,
    // 설치 이름·공유 문구는 페이지 기본 언어(en)로 쓴다. 게임 이름의 원본은 src/config/game.js TAKRAW_GAME_NAME이고 scripts/check.cjs가 index.html 제목과 맞춘다.
    name: 'Bloom Takraw',
    shortName: 'Takraw',
    description:
        'Bloom Takraw: time your instep spike to the AI setter’s high toss. Four kicks with context-aware moves, timing guides, physics-based 3-on-3 matches and 1-on-1 online play.',
    lang: 'en',
    icon: 'assets/pwa/icon.svg',
    maskableIcon: 'assets/pwa/icon-maskable.svg',
    share: 'assets/pwa/share.svg',
    themeColor: '#e8eee3',
    backgroundColor: '#e8eee3',
    startUrl: './',
    scope: './',
    siteUrl: 'https://byh-playground.github.io/bloom-takraw/',
    html: 'index.html',
    out: '.',
    check: process.argv.includes('--check'),
});
