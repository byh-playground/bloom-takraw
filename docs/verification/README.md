# 검증 기록

- [v0.12.7 단일 HTML](v0.12.7/REPORT.md): 분리 이전 완료 기록. 당시 file:// 실행과 단일 파일 SHA는 현재 모듈 앱의 배포 단위와 다릅니다.
- [모듈 전환](module-refactor.md): ES 모듈·GameKit 직접 import 전환의 실행 결과.
- [개발 규칙 정렬](reference-alignment.md): 현행 고정 사용자 흐름 검사와 적용 범위.
- 현재 원본 출력은 `artifacts/e2e/`에 생성합니다. 과거 파일의 명령은 당시 실행 기록이며 실행 방법은 [현재 README](../../README.md)를 따릅니다.

- [리시브 → 세터 → 스파이크](receive-set-spike.md): v0.12.8 실제 접촉·직접 조작·온라인 복구와 별도 비용 측정.

- [일반 서브 수신 성공률](receive-reliability.md): v0.12.9 원본 비교와 80% 통과 기준.

- [모바일 조작과 연습 토스](mobile-training.md): v0.12.10 터치 UX와 정강이 토스 수정.

- [접촉 타이밍 효과](timing-impact.md): v0.12.11 타이밍 등급 판정, 등급별 효과, 임계값 실측.

- [학습 코어](learning-core.md): v0.12.12 규칙 AI 조정 값 학습 모듈의 스파이크 리시브 측정과 reset 재사용 결과 차이.

- [동료 AI 학습 기능](learning-feature.md): v0.12.13 유저 기능 연결(포인트 → 학습 → 저장 → 경기 적용)의 시험 결과와 미검증 범위.

- 이어서 할 일은 [동료 AI 학습 TOBE](../learning-tobe.md)에 모았다. 코드에는 `TOBE(learning)` 주석이 있다.
