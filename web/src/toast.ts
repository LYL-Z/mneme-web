/**
 * ΜΝΗΜΗ · 全局轻提示（toast）状态
 *
 * 为什么需要：全站原有 26 处静默 `catch {}`——接口失败时页面只是「空着」，
 * 用户无从判断是「没有内容」还是「加载失败」。现在统一走 notify()。
 *
 * 用法：import { notify } from '../toast'; notify('加载失败，请稍后重试', 'error');
 */
export type ToastKind = 'info' | 'warn' | 'error';

export interface ToastItem {
  id: number;
  msg: string;
  kind: ToastKind;
}

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<Listener>();

/** 同一条消息在 1.5s 内重复出现时只保留一条，避免并发请求刷屏 */
const recent = new Map<string, number>();

export function notify(msg: string, kind: ToastKind = 'info'): void {
  const text = String(msg || '').trim();
  if (!text) return;
  const now = Date.now();
  if ((recent.get(text) ?? 0) > now - 1500) return;
  recent.set(text, now);

  const item: ToastItem = { id: ++seq, msg: text, kind };
  items = [...items, item].slice(-3);
  listeners.forEach(l => l(items));
  const ttl = kind === 'error' ? 6000 : kind === 'warn' ? 4500 : 3200;
  setTimeout(() => dismiss(item.id), ttl);
}

export function dismiss(id: number): void {
  items = items.filter(x => x.id !== id);
  listeners.forEach(l => l(items));
}

export function subscribeToasts(l: Listener): () => void {
  listeners.add(l);
  l(items);
  return () => { listeners.delete(l); };
}
