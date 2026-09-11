import { useEffect, useRef, useState } from 'react';
import { getRecentDocs, getLastChapter, timeAgo } from '../history';
import { bgmGet, bgmSet, bgmSub } from '../bgm';

/**
 * v4 · C5 键盘导航层 + C6 阅读足迹 + E3 阅读时长感知 + E4 站内偏好开关（含 E2 高对比）。
 * 一个组件承载三件事，入口：
 * - 齿轮按钮（导航右侧）→ 偏好面板：动效/玻璃光/高对比开关 + 本周足迹统计；
 * - 「?」→ 快捷键表；「g+字母」跳空间；「j/k」滚动。
 * 全部偏好落 localStorage（mneme-prefs），documentElement class 驱动 CSS/JS 行为。
 */
export interface MnemePrefs { motion: boolean; glass: boolean; contrast: boolean }
const P_KEY = 'mneme-prefs';
export const readPrefs = (): MnemePrefs => {
  try { return { motion: true, glass: true, contrast: false, ...JSON.parse(localStorage.getItem(P_KEY) || '{}') }; }
  catch { return { motion: true, glass: true, contrast: false }; }
};
const applyPrefs = (p: MnemePrefs) => {
  const el = document.documentElement;
  el.classList.toggle('no-motion', !p.motion);
  el.classList.toggle('no-glass', !p.glass);
  el.classList.toggle('contrast-high', p.contrast);
};

/** E3 · 连续活跃 45 分钟温和提示（当日一次） */
const useReadingTimer = (onFire: () => void) => {
  const ref = useRef({ active: 0, last: Date.now() });
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
      onFire();
    }, 60_000);
    return () => clearInterval(id);
  }, [onFire]);
};

/** C6 · 本周足迹：7 天内打开的材料数 / 打开次数 */
const weekFootprint = () => {
  const weekAgo = Date.now() - 7 * 86_400_000;
  const docs = getRecentDocs().filter(d => d.t >= weekAgo);
  const ch = getLastChapter();
  const chThis = ch && ch.t >= weekAgo ? 1 : 0;
  return { docs: docs.length, opens: docs.length + chThis, last: docs[0]?.t ?? ch?.t ?? null };
};

const SPACE_KEYS: [string, string, string][] = [
  ['s', '记忆恒星', 'stars'], ['a', '原文档案馆', 'archive'], ['g', '人物星图', 'graph'],
  ['r', '时间之河', 'river'], ['t', '主题域', 'themes'], ['v', '他者之声', 'voices'],
  ['m', '意象博物馆', 'museum'], ['b', '五卷书房', 'study'], ['l', '证据灯塔', 'lighthouse'],
];

export function Wellness({ onGoSpace }: { onGoSpace: (key: string) => void }) {
  const [prefs, setPrefs] = useState<MnemePrefs>(readPrefs);
  const [panel, setPanel] = useState<'none' | 'prefs' | 'keys'>('none');
  const [rest, setRest] = useState(false);
  const [foot, setFoot] = useState(() => weekFootprint());
  const [bgm, setBgm] = useState(bgmGet);
  useEffect(() => bgmSub(setBgm), []);

  useEffect(() => { applyPrefs(prefs); }, [prefs]);
  useEffect(() => { const t = window.setInterval(() => setFoot(weekFootprint()), 60_000); return () => clearInterval(t); }, []);
  useReadingTimer(() => setRest(true));

  /* C5 · 全局键盘：? 帮助 / g+字母 跳空间 / j k 滚动 */
  useEffect(() => {
    let gPending = false; let gTimer = 0;
    const host = () => document.querySelector('.space-host') as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.isComposing || t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (gPending) {
        const hit = SPACE_KEYS.find(([k]) => k === e.key.toLowerCase());
        gPending = false; clearTimeout(gTimer);
        if (hit) { e.preventDefault(); onGoSpace(hit[2]); }
        return;
      }
      if (e.key === '?') { e.preventDefault(); setPanel(v => (v === 'keys' ? 'none' : 'keys')); }
      else if (e.key.toLowerCase() === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        gPending = true; clearTimeout(gTimer); gTimer = window.setTimeout(() => { gPending = false; }, 700);
      }
      else if (e.key === 'j' || e.key === 'k') {
        const el = host(); if (!el) return;
        e.preventDefault();
        el.scrollBy({ top: e.key === 'j' ? 260 : -260, behavior: 'smooth' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(gTimer); };
  }, [onGoSpace]);

  const set = (k: keyof MnemePrefs) => {
    const next = { ...prefs, [k]: !prefs[k] };
    setPrefs(next);
    try { localStorage.setItem(P_KEY, JSON.stringify(next)); } catch { /* 静默 */ }
  };

  return (
    <>
      <button
        className="pref-hint glass"
        onClick={() => setPanel(v => (v === 'prefs' ? 'none' : 'prefs'))}
        aria-label="偏好与足迹"
        title="偏好 · 足迹（? 查看快捷键）"
      >
        <span className="greek">ΠΡΟΘΕΣΙΣ</span> 偏好
      </button>

      {panel === 'prefs' && (
        <div className="pref-mask" onMouseDown={() => setPanel('none')}>
          <div className="pref glass" onMouseDown={e => e.stopPropagation()}>
            <header className="pref-head">
              <p className="greek pref-kicker">ΠΡΟΘΕΣΙΣ · 偏好</p>
              <h3>阅读偏好</h3>
              <button className="gp-sheet-x" onClick={() => setPanel('none')} aria-label="关闭">×</button>
            </header>
            <div className="pref-rows">
              <label className="pref-row">
                <span>滚动进场动效<small>空间切换与首屏的浮入动画</small></span>
                <input type="checkbox" checked={prefs.motion} onChange={() => set('motion')} />
              </label>
              <label className="pref-row">
                <span>液态玻璃光效<small>毛玻璃模糊与跟随光（低端设备可关）</small></span>
                <input type="checkbox" checked={prefs.glass} onChange={() => set('glass')} />
              </label>
              <label className="pref-row">
                <span>高对比模式<small>加深文字与边框，提升可读性</small></span>
                <input type="checkbox" checked={prefs.contrast} onChange={() => set('contrast')} />
              </label>
              <label className="pref-row">
                <span>背景音乐<small>循环播放站点背景曲 · 音量在右下角控件调节</small></span>
                <input type="checkbox" checked={bgm.on} onChange={() => bgmSet({ on: !bgm.on })} />
              </label>
            </div>
            <div className="pref-foot">
              <p className="greek pref-kicker">ΙΧΝΟΣ · 足迹</p>
              <p className="pref-footline">
                本周打开 <b>{foot.docs}</b> 篇材料 · 共 <b>{foot.opens}</b> 次
                {foot.last ? ` · 最近 ${timeAgo(foot.last)}` : ' · 本周尚未开始阅读'}
              </p>
              <p className="pref-footline dim">按 <kbd>?</kbd> 查看快捷键 · <kbd>g</kbd>+字母 跳空间 · <kbd>j</kbd>/<kbd>k</kbd> 滚动</p>
            </div>
          </div>
        </div>
      )}

      {panel === 'keys' && (
        <div className="pref-mask" onMouseDown={() => setPanel('none')}>
          <div className="pref glass" onMouseDown={e => e.stopPropagation()}>
            <header className="pref-head">
              <p className="greek pref-kicker">ΚΛΕΙΣ · 快捷键</p>
              <h3>键盘导航</h3>
              <button className="gp-sheet-x" onClick={() => setPanel('none')} aria-label="关闭">×</button>
            </header>
            <div className="keys-rows">
              <div className="keys-row"><kbd>⌘K</kbd><span>检索全库</span></div>
              <div className="keys-row"><kbd>g</kbd><span>然后按字母跳空间：{SPACE_KEYS.map(([k, n]) => <em key={k}><kbd>{k}</kbd>{n}</em>)}</span></div>
              <div className="keys-row"><kbd>j</kbd><span>向下滚动</span></div>
              <div className="keys-row"><kbd>k</kbd><span>向上滚动</span></div>
              <div className="keys-row"><kbd>?</kbd><span>本表</span></div>
              <div className="keys-row"><kbd>Esc</kbd><span>关闭面板</span></div>
            </div>
          </div>
        </div>
      )}

      {rest && (
        <div className="rest-toast glass" role="status">
          <p>已经连续阅读 <b>45 分钟</b>了——歇一会儿，回来再继续。</p>
          <button onClick={() => setRest(false)}>好的</button>
        </div>
      )}
    </>
  );
}
