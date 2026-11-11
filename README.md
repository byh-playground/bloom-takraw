# 블룸 발 배구

블룸 세계관의 3D 온라인 발 배구 게임입니다. 개발 저장소는 `C:\projects\bloom-takraw`, 원격은 [byh-playground/bloom-takraw](https://github.com/byh-playground/bloom-takraw)입니다.

이름: 게임 이름은 `src/config/game.js`의 `TAKRAW_GAME_NAME`(발 배구)이 단일 출처이고 `npm run check`가 `index.html`·README·AGENTS·`package.json`과의 일치를 검사합니다. 저장소·패키지 이름 `bloom-takraw`, `TAKRAW_*`·`Takraw*` 식별자, `window.__takraw`, 저장 키는 바꾸지 않았습니다(이름이 아니라 식별자라서).

- [공개 게임](https://byh-playground.github.io/bloom-takraw/)은 `main /`의 원본을 상시 배포합니다.
- `main`은 개발·배포 기준입니다. PR이 main에 머지되면 공개 게임에도 반영되며 별도 release 브랜치를 갱신하지 않습니다.
- 개발 기준은 [bloom-reference 개발 규칙](https://github.com/byh-playground/bloom-reference/blob/main/rules/development.html), [AI 개발 규칙](https://github.com/byh-playground/bloom-reference/blob/main/rules/ai-development.html), [프로젝트 관리 규칙](https://github.com/byh-playground/bloom-reference/blob/main/rules/project-management.html)입니다. 정책 전문을 이 저장소에 복제하지 않습니다.

## 실행

Node.js 22 이상에서 다음을 실행하고 `http://127.0.0.1:8766/`를 엽니다.

```powershell
npm ci
npm run dev
```

`index.html`은 화면 골격이며 CSS와 ES 모듈을 링크합니다. **HTML을 더블클릭하는 file:// 실행은 지원하지 않습니다.** GameKit·Three.js·Rapier를 고정 CDN URL에서 가져오므로 처음 실행과 온라인 연결에 인터넷이 필요합니다. 이웃 저장소의 파일을 런타임에서 읽지 않습니다.

설치(PWA): 공개 주소는 설치할 수 있고(설정 창 "앱으로 설치"), 새로고침하면 항상 최신 버전이고, 한 번 연 뒤에는 서비스 워커가 마지막으로 받은 게임 파일과 GameKit을 오프라인 사본으로 둡니다. Three.js·Rapier는 보관하지 않아 브라우저 HTTP 캐시가 비면 오프라인으로 시작하지 못합니다. `assets/pwa/`나 `scripts/pwa.mjs` 설정을 고치면 `node scripts/pwa.mjs`로 생성 파일을 다시 만듭니다(`npm run check`가 어긋남을 막습니다). 자세한 내용은 [구조 문서](docs/architecture.md#설치오프라인pwa-v0140)를 참고하세요.

## 구조와 GameKit 참조

```text
index.html                   화면 골격, CSS/JS 링크, import map
gamekit.lock.json             GameKit 배포 커밋·파일 URL·SHA-256
manifest.webmanifest, sw.js, pwa/  설치·오프라인(PWA) 생성 결과. scripts/pwa.mjs가 만들고 npm run check가 어긋남을 막음
src/
  main.js                    로딩/오류 화면과 부팅
  launch.js                  페이지를 연 맥락(격리 장면·소개영상·iframe)의 단일 출처
  runtime.js                 게임과 GameKit의 수명주기 연결
  debug-scenes.js            주소(?debug=1&scene=…)로 여는 확인용 장면
  config/{game,runtime,schools,intro}.js  게임 정의, 실행 정책, 학교 외형, 소개영상 대본
  club/{club,generator,names}.js  선수·편성·보상·뽑기·IndexedDB 저장, 생성 선수, 이름 표
  motion/{data,model,matcher}.js  게임 고유 모션 자료와 매칭
  simulation/{game,physics,timing,ai-brain,ai-formation,identity,roster,joint-limits,random}.js
                             경기 규칙, Rapier 어댑터, 입력 타이밍 판정, AI 선수 행동과 대형, 온라인 팀 표기, 선수 id 배치(팀·슬롯·조종 선수), 관절 가동 범위, 시드 난수 이름
  presentation/              Three.js 표시(view), DOM UI(ui), 접촉·착지·득점 효과, 득점 리플레이(highlight*), 소리, 소개영상 연결
  i18n/                      화면 언어(ko/en) 선택과 문구 표
styles/app.css               화면 스타일
assets/                      배경 음악, PWA 아이콘·공유 이미지 원본(SVG)
scripts/                     원본 HTTP 서버, 정적 참조·의존성 검사, PWA 생성, 확인용 장면 실행기, itch.io 제출 zip
tools/check-changed.mjs      PR 변경 파일의 Prettier·ESLint 검사
playwright.config.js         사용자 시나리오 실행 구성
tests/{user-flow,mobile-flow}.spec.js  고정 사용자 흐름 E2E(공용 보조: tests/metrics.js)
docs/                        구조·화면 언어·itch.io 제출 문서
artifacts/                   새 실행 결과, Git 제외
```

공통 기능의 원본은 사용자 소유 [bloom-gamekit](https://github.com/byh-playground/bloom-gamekit)입니다. `runtime.js`는 `import { createRoomSession } from '@bloom-gamekit/rollback'`처럼 기능 소유 모듈에서 직접 가져옵니다. HTML import map이 별칭을 고정 배포 URL로 해석합니다. GameKit 소스를 복사하거나 별도 공통 엔진으로 감싸지 않습니다.

GameKit dist 커밋 `bbd03f6e18068fc51f44df7e4389a2cc6d437829`(v0.56.0), Three.js 0.180.0, Rapier 0.21.0를 씁니다. 책임 경계와 수정 위치는 [구조 문서](docs/architecture.md)를 참고하세요. 화면 문구는 한국어·영어이고 규칙은 [화면 언어](docs/i18n.md)에 있습니다.

## 게임 지표

[gamekit metrics](https://github.com/byh-playground/bloom-gamekit/blob/main/modules/metrics/README.md)로 플레이 시간·행동 이벤트·경기 기록을 수집 서버(`TAKRAW_RUNTIME.metrics.endpoint`)에 보냅니다. 격리 장면(`?debug`, `?showcaseDemo=1`)은 메모리에만 남깁니다. 개발자 본인 플레이는 서버가 접속 키로 나중에 거르므로 게임 쪽 표시는 없습니다. 값의 뜻이 바뀌면 게임 버전을 올립니다(집계는 `build`로 나눕니다).

| category                        | target                                            | action           | 언제                                                                                                                                                                         |
| ------------------------------- | ------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `menu`                          | `match`·`local`·`training`·`watch`·`online`       | `click`          | 시작 메뉴 버튼                                                                                                                                                               |
| `menu`                          | `campaign`                                        | `click`          | 도장깨기 학교 선택. props `{ schoolId }`                                                                                                                                     |
| `menu`                          | `watch_seed`                                      | `click`          | 관전 시드 입력·추천·무작위                                                                                                                                                   |
| `match`                         | 모드(`match`·`local`·`training`·`watch`·`online`) | `start`          | 경기 시작. 온라인은 두 사람이 모였을 때                                                                                                                                      |
| `match`                         | 모드                                              | `restart`·`quit` | 다시 하기·연습 재시도, 메뉴에서 나가기                                                                                                                                       |
| `online`                        | `host`·`join`·`resume`                            | `click`          | 방 만들기·입장·재접속                                                                                                                                                        |
| `club`                          | 클럽 동작(`rename`·`assign`·`train`·`draw` 등)    | `click`          | 팀 관리                                                                                                                                                                      |
| `fault`·`network`·`unsupported` | 아래 표                                           | `fail`·`block`   | 놀이를 멈춘 실패를 성격별로. props `{ mode }`(메뉴면 `menu`), 연결 원인 이벤트(`network`·`fault:sync`·`unsupported:version`)는 `phase`도. 오류 메시지·스택은 보내지 않습니다 |

세션 시작(`session_start`)에는 모듈이 언어(`LOCALE.locale`)·화면 크기 구간·터치 여부를 붙입니다(gamekit v0.46.2).

| 이벤트                                          | 성격           | 지점                                                                                                                |
| ----------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------- |
| `fault:simulation:fail`                         | 게임 결함 의심 | 시뮬레이션·루프 예외(`simulationFailed`). 세션 단계가 던진 예외(`fatal`)도 감싸지 않고 원래 예외 그대로 여기로 온다 |
| `fault:desync:fail`                             | 게임 결함 의심 | 세션 이벤트 `desync-unrecoverable`                                                                                  |
| `fault:sync:fail` `{ phase }`                   | 게임 결함 의심 | 연결 중 경기 상태 검사(부트스트랩·체크포인트·스냅샷) 실패                                                           |
| `network:relay:fail` `{ phase }`                | 연결 사정      | 중계 서버(Nostr)에 닿지 못함                                                                                        |
| `network:peer:fail` `{ phase }`                 | 연결 사정      | 친구와 직접 연결(WebRTC·ICE) 실패                                                                                   |
| `network:secure:fail` `{ phase }`               | 연결 사정      | 보안 컨텍스트·WebCrypto 문제                                                                                        |
| `network:other:fail` `{ phase }`                | 연결 사정      | 위에 맞지 않는 연결 오류                                                                                            |
| `network:timeout:fail` `{ phase: 'handshake' }` | 연결 사정      | 연결은 됐지만 시간 안에 경기 상태를 못 맞춤                                                                         |
| `unsupported:version:block` `{ phase }`         | 환경           | 두 게임 버전이 달라 맞출 수 없음(새로고침으로 같은 버전을 받으면 해소)                                              |
| `unsupported:browser:block`                     | 환경           | 보안 연결·암호화·WebSocket·WebRTC 중 하나가 없는 브라우저                                                           |

`phase`는 `connect`(방 만들기·입장 중)·`session`(온라인 세션 중)·`handshake`(시간 초과)입니다. 원인은 화면 오류 문구·단계 이름과 같은 분류(`connectionCause`) `secure`·`sync`·`version`·`relay`·`peer`·`other`이고, 지표는 원인의 성격(결함 의심·연결 사정·환경)으로 나눠 보냅니다. `version`은 게임 결함도 연결 사정도 아니라 이 두 사람의 버전 조합 문제라 `unsupported`로 둡니다. v0.15.6~0.15.7 빌드는 같은 지점을 `error:<kind>:fail`로 보냈습니다(D1에는 원본 그대로 남음). 놀이가 계속되는 실패(소리·저장·보상·PWA)와 부팅 실패(지표 생성 전)는 보내지 않습니다.

경기 기록은 `match`(도장깨기·AI 대전)·`local`(2인)·`online` 경기가 끝날 때 하나씩 남깁니다(관전·연습 제외). rollback `RoomSession`의 `recordReplay` 기록(`SessionReplayRecorder`)이라 같은 게임 버전에서 `playReplay`로 다시 계산할 수 있습니다. 온라인은 예측한 끝이 확정된 뒤에 남기고, 두 사람이 같은 `matchId`(`방 세션:roster 세대:그 세대의 순번`)를 보내 한 행만 남습니다.

| summary 키     | 뜻                                                          |
| -------------- | ----------------------------------------------------------- |
| `winner`       | 이긴 팀(0 홈, 1 원정)                                       |
| `sets`·`score` | 끝난 순간의 세트·점수                                       |
| `ticks`        | 경기 시뮬레이션 tick(60Hz)                                  |
| `seed`         | 경기 변주 시드(`state.seed`). 기록의 시드는 세션 시드입니다 |
| `schoolId`     | `match`만: 도장깨기 상대 학교, AI 대전은 `null`             |
| `localTeam`    | `online`만: 보낸 사람의 팀                                  |

## 검사

```powershell
npm run check                 # 문법·소스 링크·GameKit 고정 참조
npm run verify:dependencies   # 실제 CDN 모듈 해시 확인
npx playwright install chromium
npm test                      # 서버·브라우저 시작부터 종료까지 자동 실행
```

`npm test`는 클럽 이름 변경·저장·새로고침 복구 → AI 경기 시작·퇴장 → 훈련 → 친구 초대·실제 WebRTC 입장 → 연결 단절·재접속 → 양쪽 새로고침 → 명시적 퇴장을 확인합니다. 물리·전송을 mock으로 대체하지 않습니다. 모바일 흐름은 터치 이동·점프·킥 동시 조작, 입력 해제, 화면 회전, 작은 화면 배치, 연습의 아군 토스 반복을 추가로 확인합니다. Windows Chromium 에뮬레이션이며 실물 휴대폰 검증과 구별합니다. 관찰에는 기존 런타임 진단과 같은 확정 경계의 해시를 사용하며 게임 상태를 강제로 종료 상태로 바꾸지 않습니다. 두 흐름 모두 지표 요청을 가로채(운영 서버로 보내지 않음) 행동 이벤트를 확인하고, 진행 중인 경기 기록(온라인은 재접속 구간 포함)을 새 게임에서 다시 계산해 같은 hash인지 봅니다. 경기 끝 기록은 한 판이 길어 이 흐름에 넣지 않습니다.

구조만 바꾸는 변경은 확인용 주소 장면을 두 체크아웃에서 열어 전후를 비교합니다. `node scripts/debug-scene.mjs "scene=watch&seed=1252&tick=844" --compare <기준 체크아웃>`이 같은 주소를 헤드리스 Chromium(SwiftShader, 1280x720)으로 두 번 열어 `__bloomDebug.state()`의 tick·점수와 장면 `hash()`(경기 전체 상태 `game.save()` 코덱 바이트의 FNV-1a)를 표로 냅니다. `--capture out.png`는 캡처(비교 쪽은 `out-compare.png`), `--ticks N`은 준비 뒤 N틱을 더 진행합니다. 실행기는 gamekit debug-tools의 `runDebugScene`(`scripts/vendor/gamekit/debug-scene.mjs`, `gamekit.lock.json`의 `tools`에 고정)이고 판정하지 않는 도구라 `npm test`에 넣지 않습니다. 주소에 항상 `debug=1`이 붙어 격리 장면(메모리 저장·지표 미전송)으로만 열립니다.

실행 구성은 `playwright.config.js`입니다. Playwright 전체 제한 170초와 시작/정리를 포함한 외부 상한 180초를 사용하며 초과는 실패입니다. 긴 전체 경기 종료 관찰을 이 기본 흐름의 성공으로 주장하지 않습니다. 결과·스크린샷은 `artifacts/e2e/`에 저장합니다. 성능/부하 측정은 이 버그 검사와 분리합니다. 정책 원문은 [검증 정책 §13](https://github.com/byh-playground/bloom-reference/blob/main/rules/project-management.html#verification)을 따릅니다.

## 원본 실행·배포

`index.html`, `src/`, `styles/`를 같은 소스 스냅샷의 상대 경로로 제공합니다. 생성·번들링·변환 빌드나 별도 dist 산출물은 없습니다. GitHub Pages도 소스 파일을 그대로 제공합니다. GameKit은 `gamekit.lock.json`과 HTML import map의 고정 CDN 링크로 불러옵니다.

itch.io 웹 제출용 zip만 예외로 `npm run build:itch`가 만듭니다. 원본을 복사하고 CDN 의존을 zip 안 `vendor/`에 넣은 별도 산출물이며 원본은 바꾸지 않습니다([itch 제출 문서](docs/itch.md)).

Pages 소스는 `main /`입니다. [태그 워크플로](.github/workflows/game-release-tags.yml)는 공통 워크플로를 불변 커밋으로 참조하고, main 푸시마다 `nightly-YYYYMMDDTHHMMSSZ-SHA12` 태그를 자동 발행합니다. Nightly는 개발 채널이며 정상 실행을 보장하지 않습니다. Stable 태그는 검증·승인을 마친 전체 커밋 SHA와 제품 버전을 수동 실행에 명시해 발행합니다. 기존 태그는 이동하지 않으며 main 배포가 Stable을 자동 승격하지 않습니다. 상세 계약은 [관리 규칙 §8.1](https://github.com/byh-playground/bloom-reference/blob/main/rules/project-management.html#tag-preview)을 따릅니다.

제품 버전은 [관리 규칙 §2](https://github.com/byh-playground/bloom-reference/blob/main/rules/project-management.html#version)의 MAJOR=제품 세대, MINOR=비호환 변경, PATCH=호환 변경을 따릅니다. 문서·CI·순수 내부 정리는 버전을 유지합니다. 태그 날짜·커밋은 별도 제품 버전이 아닙니다.

재접속은 살아 있는 상대와 기존 탭의 sessionStorage(gamekit `save`의 방 복귀 레코드)가 필요합니다. 양쪽 동시 종료·상대가 없는 방의 복원을 보장하지 않습니다. 같은 PC의 데스크톱 검사 결과를 다른 OS·모바일·외부 NAT 환경으로 확대하지 않습니다.
