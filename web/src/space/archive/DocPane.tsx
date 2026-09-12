import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api, type DocFull } from '../../api';
import { getHighlights, getRecentDocs, recordDoc } from '../../history';
import { paintEvidenceSpans, focusEvidence, paintLocalHighlights, recalledEvidence, highlightQuery, clearQueryMarks } from '../../highlightSnippet';
import { isModifiedClick } from '../../navClick';
import { notify } from '../../toast';
import { askUnlock } from '../../unlock';
import { emitSilk, recordPerson } from '../../silk';
import { md, renderWiki, sanitizeInto } from './md';
import { wrapPersonNames } from './markNames';

type ReadState =
  | { s: 'loading' }
  | { s: 'ok'; doc: DocFull }
  | { s: 'miss' }
  | { s: 'net' }
  | { s: 'lock' };

export interface DocHeading { id: string; text: string; level: number; el: HTMLElement }

export function DocPane({ path, anchor, evidenceId, query, compact, track, onNavigate, onOpenPerson, onHeadings, onDocMeta, onEvidenceFocus, onEvidenceLoci }: {
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
  const [htmlTick, setHtmlTick] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);
  const cbRef = useRef({ onHeadings, onDocMeta, onEvidenceFocus, onEvidenceLoci });
  cbRef.current = { onHeadings, onDocMeta, onEvidenceFocus, onEvidenceLoci };

  useEffect(() => {
    const seq = ++seqRef.current;
    setState({ s: 'loading' });
    api.doc(path).then(d => {
      if (seq !== seqRef.current) return;
      if (d) {
        setState({ s: 'ok', doc: d });
        if (track) { recordDoc({ path: d.path, title: d.title, domain: d.domain }); emitSilk(); }
        cbRef.current.onDocMeta?.(d);
      } else setState({ s: 'miss' });
    }).catch((e: unknown) => {
      if (seq !== seqRef.current) return;
      if (e instanceof ApiError && e.status === 403) { setState({ s: 'lock' }); window.dispatchEvent(new CustomEvent('mneme:locked')); return; }
      const net = e instanceof ApiError && (e.status === 0 || e.status >= 500);
      setState(net ? { s: 'net' } : { s: 'miss' });
    });
  }, [path, retry, track]);

  useEffect(() => {
    const onUnlocked = () => setRetry(n => n + 1);
    window.addEventListener('mneme:unlocked', onUnlocked);
    return () => window.removeEventListener('mneme:unlocked', onUnlocked);
  }, []);

  const html = useMemo(() => (state.s === 'ok' ? md.render(renderWiki(state.doc.body), { used: new Map() }) : ''), [state]);

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
    let offNames = () => {};
    if (state.s === 'ok') offNames = wrapPersonNames(el, state.doc.persons || []);
    if (state.s === 'ok' && track) paintLocalHighlights(el, getHighlights(path));
    setHtmlTick(n => n + 1);
    return () => { offNames(); };
  }, [state, html, path, track]);

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
  }, [anchor, state, htmlTick]);

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
  }, [evidenceId, state, htmlTick]);

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
  }, [query, evidenceId, anchor, state, htmlTick]);

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
      else {
        recordPerson({ id: +pn.dataset.pid, name: pn.textContent || '' });
        onOpenPerson(+pn.dataset.pid);
      }
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
