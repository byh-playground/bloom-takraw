# 2단계 학교별 체육관 (v0.12.24)

각 학교는 `venue` 데이터를 가진다. 코트 두 면·라인·관중 셔츠 목록·안개·현수막 문구는 `src/config/schools.js`에서 관리한다. 경기장은 상대 학교 것을 사용하며 view만 읽는다. 학교명과 팔레트는 임시값이다.

기존 관중은 몸 25개와 머리 25개를 각각 담은 InstancedMesh 두 개를 유지한다. 추가 메시 3개는 코트 뒤 학교 현수막이다. 현수막 canvas texture와 재질은 학교·문구별로 캐시하고 view 종료 시 기존 자원 해제 경로로 정리한다. 코트 재질은 역할별로 분리해 유니폼이나 일반 재질 캐시의 색을 바꾸지 않는다.

`artifacts/school-02/`에 5개 체육관 × 1280×800·390×844 캡처와 `evidence.json`을 보존한다. 학교 교체 전후 save JSON 동일 여부, 현수막 3개, 관중 인스턴스 수, scene mesh 수와 draw call을 함께 기록한다. Chromium headless 소프트웨어 렌더링이며 실제 기기·GPU 부하는 미검증이다. draw call은 정지 화면 관측치이고 성능 벤치마크가 아니다.

표시 데이터·view와 PATCH 버전만 변경한다. simulation 및 lockstep 입력 코드는 변경하지 않는다. 지정 3검사를 실행하며 기존 `user-flow.spec.js:104` 공격률 실패만 사용자 승인 예외로 처리한다. 정확한 검사 결과·head·측정값은 PR 본문에 기록한다. 공격률 assertion 뒤의 Nostr/WebRTC 흐름은 미검증이며 후속 확인 대상으로 유지한다.
