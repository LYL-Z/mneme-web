import { headingSlug } from './api';

type Head = { id: string; text: string; slug: string; top: number };

const norm = (s: string) => s.replace(/\s+/g, '').replace(/[0-9.、．:#]/g, '');

function collectHeads(el: HTMLElement): Head[] {
  return [...el.querySelectorAll<HTMLElement>('h2, h3, h4')]
    .filter(h => h.id)
    .map(h => {
      const text = (h.textContent || '').replace(/^¶/, '').trim();
      return { id: h.id, text, slug: headingSlug(text), top: h.offsetTop };
    });
}

function matchHead(from: Head, others: Head[]): Head | null {
  const exact = others.find(h => h.id === from.id || h.slug === from.slug);
  if (exact) return exact;
  const a = norm(from.text);
  if (a.length < 2) return null;
  return others.find(h => {
    const b = norm(h.text);
    return b.includes(a) || a.includes(b);
  }) ?? null;
}

function activeHead(el: HTMLElement, heads: Head[]): Head | null {
  if (!heads.length) return null;
  const y = el.scrollTop + 56;
  let cur = heads[0];
  for (const h of heads) {
    if (h.top <= y) cur = h;
    else break;
  }
  return cur;
}

const ratioOf = (el: HTMLElement) => {
  const max = el.scrollHeight - el.clientHeight;
  return max <= 0 ? 0 : el.scrollTop / max;
};

/**
 * 双栏同步滚：优先按标题 id / slug / 标题文本对齐（章节设计 ⇄ 原文），
 * 对不上再退回阅读比例。
 */
export function bindSyncScroll(a: HTMLElement, b: HTMLElement): () => void {
  let lock = 0;
  const follow = (from: HTMLElement, to: HTMLElement) => {
    if (lock) return;
    lock = 1;
    const fromH = collectHeads(from);
    const toH = collectHeads(to);
    const cur = activeHead(from, fromH);
    const pair = cur ? matchHead(cur, toH) : null;
    if (cur && pair) {
      const max = to.scrollHeight - to.clientHeight;
      const next = pair.top + (from.scrollTop - cur.top);
      to.scrollTop = Math.max(0, Math.min(Math.max(0, max), next));
    } else {
      const max = to.scrollHeight - to.clientHeight;
      to.scrollTop = ratioOf(from) * Math.max(0, max);
    }
    requestAnimationFrame(() => { lock = 0; });
  };
  let rafA = 0;
  let rafB = 0;
  const onA = () => {
    if (rafA) return;
    rafA = requestAnimationFrame(() => { rafA = 0; follow(a, b); });
  };
  const onB = () => {
    if (rafB) return;
    rafB = requestAnimationFrame(() => { rafB = 0; follow(b, a); });
  };
  a.addEventListener('scroll', onA, { passive: true });
  b.addEventListener('scroll', onB, { passive: true });
  return () => {
    a.removeEventListener('scroll', onA);
    b.removeEventListener('scroll', onB);
    cancelAnimationFrame(rafA);
    cancelAnimationFrame(rafB);
  };
}
