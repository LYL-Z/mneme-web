import { useEffect, useRef, useState } from 'react';
import { getHighlights, getRecentDocs, weekOpenStats, timeAgo } from '../history';
import { vitalStats } from '../vitals';
import { api, type AdminStatus } from '../api';
import { notify } from '../toast';
import { routeToPath } from '../route';
import { bgmGet, bgmSet, bgmSub } from '../bgm';
import { useFocusTrap } from '../focusTrap';
import { readScroller } from '../readHost';
import { osLabel, readDevice, shellLabel, type DeviceInfo } from '../device';
import { applyImmFromPrefs, IMM_LABEL, IMM_PREFS, type ImmPref } from '../immersive';
import { armSnapshot, dismissGlass } from '../glassDismiss';

/**
 * v4 · C5 键盘导航层 + C6 阅读足迹 + E3 阅读时长感知 + E4 站内偏好开关（含 E2 高对比）。
 * 一个组件承载三件事，入口：
 * - 齿轮按钮（导航右侧）→ 偏好面板：动效/玻璃光/高对比开关 + 本周足迹统计；
 * - j/k 滚动。快捷键总表由顶栏「?」打开，避免与 App 的 g 跳转抢键。
 * 全部偏好落 localStorage（mneme-prefs），documentElement class 驱动 CSS/JS 行为。
 */
export interface MnemePrefs { motion: boolean; glass: boolean; contrast: boolean; imm: ImmPref }
const P_KEY = 'mneme-prefs';
const systemMotion = () => {
  try { return !matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return true; }
};
export const readPrefs = (): MnemePrefs => {
  try {
    const raw = localStorage.getItem(P_KEY);
    if (raw) {
      const o = JSON.parse(raw) as Partial<MnemePrefs>;
      const imm: ImmPref = o.imm === 'exquisite' || o.imm === 'gentle' || o.imm === 'smooth' || o.imm === 'adaptive'
        ? o.imm : 'adaptive';
      return { motion: o.motion !== false, glass: o.glass !== false, contrast: !!o.contrast, imm };
    }
  } catch { /* 首次 */ }
  return { motion: systemMotion(), glass: true, contrast: false, imm: 'adaptive' };
};
const applyPrefs = (p: MnemePrefs) => {
  const el = document.documentElement;
  el.classList.toggle('no-motion', !p.motion);
  el.classList.toggle('no-glass', !p.glass);
  el.classList.toggle('contrast-high', p.contrast);
  applyImmFromPrefs();
};

/** 20 分钟可关微歇：不写进「当日一次」 */
const useMicroRest = (onFire: () => void, enabled: boolean) => {
  const ref = useRef({ active: 0, last: Date.now() });
  const fire = useRef(onFire);
  fire.current = onFire;
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      const st = ref.current;
      if (document.hidden) return;
      if (Date.now() - st.last > 120_000) st.active = 0;
      st.last = Date.now();
      st.active += 1;
      if (st.active < 20) return;
      st.active = 0;
      fire.current();
    }, 60_000);
    return () => clearInterval(id);
  }, [enabled]);
};

/** E3 · 连续活跃 45 分钟温和提示（当日一次） */
const useReadingTimer = (onFire: () => void) => {
  const ref = useRef({ active: 0, last: Date.now() });
  const fire = useRef(onFire);
  fire.current = onFire;
  useEffect(() => {
    const id = window.setInterval(() => {
      const st = ref.current;
      if (document.hidden) return;
      if (Date.now() - st.last > 120_000) st.active = 0; // 离开超 2 分钟重新计时
      st.last = Date.now();
      st.active += 1;
      if (st.active < 45) return;
      const today = new Date().toDateString();
      try { if (localStorage.getItem('mneme-rest-hint') === today) return; } catch { /* 忽略 */ }
      try { localStorage.setItem('mneme-rest-hint', today); } catch { /* 忽略 */ }
      fire.current();
    }, 60_000);
    return () => clearInterval(id);
  }, []);
};

/** C6 · 本周足迹：独立计数，不被最近 48 条表截断 */
const weekFootprint = () => weekOpenStats();

export function Wellness({ onGoSpace: _onGoSpace }: { onGoSpace: (key: string) => void }) {
  const [prefs, setPrefs] = useState<MnemePrefs>(readPrefs);
  const [panel, setPanel] = useState<'none' | 'prefs'>('none');
  const [rest, setRest] = useState(false);
  const [micro, setMicro] = useState(false);
  const [microOn, setMicroOn] = useState(() => {
    try { return localStorage.getItem('mneme-micro-off') !== '1'; } catch { return true; }
  });
  const [paperLock, setPaperLock] = useState(() => {
    try { return localStorage.getItem('mneme-paper-lock') === '1'; } catch { return false; }
  });
  const bgmWas = useRef(false);
  const microBgm = useRef(false);
  const [foot, setFoot] = useState(() => weekFootprint());
  const [vitals, setVitals] = useState(() => vitalStats());
  const [sync, setSync] = useState<AdminStatus['sync']>(undefined);
  const [bgm, setBgm] = useState(bgmGet);
  const [dev, setDev] = useState<DeviceInfo | null>(() => (typeof window === 'undefined' ? null : readDevice()));
  const prefRef = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const closePrefs = () => {
    if (closing.current) return;
    closing.current = true;
    dismissGlass(prefRef.current, () => { closing.current = false; setPanel('none'); });
  };
  useFocusTrap(prefRef, panel === 'prefs', closePrefs);
  useEffect(() => {
    if (panel !== 'prefs') return;
    closing.current = false;
    const t = window.setTimeout(() => armSnapshot(prefRef.current), 400);
    return () => window.clearTimeout(t);
  }, [panel]);
  useEffect(() => bgmSub(setBgm), []);
  useEffect(() => {
    const on = () => setDev(readDevice());
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    window.visualViewport?.addEventListener('resize', on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
      window.visualViewport?.removeEventListener('resize', on);
    };
  }, []);

  useEffect(() => { applyPrefs(prefs); }, [prefs]);
  useEffect(() => {
    const openPrefs = () => setPanel('prefs');
    window.addEventListener('mneme:prefs', openPrefs);
    return () => window.removeEventListener('mneme:prefs', openPrefs);
  }, []);
  useEffect(() => {
    const tick = () => { setFoot(weekFootprint()); setVitals(vitalStats()); };
    const t = window.setInterval(tick, 15_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    api.adminStatus().then(s => setSync(s.sync)).catch(() => {});
  }, [panel]);
  useReadingTimer(() => {
    bgmWas.current = bgmGet().on;
    if (bgmWas.current) bgmSet({ on: false });
    setRest(true);
  });
  useEffect(() => {
    if (!microOn) return;
    const st = { active: 0, last: Date.now() };
    const id = window.setInterval(() => {
      if (document.hidden) return;
      if (Date.now() - st.last > 120_000) st.active = 0;
      st.last = Date.now();
      st.active += 1;
      if (st.active < 20) return;
      st.active = 0;
      microBgm.current = bgmGet().on;
      if (microBgm.current) bgmSet({ on: false });
      setMicro(true);
    }, 60_000);
    return () => window.clearInterval(id);
  }, [microOn]);
  const closeRest = (again: boolean) => {
    setRest(false);
    if (bgmWas.current) bgmSet({ on: true });
    if (again) {
      try { localStorage.removeItem('mneme-rest-hint'); } catch { /* */ }
    }
  };
  /* C5 · j/k 滚动（g / ? 由 App 统一处理） */
  useEffect(() => {
    const host = () => readScroller();
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.isComposing || t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'j' || e.key === 'k') {
        const toc = document.querySelector('.ar-toc');
        const active = document.activeElement as HTMLElement | null;
        if (toc && active && toc.contains(active)) {
          const btns = [...toc.querySelectorAll('button')];
          const i = btns.indexOf(active as HTMLButtonElement);
          const next = btns[i + (e.key === 'j' ? 1 : -1)] as HTMLButtonElement | undefined;
          if (next) { e.preventDefault(); next.focus(); next.click(); }
          return;
        }
        const el = host(); if (!el) return;
        e.preventDefault();
        el.scrollBy({ top: e.key === 'j' ? 260 : -260, behavior: 'smooth' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const set = (k: 'motion' | 'glass' | 'contrast') => {
    const next = { ...prefs, [k]: !prefs[k] };
    setPrefs(next);
    try { localStorage.setItem(P_KEY, JSON.stringify(next)); } catch { /* 静默 */ }
  };
  const setImm = (imm: ImmPref) => {
    const next = { ...prefs, imm };
    setPrefs(next);
    try { localStorage.setItem(P_KEY, JSON.stringify(next)); } catch { /* 静默 */ }
  };

  return (
    <>
      <button
        className="pref-hint glass chrome"
        onClick={() => { if (panel === 'prefs') closePrefs(); else setPanel('prefs'); }}
        aria-label="偏好与足迹"
        title="偏好 · 足迹"
      >
        <span className="greek">ΠΡΟΘΕΣΙΣ</span> 偏好
      </button>

      {panel === 'prefs' && (
        <div className="pref-mask" onMouseDown={closePrefs}>
          <div ref={prefRef} className="pref glass chrome" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="pref-title">
            <header className="pref-head">
              <p className="greek pref-kicker">ΠΡΟΘΕΣΙΣ · 偏好</p>
              <h1 id="pref-title">阅读偏好</h1>
              <button className="gp-sheet-x" onClick={closePrefs} aria-label="关闭">×</button>
            </header>
            <div className="pref-rows">
              <fieldset className="pref-row pref-imm">
                <legend>沉浸光感<small>顶栏、底栏和弹窗 · 对标鸿蒙强 / 均衡 / 弱 / 自适应</small></legend>
                <div className="pref-seg" role="radiogroup" aria-label="沉浸光感档位">
                  {IMM_PREFS.map(k => (
                    <label key={k}>
                      <input type="radio" name="imm" value={k} checked={prefs.imm === k} onChange={() => setImm(k)} />
                      {IMM_LABEL[k]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="pref-row">
                <span>滚动进场动效<small>空间切换与首屏的浮入动画</small></span>
                <input type="checkbox" checked={prefs.motion} onChange={() => set('motion')} />
              </label>
              <label className="pref-row">
                <span>液态玻璃光效<small>毛玻璃与跟随光的总开关（关了档位也不渲染）</small></span>
                <input type="checkbox" checked={prefs.glass} onChange={() => set('glass')} />
              </label>
              <label className="pref-row">
                <span>高对比模式<small>加深文字与边框，提升可读性</small></span>
                <input type="checkbox" checked={prefs.contrast} onChange={() => set('contrast')} />
              </label>
              <label className="pref-row">
                <span>背景音乐<small>默认开 · 关掉致谢公告后才出声 · 音量在右下角调</small></span>
                <input type="checkbox" checked={bgm.on} onChange={() => bgmSet({ on: !bgm.on })} />
              </label>
              <label className="pref-row">
                <span>锁定纸色<small>夜色仍可跟系统；勾选后纸页保持纸色</small></span>
                <input type="checkbox" checked={paperLock} onChange={() => {
                  const next = !paperLock;
                  setPaperLock(next);
                  try { localStorage.setItem('mneme-paper-lock', next ? '1' : '0'); } catch { /* */ }
                  if (next) {
                    try { localStorage.setItem('mneme-theme-manual', '1'); localStorage.setItem('mneme-theme', 'paper'); } catch { /* */ }
                    window.dispatchEvent(new CustomEvent('mneme:theme-paper'));
                  } else {
                    window.dispatchEvent(new CustomEvent('mneme:theme-system'));
                  }
                }} />
              </label>
              <label className="pref-row">
                <span>二十分钟微歇<small>可关。不计入「当日一次」的四十五分钟提示</small></span>
                <input type="checkbox" checked={microOn} onChange={() => {
                  const next = !microOn;
                  setMicroOn(next);
                  try { localStorage.setItem('mneme-micro-off', next ? '0' : '1'); } catch { /* */ }
                }} />
              </label>
              <button type="button" className="pref-sys" onClick={() => window.dispatchEvent(new CustomEvent('mneme:theme-system'))}>
                主题重新跟随系统
              </button>
            </div>
            <div className="pref-foot">
              <p className="greek pref-kicker">ΙΧΝΟΣ · 足迹</p>
              <p className="pref-footline">
                本周打开 <b>{foot.docs}</b> 篇材料 · 共 <b>{foot.opens}</b> 次
                {foot.last ? ` · 最近 ${timeAgo(foot.last)}` : ' · 本周尚未开始阅读'}
              </p>
              {getRecentDocs().slice(0, 8).length > 0 && (
                <ul className="pref-list">
                  {getRecentDocs().slice(0, 8).map(d => (
                    <li key={d.path}><a href={routeToPath({ v: 'doc', path: d.path })}>{d.title}</a><em>{timeAgo(d.t)}</em></li>
                  ))}
                </ul>
              )}
              {getHighlights().length > 0 && (
                <>
                  <p className="greek pref-kicker">ΣΗΜΕΙΟΝ · 本机划线</p>
                  <ul className="pref-list">
                    {getHighlights().slice(0, 6).map(h => (
                      <li key={h.id}><a href={routeToPath({ v: 'doc', path: h.path, h: h.heading || undefined, q: h.snippet.slice(0, 48) })}>{h.snippet}</a><em>{h.title}</em></li>
                    ))}
                  </ul>
                </>
              )}
              <p className="greek pref-kicker">ΜΕΤΡΟΝ · 本机现场</p>
              <p className="pref-footline">
                {vitals.n
                  ? <>本机 {vitals.n} 次 · LCP p75 <b>{vitals.lcp != null ? `${Math.round(vitals.lcp)}ms` : '—'}</b> · INP p75 <b>{vitals.inp != null ? `${Math.round(vitals.inp)}ms` : '—'}</b> · CLS p75 <b>{vitals.cls != null ? vitals.cls.toFixed(3) : '—'}</b>{vitals.last ? ` · ${vitals.last.kind} ${vitals.last.vw}×${Math.round(vitals.last.dpr * 10) / 10}` : ''}</>
                  : '打开过页面后，这里会留下这台设备的第 75 百分位。不外传。'}
              </p>
              {dev && (
                <p className="pref-footline">
                  这台设备按 <b>{osLabel(dev.os)}</b> · <b>{shellLabel(dev.shell)}</b>
                  {dev.orient === 'land' ? ' · 横屏' : ' · 竖屏'} · {dev.vw}×{dev.vh}
                  {dev.standalone ? ' · 主屏' : ''}
                </p>
              )}
              <p className="pref-footline dim">
                现场数字只留在这台浏览器，不会汇到我这边，也不会传到别的设备。鸿蒙和电脑要各开一次。
              </p>
              {sync && (
                <p className="pref-footline">
                  本机知识库{sync.watching ? '正在听改动' : '未监听'}
                  {sync.pending ? ' · 索引中' : ''}
                  {sync.last?.t ? ` · 上次 ${timeAgo(new Date(sync.last.t).getTime())}` : ''}
                  {sync.last && sync.last.code !== 0 && sync.last.code != null ? ' · 上次未完成' : ''}
                </p>
              )}
              <button type="button" className="pref-sys" onClick={() => {
                const payload = {
                  at: new Date().toISOString(),
                  device: dev,
                  vitals: vitalStats(),
                };
                const text = JSON.stringify(payload, null, 2);
                const ok = () => notify('已复制这台设备的现场，不会上传', 'info');
                if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(ok).catch(() => notify('复制失败', 'warn'));
                else notify('复制失败', 'warn');
              }}>复制本机现场</button>
              <p className="pref-footline dim">顶栏 <kbd>?</kbd> 查看快捷键 · <kbd>g</kbd>+字母 跳空间 · <kbd>j</kbd>/<kbd>k</kbd> 滚动 · 划线只在本机</p>
            </div>
          </div>
        </div>
      )}

      {micro && (
        <div className="rest-toast glass micro" role="status">
          <p>已经读了 <b>20 分钟</b>。背景曲已先停。站起来一下也行。</p>
          <span className="rest-actions">
            <button type="button" className="ghost" onClick={() => {
              setMicro(false);
              if (microBgm.current) bgmSet({ on: true });
            }}>继续</button>
            <button type="button" onClick={() => {
              setMicro(false);
              setMicroOn(false);
              try { localStorage.setItem('mneme-micro-off', '1'); } catch { /* */ }
              if (microBgm.current) bgmSet({ on: true });
            }}>关掉微歇</button>
          </span>
        </div>
      )}
      {rest && (
        <div className="rest-toast glass" role="status">
          <p>已经连续阅读 <b>45 分钟</b>了。背景曲已先停。歇一会儿，纸还在。</p>
          <span className="rest-actions">
            <button type="button" className="ghost" onClick={() => closeRest(true)}>再读一会儿</button>
            <button type="button" onClick={() => closeRest(false)}>好的</button>
          </span>
        </div>
      )}
    </>
  );
}
