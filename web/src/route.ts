/**
 * History API 路由。旧书签 `#/doc/…` 在首次进入时改写为 `/doc/…`。
 * 文档路径整段 encode，避免斜杠被当成多级目录。
 */

export const SPACE_KEYS = [
  'archive', 'stars', 'graph', 'river', 'themes', 'voices', 'study', 'museum', 'lighthouse',
] as const;
export type SpaceKey = (typeof SPACE_KEYS)[number];

/** 时间之河可分享筛选。刷新、后退、外发链接共用。 */
export type RiverQuery = { stage?: string; kind?: string; y?: number };

/** 灯塔工作队列筛选。刷新、后退、外发链接共用。 */
export type LighthouseTab = 'all' | 'conflict' | 'pending' | 'pendingCollect';

const LH_TABS = new Set<string>(['all', 'conflict', 'pending', 'pendingCollect']);

export const parseLhTab = (search: string): LighthouseTab | undefined => {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const tab = q.get('tab');
  if (tab && LH_TABS.has(tab) && tab !== 'all') return tab as LighthouseTab;
  return undefined;
};

export const lhQueryString = (tab?: LighthouseTab) => {
  if (!tab || tab === 'all') return '';
  return `?tab=${tab}`;
};

export const parseRiverQuery = (search: string): RiverQuery | undefined => {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const p: RiverQuery = {};
  const stage = q.get('stage');
  const kind = q.get('kind');
  const y = q.get('y');
  if (stage && stage !== '全部') p.stage = stage;
  if (kind === 'anchor' || kind === 'background') p.kind = kind;
  if (y && /^\d{4}$/.test(y)) p.y = +y;
  return (p.stage || p.kind || p.y != null) ? p : undefined;
};

export const riverQueryString = (p?: RiverQuery) => {
  if (!p) return '';
  const q = new URLSearchParams();
  if (p.stage) q.set('stage', p.stage);
  if (p.kind) q.set('kind', p.kind);
  if (p.y != null) q.set('y', String(p.y));
  const s = q.toString();
  return s ? `?${s}` : '';
};

export type Route =
  | { v: 'space'; key: SpaceKey; river?: RiverQuery; lh?: LighthouseTab }
  | { v: 'doc'; path: string; h?: string; ev?: number; q?: string }
  | { v: 'person'; id: number }
  | { v: 'imagery'; id: number }
  | { v: 'volume'; code: string }
  | { v: 'foreshadow' }
  | { v: 'chapter'; code: string; seq: number };

export const routeId = (r: Route) =>
  r.v === 'space' ? `space:${r.key}${r.key === 'river' ? riverQueryString(r.river) : r.key === 'lighthouse' ? lhQueryString(r.lh) : ''}`
  : r.v === 'doc' ? `doc:${r.path}${r.h ? `#${r.h}` : ''}${r.ev != null ? `~${r.ev}` : ''}${r.q ? `?${r.q}` : ''}`
  : r.v === 'person' ? `person:${r.id}`
  : r.v === 'imagery' ? `imagery:${r.id}`
  : r.v === 'volume' ? `volume:${r.code}`
  : r.v === 'foreshadow' ? 'foreshadow'
  : `chapter:${r.code}:${r.seq}`;

const isSpace = (s: string): s is SpaceKey =>
  (SPACE_KEYS as readonly string[]).includes(s);

const parseDocQuery = (search: string): { h?: string; ev?: number; q?: string } => {
  const qs = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const h = qs.get('h') || undefined;
  const evRaw = qs.get('ev');
  const ev = evRaw && /^\d+$/.test(evRaw) ? +evRaw : undefined;
  const qRaw = qs.get('q') || undefined;
  const q = qRaw ? qRaw.slice(0, 48) : undefined;
  return { h, ev, q };
};

const parseHashBody = (raw: string): Route | null => {
  const h = raw.replace(/^#\/?/, '');
  if (!h) return null;
  const qi = h.indexOf('?');
  const body = qi >= 0 ? h.slice(0, qi) : h;
  const search = qi >= 0 ? h.slice(qi) : '';
  const [head, ...rest] = body.split('/');
  const tail = rest.join('/');
  if (head === 'doc' && tail) {
    const qh = tail.indexOf('?h=');
    const path = decodeURIComponent(qh >= 0 ? tail.slice(0, qh) : tail);
    const { h: ha, ev, q } = parseDocQuery(qh >= 0 ? tail.slice(qh) : search);
    return { v: 'doc', path, h: ha, ev, q };
  }
  if (head === 'person' && /^\d+$/.test(tail)) return { v: 'person', id: +tail };
  if (head === 'imagery' && /^\d+$/.test(tail)) return { v: 'imagery', id: +tail };
  if (head === 'volume' && tail) return { v: 'volume', code: tail.toUpperCase() };
  const cm = tail.match(/^([A-Za-z0-9]+)\/(\d+)$/);
  if (head === 'chapter' && cm) return { v: 'chapter', code: cm[1].toUpperCase(), seq: +cm[2] };
  if (head === 'foreshadow') return { v: 'foreshadow' };
  if (head === 'space' && isSpace(tail)) return { v: 'space', key: tail };
  return null;
};

export const parseLocation = (): Route => {
  const hashed = parseHashBody(location.hash);
  if (hashed) return hashed;
  const segs = location.pathname.replace(/^\/+/, '').split('/');
  const head = segs[0] || '';
  const tail = segs.slice(1).join('/');
  if (head === 'doc' && tail) {
    const { h, ev, q } = parseDocQuery(location.search);
    return { v: 'doc', path: decodeURIComponent(tail), h, ev, q };
  }
  if (head === 'person' && /^\d+$/.test(tail)) return { v: 'person', id: +tail };
  if (head === 'imagery' && /^\d+$/.test(tail)) return { v: 'imagery', id: +tail };
  if (head === 'volume' && tail) return { v: 'volume', code: tail.toUpperCase() };
  if (head === 'chapter' && segs[1] && /^\d+$/.test(segs[2] || '')) {
    return { v: 'chapter', code: segs[1].toUpperCase(), seq: +segs[2] };
  }
  if (head === 'foreshadow') return { v: 'foreshadow' };
  if (head === 'space' && isSpace(tail)) {
    if (tail === 'river') {
      const river = parseRiverQuery(location.search);
      return river ? { v: 'space', key: 'river', river } : { v: 'space', key: 'river' };
    }
    if (tail === 'lighthouse') {
      const lh = parseLhTab(location.search);
      return lh ? { v: 'space', key: 'lighthouse', lh } : { v: 'space', key: 'lighthouse' };
    }
    return { v: 'space', key: tail };
  }
  return { v: 'space', key: 'stars' };
};

export const routeToPath = (r: Route) => {
  if (r.v === 'space') {
    if (r.key === 'river') return `/space/river${riverQueryString(r.river)}`;
    if (r.key === 'lighthouse') return `/space/lighthouse${lhQueryString(r.lh)}`;
    return `/space/${r.key}`;
  }
  if (r.v === 'doc') {
    const q = new URLSearchParams();
    if (r.h) q.set('h', r.h);
    if (r.ev != null) q.set('ev', String(r.ev));
    if (r.q) q.set('q', r.q.slice(0, 48));
    const qs = q.toString();
    return `/doc/${encodeURIComponent(r.path)}${qs ? `?${qs}` : ''}`;
  }
  if (r.v === 'person') return `/person/${r.id}`;
  if (r.v === 'imagery') return `/imagery/${r.id}`;
  if (r.v === 'chapter') return `/chapter/${r.code}/${r.seq}`;
  if (r.v === 'foreshadow') return '/foreshadow';
  return `/volume/${r.code}`;
};

/** 把遗留 hash 书签改成路径，不新增历史条目。 */
export const migrateHashIfNeeded = () => {
  const hashed = parseHashBody(location.hash);
  if (!hashed) return;
  const next = routeToPath(hashed);
  history.replaceState(null, '', next);
};
