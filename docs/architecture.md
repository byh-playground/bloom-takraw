# 모듈과 소유권

`index.html`은 `styles/app.css`와 `src/main.js`를 로드합니다. main은 로딩 표시 후 runtime을 가져오므로 로컬/CDN 모듈 실패도 화면에서 안내합니다. runtime은 GameKit 공개 API를 직접 import하며 세션·입력·표현 수명주기를 연결합니다. 공통 API를 재집계하는 wrapper는 없습니다.

| GameKit 소유 모듈   | 사용하는 공개 API                                                  | 게임에서 제공하는 부분                                                              |
| ------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| input               | ActionState, createDOMInput                                        | 키/포인터 매핑과 8바이트 입력(조준 포함)                                            |
| simloop             | createLoop, createDeadlineScheduler                                | 60TPS 정책·진행/관찰 조건                                                           |
| rollback            | createRoomSession, profiles                                        | saveInto/load/step/validateSnapshot 및 membership 어댑터                            |
| transport           | createNostrDynamicRoom                                             | 방 UI·재접속 정책·방 복귀 어댑터                                                    |
| deterministic       | createValueCodec, SeededPRNG, statelessRandom, hashBytes           | 게임/물리 상태의 값 구조, 시드 난수의 키 묶기(`simulation/random.js`)               |
| interpolation       | PresentationRuntime, RenderObject                                  | 신체 pose와 생명주기 바인딩                                                         |
| presentation-events | PresentationEventQueue                                             | 확정 경기 이벤트와 표현 정책, 접촉 효과의 start·update·reconcile·stop               |
| object-pool         | ObjectPool                                                         | 접촉 효과 노드 재사용                                                               |
| audio               | AudioPlayer, audioSettings                                         | 소리 정의·음량·동시 재생 한도·소리 설정 save                                        |
| save                | createSave, indexedDbAdapter, localStorageAdapter, memoryAdapter   | 저장 레코드 정의·어댑터 선택                                                        |
| pwa                 | registerPwa (+ Node 도구 `pwa-build.mjs`)                          | 오류·설치 위치(처음 화면 상태 줄·설정 창), 격리 장면 제외                           |
| scenario            | installShowcase                                                    | 소개영상 대본·관전 장면(`config/intro.js`, `presentation/intro*.js`)                |
| debug-tools         | DiagnosticRing, redactDiagnostic, copyDiagnostic, installDebugHost | 오류 기록·진단 복사, 확인용 주소 장면(`debug-scenes.js`)과 가상 시계                |
| i18n                | createLocale                                                       | 화면 언어 선택, 문구 표(`src/i18n/`)                                                |
| metrics             | createMetrics, HttpAdapter, MemoryAdapter, SessionReplayRecorder   | 지표 이벤트 표(README 「게임 지표」)·경기 기록                                      |
| navigation          | createNavigation                                                   | 화면 주소 정규화(`presentation/routes.js`)와 주소에 화면 맞추기(`ui.js applyRoute`) |

별칭은 `@bloom-gamekit/<모듈>`입니다. 정확한 배포 URL과 SHA-256은 `gamekit.lock.json`을 따릅니다. HTML import map은 브라우저의 별칭 해석만 수행하며 `npm run check`가 lock과 일치(링크·SHA 형식·사용 여부)를 확인합니다. `npm run verify:dependencies`는 원격 파일 바이트를 대조합니다. 버전 업데이트는 lock과 import map을 함께 고치고 공개 계약과 브라우저 결과를 확인합니다. 처음 화면을 열 때(v0.17.0, 서비스 워커 제외) 외부 요청은 GameKit 16개(UI 구조 전환으로 `navigation`이 늘어 15개에서 16개)와 Three.js 2개·Rapier 1개이고, 이 저장소에서 받는 서로 다른 로컬 JS 파일 70개(첫 화면이 준비될 때까지 요청한 `.js` 경로 수. 연습·모드 분리로 40개에서 43개, runtime 분해로 `src/runtime/` 15개가 늘어 58개, UI 화면별 분리로 `routes.js`·`markup.js`·`match-hud.js`·`touch-controls.js`·`training-panel.js`와 `screens/` 7개가 늘어 70개)와 CSS 1개 요청이 추가됩니다.

## 저장(v0.13.10~)

팀·소리 설정·방 복귀 저장은 gamekit `save`를 거치고, 저장소는 `runtime/stores.js`의 `adapter(store)` 한 곳에서 고른다. 게임 코드는 localStorage·sessionStorage·IndexedDB를 직접 부르지 않는다. 화면 언어 선택만 gamekit `i18n`의 `createLocale`이 저장한다.

| store    | 실제 저장소                                   | 레코드(key)                                                                                |
| -------- | --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| club     | IndexedDB `bloom-takraw-club`/`club`          | `my-team`                                                                                  |
| settings | localStorage, 접두사 `bloom-takraw:`          | `audio-settings`(`audioSettings(TAKRAW_RUNTIME.audio)`: 음량·음소거·분류별 음량)           |
| resume   | sessionStorage, 접두사 `bloom-takraw:<버전>:` | `active-room`(마지막 방 `{ role, room }`), `room:<방 코드>`(transport의 방 identity)       |
| 언어     | localStorage, 키 `bloom-takraw-locale`        | 고른 언어 코드(`ko`·`en`). `createLocale`이 읽고 쓰며 `save` 레코드가 아니다(docs/i18n.md) |

- 격리 장면(`?debug`, 소개영상 `?showcaseDemo=1`)은 세 store 모두 `memoryAdapter()`라 실제 저장을 읽지도 쓰지도 않는다. 장면 안에서 일부 저장만 건너뛰는 분기는 두지 않는다.
- 이전 키(`bloom-takraw-audio`, `bloom-takraw:<버전>:active-room` 원시 JSON)와 옛 형식 저장은 읽지 않고 옮기지도 않는다(출시 전이라 마이그레이션을 두지 않는다). 팀 저장(`my-team`)은 `TakrawClub._default()`가 만드는 현재 형식만 검증한다. 이미 저장된 레코드의 모르는 키(예: 삭제한 학습 기능의 `learning`)는 검증하지 않고 읽기만 한다.
- 읽지 못한 레코드는 기본값으로 바꾸지 않고 원본을 둔다. 소리 설정은 소리를 끈 채 설정 창 효과음 줄에 알리고 토글을 막는다. 방 복귀 정보는 부팅 때 연결 창을 열어 알리고, 사용자가 새 방을 만들 때 `reset()`으로 버린다(transport의 `reset: true`와 같은 때). 읽지 못한 팀 저장은 원본을 두고 쓰기를 잠근 채 홈에 `팀 저장을 읽지 못했어요`를 알리고, 팀 관리 화면 상태 줄의 **기록 지우고 새로 시작**을 누른 뒤 확인(기록 지우기/취소)을 한 번 더 받아야만 `club.reset()`(gamekit `save.reset()`)이 새 팀으로 바꾼다. 읽을 수 있는 저장은 지우지 않는다(`resetInvalid`).
- 쓰기 실패: 소리 설정(`onSaveError`)은 설정 창 효과음 줄, 방 복귀(`active-room` 쓰기와 transport의 `resume-save-failed`)는 연결 창 안내 줄에 알린다. 실패는 `diagnostics().errors`에도 남는다.

## 치명 오류 진단 (v0.15.10~)

- 오류 기록의 단일 원본은 gamekit `debug-tools`의 `DiagnosticRing`(runtime `recordError`)이다. `diagnostics().errors`는 그 스냅샷에서 파생한다.
- 경기 중 실패(`simulationFailed`)와 시작 실패는 경기 중에도 보이는 치명 오류 패널(`#fatal-panel`)로 알린다. 패널의 **진단 복사**는 지금 상태(버전·모드·단계·tick·언어·화면·브라우저)와 오류 기록(원래 예외의 이름·메시지·스택)과 연결 기록을 클립보드에 넣는다. 클립보드가 막히면 선택된 글상자로 직접 복사하게 한다(`copyDiagnostic`). 경로·URL·토큰은 모듈이 가린다(스택의 파일 위치는 `[source]`로 가려져 함수 이름만 남는다).
- 예외는 원본 그대로 올린다(bloom-reference DEV-027). 롤백 세션의 `fatal` 이벤트는 단계가 던진 예외를 곧바로 다시 던지므로 이벤트 쪽에서 감싸 먼저 실패 처리하지 않는다. 던져진 예외가 없는 `desync-unrecoverable`만 직접 만든 오류로 알린다.

## 설치·오프라인(PWA, v0.14.0~)

- `node scripts/pwa.mjs`가 gamekit `pwa-build.mjs`(`scripts/vendor/gamekit/`, `gamekit.lock.json`의 `tools`에 dist commit·SHA-256 고정)로 `manifest.webmanifest`·`pwa/*.png`·`sw.js`와 `index.html`의 `<!-- bloom-pwa:start/end -->` 사이 태그를 만든다. 생성 결과는 커밋한다. `npm run check`가 `--check`로 원본(`assets/pwa/*.svg`, 이름·색 같은 설정)과 어긋난 결과를 막는다. sw.js는 게임 파일 목록을 갖지 않는 고정 코드라(gamekit v0.41.0~) `src/`·`styles/`만 고친 배포는 다시 생성할 필요가 없다.
- 아이콘·공유 이미지 원본은 게임 실제 렌더를 넣은 SVG다. 장면은 `?debug=1&scene=spike&seed=22591&tick=581&camera=…`(가위차기 직전, 공 바로 아래 발, v0.17.0 난수 기준)이다. 팀 색·하늘은 시드가 정하는 관전 학교(`takrawWatchSchools`)를 따르므로 처음 아이콘(시드 1)과 같은 학교 조합(시드 ≡ 1 mod 90, 불꽃고 대 파도고)에서 골랐다. 카메라 값은 `scripts/pwa.mjs` 주석에 있다. 제목 글자는 path로 바꿔 넣어 PC 글꼴에 기대지 않는다.
- 미리 받는 파일(precache)은 없다. 같은 origin 파일은 매번 서버에 재확인하고(`no-cache`) 받은 응답을 오프라인 사본으로 둔다. 그래서 새로고침하면 항상 최신 버전이고, 오프라인 시작은 서비스 워커가 제어한 상태로 한 번 연 뒤(두 번째 방문)부터다. 고정 gamekit 주소는 cache-first다. Three.js·Rapier(npm CDN)는 서비스 워커가 캐시하지 않는다. 그래서 오프라인 시작은 브라우저 HTTP 캐시에 두 파일이 남아 있을 때만 된다(HTTP 캐시를 지우면 "게임 모듈을 불러오지 못했어요"로 멈춘다).
- `registerPwa`는 부팅을 마친 뒤 부르고, 격리 장면(`?debug`, `?showcaseDemo=1`)과 다른 페이지의 iframe 안(itch.io 임베드, v0.15.2~)에서는 부르지 않는다. 새로고침이 곧 업데이트라 새 버전 알림은 없다. 등록 실패(`onError`)는 처음 화면 상태 줄에 오류로 띄운다. 이 알림은 경기 시작·처음 화면 복귀로 상태 줄을 비울 때도 남는다. 설치(`onInstallable`)는 설정 창의 "앱으로 설치" 줄이다.
- 확인용 장면 `spike`(`?debug=1&scene=spike&seed=N&tick=T&camera=x,y,z,tx,ty,tz,fov`)는 `watch`와 같은 재생을 고정 카메라로 다시 그리고 HUD를 숨긴다. 카메라 위치는 월드 좌표, 바라보는 점은 공 기준 상대 좌표다. 경기 카메라를 향한 안내(공 테두리·높이선·받기/공격 안내·선택 표시)는 그 그림에서만 뺀다. `watch`는 debug-tools가 주는 `freezeClock()`으로 `performance.now`를 가상 시계로 바꾸고 틱마다 `advance`하며, 시계 복원은 호스트가 한다.

`simulation/game.js`는 규칙·AI·득점·세트·스냅샷 메타데이터와 연습 훅의 호출 위치를 소유합니다. `simulation/physics.js`는 Rapier World·몸체·관절·접촉·신체 제어와 물리 스냅샷을 소유합니다. 복원용 SerializationPipeline은 physics 인스턴스가 생성·재사용·해제합니다. 큰 흐름은 단계 메서드로 나뉘어 있습니다(v0.17.0 구조 정리, 계산·Rapier 읽기·쓰기 순서는 그대로). `step`은 충돌 전 상태(`_captureBefore`) → `world.step` → 충돌 이벤트(`_drainCollisions`) → 충격량(`_collectBallImpulses`) → 터치 확정(`_confirmTouches`) → 이벤트(`_emitTouches`), 선수 제어 `_drivePlayer`는 몸 상태(`_senseBody`) → 입력(`_readIntent`) → 점프(`_jump`) → 행동(`_selectAction`) → 자세(`_driveStance`) → 행동 자세(`_driveActionPose`) → 발차기(`_driveKick`) → 관절 모터(`_applyJointTargets`), 스냅샷 `load`는 검사(`_validateSnapshot`) → 준비(`_prepareRestore`, 실패하면 새 월드를 버리고 기존 상태는 그대로) → 반영(`_commitRestore`)입니다. 공중 발차기 발 목표(`_airFootTarget`)와 지상 토스 발 목표(`_receiveFootTarget`)는 계획 수립(`_beginAirPlan`·`_beginReceivePlan`) → 매 substep 계산 → 계획 기록으로 나뉘고 Rapier에는 쓰지 않습니다. 모션 데이터/모델/매칭은 `motion/`에 있는 게임별 저작 자료입니다. `simulation/timing.js`의 `TakrawTimingJudge`는 점프·발차기 입력의 타이밍 오차 공식과 등급 창(`config.timing`)을 소유합니다. 기록은 `state.timing`에 두어 스냅샷·롤백에 함께 저장되며, 연습의 오차 기록과 접촉 판정이 같은 공식을 씁니다. 연습 규칙과 모드별 능력, 연습 안내의 표현은 아래 「연습·모드 프로필의 소유」에 나눠 둡니다.

`club/club.js`는 선수·편성·보상과 영속 데이터를, `presentation/view.js`는 Three.js 장면·카메라·표시 자원을, `presentation/ui.js`는 화면 전환(대화상자 열기·닫기, 주소에 화면 맞추기)·포커스·치명 오류 패널과 runtime이 부르는 공개 메서드를 소유하고, 화면별 상태와 그리기는 아래 「UI 소유」 표의 모듈이 가집니다. `simulation/ai-brain.js`는 AI 선수 한 명의 행동 상태머신(대기·보조·받기·공격·세트·추격)과 선수 성향(Temperament)을 소유하고, `game.js`의 `decideAI`가 매 AI 틱에 이를 호출해 목표 자리를 받습니다(킥·점프 타이밍은 game.js 책임). 상태는 `ai[id].brain` 순수 데이터라 스냅샷·롤백에 포함되고, 성향은 `state.seed`·선수·랠리 번호로만 정해집니다. `presentation/impact.js`의 `TakrawImpactEffects`는 접촉 효과(링·입자·접점 섬광·속도선·진동량·화면 확대·공 눌림·궤적 강조)를, `presentation/field-effects.js`의 `TakrawFieldEffects`는 착지 먼지와 득점 색종이를 소유하며 view가 포함합니다. 평상시 드로우콜은 렌더 상태 묶음 수로 정해집니다: 코트·기둥·관중석·나무 같은 정적 구조물과 공은 `presentation/merge-geometry.js`(`mergeColored`·`PartList`)로 정점 색 geometry 하나로 합쳐 재질 하나로 그리고(학교 색이 바뀌는 코트·코트 안쪽·선만 색 채널 재질), 선수·공 표시와 받기·공격 안내는 `presentation/markers.js`의 `TakrawMarkers`가 인스턴스 레이어 셋(바닥 반투명·겹쳐 그림·화살표)으로 그립니다(v0.19.1). 선수 6명은 `presentation/player-batch.js`의 `TakrawPlayerBatch`가 본체 1 draw + 등번호 1 draw(그림자 패스는 본체 1)로 그립니다(v0.19.2): 모든 선수의 부위·장식 정점을 geometry 하나에 잇고 정점마다 부위 번호(선수 × 물리 부위 15)를 달며, 매 프레임 부위 행렬·다리 반길이·반짝임만 RGBA float 자세 텍스처(너비 4 × 부위 90)에 써서 정점 셰이더가 읽습니다. 자세는 굽지 않고 물리가 매 순간 정합니다. 다리 늘어남(캡 평행이동·몸통 y 스케일)도 셰이더가 하고, 바인드 자세 경계라 두 메시는 컬링하지 않습니다. 부위 포즈는 `view.meshes`의 장면 밖 보관 객체(Object3D)라 카메라·표시·안내·리플레이는 전처럼 위치를 읽습니다. 텍스처인 이유는 90부위 행렬이 WebGL2 정점 uniform 최소 보장(256 벡터)을 넘기 때문이며, three.js r180이 WebGL2 전용이고 WebGL2가 float 텍스처 NEAREST 표본과 정점 텍스처 읽기를 보장하므로 확장이 필요 없습니다. 게임 고유 Three.js 카메라와 라우팅 정책을 다른 GameKit 모듈로 교체하는 변경은 이번 구조 전환에 포함하지 않습니다.

팀은 출전 3인(`starter`)만으로 시작하고 나머지 선수는 뽑기로 모은다(v0.12.83~). 선수 영입은 뽑기로 바뀌었다(v0.12.82~). `club.draw()`가 `TAKRAW_CLUB_RULES.draw`(1회 300 C, 등급 확률 70/25/5)로 등급을 뽑고, `presetShare` 확률로 프리셋 카드(`TAKRAW_CLUB_PLAYERS`에서 `starter`가 아닌 선수) 또는 생성 선수(`club/generator.js takrawGenerateCard`)를 고른다. 생성 선수의 이름은 `club/names.js`(@faker-js/faker 한국어 로케일에서 추린 두 글자 이름 521개, MIT 출처는 파일 머리말), 능력치는 등급별 `generation` 규칙으로 정한다. 생성 선수는 저장 기록의 `cards`에 카드째 저장해 생성 규칙이 바뀌어도 선수가 변하지 않는다. 결과는 코인 차감과 함께 저장 한 번으로 확정되므로 연출 도중 새로고침해도 되돌릴 수 없다. 선수단이 가득 차면 결과를 `pending`으로 남기고 `resolveDraw`가 환급(등급별 1/2/5 P) 또는 후보와의 교체로 정리하기 전까지 다음 뽑기를 막는다. 뽑기 연출(카드팩 흔들림 → 카드 뒷면 → 탭해서 뒤집기 → 공개)은 팀 관리 화면과 분리된 `#draw-stage` 레이어가 맡고, 건너뛰기·Esc·움직임 줄이기 설정을 지원한다. 팀 관리 화면(v0.12.78~)은 탭만으로 쓴다. 선수 상세는 레이더 하나만 보이고 주소(`#/club/<선수 id>`)로 연결되며, 뒤로 버튼은 대화상자 헤더 왼쪽의 고정 자리(`#dialog-back`)에 있고 Esc·브라우저 뒤로가기도 목록으로 돌아간다. 선택 표현은 고른 카드·자리가 빛나고 추천 역할이 같은 카드·자리가 `추천` 표시와 함께 켜지는 방식이며 나머지를 어둡게 지우지 않는다. 편성은 선수 먼저 또는 자리 먼저 누르는 두 흐름이고, 선택은 `screens/club.js` 안에만 있다가 교체가 끝날 때 `club.assign`을 한 번 호출한다. 훈련은 포인트 1개로 선수의 훈련 레벨을 올리는 `club.train(playerId)` 하나이고, 레벨은 레코드의 `levels`에 저장한다. 표시·경기 능력치는 `(기본 + 이전 trained) × (1 + 0.033 × 레벨) ** 1.5`(`takrawTrainingFactor`, 한 번에 약 5%에서 점차 완만히)를 반올림한 값이고 상한이 없다. 능력치가 `athletes.max`(100)를 넘으면 경기 효과는 `1 + overflow × log2(v/100)`배로 완만히 늘고(`takrawAthleteEffects`, 200에서 이동 +15%·수비 30%), 효과는 `athletes.maxEffect`를 넘지 않는다.

도장깨기 첫 진입(v0.13.1): 처음 열면 소개 카드 3장(내 학교와 선발 → 앞으로 만날 학교는 모른다 → 첫 상대)이 나오고, 건너뛰기·도전하기로 마치면 `campaign.introSeen`을 저장해 다시 나오지 않는다(`screens/campaign.js introContent`, 목록 아래 `소개 다시 보기`로 다시 볼 수 있다). 목록은 깬 학교와 지금 도전할 학교까지만 보이고 그다음은 이름 없는 `???` 한 칸이라 학교가 모두 몇 곳인지 어디에도 드러나지 않는다. 온라인 1대1 팀 표기(v0.13.0): 접속해 두 사람이 모이면 각자 내 팀 이름과 내 학교를 명령 한 번(`simulation/identity.js`, 코드 40: [40, 학교 번호, …UTF-8 이름])으로 알린다. 명령이라 두 피어와 롤백이 같은 값을 얻고, 보낸 사람의 팀 자리(`teamNames`·`teamSchools`)에만 적힌다. 표시 전용이며 능력치는 보내지 않는다. 점수판은 이름 옆에 그 학교 유니폼 색 점과 내 쪽 `나` 표시를 달고, 같은 학교끼리면 두 번째 팀은 다음 학교 색을 쓴다(`takrawIdentitySchools`). AI 관전은 두 학교 이름과 색을 쓴다. 선수 목록(v0.13.7): 선수 한 명은 한 줄(셔츠 · 이름·등급 · 대표 능력치 둘 · 상태 · ⓘ, 38px)이라 정원 9명이 390×844 화면에 목록 안 스크롤 없이 들어간다(`screens/club.js card`). 자리를 고르는 중이면 대표 능력치 자리에 그 자리 선수와의 차이가 대신 선다. 추천 자리·성격은 ⓘ 상세에서 본다. 모바일에서는 코인·훈련 포인트를 팀 이름 줄 오른쪽에 두고, AI 대전 보상 안내는 코인을 쓰는 뽑기 탭으로 옮겼다. 높이 640px 같은 낮은 화면은 이전처럼 창 전체가 스크롤된다. 상세에서 돌아오면 상세를 연 ⓘ(선발 칸 또는 선수 카드)로 포커스가 돌아간다(`screens/club.js`의 `selection.opener`, v0.13.5). 선수 판매(v0.12.87): 선수 카드에서 후보를 왼쪽으로 밀면 판매 버튼이 드러나고(`TAKRAW_SELL_REVEAL_PX`), 카드 폭의 62%(`TAKRAW_SELL_FULL_RATIO`) 넘게 끝까지 밀면 바로 판다(`screens/club.js swipe`). 키보드는 후보 카드에서 Delete로 버튼을 드러낸다. 받는 훈련 포인트는 등급 환급(`draw.refund`)에 쌓은 훈련 레벨 × `sell.levelRefund`이고, 출전 선수는 팔 수 없어 선수단은 늘 `sell.minRoster`(3)명 이상 남는다(`club.js sell`). 소개 주소(`#/showcase`)는 게임킷 소개 호스트가 부팅 직후 읽어 여는 주소라, 처음 홈을 보일 때(`showHome`) 지우지 않는다(v0.12.84, 이전에는 `#/`로 덮어써 주소로 들어가도 소개가 열리지 않았다). 메인 화면(v0.12.80~): 게임 UI는 꼭 필요한 곳 외에는 스크롤을 두지 않고, 버튼을 한 번에 늘어놓지 않고 계층으로 압축한다. 첫 화면에는 `게임 시작`과 `팀 관리`만 두고, `게임 시작` 안에 주 모드인 도장깨기(첫 줄, 강조 버튼)·연습 경기(AI와 가볍게 한 판)·스파이크 연습·`멀티플레이`를, `멀티플레이` 안에 친구와 1대1·로컬 2인·AI 관전을 둔다. 안쪽 단계는 `index.html`의 `data-home-view`와 주소(`#/start`, `#/multi`)로 정해지고(`screens/home.js setView`·`ui.js applyRoute`), 한 번에 한 단계만 보인다. 뒤로 버튼은 헤더 왼쪽 위의 고정 자리(`#home-back`)에서 한 단계 위(`HOME_PARENT`)로 가며 Esc·브라우저 뒤로가기도 같은 길을 간다. 도장깨기·온라인 창을 닫으면 열기 전 단계로 돌아온다. 헤더에는 설정만 두고 소개는 패널의 `소개 보기`가 맡는다(처음 화면에서만 열린다). 높이 700px 이하에서는 부제목·조작 안내를, 620px 이하에서는 설명 문구까지 접는다.

의존 방향은 config/data → motion/club → physics → game → UI, runtime → 각 소유자입니다. 보간용 `BodyPose` 클래스는 `runtime/presentation-feed.js`가 리셋마다 새로 만듭니다. 변경 가능한 전역으로 분리하지 않습니다. `window.__takraw`(`game`·`session`·`view`·`ready`·`watch`·`showcase`·`diagnostics`·`dispose`)가 진단·시험 진입점입니다.

`scripts/dev-server.cjs`는 원본을 JS/CSS MIME으로 제공합니다. 상대 경로이므로 `/bloom-takraw/` 같은 하위 경로도 지원합니다. 배포 파일 생성·번들링·변환은 없으며 소스 스냅샷을 그대로 사용합니다.

## UI 소유와 화면 주소

`TakrawUI`(`presentation/ui.js`)는 runtime이 부르는 공개 메서드(`showHome`·`showGame`·`update`·`setClub`·`setNetwork`·`setSound`·`setInstallable`·`navigate`·`openDialog`·`dispose` 등)와 `settings.quality`를 그대로 두고, 화면별 상태와 그리기를 아래 모듈에 맡깁니다. 각 모듈은 `ui.js`를 import하지 않고 생성 때 받은 콜백·조회 함수만 씁니다. 대화상자 화면은 `ui.screens` 하나의 표(주소의 화면 이름이 키)이고, `openDialog`는 `screens[이름].heading()`·`content()`를, 대화상자 안 클릭은 `screens[이름].click(event)`를 부릅니다. 리스너는 모두 `ui.listen`(AbortController 하나)으로 붙여 `dispose`가 한 번에 뗍니다.

| 모듈                    | 가진 상태                                                       | 맡는 일                                                                              |
| ----------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `ui.js`                 | 열린 대화상자, 경기 중 여부·모드, 이전 포커스, 진단 복사 타이머 | 화면 전환·주소 맞추기(`applyRoute`), 포커스 가두기·복원, 치명 오류 패널, 공개 메서드 |
| `routes.js`             | 없음                                                            | 주소 정규화(`takrawRoute`): 알려진 화면·대화상자만 남기고 나머지는 `play`로 읽는다   |
| `markup.js`             | 없음                                                            | 문구(`say`)·HTML 이스케이프(`escape`)·같은 글이면 건너뛰는 textContent 쓰기          |
| `match-hud.js`          | 문구 캐시, 리플레이 중 여부, 타이밍·타격 표시 토큰              | 점수판·안내·타이밍 등급·리플레이 띠·결과 화면·관전 입력칸                            |
| `touch-controls.js`     | 이동 패드를 잡은 포인터, 눌린 버튼                              | 터치 이동·점프, PC·터치 공통 발차기(조준) 버튼과 표시                                |
| `training-panel.js`     | 문구 캐시                                                       | 연습 레슨·박자 선택과 `training-coach.js` 결과 그리기                                |
| `screens/home.js`       | 처음 화면 단계(`main`·`start`·`multi`)                          | 단계 전환·뒤로(`HOME_PARENT`)·시작 버튼 잠금·팀 요약                                 |
| `screens/club.js`       | 팀 조회 결과, 선택·상세, 저장 중 여부, 안내, 스와이프           | 팀 관리 화면(편성·훈련·판매·뽑기 탭·상세)                                            |
| `screens/campaign.js`   | 소개 카드 장 번호                                               | 도장깨기 학교 목록과 첫 진입 소개                                                    |
| `screens/draw-stage.js` | 보이는 카드·단계·타이머, 소개영상 장면                          | `#draw-stage` 뽑기 연출                                                              |
| `screens/settings.js`   | 소리·품질 값, 소리 저장 상태, 앱 설치 가능 여부                 | 설정 창                                                                              |
| `screens/pause.js`      | 없음                                                            | 일시 정지 창                                                                         |
| `screens/network.js`    | runtime이 넘긴 연결 상태, 복사 버튼 타이머                      | 친구와 하기 창과 화면 위 연결 표시                                                   |

주소와 브라우저 이력은 gamekit `navigation`(`createNavigation({ normalize: takrawRoute })`)이 소유합니다. 처음 화면 주소는 해시가 없는 `…/`이고(이 구조 전환 전에는 `#/`), 예전 주소 `#/`로 들어와도 처음 화면이 열립니다. 문서에 적힌 주소(`#/start`, `#/multi`, `#/settings`, `#/campaign`, `#/club`, `#/club/<선수 id>`, `#/network`, `#/play`, `#/showcase`)는 그대로입니다. 화면 이동은 이력을 추가(push)하고 교정·닫기 뒤 정리는 바꾸기(replace)이며, navigation은 주소가 실제로 바뀔 때만 이력을 쓰므로 `history.length`는 전과 같습니다. navigation은 생성할 때와 이력 복원 때 읽은 주소가 정규 주소와 다르면(모르는 주소 `#/nope` 등) 이력 항목을 늘리지 않고 정규 주소로 고쳐 두므로(gamekit v0.57.0~), 경기 중에는 `#/play`, 아니면 처음 화면 주소가 남습니다. 지금 화면과 다른 결과로 바뀔 때만 이력 복원(뒤로·앞으로·주소 입력, `source: 'history'`)을 알리고, 게임은 이것만 구독해 `applyRoute`로 화면을 맞추고, 내부 이동(`ui.navigate`)은 주소를 바꾼 뒤 직접 `applyRoute`를 부릅니다. 소개영상 주소 `#/showcase`는 게임킷 소개 호스트(`installShowcase`)가 `pushState`·`replaceState`로 직접 다루므로 게임은 이 화면을 보존만 하고(정규화가 `showcase`를 남기고, `applyRoute`는 무시하고, `showHome`은 지금 주소가 `showcase`면 고치지 않는다) 손대지 않습니다.

## 화면 언어(v0.15.0~)

시뮬레이션·클럽 모델은 문장 대신 코드와 값(`{ id, values }`) 또는 정의 데이터의 TextPair `{ ko, en }`를 넘기고, 화면이 `src/i18n/messages/*.js`로 문장을 만든다. 언어는 페이지를 읽을 때 한 번 정한다. 자세한 규칙은 [화면 언어](i18n.md).

## 런타임 상태의 소유권

`src/runtime.js`의 `bootTakraw`는 조립 지점입니다. 모듈을 만들고 서로의 콜백·조회 함수를 잇고, 화면(UI) 콜백·`window.__takraw`·확인용 장면·PWA를 연결합니다. 직접 소유하는 상태는 `disposed`, `club` 참조(확인용 장면이 바꿔 끼우고 다른 모듈은 `getClub()`으로만 읽습니다), 부팅 중 만든 자원(game·view·codec·audio·input·intro·pwa)뿐입니다. 나머지 가변 상태는 아래 모듈이 하나씩 소유합니다(쓰는 곳 하나, bloom-reference DEV-001).

화면 콜백 묶음은 `takrawUiCallbacks`, 확인용 장면 연결은 `installTakrawDebugScenes`가 같은 파일의 모듈 함수로 조립합니다(v0.17.2~). 화면이 오디오·뷰·입력보다 먼저 만들어지므로 둘은 `getAudio`·`getView`·`getInput`·`getClub` 조회 함수로 읽고, 확인용 장면이 클럽을 바꿔 끼울 때는 `setClub`으로 `bootTakraw`의 참조를 바꿉니다. `MatchSession.open`은 경기 준비(모드·지표·학교·팀·reset) → 세션 만들기(`createSession`) → 시뮬 루프(`createSimLoop`) → pump(`createPump`) → 화면·연결 카드 순서입니다.

| 파일(`src/runtime/`)      | 소유 상태                                                                                                                                                                         | 공개 인터페이스                                                                                                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `match-session.js`        | 모드·일시정지·실패·세션 세대(`run`)·rollback 세션·루프·pump·최신 뷰·대기 명령·팀 알림 여부·관전 시드와 반복 지점·도장깨기 상대·확인용 시드·입력 관찰 예약·시뮬 시간 통계·HUD 시계 | `MatchSession`: `attach`·`open`·`stop`·`startLocal`·`startWatch`·`startCampaign`·`connect`·`restart`·`quit`·`setPaused`·`trainingCommand`·`simulationFailed`·`render`·`frame`·`pulse`·`freezeRealtime`·`dispose` |
| `network.js`              | 연결 표시 snapshot(유일한 writer)·연결 수명주기(`connection`)·방·방 세대(`epoch`)                                                                                                 | `NetworkLink`: `set`·`event`·`preflight`·`openRoom`·`failConnect`·`sessionOpened`·`maintain`·`reset`·`closeRoom`·`diagnostics`·`dispose`, 순수 함수 `connectionCause` 등 4개                                     |
| `render-loop.js`          | requestAnimationFrame 핸들·마지막 그린 시각                                                                                                                                       | `RenderLoop`: `start`·`stop`·`dispose`                                                                                                                                                                           |
| `boot-status.js`          | 부팅 단계(`stage`)·PWA 알림                                                                                                                                                       | `BootStatus`: `ready`·`advance`·`show`·`notice`·`dispose`                                                                                                                                                        |
| `presentation-feed.js`    | 보간 런타임·리셋마다 새 `BodyPose` 클래스·포즈 캐시·표본 순번                                                                                                                     | `PresentationFeed`: `reset`·`invalidate`·`publish`·`frame`·`dispose`                                                                                                                                             |
| `match-events.js`         | 표시 이벤트 저널(`PresentationEventQueue`)·롤백 중 여부·마지막 접촉                                                                                                               | `MatchEventJournal`: `replace`·`emit`·`confirm`·`beginRollback`·`endRollback`·`update`·`close`·`dispose`                                                                                                         |
| `highlight-controller.js` | 득점 리플레이(`TakrawHighlight` worker)·재생 중 여부·재생 시각                                                                                                                    | `HighlightController`: `anchorIfNeeded`·`record`·`tryBegin`·`end`·`frame`·`reset`·`stop`·`replayEveryScore`·`dispose`                                                                                            |
| `rewards.js`              | 보상 저장 작업·재시도 시계·이번 경기 보상                                                                                                                                         | `MatchRewards`: `begin`·`clear`·`observe`·`retry`·`pending`·`hudReward`·`dispose`                                                                                                                                |
| `match-record.js`         | 경기 기록 지표(순번·종료 시각·기록 여부)                                                                                                                                          | `MatchRecord`: `begin`·`membershipCommitted`·`observe`·`dispose`                                                                                                                                                 |
| `audio.js`                | AudioPlayer·배경 음악 버퍼·덕킹 시계                                                                                                                                              | `RuntimeAudio`: `unlock`·`setBackground`·`duck`·`eventAdapter`·`setMuted`·`snapshot`·`dispose`, 순수 함수 `takrawBgmLevel`                                                                                       |
| `input.js`                | ActionState·키·터치·축·카메라 끌기·마지막 입력 바이트                                                                                                                             | `RuntimeInput`: `sample`·`setTouch`·`setAim`·`setAxis`·`orbit`·`clear`·`dispose`                                                                                                                                 |
| `diagnostics.js`          | 오류 기록(`DiagnosticRing`)                                                                                                                                                       | `createRuntimeDiagnostics`: `recordError`·`report`·`errors`                                                                                                                                                      |
| `stores.js`               | 저장소 선택·방 복귀·소리 설정 저장                                                                                                                                                | `createRuntimeStores`: `resume`·`activeRoom`·`soundSettings`·`openClubSave`·`dispose`                                                                                                                            |
| `hud-model.js`            | 없음(순수) + `HudClock`(HUD 주기)                                                                                                                                                 | `takrawHudModel`, `HudClock`: `invalidate`·`due`                                                                                                                                                                 |
| `match-setup.js`          | 없음(순수)                                                                                                                                                                        | `takrawMatchSetup`·`takrawSessionProfile`                                                                                                                                                                        |

의존 방향(순환 없음): `runtime.js` → `match-session.js` → {`presentation-feed`, `match-events`, `highlight-controller`, `hud-model`, `match-setup`}. `runtime.js`는 `network`·`rewards`·`match-record`·`audio`·`input`·`render-loop`·`boot-status`·`stores`·`diagnostics`를 만들어 세션에 넘깁니다. 말단 모듈은 서로 import하지 않습니다. 위 계층 상태는 생성자로 받은 조회 함수(`getClub()`·`isReady()`·`isDisposed()`·`level()`·`perspective()`)로만 읽습니다.

통지는 생성자 콜백 하나씩입니다(bloom-reference DEV-007, 이벤트 버스·Signal 없음): `NetworkLink`의 `onChange`(→ `ui.setNetwork`)·`onRosterChange`·`onFirstConnected`(→ `ui.showGame`)·`onHandshakeTimeout`(→ 세션 종료), `HighlightController.onPlaybackChange`, `MatchRewards.onChange`, `RuntimeInput.onPointer`, `RuntimeAudio.onSaveError`. 명령은 직접 메서드 호출입니다.

세션 종료(`MatchSession.stop`)는 연결 정리(`net.reset`, `epoch` 올림) → `run` 올림 → 조작 해제 → pump·루프 정지 → 세션 닫기 → 방 닫기(`net.closeRoom`) → 이벤트·리플레이 정리 순서입니다. 방은 세션이 쓰고 있어 세션을 닫은 뒤 닫습니다. `run`과 `epoch`는 늘 함께 올라 이전 세션·연결의 비동기 콜백을 무효로 만듭니다. 런타임 종료(`dispose`)는 세션·연결 → 그리기 주기 → 리스너 → 보상 → 소개 → PWA → 클럽 → 화면 → 입력 → 오디오 → 저장소 → 뷰 → 리플레이 → 물리 순서입니다.

연결 표시 snapshot은 `NetworkLink.set`만 바꾸고 로그 추가(`event`)도 같은 경계를 통과합니다. UI는 전달받은 frozen snapshot을 읽고 표시하며 별도 부분 병합이나 연결 판정을 하지 않습니다. handshake, warning, retry 등의 수명주기 상태는 `NetworkLink.connection` 아래에 모으고 밀리초 단위를 leaf 이름에 표시합니다.

부팅 진행은 `BootStatus.stage`가 소유합니다. 준비 여부는 이 단계에서 파생하고 시작 가능 여부는 `MatchSession.canStart(mode)`가 클럽 상태와 실행 오류를 함께 판단합니다. 버튼 표시와 실행 명령이 같은 정책을 사용합니다. UI는 안내 문구가 비었는지로 준비 여부를 추측하지 않습니다. 일시 정지·실행 오류·종료는 서로 다른 개념이므로 하나의 거대 enum으로 합치지 않습니다.

- 부팅 단계를 gamekit boot(`createBoot`)로 옮기지 않았습니다. 진행 막대가 없고 개수를 모르는 비동기 단계라 `stage`는 진행률이 아니라 준비 여부·오류 분기·진단의 원본이며, 옮기면 원본이 둘이 됩니다.
- 시뮬 시간 통계(`diagnostics().simulation`)는 부팅 이후 누적값이라 RAF 프레임 단위 링인 debug-tools `FrameMetrics`로 바꾸지 않았습니다. 시뮬 스텝은 RAF 밖(deadline pump)에서 돕니다.

연결 정비는 기존 GameKit deadline pump에서 실행하며 80ms 간격 제한과 1초 재연결 제한을 유지합니다. 그리기(`MatchSession.render`)는 연결 생성·종료·재연결을 실행하지 않습니다. 페이지 복귀 시 reload하는 pageshow 리스너는 게임 인스턴스 종료 후 BFCache 복귀를 처리해야 하므로 페이지 수명주기에 남습니다.

선수 상태명은 HUD 생성 시 한 번 해석한 결과를 UI가 그대로 표시합니다. HTML의 대화상자는 빈 골격이며, 저장된 클럽 화면 사본을 포함하지 않습니다. 클럽 상태는 club owner의 현재 조회 결과로만 표시합니다.

## 설정·식별자의 소유 (v0.17.0 이후 정리)

- **선수 id 배치**(팀당 3명, 슬롯 리시버·세터·공격수, 사람이 조종하는 선수는 팀의 공격수)는 `simulation/roster.js`가 소유합니다. 시뮬레이션·물리·화면이 id에서 팀·슬롯을 읽을 때 `takrawTeamOf`·`takrawSlotOf`·`takrawHumanPlayerId` 등을 씁니다.
- **페이지를 연 맥락**(`?debug`, `?showcaseDemo=1`, iframe)은 `launch.js`가 한 번 정합니다. 저장·지표·언어 선택의 격리(`isolated`)와 `runtime.js`가 같은 값을 읽습니다.
- **입력 바이트 배치**(`TAKRAW_CONFIG.input`: 크기·한 명당 폭·축 배율)는 시뮬레이션이 읽는 게임 설정입니다. 한 틱은 `[x, z, 버튼, 조준x, 조준y] × 2명`(1P·2P) 10바이트이고, 조준 두 바이트는 발차기 버튼에서 누른 지점의 가로·세로를 이동 축과 같은 방식(−1..1 × 127, 부호 있는 바이트)으로 담습니다. 단계로 나누지 않고 바이트 해상도(1/127)만 둡니다. 발차기를 누르지 않은 틱의 조준은 0입니다. 인코딩(`runtime/input.js`)과 디코딩(`game.js decode`)이 같은 값을 읽고, 롤백·리플레이·온라인이 같은 바이트를 씁니다(v0.19.0, 이전 8바이트 4비트 조준 형식과 호환하지 않음).
- **발 조준**(v0.18.0~): 조준은 각도로 바꾸지 않고, 발이 공으로 향하는 방향(공중은 스윙 평면 축, 받기·토스·서브·세트는 보낼 쪽, 지상 발차기는 엉덩이→공)을 축으로 공 중심을 공 반지름 × `kickAim.maxOffset`만큼 옮긴 가상 중심을 겨냥합니다. `TakrawPhysics.aimedContact`가 공중 스파이크·지상 발차기·받기(토스·서브·세트) 모든 경로에서 발 목표 접촉점과 접촉면 법선을 함께 냅니다. AI는 조준 0으로 같은 함수를 씁니다. 상한은 발등 반폭(0.075 m)보다 작아야 하며 물리 생성자가 검사합니다. 사람 입력이 그 틱에 들어간 선수(팀의 공격수)의 서브·세트에는 `assistServe`·`assistSet` 속도 덮어쓰기를 하지 않고, AI 접촉만 보정합니다.
- **이름과 식별자**는 `config/game.js`에서 뜻별로 나뉩니다. `TAKRAW_GAME_NAME`(종목), `TAKRAW_PRODUCT_NAME`(제품), `TAKRAW_DIAGNOSTIC_NAME`(진단 머리글), `TAKRAW_ID`(저장·방·지표 식별자, 바꾸면 기존 저장이 끊김). 제품 버전은 `package.json`과 `TAKRAW_VERSION` 두 곳이며 `npm run check`가 일치를 검사합니다.
- **시드**는 뜻별로 나뉩니다. 시드를 받지 않은 경기·연습은 `TAKRAW_CONFIG.simulation.fixedSeed`, 접촉·착지 효과는 `TAKRAW_CONFIG.visual.effectSeed`, 롤백 세션 초기 시드와 방 이름공간은 `TAKRAW_RUNTIME.network`입니다(`TAKRAW_CONFIG`에는 network 섹션이 없습니다).
- **네트의 그림은 물리 충돌체 경계에서 파생합니다**(v0.17.3~). `config/physics.js`의 `takrawNetShape(court, physics)`가 court와 물리 설정(`netBottom`·`netHalfThickness`·`post`)에서 네트 판(아래 `bottomY`·위 `topY`·좌우 `halfWidth`)과 기둥 캡슐(`z`·반지름·`bottomY`~`topY`)의 경계를 한 번 정하고, 물리 어댑터(`_buildCourt`)는 그 값으로 충돌체를 만들고 `TakrawView.makeCourt`는 같은 값으로 그물·테이프·기둥을 그립니다. 그물로 보이는 면이 곧 공이 막히는 면이고(이전에는 그림이 아래로 5 cm·좌우로 29 cm 더 컸습니다), 기둥은 물리 캡슐 자리·치수 그대로이며 테이프가 그물 끝에서 기둥 면까지 이어집니다. 카메라가 담는 기둥 위치(`updateCamera`)도 같은 값입니다.
- **코트·네트 치수**는 `TAKRAW_CONFIG.court`가 단일 출처이고 물리의 네트 충돌체도 이를 읽습니다. 물리 설정(중력·공·이동·점프·토스·받기·공중 발차기·블로킹·주발, 선수 몸 제어의 판정 기준·자세·걸음 `drive` 등)은 `config/physics.js`의 `TAKRAW_PHYSICS` 한 곳이 원본이고 `TAKRAW_CONFIG.physics`가 이를 가리킵니다. `TakrawPhysics`는 생성자에서 `takrawPhysicsSettings(config)`로 인스턴스마다 복사본(`structuredClone`)을 만들고 파생값(`airKick.velocityGain = 2√(positionGain·trackingMass)`)만 더합니다. 물리 어댑터는 `TAKRAW_CONFIG`를 직접 import하지 않고 넘겨받은 config만 읽습니다. 선수 제어 단계(`_drivePlayer`)와 공중 발차기·지상 토스 발 목표의 조정값은 이 설정에 이름을 붙여 옮겼습니다. 그 단계들에 남은 숫자는 수학 상수, 몸 치수(엉덩이·발바닥·발목 기준점과 무릎 한계 2.45처럼 `_buildPlayer`가 정하는 값), 관절 자세 배열입니다. 몸 만들기·몸 세우기(`_orientRoot`)·받기 예측(`planReceive`)·받기 충격(`_receiveImpact`)·블로킹·모션 질의의 숫자는 아직 코드에 있습니다.
- **킥 소리 단계·등급 이름**은 `config/runtime.js`의 소리 정의 표에서 파생해 `presentation/sound.js`가 읽습니다(`TAKRAW_KICK_SOUND`).
- **타이밍 등급 이름**(`perfect`·`good`·`normal`)은 `config/game.js`의 `TAKRAW_TIMING_GRADES`가 단일 출처입니다(v0.17.2~). 등급 창(`timing.windows`)·접촉 효과(`visual.impact`)의 키, 판정(`simulation/timing.js`), 킥 소리 등급 표, HUD 등급 표시, 효과 키 고르기가 이 값을 읽습니다. CSS 선택자(`[data-grade='perfect']`)만 같은 글자를 씁니다.
- **역할**은 `config/game.js`가 소유합니다(v0.17.2~): `TAKRAW_ROLE`(id 이름표), `TAKRAW_ROLES`(팀 안 순서, 슬롯 0 리시버·1 세터·2 공격수), `TAKRAW_ROLE_NAMES`(표시 이름 TextPair). 역할별 판단(AI·토스·물리)과 선호 역할 데이터는 `TAKRAW_ROLE.<id>`로 가리키고, 사람이 조종하는 역할은 `simulation/roster.js`의 `TAKRAW_HUMAN_ROLE`입니다. 값(글자)은 스냅샷·저장의 `player.role`·`preferredRole`에 그대로 들어갑니다.
- **물리 설정 키를 두 곳이 함께 읽는 경우**는 같은 지식일 때만 둡니다(v0.17.2 재판단). `drive.landing.airTime`은 착지 무장 조건과 착지 이벤트 조건이 같은 "충분히 떠 있었다" 기준이고, `groundToss.minRise`는 받기 토스와 세트 보정(`assistSet`)이 같은 포물선 계획의 최소 상승이며, `airKick.contact.terminalMax`는 마지막 스트로크 상한과 "다리가 이미 닿아 도달 시간이 상한을 주지 않는" 경우(`qc <= 0`)의 값이 같은 상한이라 나누지 않았습니다. `physics.step`의 `Math.min(dt, 1/60)`은 tickRate가 아니라 Rapier 한 번 적분의 상한이라 tickRate에서 끌어오지 않습니다(코드 주석).
- **같은 뜻의 화면 문구**는 `i18n/messages/shared.js` 한 곳에 두고 PAGE·UI·RUNTIME 표가 가리킵니다.
- **연결 실패 분류**(`connectionCause`)는 gamekit가 코드를 주는 실패를 코드로 먼저 나누고(세션 `failure.type`·`failure.reason`, 방 오류 `Error.code`), 코드가 없는 실패만 메시지 정규식으로 나눕니다. 코드: `version-mismatch`·`handshake-mismatch`·`incompatible-session` → `version`, `desync-unrecoverable` → `desync`, `fatal` → `game`. `desync`·`game`은 연결 사정이 아니라 게임 쪽 실패라 연결 카드에 「게임 상태 불일치」·「게임 실행 오류」로 보이고, 지표는 같은 실패를 `MatchSession.simulationFailed`가 이미 `fault:desync`·`fault:simulation`으로 보냈으므로 연결 원인 이벤트를 다시 보내지 않습니다(v0.17.2, 이전에는 `input-history-mismatch`가 정규식 `mismatch`에 걸려 `unsupported:version`, 나머지 desync·fatal은 `network:other`로 한 번 더 갔습니다). 원인별 문구·단계 이름은 `CONNECTION_CAUSES` 한 표입니다.

규칙 근거는 [bloom-reference 개발 규칙](https://github.com/byh-playground/bloom-reference/blob/main/rules/development.html)의 SSOT·단일 소유권·CQS·Lifecycle·DRY입니다. 정책 자체의 원문은 reference 저장소가 소유합니다.

## 연습·모드 프로필의 소유

- **레슨·토스 정의와 연습 규칙**은 `simulation/training.js`가 소유합니다. `TAKRAW_TRAINING_LESSONS`·`TAKRAW_TRAINING_TEMPOS`는 runtime·ui·`i18n/messages/match.js`가 game.js를 거치지 않고 직접 가져옵니다. 분기는 레슨 id가 아니라 레슨 속성으로 합니다.

| 레슨 속성        | 뜻                                               | 읽는 곳                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prehold`        | 점프 전에 발을 먼저 올려 둔다(내려찍기만 `true`) | `timing.kickError`의 오차 기준, `getAttackGuides`의 발 먼저 올리기 창, 결과 갈래(`values.downward`·`values.prehold`), 사실의 `kickIn`, coach의 순서 안내(`holding`·`downward`·발차기 대기), ui의 시간 표시 |
| `anyMotion`      | 정해진 발차기가 없다(상황에 맞춰 차기만 `true`)  | 결과의 동작 일치(`matches`), coach의 동작 상태 문구(`motionAuto`·`motionLesson`)                                                                                                                           |
| `approachScale`  | 공격 접근 거리 배율(기본 1)                      | `getAttackGuides`의 접근 자리                                                                                                                                                                              |
| `kickDelayScale` | 점프 뒤 발차기 지연 배율(기본 1)                 | `getAttackKickDelay`                                                                                                                                                                                       |

- **토스 정의**(`TAKRAW_TRAINING_TEMPOS`)의 `quick`은 속공 여부입니다. 토스 궤적(`beginRally`의 세터 공급)과 성공 결과 값(`values.quick`)이 tempo id 대신 `TakrawTrainingDrill.tempo(record).quick`을 읽습니다(v0.17.2~). 기록에는 id만 저장됩니다.
- **연습 기록**은 지금처럼 `state.training`(스냅샷·롤백에 포함)이고, 상태 없는 `TakrawTrainingDrill`(`TakrawTimingJudge`와 같은 방식)의 메서드만 그 기록을 만들고 바꿉니다. 언제 부르는지는 game.js가 정합니다: `createRecord`(reset), `clearAttempt`(prepareRally), `startAttempt`(beginRally), `observeSet`(세터 토스 확정·속공 공급), `recordInput`(updateServeToss 뒤·observeTiming 앞), `observeContact`(사람 선수 접촉), `observeStep`(substep마다 confirmToss 뒤), `observeCrossing`(공이 상대 코트로 네트를 넘을 때), `finish`(awardPoint 안·lastMessage 앞).
- **모드 프로필**은 `simulation/modes.js`의 `TAKRAW_MODES`입니다. 저장되는 값은 모드 이름(`state.mode`·`save().mode`)뿐이고 `game.profile`은 이름에서 파생합니다. game.js는 모드 이름을 비교하지 않고 플래그를 읽습니다. 플래그 하나는 한 가지 뜻입니다.

| 플래그           | match         | local        | online       | watch          | training      | 대체한 분기(game.js)                                                                                                                                                                                                                 |
| ---------------- | ------------- | ------------ | ------------ | -------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `humanInput`     | [true, false] | [true, true] | [true, true] | [false, false] | [true, false] | step의 사람 입력 버리기(`match`·`training`은 팀 1, `watch`는 두 팀)                                                                                                                                                                  |
| `secondaryInput` | false         | true         | false        | false          | false         | step의 2P 입력 해석(`local`)                                                                                                                                                                                                         |
| `waitsForPeers`  | false         | false        | true         | false          | false         | applyMembership의 상대 대기 문구, step의 상대 대기 멈춤(`online`)                                                                                                                                                                    |
| `repeatable`     | false         | false        | false        | false          | true          | reset의 고정 시드, tossSpread의 흩어짐 없음                                                                                                                                                                                          |
| `drill`          | false         | false        | false        | false          | true          | 연습 기록 만들기, 레슨·토스 명령(setTrainingLesson·Tempo·step), 같은 공 재시도, 입력·substep 관찰, 세터 공급(beginRally), 시간 초과, 연습 시간(ready·retry)과 문구, getAttackGuides의 소유권 조건 대신 토스 기준, 세터만 움직이는 AI |
| `serve`          | true          | true         | true         | true           | false         | reset의 첫 서브 배치, humanServes, serverId, serveStarts, kickIntent의 서브 목표                                                                                                                                                     |
| `scoring`        | true          | true         | true         | true           | false         | awardPoint의 점수·세트·서브권                                                                                                                                                                                                        |
| `defense`        | true          | true         | true         | true           | false         | step의 받기 배정 다시 판단, 접촉 때 배정 해제, isReceiveBall, assistReceive                                                                                                                                                          |
| `formation`      | true          | true         | true         | true           | false         | decideAI의 대형 자리(fillStance)                                                                                                                                                                                                     |
| `teamPlay`       | true          | true         | true         | true           | false         | getTeamPlay                                                                                                                                                                                                                          |
| `aiTeams`        | [true, true]  | [true, true] | [true, true] | [true, true]   | [true, false] | decideAI의 팀 AI 정지                                                                                                                                                                                                                |

- **연습 안내의 표현**은 presentation이 소유합니다. game.js의 `getTrainingFacts`(= `getView().training`)는 판단 재료(점프·발차기까지 남은 시간, 공중 계획 단계, 안내 플래그, 접촉 요약, 레슨 속성, 결과)만 내고, 단계·문구·색·진행 막대는 `presentation/training-coach.js`의 순수 함수 `takrawTrainingCoach(facts, { maxLead })`가 만듭니다. runtime의 HUD 조립(`runtime/hud-model.js`의 `takrawHudModel`)이 coach를 부르고 `presentation/training-panel.js`의 `update`가 그 결과를 그립니다. 공격 안내의 예측 범위(`getAttackGuides`)는 연습 오차 기록에 들어가는 시뮬레이션 판단이라 아직 `config.visual.attackGuide.maxLead`를 읽습니다.
- runtime·presentation도 모드 이름을 비교하지 않습니다(v0.17.2~). 시뮬레이션 규칙과 같은 지식은 위 프로필을 읽고, runtime·화면에만 있는 뜻은 아래 「모드 정책」 표가 소유합니다.

### 모드 정책(runtime·presentation)

`config/runtime.js`의 `TAKRAW_MODE_POLICY`입니다. 예전 `TAKRAW_RUNTIME.highlight.modes`(리플레이 대상)·`metrics.modes`(경기 기록 대상) 목록은 `replay`·`recorded` 플래그로 옮겼습니다. 모드가 없는 처음 화면은 표에 없으므로 `TAKRAW_MODE_POLICY[mode]?.플래그`로 읽습니다. 플래그 하나는 한 가지 뜻이고, 맡는 모드가 같아도 뜻이 다르면 따로 둡니다(예: `opponentSchool`·`rewards`·`scoreMotion`은 모두 `match`만이지만 셋은 다른 판단입니다).

| 플래그            | match    | local    | online        | watch    | training  | 읽는 곳                                                                                                                                                                                                                       |
| ----------------- | -------- | -------- | ------------- | -------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clubTeam`        | true     | false    | false         | false    | true      | `MatchSession.canStart`(팀 저장 준비), `takrawMatchSetup`의 홈 팀 편성                                                                                                                                                        |
| `ownSchool`       | true     | true     | false         | false    | true      | `takrawMatchSetup`의 내 학교(아니면 기본 학교)                                                                                                                                                                                |
| `opponentSchool`  | true     | false    | false         | false    | false     | `takrawMatchSetup`의 학교 AI·상대 학교, `MatchRecord`의 `schoolId`                                                                                                                                                            |
| `watchSeed`       | false    | false    | false         | true     | false     | 시작 버튼(`runtime.js` `onStart`), `takrawMatchSetup`의 학교·시드, HUD 팀 이름·색과 `watch` 칸, 점수판 시드 입력칸                                                                                                            |
| `loopsFirstPoint` | false    | false    | false         | true     | false     | `MatchSession.observeWatchLoop`                                                                                                                                                                                               |
| `room`            | false    | false    | true          | false    | false     | `localTeam`, `maintainNetwork`, 실행 오류 때 연결 카드, `open`의 세션 종류·어댑터·프로필·연결 카드, `takrawMatchSetup`의 방 코드 시드, HUD `connection`, `MatchRecord`의 `matchId`·`localTeam`, 시작 버튼, 점수판 「나」 표시 |
| `announcesTeam`   | false    | false    | true          | false    | false     | `getInput`의 팀 알림, `render`의 학교 칠하기, HUD 팀 색(알려 온 학교)                                                                                                                                                         |
| `namedTeams`      | false    | false    | true          | true     | false     | 점수판 팀 색 점, 경기 끝 「○○ 승리」 문구                                                                                                                                                                                     |
| `holdsSimulation` | true     | true     | false         | true     | true      | `setPaused`, `open`의 `canAdvance`(일시 정지·리플레이 동안 멈춤), 일시 정지 창 제목·다시 시작 버튼                                                                                                                            |
| `restart`         | 'reopen' | 'reopen' | 'hostCommand' | 'reopen' | 'command' | `MatchSession.restart`, 경기 끝 다시 하기 버튼(방장만)                                                                                                                                                                        |
| `rewards`         | true     | false    | false         | false    | false     | `open`의 `rewards.begin`, `MatchRewards.observe`                                                                                                                                                                              |
| `replay`          | true     | true     | false         | false    | false     | `HighlightController.anchorIfNeeded`·`tryBegin`                                                                                                                                                                               |
| `recorded`        | true     | true     | true          | false    | false     | `MatchRecord.begin`                                                                                                                                                                                                           |
| `scoreMotion`     | true     | false    | false         | false    | false     | 득점 이벤트의 점수 모션 시작(`match-events.js`), `view.js`의 점수 모션 적용                                                                                                                                                   |

runtime·presentation이 읽는 시뮬레이션 프로필 플래그는 다음과 같습니다. 같은 지식이라 새 정책을 만들지 않았습니다.

| 프로필 플래그    | 읽는 곳(runtime·presentation)                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `drill`          | `trainingCommand`, `HudClock`(최소 30Hz), 연습 패널 갱신(`ui.js`), 점수판 연습 칸·세트 칸·랠리 상태(`match-hud.js`)                  |
| `secondaryInput` | 2P 입력 읽기(`local2p`), 등급 배지(두 팀), 점수판 1P/2P 이름·안내·결과, 카메라(두 선수 함께 담기), 받기·공격 안내와 선택 고리(두 팀) |
| `waitsForPeers`  | `controlsAllowed`, `open`의 `canAdvance`·pump 마감(두 사람이 모일 때까지), 시작 지표(두 사람이 모였을 때 남긴다)                     |
| `repeatable`     | `takrawMatchSetup`의 시드(고정 시드라 넘기지 않는다)                                                                                 |
| `scoring`        | 점수판 매치 포인트·듀스 띠                                                                                                           |
| `humanInput`     | 터치 버튼(사람 입력이 없는 모드는 소개영상에서만 보인다)                                                                             |

모드 이름 비교로 남긴 곳은 정체 확인 두 군데입니다: `openDebugMatch`가 경기가 실제로 `match`로 열렸는지 돌려주는 값, `takrawMatchSetup`의 확인용 시드(`debugSeed`, `openDebugMatch`만 넣는다). 점수판의 경기 종류 이름표(모드 → 문구)는 모드별 데이터라 그대로입니다.

## 접촉 타이밍 효과의 경계

시뮬레이션은 사람 선수의 공중 발 접촉마다 `timing: { grade, error }`를 접촉 이벤트에 싣습니다. 등급 창은 `config.timing`, 효과 값은 `config.visual.impact`, 소리는 `config/runtime.js`의 `kick`·`kickGood`·`kickPerfect`·`kickSpike`와 종류별 `kickReceive`·`kickSave`·`kickSet`·`ground`가 소유합니다. 스파이크 여부(`spike`)는 접촉 이벤트에 `game.js`가 한 번 판정해 싣고, 연출·소리·지표가 같은 값을 씁니다. 접촉의 종류(`serve`·`receive`·`save`·`set`·`drive`·`body`·`ground`)는 `runtime/match-events.js`가 이벤트와 그 스텝 뒤 경기 상태(`touches`·`play`)에서 `presentation/impact.js`의 `takrawContactKind`로 한 번 정해 연출·소리·진동이 같은 값을 씁니다(공이 바닥에 닿는 `ground` 이벤트도 접촉처럼 추측 이벤트로 저널에 들어갑니다). 접촉은 화면에 그림을 덧붙이지 않고 다음으로 전합니다: 쇼크웨이브(`presentation/shock-wave.js`: 장면을 직접 그린 뒤 파동이 있을 때만 화면을 텍스처로 복사해 풀스크린 패스 하나에서 띠 안 좌표를 방사 방향으로 밀고 띠를 밝게·어둡게 하며, 공과 그 후광 둘레는 밀지 않고, 반지름 상한(`wave.maxScreen`)에 걸려도 시작 반지름 아래로 줄이지 않으며 밀림이 띠 폭의 `wave.maxSlope`를 넘지 않습니다), 공 눌림·비행 늘어남(외형만, 부피 보존), 접촉 순간 공과 닿은 부위의 반짝임(`flash`, 몸에 맞은 접촉 제외. 선수 부위는 자세 텍스처의 반짝임 값을 셰이더가 emissive에 더하고, 공은 emissive 재질 복제본으로 바꿔 끼운다), 바닥 튕김 때 공 그림자 반응(`shadow`), 표시 전용 히트스톱(`styles.displayHold`: 내 화면의 선수·공 포즈만 멈추고 시뮬레이션·입력·네트워크·효과 시계는 멈추지 않으며 뒤이어 따라잡습니다), 기기 진동(`rumble`, 사용자 조작 팀의 접촉만). 동작 줄이기에서는 왜곡·명암·히트스톱·진동·반짝임·눌림·늘어남을 끕니다(진동을 따로 끄는 설정은 없습니다). 세기는 접촉 속도로 연속 변하며(`intensity`) 왜곡은 `wave.distortPower`로 세기에 가파르게 묶여 약한 접촉(리시브·토스)은 선수 몸이 휘어 보이지 않고 명암만 남습니다. 화면 흔들림은 px 단위로 가장 센 접촉 하나만 쓰며 `visual.shakeCap`을 넘지 않습니다. 스파이크는 친 팀 학교의 속성(`schools.js` `TAKRAW_ELEMENTS`)별 작은 입자 구름(`cloud`배)을 공이 나가는 반대쪽에만 더하며, 설정은 `config.visual.impactElements`(속성별 입자 모양·개수·색·테두리 색, 합 40개 이하·수명 1.2초 이하)가 소유하고 뷰가 학교를 정할 때 `setElements`로 팀별 속성을 전달합니다. 뷰는 매 프레임 공의 화면 원판을 구름에 알려(`setBallMask`) 구름 조각이 그 원판(공 반지름의 `ballMask`배, 눌림·늘어남 포함) 안에서는 그려지지 않으므로 어느 카메라에서도 공이 가려지지 않습니다. 입자는 공 중심에서 `ballMargin` 밖에서 시작하고, 채도 높은 중간 밝기 색과 어두운 테두리(`edge`, `rim` 배율)로 밝은 배경에서 윤곽이 보이며 입자 배치는 tick·sequence 시드로 정하고, 모션 줄이기에서는 입자가 40%입니다. 속성 입자·착지 먼지·득점 색종이는 노드마다 Mesh를 만들지 않고 `presentation/instanced-effects.js`의 InstancedMesh 레이어에 프레임마다 미리 만든 버퍼로 씁니다(색·투명도·모양은 인스턴스 속성, 모양은 한 geometry에 합쳐 정점 셰이더가 고릅니다). 드로우콜은 입자 수·모양·속성 종류와 무관하게 구름 2(테두리·본체)·먼지 1·색종이 1로 고정이고(DEV-034), 레이어 재질은 로딩의 `warmUp`에서 컴파일됩니다. 큰 글자(`pop`)는 스파이크의 "SPIKE!"만 씁니다. 표시 계층은 이 이벤트를 받아 모양만 정하며 시뮬레이션 시간과 공의 움직임을 바꾸지 않습니다.

runtime의 `contact`·`ground` 어댑터(`runtime/match-events.js`)는 `presentation-events`의 `start`·`update(handle, ageMs)`·`reconcile`·`stop`에 `TakrawImpactEffects`를 연결합니다. 효과 모양은 저널이 주는 경과 시간의 함수이고 입자 방향은 접촉 이벤트의 `tick`·`sequence`에서 만든 시드 난수(`simulation/random.js`의 `takrawEventUnits`)입니다. 따라서 롤백 재확정에서 효과가 처음부터 다시 시작하지 않고, 두 피어가 같은 모양을 그립니다. 등급 표시(`#timing-badge`)는 같은 이벤트 수명에 묶여 있고 `ui.showTiming`이 돌려준 토큰으로만 지워집니다.

## 학교 외형

`src/config/schools.js`가 학교 이름·Uniform(주색·보조색·하의·양말)·머리 3종·등번호의 단일 원본이다. 이름과 팔레트는 출시 전 임시안이다. 학교는 속성(풀·불·물·번개·달빛·햇빛·얼음·땅·바람·어둠) 10곳이며 외형만 다르고 난이도는 갖지 않는다. 내 학교는 저장 데이터를 처음 만들 때 한 번 무작위로 정해져 `campaign.home`에 저장되고 상대 목록에서 빠진다. 도전 단계(`TAKRAW_LADDER`, 9단계)가 AI 난이도와 첫 클리어 포인트를 정하고, `takrawOpponents(home)`가 로스터 순서대로 단계를 붙인다. runtime이 세션을 열 때 두 학교를 정하고 view에 전달한다. simulation은 학교 외형을 알지 않으며 저장과 입력 계약은 그대로다. 등번호 6장은 `presentation/player-batch.js`가 아틀라스 한 장(CanvasTexture)에 그리고 종료 시 해제한다. 학교 교체(`setSchools`)는 선수 정점 배열(정점 색·머리 모양)과 번호 아틀라스만 다시 만들고, 재질·자세 텍스처·부위 포즈는 그대로 둔다(설정 시점이라 새 셰이더 컴파일이 없다).

## AI 관전(시드 재생)

- 시드 하나가 AI 대 AI 경기 하나다. `game.reset('ai', undefined, seed)`에서 두 팀 모두 사람 입력이 없다(`game.js`의 `humans.fill(null)`). 팀·성향은 기본값이라 클럽 저장소를 읽거나 쓰지 않는다.
- 진입점은 둘이다. 주소 `?watch=<시드>`는 부팅 직후 바로 관전을 시작하고, 홈의 "AI 관전" 버튼은 마지막 시드(처음엔 소개영상 시드)로 시작한다. 관전 중 입력칸(`#watch-form`)에서 추천 경기(`TAKRAW_RUNTIME.watch.featured`) 선택, 시드 직접 입력, ◀ ▶ 이웃 시드, 랜덤, "처음부터 보기"를 쓴다. 콘솔에서는 `__takraw.watch(seed)`.
- 관전은 그 시드의 **첫 1점**만 보여준다. 득점 뒤 `loopHoldMs`(2.5초) 동안 결과를 보여주고 같은 시드를 처음부터 다시 연다. 다음 서브로 넘어가지 않는다. 소개영상도 같은 반복이다. 확인용 장면(`scene=watch`·`spike`)은 `startWatch(seed, { repeat: false })`로 이 반복을 끄고 요청한 `tick`까지 경기를 이어 간다(v0.17.2~, 이전에는 첫 1점 뒤 다시 열려 tick 0을 보고했다).
- 두 학교(화면의 속성·유니폼)는 `takrawWatchSchools(seed)`가 시드로만 정한다. 같은 시드는 같은 화면이다.
- 소개영상 시드는 `TAKRAW_RUNTIME.watch.showcaseSeed`(SSOT)다. 이 시드(v0.17.0~ 1252)는 터치 수 11, 받아내기 3번, 득점 틱 844(팀 0, 스파이크 결정타)이고 사람 입력이 있어도 같은 랠리를 재현한다.
- 아슬아슬한 받아내기 후보는 시드를 일괄 시뮬레이션해 스파이크 직후 상대 터치의 낙하 여유 시간(공이 지면에 닿기까지 남은 시간)이 짧은 랠리로 골랐다. 나머지 추천 경기는 관전이 첫 점만 보여 주므로 첫 점 랠리로 고른다: 스파이크 결정타로 끝나고 두 팀 모두 스파이크했고 받아내기 3번 이상인 랠리 중 터치 + 2×받아내기가 큰 순서(v0.17.0, 시드 0~3000).

## 소개영상(도움말 대체)

- 기존 도움말 대화상자는 없앴다. 헤더의 `?`와 홈의 "▶ 소개 보기"가 게임킷 `installShowcase`(`@bloom-gamekit/scenario`)를 연다. 주소 `#/showcase`로도 열린다.
- 호스트가 같은 주소의 격리 iframe(`?showcaseDemo=1`)을 만들고, 그 안의 게임이 관전 모드로 소개영상 시드(1252) 랠리를 실제로 시뮬레이션한다. 영상이 아니라 실제 게임 화면이다.
- `?showcaseDemo=1`은 격리 장면이라 모든 저장(팀·소리 설정·방 복귀)이 메모리 어댑터로 간다(위 `저장` 절). 메뉴·입력을 숨긴다(`body[data-showcase]`).
- 문구는 장마다 한 줄이고 조작 장치 이름을 쓰지 않는다. 설명은 화면이 한다: 소개영상 안(`body[data-showcase]`)에서만 영상 속 공격수가 점프·발차기를 누르는 동안 그 기기의 눌림 표시(PC 표시등 `.drive-feedback`, 모바일 터치 버튼 `is-down`)가 켜지고, 자막 영역에 가리지 않게 위로 올린다. 모바일 터치 버튼은 코트를 덜 가리도록 오른쪽 끝에 발차기 위·점프 아래로 세로로 쌓는다. 일반 경기의 조작 표시는 바뀌지 않는다.
- 랠리 문구는 시간이 아니라 경기 틱에 맞춘다. `src/config/intro.js`가 문구와 틱의 SSOT, `intro-script.js`가 "틱까지 기다리기 → 문구 바꾸기" 항목을 만든다(호스트는 `custom`이 false를 돌려주면 재시도). 득점 뒤 시스템 소개(동료 영입·편성과 훈련·도장깨기)는 관전이 랠리를 다시 열어 틱이 되돌아가므로, 바로 앞 장이 뜬 뒤 `afterMs`가 지나면 바뀐다. 호스트는 예정보다 6초 넘게 밀린 항목을 버리므로, 느린 기기에서 득점 틱 기다림이 버려지면 다음 `afterMs`는 그 장이 뜬 뒤(첫 시도)부터 잰다.
- 장의 `show`는 문구 직전에 게임 화면을 띄운다. 영입 장(`show: 'draw'`)은 실제 뽑기 연출(카드팩 → 뒷면 → 공개, `ui.showcaseDraw`)을 `intro.drawCard` 프리셋 영웅으로 띄우고 다음 장(`show: 'none'`)에서 닫는다. 저장은 하지 않는다. 소개영상에서는 카드가 스스로 뒤집히고 건너뛰기·확인 버튼과 "눌러서 뒤집기"는 숨긴다. 관전이 랠리를 다시 열어도(`showGame`) 대본이 닫을 때까지 남는다. 런타임 진입점 `__takraw.showcase(scene)`은 `?showcaseDemo=1`에서만 동작한다.
- 단계 수처럼 앞으로 볼 내용은 문구로 밝히지 않는다(기대감 유지). 도장깨기는 "이기면 다음 학교가 나타난다"로 게임 화면의 잠긴 다음 학교와 같은 방식으로 말한다.
- 소개영상이 열려 있는 동안 뒤에서 진행 중이던 경기는 멈추고 닫으면 이어진다.
- 시드를 바꾸면 `intro.js`의 틱 표를 다시 맞춰야 한다.

## reset 결정성(같은 시드는 언제나 같은 경기)

- 문제: `game.reset()`이 몸과 공을 제자리로 옮기기만 해서 Rapier 월드 내부 상태(접촉 캐시·광역 단계 구조)와 물리 시계가 이전 경기에서 넘어왔다. 같은 시드·같은 입력이라도 reset 횟수에 따라 틱 1부터 결과가 달랐다(v0.16 이전 난수 기준: 시드 36의 첫 받아내기가 새 게임에서는 틱 436, 사용한 게임에서는 437). 저장 상태도 달랐다(`physics.time` 0 대 13.3초, 월드 직렬화 101,741 대 127,290바이트).
- 락스텝 영향: 스냅샷 저장·복원(롤백·합류) 경로는 처음부터 결정적이다. 어긋나는 경우는 한 피어가 이미 다른 경기를 한 `game` 인스턴스로 온라인 경기를 시작하고 상대는 새 페이지인 경우처럼, 두 피어의 reset 이력이 다를 때다.
- 수정: reset(첫 생성 직후 제외)이 `TakrawPhysics.rebuild()`로 물리 월드를 새로 만든다. 선수 프로필은 유지하고 시계·토스 계획·`rallyStart`는 새 인스턴스와 같게 돌린다. 비용은 reset 한 번에 약 8ms다.
- 불변식: 몇 번째 reset이든 새 인스턴스와 같은 경기를 하고, 초기 `save()`가 바이트까지 같다.

## 시작 틱 독립성(호스트가 넘기는 tick에 경기가 묶이지 않는다)

- 문제: AI 갱신 주기를 `frame.tick % N`으로 정해, 호스트가 step을 부르는 첫 tick에 따라 갱신 위상이 달라졌다. 게임킷 세션은 틱 0부터, 시뮬레이션 도구와 테스트는 틱 1부터 돌려 같은 시드가 다른 경기가 됐다(v0.16 이전 난수 기준 시드 1013: 틱 1 시작은 틱 831에 팀 0 득점·스파이크 5번, 틱 0 시작인 브라우저는 틱 404에 팀 1 득점·스파이크 0번). 시드 탐색 결과가 브라우저 장면과 달랐던 원인이다.
- 수정: 주기를 경기 안 스텝 수(`metrics.logicSteps`, reset에서 0, save/load 포함)로 정한다. 첫 스텝이 1이라 기존 노드 결과(시드 탐색·소개영상 대본)는 그대로다.
- 불변식: 같은 시드는 첫 tick이 몇이든 같은 경기다. 게임 규칙에서 `frame.tick`은 이벤트 표시와 재시작 시드에만 쓰고 확률·주기 판단에 쓰지 않는다.

## 시드 난수(v0.17.0~, D-313)

- 생성기는 gamekit `deterministic`의 `statelessRandom`·`SeededPRNG` 하나다. 게임은 직접 만든 섞기·해시를 두지 않는다. `simulation/random.js`는 uint32를 [0, 1)로 바꾸고 키를 묶는 이름 세 개만 둔다.
    - `takrawSeededUnit`: 상태 없는 시드 난수 `(seed, ...keys) => [0, 1)`. 키마다 `statelessRandom(앞 값, 키)`를 이어 적용한다. AI 성향(`ai-brain.js Temperament`), AI 서브 모으는 시간, 토스 흩어짐, 다시 시작 시드가 쓴다.
    - `takrawEventUnits`: 확정 경기 이벤트의 `tick`·`sequence`에서 만든 `SeededPRNG` 난수열. 접촉·착지·색종이 효과가 쓴다.
    - `takrawUnitStream`: `SeededPRNG` 하나의 [0, 1) 난수열. 확인용 `club` 장면이 시드로 클럽을 만들 때 쓴다.
- 키는 0 이상 uint32 정수다(아니면 gamekit이 `RangeError`). 정수 연산만 쓰므로 부동소수 연산 순서에 기대지 않는다.
- 온라인 경기 시드는 방 코드 문자열의 UTF-8 바이트를 gamekit `hashBytes`(FNV-1a)로 만든다. 문자열을 바이트로 바꾸는 일은 표준 `TextEncoder`라 gamekit에 따로 두지 않는다.
- 시뮬레이션은 import map이 없는 득점 리플레이 워커에서도 돌아서 `@bloom-gamekit/*`를 직접 import하지 않는다. `TakrawGame`은 RAPIER처럼 `deterministic` 모듈을 생성자 인자로 받는다(`new TakrawGame({ RAPIER, config, deterministic })`).
- 재현하지 않는 난수는 대상이 아니다: 뽑기·내 학교(`club.js`, `crypto.getRandomValues`), 혼자 하는 경기의 시드·4자리 방 번호·경기 기록 id(`runtime/match-session.js`·`match-record.js`, `crypto`), 소리 변주(`Math.random`, 표시 전용), 관전 "랜덤" 버튼(`match-hud.js`, `Math.random`).
- v0.17.0에서 생성기가 바뀌어 같은 시드의 경기 전개가 달라졌다(확률·범위는 그대로). 명경기·소개영상 틱 표·아이콘 장면을 새 난수로 다시 골랐다.

## 경기장 꾸밈은 보는 사람의 상대 학교 기준

- 문제: 현수막·바닥(코트)·관중 색이 팀과 상관없이 어웨이(팀 1) 학교와 `x=+7.8`에 고정돼 있었다. 2P 카메라는 `+x` 쪽에서 `-x`를 보므로 현수막이 카메라와 코트 사이에 서서 시야를 가렸다.
- 규칙: `TakrawView.setViewTeam(team)`이 보는 팀을 받아 꾸밈의 기준 학교를 상대 학교로 바꾼다(1P는 팀 1 학교, 2P는 팀 0 학교). 현수막 묶음(`bannerRig`)은 2P에서 y축으로 180도 돌려 상대 코트 뒤(`x=-7.8`)에 두고 글자 순서도 화면 기준으로 유지한다.
- 시뮬레이션·네트워크 상태는 건드리지 않는다. 화면 전용이며 `updateCamera`가 매 프레임 호출한다.

## 사운드: 변주된 타격음과 배경 음악

- 소리 선택은 `src/presentation/sound.js`의 순수 함수다. 발차기는 스파이크 > 발이 아닌 몸(`kickBody`) > 발(공 속도 3단계 × 타이밍 등급 3개)로 고른다. 레시피는 `config/runtime.js`의 `KICK_LEVELS`·`KICK_GRADES`가 만든다(`kickSoft`…`kickHardPerfect` 9종 + `kickBody` + `kickSpike`).
- 발차기 한 번은 네 층이다: 낮은 쿵(무게), 중음 몸통(삼각파, 작은 스피커에서도 들리는 울림), 슬랩과 클릭(발이 닿는 "탁"). 사인파 하나였던 이전 소리는 2kHz 위 에너지가 0이었고 단계별 음량 차이가 2dB뿐이었다. 컴프레서(threshold -10, ratio 3)를 풀어 소프트→스파이크가 약 8dB 벌어진다. 득점 신호는 일반 타격보다 크게 둔다.
- 재생 변수: `pan`은 소리가 난 위치(화면 오른쪽이 1P는 +z, 2P는 -z)에 `soundPanSpread`를 곱한 값, `detune`은 매번 ±`soundDetuneCents`(150), 음량은 보는 사람에게서 먼 코트 끝일수록 `soundDistanceDrop`(35%)까지 작아진다(1P는 +x가 먼 쪽, 2P는 -x). 득점·서브 신호는 음정이 있어 가운데에서 변주·거리 감쇠 없이 낸다. 난수는 표시 전용(`Math.random`)이며 시뮬레이션·롤백 상태와 무관하다. 롤백으로 같은 이벤트가 다시 나와도 저널이 같은 식별자의 중복을 버려 소리는 한 번만 난다.
- 관중 환경음은 넣지 않는다. 합성 노이즈로 만든 군중 소리는 두 차례 시도(v0.12.69 저역통과, v0.12.70 밴드패스 6겹) 모두 바람·쉬익 소리처럼 들려 v0.12.71에서 뺐다.
- 배경 음악(v0.12.72~, 게임킷 audio buffer 베드): CC0 "Head in the Sand"(`assets/audio/head-in-the-sand.ogg`, 출처는 `assets/audio/CREDITS.md`)를 첫 제스처 뒤로 홈에서도 경기 중에도 작게 깐다. 오디오 잠금 해제 뒤(`unlockAudio`, 문서 전체의 첫 pointerdown·keydown에서도 불린다) 곡을 한 번 읽어 디코드하고 `setBuffer('bgm')`로 등록한 다음 `startBed('bgm')`로 켠다. 읽기·디코드가 실패하면 한 번만 기록하고 음악만 빠진다(재시도 없음). 크기는 `bgmLevel()`: 홈 `homeLevel`(0.9), 경기 중 `level`(0.7), 일시정지·소개영상 `pausedLevel`(0.35). **곡 원본을 최대한 그대로 쓰고 이퀄라이저만 조금 다듬는다.** 컴프레서로 크기를 고르게 하고(v0.12.73) 로우패스로 노이즈를 누르는(v0.12.74) 처리는 오히려 거칠게 들린다는 피드백으로 v0.12.76에서 뺐다. 곡의 0~3초와 20~22초(루프 중간)는 노이즈 채널 퍼커션이라 도입부와 브레이크가 본체보다 작고(약 8~10dB) 에너지의 25~27%가 40Hz 아래 초저음이다(본체 6%). 초저음은 작은 스피커가 못 내고 찌그러짐만 만들며 마스터 컴프레서도 누르므로 소리의 인상을 바꾸지 않는 80Hz 로우컷(`lowCutHz`)을 건다. 여기에 게임킷 v0.32.0의 `eq`로 노이즈 구간의 중고음만 덜어 낸다(700Hz -3dB, 1.4kHz -5dB, 2.5kHz 이상 -6dB, 청취로 고른 "C" 설정). 본체는 이 대역에 에너지가 거의 없어 -0.6dB만 달라지고 도입부 2kHz 이상은 약 -6dB 줄어든다. 곡의 멜로디가 타격음 몸통과 같은 200~400Hz에 있어 필터로는 겹침을 못 줄이므로, 타격 순간에 음악을 잠깐 낮추고(`duckBgm`, 득점은 더 깊고 길게) 타격음이 묻히지 않게 한다. 관전 재시작과 홈↔경기 이동에서는 끊기지 않고 크기만 부드럽게 바뀐다. 효과음 설정을 끄면 master가 0이라 같이 꺼지고 켜면 이어진다.

## 득점 리플레이(v0.13.8)

- 명장면 득점(스파이크 결정타, 또는 터치 `longRallyTouches` 이상 랠리) 뒤 `tailTicks`가 지나면 경기를 멈추고 그 장면을 자동 재생한다. 화면 탭·건너뛰기 버튼·Space/Enter/Esc로 건너뛴다. 끝나면 득점 뒤 대기부터 이어 가며 멈춘 시간은 따라잡지 않는다. 혼자 하는 AI 대전과 2P(`modes`)만 하고, 온라인은 상대와 시계를 맞춰야 해 멈출 수 없으므로 제외한다. 수치는 `TAKRAW_RUNTIME.highlight`가 소유한다.
- 원본은 **경기 시작 상태 + 매 틱 입력**이다. 첫 스텝 직전 `game.save()` 바이트를 기준점으로, 실제 경기도 그 바이트에서 `load`해 둔다. 새로 만든 물리 월드와 스냅샷에서 되살린 월드는 계산이 달라지므로 두 경기를 같은 출발점에 두는 것이다(락스텝 합류와 같은 방식). 세션이 상태를 불러오거나 바꾸면 기준점을 다시 잡는다.
- 재계산은 Web Worker(`highlight-worker.js`)의 그림자 경기(`TakrawHighlightShadow`)가 한다. 메인 스레드는 입력을 넘기고 명장면 판정과 받은 포즈 재생만 한다. 워커에는 import map이 없어 Rapier·코덱 주소를 런타임이 `import.meta.resolve`로 풀어 넘긴다. 워커를 못 쓰면 리플레이 없이 진행한다.
- 대기 없는 재생: 재생 구간은 끝에서 `leadTouches`번째 터치의 `leadTicks` 앞이거나 득점 `maxSeconds`초 전이다. 그래서 지금까지의 터치와 현재 틱만으로 "앞으로 어떤 재생 구간도 이 틱보다 앞서 시작하지 않는다"는 경계(`safeTick`)를 알고, 그림자 경기는 거기까지만 미리 계산한다(받은 입력 중 그 경계 이하를 모두). 득점이 나면 구간 시작부터 바로 계산해 4틱씩 보내므로 첫 장면은 수십 ms 안에 온다. 매 틱은 한 번씩만 계산되어 워커의 비용은 실제 경기 한 번만큼이다. 워커가 `stallMs` 동안 장면을 보내지 않으면 재생을 끝낸다.
- 재생 화면: 틱 사이 포즈를 보간하고, 스파이크 앞뒤(`slowBefore`~`slowAfter`)는 `slowRate` 배속이다. 카메라는 사용자 시점을 바꾸지 않고 재생 동안만 측면 중계 각도(`camera`)로 본다. 득점 슬로(`scoreMotion`)·조작 안내·결과 창은 재생 중 숨긴다. 그림자 경기는 게임 상태·저장 형식에 아무것도 쓰지 않는다.
- 재생 중 접촉 화면 이펙트(v0.17.5): 그림자 경기가 재생 구간의 `touch`·`ground` 이벤트를 포즈 묶음과 함께 보내고(`events`, 접촉 종류를 고르는 데 쓰는 스텝 뒤 `touches`·`play`를 `after`로 동봉), `TakrawHighlight.frame()`이 재생 시각(`replay.at`, 틱)과 이벤트 목록을 화면 상태에 싣는다. 뷰의 `TakrawReplayImpacts`(`presentation/replay-impact.js`)가 이를 읽어 `TakrawImpactEffects.startReplay`로 파동·명암, 공·발 반짝임, 공 눌림·늘어남, 속성 구름을 띄운다. 경과 시간은 실제 시간이 아니라 재생 시각에서 나오므로 슬로모션이면 이펙트도 같이 느려지고 일시 정지하면 멈춘다. 표시 히트스톱·기기 진동·화면 진동·화면 확대·"SPIKE!" 글자·접촉 소리는 리플레이에서 내지 않는다(표시 저널을 거치지 않는다). 재생이 끝나 `replay` 상태가 없어지면 남은 이펙트를 바로 거둔다. 시뮬레이션·상태 해시는 건드리지 않는다.
- 확인용 장면 `?debug=1&scene=match&seed=N[&every=1]`은 시드를 고정한 AI 대전을 실제 시간으로 연다. `every=1`이면 모든 득점을 리플레이한다(판정 기준만 낮춘다). 워커가 다시 만든 재생 구간의 공 위치는 실제 경기와 비트 단위로 같아야 한다.

## 확인용 주소 장면

`?debug=1&scene=<이름>&…`은 실제 저장을 읽지도 쓰지도 않는 격리 장면이다(위 `저장` 절). 장면 정의는 `src/debug-scenes.js`이고, 사람이 화면을 보며 찍지 않고 같은 주소·뷰포트로 전후를 비교하는 관찰 수단이다. `watch`·`spike`는 경기 전체 상태(`game.save()`를 코덱으로 인코딩한 바이트)의 gamekit `hashBytes`를 장면 `hash()`로 낸다(runtime이 `stateHash` 조회 함수로 넘긴다). 명령줄 실행기 `scripts/debug-scene.mjs`(gamekit debug-tools `runDebugScene`, `gamekit.lock.json` `tools`에 고정)가 두 체크아웃의 같은 주소를 열어 이 해시를 나란히 낸다(README 「검사」).

| scene   | 파라미터                                       | 열리는 것                                                                                                                                     |
| ------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `watch` | `seed`, `tick`                                 | 시드 하나의 AI 관전을 가상 시계로 `tick`까지 진행한다. `__bloomDebug.state()`로 tick·점수를 읽는다.                                           |
| `spike` | `seed`, `tick`, `camera=x,y,z,tx,ty,tz,fov`    | `watch`와 같은 재생을 고정 카메라로 그리고 HUD를 숨긴다.                                                                                      |
| `match` | `seed`, `every=1`(선택)                        | 시드를 고정한 AI 대전을 실제 시간으로 연다. `every=1`이면 모든 득점을 리플레이한다.                                                           |
| `club`  | `seed`, `credits`·`draws`·`unreadable=1`(선택) | 시드로 만든 새 클럽(메모리 저장)의 팀 관리 화면. `unreadable=1`은 옛 형식 저장이 있어 읽지 못한 저장의 **기록 지우고 새로 시작** 화면을 연다. |
