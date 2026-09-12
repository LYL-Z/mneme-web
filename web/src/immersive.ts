/**
 * v4 · 沉浸光感体系（对标华为 ImmersiveMaterial，Web 实现）
 *
 * 六特性映射：
 *  - 通透材质：.glass backdrop-filter（既有）
 *  - 渐变模糊：导航栏随滚动从透明渐变为模糊（bindToScrollable → --nav-sc 驱动）
 *  - 按压弹性反馈：button:active 独立 scale 属性弹簧（不与既有 transform 冲突）
 *  - 按压点光源：pointerdown 在玻璃组件触点生成一次性光晕（档位启用）
 *  - 材质流光：EXQUISITE 档玻璃面缓速斜向流光；GENTLE 静态扫光（既有）
 *  - 智能反色：华为系统级采样，Web 无低成本等价——不实现（保持可读性由主题 token 保证）
 *
 * 档位（MaterialLevel → ADAPTIVE 自动适配 GPU/CPU）：
 *  - exquisite：完整效果（粒子 1300 / 流光动画 / 点光源 / 全档渐变模糊）
 *  - gentle：默认平衡（粒子 750 / 静态扫光 / 点光源 / 渐变模糊）
 *  - smooth：低配轻量（粒子 320 / 无流光无点光源 / 常显轻模糊）
 *  - 降级条件：cores<4 → smooth；no-motion 偏好 → smooth 且动画冻结
 */

export type ImmLevel = 'exquisite' | 'gentle' | 'smooth';

let level: ImmLevel | null = null;

export function immLevel(): ImmLevel {
  if (level) return level;
  try {
    if (document.documentElement.classList.contains('no-motion')) level = 'smooth';
    else {
      const cores = navigator.hardwareConcurrency ?? 4;
      const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
      const os = document.documentElement.dataset.os;
      const shell = document.documentElement.dataset.shell;
      if (os === 'harmony' && shell === 'phone') {
        level = cores >= 8 && mem >= 6 ? 'gentle' : 'smooth';
      } else {
        level = cores >= 8 && mem >= 8 ? 'exquisite' : cores >= 4 ? 'gentle' : 'smooth';
      }
    }
  } catch { level = 'gentle'; }
  document.documentElement.dataset.imm = level;
  return level;
}

/** 粒子规模（湮灭引擎按档位取用） */
export function immParticleCount(): number {
  const l = immLevel();
  return l === 'exquisite' ? 1300 : l === 'gentle' ? 750 : 320;
}

/** 按压点光源是否启用 */
export function immRipple(): boolean {
  const l = immLevel();
  return (l === 'exquisite' || l === 'gentle') && !document.documentElement.classList.contains('no-motion');
}

/** 小屏 / 省流 / 减动效：跳过序章粒子与关闭湮灭，把首屏让给正文。 */
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

/** 渐变模糊：绑定滚动容器 → 导航栏 --nav-sc（0 透明 → 1 模糊）。rAF 节流，卸载即停。 */
export function bindGradientBlur(scrollEl: HTMLElement, navEl: HTMLElement): () => void {
  if (immLevel() === 'smooth') { navEl.style.setProperty('--nav-sc', '1'); return () => {}; }
  let raf = 0;
  const update = () => {
    raf = 0;
    const max = 140; // 滚动 140px 内完成透明→模糊过渡（IMMERSIVE_GRADIENT_BLUR 语义）
    const v = Math.max(0, Math.min(1, scrollEl.scrollTop / max));
    navEl.style.setProperty('--nav-sc', v.toFixed(3));
  };
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
  scrollEl.addEventListener('scroll', onScroll, { passive: true });
  update();
  return () => { scrollEl.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
}

/** 按压点光源：pointerdown 在玻璃组件触点生成扩散光晕，600ms 后自毁 */
export function bindPressRipple(root: HTMLElement): () => void {
  if (!immRipple()) return () => {};
  const onDown = (e: PointerEvent) => {
    const card = (e.target as HTMLElement).closest('.glass');
    if (!card) return;
    const r = card.getBoundingClientRect();
    const dot = document.createElement('span');
    dot.className = 'imm-ripple';
    dot.style.left = `${e.clientX - r.left}px`;
    dot.style.top = `${e.clientY - r.top}px`;
    dot.style.width = dot.style.height = '12px';
    (card as HTMLElement).style.position ||= '';
    if (getComputedStyle(card).position === 'static') (card as HTMLElement).style.position = 'relative';
    card.appendChild(dot);
    setTimeout(() => dot.remove(), 640);
  };
  root.addEventListener('pointerdown', onDown, { passive: true });
  return () => root.removeEventListener('pointerdown', onDown);
}

/** 运行时帧率哨兵：连续采样过低则自动降档（exquisite→gentle→smooth），只降不升，避免抖动 */
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
      if (lowStreak >= 3) {   // 连续 1.5s 低于 45fps → 降档
        const cur = document.documentElement.dataset.imm;
        const next = cur === 'exquisite' ? 'gentle' : cur === 'gentle' ? 'smooth' : null;
        if (next) { document.documentElement.dataset.imm = next; lowStreak = 0; }
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
  /* 健康帧只盯开场 10 秒；一直流畅就停，避免全站常驻 rAF。 */
  window.setTimeout(() => { if (lowStreak === 0) stop(); }, 10_000);
}
