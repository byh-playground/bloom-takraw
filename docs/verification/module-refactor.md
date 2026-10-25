# 네이티브 ES 모듈·GameKit 직접 참조 검증

이 문서는 PR #1의 과거 검증 기록입니다. 당시 내부 검사·dist 생성·장시간 관찰 명령은 이후 [개발 규칙 정렬](reference-alignment.md)에서 정리했습니다. 현재 실행 방법은 [README](../../README.md)를 따릅니다.

2026-10-25, Windows / Chromium 153.0.8010.12의 독립 브라우저 프로세스 두 개로 확인했습니다. 비교 기준은 초기 검증 커밋 a01855b833ec5c09db6834e4c4ceeeb6d8088fd7입니다. 게임 버전/규칙과 GameKit 고정 배포 커밋은 유지했습니다. 이 기록은 작업 브랜치의 검사이며 공개 release 배포 기록이 아닙니다.

| 검사 | 결과 |
| --- | --- |
| npm test | 모듈 그래프/import map/lock, JS·CSS MIME, 배포 파일 구성 3개 통과 |
| verify:dependencies | GameKit 배포 모듈 8개 SHA-256 일치 |
| verify:refactor | 원본 단일 HTML·개발 모듈·dist의 1,200틱 물리와 게임 메타데이터 SHA-256 일치, 120/450/900틱 복원 포함 |
| verify:checkpoint | 1,200틱 복원 동등성, 200회 반복 복원, 잘못된 핸들 거부 후 상태 유지 |
| verify:network | 실제 UI 입장·입력·RTC 강제 종료·양쪽 새로고침·신호 실패 후 재시도, 24개 확정 경계 해시 일치 |
| verify:finish | 온라인 3세트 종료, 세트 2:1, 42035틱 경계 해시 3965953997, 최종 hashMismatches 0 |
| verify:single | AI 경기 세트 2:1 종료, 보상 저장 성공 |
| UI 추가 확인 | 훈련 가위치기·도움말·퇴장·클럽·설정, 홈/경기/클럽 시각 확인 |
| 오류 경로 | GameKit 다운로드 실패 시 재시도 안내, WebGL 실패 시 원래 구체적 안내 유지 |

초기 재접속 검사에서는 검사 코드가 모듈 로딩 전 전역을 참조해 실패했습니다. 검사 대기를 window.__takraw의 존재 확인으로 고친 후 온라인 검사를 전체 재실행해 통과했습니다. 실제 게임의 신원/물리 복원 실패는 아니었습니다. 원본과 비교한 게임·물리·모션·화면 본문은 import/export와 줄바꿈을 제외하면 동일합니다.

## 로딩·계산 비용

외부 런타임 모듈 10개는 유지하고 로컬 JS 12개와 CSS 1개가 추가되었습니다. 게임 계산식·AI 주기·Rapier 틱·렌더 구조는 바꾸지 않았습니다. 아래 값은 동일 입력 1,200틱을 실행한 한 번의 측정으로, 동시에 다른 브라우저 검사도 실행한 환경입니다. 통계적인 속도 개선이나 모든 기기의 성능을 주장하지 않습니다.

| 실행본 | 부팅 관찰 ms | game.step 누적 ms |
| --- | ---: | ---: |
| baseline | 1151 | 6900.6 |
| modules | 1082 | 7091.3 |
| dist | 968 | 6976.5 |

원본 대비 modules의 이 단일 계산 측정 차이는 2.8%입니다. 파일 분리의 요청 수 증가와 측정 변동을 구별합니다. DOM/스타일 홈 화면도 원본과 직접 비교했습니다.

## 기록과 한계

[요약 JSON](module-refactor.json)에 기준 커밋, 앱 파일별 SHA-256, 비교 해시와 측정값을 보존했습니다. 상세 새 실행 로그는 Git 제외 artifacts/verification/에 있으며 기존 기록은 [v0.12.7](v0.12.7/REPORT.md)에 분리했습니다. 현재 앱은 HTTP(S) 및 네이티브 ES 모듈로 실행하며 file:// 단일 파일 실행을 지원하지 않습니다. GameKit 소스는 복사하지 않으며 배포는 index.html/src/styles를 함께 제공해야 합니다.

검증 범위는 같은 PC의 Chromium이며 다른 OS·실제 모바일·외부 NAT는 미검증입니다. 재접속은 한쪽 상대가 살아 있는 기존 범위입니다. Cold CDN 장애는 안내 경로만 검사했으며 오프라인 실행을 제공하지 않습니다.

화면: [홈](module-refactor/modules-home.png), [훈련](module-refactor/modules-training.png), [클럽](module-refactor/modules-club.png), [온라인 1](module-refactor/finished-1.png), [온라인 2](module-refactor/finished-2.png), [AI 종료](module-refactor/single-finished.png).
