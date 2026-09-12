/**
 * 背景曲。偏好默认开，但只有本会话关掉致谢公告之后才真正出声。
 * 全站单一 Audio，避免 StrictMode / 热更新叠两段。
 */
export interface BgmState { on: boolean; vol: number }
const KEY = 'mneme-bgm';
const ANNO = 'mneme-anno';

const read = (): BgmState => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { on: true, vol: 0.3 };
    const s = JSON.parse(raw) as Partial<BgmState>;
    return {
      on: typeof s.on === 'boolean' ? s.on : true,
      vol: typeof s.vol === 'number' ? s.vol : 0.3,
    };
  } catch { return { on: true, vol: 0.3 }; }
};

let state: BgmState | null = null;
let audio: HTMLAudioElement | null = null;
let failed = false;
const subs = new Set<(s: BgmState) => void>();
const tab = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('mneme-bgm') : null;
let playToken = 0;

export const annoClosed = (): boolean => {
  try { return sessionStorage.getItem(ANNO) === '1'; } catch { return false; }
};

export const markAnnoClosed = (): void => {
  try { sessionStorage.setItem(ANNO, '1'); } catch { /* */ }
};

export const bgmGet = (): BgmState => (state ??= read());

const persist = () => {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* */ }
};

const notify = () => { if (state) subs.forEach(fn => fn(state!)); };

const ensureAudio = (): HTMLAudioElement => {
  if (audio) return audio;
  const a = new Audio('/audio/bgm.mp3');
  a.loop = true;
  a.preload = 'auto';
  a.addEventListener('error', () => {
    failed = true;
    if (state?.on) {
      state = { ...state, on: false };
      persist();
      notify();
    }
  });
  audio = a;
  return a;
};

export const stopBgm = (): void => {
  if (!audio) return;
  audio.pause();
  audio.currentTime = 0;
};

const canHear = (): boolean => !!state && state.on && annoClosed() && !failed;

const syncPlay = (): void => {
  const s = bgmGet();
  const a = ensureAudio();
  a.volume = s.vol;
  if (!canHear()) {
    a.pause();
    return;
  }
  playToken = Date.now();
  tab?.postMessage({ t: playToken });
  a.play().catch(() => { /* 手势未解锁时由下一次用户操作再试 */ });
};

tab?.addEventListener('message', ev => {
  const t = (ev.data as { t?: number } | null)?.t;
  if (typeof t === 'number' && t !== playToken) audio?.pause();
});

export const bgmSet = (patch: Partial<BgmState>) => {
  state = { ...bgmGet(), ...patch };
  persist();
  notify();
  syncPlay();
};

export const bgmSub = (fn: (s: BgmState) => void) => {
  subs.add(fn);
  return () => { subs.delete(fn); };
};

/** 致谢公告关掉：记下本会话已放行。不把用户已关掉的音乐强行打开。 */
export function tryPlayBgm(): void {
  markAnnoClosed();
  syncPlay();
}

/** 本会话已经关过公告（刷新）：按偏好续播，不把用户的暂停改回去。 */
export function enterBgm(): void {
  if (!annoClosed()) {
    stopBgm();
    return;
  }
  syncPlay();
}

export function retryBgm(): void {
  if (canHear() && audio?.paused) syncPlay();
}

if (typeof document !== 'undefined') {
  document.querySelectorAll('audio').forEach(el => {
    if (el.src.includes('/audio/bgm.mp3')) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
  });
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopBgm();
    audio = null;
    tab?.close();
  });
}
