# 블룸 세팍타크로

블룸 세계관의 3D 온라인 세팍타크로 게임입니다. 개발 저장소는 `C:\projects\bloom-takraw`, 원격은 [byh-playground/bloom-takraw](https://github.com/byh-playground/bloom-takraw)입니다. 기존 rally-frontier 임시 검증 사본은 삭제됐습니다.

- [공개 게임](https://byh-playground.github.io/bloom-takraw/)은 `release /` 브랜치로 배포합니다.
- `main`은 개발 기준입니다. 작업 브랜치의 변경을 공개 배포하려면 별도 배포 지시가 필요합니다.
- [기존 검증 기록](docs/verification/v0.12.7/REPORT.md)과 [모듈 전환 검증](docs/verification/module-refactor.md)을 구별합니다. 모든 환경의 Stable을 의미하지 않습니다.

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
  simulation/{game,physics}.js    경기 규칙과 Rapier 어댑터
  presentation/{view,ui}.js       Three.js 표시와 DOM UI
styles/app.css               화면 스타일
scripts/                     HTTP 서버·배포 파일 구성·의존성 검사
tests/browser/               실제 브라우저 검증
docs/                        구조 설명과 보존 검증 기록
artifacts/                   새 실행 결과, Git 제외
dist/                        배포 파일 묶음, Git 제외
```

공통 기능의 원본은 사용자 소유 [bloom-gamekit](https://github.com/byh-playground/bloom-gamekit)입니다. `runtime.js`는 `import { createRoomSession } from '@bloom-gamekit/rollback'`처럼 기능 소유 모듈에서 직접 가져옵니다. HTML import map이 별칭을 고정 배포 URL로 해석합니다. GameKit 소스를 복사하거나 별도 공통 엔진으로 감싸지 않습니다.

기존 검증에 사용한 GameKit dist 커밋 `9bcb2b20fc7c227553317ae31b8fb400437047eb`, Three.js 0.180.0, Rapier 0.21.0을 유지합니다. 책임 경계와 수정 위치는 [구조 문서](docs/architecture.md)를 참고하세요.

## 검사

```powershell
npm test                       # import 연결·MIME·배포 구성
npm run verify:dependencies     # 원격 GameKit 파일 해시
npx playwright install chromium
npm run qa:launch              # 서버와 독립 Chromium 창 두 개
# 별도 터미널에서
npm run verify:refactor        # 원본/모듈/dist 동일 입력·복원 결과
npm run verify:checkpoint
npm run verify:network         # 입장·입력·RTC 단절·새로고침·재시도
npm run verify:finish          # 이어지는 온라인 경기 종료까지 관찰
npm run verify:single          # UI AI 경기 → 종료·보상
```

기본 QA 포트는 HTTP 8766, CDP 9331/9332입니다. `QA_BASE_URL`, `QA_HOST_PORT`, `QA_GUEST_PORT`, `QA_OUTPUT_DIR`로 바꿀 수 있습니다. `verify:refactor`는 Git의 고정 초기 커밋을 기준본으로 읽으므로 shallow checkout은 해당 커밋을 먼저 fetch해야 합니다. 새 결과는 `artifacts/verification/`에 생성되어 과거 증거를 덮지 않습니다. 소요 시간은 경기 진행에 따라 달라집니다.

## 배포 파일

`npm run build`는 `dist/`에 `index.html`, `src/`, `styles/`, `.nojekyll`, 파일별 해시 manifest를 구성합니다. 번들링·라이브러리 인라인·단일 HTML 재생성을 하지 않습니다. 배포 시 이 파일들을 같은 상대 경로로 함께 올려야 합니다. 저장소 루트를 Pages로 제공해도 동작합니다. **이 명령은 공개 배포를 실행하지 않습니다.**

재접속은 살아 있는 상대와 기존 탭의 sessionStorage가 필요합니다. 양쪽 동시 종료·상대가 없는 방의 복원을 보장하지 않습니다. 같은 PC의 데스크톱 검사 결과를 다른 OS·모바일·외부 NAT 환경으로 확대하지 않습니다.
