import { Policy } from './core/policy.js';

const toBase64 = bytes => btoa(String.fromCharCode(...bytes));
const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

/** 학습한 정책의 저장소. 가중치는 양자화한 바이트의 base64로 저장하고, 접근 실패는 저장 안 함으로 처리한다. */
class PolicyStore {
  /** storage는 getItem/setItem/removeItem을 가진 객체(localStorage 등). */
  constructor(storage, { prefix = 'bloom-takraw:policy:', bits = 4 } = {}) { Object.assign(this, { storage, prefix, bits }); }

  save(key, policy, meta = {}) {
    try {
      this.storage.setItem(this.prefix + key, JSON.stringify({ v: 1, meta, data: toBase64(policy.toQuantized(this.bits)) }));
      return true;
    } catch { return false; }
  }

  /** 저장된 정책과 메타를 돌려준다. 없거나 깨졌으면 null이다. */
  load(key) {
    try {
      const raw = this.storage.getItem(this.prefix + key);
      if (!raw) return null;
      const record = JSON.parse(raw);
      if (record.v !== 1) return null;
      return { policy: Policy.fromQuantized(fromBase64(record.data)), meta: record.meta ?? {} };
    } catch { return null; }
  }

  remove(key) { try { this.storage.removeItem(this.prefix + key); } catch { /* 저장소 접근 실패는 무시 */ } }
}

export { PolicyStore };
