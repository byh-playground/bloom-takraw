/**
 * 점프·발차기 입력 타이밍 오차의 단일 소유자.
 * 오차 단위는 초이며 음수는 이상적인 시점보다 빠름, 양수는 늦음이다.
 * 기록은 호출자가 가진 경기 상태(state.timing)에 두어 스냅샷·롤백에 함께 저장된다.
 * 연습의 안내 문구와 접촉 효과가 같은 공식을 쓰도록 계산식을 여기에만 둔다.
 */
class TakrawTimingJudge {
  constructor(settings) {
    this.settings = settings;
  }

  /** 팀별 기록 한 쌍. jump·kick은 { at, error } 또는 null. */
  emptyRecords() {
    return [this.emptyRecord(), this.emptyRecord()];
  }

  emptyRecord() {
    return { jump: null, kick: null };
  }

  /** 점프 입력 순간 타점까지 남은 시간이 이상적인 선행 시간과 얼마나 다른지. 준비 자세가 아니면 null. */
  jumpError(guide) {
    return guide?.inPosition && guide.settled ? guide.contactLead - guide.time : null;
  }

  /**
   * 발차기 입력 순간의 오차. 내려찍기는 점프 전에 발을 올리므로 안내 시간 기준이고,
   * 나머지는 점프 시작 후 경과 시간과 이상적인 발차기 지연의 차이다.
   * kickDelay는 공중일 때만 필요하므로 호출자가 지연 계산으로 넘긴다.
   */
  kickError({ lesson, guide, jumpActive, jumpTime, kickDelay, preholdLead }) {
    if (lesson === 'downward') return guide ? guide.contactLead + preholdLead - guide.time : null;
    return jumpActive ? jumpTime - kickDelay() : null;
  }

  /** 오차가 있는 입력만 기록한다. 같은 종류는 더 최근 입력으로 교체한다. */
  record(records, team, kind, error, time) {
    if (error === null || !Number.isFinite(error)) return;
    records[team][kind] = { at: time, error };
  }

  /** 오차 크기로 등급을 정한다. 창은 config.timing.windows가 소유한다. */
  grade(error) {
    const { perfect, good } = this.settings.windows;
    const size = Math.abs(error);
    return size <= perfect ? 'perfect' : size <= good ? 'good' : 'normal';
  }

  /**
   * 접촉 시점에 기록을 평가한다. 유효한 기록이 없으면 null.
   * 점프와 발차기 중 오차가 큰 쪽이 등급을 정한다.
   */
  evaluate(record, now) {
    const valid = ['jump', 'kick']
      .map(kind => [kind, record[kind]])
      .filter(([, entry]) => entry && now - entry.at <= this.settings.maxAge);
    if (!valid.length) return null;
    const [, worst] = valid.reduce((a, b) => Math.abs(b[1].error) > Math.abs(a[1].error) ? b : a);
    return {
      grade: this.grade(worst.error),
      error: worst.error,
      jump: record.jump && valid.some(([kind]) => kind === 'jump') ? record.jump.error : null,
      kick: record.kick && valid.some(([kind]) => kind === 'kick') ? record.kick.error : null,
    };
  }
}

export { TakrawTimingJudge };
