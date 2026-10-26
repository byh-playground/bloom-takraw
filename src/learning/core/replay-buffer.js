/** 고정 크기 링 버퍼. 가득 차면 가장 오래된 전이를 덮어쓴다. random은 [0, 1) 난수 함수다. */
class ReplayBuffer {
  constructor(capacity, random) { Object.assign(this, { capacity, random }); this.items = []; this.next = 0; }
  get size() { return this.items.length; }
  push(item) { if (this.items.length < this.capacity) this.items.push(item); else this.items[this.next] = item; this.next = (this.next + 1) % this.capacity; }
  sample(count) { return Array.from({ length: count }, () => this.items[Math.floor(this.random() * this.items.length)]); }
}

export { ReplayBuffer };
