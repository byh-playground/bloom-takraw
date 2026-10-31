// 설치·오프라인 시작용 PWA 파일을 만든다. `node scripts/pwa.mjs`로 생성, `node scripts/pwa.mjs --check`로 커밋된 결과가 원본과 같은지 확인한다.
// 아이콘·공유 이미지 원본(assets/pwa/*.svg)은 게임 실제 렌더(?debug=1&scene=spike&seed=1&tick=589&camera=…)를 JPEG로 넣은 SVG다.
// camera: 아이콘 -2.2,2.6,7.5,-0.45,-0.75,0,20 / maskable -2.2,2.6,7.5,-0.45,-0.75,0,26 / 공유 이미지 -3.4,2.2,8.5,-2.1,-1.0,0,27 (512·1200x630, deviceScaleFactor 2)
import { chromium } from 'playwright';
import { buildPwa } from './vendor/gamekit/pwa-build.mjs';

await buildPwa({
  chromium,
  name: '블룸 발 배구',
  shortName: '발 배구',
  description: 'AI 세터의 높은 토스에 맞춰 발등으로 스파이크를 날리는 블룸 발 배구. 네 가지 발차기와 상황별 동작 선택, 타이밍 가이드, 물리 기반 3대3 경기와 1대1 대전.',
  lang: 'ko',
  icon: 'assets/pwa/icon.svg',
  maskableIcon: 'assets/pwa/icon-maskable.svg',
  share: 'assets/pwa/share.svg',
  themeColor: '#e8eee3',
  backgroundColor: '#e8eee3',
  startUrl: './',
  scope: './',
  siteUrl: 'https://byh-playground.github.io/bloom-takraw/',
  html: 'index.html',
  // 시작에 필요한 같은 origin 파일 전부. three·rapier(npm CDN)는 서비스 워커가 캐시하지 않는다.
  precache: ['index.html', 'src/**', 'styles/**', 'assets/audio/*.ogg'],
  out: '.',
  check: process.argv.includes('--check'),
});
