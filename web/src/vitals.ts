/**
 * 本机 Web Vitals 观察。只写控制台，不打点、不外传。
 * 现场达标要以真实用户第 75 百分位为准；这里只给发布前对照。
 */
export function watchVitals() {
  if (!import.meta.env.PROD) return;
  const once: Record<string, number> = {};
  const report = (name: string, value: number) => {
    const n = Math.round(value);
    if (once[name] === n) return;
    once[name] = n;
    console.info(`[vitals] ${name} ${n}`);
  };
  try {
    new PerformanceObserver(list => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) report('LCP', last.startTime);
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch { /* 旧内核无 LCP */ }
  try {
    let cls = 0;
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        const ls = e as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
        if (!ls.hadRecentInput) cls += ls.value ?? 0;
      }
      report('CLS×1000', cls * 1000);
    }).observe({ type: 'layout-shift', buffered: true });
  } catch { /* 旧内核无 CLS */ }
  try {
    let inp = 0;
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        const d = (e as PerformanceEventTiming).duration;
        if (d > inp) { inp = d; report('INP', inp); }
      }
    }).observe({ type: 'event', buffered: true, durationThreshold: 40 } as PerformanceObserverInit);
  } catch { /* 旧内核无 Event Timing */ }
}
