/**
 * 写作台本机草稿。只存公开层路径，刷新不丢；离场时清掉。
 * 绝不写入 `私人资料/` 或隐私目录。
 */

import { isPublicPath } from './history';

const PREFIX = 'mneme-draft:';
const MAX = 400_000;

export interface LocalDraft { text: string; t: number }

export function loadDraft(path: string): LocalDraft | null {
  if (!isPublicPath(path)) return null;
  try {
    const raw = localStorage.getItem(PREFIX + path);
    if (!raw) return null;
    const o = JSON.parse(raw) as LocalDraft;
    if (!o || typeof o.text !== 'string' || o.text.length > MAX) return null;
    return o;
  } catch { return null; }
}

export function saveDraft(path: string, text: string) {
  if (!isPublicPath(path)) return;
  if (text.length > MAX) return;
  try { localStorage.setItem(PREFIX + path, JSON.stringify({ text, t: Date.now() })); }
  catch { /* 配额或隐私模式 */ }
}

export function clearDraft(path: string) {
  try { localStorage.removeItem(PREFIX + path); } catch { /* */ }
}

export function purgePublicDrafts() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
  } catch { /* */ }
}
