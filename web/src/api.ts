/**
 * ΜΝΗΜΗ · API 客户端（同源 /api；口令 cookie 由网关注入，前端无需感知）
 */

/** audit_runs 最新一条（ETL 汇报），Σ9 灯塔引用 */
export interface AuditInfo {
  started_at: string; finished_at: string | null;
  scanned: number; ingested: number;
  excluded_private: number; excluded_system: number; masked: number;
  manifest: Record<string, unknown>;
}

export interface Overview {
  docs: number; entities: number; edges: number; stardust: number;
  anchors: number; questionnaires: number; imagery: number; chapters: number; samples: number;
  secretDocs?: number; // 私密层份数（is_private=1；加密门禁保护，未解锁不可读）
  surveyTotal?: number; // v4 · A5 问卷累计回收（服务端核账口径，前端不再硬编码）
  latest: { path: string; title: string; mtime: number } | null;
  evidence: { kind: string; n: number }[];
  volumes: Volume[];
  audit: AuditInfo | null;
  years: { year: number; docs: number }[];
  domains: { domain: string; n: number }[];
}

export interface Volume {
  code: string; name: string; years: string; line_metaphor: string; mood: string;
  word_target: string; color_token: string; chapters: number; docs: number; seq: number;
}

export interface TimelineEvent {
  id: number; year: number; month: number | null; exact_date: string | null;
  stage: string; volume: string | null; kind: string; title: string;
  ref_title: string | null; detail: string | null; ref?: string | null;
  locked?: boolean;
}

export interface Entity {
  id: number; std_id?: string; display_name: string; relation_group: string;
  stage: string | null; mention_count: number; first_year: number | null; last_year: number | null;
  locked?: boolean;
}

/** /api/graph 返回的节点（后端 SELECT 已别名字段） */
export interface GraphNode {
  id: number; name: string; grp: string; stage: string | null; mention: number;
  doc?: string; first_year: number | null; last_year: number | null;
  locked?: boolean;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: [number, number, number][];
  stardust: string[];
  legend: { edge: string; stardust: string };
}

export interface DocFull {
  id: number; path: string; title: string; domain: string; doc_type: string;
  stage: string; volume: string | null; body: string; mtime: number;
  meta: Record<string, unknown>;
  backlinks: { path: string; title: string; domain: string; locked?: boolean }[];
  persons: { id: number; display_name: string; relation_group: string; mention_count: number; locked?: boolean }[];
  evidence: { kind: string; n: number }[];
  evSnippets: { id: number; kind: string; snippet: string }[];
  /* v8 · 3.3 五向互链：本文档登记的时间线事件 + 正文出现过的意象 */
  timeline?: { id: number; year: number; month: number | null; title: string; kind: string }[];
  imagery?: { id: number; name: string; occ: number }[];
}

export interface EntityDetail extends Entity {
  aliases: string[]; role_doc_path: string;
  mentionDocs: { id: number; path: string; title: string; domain: string; stage: string; mtime: number; hits: number; locked?: boolean }[];
  related: { id: number; display_name: string; relation_group: string; mention_count: number; co: number; locked?: boolean }[];
  evidence: { kind: string; snippet: string }[];
  selfBodyChars: number;
}

export interface SearchGroups {
  doc?: { path: string; title: string; domain: string; stage: string; sn?: string; snippet?: string; locked?: boolean }[];
  person?: { id: number; display_name: string; relation_group: string; stage: string; mention_count: number; locked?: boolean }[];
  timeline?: { id: number; year: number; month: number | null; stage: string; kind: string; title: string; locked?: boolean }[];
  imagery?: { id: number; name: string; candidate: number; occ: number; locked?: boolean }[];
  volume?: { code: string; title: string; typ: string; doc_path?: string; seq?: number; is_sample?: number; locked?: boolean }[];
  questionnaire?: { id: number; respondent_label?: string; doc_path?: string; locked?: boolean }[];
}

export class NotFoundError extends Error {}

/** v3.2 · 带状态码的 API 错误：404=未收录/隔离；0=网络故障；其余=服务端异常 */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** v4 · B3 请求层升级：15s 超时自动中止（防挂起请求）；SWR 缓存 opt-in（低频变化数据秒开） */
const swrCache = new Map<string, { t: number; data: unknown }>();
const SWR_TTL = 60_000;
/** 绝密解锁后必须丢掉锁定态快照，否则 overview/graph 最多再藏 60 秒 */
export function swrInvalidate(): void { swrCache.clear(); }
export function swr<T>(url: string): Promise<T> {
  const hit = swrCache.get(url);
  if (hit && Date.now() - hit.t < SWR_TTL) return Promise.resolve(hit.data as T);
  const p = j<T>(url).then(data => { swrCache.set(url, { t: Date.now(), data }); return data; });
  if (hit) return p.catch(() => hit.data as T); // 刷新失败时保留旧值
  return p;
}

export interface AdminStatus {
  admin: boolean;
  vault: boolean;
  ai: boolean;
  sync?: { watching: boolean; vault?: boolean; last?: { t: string; reason: string; code: number | null } | null; pending?: boolean };
}
export interface SourceDoc {
  path: string; text: string; mtime: string | number | null;
  sha256: string | null; writable: boolean; title: string;
}

/** 文档/实体允许 404。公开正文另可由 SW 按响应头缓存；私密/绝密不进 SW。 */
export function swr404<T>(url: string): Promise<T | null> {
  const hit = swrCache.get(url);
  if (hit && Date.now() - hit.t < SWR_TTL) return Promise.resolve(hit.data as T | null);
  const p = j404<T>(url).then(data => { swrCache.set(url, { t: Date.now(), data }); return data; });
  if (hit) return p.catch(() => hit.data as T | null);
  return p;
}

async function j<T>(url: string): Promise<T> {
  let r: Response;
  try { r = await fetch(url, { signal: AbortSignal.timeout(15_000) }); }
  catch (e) { throw new ApiError(0, `网络异常 ${url}${(e as Error)?.name === 'TimeoutError' ? '（超时）' : ''}`); }
  if (r.status === 401) return handle401(url);
  if (!r.ok) throw new ApiError(r.status, `${r.status} ${url}`);
  return r.json() as Promise<T>;
}

/** 文档/实体可能合法地 404（含私密隔离），调用方按需捕获 */
async function j404<T>(url: string): Promise<T | null> {
  let r: Response;
  /* v8 修复：原实现没有超时，挂起请求会永久占住加载态 */
  try { r = await fetch(url, { signal: AbortSignal.timeout(15_000) }); }
  catch (e) { throw new ApiError(0, `网络异常 ${url}${(e as Error)?.name === 'TimeoutError' ? '（超时）' : ''}`); }
  if (r.status === 404) return null;
  if (r.status === 401) return handle401(url);
  if (!r.ok) throw new ApiError(r.status, `${r.status} ${url}`);
  return r.json() as Promise<T>;
}

/** 口令失效：回登录页。
 *  v8 修复：原实现每个 401 都直接 location.reload()，首屏并发请求会触发「重载风暴」；
 *  现在用模块级闸门保证只重载一次。 */
let reloading = false;
function handle401(url: string): never {
  if (!reloading) {
    reloading = true;
    setTimeout(() => location.reload(), 60);
  }
  throw new ApiError(401, `unauthorized ${url}`);
}

/** 把异常翻译成一句给人看的提示（供全局 toast 使用；403 交由绝密门自行处理，返回空串） */
export function apiErrorMessage(e: unknown): string {
  const status = (e as ApiError)?.status;
  if (status === 0) return '网络异常，请稍后重试';
  if (status === 401) return '访问口令已失效，正在返回登录页…';
  if (status === 403) return '';
  if (status === 404) return '此内容未收录';
  if (status === 429) return '尝试过于频繁，请稍后再试';
  if (typeof status === 'number' && status >= 500) return '服务端异常，请稍后重试';
  return '加载失败，请稍后重试';
}

export interface Chapter {
  volume_code: string; seq: number; title: string; est_chapters: number | null;
  est_words: string | null; doc_path: string | null; status: string | null; is_sample: number;
}

export type VolumeDetail = Omit<Volume, 'chapters'> & {
  chapters: Chapter[];
  docs: { path: string; title: string; doc_type: string; mtime: number }[];
  pendingCollect: number;
  foreshadow: { kind: string; n: number }[];
  /* v3.1 书房内容化 */
  topPersons: { id: number; display_name: string; relation_group: string; hits: number }[];
  topImagery: { id: number; name: string; occ: number }[];
  words: number;
  chapterStats: { s: string; n: number }[];
};

/* v3.4 · P3 章节材料链 */
export interface ChapterPending { kind: string; text: string }
export interface ChapterDetail {
  chapter: { code: string; seq: number; title: string; status: string | null; is_sample: number; est_chapters: number | null; est_words: string | null };
  volume: { code: string; name: string; years: string; line_metaphor: string; mood: string; color_token: string; word_target: string };
  outline: { path: string; title: string; anchor: string | null; excerpt: string | null } | null;
  body: { path: string; title: string } | null;
  volumeSamples: { seq: number; title: string; doc_path: string }[];
  drafts: { path: string; title: string }[];
  ledgers: { path: string; title: string; role: string }[];
  pending: ChapterPending[];
  volumePending: ChapterPending[];
  imagery: { id: number; name: string; occ: number }[];
}

/** 标题锚点 slug（Archive 渲染器与章节面板共用，保证两侧 id 一致） */
export const headingSlug = (text: string) =>
  text.trim().replace(/\s+/g, '-').slice(0, 48) || 'section';

export interface ImageryItem { id: number; name: string; seq: number; candidate: number; occ: number; locked?: boolean }

export interface ImageryOcc {
  imagery_id: number; doc_id: string; volume_code: string | null;
  scene: string | null; old_meaning: string | null; new_meaning: string | null;
  source_note: string | null; seq: number;
}

export interface Questionnaire {
  id: number; round?: string; respondent_label: string; relation_label: string | null;
  doc_path: string; answers: { n: string; q: string; a: string }[]; locked?: boolean;
}

export interface Foreshadow { id: number; level: string; material: string; plant: string; harvest: string; method: string; status: string }

export interface DomainStat { domain: string; n: number; hs: number; uni: number }

export interface QueueItem {
  id: number;
  kind: string;
  snippet: string;
  path: string;
  title: string;
  volume: string | null;
  domain: string;
  stage: string | null;
  locked?: boolean;
}

export interface DomainDocs {
  domain: string; total: number;
  docs: { id: number; path: string; title: string; doc_type: string; stage: string; volume: string | null; mtime: number; locked?: boolean }[];
  /* v3.1 主题域内容化 */
  topPersons: { id: number; display_name: string; relation_group: string; hits: number; locked?: boolean }[];
}

export interface ImageryOne extends ImageryItem {
  occurrences: ImageryOcc[];
  /* v3.1 博物馆内容化 */
  ledgerPath: string | null;
  relatedImagery: { id: number; name: string; co: number; locked?: boolean }[];
}

export const api = {
  overview: () => swr<Overview>('/api/overview'),
  /* v4 · C4 伏应矩阵 */
  foreshadow: () => j<{ rows: Foreshadow[] }>('/api/foreshadow').then(r => r.rows),
  unlock: (password: string) =>
    fetch('/api/secret/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    }).then(async r => {
      if (r.ok) return true;
      if (r.status === 403) return false;
      throw new ApiError(r.status, 'unlock failed');
    }),
  secretStatus: () => j<{ unlocked: boolean }>('/api/secret/status').catch(() => ({ unlocked: false })),
  timeline: (from?: number, to?: number) =>
    j<TimelineEvent[]>(`/api/timeline?from=${from ?? 2000}&to=${to ?? 2030}`),
  entities: (limit = 400) => j<Entity[]>(`/api/entities?limit=${limit}`),
  graph: () => swr<GraphData>('/api/graph'),
  yearDensity: () => j<{ year: number; docs: number }[]>('/api/year-density'),
  entity: (id: number) => swr404<EntityDetail>(`/api/entities/${id}`),
  doc: (path: string) => swr404<DocFull>(`/api/doc/${encodeURI(path)}`),
  search: (q: string) => j<{ groups: SearchGroups; terms: string[] }>(
    `/api/search?q=${encodeURIComponent(q)}`),
  volumes: () => swr<Volume[]>('/api/volumes'),
  volume: (code: string) => swr404<VolumeDetail>(`/api/volumes/${code}`),
  chapter: (code: string, seq: number) => swr404<ChapterDetail>(`/api/chapter/${code}/${seq}`),
  imagery: () => swr<ImageryItem[]>('/api/imagery'),
  imageryOne: (id: number) => j404<ImageryOne>(`/api/imagery/${id}`),
  questionnaires: () => swr<Questionnaire[]>('/api/questionnaires'),
  domains: () => j<DomainStat[]>('/api/domains'),
  domainDocs: (name: string, limit = 80, offset = 0) =>
    j<DomainDocs>(`/api/domains/${encodeURIComponent(name)}/docs?limit=${limit}&offset=${offset}`),
  queue: () => j<QueueItem[]>('/api/queue'),
  adminStatus: () => j<AdminStatus>('/api/admin/status'),
  adminSession: (token: string) =>
    fetch('/api/admin/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }).then(async r => {
      if (r.ok) return true;
      if (r.status === 403 || r.status === 429) return false;
      throw new ApiError(r.status, 'admin session failed');
    }),
  source: (path: string) => j404<SourceDoc>(`/api/source/${encodeURI(path)}`),
  saveSource: (path: string, text: string, mtime?: string | number | null) =>
    fetch(`/api/source/${encodeURI(path)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, mtime }),
    }).then(async r => {
      if (r.status === 401) return handle401(path);
      if (!r.ok) throw new ApiError(r.status, `${r.status} save`);
      return r.json() as Promise<{ ok: boolean; mtime: string; sha256: string; title?: string }>;
    }),
  aiDraft: (body: { path: string; text: string; selection?: string; mode?: string; instruction?: string }) =>
    fetch('/api/ai/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async r => {
      if (r.status === 401) return handle401(body.path);
      if (!r.ok) throw new ApiError(r.status, `${r.status} ai`);
      return r.json() as Promise<{ text: string; engine: 'llm' | 'local'; mode: string }>;
    }),
};
