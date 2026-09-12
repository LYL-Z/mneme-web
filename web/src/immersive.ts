/**
 * 沉浸光感（对标华为 ImmersiveMaterial / Apple Liquid Glass 的 Web 近似）
 *
 * 网站跑不了 ArkUI systemMaterial，也不可能调用苹果私有液态玻璃。
 * 这里只在「标题栏、底栏、弹窗」上复现六特性，正文仍用纸面 .surface。
 *
 *  通透材质     .chrome.glass + backdrop-filter / 可选折射
 *  渐变模糊     bindGradientBlur → --nav-sc（0 近透明 → 1 满模糊）
 *  按压弹性     button:active scale
 *  按压点光源   bindPressRipple → .imm-ripple
 *  材质流光     exquisite 档 .chrome::after 缓速扫光
 *  智能反色     主题 + --nav-sc 驱动 --chrome-ink / data-chrome（不做全屏取样）
 *
 * 档位 = 华为 MaterialLevel：
 *  exquisite 强 · gentle 均衡 · smooth 弱 · adaptive 按设备自动选
 */

export type ImmLevel = 'exquisite' | 'gentle' | 'smooth';
export type ImmPref = 'adaptive' | ImmLevel;

export const IMM_PREFS: ImmPref[] = ['adaptive', 'exquisite', 'gentle', 'smooth'];
export const IMM_LABEL: Record<ImmPref, string> = {
  adaptive: '自适应',
  exquisite: '强',
  gentle: '均衡',
  smooth: '弱',
};

let level: ImmLevel | null = null;

const asPref = (v: unknown): ImmPref =>
  v === 'exquisite' || v === 'gentle' || v === 'smooth' || v === 'adaptive' ? v : 'adaptive';

export function readImmPref(): ImmPref {
  try {
    const raw = localStorage.getItem('mneme-prefs');
    if (raw) return asPref((JSON.parse(raw) as { imm?: unknown }).imm);
  } catch { /* 首次 / 隐私模式 */ }
  return 'adaptive';
}

function pickAdaptive(): ImmLevel {
  try {
    if (document.documentElement.classList.contains('no-motion')) return 'smooth';
    const cores = navigator.hardwareConcurrency ?? 4;
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    const os = document.documentElement.dataset.os;
    const shell = document.documentElement.dataset.shell;
    if (os === 'harmony' && shell === 'phone') {
      return cores >= 8 && mem >= 6 ? 'gentle' : 'smooth';
    }
    return cores >= 8 && mem >= 8 ? 'exquisite' : cores >= 4 ? 'gentle' : 'smooth';
  } catch {
    return 'gentle';
  }
}

export function resetImmLevel(): void {
  level = null;
}

export function immLevel(): ImmLevel {
  if (level) return level;
  const pref = readImmPref();
  if (document.documentElement.classList.contains('no-motion')) level = 'smooth';
  else if (pref === 'adaptive') level = pickAdaptive();
  else level = pref;
  document.documentElement.dataset.imm = level;
  document.documentElement.dataset.immPref = pref;
  return level;
}

export function applyImmFromPrefs(): void {
  resetImmLevel();
  immLevel();
  try { window.dispatchEvent(new Event('mneme:imm')); } catch { /* */ }
}

export function immDisplacementScale(): number {
  const l = immLevel();
  return l === 'exquisite' ? 14 : l === 'gentle' ? 8 : 0;
}

/** 粒子规模（湮灭引擎按档位取用；手机再削一档密度） */
export function immParticleCount(): number {
  const l = immLevel();
  const phone = document.documentElement.dataset.shell === 'phone';
  if (l === 'exquisite') return phone ? 720 : 1300;
  if (l === 'gentle') return phone ? 420 : 750;
  return phone ? 180 : 320;
}

export function immRipple(): boolean {
  const l = immLevel();
  return (l === 'exquisite' || l === 'gentle') && !document.documentElement.classList.contains('no-motion');
}

/** 小屏 / 省流 / 减动效：跳过序章重动画，把首屏让给正文。不负责弹窗粒子。 */
export function skipHeavyFx(): boolean {
  try {
    if (document.documentElement.classList.contains('no-motion')) return true;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
    if (document.documentElement.dataset.shell === 'phone') return true;
    const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (c?.saveData) return true;
    if (c?.effectiveType === 'slow-2g' || c?.effectiveType === '2g') return true;
  } catch { /* 旧内核无 Network Information */ }
  return false;
}

/** 弹窗粒子：手机也开，只在减动效 / 关玻璃 / 省流时跳过。密度由档位收。 */
export function canAnnihilate(): boolean {
  try {
    if (document.documentElement.classList.contains('no-motion')) return false;
    if (document.documentElement.classList.contains('no-glass')) return false;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (c?.saveData) return false;
    if (c?.effectiveType === 'slow-2g' || c?.effectiveType === '2g') return false;
  } catch { /* */ }
  return true;
}

/** 渐变模糊：绑定滚动容器 → 导航栏 --nav-sc（0 透明 → 1 模糊）。rAF 节流。 */
export function bindGradientBlur(scrollEl: HTMLElement, navEl: HTMLElement): () => void {
  let raf = 0;
  const update = () => {
    raf = 0;
    if (immLevel() === 'smooth') {
      navEl.style.setProperty('--nav-sc', '1');
      return;
    }
    const max = 140;
    const v = Math.max(0, Math.min(1, scrollEl.scrollTop / max));
    navEl.style.setProperty('--nav-sc', v.toFixed(3));
  };
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
  scrollEl.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('mneme:imm', update);
  update();
  return () => {
    scrollEl.removeEventListener('scroll', onScroll);
    window.removeEventListener('mneme:imm', update);
    if (raf) cancelAnimationFrame(raf);
  };
}

/** 按压点光源：每次按下再读档位，偏好切换不必重绑。 */
export function bindPressRipple(root: HTMLElement): () => void {
  const onDown = (e: PointerEvent) => {
    if (!immRipple()) return;
    const card = (e.target as HTMLElement).closest('.chrome, .glass');
    if (!card) return;
    const r = card.getBoundingClientRect();
    const dot = document.createElement('span');
    dot.className = 'imm-ripple';
    dot.style.left = `${e.clientX - r.left}px`;
    dot.style.top = `${e.clientY - r.top}px`;
    dot.style.width = dot.style.height = '12px';
    if (getComputedStyle(card).position === 'static') (card as HTMLElement).style.position = 'relative';
    card.appendChild(dot);
    setTimeout(() => dot.remove(), 640);
  };
  root.addEventListener('pointerdown', onDown, { passive: true });
  return () => root.removeEventListener('pointerdown', onDown);
}

/** 智能反色：夜色走浅墨；纸色顶栏在透明段加纸晕，避免压到深色底。 */
export function bindSmartInk(): () => void {
  const apply = () => {
    const html = document.documentElement;
    const night = html.dataset.theme === 'night';
    html.dataset.chrome = night ? 'light' : 'dark';
  };
  apply();
  const mo = new MutationObserver(apply);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
}

/** 运行时帧率哨兵：只降不升。手动「强」也会因掉帧落到均衡/弱。 */
export function watchFps(): void {
  if (document.documentElement.classList.contains('no-motion')) return;
  let samples = 0, lowStreak = 0, last = performance.now(), raf = 0;
  let stopped = false;
  const stop = () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
  const tick = () => {
    if (stopped) return;
    if (document.hidden) { raf = 0; return; }
    const now = performance.now();
    const dt = now - last;
    if (dt >= 500) {
      const fps = 1000 / (dt / (samples + 1));
      samples = 0; last = now;
      if (fps < 45) lowStreak++; else lowStreak = 0;
      if (lowStreak >= 3) {
        const cur = document.documentElement.dataset.imm;
        const next: ImmLevel | null = cur === 'exquisite' ? 'gentle' : cur === 'gentle' ? 'smooth' : null;
        if (next) {
          level = next;
          document.documentElement.dataset.imm = next;
          lowStreak = 0;
          try { window.dispatchEvent(new Event('mneme:imm')); } catch { /* */ }
        }
        if (next === 'smooth' || cur === 'smooth') { stop(); return; }
      }
    } else samples++;
    raf = requestAnimationFrame(tick);
  };
  const onVis = () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else if (!stopped) {
      last = performance.now();
      samples = 0;
      raf = requestAnimationFrame(tick);
    }
  };
  document.addEventListener('visibilitychange', onVis);
  raf = requestAnimationFrame(tick);
  window.setTimeout(() => { if (lowStreak === 0) stop(); }, 10_000);
}
