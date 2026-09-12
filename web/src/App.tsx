import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api, apiErrorMessage, swrInvalidate, type Overview } from './api';
import { notify } from './toast';
import ErrorBoundary from './ErrorBoundary';
import { Gate } from './space/Gate';
import { Stars } from './space/Stars';
import { CommandK } from './space/CommandK';
import { SecretGate } from './space/SecretGate';
import { Wellness } from './space/Wellness';
import { Announce } from './space/Announce';
import { BGM } from './space/BGM';
import { bgmGet, bgmSet, bgmSub, enterBgm, stopBgm } from './bgm';
import { immLevel, immDisplacementScale, bindGradientBlur, bindPressRipple, bindSmartInk, watchFps } from './immersive';
import { armSnapshot, dismissGlass } from './glassDismiss';
import { Foreshadow } from './space/Foreshadow';
import { ShortcutsHelp, G_THEN } from './space/Shortcuts';
import { readPrefs } from './space/Wellness';
import { useFocusTrap } from './focusTrap';
import { stageAnchorYear } from './stages';
import { parseLocation, routeId, routeToPath, migrateHashIfNeeded, type Route, type SpaceKey, type RiverQuery } from './route';
import { getDocNeighbors, getRecentDocs, isPublicPath, resumeTarget } from './history';
import { bookFromVolume, clearSilkCatalog } from './silk';
import { SilkRibbon } from './space/SilkRibbon';
import { purgePublicDrafts } from './drafts';
import { readScroller } from './readHost';
import { prefetchSpace, prefetchWorkbench } from './prefetch';
import { isModifiedClick } from './navClick';
import { copyPermalink, shareOrCopyPermalink } from './cite';
import { formatTitle } from './liveTitle';
import { lazySpace } from './lazySpace';

/* v4 · B1 路由代码分割：d3-force（Graph）与重型空间按需加载，首屏只载 记忆恒星+导航 */
const River = lazySpace(() => import('./space/River').then(m => ({ default: m.River })));
const Graph = lazySpace(() => import('./space/Graph').then(m => ({ default: m.Graph })));
const Archive = lazySpace(() => import('./space/Archive').then(m => ({ default: m.Archive })));
const Study = lazySpace(() => import('./space/Study').then(m => ({ default: m.Study })));
const ChapterPanel = lazySpace(() => import('./space/ChapterPanel').then(m => ({ default: m.ChapterPanel })));
const Museum = lazySpace(() => import('./space/Museum').then(m => ({ default: m.Museum })));
const Voices = lazySpace(() => import('./space/Voices').then(m => ({ default: m.Voices })));
const Themes = lazySpace(() => import('./space/Themes').then(m => ({ default: m.Themes })));
const Lighthouse = lazySpace(() => import('./space/Lighthouse').then(m => ({ default: m.Lighthouse })));
const Lazy = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<div className="space-loading" aria-label="加载中" />}>{children}</Suspense>
);

/** v3.5 · 四分组导航：工作台把阅读放在第一位（正文才是产品） */
const NAV_GROUPS = [
  { label: '工作台', spaces: [
    { key: 'archive', name: '原文档案馆', sub: '阅读' },
    { key: 'stars', name: '记忆恒星', sub: '门厅' },
  ] },
  { label: '资料', spaces: [
    { key: 'graph', name: '人物星图', sub: '人物' },
    { key: 'river', name: '时间之河', sub: '时间线' },
    { key: 'themes', name: '主题域', sub: '十域' },
    { key: 'voices', name: '他者之声', sub: '问卷' },
  ] },
  { label: '书稿', spaces: [{ key: 'study', name: '书房', sub: '六部' }] },
  { label: '探索', spaces: [{ key: 'museum', name: '意象博物馆', sub: '意象' }] },
  { label: '治理', spaces: [{ key: 'lighthouse', name: '证据灯塔', sub: '证据' }] },
] as const;

const MOBILE_TABS: { label: string; kind: 'read' | 'data' | 'book'; go: SpaceKey; match: readonly SpaceKey[] }[] = [
  { label: '阅读', kind: 'read', go: 'archive', match: ['archive'] },
  { label: '资料', kind: 'data', go: 'graph', match: ['graph', 'river', 'themes', 'voices'] },
  { label: '书稿', kind: 'book', go: 'study', match: ['study'] },
];
const MORE_KEYS: SpaceKey[] = ['stars', 'museum', 'lighthouse'];

function PhoneTabIcon({ kind }: { kind: 'read' | 'data' | 'book' | 'more' }) {
  const p = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (kind === 'read') return <svg {...p} aria-hidden><path d="M4 5.2h7.4A3.2 3.2 0 0 1 14.6 8.4V20H7.4A3.4 3.4 0 0 0 4 23.4Z" /><path d="M20 5.2h-7.4A3.2 3.2 0 0 0 9.4 8.4V20h7.2A3.4 3.4 0 0 1 20 23.4Z" /></svg>;
  if (kind === 'data') return <svg {...p} aria-hidden><circle cx="8" cy="8" r="2.2" /><circle cx="16.5" cy="7.2" r="1.7" /><circle cx="12.2" cy="16.2" r="2" /><path d="M9.6 9.6 11.2 14.4M14.8 8.6 13.2 14.4M10.1 8.1 14.8 7.6" /></svg>;
  if (kind === 'book') return <svg {...p} aria-hidden><path d="M5 4.5h10.2A3.3 3.3 0 0 1 18.5 7.8V20H8.2A3.2 3.2 0 0 0 5 23.2Z" /><path d="M8.4 4.5V20" /></svg>;
  return <svg {...p} aria-hidden><path d="M5 7h14M5 12h14M5 17h10" /></svg>;
}

/** 总纲 · 站点目录（Σ 空间一句话导览，v4） */
const TOC: Record<SpaceKey, { greek: string; name: string; line: string }> = {
  stars: { greek: 'Σ1', name: '记忆恒星', line: '门厅 · 全库丰碑与工作台' },
  river: { greek: 'Σ2', name: '时间之河', line: '1990–2032 人生长卷，时间之船可自动巡航' },
  graph: { greek: 'Σ3', name: '人物星图', line: '亲密度四环星座 · 星表可检索' },
  study: { greek: 'Σ4', name: '书房', line: '《补写的手册》· 序与六部，密章点开弹窗' },
  themes: { greek: 'Σ5', name: '主题域', line: '九大域陈列全库公开文档' },
  museum: { greek: 'Σ6', name: '意象博物馆', line: '主意象常设展与候选素牌' },
  archive: { greek: 'Σ7', name: '原文档案馆', line: '全部原文阅读 · 锚点直达' },
  voices: { greek: 'Σ8', name: '他者之声', line: '问卷精选对照（V1–V3 三轮采集）' },
  lighthouse: { greek: 'Σ9', name: '证据灯塔', line: '证据分级与全库审计' },
};

/* 每条路由的阅读位置（v4 · A3 起跨会话持久化：localStorage，LRU 上限 80 条） */
const SCROLL_KEY = 'mneme-scroll';
const loadScrollMemo = (): Map<string, number> => {
  try {
    const o: unknown = JSON.parse(localStorage.getItem(SCROLL_KEY) || '{}');
    if (o && typeof o === 'object') {
      return new Map(Object.entries(o as Record<string, unknown>).map(([k, v]) => [k, Number(v) || 0]));
    }
  } catch { /* 首访/损坏/隐私模式 → 空表 */ }
  return new Map();
};
const scrollMemo = loadScrollMemo();
const persistScroll = () => {
  try {
    while (scrollMemo.size > 80) {
      const k = scrollMemo.keys().next().value;
      if (k === undefined) break;
      scrollMemo.delete(k);
    }
    localStorage.setItem(SCROLL_KEY, JSON.stringify(Object.fromEntries(scrollMemo)));
  } catch { /* 存储不可用时静默降级为会话内存 */ }
};

export default function App() {
  const [gateDone, setGateDone] = useState(() => sessionStorage.getItem('mneme-gate') === '1');
  const [annoOpen, setAnnoOpen] = useState(() => sessionStorage.getItem('mneme-gate') === '1' && !sessionStorage.getItem('mneme-anno'));
  const [secretOpen, setSecretOpen] = useState(false);
  const [focusRead, setFocusRead] = useState(() => {
    try { return localStorage.getItem('mneme-focus') === '1'; } catch { return false; }
  });
  useEffect(() => {
    immLevel();
    watchFps();
    const applyDisp = () => {
      const node = document.getElementById('mneme-disp');
      if (node) node.setAttribute('scale', String(immDisplacementScale()));
    };
    applyDisp();
    const offInk = bindSmartInk();
    window.addEventListener('mneme:imm', applyDisp);
    return () => {
      offInk();
      window.removeEventListener('mneme:imm', applyDisp);
    };
  }, []);
  useEffect(() => {
    if (!gateDone) return;
    prefetchWorkbench();
    enterBgm();
  }, [gateDone]);
  useEffect(() => {
    if (annoOpen) stopBgm();
  }, [annoOpen]);
  useEffect(() => {
    const onGate = (e: Event) => setSecretOpen(!!(e as CustomEvent<boolean>).detail);
    const onSearch = () => { setCkOpen(true); setHelpOpen(false); };
    const onFocus = () => setFocusRead(v => !v);
    window.addEventListener('mneme:secret-gate', onGate);
    window.addEventListener('mneme:search', onSearch);
    window.addEventListener('mneme:focus', onFocus);
    return () => {
      window.removeEventListener('mneme:secret-gate', onGate);
      window.removeEventListener('mneme:search', onSearch);
      window.removeEventListener('mneme:focus', onFocus);
    };
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('focus-read', focusRead);
    try { localStorage.setItem('mneme-focus', focusRead ? '1' : '0'); } catch { /* */ }
  }, [focusRead]);
  useEffect(() => {
    if (!gateDone) return;
    const host = readScroller() || document.querySelector('.space-host') as HTMLElement | null;
    const nav = document.querySelector('.topbar') as HTMLElement | null;
    if (!host || !nav) return;
    const offBlur = bindGradientBlur(host, nav);
    const offRipple = bindPressRipple(document.body);
    return () => { offBlur(); offRipple(); };
  }, [gateDone]);
  const [ov, setOv] = useState<Overview | null>(null);
  const [vaultOpen, setVaultOpen] = useState(false);
  useEffect(() => {
    const check = () => {
      document.documentElement.classList.toggle('page-hidden', document.hidden);
      try {
        const day = sessionStorage.getItem('mneme-unlock-day');
        if (day && day !== new Date().toDateString()) {
          api.lockSecret().then(() => {
            sessionStorage.removeItem('mneme-unlock-day');
            setVaultOpen(false);
            swrInvalidate();
          }).catch(() => {});
        }
      } catch { /* */ }
    };
    check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, []);
  const [route, setRoute] = useState<Route>(() => {
    migrateHashIfNeeded();
    /* `/` 续读上次材料；显式 `/space/stars` 仍是门厅，避免「记忆恒星」点不回去。 */
    const path = location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/') {
      const r = resumeTarget();
      if (r) {
        const next: Route = r.kind === 'doc'
          ? { v: 'doc', path: r.path }
          : { v: 'chapter', code: r.code, seq: r.seq };
        history.replaceState(null, '', routeToPath(next));
        return next;
      }
    }
    return parseLocation();
  });
  const [riverFocus, setRiverFocus] = useState<{ year: number; eventId?: number } | null>(null);
  const [ckOpen, setCkOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [gPending, setGPending] = useState(false);
  const gPendingRef = useRef(false);
  const gTimer = useRef(0);
  const [tocOpen, setTocOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [bgmOn, setBgmOn] = useState(() => bgmGet().on);
  const moreRef = useRef<HTMLDivElement>(null);
  const tocRef = useRef<HTMLDivElement>(null);
  const readBarRef = useRef<HTMLSpanElement>(null);
  const fxLock = useRef(false);
  const closeMore = (after?: () => void) => {
    if (fxLock.current) return;
    const finish = () => { fxLock.current = false; setMoreOpen(false); after?.(); };
    if (moreRef.current) {
      fxLock.current = true;
      dismissGlass(moreRef.current, finish);
    } else finish();
  };
  const closeToc = (after?: () => void) => {
    if (fxLock.current) return;
    const finish = () => { fxLock.current = false; setTocOpen(false); after?.(); };
    if (tocRef.current) {
      fxLock.current = true;
      dismissGlass(tocRef.current, finish);
    } else finish();
  };
  useFocusTrap(moreRef, moreOpen, () => closeMore());
  useFocusTrap(tocRef, tocOpen, () => closeToc());
  useEffect(() => {
    if (!moreOpen && !tocOpen) { fxLock.current = false; return; }
    const t = window.setTimeout(() => armSnapshot(moreOpen ? moreRef.current : tocRef.current), 400);
    return () => window.clearTimeout(t);
  }, [moreOpen, tocOpen]);
  useEffect(() => bgmSub(s => setBgmOn(s.on)), []);
  const [foCount, setFoCount] = useState<number | null>(null);
  const [theme, setTheme] = useState<'paper' | 'night'>(() => {
    const saved = localStorage.getItem('mneme-theme');
    if (saved === 'night' || saved === 'paper') return saved;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'paper';
  });
  const mainRef = useRef<HTMLElement>(null);
  const routeRef = useRef(route);
  routeRef.current = route;

  useEffect(() => {
    const load = () => api.overview().then(setOv).catch(e => notify(apiErrorMessage(e), 'error'));
    const vault = () => api.secretStatus().then(s => setVaultOpen(s.unlocked)).catch(() => {});
    load();
    vault();
    const onUnlocked = () => { setFoCount(null); clearSilkCatalog(); load(); vault(); };
    window.addEventListener('mneme:unlocked', onUnlocked);
    return () => window.removeEventListener('mneme:unlocked', onUnlocked);
  }, []);

  /* 文档标题跟随路由；人物/原文/意象加载后再用真名覆盖（mneme:live-title） */
  const routeTitle = route.v === 'space' ? TOC[route.key]?.name
    : route.v === 'doc' ? decodeURIComponent(route.path).split('/').pop()?.replace(/\.md$/i, '')
    : route.v === 'person' ? '人物'
    : route.v === 'imagery' ? '意象'
    : route.v === 'volume' ? route.code
    : route.v === 'chapter' ? `章节 ${route.code}-${route.seq}`
    : '伏应矩阵';
  const [liveAnnounce, setLiveAnnounce] = useState(routeTitle || '');
  useEffect(() => {
    document.title = formatTitle(routeTitle);
    setLiveAnnounce(routeTitle || '');
    const on = (e: Event) => {
      const part = (e as CustomEvent<string | null>).detail;
      document.title = formatTitle(part ?? routeTitle);
      if (typeof part === 'string' && part.trim()) setLiveAnnounce(part.trim());
      else setLiveAnnounce(routeTitle || '');
    };
    window.addEventListener('mneme:live-title', on);
    return () => window.removeEventListener('mneme:live-title', on);
  }, [routeTitle]);
  useEffect(() => {
    const code = bookFromVolume(route.v === 'volume' || route.v === 'chapter' ? route.code : undefined);
    const root = document.documentElement;
    if (code) root.dataset.book = code;
    else if (route.v !== 'doc') delete root.dataset.book;
  }, [route]);

  /* 总纲里的伏应条数接数据源（原先硬编码「25 条」，台账增删后必然过期） */
  useEffect(() => {
    if (!tocOpen || foCount != null) return;
    /* 静默可接受：只是总纲里的一句装饰性计数，失败时渲染层已有
       「伏笔—回收跨卷配对图（创作台账）」无数字兜底（见下方 TOC 渲染），
       为此弹提示反而更吵。 */
    api.foreshadow().then(rows => setFoCount(rows.length)).catch(() => {});
  }, [tocOpen, foCount]);

  /* History API：前进后退走 popstate；旧 hash 书签在首次进入时改写 */
  useEffect(() => {
    migrateHashIfNeeded();
    const apply = () => setRoute(parseLocation());
    const onPop = () => {
      const doc = document as Document & { startViewTransition?: (cb: () => void) => void };
      const motionOk = !matchMedia('(prefers-reduced-motion: reduce)').matches && readPrefs().motion;
      if (motionOk && typeof doc.startViewTransition === 'function') doc.startViewTransition(apply);
      else apply();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /* 空间切换：丝带做 View Transition 共享元素，不再整页淡入 */

  /* 阅读位置：切换前记下当前路由的滚动，应用后恢复目标路由的滚动（A3：节流持久化） */
  useEffect(() => {
    const host = mainRef.current;
    if (!host) return;
    const prevId = routeId(routeRef.current);
    let timer = 0;
    const onScroll = () => {
      scrollMemo.set(prevId, host.scrollTop);
      clearTimeout(timer);
      timer = window.setTimeout(persistScroll, 500);
    };
    host.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      host.removeEventListener('scroll', onScroll);
      clearTimeout(timer);
      scrollMemo.set(routeId(route), host.scrollTop);
      persistScroll();
    };
  }, [route, gateDone]);
  useEffect(() => {
    const host = mainRef.current;
    if (!host || !gateDone) return;
    if (route.v === 'doc' && (route.h || route.q || route.ev != null)) return; // 锚点 / 检索词 / 证据深链：交给正文定位
    const saved = scrollMemo.get(routeId(route));
    host.scrollTop = saved ?? 0;
  }, [route, gateDone]);

  /* 原文阅读进度：只改 transform，不触发 App 重绘 */
  useEffect(() => {
    const bar = readBarRef.current;
    const wrap = bar?.parentElement;
    if (!bar || !wrap) return;
    const isDoc = route.v === 'doc';
    wrap.classList.toggle('on', isDoc);
    wrap.setAttribute('aria-hidden', isDoc ? 'false' : 'true');
    const upd = () => {
      if (!isDoc) { bar.style.transform = 'scaleX(0)'; return; }
      const host = readScroller() || mainRef.current;
      if (!host) { bar.style.transform = 'scaleX(0)'; return; }
      const max = host.scrollHeight - host.clientHeight;
      const p = max <= 0 ? 1 : Math.min(1, host.scrollTop / max);
      bar.style.transform = `scaleX(${p})`;
    };
    upd();
    document.addEventListener('scroll', upd, { capture: true, passive: true });
    window.addEventListener('resize', upd);
    window.addEventListener('mneme:layout', upd);
    return () => {
      document.removeEventListener('scroll', upd, true);
      window.removeEventListener('resize', upd);
      window.removeEventListener('mneme:layout', upd);
    };
  }, [route, gateDone]);

  /* 主题持久化 + <html data-theme> 挂载（M6 双主题） */
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'night') root.setAttribute('data-theme', 'night');
    else root.removeAttribute('data-theme');
    localStorage.setItem('mneme-theme', theme);
    const color = theme === 'night' ? '#14120E' : '#F5F0E6';
    document.querySelectorAll('meta[name="theme-color"][media]').forEach(m => m.remove());
    let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = color;
    const apple = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (apple) apple.setAttribute('content', theme === 'night' ? 'black-translucent' : 'default');
  }, [theme]);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => {
      try { if (localStorage.getItem('mneme-theme-manual') === '1') return; } catch { /* 隐私模式 */ }
      setTheme(mq.matches ? 'night' : 'paper');
    };
    const onSys = () => {
      try { localStorage.removeItem('mneme-theme-manual'); localStorage.removeItem('mneme-paper-lock'); } catch { /* */ }
      sync();
    };
    const onPaper = () => {
      try { localStorage.setItem('mneme-theme-manual', '1'); } catch { /* */ }
      setTheme('paper');
    };
    sync();
    mq.addEventListener('change', sync);
    window.addEventListener('mneme:theme-system', onSys);
    window.addEventListener('mneme:theme-paper', onPaper);
    return () => {
      mq.removeEventListener('change', sync);
      window.removeEventListener('mneme:theme-system', onSys);
      window.removeEventListener('mneme:theme-paper', onPaper);
    };
  }, []);
  const toggleTheme = useCallback(() => {
    try { localStorage.setItem('mneme-theme-manual', '1'); } catch { /* 隐私模式 */ }
    setTheme(t => (t === 'night' ? 'paper' : 'night'));
  }, []);

  /* Liquid Glass（M6.5）：置换能力行为级探测 + 鼠标跟随光（rAF 节流委托）
     探测元素必须先附着 DOM——游离元素的 getComputedStyle 返回空串，曾致 Chromium 误判无置换 */
  useEffect(() => {
    const probe = document.createElement('div');
    probe.style.backdropFilter = 'url(#x) blur(2px)';
    probe.style.display = 'none';
    document.body.appendChild(probe);
    const displacementOk = /url/.test(getComputedStyle(probe).backdropFilter || '');
    probe.remove();
    document.documentElement.classList.toggle('lg-displacement', displacementOk);

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const t = (e.target as Element | null)?.closest?.('.chrome.glass') as HTMLElement | null;
        if (!t) return;
        const r = t.getBoundingClientRect();
        t.style.setProperty('--mx', `${e.clientX - r.left}px`);
        t.style.setProperty('--my', `${e.clientY - r.top}px`);
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  const enter = () => {
    sessionStorage.setItem('mneme-gate', '1');
    setGateDone(true);
    if (!sessionStorage.getItem('mneme-anno')) setAnnoOpen(true);
  };

  /* ---------- 导航：pushState；筛选类改写用 replace，避免把每次点选都推进历史 ---------- */
  const go = useCallback((r: Route, mode: 'push' | 'replace' = 'push') => {
    const apply = () => {
      const next = routeToPath(r);
      const here = `${location.pathname}${location.search}`;
      if (here !== next) {
        if (mode === 'replace') history.replaceState(null, '', next);
        else history.pushState(null, '', next);
      }
      setRoute(r);
    };
    const doc = document as Document & { startViewTransition?: (cb: () => void) => void };
    const motionOk = !matchMedia('(prefers-reduced-motion: reduce)').matches && readPrefs().motion;
    if (mode === 'push' && motionOk && typeof doc.startViewTransition === 'function') {
      doc.startViewTransition(apply);
    } else apply();
  }, []);
  const openDoc = useCallback((p: string, h?: string, ev?: number, q?: string) => {
    if (!p) return;
    const query = q?.trim().slice(0, 48) || undefined;
    go({ v: 'doc', path: p, h, ev, q: query });
  }, [go]);
  const openPerson = useCallback((id: number) => go({ v: 'person', id }), [go]);
  const openImagery = useCallback((id: number) => go({ v: 'imagery', id }), [go]);
  const openVolume = useCallback((code: string) => go({ v: 'volume', code }), [go]);
  const openChapter = useCallback((code: string, seq: number) => go({ v: 'chapter', code, seq }), [go]);
  const openSpace = useCallback((key: SpaceKey) => go({ v: 'space', key }), [go]);
  const goHref = (e: React.MouseEvent<HTMLAnchorElement>, r: Route, mode: 'push' | 'replace' = 'push') => {
    if (isModifiedClick(e)) return;
    e.preventDefault();
    go(r, mode);
  };
  const openRiver = useCallback((year?: number, eventId?: number) => {
    setRiverFocus(year != null ? { year, eventId } : null);
    const prev = routeRef.current.v === 'space' && routeRef.current.key === 'river' ? routeRef.current.river : undefined;
    const river: RiverQuery | undefined = year != null ? { ...prev, y: year } : prev;
    go({ v: 'space', key: 'river', river });
  }, [go]);
  /* v8 · 3.3 五向互链：检查器的「域 / 学段」两个跳转目标需要先设焦点再切空间 */
  const [themesFocus, setThemesFocus] = useState<string | null>(null);
  const openDomain = useCallback((name: string) => {
    setThemesFocus(name);
    go({ v: 'space', key: 'themes' });
  }, [go]);
  const openStage = useCallback((stage: string) => {
    const y = stageAnchorYear(stage);
    if (y != null) openRiver(y);
  }, [openRiver]);

  const clearG = () => {
    gPendingRef.current = false;
    setGPending(false);
    window.clearTimeout(gTimer.current);
  };

  /* ⌘K / Ctrl+K / / 检索；? 快捷键面板；g 然后字母跳转 */
  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setCkOpen(v => !v);
        setHelpOpen(false);
        clearG();
        return;
      }
      if (ckOpen) return;
      if (typing(e)) return;
      if (e.key === 'Escape') {
        if (moreOpen) { e.preventDefault(); closeMore(); }
        else if (helpOpen) { e.preventDefault(); setHelpOpen(false); }
        else if (tocOpen) { e.preventDefault(); closeToc(); }
        clearG();
        return;
      }
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        setHelpOpen(v => !v);
        clearG();
        return;
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        setHelpOpen(false);
        clearG();
        setCkOpen(true);
        return;
      }
      if (helpOpen) return;
      if (gPendingRef.current) {
        e.preventDefault();
        const chord = G_THEN[e.key.toLowerCase()];
        clearG();
        if (!chord) return;
        if (chord.t === 'foreshadow') go({ v: 'foreshadow' });
        else go({ v: 'space', key: chord.key });
        return;
      }
      if (e.key === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        gPendingRef.current = true;
        setGPending(true);
        window.clearTimeout(gTimer.current);
        gTimer.current = window.setTimeout(clearG, 1200);
        return;
      }
      if ((e.key === '[' || e.key === ']') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (routeRef.current.v === 'chapter') return;
        const cur = routeRef.current.v === 'doc' ? routeRef.current.path : '';
        const neigh = getDocNeighbors().filter(isPublicPath);
        const recents = getRecentDocs().map(d => d.path).filter(isPublicPath);
        const base = (neigh.length ? neigh : recents).filter(p => p !== cur);
        const paths = cur && isPublicPath(cur) ? [cur, ...base] : base;
        if (paths.length < 2) return;
        e.preventDefault();
        const i = Math.max(0, paths.indexOf(cur));
        const next = paths[(i + (e.key === ']' ? 1 : paths.length - 1)) % paths.length];
        go({ v: 'doc', path: next });
        return;
      }
      if (e.key === 'F' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setFocusRead(v => !v);
        return;
      }
      if (e.key === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && routeRef.current.v === 'doc') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('mneme:find'));
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F') && routeRef.current.v === 'doc') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('mneme:find'));
        return;
      }
      if ((e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        copyPermalink();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(gTimer.current);
    };
  }, [ckOpen, helpOpen, moreOpen, tocOpen, go]);

  const spaceKey: SpaceKey = route.v === 'space' ? route.key : route.v === 'doc' ? 'archive' : route.v === 'person' ? 'graph' : route.v === 'imagery' ? 'museum' : 'study';
  useEffect(() => {
    document.documentElement.dataset.space = spaceKey;
    const nav = document.querySelector('.topbar') as HTMLElement | null;
    const host = readScroller() || document.querySelector('.space-host') as HTMLElement | null;
    if (nav && host) {
      if (document.documentElement.dataset.imm === 'smooth') nav.style.setProperty('--nav-sc', '1');
      else nav.style.setProperty('--nav-sc', Math.max(0, Math.min(1, host.scrollTop / 140)).toFixed(3));
    }
  }, [spaceKey]);
  const bookCode = bookFromVolume(
    route.v === 'volume' || route.v === 'chapter' ? route.code : undefined,
  );
  const overlayOpen = tocOpen || ckOpen || helpOpen || moreOpen || annoOpen || secretOpen
    || route.v === 'chapter' || route.v === 'foreshadow';
  useEffect(() => {
    const desk = document.querySelector('.desk');
    if (!(desk instanceof HTMLElement)) return;
    if (overlayOpen) desk.setAttribute('inert', '');
    else desk.removeAttribute('inert');
  }, [overlayOpen]);
  const ckHint = document.documentElement.dataset.os === 'mac' || document.documentElement.dataset.os === 'ios'
    ? '⌘K' : 'Ctrl+K';

  return (
    <>
      <a className="skip-link" href="#mneme-main">跳到正文</a>
      <p className="sr-only" aria-live="polite">{liveAnnounce}</p>
      <div className="paper-field" />

      {/* Liquid Glass 位移滤镜（v3.4）：feTurbulence + feDisplacementMap 的真实折射
          —— liquid-glass.css 引用 url('#mneme-glass')，此前滤镜不存在（Chromium 下整条声明被丢弃）。
          仅 .lg-displacement（App 行为探测）生效：Chromium 折射，Safari/Firefox 退回纯模糊。 */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden focusable="false">
        <filter id="mneme-glass" x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.9 0.9" numOctaves="2" seed="7" result="noise" />
          <feGaussianBlur in="noise" stdDeviation="1.6" result="soft" />
          <feDisplacementMap id="mneme-disp" in="SourceGraphic" in2="soft" scale="9" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>

      <BGM visible={gateDone && !annoOpen} />
      {!gateDone && <Gate onDone={enter} />}

      {gateDone && (
        <>
          {annoOpen && <Announce onClose={() => setAnnoOpen(false)} />}
          <div className="desk">
          <aside className="rail chrome" aria-label="空间导航">
            <div className="rail-desk">
            <div className="rail-brand">
              <span className="greek rail-greek">ΜΝΗΜΗ</span>
              <span className="rail-sub">刘佑林的前半生</span>
            </div>
            {NAV_GROUPS.map(g => (
              <div key={g.label} className={`rail-group ${g.spaces.some(s => spaceKey === s.key) ? 'on' : ''}`}>
                <span className="rail-group-label">{g.label}</span>
                <div className="nav-group-row">
                  {g.spaces.map(s => (
                    <a
                      key={s.key}
                      href={routeToPath({ v: 'space', key: s.key })}
                      className={`rail-space ${spaceKey === s.key ? 'on' : ''}`}
                      aria-current={spaceKey === s.key ? 'page' : undefined}
                      onClick={e => goHref(e, { v: 'space', key: s.key })}
                      onPointerEnter={() => prefetchSpace(s.key)}
                      title={s.name}
                    >
                      <span className="rail-space-name">{s.name}</span>
                      <span className="rail-space-sub">{s.sub}</span>
                    </a>
                  ))}
                </div>
              </div>
            ))}
            <div className="rail-foot">
              <button className="rail-link" onClick={() => setTocOpen(true)}>总纲 · 全馆导览</button>
              <a className="rail-link" href={routeToPath({ v: 'foreshadow' })} onClick={e => goHref(e, { v: 'foreshadow' })}>伏应矩阵</a>
            </div>
            </div>
            <nav className="rail-tabs" aria-label="主要分区">
              {MOBILE_TABS.map(tab => {
                const on = route.v !== 'foreshadow' && (tab.match as readonly string[]).includes(spaceKey);
                return (
                  <a
                    key={tab.label}
                    href={routeToPath({ v: 'space', key: tab.go })}
                    className={`rail-tab ${on ? 'on' : ''}`}
                    aria-current={on ? 'page' : undefined}
                    onClick={e => { if (isModifiedClick(e)) return; e.preventDefault(); setMoreOpen(false); if (!on) openSpace(tab.go); }}
                  >
                    <span className="rail-tab-ico"><PhoneTabIcon kind={tab.kind} /></span>
                    <span className="rail-tab-lab">{tab.label}</span>
                  </a>
                );
              })}
              <button
                type="button"
                className={`rail-tab ${moreOpen || route.v === 'foreshadow' || MORE_KEYS.includes(spaceKey) ? 'on' : ''}`}
                onClick={() => { if (moreOpen) closeMore(); else setMoreOpen(true); }}
              >
                <span className="rail-tab-ico"><PhoneTabIcon kind="more" /></span>
                <span className="rail-tab-lab">更多</span>
              </button>
            </nav>
          </aside>
          <header className="topbar chrome">
            <div className="read-bar" aria-hidden="true"><span ref={readBarRef} /></div>
            <SilkRibbon
              book={bookCode}
              onOpenChapter={openChapter}
              onOpenDoc={openDoc}
              onOpenPerson={openPerson}
              onOpenImagery={openImagery}
            />
            <button className="top-search glass chrome" onClick={() => setCkOpen(true)} aria-label="检索全库">
              <span>检索全库</span>
              <kbd>{ckHint}</kbd>
            </button>
            <button className="top-keys" onClick={() => setHelpOpen(true)} aria-label="键盘快捷键" title="快捷键">
              <kbd>?</kbd>
            </button>
            <button
              type="button"
              className="top-copy"
              aria-label="分享或复制本页深链"
              title="分享或复制本页深链"
              onClick={() => shareOrCopyPermalink()}
            >
              链
            </button>
            <div className="topbar-actions">
            <button
              type="button"
              className={`top-vault ${vaultOpen ? 'on' : ''}`}
              aria-label={vaultOpen ? '绝密档案已开锁' : '打开绝密档案'}
              title={vaultOpen ? '绝密档案已开锁' : '绝密档案 · 管理员密码'}
              onClick={() => { if (!vaultOpen) window.dispatchEvent(new CustomEvent('mneme:locked')); }}
            >
              {vaultOpen ? '已开锁' : '绝密'}
            </button>
            <button
              className="nav-logout"
              aria-label="退出本次访问"
              title="退出本次访问"
              onClick={() => {
                navigator.serviceWorker?.controller?.postMessage({ type: 'mneme-purge-docs' });
                purgePublicDrafts();
                window.location.href = '/api/logout';
              }}
            >
              离场
            </button>
            <button
              className="nav-theme"
              aria-label={theme === 'night' ? '切换到纸色主题' : '切换到墨夜主题'}
              title={theme === 'night' ? '回到纸色' : '入墨夜'}
              onClick={() => {
                try { localStorage.setItem('mneme-theme-manual', '1'); } catch { /* 隐私模式 */ }
                setTheme(t => (t === 'night' ? 'paper' : 'night'));
              }}
            >
              {theme === 'night' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <circle cx="12" cy="12" r="4.4" />
                  <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M18.7 5.3L17 7M7 17l-1.7 1.7" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.2 14.5A8.3 8.3 0 0 1 9.5 3.8a8.3 8.3 0 1 0 10.7 10.7Z" />
                </svg>
              )}
            </button>
            </div>
          </header>

          <main ref={mainRef} id="mneme-main" className="space-host" tabIndex={-1}>
            {/* 空间级错误边界：任一空间组件抛异常只坏这一块，导航与其余空间仍可用（原先整页白屏） */}
            <ErrorBoundary resetKey={routeId(route)} label={TOC[spaceKey]?.name}>
            {bookCode === 'AX' && <p className="ax-banner" role="note">非事实</p>}
            {spaceKey === 'stars' && (
              <Stars
                overview={ov}
                theme={theme}
                book={bookCode}
                onEnterRiver={() => openSpace('river')}
                onOpenChapter={openChapter}
                onOpenDoc={openDoc}
                onEnterLighthouse={() => openSpace('lighthouse')}
                onOpenPerson={openPerson}
                onOpenVolume={openVolume}
              />
            )}
            {spaceKey === 'river' && (
              <Lazy>
                <River
                  onOpenDoc={openDoc}
                  focus={riverFocus}
                  onFocusDone={() => setRiverFocus(null)}
                  query={route.v === 'space' && route.key === 'river' ? route.river : undefined}
                  onQuery={river => go({ v: 'space', key: 'river', river }, 'replace')}
                />
              </Lazy>
            )}
            {spaceKey === 'graph' && (
              <Lazy>
                <Graph
                  theme={theme}
                  focusPersonId={route.v === 'person' ? route.id : null}
                  onOpenDoc={openDoc}
                  onOpenPerson={openPerson}
                  onClearFocus={() => { if (route.v === 'person') go({ v: 'space', key: 'graph' }); }}
                />
              </Lazy>
            )}
            {spaceKey === 'archive' && (
              <Lazy>
                <Archive
                  path={route.v === 'doc' ? route.path : '00-知识库首页'}
                  anchor={route.v === 'doc' ? route.h : undefined}
                  evidenceId={route.v === 'doc' ? route.ev : undefined}
                  query={route.v === 'doc' ? route.q : undefined}
                  onNavigate={openDoc} onOpenPerson={openPerson}
                  onOpenVolume={openVolume} onOpenDomain={openDomain} onOpenStage={openStage}
                  onOpenImagery={openImagery} onOpenEvent={openRiver}
                />
              </Lazy>
            )}
            {spaceKey === 'study' && (
              <Lazy>
                <Study
                  onOpenDoc={openDoc} onOpenPerson={openPerson} onOpenImagery={openImagery}
                  onOpenChapter={openChapter}
                  focusVolume={route.v === 'volume' || route.v === 'chapter' ? route.code : null}
                />
              </Lazy>
            )}
            {spaceKey === 'museum' && (
              <Lazy>
                <Museum focusId={route.v === 'imagery' ? route.id : null} onClearFocus={() => { if (route.v === 'imagery') go({ v: 'space', key: 'museum' }); }} onOpenDoc={openDoc} />
              </Lazy>
            )}
            {spaceKey === 'voices' && <Lazy><Voices onOpenDoc={openDoc} overview={ov} /></Lazy>}
            {spaceKey === 'themes' && (
              <Lazy>
                <Themes
                  onOpenDoc={openDoc} onOpenPerson={openPerson}
                  focusDomain={themesFocus}
                  onFocusDone={() => setThemesFocus(null)}
                />
              </Lazy>
            )}
            {spaceKey === 'lighthouse' && (
                <Lazy>
                  <Lighthouse
                    overview={ov}
                    onOpenDoc={openDoc}
                    tab={route.v === 'space' && route.key === 'lighthouse' ? (route.lh ?? 'all') : 'all'}
                    onTab={lh => go({ v: 'space', key: 'lighthouse', lh: lh === 'all' ? undefined : lh }, 'replace')}
                  />
                </Lazy>
              )}
            </ErrorBoundary>
          </main>
          </div>

          <button className="toc-hint glass chrome" onClick={() => setTocOpen(true)}>
            <span className="greek">ΓΡΑΜΜΗ</span> 总纲
          </button>
          <button className="ck-hint glass chrome" onClick={() => setCkOpen(true)}>
            <span className="greek">⌘K</span> 检索全库
          </button>

          {/* 章节材料链面板（路由驱动：/chapter/B3/26；关闭回书房，浏览器返回同效） */}
          {route.v === 'chapter' && (
            <Lazy>
              <ChapterPanel
                code={route.code} seq={route.seq}
                onClose={() => go({ v: 'space', key: 'study' })}
                onOpenDoc={openDoc} onOpenImagery={openImagery}
                onOpenChapter={openChapter}
              />
            </Lazy>
          )}

          <CommandK
            open={ckOpen} onClose={() => setCkOpen(false)}
            onOpenDoc={openDoc} onOpenPerson={openPerson} onOpenRiver={openRiver}
            onOpenImagery={openImagery} onOpenVolume={openVolume} onOpenChapter={openChapter}
            onGoSpace={openSpace} onToggleTheme={toggleTheme}
          />
          <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
          {gPending && <div className="g-pending surface" role="status">g …</div>}
          {moreOpen && (
            <div className="more-mask" onMouseDown={() => closeMore()} role="presentation">
              <div ref={moreRef} className="more-sheet glass chrome" onMouseDown={e => e.stopPropagation()} role="dialog" aria-labelledby="more-title" aria-modal="true">
                <i className="more-grab" aria-hidden />
                <p className="more-kicker">去往</p>
                <h1 id="more-title">全馆</h1>
                <div className="more-list">
                  {NAV_GROUPS.map(g => g.spaces.map(s => (
                    <a
                      key={s.key}
                      href={routeToPath({ v: 'space', key: s.key })}
                      className={`more-item ${spaceKey === s.key ? 'on' : ''}`}
                      onClick={e => { if (isModifiedClick(e)) return; e.preventDefault(); setMoreOpen(false); openSpace(s.key); }}
                    >
                      <b>{s.name}</b><span>{g.label}</span>
                    </a>
                  )))}
                  <a href={routeToPath({ v: 'foreshadow' })} className="more-item" onClick={e => { if (isModifiedClick(e)) return; e.preventDefault(); setMoreOpen(false); go({ v: 'foreshadow' }); }}>
                    <b>伏应矩阵</b><span>书稿</span>
                  </a>
                  <button type="button" className="more-item" onClick={() => { setMoreOpen(false); setTocOpen(true); }}>
                    <b>总纲</b><span>导览</span>
                  </button>
                </div>
                <p className="more-sec">本机</p>
                <div className="more-list">
                  <button type="button" className="more-item" onClick={() => { setMoreOpen(false); window.dispatchEvent(new CustomEvent('mneme:prefs')); }}>
                    <b>偏好</b><span>动效 · 足迹 · 主题跟随系统</span>
                  </button>
                  <button type="button" className="more-item" onClick={() => { setMoreOpen(false); setFocusRead(v => !v); }}>
                    <b>{focusRead ? '退出专注' : '专注阅读'}</b><span>藏左栏与丰碑 · Shift+F</span>
                  </button>
                  <button type="button" className="more-item" onClick={() => bgmSet({ on: !bgmOn })}>
                    <b>{bgmOn ? '暂停背景音乐' : '播放背景音乐'}</b><span>音量在偏好里调</span>
                  </button>
                  <button type="button" className="more-item" onClick={() => { shareOrCopyPermalink(); setMoreOpen(false); }}>
                    <b>分享本页</b><span>手机走系统分享，桌面复制深链</span>
                  </button>
                  <button type="button" className="more-item" onClick={() => { setMoreOpen(false); if (!vaultOpen) window.dispatchEvent(new CustomEvent('mneme:locked')); }}>
                    <b>{vaultOpen ? '绝密已开锁' : '打开绝密档案'}</b><span>管理口令</span>
                  </button>
                  <button type="button" className="more-item" onClick={() => {
                    navigator.serviceWorker?.controller?.postMessage({ type: 'mneme-purge-docs' });
                    purgePublicDrafts();
                    window.location.href = '/api/logout';
                  }}>
                    <b>离场</b><span>结束这次访问</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {route.v === 'foreshadow' && (
            <Lazy>
              <Foreshadow onClose={() => go({ v: 'space', key: 'study' })} />
            </Lazy>
          )}

          <SecretGate />
          <Wellness onGoSpace={k => openSpace(k as SpaceKey)} />

          {tocOpen && (
            <div className="toc-mask" onMouseDown={() => closeToc()}>
              <div ref={tocRef} className="toc glass chrome" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="toc-title">
                <header className="toc-head">
                  <p className="greek toc-kicker">ΠΕΡΙΗΓΗΣΙΣ · 总纲</p>
                  <h1 id="toc-title">全馆导览</h1>
                  <button className="gp-sheet-x" onClick={() => closeToc()} aria-label="关闭">×</button>
                </header>
                <div className="toc-list">
                  {NAV_GROUPS.map(g => (
                    <section key={g.label} className="toc-group">
                      <h2>{g.label}</h2>
                      {g.spaces.map(s => (
                        <a key={s.key} href={routeToPath({ v: 'space', key: s.key })} className="toc-item" onClick={e => { if (isModifiedClick(e)) return; e.preventDefault(); setTocOpen(false); openSpace(s.key); }}>
                          <span className="greek toc-g">{TOC[s.key].greek}</span>
                          <b>{TOC[s.key].name}</b>
                          <span className="toc-line">{TOC[s.key].line}</span>
                        </a>
                      ))}
                    </section>
                  ))}
                </div>
                <button className="toc-item fo-entry" onClick={() => { setTocOpen(false); go({ v: 'foreshadow' }); }}>
                  <span className="greek toc-g">ΠΡΟ</span>
                  <b>伏应矩阵</b>
                  <span className="toc-line">{foCount == null ? '伏笔—回收跨卷配对图（创作台账）' : `${foCount} 条伏笔—回收跨卷配对图（创作台账）`}</span>
                </button>
                <footer className="toc-foot">⌘K 检索 · g 然后字母跳转 · ? 查看键位</footer>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
