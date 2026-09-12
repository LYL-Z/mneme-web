import { useEffect, useMemo, useRef, useState } from 'react';
import MarkdownIt from 'markdown-it';
import { ApiError, api, apiErrorMessage, headingSlug, type DocFull } from '../api';
import { addHighlight, getHighlights, getRecentDocs, isPublicPath, recordDoc, removeHighlight, setDocNeighbors } from '../history';
import { evidenceLabel } from '../evidenceKind';
import { stageAnchorYear } from '../stages';
import { paintEvidenceSpans, focusEvidence, focusLocalHighlight, paintLocalHighlights, recalledEvidence, highlightQuery, clearQueryMarks, cycleQueryMarks, queryMarkPos } from '../highlightSnippet';
import { ensureCjkSerif } from '../fontsCjk';
import { prefetchDoc } from '../prefetch';
import { isModifiedClick } from '../navClick';
import { notify } from '../toast';
import { askUnlock } from '../unlock';
import { copyPermalink } from '../cite';
import { DeskWrite } from './DeskWrite';
import { bindSyncScroll } from '../syncScroll';
import { emitLayout, readScroller } from '../readHost';
import { useFocusTrap } from '../focusTrap';

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
      img.classList.add('ar-img-open');
      img.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const pane = img.closest('.ar-pane');
        const list = pane
          ? [...pane.querySelectorAll<HTMLImageElement>('img.ar-img-open')].map(im => ({
            src: im.currentSrc || im.src,
            alt: im.alt || '',
          })).filter(x => x.src)
          : [{ src: img.currentSrc || img.src, alt: img.alt || '' }];
        window.dispatchEvent(new CustomEvent('mneme:img', {
          detail: { src: img.currentSrc || img.src, alt: img.alt || '', list },
        }));
      });
    });
    if (state.s === 'ok') wrapPersonNames(el, state.doc.persons || []);
    if (state.s === 'ok' && track) paintLocalHighlights(el, getHighlights(path));
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
    const pn = (e.target as HTMLElement).closest('button.ar-pname') as HTMLButtonElement | null;
    if (pn?.dataset.pid) {
      e.preventDefault();
      if (pn.dataset.locked) askUnlock();
      else onOpenPerson(+pn.dataset.pid);
      return;
    }
    const t = (e.target as HTMLElement).closest('a.wl') as HTMLAnchorElement | null;
    if (t) {
      if (isModifiedClick(e)) return;
      e.preventDefault();
      onNavigate(t.dataset.wl || '');
    }
  };
  const onRetry = () => setRetry(n => n + 1);

  if (state.s === 'miss') {
    const recents = getRecentDocs().filter(d => d.path && !/私人资料|(^|\/)隐私\//.test(d.path)).slice(0, 3);
    return (
    <div className="ar-miss surface">
      <p className="greek ar-miss-greek">ΜΗ ΕΥΡΕΘΗΚΕ</p>
      <h2>未收录，或已隔离</h2>
      <p className="ar-miss-sub">该页面不在公开层——它可能尚未建立，也可能属于被精心守护的部分。</p>
      <div className="ar-miss-acts">
        {recents.map(d => (
          <button key={d.path} type="button" className="mu-ledger" onClick={() => onNavigate(d.path)}>续读 · {d.title}</button>
        ))}
        <button type="button" className="mu-ledger" onClick={() => window.dispatchEvent(new CustomEvent('mneme:search'))}>检索全库 →</button>
      </div>
    </div>
    );
  }
  if (state.s === 'lock') return (
    <div className="ar-miss surface">
      <p className="greek ar-miss-greek">ΑΠΟΡΡΗΤΟΝ</p>
      <h2>此为绝密档案</h2>
      <p className="ar-miss-sub">它被单独封存——输入管理员密码后即可开启。</p>
      <button type="button" className="mu-ledger" onClick={() => window.dispatchEvent(new CustomEvent('mneme:locked'))}>输入管理员密码 →</button>
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

interface ReaderCfg { fs: 15 | 16 | 17 | 18; mw: 'n' | 'm' | 'w'; ff: 'serif' | 'sans'; sync: boolean }
const READER_KEY = 'mneme-reader';
const remainLabel = (body: string, ratio: number) => {
  const n = body.replace(/\s+/g, '').length;
  if (n < 80) return '不足一分钟';
  const total = Math.max(1, Math.round(n / 400));
  const left = Math.max(0, Math.round(total * (1 - ratio)));
  const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  if (left <= 0) return `已读完 · ${n.toLocaleString()} 字`;
  return `已读 ${pct}% · 剩余约 ${left} 分钟 · ${n.toLocaleString()} 字`;
};

function wrapPersonNames(root: HTMLElement, persons: { id: number; display_name: string; locked?: boolean }[]) {
  const list = persons
    .filter(p => p.display_name && p.display_name.length >= 2)
    .sort((a, b) => b.display_name.length - a.display_name.length)
    .slice(0, 24);
  if (!list.length) return;
  const skip = new Set(['A', 'BUTTON', 'CODE', 'PRE', 'SCRIPT', 'TEXTAREA', 'MARK']);
  const walk = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (skip.has(el.tagName) || el.classList.contains('ar-pname') || el.classList.contains('h-copy')) return;
      [...node.childNodes].forEach(walk);
      return;
    }
    if (node.nodeType !== Node.TEXT_NODE) return;
    const text = node.textContent || '';
    if (!text.trim()) return;
    const hit = list.find(p => text.includes(p.display_name));
    if (!hit) return;
    const i = text.indexOf(hit.display_name);
    const frag = document.createDocumentFragment();
    if (i > 0) frag.append(text.slice(0, i));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `ar-pname${hit.locked ? ' locked' : ''}`;
    btn.dataset.pid = String(hit.id);
    if (hit.locked) btn.dataset.locked = '1';
    btn.textContent = hit.display_name;
    frag.append(btn);
    const rest = i + hit.display_name.length < text.length ? text.slice(i + hit.display_name.length) : '';
    if (rest) {
      const tn = document.createTextNode(rest);
      frag.append(tn);
      node.parentNode?.replaceChild(frag, node);
      walk(tn);
      return;
    }
    node.parentNode?.replaceChild(frag, node);
  };
  walk(root);
}
const READER_MW: Record<ReaderCfg['mw'], string> = { n: '38em', m: '44em', w: '100%' };
const loadReader = (): ReaderCfg => {
  try {
    const v = JSON.parse(localStorage.getItem(READER_KEY) || '');
    if (v && [15, 16, 17, 18].includes(v.fs) && ['n', 'm', 'w'].includes(v.mw) && ['serif', 'sans'].includes(v.ff)) {
      return { fs: v.fs, mw: v.mw, ff: v.ff, sync: v.sync !== false };
    }
  } catch { /* 首访/损坏 → 默认 */ }
  return { fs: 17, mw: 'm', ff: 'serif', sync: true };
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
      <p className="rs-row"><span>对照同步滚</span>{seg([{ v: 1 as const, label: '开' }, { v: 0 as const, label: '关' }], cfg.sync ? 1 : 0, v => onChange({ ...cfg, sync: !!v }))}</p>
    </div>
  );
}

/* ---------------- 次栏选择器（双栏对照用） ---------------- */

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

function SecPicker({ onPick, suggested }: { onPick: (path: string) => void; suggested?: { path: string; label: string } | null }) {
  const [q, setQ] = useState('');
  const [docs, setDocs] = useState<{ path: string; title: string; domain: string }[]>([]);
  useEffect(() => {
    const query = q.trim();
    if (!query) { setDocs([]); return; }
    const t = setTimeout(() => {
      api.search(query)
        .then(r => setDocs((r.groups.doc ?? []).filter(d => !d.locked && isPublicPath(d.path)).slice(0, 8)))
        .catch(e => { setDocs([]); notify(apiErrorMessage(e), 'error'); });
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const recents = getRecentDocs().filter(d => isPublicPath(d.path)).slice(0, 6);
  return (
    <div className="ar-picker glass">
      <h2>对照阅读 · 选择右栏文档</h2>
      {suggested && isPublicPath(suggested.path) && (
        <button className="ar-pick-sug" onClick={() => onPick(suggested.path)} title={suggested.path}>
          <b>本部章稿 · {suggested.label}</b>
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
  const [editOpen, setEditOpen] = useState(false);
  const [wantAi, setWantAi] = useState(false);
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
  }, [meta?.body, path, dual, editOpen]);
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
  useFocusTrap(shotRef, !!shot, () => setShot(null));
  useEffect(() => { emitLayout(); }, [dual, editOpen, path]);
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
    const edit = () => { setEditOpen(true); setWantAi(false); };
    const ai = () => { setEditOpen(true); setWantAi(true); };
    window.addEventListener('mneme:edit', edit);
    window.addEventListener('mneme:ai', ai);
    return () => {
      window.removeEventListener('mneme:edit', edit);
      window.removeEventListener('mneme:ai', ai);
    };
  }, []);
  useEffect(() => {
    if (!dual || !reader.sync || !mainPane.current || !secPane.current) return;
    return bindSyncScroll(mainPane.current, secPane.current);
  }, [dual, reader.sync, secPath, path, editOpen]);
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
      if (editOpen) return;
      if (e.key === 'e') { e.preventDefault(); setEditOpen(true); setWantAi(false); return; }
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
  }, [findOpen, inspOpen, tocOpen, volDesign, shot, pop, editOpen]);
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
  }, [headings, dual, editOpen]);

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
    <div className={`ar${dual || editOpen ? ' is-split' : ''}`} style={wrapStyle} data-active-h={activeH} data-doc-title={meta?.title || ''}>
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
          <h1>{meta ? meta.title : path.replace(/\.md$/, '').split('/').pop()}</h1>
        </div>
        <div className="ar-toolbar" ref={rsRef}>
          <button className={`ar-tool ${tocOpen ? 'on' : ''}`} onClick={() => setTocOpen(v => !v)} title="目录 · t">目录</button>
          <button className={`ar-tool ${dual ? 'on' : ''}`} onClick={() => { setDual(v => !v); if (!dual) setSecPath(p => p ?? volDesign?.path ?? null); }} title="双栏对照阅读 · d">对照</button>
          <button className={`ar-tool ${editOpen ? 'on' : ''}`} onClick={() => { setEditOpen(v => !v); setWantAi(false); }} title="编辑本篇 · e">编辑</button>
          <button className={`ar-tool ${inspOpen ? 'on' : ''}`} onClick={() => setInspOpen(v => !v)} title="来源检查器 · i">检查器</button>
          <button className={`ar-tool ${findOpen ? 'on' : ''}`} onClick={() => { setFindOpen(v => !v); if (!findOpen) window.setTimeout(() => findRef.current?.focus(), 30); }} title="本篇查找">找</button>
          {findOpen && (
            <span className="ar-find">
              <input
                ref={findRef}
                className="ar-find-q"
                value={findQ}
                onChange={e => setFindQ(e.target.value)}
                placeholder="本篇查找"
                aria-label="本篇查找"
                onKeyDown={e => {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  if (e.key === 'Enter') { e.preventDefault(); jumpFind(e.shiftKey ? -1 : 1); }
                  if (e.key === 'Escape') { setFindOpen(false); setFindQ(''); }
                }}
              />
              <em>{findN ? `${findI}/${findN}` : 0}</em>
            </span>
          )}
          <span className="ar-tool-sep" />
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
            {editOpen ? (
              <DeskWrite
                path={path}
                wantAi={wantAi}
                onClose={() => { setEditOpen(false); setWantAi(false); }}
                onSaved={() => { setDocTick(n => n + 1); }}
              />
            ) : (
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
            )}
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
                  <button key={p.id} className="ar-link" onClick={() => p.locked ? askUnlock() : onOpenPerson(p.id)}>
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
                    <button key={im.id} className="ar-chip" onClick={() => onOpenImagery?.(im.id)} title="在 Σ6 意象博物馆打开">
                      {im.name}<em>{im.occ}</em>
                    </button>
                  ))}
                </div>
              </section>
            )}
            {localMarks.length > 0 && (
              <section className="ar-card surface">
                <h2>本机划线</h2>
                <p className="ar-ev-note">只存在这台浏览器，不写回知识库。</p>
                {localMarks.map(h => (
                  <div key={h.id} className="ar-hl">
                    <button type="button" className="ar-link" onClick={() => {
                      const root = document.querySelector('.ar-pane:not(.sec) .ar-body') as HTMLElement | null;
                      const el = root ? focusLocalHighlight(root, h.id) : null;
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      else {
                        setFindOpen(true);
                        setFindQ(h.snippet.slice(0, 48));
                      }
                    }}>{h.snippet}</button>
                    <button type="button" className="ar-hl-x" aria-label="删除划线" onClick={() => {
                      removeHighlight(h.id);
                      setHlTick(n => n + 1);
                      const root = document.querySelector('.ar-pane:not(.sec) .ar-body') as HTMLElement | null;
                      if (root) paintLocalHighlights(root, getHighlights(path));
                    }}>删</button>
                  </div>
                ))}
              </section>
            )}
            {meta && meta.persons.length === 0 && meta.backlinks.length === 0 && meta.evSnippets.length === 0
              && !meta.volume && !meta.domain && !meta.stage
              && (meta.timeline?.length ?? 0) === 0 && (meta.imagery?.length ?? 0) === 0 && localMarks.length === 0 && (
              <section className="ar-card surface"><p className="ar-toc-empty">本篇暂无关联元数据。</p></section>
            )}
          </aside>
        )}
      </div>
      {pop && (
        <div
          className="ar-pop glass"
          style={{ left: pop.x, top: pop.y }}
          onMouseDown={e => e.preventDefault()}
        >
          <button type="button" onClick={() => {
            if (!isPublicPath(path)) return;
            addHighlight({ path, title: meta?.title || '', heading: pop.heading, snippet: pop.text });
            setHlTick(n => n + 1);
            const root = document.querySelector('.ar-pane:not(.sec) .ar-body') as HTMLElement | null;
            if (root) paintLocalHighlights(root, getHighlights(path));
            window.getSelection()?.removeAllRanges();
            setPop(null);
            notify('已记下本机划线', 'info');
          }}>划线</button>
          <button type="button" onClick={() => {
            copyPermalink({ title: meta?.title, heading: pop.heading, snippet: pop.text });
            window.getSelection()?.removeAllRanges();
            setPop(null);
          }}>复制引用</button>
        </div>
      )}
      {shot && (
        <div
          ref={shotRef}
          className="ar-shot"
          role="dialog"
          aria-modal="true"
          aria-label={shot.alt || '放大图片'}
          onMouseDown={() => setShot(null)}
        >
          <button type="button" className="ar-shot-x" onMouseDown={e => e.stopPropagation()} onClick={() => setShot(null)}>关闭</button>
          {shot.list.length > 1 && (
            <button type="button" className="ar-shot-nav prev" onMouseDown={e => e.stopPropagation()} onClick={() => stepShot(-1)}>上一张</button>
          )}
          <figure onMouseDown={e => e.stopPropagation()}>
            <img src={shot.src} alt={shot.alt} />
            {shot.alt ? <figcaption>{shot.alt}</figcaption> : null}
          </figure>
          {shot.list.length > 1 && (
            <button type="button" className="ar-shot-nav next" onMouseDown={e => e.stopPropagation()} onClick={() => stepShot(1)}>下一张</button>
          )}
        </div>
      )}
    </div>
  );
}
