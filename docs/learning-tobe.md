# 동료 AI 학습: 이어서 할 일 (TOBE)

2026-10-27 기준. 코드에는 `TOBE(learning)` 주석으로 각 지점을 표시했다. 찾기: `grep -rn "TOBE(learning)" src scripts`

## 현재 상태 (AS-IS)

**v0.12.16부터 학습 기능은 화면과 경기에 연결되어 있지 않다.** 학습 화면(버튼·대화창·CSS), 런타임의 학습 실행(`learningAction`), 경기 시작 시 정책 적용을 제거했다. 남긴 것은 아래 데이터·학습 계층이다.

- 남김: `src/learning/` 전체, `game.setTuning/setTuner/applyTuner/releaseTuning`, 클럽 레코드의 선택 필드 `learning`과 `club.learn()/learnedPolicy()`(저장 형식 호환 유지), 벤치 스크립트, 시험.
- 제거: `ui.js`의 학습 화면, `app.css`의 학습 화면 스타일, `runtime.js`의 `learningAction`·`onLearning`·경기 시작 시 `game.setTuner`.
- 복구: 제거 직전 전체 구현은 커밋 `aef3a60`(v0.12.15)에 있다. `git show aef3a60:src/presentation/ui.js`, `git show aef3a60:src/runtime.js`, `git show aef3a60:styles/app.css`로 학습 화면과 연결부를 그대로 꺼낼 수 있다. 화면은 새로 설계해도 된다.

**v0.12.22 추가:** 경기 단위(랠리마다 조정 값 8개를 뽑아 득실로 갱신) 학습 코드 `src/learning/match/`와 벤치 `scripts/match-learning-bench.mjs`를 넣었으나, 득점률 0.472(대조군 0.500)로 경기에는 연결하지 않았다. 상세와 다음 시도는 [verification/match-learning.md](verification/match-learning.md).

아래는 v0.12.15까지의 동작과 측정이다.

- 기능은 동작한다: 훈련 포인트 1 P → 스파이크 받기 100번 학습 → 4비트 저장 → 로컬 AI 대전의 우리 팀에 적용(v0.12.13~14).
- 그러나 경기 득점률이 규칙 AI보다 낮다: 스탯 5 → 0.444, 스탯 20 → 0.462(기준 0.500, 표준오차 약 0.5점/판). 상세는 [verification/learning-feature.md](verification/learning-feature.md).
- 선형 대 MLP 32×2는 차이가 없었다([verification/learning-core.md](verification/learning-core.md)). 정책 구조는 문제가 아니다.

## 해야 할 일 (우선순위 순)

| 번호 | 일 | 코드 위치 | 완료 기준 |
| --- | --- | --- | --- |
| ① | 학습 장면을 경기와 가깝게: 받는 선수(역할·위치), 공 속도·낙하점·출발 높이 분포를 경기에서 관측한 분포로 넓힌다 | `receive-task.js` `RECEIVE_SCENE`, `game.js` `applyTuner` | 경기 득점률 ≥ 0.50 (스탯 20, 48판, 표준오차 안) |
| ② | 보상을 득점에 가깝게: 동료의 다음 접촉·공격 결과까지 굴려 보상에 포함 | `receive-task.js` `_judge` | ①과 같은 지표에서 ②가 ①보다 높음 |
| ③ | 학습 화면을 다시 만들 때 경기 지표를 넣거나 문구를 '장면 성공률'로 한정 | `teammate.js`, (복구할 때) `ui.js` | 화면 숫자가 가리키는 대상이 문구와 일치 |
| ④ | 경기 적용 연결 복구: 득점률 ≥ 0.50이 확인된 뒤에만 `openSession`에서 `game.setTuner(0, TeammateLearning.tuner(policy))`를 건다 | `runtime.js` `openSession` | 득점률 ≥ 0.50 확인 |
| ⑤ | 온라인 적용: 양쪽 가중치 해시 교환, 불일치 시 규칙 AI | `runtime.js`, 네트워크 핸드셰이크 | 두 브라우저에서 같은 정책일 때만 적용 |
| ⑥ | 학습 포인트를 능력치 훈련 포인트와 분리할지 | `club.js` `TAKRAW_CLUB_RULES.learning` | 결정 기록 |

그 밖의 미해결: 브라우저 E2E와 학습 화면 렌더링 확인, 휴대폰 학습 시간, 학습 중 샘플 장면 재생(고스트), `reset` 재사용 시 물리 상태가 남는 원인, 브라우저 간 추론 결과 일치 확인.

## 측정 방법

```
# 정책 학습만 하고 저장 (스탯 5·20, 시드 1)
RAPIER_MODULE=<rapier3d-compat/dist/rapier.mjs> CACHE=policies.json TRAIN_ONLY=1 STATS=5,20 node scripts/learning-match-bench.mjs
# 저장한 정책으로 경기 득점 비교 (24조건 × 좌우 2판, 판당 180초)
RAPIER_MODULE=... CACHE=policies.json EVAL=20 MATCHES=24 node scripts/learning-match-bench.mjs
# 장면 성공률 비교 (선형·MLP 선택)
RAPIER_MODULE=... ALGO=reinforce|ac [HIDDEN=32,32] STATS=1,5,20 node scripts/learning-bench.mjs
# 단위·통합 시험
RAPIER_MODULE=... npx playwright test learning-feature learning.spec
```

- 판정 기준은 항상 경기 득점률이다. 장면 성공률만 오른 결과는 완료로 치지 않는다.
- 대조군(조정값이 기본값과 같은 정책)은 0.500이어야 한다. 아니면 측정 장치를 먼저 고친다.
- 소요 시간(2코어): 스탯 20 학습 약 10분, 득점 비교 48판 약 16분.

## 코드 지도

| 책임 | 파일 |
| --- | --- |
| 범용 강화학습(정책·알고리즘·양자화·트레이너) | `src/learning/core/`, `src/learning/trainer.js` |
| 조정 값 정의(SSOT) | `src/learning/takraw/tuning.js` |
| 학습 장면·관측 | `src/learning/takraw/receive-task.js`, `observation.js` |
| 학습 한 번(학습·평가·저장 형식·경기용 조정기) | `src/learning/teammate.js` |
| 게임 접점(`setTuning`, `setTuner`, `applyTuner`, `releaseTuning`) | `src/simulation/game.js` |
| 저장·비용 규칙 | `src/club/club.js` (`TAKRAW_CLUB_RULES.learning`, `learn`, `learnedPolicy`) |
| 학습 실행·경기 적용 연결, 학습 화면 | 제거됨(복구: 커밋 `aef3a60`) |
