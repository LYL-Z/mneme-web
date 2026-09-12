/**
 * 一条丝带：全厅可见的本机续读轨迹。
 * 只记公开章题 / 公开路径 / 人名与意象名。私密路径永不入。
 */

import { api, type Chapter, type QueueItem, type Volume } from './api';
import {
  getLastChapter,
  getRecentDocs,
  isPublicPath,
  resumeTarget,
  type LastChapter,
  type RecentDoc,
  type ResumeTarget,
} from './history';

const K_PERSON = 'mneme-last-person';
const K_IMAGERY = 'mneme-last-imagery';
const K_COLLECT = 'mneme-collect-done';
const PRIVATE_NAME = /私人资料|(^|\/)隐私\//;

export interface SilkPerson { id: number; name: string; t: number }
export interface SilkImagery { id: number; name: string; t: number }
export interface PublicChapterHint {
  code: string;
  seq: number;
  title: string;
  volume: string;
  kind?: string;
}
export interface SilkState {
  chapter: LastChapter | null;
  doc: RecentDoc | null;
  person: SilkPerson | null;
  imagery: SilkImagery | null;
  book: string | null;
  resume: ResumeTarget | null;
}

const read = <T>(k: string): T | null => {
  try {
    const s = localStorage.getItem(k);
    return s ? (JSON.parse(s) as T) : null;
  } catch { return null; }
};
const write = (k: string, v: unknown) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 静默降级 */ }
};

export function emitSilk() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('mneme:silk'));
}

export function bookFromVolume(code?: string | null): string | null {
  if (!code) return null;
  const u = code.toUpperCase();
  if (u === 'P0' || u === 'AX' || /^B[1-6]$/.test(u)) return u;
  return null;
}

export function recordPerson(p: { id: number; name: string }) {
  const name = (p.name || '').replace(/\*\*/g, '').trim();
  if (!name || PRIVATE_NAME.test(name)) return;
  write(K_PERSON, { id: p.id, name, t: Date.now() });
  emitSilk();
}

export function recordImagery(p: { id: number; name: string }) {
  const name = (p.name || '').replace(/\*\*/g, '').trim();
  if (!name || PRIVATE_NAME.test(name)) return;
  write(K_IMAGERY, { id: p.id, name, t: Date.now() });
  emitSilk();
}

export const getLastPerson = () => read<SilkPerson>(K_PERSON);
export const getLastImagery = () => read<SilkImagery>(K_IMAGERY);

export function readSilk(): SilkState {
  const chapter = getLastChapter();
  const doc = getRecentDocs()[0] ?? null;
  if (doc && !isPublicPath(doc.path)) {
    return { chapter, doc: null, person: getLastPerson(), imagery: getLastImagery(), book: bookFromVolume(chapter?.code), resume: resumeTarget() };
  }
  return {
    chapter,
    doc,
    person: getLastPerson(),
    imagery: getLastImagery(),
    book: bookFromVolume(chapter?.code),
    resume: resumeTarget(),
  };
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function dateKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todaySalt(d = new Date()): number {
  return hashStr(dateKey(d));
}

/** 日期哈希 ⊕ 上次章号 → 下一道公开章题或间章。无轨迹则序 / 第一部第一章。不占卜。 */
export function nextChapterHint(last: LastChapter | null, catalog: PublicChapterHint[]): PublicChapterHint | null {
  if (!catalog.length) return null;
  if (!last) {
    return catalog.find(c => c.code === 'P0')
      ?? catalog.find(c => c.code === 'B1' && c.seq === 1)
      ?? catalog[0];
  }
  const ix = catalog.findIndex(c => c.code === last.code && c.seq === last.seq);
  if (ix >= 0) return catalog[ix + 1] ?? catalog[0];
  return catalog[(todaySalt() ^ (last.seq >>> 0)) % catalog.length];
}

let catalogCache: Promise<PublicChapterHint[]> | null = null;

export function clearSilkCatalog() {
  catalogCache = null;
}

function flattenChapters(vols: Volume[], details: { code: string; name: string; chapters: Chapter[] }[]): PublicChapterHint[] {
  const byCode = new Map(details.map(d => [d.code, d]));
  const out: PublicChapterHint[] = [];
  for (const v of vols) {
    const d = byCode.get(v.code);
    if (!d) continue;
    for (const c of d.chapters) {
      if (!c.title) continue;
      out.push({ code: v.code, seq: c.seq, title: c.title, volume: v.name, kind: c.kind });
    }
  }
  return out;
}

export function loadPublicCatalog(): Promise<PublicChapterHint[]> {
  if (!catalogCache) {
    catalogCache = api.volumes().then(async vols => {
      const details = await Promise.all(vols.map(async v => {
        const d = await api.volume(v.code);
        return { code: v.code, name: v.name, chapters: d?.chapters ?? [] };
      }));
      return flattenChapters(vols, details);
    }).catch(() => {
      catalogCache = null;
      return [];
    });
  }
  return catalogCache;
}

export function pickTodayCollect(items: QueueItem[]): QueueItem | null {
  const pub = items.filter(i =>
    i.kind === 'pendingCollect' && !i.locked && isPublicPath(i.path) && !PRIVATE_NAME.test(i.path),
  );
  if (!pub.length) return null;
  const done = read<{ day: string; id: number }>(K_COLLECT);
  if (done?.day === dateKey()) return null;
  return pub[todaySalt() % pub.length];
}

export function markCollectDone(id: number) {
  write(K_COLLECT, { day: dateKey(), id });
  emitSilk();
}

export function silkHasPrivate(state: SilkState): boolean {
  if (state.doc && !isPublicPath(state.doc.path)) return true;
  if (state.person && PRIVATE_NAME.test(state.person.name)) return true;
  if (state.imagery && PRIVATE_NAME.test(state.imagery.name)) return true;
  return false;
}
