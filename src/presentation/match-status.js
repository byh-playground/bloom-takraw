/** 점수판·연출이 읽는 표시 상태. 경기 상태를 수정하지 않는다. */
function takrawMatchStatus(state, rules) {
  const score = state.score || [0, 0], finished = state.phase === 'finished';
  const deuce = score.every(points => points >= rules.deuce);
  const limit = deuce ? rules.cap : rules.points;
  const matchPointTeams = finished ? [] : [0, 1].filter(team =>
    score[team] === limit - 1 && (state.sets?.[team] || 0) + 1 >= rules.sets);
  return { deuce: !finished && deuce, limit, matchPointTeams };
}
export { takrawMatchStatus };
