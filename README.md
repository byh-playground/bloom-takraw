# 블룸 발 배구

블룸 세계관의 3D 온라인 발 배구 게임입니다. 개발 저장소는 `C:\projects\bloom-takraw`, 원격은 [byh-playground/bloom-takraw](https://github.com/byh-playground/bloom-takraw)입니다. 기존 rally-frontier 임시 검증 사본은 삭제됐습니다.

이름: 게임 이름은 `src/config/game.js`의 `TAKRAW_GAME_NAME`(발 배구)이 단일 출처이고 `npm run check`가 `index.html`·README·AGENTS·`package.json`과의 일치를 검사합니다. 저장소·패키지 이름 `bloom-takraw`, `TAKRAW_*`·`Takraw*` 식별자, `window.__takraw`, 저장 키, `docs/verification/v0.12.7`의 당시 산출물 기록은 바꾸지 않았습니다(이름이 아니라 식별자·이력이라서).

- [공개 게임](https://byh-playground.github.io/bloom-takraw/)은 `main /`의 원본을 상시 배포합니다.
- `main`은 개발·배포 기준입니다. PR이 main에 머지되면 공개 게임에도 반영되며 별도 release 브랜치를 갱신하지 않습니다.
- 개발 기준은 [bloom-reference 개발 규칙](https://github.com/byh-playground/bloom-reference/blob/main/rules/development.html), [AI 개발 규칙](https://github.com/byh-playground/bloom-reference/blob/main/rules/ai-development.html), [프로젝트 관리 규칙](https://github.com/byh-playground/bloom-reference/blob/main/rules/project-management.html)입니다. 정책 전문을 이 저장소에 복제하지 않습니다.
- [최신 모바일·연습 검증](docs/verification/mobile-training.md)과 [과거 기록](docs/verification/README.md)을 구별합니다. 검증 기록만으로 Stable 승격이나 배포 완료를 뜻하지 않습니다.

## 실행

Node.js 22 이상에서 다음을 실행하고 `http://127.0.0.1:8766/`를 엽니다.

```powershell
npm ci
npm run dev
```

`index.html`은 화면 골격이며 CSS와 ES 모듈을 링크합니다. **HTML을 더블클릭하는 file:// 실행은 지원하지 않습니다.** GameKit·Three.js·Rapier를 고정 CDN URL에서 가져오므로 처음 실행과 온라인 연결에 인터넷이 필요합니다. 이웃 저장소나 이전 임시 경로를 런타임에서 읽지 않습니다.

## 구조와 GameKit 참조

```text
index.html                   화면 골격, CSS/JS 링크, import map
gamekit.lock.json             GameKit 배포 커밋·파일 URL·SHA-256
src/
  main.js                    로딩/오류 화면과 부팅
  runtime.js                 게임과 GameKit의 수명주기 연결
  config/{game,runtime}.js    게임 정의와 실행 정책
  club/club.js               선수·편성·보상·IndexedDB 저장
  motion/{data,model,matcher}.js  게임 고유 모션 자료와 매칭
  simulation/{game,physics,timing}.js  경기 규칙, Rapier 어댑터, 입력 타이밍 판정
  learning/                  규칙 AI 조정 값 강화학습(core: 범용, takraw: 게임 전용)
  presentation/{view,ui,impact,field-effects}.js  Three.js 표시, DOM UI, 접촉·착지·득점 효과
styles/app.css               화면 스타일
scripts/                     원본 HTTP 서버·정적 참조·의존성 검사
playwright.config.js         사용자 시나리오 실행 구성
tests/{user-flow,mobile-flow}.spec.js  고정 사용자 흐름 E2E
docs/                        구조 설명과 보존 검증 기록
artifacts/                   새 실행 결과, Git 제외
```

공통 기능의 원본은 사용자 소유 [bloom-gamekit](https://github.com/byh-playground/bloom-gamekit)입니다. `runtime.js`는 `import { createRoomSession } from '@bloom-gamekit/rollback'`처럼 기능 소유 모듈에서 직접 가져옵니다. HTML import map이 별칭을 고정 배포 URL로 해석합니다. GameKit 소스를 복사하거나 별도 공통 엔진으로 감싸지 않습니다.

GameKit dist 커밋 `4db872aaba543010424ca2200b134181b246336c`(소개영상용 `scenario` 모듈 포함), Three.js 0.180.0, Rapier 0.21.0를 씁니다. 책임 경계와 수정 위치는 [구조 문서](docs/architecture.md)를 참고하세요.

## 검사

```powershell
npm run check                 # 문법·소스 링크·GameKit 고정 참조
npm run verify:dependencies   # 실제 CDN 모듈 해시 확인
npx playwright install chromium
npm test                      # 서버·브라우저 시작부터 종료까지 자동 실행
```

`npm test`는 클럽 이름 변경·저장·새로고침 복구 → AI 플레이·일반 서브 수신 10회 중 80% 이상 3회 터치 스파이크·퇴장 → 훈련 → 친구 초대·실제 WebRTC 입장 → 연결 단절·재접속 → 양쪽 새로고침 → 명시적 퇴장을 확인합니다. 물리·전송을 mock으로 대체하지 않습니다. 모바일 흐름은 터치 이동·점프·킥 동시 조작, 입력 해제, 화면 회전, 작은 화면 배치, 연습의 아군 토스 반복을 추가로 확인합니다. Windows Chromium 에뮬레이션이며 실물 휴대폰 검증과 구별합니다. 관찰에는 기존 런타임 진단과 같은 확정 경계의 해시를 사용하며 게임 상태를 강제로 종료 상태로 바꾸지 않습니다.

실행 구성은 `playwright.config.js`입니다. Playwright 전체 제한 170초와 시작/정리를 포함한 외부 상한 180초를 사용하며 초과는 실패입니다. 긴 전체 경기 종료 관찰을 이 기본 흐름의 성공으로 주장하지 않습니다. 결과·스크린샷은 `artifacts/e2e/`에 저장합니다. 성능/부하 측정은 이 버그 검사와 분리합니다. 정책 원문은 [검증 정책 §13](https://github.com/byh-playground/bloom-reference/blob/main/rules/project-management.html#verification)을 따릅니다.

기존 단위·내부 비교·장시간 관찰 검사와 수동 CDP 실행기는 정리했습니다. 과거 실행 결과는 `docs/verification/`와 Git 이력에 남아 있으며 현행 검사 명령으로 안내하지 않습니다.

## 원본 실행·배포

`index.html`, `src/`, `styles/`를 같은 소스 스냅샷의 상대 경로로 제공합니다. 생성·번들링·변환 빌드나 별도 dist 산출물은 없습니다. GitHub Pages도 소스 파일을 그대로 제공합니다. GameKit은 `gamekit.lock.json`과 HTML import map의 고정 CDN 링크로 불러옵니다.

Pages 소스는 `main /`입니다. [태그 워크플로](.github/workflows/game-release-tags.yml)는 공통 워크플로를 불변 커밋으로 참조하고, main 푸시마다 `nightly-YYYYMMDDTHHMMSSZ-SHA12` 태그를 자동 발행합니다. Nightly는 개발 채널이며 정상 실행을 보장하지 않습니다. Stable 태그는 검증·승인을 마친 전체 커밋 SHA와 제품 버전을 수동 실행에 명시해 발행합니다. 기존 태그는 이동하지 않으며 main 배포가 Stable을 자동 승격하지 않습니다. 상세 계약은 [관리 규칙 §8.1](https://github.com/byh-playground/bloom-reference/blob/main/rules/project-management.html#tag-preview)을 따릅니다.

제품 버전은 [관리 규칙 §2](https://github.com/byh-playground/bloom-reference/blob/main/rules/project-management.html#version)의 MAJOR=제품 세대, MINOR=비호환 변경, PATCH=호환 변경을 따릅니다. 문서·CI·순수 내부 정리는 버전을 유지합니다. 이번 배포 운영 변경도 기존 제품 버전 `0.12.9`를 유지하며, 태그 날짜·커밋은 별도 제품 버전이 아닙니다.

재접속은 살아 있는 상대와 기존 탭의 sessionStorage(gamekit `save`의 방 복귀 레코드)가 필요합니다. 양쪽 동시 종료·상대가 없는 방의 복원을 보장하지 않습니다. 같은 PC의 데스크톱 검사 결과를 다른 OS·모바일·외부 NAT 환경으로 확대하지 않습니다.
