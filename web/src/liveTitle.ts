/** 标签页 / 读屏跟随当前纸页、人物、意象或章节的真名。路由一变先回到空间名。 */
const BASE = 'ΜΝΗΜΗ';
const HOME = 'ΜΝΗΜΗ · 刘佑林的前半生';

export function formatTitle(part: string | null | undefined): string {
  const t = String(part || '').replace(/\s+/g, ' ').trim();
  return t ? `${t} · ${BASE}` : HOME;
}

export function liveTitle(part: string | null | undefined): void {
  try {
    window.dispatchEvent(new CustomEvent('mneme:live-title', { detail: part ?? null }));
  } catch { /* */ }
}
