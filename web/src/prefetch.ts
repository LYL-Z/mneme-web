import type { SpaceKey } from './route';
import { getRecentDocs } from './history';

/** Linear 风：悬停 / 空闲时预热懒加载块。失败忽略，不影响阅读。 */
const loaders: Partial<Record<SpaceKey | 'chapter' | 'foreshadow', () => Promise<unknown>>> = {
  archive: () => import('./space/Archive'),
  river: () => import('./space/River'),
  graph: () => import('./space/Graph'),
  study: () => import('./space/Study'),
  museum: () => import('./space/Museum'),
  voices: () => import('./space/Voices'),
  themes: () => import('./space/Themes'),
  lighthouse: () => import('./space/Lighthouse'),
  chapter: () => import('./space/ChapterPanel'),
  foreshadow: () => import('./space/Foreshadow'),
};

const warmed = new Set<string>();

export function prefetchSpace(key: SpaceKey | 'chapter' | 'foreshadow'): void {
  if (warmed.has(key)) return;
  const load = loaders[key];
  if (!load) return;
  warmed.add(key);
  void load();
}

/** 预热一篇公开原文（内存 SWR，不进 SW）。私密路径直接跳过。 */
export function prefetchDoc(path: string): void {
  if (!path || /私人资料|(^|\/)隐私\//.test(path)) return;
  try {
    const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (c?.saveData) return;
    if (c?.effectiveType === 'slow-2g' || c?.effectiveType === '2g') return;
  } catch { /* 无 Network Information */ }
  void import('./api').then(({ api }) => { void api.doc(path); });
}

/** 入馆后预热最常走的阅读链：原文 → 书房 → 河。 */
export function prefetchWorkbench(): void {
  try {
    if (document.documentElement.dataset.shell === 'phone' || matchMedia('(max-width: 720px)').matches) {
      window.setTimeout(() => prefetchSpace('archive'), 1400);
      return;
    }
    const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (c?.saveData) return;
    if (c?.effectiveType === 'slow-2g' || c?.effectiveType === '2g') return;
  } catch { /* 无 Network Information */ }
  window.setTimeout(() => {
    prefetchSpace('archive');
    prefetchSpace('study');
    prefetchSpace('chapter');
    void import('./api').then(({ api }) => { void api.volumes(); void api.questionnaires(); });
    getRecentDocs().slice(0, 2).forEach(d => prefetchDoc(d.path));
  }, 800);
}
