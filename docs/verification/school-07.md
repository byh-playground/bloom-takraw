# 7단계 경기 상황 표시 (v0.12.29)

점수와 세트 수를 읽는 순수 표시 함수로 매치포인트와 6:6 듀스를 표시한다. 종료 화면은 승리·패배와 도전한 학교 이름을 보여 주며, 실제 저장 완료 상태에서만 CLEAR를 표시한다. 저장 실패는 재시도 상태를 유지한다. 학교 색은 schools.js의 유니폼 주색을 사용한다.

`artifacts/verify-match-status.mjs`는 정지한 게임의 HUD 입력만 교체하여 매치포인트·듀스·승리/CLEAR·패배를 확인한다. desktop 4장과 390×844 1장은 `artifacts/school-07/`에 있다. 전후 game.save() 문자열이 동일했다. 실제 경기를 자동으로 승리시킨 검사는 아니며 실제 기기와 온라인 경기는 미검증이다. 시뮬레이션과 lockstep 입력 코드는 변경하지 않았다.

`npm run check`와 `npm run verify:dependencies`는 통과했다. `npm test`는 31개 통과, 11개 생략, 기존 공격 성공률 0.70 < 0.80 assertion 한 건 실패했다. 이 한 건만 사용자 승인된 머지 예외이며 기준과 난수는 유지한다. 원본은 `artifacts/school-07-test.log`, `artifacts/school-07-final-test/`에 보존한다.
