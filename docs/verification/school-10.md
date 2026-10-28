# 10단계 경기 효과음과 관중 (v0.12.32)

기존 kickSpike 소리와 point의 확정 이벤트 재생 경로를 재사용한다. 득점 소리 레시피에 짧은 합성 함성을 섞었고, 매치포인트 점수이면 같은 단일 재생 요청을 matchPoint 레시피로 바꾼다. 별도 득점 소리 이벤트를 추가하지 않아 중복 재생하지 않는다. SPIKE 팝업·착지 먼지·색종이도 기존 구현을 유지한다.

기존 AudioPlayer의 최초 pointerdown/keydown 이후 unlock과 설정의 음소거를 유지한다. 관중은 기존 몸통·머리 InstancedMesh 각 25개에서 y행렬 값만 바꾼다. 최대 0.15m·500ms의 짧은 점프는 임시 연출 값이며 종료 시 원래 행렬을 정확히 복원한다. 효과 축소에서는 비활성이고 세션 교체 시 초기화한다. 시뮬레이션과 입력을 변경하지 않는다.

`artifacts/verify-school-feedback.mjs` 실제 브라우저 검증: 첫 입력 전 AudioContext locked·재생 거절, 시작 버튼 후 running. 동일 고정 라이브러리/설정으로 만든 검증용 플레이어에서 kickSpike·point·matchPoint 각 1회 실제 WebAudio 소스 생성 성공, 음소거 중 거절. 제품 설정 UI의 runtime.muted true→false도 확인했다. 직접 귀로 들은 음질과 실제 기기의 출력은 미검증이다. 실제 경기 득점 재현과 구분한 레시피·표시 fixture다.

관중 높이 최대 0.15000004m, 몸통/머리 차이 1e-6 미만, 원래 행렬 복원, 효과 축소 비활성 확인. draw call 280→280, scene 자식 수 238→238, 인스턴스 25+25 유지. game.save와 입력 바이트가 전후 동일했다. `artifacts/school-10/evidence.json`, `crowd-jump.png`와 feedback.log에 보존한다. 실제 기기 음질·실제 경기 전체 연출은 머지 후 확인 대상이며 기존 공격 오류는 별도 PR21 draft로 남긴다.

check·verify:dependencies 통과. 최종 npm test는 31개 통과·11개 생략·기존 공격률 0.70 < 0.80 한 건 실패했다. 기존 실패만 사용자 승인된 예외이며 기준·난수는 유지했다. 최종 diff에서 관중 트리거를 접촉에서 확정 득점으로 바로잡은 뒤 check·전체 테스트를 재실행했다. 수정 전 결과는 school-10-before-review-test, 최종 결과는 school-10-final-test에 artifacts/e2e 원본 그대로 보존한다.

5단계 원자료·설정은 그대로 유지하고 사용자 수용 결정만 해당 문서에 정정했다. 0.40 목표 미달은 역사적 사실로 남기되 추가 조정은 필수 후속 항목이 아니다.
