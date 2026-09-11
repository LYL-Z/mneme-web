/** 思源宋中文面按需加载。导航走系统黑体，避免首屏并行拉 3 个 1MB+ 文件。 */
let started = false;

export function ensureCjkSerif(): void {
  if (started) return;
  started = true;
  void import('./styles/fonts-cjk.css');
}

/** 宽屏且非省流：空闲时预热阅读字体。小屏 / 2G / 省流等到打开正文。 */
export function maybeWarmCjkSerif(): void {
  try {
    if (matchMedia('(max-width: 960px)').matches) return;
    const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (c?.saveData) return;
    if (c?.effectiveType === 'slow-2g' || c?.effectiveType === '2g' || c?.effectiveType === '3g') return;
  } catch { /* 旧内核无 Network Information */ }
  window.setTimeout(() => ensureCjkSerif(), 1200);
}
