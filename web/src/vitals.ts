/**
 * 本机 Web Vitals。只写这台设备的 localStorage，不打点、不外传。
 * 现场达标看本机样本的第 75 百分位；不是 CrUX，也不是实验室 Lighthouse。
 */

export interface VitalSample {
  t: number;
  lcp?: number;
  inp?: number;
  cls?: number;
  kind: string;
  vw: number;
  dpr: number;
}

const K = 'mneme-vitals';
const MAX = 40;

const read = (): VitalSample[] => {
  try {
    const o = JSON.parse(localStorage.getItem(K) || '[]');
    return Array.isArray(o) ? o.filter(x => x && typeof x.t === 'number').slice(-MAX) : [];
  } catch { return []; }
};

const write = (list: VitalSample[]) => {
  try { localStorage.setItem(K, JSON.stringify(list.slice(-MAX))); } catch { /* 配额或隐私模式 */ }
};

function deviceKind(): string {
  const ua = navigator.userAgent;
  if (/HarmonyOS|OpenHarmony|ArkWeb|HuaweiBrowser/i.test(ua) || /HUAWEI|HONOR/i.test(ua)) return 'harmony';
  if (/iPhone|iPod/.test(ua)) return 'iphone';
  if (/iPad/.test(ua)) return 'ipad';
  if (/Android/.test(ua)) return 'android';
  if (/Windows/.test(ua)) return 'windows';
  if (/Mac/.test(ua)) return 'mac';
  return 'other';
}

function p75(nums: number[]): number | null {
  const s = nums.filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.75) - 1)];
}

export function vitalStats() {
  const list = read();
  const last = list[list.length - 1] || null;
  return {
    n: list.length,
    last,
    lcp: p75(list.map(x => x.lcp).filter((n): n is number => n != null)),
    inp: p75(list.map(x => x.inp).filter((n): n is number => n != null)),
    cls: p75(list.map(x => x.cls).filter((n): n is number => n != null)),
  };
}

function persist(partial: Partial<VitalSample>) {
  const list = read();
  const cur = list[list.length - 1];
  const stamp = { kind: deviceKind(), vw: window.innerWidth, dpr: window.devicePixelRatio || 1 };
  if (cur && Date.now() - cur.t < 8_000) {
    list[list.length - 1] = { ...cur, ...partial };
  } else {
    list.push({ t: Date.now(), ...stamp, ...partial });
  }
  write(list);
}

export function watchVitals() {
  const report = (name: 'lcp' | 'inp' | 'cls', value: number) => {
    persist({ [name]: name === 'cls' ? value : Math.round(value) });
    if (import.meta.env.PROD) console.info(`[vitals] ${name.toUpperCase()} ${name === 'cls' ? value.toFixed(3) : Math.round(value)}`);
  };
  try {
    new PerformanceObserver(list => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) report('lcp', last.startTime);
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch { /* 旧内核无 LCP */ }
  try {
    let cls = 0;
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        const ls = e as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
        if (!ls.hadRecentInput) cls += ls.value ?? 0;
      }
      report('cls', cls);
    }).observe({ type: 'layout-shift', buffered: true });
  } catch { /* 旧内核无 CLS */ }
  try {
    let inp = 0;
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        const d = (e as PerformanceEventTiming).duration;
        if (d > inp) { inp = d; report('inp', inp); }
      }
    }).observe({ type: 'event', buffered: true, durationThreshold: 40 } as PerformanceObserverInit);
  } catch { /* 旧内核无 Event Timing */ }
}
