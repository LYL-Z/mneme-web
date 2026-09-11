/**
 * v4 · 背景曲状态 store（BGM 控件与偏好面板共用）。
 * localStorage mneme-bgm = { on: boolean, vol: number }；订阅者收到变更广播。
 */
export interface BgmState { on: boolean; vol: number }
const KEY = 'mneme-bgm';

const read = (): BgmState => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { on: !!s.on, vol: typeof s.vol === 'number' ? s.vol : 0.3 };
  } catch { return { on: false, vol: 0.3 }; }
};

let state: BgmState | null = null;
const subs = new Set<(s: BgmState) => void>();

export const bgmGet = (): BgmState => (state ??= read());
export const bgmSet = (patch: Partial<BgmState>) => {
  state = { ...bgmGet(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 静默 */ }
  subs.forEach(fn => fn(state!));
};
export const bgmSub = (fn: (s: BgmState) => void) => {
  subs.add(fn);
  return () => { subs.delete(fn); };
};
