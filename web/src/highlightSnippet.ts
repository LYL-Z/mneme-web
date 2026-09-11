/**
 * 在已消毒的正文里标出证据片段。按去空白子串匹配，避免 markdown 折行把原文拆开。
 * 不修改除 mark 以外的 DOM 结构。
 */

import { evidenceLabel } from './evidenceKind';

const snippets = new Map<number, string>();
export const rememberEvidence = (id: number, snippet: string) => { snippets.set(id, snippet); };
export const recalledEvidence = (id: number) => snippets.get(id);

const compact = (s: string) => s.replace(/\s+/g, '');

const KIND_PRI: Record<string, number> = {
  conflict: 0,
  pending: 1,
  pendingCollect: 2,
  inferred: 3,
  literary: 4,
  perspective: 5,
  retrospect: 6,
  confirmed: 7,
};

export interface EvidenceSpan {
  id: number;
  kind: string;
  snippet: string;
}

function indexLoose(hay: string, needle: string, min = 4): { start: number; end: number } | null {
  const n = compact(needle).slice(0, 48);
  if (n.length < min) return null;
  let packed = '';
  const map: number[] = [];
  for (let i = 0; i < hay.length; i++) {
    if (/\s/.test(hay[i])) continue;
    map.push(i);
    packed += hay[i];
  }
  const at = packed.indexOf(n);
  if (at < 0) return null;
  const last = Math.min(at + n.length, map.length) - 1;
  if (last < at) return null;
  return { start: map[at], end: map[last] + 1 };
}

function wrapRange(node: Text, start: number, end: number, span?: Pick<EvidenceSpan, 'id' | 'kind'>): HTMLElement {
  const text = node.textContent || '';
  const mark = document.createElement('mark');
  mark.className = span?.kind ? `ev-hl ev-kind-${span.kind}` : 'ev-hl';
  mark.textContent = text.slice(start, end);
  if (span) {
    mark.dataset.evId = String(span.id);
    mark.dataset.kind = span.kind;
    mark.dataset.label = evidenceLabel(span.kind).name;
    mark.title = evidenceLabel(span.kind).desc;
  }
  const rest = document.createTextNode(text.slice(end));
  node.textContent = text.slice(0, start);
  node.after(mark, rest);
  return mark;
}

const textFilter: NodeFilter = {
  acceptNode(n) {
    const p = (n.parentElement as HTMLElement | null);
    if (!n.textContent?.trim()) return NodeFilter.FILTER_REJECT;
    if (p?.closest('script, style, button, .h-copy, mark.ev-hl, mark.q-hl')) return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  },
};

function wrapFirst(root: HTMLElement, raw: string, span?: Pick<EvidenceSpan, 'id' | 'kind'>): HTMLElement | null {
  const needle = (raw || '').replace(/\s+/g, ' ').trim();
  if (needle.length < 4) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, textFilter);
  let node = walker.nextNode() as Text | null;
  while (node) {
    const hit = indexLoose(node.textContent || '', needle);
    if (hit) return wrapRange(node, hit.start, hit.end, span);
    node = walker.nextNode() as Text | null;
  }
  return null;
}

function wrapBlock(root: HTMLElement, raw: string): HTMLElement | null {
  const needle = (raw || '').replace(/\s+/g, ' ').trim();
  if (needle.length < 4) return null;
  const hit = indexLoose(root.innerText || '', needle);
  if (!hit) return null;
  const block = [...root.querySelectorAll('p, li, td, blockquote, h1, h2, h3, h4')]
    .find(el => !!indexLoose(el.textContent || '', needle)) as HTMLElement | undefined;
  if (!block) return null;
  block.classList.add('ev-hl-block');
  return block;
}

export function clearEvidenceMarks(root: HTMLElement) {
  root.querySelectorAll('mark.ev-hl').forEach(m => {
    const p = m.parentNode;
    if (!p) return;
    p.replaceChild(document.createTextNode(m.textContent || ''), m);
    p.normalize();
  });
  root.querySelectorAll('.ev-hl-block').forEach(el => el.classList.remove('ev-hl-block', 'anchor-flash'));
}

export function clearEvidenceFocus(root: HTMLElement) {
  root.querySelectorAll('mark.ev-hl.on').forEach(m => m.classList.remove('on', 'anchor-flash'));
  root.querySelectorAll('.ev-hl-block.anchor-flash').forEach(el => el.classList.remove('anchor-flash'));
}

const PAINT_CAP = 48;

/** 把本篇证据片段全部画进正文（冲突 / 待核优先）。条数不是可信度。 */
export function paintEvidenceSpans(root: HTMLElement, spans: EvidenceSpan[]): number {
  clearEvidenceMarks(root);
  const sorted = [...spans].sort((a, b) => {
    const pa = KIND_PRI[a.kind] ?? 9;
    const pb = KIND_PRI[b.kind] ?? 9;
    if (pa !== pb) return pa - pb;
    return (b.snippet?.length ?? 0) - (a.snippet?.length ?? 0);
  });
  let n = 0;
  for (const s of sorted) {
    if (n >= PAINT_CAP) break;
    if (!s.snippet) continue;
    const el = wrapFirst(root, s.snippet, { id: s.id, kind: s.kind });
    if (el) {
      el.dataset.heading = nearestHeading(el, root);
      el.dataset.para = nearestPara(el);
      n += 1;
    }
  }
  return n;
}

function nearestHeading(el: HTMLElement, root: HTMLElement): string {
  let n: HTMLElement | null = el;
  while (n && n !== root) {
    let sib: Element | null = n;
    while (sib) {
      if (/^H[1-4]$/.test(sib.tagName)) {
        return (sib.textContent || '').replace(/^¶/, '').trim();
      }
      sib = sib.previousElementSibling;
    }
    n = n.parentElement;
  }
  return '';
}

function nearestPara(el: HTMLElement): string {
  const block = el.closest('p, li, td, blockquote, h1, h2, h3, h4') as HTMLElement | null;
  const t = (block?.textContent || el.textContent || '').replace(/^¶/, '').replace(/\s+/g, ' ').trim();
  return t.slice(0, 96);
}

export function evidenceLocus(root: HTMLElement, id: number): { heading: string; para: string } | null {
  const mark = root.querySelector(`mark.ev-hl[data-ev-id="${id}"]`) as HTMLElement | null;
  if (!mark) return null;
  const heading = mark.dataset.heading || '';
  const para = mark.dataset.para || '';
  if (!heading && !para) return null;
  return { heading, para };
}

/** 聚焦一条证据：优先已有 mark，否则临时包裹或整块描边。 */
export function focusEvidence(root: HTMLElement, opts: { id?: number; snippet?: string }): HTMLElement | null {
  clearEvidenceFocus(root);
  if (opts.id != null) {
    const mark = root.querySelector(`mark.ev-hl[data-ev-id="${opts.id}"]`) as HTMLElement | null;
    if (mark) {
      mark.classList.add('on', 'anchor-flash');
      return mark;
    }
  }
  if (opts.snippet) {
    const mark = wrapFirst(root, opts.snippet, opts.id != null ? { id: opts.id, kind: 'pending' } : undefined);
    if (mark) {
      mark.classList.add('on', 'anchor-flash');
      return mark;
    }
    const block = wrapBlock(root, opts.snippet);
    if (block) {
      block.classList.add('anchor-flash');
      return block;
    }
  }
  return null;
}

/** 兼容旧调用：清掉焦点后按片段高亮一处。 */
export function highlightSnippet(root: HTMLElement, raw: string): HTMLElement | null {
  return focusEvidence(root, { snippet: raw });
}

const QUERY_CAP = 32;

export function clearQueryMarks(root: HTMLElement) {
  root.querySelectorAll('mark.q-hl').forEach(m => {
    const p = m.parentNode;
    if (!p) return;
    p.replaceChild(document.createTextNode(m.textContent || ''), m);
    p.normalize();
  });
}

const queryFilter: NodeFilter = {
  acceptNode(n) {
    const p = (n.parentElement as HTMLElement | null);
    if (!n.textContent?.trim()) return NodeFilter.FILTER_REJECT;
    /* 允许落在证据标内部：检索词与证据标可以叠色，互不拆除。 */
    if (p?.closest('script, style, button, .h-copy, mark.q-hl')) return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  },
};

/** 检索词在正文中的全部落点（与证据标并存）。短词按 2 字起配。 */
export function highlightQuery(root: HTMLElement, raw: string): HTMLElement | null {
  clearQueryMarks(root);
  const needle = (raw || '').replace(/\s+/g, ' ').trim();
  if (compact(needle).length < 2) return null;
  let first: HTMLElement | null = null;
  for (let i = 0; i < QUERY_CAP; i++) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, queryFilter);
    let node = walker.nextNode() as Text | null;
    let hit: { start: number; end: number } | null = null;
    let target: Text | null = null;
    while (node) {
      hit = indexLoose(node.textContent || '', needle, 2);
      if (hit) { target = node; break; }
      node = walker.nextNode() as Text | null;
    }
    if (!target || !hit) break;
    const mark = document.createElement('mark');
    mark.className = 'q-hl';
    const text = target.textContent || '';
    mark.textContent = text.slice(hit.start, hit.end);
    const rest = document.createTextNode(text.slice(hit.end));
    target.textContent = text.slice(0, hit.start);
    target.after(mark, rest);
    if (!first) {
      first = mark;
      mark.classList.add('on');
    }
  }
  return first;
}
