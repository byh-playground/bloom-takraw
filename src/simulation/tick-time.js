/**
 * ms로 적은 시간 설정을 틱에 맞추는 단일 소유자. 시간 설정은 ms로 적고 틱 수(tickRate)는 config.simulation 한 곳에서만 바꾼다.
 *
 * - 주기(takrawTickPeriod): 틱마다 누적값에 1000을 더하고 문턱 intervalMs·tickRate와 비교한다(단위 = ms × tickRate, 모두 정수).
 *   문턱 이상이면 실행하고 문턱만큼 빼서 나머지를 이월한다. 그래서 틱 간격으로 나누어떨어지지 않는 주기도 평균이 정확하다.
 *   누적값은 시뮬레이션 상태라 호출자가 경기 상태(스냅샷·롤백·상태 비교 대상)에 둔다. intervalMs는 정수여야 한다(부동소수로 쌓지 않는다).
 * - 경계 환산(takrawTickCount): 틱 개수를 요구하는 외부 API(롤백 창·입력 지연·체크섬 간격·따라잡기 한도)와
 *   틱 번호 차이로 구간을 정하는 표시 쪽(리플레이 구간·사건 보관)에 넘길 때만 한 번 올림한다.
 */
function takrawTickPeriodThreshold(intervalMs, tickRate) {
    if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0)
        throw new RangeError(`intervalMs must be a positive integer (${intervalMs})`);
    return intervalMs * tickRate;
}

/** 한 틱을 진행한다. clock: { elapsed }(경기 상태 안의 객체, 정수). 이번 틱에 실행할 차례면 true. */
function takrawTickPeriod(clock, intervalMs, tickRate) {
    clock.elapsed += 1000;
    const threshold = takrawTickPeriodThreshold(intervalMs, tickRate);
    if (clock.elapsed < threshold) return false;
    clock.elapsed -= threshold;
    return true;
}

/** ms를 그 시간을 덮는 틱 개수로 올림한다(경계 전용). minimum: 최소 틱 수. */
function takrawTickCount(ms, tickRate, minimum = 0) {
    return Math.max(minimum, Math.ceil((ms * tickRate) / 1000 - 1e-9));
}

export { takrawTickPeriod, takrawTickCount };
