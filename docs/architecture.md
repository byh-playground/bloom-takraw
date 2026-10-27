# 모듈과 소유권

`index.html`은 `styles/app.css`와 `src/main.js`를 로드합니다. main은 로딩 표시 후 runtime을 가져오므로 로컬/CDN 모듈 실패도 화면에서 안내합니다. runtime은 GameKit 공개 API를 직접 import하며 세션·입력·표현 수명주기를 연결합니다. 공통 API를 재집계하는 wrapper는 없습니다.

| GameKit 소유 모듈 | 사용하는 공개 API | 게임에서 제공하는 부분 |
| --- | --- | --- |
| input | ActionState, createDOMInput | 키/포인터 매핑과 6바이트 입력 |
| simloop | createLoop, createDeadlineScheduler | 60TPS 정책·진행/관찰 조건 |
| rollback | createRoomSession, profiles | save/load/step/validateSnapshot 및 membership 어댑터 |
| transport | createNostrDynamicRoom | 방 UI·재접속 정책·탭 저장소 |
| deterministic | createValueCodec, SeededPRNG, statelessRandom | 게임/물리 상태의 값 구조, 접촉 효과 입자 방향의 시드 난수 |
| interpolation | PresentationRuntime, RenderObject | 신체 pose와 생명주기 바인딩 |
| presentation-events | PresentationEventQueue | 확정 경기 이벤트와 표현 정책, 접촉 효과의 start·update·reconcile·stop |
| object-pool | ObjectPool | 접촉 효과 노드 재사용 |
| audio | AudioPlayer | 소리 정의·음량·동시 재생 한도 |

별칭은 `@bloom-gamekit/<모듈>`입니다. 정확한 배포 URL과 SHA-256은 `gamekit.lock.json`을 따릅니다. HTML import map은 브라우저의 별칭 해석만 수행하며 `npm test`가 lock과 일치를 확인합니다. `npm run verify:dependencies`는 원격 파일 바이트를 대조합니다. 버전 업데이트는 lock과 import map을 함께 고치고 공개 계약과 브라우저 결과를 확인합니다. 현재 외부 요청은 GameKit 9개와 Three.js·Rapier를 합친 11개이며, 로컬 JS 14개와 CSS 1개 요청이 추가됩니다.

`simulation/game.js`는 규칙·AI·득점·세트·훈련·스냅샷 메타데이터를 소유합니다. `simulation/physics.js`는 Rapier World·몸체·관절·접촉·신체 제어와 물리 스냅샷을 소유합니다. 복원용 SerializationPipeline은 physics 인스턴스가 생성·재사용·해제합니다. 모션 데이터/모델/매칭은 `motion/`에 있는 게임별 저작 자료입니다. `simulation/timing.js`의 `TakrawTimingJudge`는 점프·발차기 입력의 타이밍 오차 공식과 등급 창(`config.timing`)을 소유합니다. 기록은 `state.timing`에 두어 스냅샷·롤백에 함께 저장되며, 연습의 오차 기록과 접촉 판정이 같은 공식을 씁니다.

`club/club.js`는 선수·편성·보상과 영속 데이터를, `presentation/view.js`는 Three.js 장면·카메라·표시 자원을, `presentation/ui.js`는 DOM·화면 전환·접근성·설정을 소유합니다. `presentation/impact.js`의 `TakrawImpactEffects`는 접촉 효과(링·입자·진동량·공 강조)를 소유하며 view가 포함합니다. 게임 고유 Three.js 카메라와 라우팅 정책을 다른 GameKit 모듈로 교체하는 변경은 이번 구조 전환에 포함하지 않습니다.

의존 방향은 config/data → motion/club → physics → game → UI, runtime → 각 소유자입니다. runtime의 `BodyPose`는 기존처럼 한 boot 인스턴스의 클로저 상태입니다. 변경 가능한 전역으로 분리하지 않습니다. `window.__takraw` 진단/검사 진입점을 유지합니다.

`scripts/dev-server.cjs`는 원본을 JS/CSS MIME으로 제공합니다. 상대 경로이므로 `/bloom-takraw/` 같은 하위 경로도 지원합니다. 배포 파일 생성·번들링·변환은 없으며 소스 스냅샷을 그대로 사용합니다.

## 런타임 상태의 소유권

런타임의 `setNetwork`가 연결 표시 snapshot의 유일한 writer입니다. 로그 추가도 같은 경계를 통과합니다. UI는 전달받은 frozen snapshot을 읽고 표시하며 별도 부분 병합이나 연결 판정을 하지 않습니다. handshake, warning, retry 등의 수명주기 상태는 런타임의 `connection` 아래에 모으고 밀리초 단위를 leaf 이름에 표시합니다.

부팅 진행은 `bootstrapStage`가 소유합니다. 준비 여부는 이 단계에서 파생하고 시작 가능 여부는 `canStart(mode)`가 클럽 상태와 실행 오류를 함께 판단합니다. 버튼 표시와 실행 명령이 같은 정책을 사용합니다. UI는 안내 문구가 비었는지로 준비 여부를 추측하지 않습니다. 일시 정지·실행 오류·종료는 서로 다른 개념이므로 하나의 거대 enum으로 합치지 않습니다.

연결 정비는 기존 GameKit deadline pump에서 실행하며 80ms 간격 제한과 1초 재연결 제한을 유지합니다. `renderScene`은 연결 생성·종료·재연결을 실행하지 않습니다. 물리/AI 주기, 게임 상태 저장 형식은 변경하지 않았습니다. 페이지 복귀 시 reload하는 pageshow 리스너는 게임 인스턴스 종료 후 BFCache 복귀를 처리해야 하므로 페이지 수명주기에 남습니다.

선수 상태명은 HUD 생성 시 한 번 해석한 결과를 UI가 그대로 표시합니다. HTML의 대화상자는 빈 골격이며, 저장된 클럽 화면 사본을 포함하지 않습니다. 클럽 상태는 club owner의 현재 조회 결과로만 표시합니다.

규칙 근거는 [bloom-reference 개발 규칙](https://github.com/byh-playground/bloom-reference/blob/main/rules/development.html)의 SSOT·단일 소유권·CQS·Lifecycle·DRY입니다. 정책 자체의 원문은 reference 저장소가 소유합니다.

## 접촉 타이밍 효과의 경계

시뮬레이션은 사람 선수의 공중 발 접촉마다 `timing: { grade, error }`를 접촉 이벤트에 싣습니다. 등급 창은 `config.timing`, 효과 값은 `config.visual.impact`, 소리는 `config/runtime.js`의 `kick`·`kickGood`·`kickPerfect`가 소유합니다. 표시 계층은 이 이벤트를 받아 모양만 정하며 시뮬레이션 시간과 공의 움직임을 바꾸지 않습니다.

runtime의 `contact` 어댑터는 `presentation-events`의 `start`·`update(handle, ageMs)`·`reconcile`·`stop`에 `TakrawImpactEffects`를 연결합니다. 효과 모양은 저널이 주는 경과 시간의 함수이고 입자 방향은 접촉 이벤트의 `tick`·`sequence`에서 만든 시드 난수입니다. 따라서 롤백 재확정에서 효과가 처음부터 다시 시작하지 않고, 두 피어가 같은 모양을 그립니다. 등급 표시(`#timing-badge`)는 같은 이벤트 수명에 묶여 있고 `ui.showTiming`이 돌려준 토큰으로만 지워집니다.

## 학습 모듈의 경계

`src/learning/core/`는 게임을 모르는 범용 강화학습이다. 정책은 층(`DenseLayer`)을 조합하고 `Quantizable` 믹스인으로 양자화 저장을 얻는다. `Algorithm`(sample·update·actor)은 `Reinforce`, 이를 상속한 `ActorCritic`, 그리고 `Dqn`이 구현한다. 과제는 `Task.rollout(seed, chooseAction)`으로 전이 `{obs, action, reward, nextObs, done}`를 돌려준다.

`src/learning/takraw/`는 게임 전용이다. `TAKRAW_TUNING`이 조정 값의 이름·범위를 정의하고 기본값은 `config`와 `physics.settings`에서 읽는다(SSOT). `ReceiveObservation`이 정책 입력의 유일한 인코더이고, `ReceiveTask`가 스파이크 리시브 장면과 판정을 소유한다. 장면마다 새 게임을 만든다.

경기와의 접점은 `game.setTuning(team, values)`뿐이다. 조정 값은 팀별 `game.tuning`에 두고 `save`·`load`·`validate`가 포함한다. 물리에 영향을 주는 값(`contactHeight`, `strokeTime`, `attackApex`)은 `physics.setTossTuning`이 팀별 설정 사본으로 반영한다. 조정이 없으면 기본 설정 객체를 그대로 쓴다. 정책 추론은 사칙연산만 쓰는 활성 함수(`x / (1 + |x|)`)로 구현해 엔진이 달라도 같은 값을 내도록 했다. 저장은 4비트 양자화한 가중치의 base64이며 `PolicyStore`가 다룬다.

v0.12.13~15에는 유저 기능에 연결되었고 v0.12.16에서 화면과 경기 연결을 제거했다(아래는 연결 당시의 설계이며 복구 방법은 docs/learning-tobe.md). 접점이 하나 더 늘었다: `game.setTuner(team, fn)`. 상대가 스파이크를 칠 때마다 공이 반응한 뒤(`applyTuner`) 착지 예상 지점에 가장 가까운 팀 선수 기준으로 `fn(game, playerId)`를 불러 `setTuning`에 넘긴다. 학습 한 번의 규칙(비용·epoch 수·정책 최대 길이)은 `TAKRAW_CLUB_RULES.learning`이 유일한 정의이고, 학습 결과는 클럽 레코드의 선택 필드 `learning: { runs, policy(base64 양자화) }`에 저장한다. `TeammateLearning`(`src/learning/teammate.js`)이 학습·평가·저장 형식 변환·경기용 조정기를 소유하고, 런타임은 학습을 마친 뒤에만 `club.learn()`을 호출한다. 로컬 AI 대전(`mode === 'match'`)의 우리 팀에만 적용하고 온라인에는 쓰지 않는다. 학습은 받는 첫 접촉만 다뤘으므로 조정은 그 접촉(또는 득점)까지만 유지하고 `releaseTuning`이 기본값으로 되돌린다.

