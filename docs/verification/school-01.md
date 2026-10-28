# 1단계 학교 외형 검증 (v0.12.23)

기준 main: `fbf04e0` (PR #19). 학교명과 팔레트는 임시안이다. 시뮬레이션·lockstep 입력은 수정하지 않았다.

- `npm run check`: 통과.
- `npm run verify:dependencies`: 고정 GameKit 9모듈 원격 바이트 해시 통과.
- `RAPIER_MODULE=file:///<worktree>/artifacts/rapier.mjs npx playwright test sync.spec.js --reporter=list`: 실제 고정 Rapier 0.21.0, 5개 통과(1.2분). 두 피어 3600틱·다른 방 변주·롤백·중도 합류·재시작.
- 첫 `npm test`: 27통과/10건너뜀/1실패, 120468ms. 기존 사용자 흐름의 3회 공격 성공률 0.50 < 0.80. 변경 없는 main의 같은 좁은 검사에서도 0.60 < 0.80 재현.
- 진단용 매 step 관찰로 재실행한 `npm test`도 27통과/10건너뜀/1실패, 성공률 0.60이었다. 실패 4건은 핸드 반칙 1, 네트 아래 통과 1, 아웃 2. 렌더 관찰 누락 가설을 기각하고 테스트 변경은 원복했다. 기준·시드·입력·시뮬레이션을 바꾸지 않았다.
- 차단: 표시 전용 1단계에 AI/물리 수정은 포함할 수 없고, 필수 npm test가 실패하므로 머지/2단계 진입을 보류했다. 실제 Nostr/WebRTC·복구·재접속 흐름은 앞선 성공률 실패 뒤 실행되지 않아 미검증이다.

## 표시 확인

`artifacts/e2e/school-01/{sprout,flame,wave,bolt,moon}-{1280,390}.png` 10장과 `evidence.json`. viewport는 1280×800 / 390×844. Chromium headless, ANGLE Vulkan SwiftShader 소프트웨어 renderer. 실제 GPU/실제 모바일 기기는 미검증이다.

각 학교의 상체·위팔 주색, 하단 보조띠, 하의와 양말, round/crest/bob 머리 형태를 확인했다. 뒤 등번호는 64×64 canvas 텍스처를 번호·색 조합으로 캐시한다. 5학교 순회 후 15개. 10경우 모두 표시 학교 교체 전후 save JSON 동일, 선수 torso 6개. 관찰 draw call 274~294이며 성능 벤치마크 수치는 아니다. 새싹고끼리 경기하면 같은 학교 복장을 입는 것이 정상이다.

## 근거

[Three.js CanvasTexture](https://threejs.org/docs/pages/CanvasTexture.html)는 canvas를 texture로 사용하고 즉시 갱신한다. [Texture.dispose](https://threejs.org/docs/pages/Texture.html#dispose)에 따라 종료 시 캐시 texture를 명시 해제한다. 학교 교체 때 선수 메시와 변형 다리 geometry를 정리한다. 학교는 Uniform·Hair 데이터를 가지며 상속/믹스인/호환 wrapper를 도입하지 않았다.
