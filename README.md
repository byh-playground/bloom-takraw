# 블룸 세팍타크로 v0.12.7

블룸 세계관의 3D 세팍타크로 게임입니다. v0.12.7은 Rapier 복원과 실제 두 브라우저의 온라인 경기·재접속 검증을 통과한 버전입니다.

- 게임: https://byh-playground.github.io/bloom-takraw/
- 저장소: https://github.com/byh-playground/bloom-takraw
- 검증 기록: [REPORT](verification/REPORT.md)

`main`은 개발 원본, `release`는 GitHub Pages 공개 배포 브랜치입니다. 초기 배포 HTML은 기존 검증본과 바이트 단위로 동일합니다.

실행 산출물은 `index.html`입니다. 더블클릭으로 열 수 있으며 외부 CDN 라이브러리와 온라인 연결에는 인터넷이 필요합니다. 기존 의존성 버전을 유지했습니다: Three.js 0.180.0, Rapier 0.21.0, bloom-gamekit `9bcb2b20fc7c227553317ae31b8fb400437047eb` (HTML의 `TAKRAW_CONFIG.dependencies`에 원본 URL). 게임 라이브러리 배포본은 수정하지 않았습니다.

수정 사항:

- Rapier `World.restoreSnapshot()`의 임시 serializer 누수 경로를 소유권이 명확한 `SerializationPipeline.deserializeAll()`로 교체했습니다. 물리 인스턴스마다 하나를 재사용하고 종료 때 해제합니다. 틱 계산량과 게임 규칙은 유지합니다.
- 라이브러리의 sessionStorage 신원 복원과 `room.reconnect()`를 연결했습니다. 참가자 및 방장 새로고침 때 살아 있는 상대에게 경기 상태를 받아 이어갑니다.
- 연결 중복 재시도를 막고 1초 간격으로 재연결 필요 여부를 검사합니다. 대기 유예를 90초로 늘렸고, 끊긴 동안 “재접속 중”으로 표시합니다.
- 일시적인 신호 서버 실패 후 “이전 경기 다시 연결” 버튼으로 기존 신원을 유지하여 재시도합니다. 명시적인 연결 닫기/새 방은 기존 복원 정보를 정리합니다. 저장소 오류가 종료 처리를 막지 않습니다.
- 온라인 점수판의 청록/코랄 팀 이름이 갱신 때 우리 팀/상대 팀으로 덮이는 표시 오류를 수정했습니다. 점수와 세트 표시는 기존 색상 순서를 유지합니다.

Node.js 22 이상이 필요합니다. 독립 저장소 루트에서 검사 도구를 설치하고 실행합니다:

```powershell
npm ci
npx playwright install chromium
node serve.cjs
# 별도 터미널에서 순서대로 실행
node verify-checkpoint.cjs
node verify-network.cjs
node verify-finish.cjs
node verify-single.cjs
```

`serve.cjs`는 localhost:8766과 독립적인 실제 Chromium 창 두 개(CDP 9331/9332)를 실행합니다. `verify-network.cjs`는 UI로 방을 만들고 참가한 뒤, 실제 키/마우스 입력, RTC 연결 강제 종료, 양쪽 순차 새로고침, 신호 실패 주입과 UI 재시도, 같은 확정 경계의 해시를 검사합니다. 신호 실패 주입은 검사 브라우저에서만 WebSocket 생성자를 일시 차단하며 전달 HTML에는 포함되지 않습니다. `verify-finish.cjs`는 그 경기를 실제 속도로 끝까지 관찰합니다.

`verification/`의 JSON과 PNG가 실행 증거입니다. `original-*`은 원본 조사 기록이며 최종 통과 기록과 구별합니다. 원본 초기 조사에서 동기식 물리 검사를 경기 페이지에서 실행해 타임아웃을 유발한 기록이 있어, 최종 물리 검사는 별도 페이지로 분리했습니다.

범위: Windows의 같은 PC에서 Chromium 독립 프로세스 2개, 공개 Nostr 릴레이, 실제 WebRTC DataChannel. 다른 OS/기기·모바일·외부 NAT 환경은 검증 범위 밖입니다. 재접속에는 살아 있는 상대와 탭의 sessionStorage가 필요합니다. 양쪽 동시 종료 및 아직 상대가 없는 방의 새로고침은 경기 복원을 보장하지 않습니다. Candidate 표시는 유지하며 모든 환경의 Stable을 주장하지 않습니다.
