/** 학습 과제 규약. 장면 하나(에피소드)를 돌려 관측·행동·보상을 돌려준다. */
class Task {
  /** chooseAction(obs) → { action, ... }. 반환: { obs, action, reward, success, code, ... } */
  rollout() { throw new Error('rollout을 구현해야 합니다.'); }
}

export { Task };
