# 블룸 세팍타크로 작업 안내

- 사용자 결정(2026-10-25): 대화의 앱 프로젝트와 관계없이 개발 기준은 `C:\projects\bloom-takraw` 및 이 저장소의 작업 worktree다. 명령에 실제 작업 디렉터리를 명시한다.
- 이전 rally-frontier 임시 검증 사본은 삭제됐다. 이웃 저장소의 파일을 게임 실행이나 검사 전제 조건으로 사용하지 않는다.
- 저장소는 `byh-playground/bloom-takraw`, 공개 게임은 `https://byh-playground.github.io/bloom-takraw/`다.
- 시작 전에 `README.md`와 `docs/architecture.md`를 읽는다. 기존 기록은 `docs/verification/v0.12.7/`, 새 검사 출력은 Git 제외 `artifacts/verification/`에 있다.
- 개발 원본은 `index.html` + `src/` + `styles/`다. HTML은 골격과 링크를 소유하며 JS·CSS를 다시 인라인으로 합치지 않는다. HTTP 서버로 실행한다.
- 공통 입력·실행·보간·전송·롤백·결정론·효과음·표현 이벤트는 `bloom-gamekit`의 기능 소유 모듈을 직접 import한다. GameKit 소스를 복사하거나 같은 공통 기능을 별도로 구현하지 않는다. 게임 규칙·Rapier 어댑터·화면·콘텐츠는 이 저장소가 소유한다.
- GameKit 버전/URL/해시는 `gamekit.lock.json`과 HTML import map에서 함께 관리한다. branch-latest URL은 쓰지 않는다. 버전 변경 시 원격 파일 해시 및 브라우저 검사를 수행한다.
- 실제 UI 실행을 정적 검사로 대체하지 않는다. 온라인 변경은 독립 브라우저 두 개의 실제 RTC 입장·동일 확정 경계 해시·재접속을 확인한다. Rapier는 수신 바이트 캐시만 비교하지 말고 복원 후 진행 결과와 자원 해제를 확인한다.
- 작업은 `codex/` 브랜치와 별도 worktree에서 수행하고 `main` 대상 PR로 리뷰한다. 다른 작업과 미커밋 변경을 보존한다. 명시적 지시 없이 PR을 머지하지 않는다.
- `release /`는 GitHub Pages 공개 배포 소스다. 공개 배포는 별도 사용자 지시에 따른다. `npm run build`는 로컬 파일 구성만 수행한다.
- 한국어로 커밋과 작업 결과를 작성하고 실제 검증·미검증 범위를 구별한다.
