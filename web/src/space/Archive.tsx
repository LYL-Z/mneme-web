import { useEffect, useMemo, useRef, useState } from 'react';
import MarkdownIt from 'markdown-it';
import { ApiError, api, apiErrorMessage, headingSlug, type DocFull } from '../api';
import { getRecentDocs, recordDoc } from '../history';
import { evidenceLabel } from '../evidenceKind';
import { stageAnchorYear } from '../stages';
import { paintEvidenceSpans, focusEvidence, recalledEvidence, highlightQuery, clearQueryMarks } from '../highlightSnippet';
import { ensureCjkSerif } from '../fontsCjk';
import { notify } from '../toast';

/**
 * Σ7 原文档案馆 · 阅读工作区（v4 · Phase A 跨越式升级）
 * 三栏架构：左目录（标题树+滚动侦听）· 中正文（可双栏对照）· 右来源检查器——均可收起。
 * - DocPane：单篇文档渲染单元（markdown-it + 消毒 + callout/Dataview 处理 + 锚点 + 段落复制）
 *   标题锚点去重改用 per-render env（修复：模块级 used Map 跨文档累积致锚点失配）
 * - 阅读器设置：字号/行宽/宋黑切换（localStorage mneme-reader）
 * - 双栏对照：次栏内置检索+最近文档选择器（写作核对场景：章节设计 ⇄ 原文）
 * - 403=绝密（弹 SecretGate），404=未收录/隔离，网络故障=独立错误态
 */
const md = new MarkdownIt({ html: true, linkify: false, breaks: true });

const escHtml = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));

/** [[目标|别名]] / [[目标]] → 真实内链（/doc/…，事件委托接管点击） */
const renderWiki = (src: string) =>
  src.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, t: string, l?: string) => {
    const target = t.trim();
    const label = (l || target).trim();
    return `<a class="wl" href="/doc/${encodeURIComponent(target)}" data-wl="${escHtml(target)}" title="${escHtml(target)}">${escHtml(label)}</a>`;
  });

/** 工作区已有文题 h1。正文标题整体 +1，避免 h1 叠 h1、h1 后直接 h3。 */
const bumpHeading = (tag: string) => {
  const n = Number(tag.slice(1));
  return Number.isFinite(n) && n >= 1 && n < 6 ? `h${n + 1}` : tag;
};
{
  const open = md.renderer.rules.heading_open;
  const close = md.renderer.rules.heading_close;
  md.renderer.rules.heading_open = (tokens, idx, opts, env, self) => {
    tokens[idx].tag = bumpHeading(tokens[idx].tag);
    const text = tokens[idx + 1]?.type === 'inline' ? tokens[idx + 1].content : '';
    const base = headingSlug(text);
    const e = (env ?? {}) as { used?: Map<string, number> };
    const used = (e.used ??= new Map<string, number>());
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    tokens[idx].attrSet('id', n === 0 ? base : `${base}-${n}`);
    return open ? open(tokens, idx, opts, env, self) : self.renderToken(tokens, idx, opts);
  };
  md.renderer.rules.heading_close = (tokens, idx, opts, env, self) => {
    tokens[idx].tag = bumpHeading(tokens[idx].tag);
    return close ? close(tokens, idx, opts, env, self) : self.renderToken(tokens, idx, opts);
  };
}

/** 消毒：移除可执行节点与危险协议后再写入正文（必须真正调用，不能只定义） */
const DANGEROUS_TAGS = 'script,style,iframe,object,embed,base,form,link,meta,svg,math,video,audio,textarea,input';
function sanitizeInto(target: HTMLElement, html: string) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelectorAll(DANGEROUS_TAGS).forEach(n => n.remove());
  tpl.content.querySelectorAll('*').forEach(el => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.replace(/[\s]/g, '').toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc') el.removeAttribute(attr.name);
      else if (name.startsWith('data-') && name !== 'data-wl') el.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'src' || name === 'xlink:href' || name === 'srcset')
        && /^(javascript|vbscript|data:text\/html)/.test(value)) {
        el.removeAttribute(attr.name);
      }
    }
  });
  target.replaceChildren(...tpl.content.childNodes);
}

type ReadState =
  | { s: 'loading' }
  | { s: 'ok'; doc: DocFull }
  | { s: 'miss' }
  | { s: 'net' }
  | { s: 'lock' };

export interface DocHeading { id: string; text: string; level: number; el: HTMLElement }

/* ---------------- DocPane：单篇文档渲染单元 ---------------- */

function DocPane({ path, anchor, evidenceId, query, compact, track, onNavigate, onOpenPerson, onHeadings, onDocMeta, onEvidenceFocus, onEvidenceLoci }: {
  path: string;
  anchor?: string;
  evidenceId?: number;
  query?: string;
  compact?: boolean;
  track?: boolean;
  onNavigate: (path: string) => void;
  onOpenPerson: (id: number) => void;
  onHeadings?: (hs: DocHeading[]) => void;
  onDocMeta?: (d: DocFull) => void;
  onEvidenceFocus?: (id: number) => void;
  onEvidenceLoci?: (m: Record<number, { heading: string; para: string }>) => void;
}) {
  const [state, setState] = useState<ReadState>({ s: 'loading' });
  const [retry, setRetry] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);
  const cbRef = useRef({ onHeadings, onDocMeta, onEvidenceFocus, onEvidenceLoci });
  cbRef.current = { onHeadings, onDocMeta, onEvidenceFocus, onEvidenceLoci };

  useEffect(() => {
    const seq = ++seqRef.current;
    setState({ s: 'loading' });
    api.doc(path).then(d => {
      if (seq !== seqRef.current) return; // 过期响应丢弃
      if (d) {
        setState({ s: 'ok', doc: d });
        if (track) recordDoc({ path: d.path, title: d.title, domain: d.domain });
        cbRef.current.onDocMeta?.(d);
      } else setState({ s: 'miss' });
    }).catch((e: unknown) => {
      if (seq !== seqRef.current) return;
      if (e instanceof ApiError && e.status === 403) { setState({ s: 'lock' }); window.dispatchEvent(new CustomEvent('mneme:locked')); return; }
      const net = e instanceof ApiError && (e.status === 0 || e.status >= 500);
      setState(net ? { s: 'net' } : { s: 'miss' });
    });
  }, [path, retry, track]);

  /* 绝密档案解锁后自动重试当前文档 */
  useEffect(() => {
    const onUnlocked = () => setRetry(n => n + 1);
    window.addEventListener('mneme:unlocked', onUnlocked);
    return () => window.removeEventListener('mneme:unlocked', onUnlocked);
  }, []);

  const html = useMemo(() => (state.s === 'ok' ? md.render(renderWiki(state.doc.body), { used: new Map() }) : ''), [state]);

  /* 消毒写入 + callout / Dataview / 外链 / 标题复制 / 目录 */
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (state.s !== 'ok') { el.replaceChildren(); return; }
    sanitizeInto(el, html);
    el.querySelectorAll('blockquote').forEach(bq => {
      const first = bq.firstElementChild;
      const head = first?.textContent || '';
      const m = head.match(/\[!(\w+)\]\s*(.*)/);
      if (!m || !first) return;
      bq.classList.add('callout', `co-${m[1].toLowerCase()}`);
      const titleNode = first.firstChild;
      if (titleNode && titleNode.nodeType === Node.TEXT_NODE) {
        const text = titleNode.textContent || '';
        const cut = text.replace(/^\s*\[!\w+\]\s*/, '');
        if (cut) titleNode.textContent = cut; else first.removeChild(titleNode);
      } else if (titleNode) {
        first.removeChild(titleNode);
      }
      const br = first.querySelector('br');
      const leading = first.firstChild;
      if (leading && leading.nodeType === Node.TEXT_NODE && !(leading.textContent || '').trim()) leading.remove();
      if (br && br === first.firstChild) br.remove();
      const tag = document.createElement('b');
      tag.className = 'co-tag';
      tag.textContent = m[1].toUpperCase();
      first.prepend(tag);
    });
    /* Dataview 动态查询：网页快照不执行任意脚本 → 降级为说明卡片 */
    el.querySelectorAll('pre > code.language-dataview, pre > code.language-dataviewjs').forEach(code => {
      const pre = code.parentElement!;
      const note = document.createElement('div');
      note.className = 'dv-note';
      note.setAttribute('role', 'note');
      const head = document.createElement('p');
      head.className = 'dv-head';
      head.textContent = 'Obsidian Dataview 动态查询';
      const body = document.createElement('p');
      body.className = 'dv-body';
      body.textContent = '该查询的结果由知识库在 Obsidian 中实时生成。本站为只读快照，不执行查询——'
        + '动态列表请回 Obsidian 查看；站内可用 ⌘K 检索全部公开文档。';
      const src = document.createElement('details');
      src.className = 'dv-src';
      const sum = document.createElement('summary');
      sum.textContent = '查看查询语句';
      const code2 = document.createElement('code');
      code2.textContent = code.textContent;
      src.append(sum, code2);
      note.append(head, body, src);
      pre.replaceWith(note);
    });
    el.querySelectorAll('a[href^="http"]').forEach(a => {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noreferrer noopener');
    });
    /* A6 · 段落锚点复制：标题 hover 显示 ¶，点击复制深链 */
    const docPath = state.doc.path;
    el.querySelectorAll('h2, h3, h4').forEach(h => {
      const id = h.id;
      if (!id) return;
      const btn = document.createElement('button');
      btn.className = 'h-copy';
      btn.textContent = '¶';
      btn.title = '复制此段链接';
      btn.setAttribute('aria-label', '复制此段链接');
      btn.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const url = `${location.origin}/doc/${encodeURIComponent(docPath)}?h=${encodeURIComponent(id)}`;
        const done = () => {
          btn.textContent = '✓';
          btn.classList.add('ok');
          setTimeout(() => { btn.textContent = '¶'; btn.classList.remove('ok'); }, 1400);
        };
        /* v8：剪贴板 API 在非安全上下文/无权限时会 reject——降级到 execCommand，
           两条路都失败才提示用户手动复制，不再「点了没反应」。 */
        const fallback = () => {
          const ta = document.createElement('textarea');
          ta.value = url; document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); done(); }
          catch { notify('复制失败，请手动复制地址栏链接', 'warn'); }
          ta.remove();
        };
        if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done).catch(fallback);
        else fallback();
      });
      h.prepend(btn);
    });
    /* 目录回调（TOC 数据源） */
    cbRef.current.onHeadings?.(
      [...el.querySelectorAll('h2, h3, h4')]
        .filter(h => h.id)
        .map(h => ({ id: h.id, text: h.textContent?.replace(/^¶/, '').trim() || '', level: Math.max(1, +h.tagName[1] - 1), el: h as HTMLElement })),
    );
    if (state.s === 'ok') {
      paintEvidenceSpans(el, state.doc.evSnippets);
      const loci: Record<number, { heading: string; para: string }> = {};
      el.querySelectorAll<HTMLElement>('mark.ev-hl[data-ev-id]').forEach(m => {
        const id = Number(m.dataset.evId);
        if (!Number.isFinite(id)) return;
        loci[id] = { heading: m.dataset.heading || '', para: m.dataset.para || '' };
      });
      cbRef.current.onEvidenceLoci?.(loci);
    }
    el.querySelectorAll('img').forEach(img => {
      img.setAttribute('decoding', 'async');
      if (!img.hasAttribute('loading')) img.setAttribute('loading', 'lazy');
      if (!img.getAttribute('width') && !img.getAttribute('height')) img.classList.add('ar-img-open');
    });
  }, [state, html]);

  /* 锚点定位：渲染完成后滚动到目标标题并闪烁一次（章节面板材料链落点） */
  useEffect(() => {
    if (!anchor || state.s !== 'ok') return;
    let tries = 0;
    let timer = 0;
    const find = () => {
      tries += 1;
      const el = bodyRef.current?.querySelector(`#${CSS.escape(anchor)}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('anchor-flash');
        setTimeout(() => el.classList.remove('anchor-flash'), 2200);
        return;
      }
      if (tries < 20) timer = window.setTimeout(find, 100);
    };
    find();
    return () => window.clearTimeout(timer);
  }, [anchor, state]);

  /* 证据灯塔 / 深链：渲染完成后滚到片段并聚焦（不拆除其余内联标） */
  useEffect(() => {
    if (state.s !== 'ok' || evidenceId == null) return;
    const snip = state.doc.evSnippets.find(s => s.id === evidenceId)?.snippet || recalledEvidence(evidenceId);
    let tries = 0;
    let timer = 0;
    const find = () => {
      tries += 1;
      const root = bodyRef.current;
      if (root) {
        const el = focusEvidence(root, { id: evidenceId, snippet: snip });
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
      }
      if (tries < 20) timer = window.setTimeout(find, 100);
    };
    find();
    return () => window.clearTimeout(timer);
  }, [evidenceId, state, html]);

  /* 检索词落到正文：与证据标并存。有证据深链或标题锚点时不抢滚动。 */
  useEffect(() => {
    const root = bodyRef.current;
    if (state.s !== 'ok' || !root) return;
    const needle = (query || '').trim();
    if (!needle) { clearQueryMarks(root); return; }
    let tries = 0;
    let timer = 0;
    const find = () => {
      tries += 1;
      const el = highlightQuery(root, needle);
      if (el) {
        if (evidenceId == null && !anchor) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (tries < 20) timer = window.setTimeout(find, 100);
    };
    find();
    return () => window.clearTimeout(timer);
  }, [query, evidenceId, anchor, state, html]);

  const onBodyClick = (e: React.MouseEvent) => {
    const mark = (e.target as HTMLElement).closest('mark.ev-hl') as HTMLElement | null;
    if (mark?.dataset.evId) {
      const id = +mark.dataset.evId;
      if (bodyRef.current) focusEvidence(bodyRef.current, { id });
      cbRef.current.onEvidenceFocus?.(id);
      return;
    }
    const t = (e.target as HTMLElement).closest('a.wl') as HTMLAnchorElement | null;
    if (t) { e.preventDefault(); onNavigate(t.dataset.wl || ''); }
  };
  const onRetry = () => setRetry(n => n + 1);

  if (state.s === 'miss') return (
    <div className="ar-miss surface">
      <p className="greek ar-miss-greek">ΜΗ ΕΥΡΕΘΗΚΕ</p>
      <h2>未收录，或已隔离</h2>
      <p className="ar-miss-sub">该页面不在公开层——它可能尚未建立，也可能属于被精心守护的部分。</p>
    </div>
  );
  if (state.s === 'lock') return (
    <div className="ar-miss surface">
      <p className="greek ar-miss-greek">ΑΠΟΡΡΗΤΟΝ</p>
      <h2>此为绝密档案</h2>
      <p className="ar-miss-sub">它被单独封存——输入管理员密码后即可开启。</p>
    </div>
  );
  if (state.s === 'net') return (
    <div className="ar-miss surface">
      <p className="greek ar-miss-greek">ΔΙΚΤΥΟ</p>
      <h2>网络异常</h2>
      <p className="ar-miss-sub">内容取回失败——这不是「未收录」，是网络或服务暂时不可用。</p>
      <button className="mu-ledger" onClick={onRetry}>重新加载 →</button>
    </div>
  );
  if (state.s === 'loading') return <div className="ar-loading">展开纸页…</div>;
  return (
    <article className={`ar-body ${compact ? 'compact' : ''}`} ref={bodyRef} onClick={onBodyClick} />
  );
}

/* ---------------- 阅读器设置 ---------------- */

interface ReaderCfg { fs: 15 | 16 | 17 | 18; mw: 'n' | 'm' | 'w'; ff: 'serif' | 'sans' }
const READER_KEY = 'mneme-reader';
const READER_MW: Record<ReaderCfg['mw'], string> = { n: '38em', m: '44em', w: '100%' };
const loadReader = (): ReaderCfg => {
  try {
    const v = JSON.parse(localStorage.getItem(READER_KEY) || '');
    if (v && [15, 16, 17, 18].includes(v.fs) && ['n', 'm', 'w'].includes(v.mw) && ['serif', 'sans'].includes(v.ff)) return v;
  } catch { /* 首访/损坏 → 默认 */ }
  return { fs: 16, mw: 'm', ff: 'serif' };
};

function ReaderSettings({ cfg, onChange }: { cfg: ReaderCfg; onChange: (c: ReaderCfg) => void }) {
  const seg = <T extends string | number>(opts: { v: T; label: string }[], cur: T, set: (v: T) => void) => (
    <div className="rs-seg">
      {opts.map(o => (
        <button key={String(o.v)} className={`rs-btn ${cur === o.v ? 'on' : ''}`} onClick={() => set(o.v)}>{o.label}</button>
      ))}
    </div>
  );
  return (
    <div className="rs glass" role="dialog" aria-label="阅读器设置">
      <p className="rs-row"><span>字号</span>{seg([{ v: 15 as const, label: '小' }, { v: 16 as const, label: '中' }, { v: 17 as const, label: '大' }, { v: 18 as const, label: '特大' }], cfg.fs, fs => onChange({ ...cfg, fs }))}</p>
      <p className="rs-row"><span>行宽</span>{seg([{ v: 'n' as const, label: '窄' }, { v: 'm' as const, label: '适中' }, { v: 'w' as const, label: '全宽' }], cfg.mw, mw => onChange({ ...cfg, mw }))}</p>
      <p className="rs-row"><span>字体</span>{seg([{ v: 'serif' as const, label: '宋体' }, { v: 'sans' as const, label: '黑体' }], cfg.ff, ff => onChange({ ...cfg, ff }))}</p>
    </div>
  );
}

/* ---------------- 次栏选择器（双栏对照用） ---------------- */

const VOL_DESIGN: Record<string, string> = {
  V1: '长篇创作/章节设计-第一卷-童年与底色.md',
  V2: '长篇创作/章节设计-第二卷-青春与阵痛.md',
  V3: '长篇创作/章节设计-第三卷-爱与迷失.md',
  V4: '长篇创作/章节设计-第四卷-困境与重建.md',
  V5: '长篇创作/章节设计-第五卷-和解与当下.md',
};
const VOL_NAME: Record<string, string> = { V1: '一卷', V2: '二卷', V3: '三卷', V4: '四卷', V5: '五卷' };

function SecPicker({ onPick, suggested }: { onPick: (path: string) => void; suggested?: { path: string; label: string } | null }) {
  const [q, setQ] = useState('');
  const [docs, setDocs] = useState<{ path: string; title: string; domain: string }[]>([]);
  useEffect(() => {
    const query = q.trim();
    if (!query) { setDocs([]); return; }
    const t = setTimeout(() => {
      api.search(query)
        .then(r => setDocs((r.groups.doc ?? []).slice(0, 8)))
        .catch(e => { setDocs([]); notify(apiErrorMessage(e), 'error'); });
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const recents = getRecentDocs().slice(0, 6);
  return (
    <div className="ar-picker glass">
      <h2>对照阅读 · 选择右栏文档</h2>
      {suggested && (
        <button className="ar-pick-sug" onClick={() => onPick(suggested.path)} title={suggested.path}>
          <b>本卷大纲 · {suggested.label}</b>
          <span>默认对照：章节设计 ⇄ 原文逐段核对</span>
        </button>
      )}
      <input className="ar-picker-q" value={q} onChange={e => setQ(e.target.value)} placeholder="检索文档标题/正文…" aria-label="检索对照文档" />
      {q.trim() && (docs.length > 0 ? (
        <div className="ar-picker-list">
          {docs.map(d => <button key={d.path} onClick={() => onPick(d.path)}><b>{d.title}</b><span>{d.domain}</span></button>)}
        </div>
      ) : <p className="ar-picker-none">无所检出。</p>)}
      {!q.trim() && recents.length > 0 && (
        <div className="ar-picker-list">
          {recents.map(d => <button key={d.path} onClick={() => onPick(d.path)}><b>{d.title}</b><span>{d.domain}</span></button>)}
        </div>
      )}
      <p className="ar-picker-hint">典型用法：左栏开章节设计，右栏开对应原文，逐段核对。</p>
    </div>
  );
}

/* ---------------- Archive：工作区外壳 ---------------- */

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
  const [tocOpen, setTocOpen] = useState(() => window.innerWidth >= 1240);
  const [inspOpen, setInspOpen] = useState(() => window.innerWidth >= 1240);
  const [dual, setDual] = useState(false);
  const [secPath, setSecPath] = useState<string | null>(null);

  const [headings, setHeadings] = useState<DocHeading[]>([]);
  const [activeH, setActiveH] = useState('');
  const [meta, setMeta] = useState<DocFull | null>(null);
  const [evFocus, setEvFocus] = useState<number | undefined>(evidenceId);
  const [evLoci, setEvLoci] = useState<Record<number, { heading: string; para: string }>>({});
  useEffect(() => { ensureCjkSerif(); }, []);
  /* v4 · A4 深化：默认对照当前文档所属卷的章节设计（卷大纲） */
  const volDesign = useMemo(() => {
    const v = meta?.volume ?? null;
    const k = v && VOL_DESIGN[v] ? v : null;
    return k ? { path: VOL_DESIGN[k], label: `${VOL_NAME[k]} · 章节设计` } : null;
  }, [meta]);
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
    const host = document.querySelector('.space-host');
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
  }, [headings]);

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
    <div className="ar" style={wrapStyle}>
      <header className="ar-head">
        <div className="ar-head-main">
          <p className="ar-crumb">{meta ? `${meta.domain}${meta.stage ? ` · ${meta.stage}` : ''}` : '\u00A0'}</p>
          <h1>{meta ? meta.title : path.replace(/\.md$/, '').split('/').pop()}</h1>
        </div>
        <div className="ar-toolbar" ref={rsRef}>
          <button className={`ar-tool ${tocOpen ? 'on' : ''}`} onClick={() => setTocOpen(v => !v)} title="目录">目录</button>
          {headings.length > 1 && <button className={`ar-tool ${dual ? 'on' : ''}`} onClick={() => { setDual(v => !v); if (!dual) setSecPath(p => p ?? volDesign?.path ?? null); }} title="双栏对照阅读">对照</button>}
          <button className={`ar-tool ${inspOpen ? 'on' : ''}`} onClick={() => setInspOpen(v => !v)} title="来源检查器">检查器</button>
          <span className="ar-tool-sep" />
          <button className={`ar-tool ${rsOpen ? 'on' : ''}`} onClick={() => setRsOpen(v => !v)} title="阅读器设置">Aa</button>
          {rsOpen && <ReaderSettings cfg={reader} onChange={setReader} />}
        </div>
      </header>

      <div className={`ar-workspace ${tocOpen ? 'toc' : ''} ${inspOpen ? 'insp' : ''}`}>
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
          <div className="ar-pane">
            <DocPane
              path={path} anchor={anchor} evidenceId={evidenceId} query={query} track
              onNavigate={onNavigate} onOpenPerson={onOpenPerson}
              onHeadings={onHeadings} onDocMeta={setMeta}
              onEvidenceFocus={setEvFocus} onEvidenceLoci={setEvLoci}
            />
          </div>
          {dual && (
            <div className="ar-pane sec">
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
                  <button key={p.id} className="ar-link" onClick={() => onOpenPerson(p.id)}>
                    {p.display_name}<em>{p.mention_count}</em>
                  </button>
                ))}
              </section>
            )}
            {meta && meta.backlinks.length > 0 && (
              <section className="ar-card surface">
                <h2>被谁引用</h2>
                {meta.backlinks.map(b => (
                  <button key={b.path} className="ar-link" onClick={() => onNavigate(b.path)}>{b.title}</button>
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
                    <button className="ar-chip" onClick={() => onOpenVolume(meta.volume as string)} title="在 Σ4 五卷书房打开">卷 {meta.volume}</button>
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
                    <button key={im.id} className="ar-chip" onClick={() => onOpenImagery?.(im.id)} title="在 Σ6 意象博物馆打开">
                      {im.name}<em>{im.occ}</em>
                    </button>
                  ))}
                </div>
              </section>
            )}
            {meta && meta.persons.length === 0 && meta.backlinks.length === 0 && meta.evSnippets.length === 0
              && !meta.volume && !meta.domain && !meta.stage
              && (meta.timeline?.length ?? 0) === 0 && (meta.imagery?.length ?? 0) === 0 && (
              <section className="ar-card surface"><p className="ar-toc-empty">本篇暂无关联元数据。</p></section>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
