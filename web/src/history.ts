/**
 * ΜΝΗΜΗ · 阅读轨迹（localStorage，本机记录 · v3.4.2 工作台数据源）
 * 只存公开层路径与标题，不含正文——私密层内容本就进不了前端。
 * localStorage 不可用（隐私模式等）时静默降级：工作台显示空态。
 */

export interface LastChapter { code: string; seq: number; title: string; volume: string; t: number }
export interface RecentDoc { path: string; title: string; domain: string; t: number }

const K_CH = 'mneme-last-chapter';
const K_RECENT = 'mneme-recent-docs';
const RECENT_MAX = 8;

const read = <T>(k: string): T | null => {
  try { const s = localStorage.getItem(k); return s ? (JSON.parse(s) as T) : null; } catch { return null; }
};
const write = (k: string, v: unknown) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 静默降级 */ }
};

/** 打开章节材料链面板时记录（ChapterPanel 成功加载后调用） */
export const recordChapter = (c: Omit<LastChapter, 't'>) =>
  write(K_CH, { ...c, t: Date.now() });

export const getLastChapter = () => read<LastChapter>(K_CH);

/** 打开文档时记录：置顶去重，保留最近 RECENT_MAX 篇（Archive 成功加载后调用） */
export const recordDoc = (d: Omit<RecentDoc, 't'>) => {
  const list = read<RecentDoc[]>(K_RECENT) ?? [];
  const next = [{ ...d, t: Date.now() }, ...list.filter(x => x.path !== d.path)].slice(0, RECENT_MAX);
  write(K_RECENT, next);
};

export const getRecentDocs = () => read<RecentDoc[]>(K_RECENT) ?? [];

/** 私密路径不得作为默认落地：URL 会暴露「这里有一份被隔离的档案」。 */
const PRIVATE_SEG = /私人资料|(^|\/)隐私\//;

export type ResumeTarget =
  | { kind: 'doc'; path: string }
  | { kind: 'chapter'; code: string; seq: number };

/**
 * 根路径 `/` 的续读目标。取「最近一篇公开文档」与「上次章节」中更新的那条。
 * 没有轨迹时返回 null，调用方应落到记忆恒星门厅。
 */
export const resumeTarget = (): ResumeTarget | null => {
  const docs = getRecentDocs();
  const publicDoc = docs.find(d => d.path && !PRIVATE_SEG.test(d.path));
  const ch = getLastChapter();
  const docT = publicDoc?.t ?? 0;
  const chT = ch?.t ?? 0;
  if (!docT && !chT) return null;
  if (ch && chT >= docT) return { kind: 'chapter', code: ch.code, seq: ch.seq };
  if (publicDoc) return { kind: 'doc', path: publicDoc.path };
  return null;
};

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 */
export const timeAgo = (t: number): string => {
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
};
