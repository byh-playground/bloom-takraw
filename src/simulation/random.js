/**
 * 게임이 쓰는 시드 난수의 이름(D-313). 생성기는 gamekit `deterministic`의 `statelessRandom`·`SeededPRNG`이고,
 * 이 파일은 그 uint32 값을 [0, 1)로 바꾸고 키를 묶는 일만 한다.
 *
 * 득점 리플레이 워커(presentation/highlight-worker.js)에는 import map이 없어 시뮬레이션이 `@bloom-gamekit/*`를
 * 직접 import하지 못한다. 그래서 이 파일은 아무것도 import하지 않고, 쓰는 쪽이 받은 gamekit 모듈을 넘긴다.
 */

const UINT32 = 4294967296;

/**
 * 상태 없는 시드 난수: `(seed, ...keys) => [0, 1)`. 시드와 키가 같으면 언제나 같은 값이라 롤백·재실행·두 피어가 일치한다.
 * 키는 0 이상 uint32 정수이고(아니면 gamekit이 RangeError), 키마다 `statelessRandom(앞 값, 키)`를 이어 적용한다.
 */
function takrawSeededUnit({ statelessRandom }) {
    return (seed, ...keys) => {
        let value = seed;
        for (const key of keys) value = statelessRandom(value, key);
        return value / UINT32;
    };
}

/** 상태 있는 시드 난수열: `SeededPRNG` 하나를 부를 때마다 다음 [0, 1) 값을 내는 함수로 바꾼다. */
function takrawUnitStream(prng) {
    return () => prng.nextUint32() / UINT32;
}

/** 확정 경기 이벤트 하나(tick·sequence)의 표시 난수열. 두 피어와 롤백 재확정이 같은 효과 모양을 그린다. */
function takrawEventUnits({ SeededPRNG, statelessRandom }, seed, event) {
    return takrawUnitStream(
        new SeededPRNG(statelessRandom(seed, (event.tick * 16 + event.sequence) >>> 0)),
    );
}

export { takrawEventUnits, takrawSeededUnit, takrawUnitStream };
