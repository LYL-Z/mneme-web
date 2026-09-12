import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/** 一次会话只自动刷新一次，避免坏分包死循环。 */
const RELOAD_KEY = 'mneme-chunk-reload';

function isStaleChunk(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk/i.test(msg);
}

function reloadOnce(): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_KEY) === '1') return false;
    sessionStorage.setItem(RELOAD_KEY, '1');
  } catch { /* 隐私模式：不自动刷，交给错误边界 */ return false; }
  location.reload();
  return true;
}

/** 路由分包过期时自动刷新一次（发版后旧 HTML 仍指向旧 hash）。 */
export function lazySpace<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() => load().catch(err => {
    if (isStaleChunk(err) && reloadOnce()) return new Promise<never>(() => {});
    throw err;
  }));
}

export { isStaleChunk, reloadOnce };
