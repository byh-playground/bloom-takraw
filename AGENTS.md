# 블룸 발 배구 작업 안내

## 기준 원문

작업 전에 아래 규칙의 관련 절을 읽고 최신 원문과 사용자 지시를 적용한다. 규칙 전문을 프로젝트 문서에 복제하지 않는다.

- [공통 개발 규칙](https://github.com/byh-playground/bloom-reference/blob/main/rules/development.html)
- [AI 개발 규칙](https://github.com/byh-playground/bloom-reference/blob/main/rules/ai-development.html)
- [프로젝트 관리·검증 규칙](https://github.com/byh-playground/bloom-reference/blob/main/rules/project-management.html)
- UI 변경 시 [공통 UI/UX](https://github.com/byh-playground/bloom-reference/blob/main/rules/visual-ux.html)

## 이 저장소의 설정

- 개발 기준은 `C:\projects\bloom-takraw` 및 해당 Git 저장소의 작업 worktree다. 이전 임시 프로젝트는 삭제됐으며 실행/검사 의존성이 아니다.
- 저장소는 `byh-playground/bloom-takraw`, PR 대상은 `main`, 작업 브랜치는 `codex/` 접두사를 쓴다. 독립 worktree에서 수정하며 검증을 마친 PR은 별도 승인을 묻지 않고 머지한다.
- 원본은 `index.html` + `src/` + `styles/`다. `npm run dev`로 HTTP 실행한다. 배포 파일 생성·번들링 단계는 없다.
- 공통 기능은 `bloom-gamekit`의 기능 소유 모듈에서 직접 import한다. 핀은 `gamekit.lock.json`과 import map으로 관리한다. 게임 규칙·Rapier 어댑터·콘텐츠·표시는 이 저장소가 소유한다.
- 검사 명령은 `npm run check`, `npm test`, `npm run verify:dependencies`다. 고정 사용자 흐름은 `tests/user-flow.spec.js`, 결과는 Git 제외 `artifacts/e2e/`에 있다. 검증 범위와 미실행을 구별해 PR에 기록한다.
- 구조와 상태 소유권은 `docs/architecture.md`, 실행 방법은 `README.md`, 과거 실행 결과는 `docs/verification/`을 따른다.
- 공개 Pages는 `main /` 원본을 상시 배포한다. main 머지는 공개 게임에도 반영되며 별도 release 브랜치 승격 절차를 두지 않는다.
- 버전과 채널은 공통 관리 규칙 §2·§8.1을 따른다. 제품 세대는 MAJOR, 비호환 변경은 MINOR, 호환 변경은 PATCH이며 문서·CI·순수 내부 정리는 버전을 유지한다. main 푸시는 고정 커밋으로 참조한 공통 워크플로가 Nightly 태그를 발행한다. Stable은 검증·승인한 커밋에 불변 태그로 명시적으로 승격하며 Pages 배포만으로 Stable로 간주하지 않는다.
- 문서와 커밋은 한국어로 작성한다.
