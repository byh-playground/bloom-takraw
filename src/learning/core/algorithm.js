/**
 * 알고리즘 규약. 과제와 학습기는 이 두 메서드와 actor만 안다.
 *  - sample(obs): 탐험하며 행동을 뽑는다 → { obs, action, ... } (update에 되돌려 줄 조각 포함)
 *  - update(batch): 전이 { obs, action, reward, nextObs, done, ... } 목록으로 한 번 학습하고 배치 평균 보상을 돌려준다.
 *  - actor(): 탐험 없이 행동하는 { act(obs) } (평가·경기 추론용)
 * 결정이 한 번뿐인 과제는 전이마다 nextObs = null, done = true다.
 */
class Algorithm {
  sample() { throw new Error('sample을 구현해야 합니다.'); }
  update() { throw new Error('update를 구현해야 합니다.'); }
  actor() { throw new Error('actor를 구현해야 합니다.'); }
}

export { Algorithm };
