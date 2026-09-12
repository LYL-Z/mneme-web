/**
 * ΜΝΗΜΗ · 阅读轨迹（localStorage，本机记录）
 * 只存公开层路径、标题与短摘句，不含正文——私密层进不了前端。
 * localStorage 不可用时静默降级。
 */

export interface LastChapter { code: string; seq: number; title: string; volume: string; t: number }
export interface RecentDoc { path: string; title: string; domain: string; t: number }
export interface DocHighlight {
  id: string;
  path: string;
  title: string;
  heading: string;
  snippet: string;
  t: number;
}

const K_CH = 'mneme-last-chapter';
const K_RECENT = 'mneme-recent-docs';
const K_WEEK = 'mneme-week-opens';
const K_HL = 'mneme-highlights';
const RECENT_MAX = 48;
const WEEK_MAX = 400;
const HL_MAX = 80;

export const PRIVATE_SEG = /私人资料|(^|\/)隐私\//;
export const isPublicPath = (p: string) => !!p && !PRIVATE_SEG.test(p);

const read = <T>(k: string): T | null => {
  try { const s = localStorage.getItem(k); return s ? (JSON.parse(s) as T) : null; } catch { return null; }
};
const write = (k: string, v: unknown) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 静默降级 */ }
};

export const recordChapter = (c: Omit<LastChapter, 't'>) =>
  write(K_CH, { ...c, t: Date.now() });

export const getLastChapter = () => read<LastChapter>(K_CH);

export const recordOpen = (path: string) => {
  if (!isPublicPath(path)) return;
  const now = Date.now();
  const week = now - 7 * 86_400_000;
  const list = (read<{ path: string; t: number }[]>(K_WEEK) ?? []).filter(x => x.t >= week);
  list.push({ path, t: now });
  write(K_WEEK, list.slice(-WEEK_MAX));
};

export const weekOpenStats = () => {
  const week = Date.now() - 7 * 86_400_000;
  const list = (read<{ path: string; t: number }[]>(K_WEEK) ?? []).filter(x => x.t >= week);
  const ch = getLastChapter();
  const docs = new Set(list.map(x => x.path)).size;
  const chThis = ch && ch.t >= week ? 1 : 0;
  return { docs, opens: list.length + chThis, last: list[list.length - 1]?.t ?? ch?.t ?? null };
};

export const recordDoc = (d: Omit<RecentDoc, 't'>) => {
  if (!isPublicPath(d.path)) return;
  const list = read<RecentDoc[]>(K_RECENT) ?? [];
  const next = [{ ...d, t: Date.now() }, ...list.filter(x => x.path !== d.path)].slice(0, RECENT_MAX);
  write(K_RECENT, next);
  recordOpen(d.path);
};

export const getRecentDocs = () => (read<RecentDoc[]>(K_RECENT) ?? []).filter(d => isPublicPath(d.path));

let neighbors: string[] = [];
export const setDocNeighbors = (paths: string[]) => {
  neighbors = [...new Set(paths.filter(isPublicPath))];
};
export const getDocNeighbors = () => neighbors;

export const addHighlight = (h: Omit<DocHighlight, 'id' | 't'>): DocHighlight | null => {
  if (!isPublicPath(h.path)) return null;
  const snippet = h.snippet.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (snippet.length < 2) return null;
  const item: DocHighlight = {
    ...h, snippet,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    t: Date.now(),
  };
  const prev = read<DocHighlight[]>(K_HL) ?? [];
  const next = [item, ...prev.filter(x => !(x.path === item.path && x.snippet === item.snippet))].slice(0, HL_MAX);
  write(K_HL, next);
  return item;
};

export const getHighlights = (path?: string) => {
  const all = (read<DocHighlight[]>(K_HL) ?? []).filter(h => isPublicPath(h.path));
  return path ? all.filter(h => h.path === path) : all;
};

export const removeHighlight = (id: string) => {
  write(K_HL, (read<DocHighlight[]>(K_HL) ?? []).filter(h => h.id !== id));
};

export type ResumeTarget =
  | { kind: 'doc'; path: string }
  | { kind: 'chapter'; code: string; seq: number };

export const resumeTarget = (): ResumeTarget | null => {
  const publicDoc = getRecentDocs()[0];
  const ch = getLastChapter();
  const docT = publicDoc?.t ?? 0;
  const chT = ch?.t ?? 0;
  if (!docT && !chT) return null;
  if (ch && chT >= docT) return { kind: 'chapter', code: ch.code, seq: ch.seq };
  if (publicDoc) return { kind: 'doc', path: publicDoc.path };
  return null;
};

export const timeAgo = (t: number): string => {
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
};
