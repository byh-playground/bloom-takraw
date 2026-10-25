# bloom-reference 기준 정렬

2026-10-25. 기준 게임 커밋은 `28062aa1726568f466acffc3f99ec4bca7bdab95`, 확인한 bloom-reference 원문은 `7a6fe0f3c6e5de39109eb02f08603b3b0965532e`입니다. 제품 버전은 내부 구조 정리 범위에 맞춰 0.12.7을 유지합니다. 공개 배포·Stable 승격·태그 발행은 수행하지 않았습니다.

## 적용한 차이

- **SSOT/SingleWriter:** 런타임의 연결 snapshot과 UI 사본 사이에서 진단 로그가 늦게 반영되던 경로를 단일 갱신/읽기 전용 표시로 정리했습니다. HTML에 남아 있던 이전 클럽의 선수·재화·전적 사본도 제거했습니다.
- **CQS/Lifecycle:** 렌더 경로의 연결 복구·시간 초과 처리를 기존 GameKit deadline pump로 옮겼습니다. 별도 timer나 engine wrapper는 추가하지 않았습니다. 같은 기능의 상태를 connection의 handshake/warning/retry/maintenance에 묶고 시간 단위를 명시했습니다.
- **명시적 상태와 DRY:** 준비 여부를 부팅 단계에서 파생하고 UI와 실행 명령이 같은 시작 정책을 읽습니다. 문구가 비었는지에 따른 준비 판정, 중복 상태명 표, 사용하지 않는 build 필드와 부팅 분기, 중복 reload 리스너를 정리했습니다.
- **원본 실행/검증 정책:** dist 생성과 내부 비교·단위·장시간 검사 실행 코드를 제거했습니다. 정적 검사는 소스 문법/참조 검사 명령이며, 영구 테스트는 사용자 시나리오 E2E 하나입니다. 과거 기록은 보존하되 현행 실행 명령으로 안내하지 않습니다.

규칙 전문의 소유자는 [공통 개발 규칙](https://github.com/byh-playground/bloom-reference/blob/7a6fe0f3c6e5de39109eb02f08603b3b0965532e/rules/development.html), [AI 개발 규칙](https://github.com/byh-playground/bloom-reference/blob/7a6fe0f3c6e5de39109eb02f08603b3b0965532e/rules/ai-development.html), [관리 규칙](https://github.com/byh-playground/bloom-reference/blob/7a6fe0f3c6e5de39109eb02f08603b3b0965532e/rules/project-management.html)입니다. 이 문서는 해당 규칙과 이번 변경의 관계 및 실제 관찰만 기록합니다.

## 실행 결과

`npm run check`의 문법·정적 import·고정 링크 검사가 통과했습니다. `npm run verify:dependencies`는 실제 CDN의 GameKit 8개 모듈 SHA-256 일치를 확인했습니다. 물리·모션·클럽 저장 구현·Three.js 표시 파일은 기준 커밋 대비 변경하지 않았습니다.

`npm test`는 서버와 독립 Chromium 프로세스 두 개를 새로 시작하여 **약 40초**에 통과했습니다. 실행 상한과 실제 경과 시간은 [요약 JSON](reference-alignment.json)에 있습니다. Playwright 전체 170초 및 프로세스 시작·정리를 포함한 외부 180초 상한을 적용하며 timeout은 실패로 종료합니다. 상한을 늘리거나 장시간 경기를 성공 처리하지 않았습니다.

확인한 흐름은 클럽 이름 저장·새로고침 복구 → AI 경기 입력·퇴장 → 훈련 선택 → 친구 초대·실제 공개 Nostr/WebRTC 입장 → 실제 RTC 강제 종료 후 복구 → 참가자/방장 새로고침 → 양쪽 퇴장 후 자동 재입장 없음입니다. 다섯 확정 경계에서 양쪽 해시가 일치했고 최종 hashMismatches와 pageerror는 0입니다. API/물리 mock을 쓰지 않았으며 연결 단절만 실제 RTCPeerConnection.close()로 주입했습니다.

환경은 Windows, Chromium 153.0.8010.12, NVIDIA GeForce GTX 1660 Ti의 ANGLE/D3D11 WebGL입니다. [방장 화면](reference-alignment/online-host.png)과 [참가자 화면](reference-alignment/online-guest.png)을 직접 확인했습니다. 별도 전체 경기 종료·보상 검사는 이번 상한 내 시나리오에 포함하지 않았습니다. 다른 OS·모바일·외부 NAT 조합도 미검증입니다. 이전 전체 경기 기록을 이번 실행 결과로 재사용하지 않습니다.

## 비용과 제한

숨겨진 클럽 화면 사본 제거 전후 HTML은 33,899 → 11,806 bytes이며 약 22KB의 중복 마크업을 제거했습니다. 로딩 속도의 개선 배율을 측정한 수치는 아닙니다. 연결 정비 본문은 기존 80ms 간격, 실제 재연결 시도는 기존 1초 간격을 유지합니다. pump에는 간격 확인 분기가 추가되고 렌더 경로에서는 연결 command가 제거됐습니다. 게임 틱·AI 주기·물리 substep 수는 바꾸지 않았습니다. E2E 통과를 성능 향상의 근거로 사용하지 않습니다.

## 비교한 일차 자료

- [MDN addEventListener](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener): 같은 모양의 익명 함수라도 별도 등록이므로 중복 reload 핸들러를 두지 않고 기존 UI owner에 남겼습니다.
- [Playwright timeout 문서](https://playwright.dev/docs/test-timeouts): 테스트 제한과 전체 실행 제한을 구분해 사용하고, 별도 외부 상한으로 시작/정리까지 제한했습니다.

최신 태그 채널 규약은 참고했으나 기존 공개 release/Pages 및 새로운 Nightly 발행 자동화는 이 개발 리팩토링에서 변경하지 않았습니다. 이후 배포 작업에서 별도로 적용할 범위입니다.
