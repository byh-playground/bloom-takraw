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

`club/club.js`는 선수·편성·보상과 영속 데이터를, `presentation/view.js`는 Three.js 장면·카메라·표시 자원을, `presentation/ui.js`는 DOM·화면 전환·접근성·설정을 소유합니다. `simulation/ai-brain.js`는 AI 선수 한 명의 행동 상태머신(대기·보조·받기·공격·세트·추격)과 선수 성향(Temperament)을 소유하고, `game.js`의 `decideAI`가 매 AI 틱에 이를 호출해 목표 자리를 받습니다(킥·점프 타이밍은 game.js 책임). 상태는 `ai[id].brain` 순수 데이터라 스냅샷·롤백에 포함되고, 성향은 `state.seed`·선수·랠리 번호로만 정해집니다. `presentation/impact.js`의 `TakrawImpactEffects`는 접촉 효과(링·입자·접점 섬광·속도선·진동량·화면 확대·공 눌림·궤적 강조)를, `presentation/field-effects.js`의 `TakrawFieldEffects`는 착지 먼지와 득점 색종이를 소유하며 view가 포함합니다. 게임 고유 Three.js 카메라와 라우팅 정책을 다른 GameKit 모듈로 교체하는 변경은 이번 구조 전환에 포함하지 않습니다.

의존 방향은 config/data → motion/club → physics → game → UI, runtime → 각 소유자입니다. runtime의 `BodyPose`는 기존처럼 한 boot 인스턴스의 클로저 상태입니다. 변경 가능한 전역으로 분리하지 않습니다. `window.__takraw` 진단/검사 진입점을 유지합니다.

`scripts/dev-server.cjs`는 원본을 JS/CSS MIME으로 제공합니다. 상대 경로이므로 `/bloom-takraw/` 같은 하위 경로도 지원합니다. 배포 파일 생성·번들링·변환은 없으며 소스 스냅샷을 그대로 사용합니다.

## 런타임 상태의 소유권

런타임의 `setNetwork`가 연결 표시 snapshot의 유일한 writer입니다. 로그 추가도 같은 경계를 통과합니다. UI는 전달받은 frozen snapshot을 읽고 표시하며 별도 부분 병합이나 연결 판정을 하지 않습니다. handshake, warning, retry 등의 수명주기 상태는 런타임의 `connection` 아래에 모으고 밀리초 단위를 leaf 이름에 표시합니다.

부팅 진행은 `bootstrapStage`가 소유합니다. 준비 여부는 이 단계에서 파생하고 시작 가능 여부는 `canStart(mode)`가 클럽 상태와 실행 오류를 함께 판단합니다. 버튼 표시와 실행 명령이 같은 정책을 사용합니다. UI는 안내 문구가 비었는지로 준비 여부를 추측하지 않습니다. 일시 정지·실행 오류·종료는 서로 다른 개념이므로 하나의 거대 enum으로 합치지 않습니다.

연결 정비는 기존 GameKit deadline pump에서 실행하며 80ms 간격 제한과 1초 재연결 제한을 유지합니다. `renderScene`은 연결 생성·종료·재연결을 실행하지 않습니다. 물리/AI 주기, 게임 상태 저장 형식은 변경하지 않았습니다. 페이지 복귀 시 reload하는 pageshow 리스너는 게임 인스턴스 종료 후 BFCache 복귀를 처리해야 하므로 페이지 수명주기에 남습니다.

선수 상태명은 HUD 생성 시 한 번 해석한 결과를 UI가 그대로 표시합니다. HTML의 대화상자는 빈 골격이며, 저장된 클럽 화면 사본을 포함하지 않습니다. 클럽 상태는 club owner의 현재 조회 결과로만 표시합니다.

규칙 근거는 [bloom-reference 개발 규칙](https://github.com/byh-playground/bloom-reference/blob/main/rules/development.html)의 SSOT·단일 소유권·CQS·Lifecycle·DRY입니다. 정책 자체의 원문은 reference 저장소가 소유합니다.

## 접촉 타이밍 효과의 경계

시뮬레이션은 사람 선수의 공중 발 접촉마다 `timing: { grade, error }`를 접촉 이벤트에 싣습니다. 등급 창은 `config.timing`, 효과 값은 `config.visual.impact`, 소리는 `config/runtime.js`의 `kick`·`kickGood`·`kickPerfect`·`kickSpike`가 소유합니다. 스파이크 여부(`spike`)는 접촉 이벤트에 `game.js`가 한 번 판정해 싣고, 연출·소리·지표가 같은 값을 씁니다. 화면 흔들림은 px 단위로 가장 센 접촉 하나만 쓰며 `visual.shakeCap`을 넘지 않습니다. 스파이크는 친 팀 학교의 속성(`schools.js` `TAKRAW_ELEMENTS`)별 입자를 더하며, 설정은 `config.visual.impactElements`(속성별 입자 모양·개수·색·링 색·궤적 색, 합 40개 이하·수명 1.2초 이하)가 소유하고 뷰가 학교를 정할 때 `setElements`로 팀별 속성을 전달합니다. 속성 연출은 팀 색 점·속도선을 대신하고, 속성 연출 동안(`ballLife`) view가 공을 입자 위에 평면 원(밝은 공 색+어두운 테두리, 월드 크기 고정·깊이 검사)으로 다시 그리고 입자는 공 중심에서 `ballMargin` 밖에서 시작해 공이 가려지지 않으며, 입자는 채도 높은 중간 밝기 색과 어두운 테두리(`edge`, `rim` 배율)로 밝은 배경에서 윤곽이 보이게 하며 입자 배치는 tick·sequence 시드로 정하며, 모션 줄이기에서는 입자가 40%입니다. 표시 계층은 이 이벤트를 받아 모양만 정하며 시뮬레이션 시간과 공의 움직임을 바꾸지 않습니다.

runtime의 `contact` 어댑터는 `presentation-events`의 `start`·`update(handle, ageMs)`·`reconcile`·`stop`에 `TakrawImpactEffects`를 연결합니다. 효과 모양은 저널이 주는 경과 시간의 함수이고 입자 방향은 접촉 이벤트의 `tick`·`sequence`에서 만든 시드 난수입니다. 따라서 롤백 재확정에서 효과가 처음부터 다시 시작하지 않고, 두 피어가 같은 모양을 그립니다. 등급 표시(`#timing-badge`)는 같은 이벤트 수명에 묶여 있고 `ui.showTiming`이 돌려준 토큰으로만 지워집니다.

## 학습 모듈의 경계

`src/learning/core/`는 게임을 모르는 범용 강화학습이다. 정책은 층(`DenseLayer`)을 조합하고 `Quantizable` 믹스인으로 양자화 저장을 얻는다. `Algorithm`(sample·update·actor)은 `Reinforce`, 이를 상속한 `ActorCritic`, 그리고 `Dqn`이 구현한다. 과제는 `Task.rollout(seed, chooseAction)`으로 전이 `{obs, action, reward, nextObs, done}`를 돌려준다.

`src/learning/takraw/`는 게임 전용이다. `TAKRAW_TUNING`이 조정 값의 이름·범위를 정의하고 기본값은 `config`와 `physics.settings`에서 읽는다(SSOT). `ReceiveObservation`이 정책 입력의 유일한 인코더이고, `ReceiveTask`가 스파이크 리시브 장면과 판정을 소유한다. 장면마다 새 게임을 만든다.

경기와의 접점은 `game.setTuning(team, values)`뿐이다. 조정 값은 팀별 `game.tuning`에 두고 `save`·`load`·`validate`가 포함한다. 물리에 영향을 주는 값(`contactHeight`, `strokeTime`, `attackApex`)은 `physics.setTossTuning`이 팀별 설정 사본으로 반영한다. 조정이 없으면 기본 설정 객체를 그대로 쓴다. 정책 추론은 사칙연산만 쓰는 활성 함수(`x / (1 + |x|)`)로 구현해 엔진이 달라도 같은 값을 내도록 했다. 저장은 4비트 양자화한 가중치의 base64이며 `PolicyStore`가 다룬다.

v0.12.13~15에는 유저 기능에 연결되었고 v0.12.16에서 화면과 경기 연결을 제거했다(아래는 연결 당시의 설계이며 복구 방법은 docs/learning-tobe.md). 접점이 하나 더 늘었다: `game.setTuner(team, fn)`. 상대가 스파이크를 칠 때마다 공이 반응한 뒤(`applyTuner`) 착지 예상 지점에 가장 가까운 팀 선수 기준으로 `fn(game, playerId)`를 불러 `setTuning`에 넘긴다. 학습 한 번의 규칙(비용·epoch 수·정책 최대 길이)은 `TAKRAW_CLUB_RULES.learning`이 유일한 정의이고, 학습 결과는 클럽 레코드의 선택 필드 `learning: { runs, policy(base64 양자화) }`에 저장한다. `TeammateLearning`(`src/learning/teammate.js`)이 학습·평가·저장 형식 변환·경기용 조정기를 소유하고, 런타임은 학습을 마친 뒤에만 `club.learn()`을 호출한다. 로컬 AI 대전(`mode === 'match'`)의 우리 팀에만 적용하고 온라인에는 쓰지 않는다. 학습은 받는 첫 접촉만 다뤘으므로 조정은 그 접촉(또는 득점)까지만 유지하고 `releaseTuning`이 기본값으로 되돌린다.


## 학교 외형

`src/config/schools.js`가 학교 이름·Uniform(주색·보조색·하의·양말)·머리 3종·등번호의 단일 원본이다. 이름과 팔레트는 출시 전 임시안이다. 학교는 속성(풀·불·물·번개·달빛·햇빛·얼음·땅·바람·어둠) 10곳이며 외형만 다르고 난이도는 갖지 않는다. 내 학교는 저장 데이터를 처음 만들 때 한 번 무작위로 정해져 `campaign.home`에 저장되고(이전 저장본은 불러올 때 한 번 정함) 상대 목록에서 빠진다. 도전 단계(`TAKRAW_LADDER`, 9단계)가 AI 난이도와 첫 클리어 포인트를 정하고, `takrawOpponents(home)`가 로스터 순서대로 단계를 붙인다. runtime이 세션을 열 때 두 학교를 정하고 view에 전달한다. simulation은 학교 외형을 알지 않으며 저장과 입력 계약은 그대로다. 홈의 임시 상대 선택은 도장깨기 목록으로 대체할 예정이다. view는 등번호 CanvasTexture와 재질을 캐시하고 종료 시 해제한다. 학교 교체 시 선수 메시와 늘어나는 다리 geometry를 해제한 뒤 현재 pose로 재구성한다.

## AI 관전(시드 재생)

- 시드 하나가 AI 대 AI 경기 하나다. `game.reset('ai', undefined, seed)`에서 두 팀 모두 사람 입력이 없다(`game.js`의 `humans.fill(null)`). 팀·성향은 기본값이라 클럽 저장소를 읽거나 쓰지 않는다.
- 진입점은 둘이다. 주소 `?watch=<시드>`는 부팅 직후 바로 관전을 시작하고, 홈의 "AI 관전" 버튼은 마지막 시드(처음엔 소개영상 시드)로 시작한다. 관전 중 입력칸(`#watch-form`)에서 추천 경기(`TAKRAW_RUNTIME.watch.featured`) 선택, 시드 직접 입력, ◀ ▶ 이웃 시드, 랜덤, "처음부터 보기"를 쓴다. 콘솔에서는 `__takraw.watch(seed)`.
- 관전은 그 시드의 **첫 1점**만 보여준다. 득점 뒤 `loopHoldMs`(2.5초) 동안 결과를 보여주고 같은 시드를 처음부터 다시 연다. 다음 서브로 넘어가지 않는다. 소개영상도 같은 반복이다.
- 두 학교(화면의 속성·유니폼)는 `takrawWatchSchools(seed)`가 시드로만 정한다. 같은 시드는 같은 화면이다.
- 소개영상 시드는 `TAKRAW_RUNTIME.watch.showcaseSeed`(SSOT)다. `tests/watch.spec.js`가 이 시드의 터치 수(10)와 득점 틱(772, 팀 1), 사람 입력 유무와 무관한 재현성을 고정한다.
- 아슬아슬한 받아내기 후보는 시드를 일괄 시뮬레이션해 스파이크 직후 상대 터치의 낙하 여유 시간(공이 지면에 닿기까지 남은 시간)이 짧은 랠리로 골랐다.

## 소개영상(도움말 대체)

- 기존 도움말 대화상자는 없앴다. 헤더의 `?`와 홈의 "▶ 소개 보기"가 게임킷 `installShowcase`(`@bloom-gamekit/scenario`)를 연다. 주소 `#/showcase`로도 열린다.
- 호스트가 같은 주소의 격리 iframe(`?showcaseDemo=1`)을 만들고, 그 안의 게임이 관전 모드로 시드 36 랠리를 실제로 시뮬레이션한다. 영상이 아니라 실제 게임 화면이다.
- `?showcaseDemo=1`에서는 클럽 저장소(IndexedDB)를 열지 않고 sessionStorage 이어하기도 읽지 않으며, 메뉴·입력을 숨긴다(`body[data-showcase]`).
- 자막은 시간이 아니라 경기 틱에 맞춘다. `src/config/intro.js`가 자막과 틱의 SSOT, `intro-script.js`가 "틱까지 기다리기 → 자막 바꾸기" 항목을 만든다(호스트는 `custom`이 false를 돌려주면 재시도). 터치 화면은 조작 이름(좌클→발차기 버튼 등)을 바꿔 보여준다.
- 소개영상이 열려 있는 동안 뒤에서 진행 중이던 경기는 멈추고 닫으면 이어진다.
- 시드를 바꾸면 `intro.js`의 틱 표를 다시 맞춰야 한다. `tests/watch.spec.js`가 시드 36의 사건 틱과 자막 순서를 고정한다.

## reset 결정성(같은 시드는 언제나 같은 경기)

- 문제: `game.reset()`이 몸과 공을 제자리로 옮기기만 해서 Rapier 월드 내부 상태(접촉 캐시·광역 단계 구조)와 물리 시계가 이전 경기에서 넘어왔다. 같은 시드·같은 입력이라도 reset 횟수에 따라 틱 1부터 결과가 달랐다(시드 36의 첫 받아내기가 새 게임에서는 틱 436, 사용한 게임에서는 437). 저장 상태도 달랐다(`physics.time` 0 대 13.3초, 월드 직렬화 101,741 대 127,290바이트).
- 락스텝 영향: 스냅샷 저장·복원(롤백·합류) 경로는 처음부터 결정적이다(`tests/reset-determinism.spec.js` 2번째 테스트). 어긋나는 경우는 한 피어가 이미 다른 경기를 한 `game` 인스턴스로 온라인 경기를 시작하고 상대는 새 페이지인 경우처럼, 두 피어의 reset 이력이 다를 때다.
- 수정: reset(첫 생성 직후 제외)이 `TakrawPhysics.rebuild()`로 물리 월드를 새로 만든다. 선수 프로필은 유지하고 시계·토스 계획·`rallyStart`는 새 인스턴스와 같게 돌린다. 비용은 reset 한 번에 약 8ms다.
- 불변식: 몇 번째 reset이든 새 인스턴스와 같은 경기를 하고, 초기 `save()`가 바이트까지 같다. `tests/reset-determinism.spec.js`가 고정한다.

## 시작 틱 독립성(호스트가 넘기는 tick에 경기가 묶이지 않는다)

- 문제: AI 갱신 주기를 `frame.tick % N`으로 정해, 호스트가 step을 부르는 첫 tick에 따라 갱신 위상이 달라졌다. 게임킷 세션은 틱 0부터, 시뮬레이션 도구와 테스트는 틱 1부터 돌려 같은 시드가 다른 경기가 됐다(시드 1013: 틱 1 시작은 틱 831에 팀 0 득점·스파이크 5번, 틱 0 시작인 브라우저는 틱 404에 팀 1 득점·스파이크 0번). 시드 탐색 결과가 브라우저 장면과 달랐던 원인이다.
- 수정: 주기를 경기 안 스텝 수(`metrics.logicSteps`, reset에서 0, save/load 포함)로 정한다. 첫 스텝이 1이라 기존 노드 결과(시드 탐색·소개영상 대본)는 그대로다.
- 불변식: 같은 시드는 첫 tick이 몇이든 같은 경기다. `tests/reset-determinism.spec.js`의 시작 틱 테스트가 고정한다. 게임 규칙에서 `frame.tick`은 이벤트 표시와 재시작 시드에만 쓰고 확률·주기 판단에 쓰지 않는다.

## 경기장 꾸밈은 보는 사람의 상대 학교 기준

- 문제: 현수막·바닥(코트)·관중 색이 팀과 상관없이 어웨이(팀 1) 학교와 `x=+7.8`에 고정돼 있었다. 2P 카메라는 `+x` 쪽에서 `-x`를 보므로 현수막이 카메라와 코트 사이에 서서 시야를 가렸다.
- 규칙: `TakrawView.setViewTeam(team)`이 보는 팀을 받아 꾸밈의 기준 학교를 상대 학교로 바꾼다(1P는 팀 1 학교, 2P는 팀 0 학교). 현수막 묶음(`bannerRig`)은 2P에서 y축으로 180도 돌려 상대 코트 뒤(`x=-7.8`)에 두고 글자 순서도 화면 기준으로 유지한다.
- 시뮬레이션·네트워크 상태는 건드리지 않는다. 화면 전용이며 `updateCamera`가 매 프레임 호출한다.

## 사운드: 변주된 타격음과 배경 음악

- 소리 선택은 `src/presentation/sound.js`의 순수 함수다. 발차기는 스파이크 > 발이 아닌 몸(`kickBody`) > 발(공 속도 3단계 × 타이밍 등급 3개)로 고른다. 레시피는 `config/runtime.js`의 `KICK_LEVELS`·`KICK_GRADES`가 만든다(`kickSoft`…`kickHardPerfect` 9종 + `kickBody` + `kickSpike`).
- 발차기 한 번은 네 층이다: 낮은 쿵(무게), 중음 몸통(삼각파, 작은 스피커에서도 들리는 울림), 슬랩과 클릭(발이 닿는 "탁"). 사인파 하나였던 이전 소리는 2kHz 위 에너지가 0이었고 단계별 음량 차이가 2dB뿐이었다. 컴프레서(threshold -10, ratio 3)를 풀어 소프트→스파이크가 약 8dB 벌어진다. 득점 신호는 일반 타격보다 크게 둔다.
- 재생 변수: `pan`은 소리가 난 위치(화면 오른쪽이 1P는 +z, 2P는 -z)에 `soundPanSpread`를 곱한 값, `detune`은 매번 ±`soundDetuneCents`(150), 음량은 보는 사람에게서 먼 코트 끝일수록 `soundDistanceDrop`(35%)까지 작아진다(1P는 +x가 먼 쪽, 2P는 -x). 득점·서브 신호는 음정이 있어 가운데에서 변주·거리 감쇠 없이 낸다. 난수는 표시 전용(`Math.random`)이며 시뮬레이션·롤백 상태와 무관하다. 롤백으로 같은 이벤트가 다시 나와도 저널이 같은 식별자의 중복을 버려 소리는 한 번만 난다.
- 관중 환경음은 넣지 않는다. 합성 노이즈로 만든 군중 소리는 두 차례 시도(v0.12.69 저역통과, v0.12.70 밴드패스 6겹) 모두 바람·쉬익 소리처럼 들려 v0.12.71에서 뺐다.
- 배경 음악(v0.12.72~, 게임킷 audio buffer 베드): CC0 "Head in the Sand"(`assets/audio/head-in-the-sand.ogg`, 출처는 `assets/audio/CREDITS.md`)를 첫 제스처 뒤로 홈에서도 경기 중에도 작게 깐다(v0.12.73부터 홈 포함). 오디오 잠금 해제 뒤(`unlockAudio`, 문서 전체의 첫 pointerdown·keydown에서도 불린다) 곡을 한 번 읽어 디코드하고 `setBuffer('bgm')`로 등록한 다음 `startBed('bgm')`로 켠다. 읽기·디코드가 실패하면 한 번만 기록하고 음악만 빠진다(재시도 없음). 크기는 `bgmLevel()`: 홈 `homeLevel`(0.9), 경기 중 `level`(0.7, 게임 마스터를 거쳐 약 -36 dBFS RMS), 일시정지·소개영상 `pausedLevel`(0.35). 곡 안의 크기 편차가 커서(3초 구간 10.8dB) 도입부는 묻히고 하이라이트는 튀었다. 레이어 컴프레서(threshold -50, ratio 10, 어택 100ms, 릴리스 900ms)로 편차를 2.5dB로 줄이고, 컴프레서의 자동 보정(약 +5dB)을 gain 0.55로 상쇄한다(하이라이트 크기는 그대로, 도입부는 약 4dB 올라간다). 곡의 멜로디가 타격음 몸통과 같은 200~400Hz에 있어 필터로는 겹침을 못 줄이므로, 타격 순간에 음악을 잠깐 낮추고(`duckBgm`, 득점은 더 깊고 길게) 타격음이 묻히지 않게 한다. 관전 재시작과 홈↔경기 이동에서는 끊기지 않고 크기만 부드럽게 바뀐다. 효과음 설정을 끄면 master가 0이라 같이 꺼지고 켜면 이어진다.
