import { useEffect, useMemo, useRef, useState } from 'react';
import { type DocFull } from '../api';
import { getHighlights, getRecentDocs, isPublicPath, setDocNeighbors } from '../history';
import { evidenceLabel } from '../evidenceKind';
import { stageAnchorYear } from '../stages';
import { focusEvidence, highlightQuery, cycleQueryMarks, queryMarkPos } from '../highlightSnippet';
import { ensureCjkSerif } from '../fontsCjk';
import { prefetchDoc } from '../prefetch';
import { notify } from '../toast';
import { liveTitle } from '../liveTitle';
import { askUnlock } from '../unlock';
import { bindSyncScroll } from '../syncScroll';
import { emitLayout, readScroller } from '../readHost';
import { useFocusTrap } from '../focusTrap';
import { bookFromVolume, recordImagery, recordPerson } from '../silk';
import { DocPane, type DocHeading } from './archive/DocPane';
import { READER_KEY, READER_MW, ReaderSettings, loadReader, remainLabel, type ReaderCfg } from './archive/reader';
import { SecPicker } from './archive/SecPicker';
import { FindBar } from './archive/FindBar';
import { HighlightList, HighlightPop } from './archive/HighlightMarks';

/**
 * Σ7 原文档案馆 · 阅读工作区
 * 外壳：目录 / 对照。查找、划线、渲染、对照各自成模块。网站只记录，不写回知识库。
 */
const VOL_DESIGN: Record<string, string> = {
  P0: '百万长文写作/章稿/00-读法.md',
  B1: '百万长文写作/章稿/第一部-空格.md',
  B2: '百万长文写作/章稿/第二部-亲爱的.md',
  B3: '百万长文写作/章稿/第三部-桌上.md',
  B4: '百万长文写作/章稿/第四部-西侧.md',
  B5: '百万长文写作/章稿/第五部-十七天.md',
  B6: '百万长文写作/章稿/第六部-保存.md',
  AX: '百万长文写作/章稿/附录-若当时.md',
};
const VOL_NAME: Record<string, string> = {
  P0: '序', B1: '空格', B2: '亲爱的', B3: '桌上', B4: '西侧', B5: '十七天', B6: '保存', AX: '附录',
};


export function Archive({ path, anchor, evidenceId, query, onNavigate, onOpenPerson, onOpenVolume, onOpenDomain, onOpenStage, onOpenImagery, onOpenEvent }: {
  path: string;
  anchor?: string;
  evidenceId?: number;
  query?: string;
  onNavigate: (path: string) => void;
  onOpenPerson: (id: number) => void;
  /* v8 · 3.3 五向互链补全（检查器新增「所属 / 同时间事件 / 相关意象」三向） */
  onOpenVolume?: (code: string) => void;
  onOpenDomain?: (name: string) => void;
  onOpenStage?: (stage: string) => void;
  onOpenImagery?: (id: number) => void;
  onOpenEvent?: (year: number, eventId: number) => void;
}) {
  const [reader, setReader] = useState<ReaderCfg>(loadReader);
  const [rsOpen, setRsOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(() => {
    try {
      const o = JSON.parse(localStorage.getItem('mneme-ar-panels') || '{}') as { toc?: boolean };
      if (typeof o.toc === 'boolean') return o.toc;
    } catch { /* 首访 */ }
    return document.documentElement.dataset.shell === 'desktop' && window.innerWidth >= 1240;
  });
  const [inspOpen, setInspOpen] = useState(() => {
    try {
      const o = JSON.parse(localStorage.getItem('mneme-ar-panels') || '{}') as { insp?: boolean };
      if (typeof o.insp === 'boolean') return o.insp;
    } catch { /* 首访 */ }
    return document.documentElement.dataset.shell === 'desktop' && window.innerWidth >= 1240;
  });
  const [findOpen, setFindOpen] = useState(false);
  const [findQ, setFindQ] = useState('');
  const [findN, setFindN] = useState(0);
  const [findI, setFindI] = useState(0);
  const findRef = useRef<HTMLInputElement>(null);
  const [dual, setDual] = useState(() => {
    try { return !!(JSON.parse(localStorage.getItem('mneme-ar-dual') || '{}') as { on?: boolean }).on; }
    catch { return false; }
  });
  const [secPath, setSecPath] = useState<string | null>(() => {
    try {
      const p = (JSON.parse(localStorage.getItem('mneme-ar-dual') || '{}') as { sec?: string }).sec;
      return typeof p === 'string' && isPublicPath(p) ? p : null;
    } catch { return null; }
  });
  const [remain, setRemain] = useState('');
  const [pop, setPop] = useState<{ x: number; y: number; text: string; heading: string } | null>(null);
  const [shot, setShot] = useState<{ src: string; alt: string; list: { src: string; alt: string }[] } | null>(null);
  const shotRef = useRef<HTMLDivElement>(null);
  const [hlTick, setHlTick] = useState(0);
  const [docTick, setDocTick] = useState(0);
  const mainPane = useRef<HTMLDivElement>(null);
  const secPane = useRef<HTMLDivElement>(null);

  const [headings, setHeadings] = useState<DocHeading[]>([]);
  const [activeH, setActiveH] = useState('');
  const [meta, setMeta] = useState<DocFull | null>(null);
  const [evFocus, setEvFocus] = useState<number | undefined>(evidenceId);
  const [evLoci, setEvLoci] = useState<Record<number, { heading: string; para: string }>>({});
  useEffect(() => { ensureCjkSerif(); }, []);
  useEffect(() => {
    const code = bookFromVolume(meta?.volume ?? null);
    if (code) document.documentElement.dataset.book = code;
  }, [meta?.volume]);
  useEffect(() => {
    try { localStorage.setItem('mneme-ar-panels', JSON.stringify({ toc: tocOpen, insp: inspOpen })); } catch { /* 隐私模式 */ }
  }, [tocOpen, inspOpen]);
  useEffect(() => {
    try { localStorage.setItem('mneme-ar-dual', JSON.stringify({ on: dual, sec: secPath })); } catch { /* 隐私模式 */ }
  }, [dual, secPath]);
  useEffect(() => {
    const host = readScroller();
    if (!host || !meta?.body) { setRemain(''); return; }
    const body = meta.body;
    let last = -1;
    const upd = () => {
      const max = host.scrollHeight - host.clientHeight;
      const p = max <= 0 ? 1 : Math.min(1, host.scrollTop / max);
      const bucket = Math.round(p * 20);
      if (bucket === last) return;
      last = bucket;
      setRemain(remainLabel(body, p));
    };
    upd();
    host.addEventListener('scroll', upd, { passive: true });
    return () => host.removeEventListener('scroll', upd);
  }, [meta?.body, path, dual]);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ src?: string; alt?: string; list?: { src: string; alt: string }[] }>).detail;
      if (!d?.src) return;
      const list = (d.list || []).filter(x => x.src);
      setShot({ src: d.src, alt: d.alt || '', list: list.length ? list : [{ src: d.src, alt: d.alt || '' }] });
    };
    window.addEventListener('mneme:img', on);
    return () => window.removeEventListener('mneme:img', on);
  }, []);
  const stepShot = (dir: 1 | -1) => {
    setShot(cur => {
      if (!cur || cur.list.length < 2) return cur;
      const i = Math.max(0, cur.list.findIndex(x => x.src === cur.src));
      const next = cur.list[(i + dir + cur.list.length) % cur.list.length];
      return { ...cur, src: next.src, alt: next.alt };
    });
  };
  const swipeRef = useRef({ x: 0, y: 0 });
  useEffect(() => {
    if (!shot || shot.list.length < 2) return;
    const i = Math.max(0, shot.list.findIndex(x => x.src === shot.src));
    [shot.list[(i + 1) % shot.list.length], shot.list[(i - 1 + shot.list.length) % shot.list.length]]
      .forEach(x => { const im = new Image(); im.src = x.src; });
  }, [shot]);
  useEffect(() => {
    if (meta?.title) liveTitle(meta.title);
    return () => liveTitle(null);
  }, [meta?.title]);
  useFocusTrap(shotRef, !!shot, () => setShot(null));
  useEffect(() => { emitLayout(); }, [dual, path]);
  useEffect(() => {
    const headingNear = (node: Node | null) => {
      let el = node instanceof Element ? node : node?.parentElement ?? null;
      while (el) {
        if (/^H[1-6]$/.test(el.tagName) && el.id) return el.id;
        const prev = el.previousElementSibling;
        if (prev && /^H[1-6]$/.test(prev.tagName) && prev.id) return prev.id;
        el = el.parentElement;
      }
      return '';
    };
    const onUp = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('.ar-pop')) return;
      const sel = window.getSelection();
      const text = sel?.toString().replace(/\s+/g, ' ').trim() ?? '';
      const root = document.querySelector('.ar-pane:not(.sec) .ar-body');
      if (text.length < 2 || text.length > 280 || !sel || !root || !sel.anchorNode || !root.contains(sel.anchorNode)) {
        setPop(null);
        return;
      }
      const r = sel.getRangeAt(0).getBoundingClientRect();
      setPop({ x: r.left + r.width / 2, y: Math.max(12, r.top - 10), text, heading: headingNear(sel.anchorNode) });
    };
    document.addEventListener('mouseup', onUp);
    return () => document.removeEventListener('mouseup', onUp);
  }, [path]);
  useEffect(() => {
    const on = () => {
      setFindOpen(true);
      window.setTimeout(() => findRef.current?.focus(), 30);
    };
    window.addEventListener('mneme:find', on);
    return () => window.removeEventListener('mneme:find', on);
  }, []);
  useEffect(() => {
    if (!dual || !reader.sync || !mainPane.current || !secPane.current) return;
    return bindSyncScroll(mainPane.current, secPane.current);
  }, [dual, reader.sync, secPath, path]);
  useEffect(() => {
    const root = document.querySelector('.ar-pane:not(.sec) .ar-body') as HTMLElement | null;
    if (!root || !findOpen) return;
    const needle = findQ.trim();
    if (!needle) { setFindN(0); setFindI(0); return; }
    const first = highlightQuery(root, needle);
    const pos = queryMarkPos(root);
    setFindN(pos.n);
    setFindI(pos.i);
    first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [findQ, findOpen, path]);
  const jumpFind = (dir: 1 | -1) => {
    const root = document.querySelector('.ar-pane:not(.sec) .ar-body') as HTMLElement | null;
    if (!root) return;
    cycleQueryMarks(root, dir)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const pos = queryMarkPos(root);
    setFindN(pos.n);
    setFindI(pos.i);
  };
  /* v4 · A4 深化：默认对照当前文档所属卷的章节设计（卷大纲） */
  const volDesign = useMemo(() => {
    const v = meta?.volume ?? null;
    const k = v && VOL_DESIGN[v] ? v : null;
    return k ? { path: VOL_DESIGN[k], label: `${VOL_NAME[k]} · 章稿` } : null;
  }, [meta]);
  const localMarks = useMemo(() => getHighlights(path), [path, hlTick]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (shot && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        stepShot(e.key === 'ArrowRight' ? 1 : -1);
        return;
      }
      if (e.key === 'Escape') {
        if (shot) { setShot(null); e.preventDefault(); return; }
        if (pop) { setPop(null); e.preventDefault(); return; }
        if (findOpen) { setFindOpen(false); setFindQ(''); e.preventDefault(); return; }
        if (window.innerWidth <= 1240) {
          if (inspOpen) { setInspOpen(false); e.preventDefault(); }
          else if (tocOpen) { setTocOpen(false); e.preventDefault(); }
        }
        return;
      }
      if (e.key === 't') { e.preventDefault(); setTocOpen(v => !v); return; }
      if (e.key === 'i') { e.preventDefault(); setInspOpen(v => !v); return; }
      if (e.key === 'd') {
        e.preventDefault();
        setDual(v => {
          const next = !v;
          if (next) setSecPath(p => p ?? volDesign?.path ?? null);
          return next;
        });
        return;
      }
      if (e.key === 'a') { e.preventDefault(); setRsOpen(v => !v); return; }
      if (e.key !== 'n' && e.key !== 'N') return;
      const root = document.querySelector('.ar-pane:not(.sec) .ar-body') as HTMLElement | null;
      if (!root || !root.querySelector('mark.q-hl')) return;
      e.preventDefault();
      jumpFind(e.key === 'N' || e.shiftKey ? -1 : 1);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [findOpen, inspOpen, tocOpen, volDesign, shot, pop]);
  useEffect(() => {
    const docs = getRecentDocs().filter(d => isPublicPath(d.path));
    const i = docs.findIndex(d => d.path === path);
    const next = i >= 0 ? docs[(i + 1) % docs.length] : docs[0];
    if (next && next.path !== path) prefetchDoc(next.path);
  }, [path]);
  const headRef = useRef<DocHeading[]>([]);
  const rsRef = useRef<HTMLDivElement>(null);
  const mainPaneKey = useRef(path);

  useEffect(() => { localStorage.setItem(READER_KEY, JSON.stringify(reader)); }, [reader]);

  /* 主文档切换：清目录/检查器（次栏保留——对照对象不因主栏跳转而丢） */
  useEffect(() => {
    if (mainPaneKey.current !== path) {
      mainPaneKey.current = path;
      setHeadings([]); setActiveH(''); setMeta(null); setEvFocus(undefined); setEvLoci({});
      headRef.current = [];
    }
  }, [path]);

  useEffect(() => { setEvFocus(evidenceId); }, [evidenceId]);

  const onHeadings = (hs: DocHeading[]) => {
    const sig = hs.map(h => h.id).join('|');
    if (headRef.current.map(h => h.id).join('|') === sig) { headRef.current = hs; return; }
    headRef.current = hs;
    setHeadings(hs);
    setActiveH(hs[0]?.id ?? '');
  };

  /* TOC 滚动侦听：取视口内最靠上的标题（nav 之下 140px 线） */
  useEffect(() => {
    const host = readScroller();
    if (!host || headings.length === 0) return;
    let raf = 0;
    const spy = () => {
      raf = 0;
      let cur = '';
      for (const h of headRef.current) {
        if (h.el.getBoundingClientRect().top <= 140) cur = h.id; else break;
      }
      if (cur) setActiveH(cur);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(spy); };
    spy();
    host.addEventListener('scroll', onScroll, { passive: true });
    return () => { host.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, [headings, dual]);

  /* 点击外部关闭设置面板 */
  useEffect(() => {
    if (!rsOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!rsRef.current?.contains(e.target as Node)) setRsOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [rsOpen]);

  const goHeading = (id: string) => {
    headRef.current.find(h => h.id === id)?.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const wrapStyle = {
    ['--r-fs' as string]: `${reader.fs}px`,
    ['--r-mw' as string]: READER_MW[reader.mw],
    ['--r-ff' as string]: reader.ff === 'sans' ? 'var(--sans)' : 'var(--serif)',
  } as React.CSSProperties;

  return (
    <div className={`ar${dual ? ' is-split' : ''}`} style={wrapStyle} data-active-h={activeH} data-doc-title={meta?.title || ''}>
      <header className="ar-head">
        <div className="ar-head-main">
          <p className="ar-crumb">
            {meta ? (
              <>
                <button type="button" className="ar-crumb-a" onClick={() => onOpenDomain?.(meta.domain)}>{meta.domain}</button>
                {meta.stage ? <> · <button type="button" className="ar-crumb-a" onClick={() => onOpenStage?.(meta.stage)}>{meta.stage}</button></> : null}
                <span className="ar-read-cost"> · {remain || remainLabel(meta.body, 0)}</span>
              </>
            ) : '\u00A0'}
          </p>
          {meta?.volume ? (
            <p className="ar-print-vol">{VOL_NAME[meta.volume] || meta.volume} · {meta.volume}</p>
          ) : null}
          <h1>{meta ? meta.title : path.replace(/\.md$/, '').split('/').pop()}</h1>
        </div>
        <div className="ar-toolbar" ref={rsRef}>
          <button className={`ar-tool ${tocOpen ? 'on' : ''}`} onClick={() => setTocOpen(v => !v)} title="目录 · t">目录</button>
          <button className={`ar-tool ${dual ? 'on' : ''}`} onClick={() => { setDual(v => !v); if (!dual) setSecPath(p => p ?? volDesign?.path ?? null); }} title="双栏对照阅读 · d">对照</button>
          <button className={`ar-tool ${inspOpen ? 'on' : ''}`} onClick={() => setInspOpen(v => !v)} title="来源检查器 · i">检查器</button>
          <FindBar
            open={findOpen}
            q={findQ}
            n={findN}
            i={findI}
            inputRef={findRef}
            onToggle={() => { setFindOpen(v => !v); if (!findOpen) window.setTimeout(() => findRef.current?.focus(), 30); }}
            onChange={setFindQ}
            onJump={jumpFind}
            onClose={() => { setFindOpen(false); setFindQ(''); }}
          />
          <span className="ar-tool-sep" />
          <button type="button" className="ar-tool" onClick={() => window.dispatchEvent(new CustomEvent('mneme:focus'))} title="专注态 · Shift+F">专注</button>
          <button className={`ar-tool ${rsOpen ? 'on' : ''}`} onClick={() => setRsOpen(v => !v)} title="阅读器设置 · a">Aa</button>
          {rsOpen && <ReaderSettings cfg={reader} onChange={setReader} />}
        </div>
      </header>

      <div className={`ar-workspace ${tocOpen ? 'toc' : ''} ${inspOpen ? 'insp' : ''}`}>
        {(tocOpen || inspOpen) && (
          <div className="ar-sheet-mask" onMouseDown={() => { setTocOpen(false); setInspOpen(false); }} />
        )}
        {tocOpen && (
          <aside className="ar-toc" aria-label="文档目录">
            <p className="ar-toc-title">目录 · {headings.length}</p>
            <nav className="ar-toc-list">
              {headings.map(h => (
                <button key={h.id} className={`lvl-${h.level} ${activeH === h.id ? 'on' : ''}`} onClick={() => goHeading(h.id)} title={h.text}>
                  {h.text || h.id}
                </button>
              ))}
              {headings.length === 0 && <p className="ar-toc-empty">本篇暂无小节标题。</p>}
            </nav>
          </aside>
        )}

        <div className={`ar-panes ${dual ? 'dual' : ''}`}>
          <div className="ar-pane" ref={mainPane}>
            <DocPane
              key={`${path}-${docTick}`}
              path={path} anchor={anchor} evidenceId={evidenceId} query={query} track
              onNavigate={onNavigate} onOpenPerson={onOpenPerson}
              onHeadings={onHeadings} onDocMeta={d => {
                setMeta(d);
                setDocNeighbors((d.backlinks || []).filter(b => !b.locked).map(b => b.path));
              }}
              onEvidenceFocus={setEvFocus} onEvidenceLoci={setEvLoci}
            />
          </div>
          {dual && (
            <div className="ar-pane sec" ref={secPane}>
              {secPath ? (
                <>
                  <div className="ar-sec-bar glass">
                    <button className="ar-sec-back" onClick={() => setSecPath(null)}>更换文档</button>
                    <span className="ar-sec-path">{secPath.replace(/\.md$/, '').split('/').pop()}</span>
                    <button className="ar-sec-x" onClick={() => { setSecPath(null); }} aria-label="关闭对照栏">×</button>
                  </div>
                  <DocPane path={secPath} compact onNavigate={onNavigate} onOpenPerson={onOpenPerson} />
                </>
              ) : (
                <SecPicker onPick={setSecPath} suggested={volDesign} />
              )}
            </div>
          )}
        </div>

        {inspOpen && (
          <aside className="ar-inspector" aria-label="来源检查器">
            {meta && meta.persons.length > 0 && (
              <section className="ar-card surface">
                <h2>人物提及</h2>
                {meta.persons.map(p => (
                  <button key={p.id} className="ar-link" onClick={() => {
                    if (p.locked) { askUnlock(); return; }
                    recordPerson({ id: p.id, name: p.display_name });
                    onOpenPerson(p.id);
                  }}>
                    {p.display_name}{p.locked ? ' · 锁' : ''}<em>{p.mention_count}</em>
                  </button>
                ))}
              </section>
            )}
            {meta && meta.backlinks.length > 0 && (
              <section className="ar-card surface">
                <h2>被谁引用</h2>
                {meta.backlinks.map(b => (
                  <button key={b.path} className="ar-link" onClick={() => b.locked ? askUnlock() : onNavigate(b.path)}>{b.title}{b.locked ? ' · 锁' : ''}</button>
                ))}
              </section>
            )}
            {meta && meta.evSnippets.length > 0 && (
              <section className="ar-card surface">
                <h2>证据片段</h2>
                <p className="ar-ev-note">落在段落上，条数不是可信度。</p>
                <ul className="ar-ev">
                  {meta.evSnippets.map((s, i) => {
                    const loc = evLoci[s.id];
                    return (
                    <li key={s.id ?? i} title={evidenceLabel(s.kind).desc}>
                      <div className="ar-ev-row">
                      <button type="button" data-ev-id={s.id} className={`ar-ev-jump ${evFocus === s.id ? 'on' : ''}`} onClick={() => {
                        setEvFocus(s.id);
                        const root = document.querySelector('.ar-pane:not(.sec) .ar-body') as HTMLElement | null;
                        if (!root) return;
                        const el = focusEvidence(root, { id: s.id, snippet: s.snippet });
                        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }}>
                        {loc?.heading ? <small className="ar-ev-h">{loc.heading}</small> : null}
                        <i>{evidenceLabel(s.kind).name}</i>{s.snippet.slice(0, 120)}{s.snippet.length > 120 ? '…' : ''}
                      </button>
                      <button
                        type="button"
                        className="ar-ev-copy"
                        title="复制此条证据深链"
                        aria-label="复制此条证据深链"
                        onClick={() => {
                          const url = `${location.origin}/doc/${encodeURIComponent(path)}?ev=${s.id}`;
                          const ok = () => notify('已复制证据深链', 'info');
                          if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(ok).catch(() => notify('复制失败', 'warn'));
                          else notify('复制失败', 'warn');
                        }}
                      >链</button>
                      </div>
                    </li>
                    );
                  })}
                </ul>
              </section>
            )}
            {meta && (meta.volume || meta.domain || meta.stage) && (
              <section className="ar-card surface">
                <h2>所属</h2>
                <div className="ar-chips">
                  {meta.volume && onOpenVolume && (
                    <button className="ar-chip" onClick={() => onOpenVolume(meta.volume as string)} title="在书房打开">部 {meta.volume}</button>
                  )}
                  {meta.domain && onOpenDomain && (
                    <button className="ar-chip" onClick={() => onOpenDomain(meta.domain)} title="在 Σ5 主题域打开">域 {meta.domain}</button>
                  )}
                  {meta.stage && (onOpenStage && stageAnchorYear(meta.stage) != null ? (
                    <button className="ar-chip" onClick={() => onOpenStage(meta.stage)} title="在 Σ2 时间长河定位">学段 {meta.stage}</button>
                  ) : (
                    <span className="ar-chip off">学段 {meta.stage}</span>
                  ))}
                </div>
              </section>
            )}
            {meta && (meta.timeline?.length ?? 0) > 0 && (
              <section className="ar-card surface">
                <h2>同时间事件</h2>
                {meta.timeline!.map(t => (
                  <button key={t.id} className="ar-link" onClick={() => onOpenEvent?.(t.year, t.id)}>
                    {t.year}{t.month ? `.${String(t.month).padStart(2, '0')}` : ''}　{t.title}
                  </button>
                ))}
              </section>
            )}
            {meta && (meta.imagery?.length ?? 0) > 0 && (
              <section className="ar-card surface">
                <h2>相关意象</h2>
                <div className="ar-chips">
                  {meta.imagery!.map(im => (
                    <button key={im.id} className="ar-chip" onClick={() => {
                      recordImagery({ id: im.id, name: im.name });
                      onOpenImagery?.(im.id);
                    }} title="在 Σ6 意象博物馆打开">
                      {im.name}<em>{im.occ}</em>
                    </button>
                  ))}
                </div>
              </section>
            )}
            <HighlightList
              path={path}
              marks={localMarks}
              onChange={() => setHlTick(n => n + 1)}
              onSeek={snippet => { setFindOpen(true); setFindQ(snippet); }}
            />
            {meta && meta.persons.length === 0 && meta.backlinks.length === 0 && meta.evSnippets.length === 0
              && !meta.volume && !meta.domain && !meta.stage
              && (meta.timeline?.length ?? 0) === 0 && (meta.imagery?.length ?? 0) === 0 && localMarks.length === 0 && (
              <section className="ar-card surface"><p className="ar-toc-empty">本篇暂无关联元数据。</p></section>
            )}
          </aside>
        )}
      </div>
      {pop && (
        <HighlightPop
          pop={pop}
          path={path}
          title={meta?.title || ''}
          onClose={() => setPop(null)}
          onSaved={() => setHlTick(n => n + 1)}
        />
      )}
      {shot && (
        <div
          ref={shotRef}
          className="ar-shot"
          role="dialog"
          aria-modal="true"
          aria-label={shot.alt || '放大图片'}
          onPointerDown={e => { swipeRef.current = { x: e.clientX, y: e.clientY }; }}
          onPointerUp={e => {
            const dx = e.clientX - swipeRef.current.x;
            const dy = e.clientY - swipeRef.current.y;
            if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.2 && shot.list.length > 1) {
              stepShot(dx < 0 ? 1 : -1);
              return;
            }
            if (e.target === e.currentTarget && Math.hypot(dx, dy) < 8) setShot(null);
          }}
        >
          <button type="button" className="ar-shot-x" onClick={() => setShot(null)}>关闭</button>
          {shot.list.length > 1 && (
            <button type="button" className="ar-shot-nav prev" onClick={() => stepShot(-1)}>上一张</button>
          )}
          <figure>
            <img src={shot.src} alt={shot.alt} />
            {shot.alt ? <figcaption>{shot.alt}</figcaption> : null}
          </figure>
          {shot.list.length > 1 && (
            <button type="button" className="ar-shot-nav next" onClick={() => stepShot(1)}>下一张</button>
          )}
          {shot.list.length > 1 && (
            <p className="ar-shot-idx" aria-live="polite">
              {Math.max(1, shot.list.findIndex(x => x.src === shot.src) + 1)} / {shot.list.length}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
