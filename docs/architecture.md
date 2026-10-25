# 모듈과 소유권

`index.html`은 `styles/app.css`와 `src/main.js`를 로드합니다. main은 로딩 표시 후 runtime을 가져오므로 로컬/CDN 모듈 실패도 화면에서 안내합니다. runtime은 GameKit 공개 API를 직접 import하며 세션·입력·표현 수명주기를 연결합니다. 공통 API를 재집계하는 wrapper는 없습니다.

| GameKit 소유 모듈 | 사용하는 공개 API | 게임에서 제공하는 부분 |
| --- | --- | --- |
| input | ActionState, createDOMInput | 키/포인터 매핑과 6바이트 입력 |
| simloop | createLoop, createDeadlineScheduler | 60TPS 정책·진행/관찰 조건 |
| rollback | createRoomSession, profiles | save/load/step/validateSnapshot 및 membership 어댑터 |
| transport | createNostrDynamicRoom | 방 UI·재접속 정책·탭 저장소 |
| deterministic | createValueCodec | 게임/물리 상태의 값 구조 |
| interpolation | PresentationRuntime, RenderObject | 신체 pose와 생명주기 바인딩 |
| presentation-events | PresentationEventQueue | 확정 경기 이벤트와 표현 정책 |
| audio | AudioPlayer | 소리 정의·음량·동시 재생 한도 |

별칭은 `@bloom-gamekit/<모듈>`입니다. 정확한 배포 URL과 SHA-256은 `gamekit.lock.json`을 따릅니다. HTML import map은 브라우저의 별칭 해석만 수행하며 `npm test`가 lock과 일치를 확인합니다. `npm run verify:dependencies`는 원격 파일 바이트를 대조합니다. 버전 업데이트는 lock과 import map을 함께 고치고 공개 계약과 브라우저 결과를 확인합니다. 현재 외부 요청은 기존과 같은 10개 모듈이며, 분리로 로컬 JS 12개와 CSS 1개 요청이 추가됩니다.

`simulation/game.js`는 규칙·AI·득점·세트·훈련·스냅샷 메타데이터를 소유합니다. `simulation/physics.js`는 Rapier World·몸체·관절·접촉·신체 제어와 물리 스냅샷을 소유합니다. 복원용 SerializationPipeline은 physics 인스턴스가 생성·재사용·해제합니다. 모션 데이터/모델/매칭은 `motion/`에 있는 게임별 저작 자료입니다.

`club/club.js`는 선수·편성·보상과 영속 데이터를, `presentation/view.js`는 Three.js 장면·카메라·표시 자원을, `presentation/ui.js`는 DOM·화면 전환·접근성·설정을 소유합니다. 게임 고유 Three.js 카메라와 라우팅 정책을 다른 GameKit 모듈로 교체하는 변경은 이번 구조 전환에 포함하지 않습니다.

의존 방향은 config/data → motion/club → physics → game → UI, runtime → 각 소유자입니다. runtime의 `BodyPose`는 기존처럼 한 boot 인스턴스의 클로저 상태입니다. 변경 가능한 전역으로 분리하지 않습니다. `window.__takraw` 진단/검사 진입점을 유지합니다.

`scripts/dev-server.cjs`는 원본을 JS/CSS MIME으로 제공합니다. 상대 경로이므로 `/bloom-takraw/` 같은 하위 경로도 지원합니다. 배포 파일 생성·번들링·변환은 없으며 소스 스냅샷을 그대로 사용합니다.

## 런타임 상태의 소유권

런타임의 `setNetwork`가 연결 표시 snapshot의 유일한 writer입니다. 로그 추가도 같은 경계를 통과합니다. UI는 전달받은 frozen snapshot을 읽고 표시하며 별도 부분 병합이나 연결 판정을 하지 않습니다. handshake, warning, retry 등의 수명주기 상태는 런타임의 `connection` 아래에 모으고 밀리초 단위를 leaf 이름에 표시합니다.

부팅 진행은 `bootstrapStage`가 소유합니다. 준비 여부는 이 단계에서 파생하고 시작 가능 여부는 `canStart(mode)`가 클럽 상태와 실행 오류를 함께 판단합니다. 버튼 표시와 실행 명령이 같은 정책을 사용합니다. UI는 안내 문구가 비었는지로 준비 여부를 추측하지 않습니다. 일시 정지·실행 오류·종료는 서로 다른 개념이므로 하나의 거대 enum으로 합치지 않습니다.

연결 정비는 기존 GameKit deadline pump에서 실행하며 80ms 간격 제한과 1초 재연결 제한을 유지합니다. `renderScene`은 연결 생성·종료·재연결을 실행하지 않습니다. 물리/AI 주기, 게임 상태 저장 형식은 변경하지 않았습니다. 페이지 복귀 시 reload하는 pageshow 리스너는 게임 인스턴스 종료 후 BFCache 복귀를 처리해야 하므로 페이지 수명주기에 남습니다.

선수 상태명은 HUD 생성 시 한 번 해석한 결과를 UI가 그대로 표시합니다. HTML의 대화상자는 빈 골격이며, 저장된 클럽 화면 사본을 포함하지 않습니다. 클럽 상태는 club owner의 현재 조회 결과로만 표시합니다.

규칙 근거는 [bloom-reference 개발 규칙](https://github.com/byh-playground/bloom-reference/blob/main/rules/development.html)의 SSOT·단일 소유권·CQS·Lifecycle·DRY입니다. 정책 자체의 원문은 reference 저장소가 소유합니다.
