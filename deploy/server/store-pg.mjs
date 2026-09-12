/**
 * ΜΝΗΜΗ · M7 PG 数据访问层（CloudBase PostgreSQL 适配器，与 store.mjs 同接口）
 * - ? 占位符 → $n；int8/numeric → number；count 语义不变
 * - files_fts 检索改为 pg_trgm GIN + ILIKE，snippet 由服务层计算
 * - 连接池 max=4（CloudBase PG SHARED 实例连接数有限）
 * 环境变量：MNEME_PG（连接串，必填）；MNEME_PG_SSL=1 时启用 SSL（rejectUnauthorized:false）
 *
 * 隐私门禁：与 store.mjs 共用 ./privacy.mjs 的判定与 SQL 守卫片段（禁止各写一套）。
 * 每个只读出口都接受 { unlocked }。未解锁时私密层不可枚举；绝密档案以锁定档出现，正文仍 403。
 */
import pg from 'pg';
import {
  SECRET_NAME, SECRET_VOLUMES, QUESTIONNAIRE_MARK, isParentLabel,
  isPrivatePath, isSecretPath, isSecretText, isSecretEntity, mustHideEntity, isLockedStub,
  entityGuardSql, ENTITY_GUARD_PARAMS, docGuardSql, timelineGuardSql,
  chapterGuardSql, imageryGuardSql, questionnaireGuardSql, scrubMeta, sanitizeGroups, sanitizeForeshadow,
} from './privacy.mjs';

export { isPrivatePath };

pg.types.setTypeParser(20, (v) => parseInt(v, 10));   // int8
pg.types.setTypeParser(1700, (v) => parseFloat(v));   // numeric

const POOL = new pg.Pool({
  connectionString: process.env.MNEME_PG,
  max: 4,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: process.env.MNEME_PG_SSL === '1' ? { rejectUnauthorized: false } : undefined,
});

/** ? → $1,$2,... */
const q = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
const all = async (sql, ...params) => (await POOL.query(q(sql), params)).rows;
const one = async (sql, ...params) => (await all(sql, ...params))[0];
const J = (s, fb = null) => { try { return JSON.parse(s); } catch { return fb; } };

/* ---------- 检索辅助（PG 无 FTS5，用 ILIKE + JS snippet） ---------- */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function makeSnippet(body, terms) {
  if (!body) return '';
  const text = String(body).replace(/[#>*`[\]]/g, '').slice(0, 20000);
  for (const t of terms) {
    const i = text.toLowerCase().indexOf(t.toLowerCase());
    if (i >= 0) {
      const s = Math.max(0, i - 60);
      const seg = text.slice(s, i + 140);
      const marked = seg.replace(new RegExp(escapeRe(t), 'gi'), (m) => `<mark>${m}</mark>`);
      return (s > 0 ? '…' : '') + marked + '…';
    }
  }
  return text.slice(0, 120) + '…';
}

/* ---------- 总览 ---------- */
export const overview = () => all(
  `SELECT (SELECT COUNT(*) FROM documents WHERE is_private=0)::int docs,
    (SELECT COUNT(*) FROM documents WHERE is_private=1)::int "secretDocs",
    (SELECT COUNT(*) FROM entities)::int entities,
    (SELECT COUNT(*) FROM wikilinks WHERE resolved=1)::int edges,
    (SELECT COUNT(DISTINCT to_target) FROM wikilinks WHERE resolved=0 AND is_private=0)::int stardust,
    (SELECT COUNT(*) FROM timeline_events WHERE kind='anchor')::int anchors,
    (SELECT COUNT(*) FROM questionnaires)::int questionnaires,
    (SELECT COUNT(*) FROM imagery)::int imagery,
    (SELECT COUNT(*) FROM chapters)::int chapters,
    (SELECT COUNT(*) FROM chapters WHERE is_sample=1)::int samples`
).then(async ([c]) => {
  const latest = await one('SELECT path,title,mtime FROM documents WHERE is_private=0 ORDER BY mtime DESC LIMIT 1');
  const evidence = await all('SELECT kind, COUNT(*) n FROM evidence_spans GROUP BY kind');
  const volumes = await all(`SELECT v.code,v.name,v.years,v.line_metaphor,v.mood,v.word_target,v.color_token,
    (SELECT COUNT(*) FROM chapters c WHERE c.volume_code=v.code AND c.is_sample=0)::int chapters,
    (SELECT COUNT(*) FROM documents d WHERE d.volume=v.code)::int docs FROM volumes v ORDER BY v.seq`);
  let audit = await one('SELECT * FROM audit_runs ORDER BY id DESC LIMIT 1');
  if (audit) audit = { ...audit, manifest: J(audit.manifest, {}) };
  const years = await all('SELECT year, docs FROM year_density ORDER BY year');
  const domains = await all('SELECT domain, COUNT(*) n FROM documents WHERE is_private=0 GROUP BY domain ORDER BY n DESC');
  return { ...c, latest, evidence, volumes, audit, years, domains };
});

export const evidenceQueue = async ({ unlocked = false } = {}) => {
  const guard = unlocked ? '' : docGuardSql('d');
  const rows = await all(`
    SELECT es.id, es.kind, es.snippet, d.path, d.title, d.volume, d.domain, d.stage
    FROM evidence_spans es JOIN documents d ON d.id = es.doc_id
    WHERE es.kind IN ('pending','pendingCollect','conflict') ${guard}
    ORDER BY CASE es.kind WHEN 'conflict' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, d.mtime DESC
    LIMIT 80`);
  return unlocked ? rows : rows.map(r => isLockedStub(r) || isSecretText(r.snippet)
    ? { ...r, snippet: '', locked: true } : r);
};

/* ---------- 十域 ---------- */
export const domains = () => all(`SELECT domain, COUNT(*) n,
  SUM(CASE WHEN stage='高中' THEN 1 ELSE 0 END) hs,
  SUM(CASE WHEN stage='大学' THEN 1 ELSE 0 END) uni
  FROM documents WHERE is_private=0 GROUP BY domain ORDER BY n DESC`);

export const domainDocs = async (name, limit = 60, offset = 0, { unlocked = false } = {}) => {
  const g = unlocked ? '' : docGuardSql();
  return {
    domain: name,
    total: (await one(`SELECT COUNT(*) c FROM documents WHERE domain=?${g}`, name)).c,
    docs: (await all(`SELECT id,path,title,doc_type,stage,volume,mtime,meta FROM documents WHERE domain=?${g} ORDER BY mtime DESC LIMIT ? OFFSET ?`, name, limit, offset))
      .map(d => ({ ...d, meta: scrubMeta(J(d.meta, {}), unlocked), locked: !unlocked && isLockedStub(d) })),
  };
};

/* ---------- 时间线 ---------- */
export const timeline = ({ from = 2000, to = 2030, stage, kind, unlocked = false } = {}) => {
  /* 修复：JOIN documents 后 stage/volume/year 在 t 与 d 间歧义（documents 同样有 stage/volume 列） */
  let sql = 'SELECT t.*, d.title AS ref_title FROM timeline_events t LEFT JOIN documents d ON d.id=t.doc_id WHERE t.year BETWEEN ? AND ?';
  const p = [from, to];
  if (stage) { sql += ' AND t.stage=?'; p.push(stage); }
  if (kind) { sql += ' AND t.kind=?'; p.push(kind); }
  if (!unlocked) sql += timelineGuardSql('t');
  sql += ' ORDER BY t.year, t.month IS NULL, t.month';
  return all(sql, ...p).then(rows => rows.map(e => {
    if (unlocked || !isLockedStub(e)) return e;
    return { ...e, locked: true, detail: null, ref: null, ref_title: null };
  }));
};

/* ---------- 人物 ---------- */
export const entities = async ({ group, q: qq, limit = 400, unlocked = false } = {}) => {
  let sql = 'SELECT id,std_id,display_name,relation_group,stage,mention_count,first_year,last_year FROM entities WHERE 1=1';
  const p = [];
  if (group) { sql += ' AND relation_group=?'; p.push(group); }
  if (qq) { sql += ' AND (display_name ILIKE ? OR std_id ILIKE ?)'; p.push(`%${qq}%`, `%${qq}%`); }
  if (!unlocked) { sql += entityGuardSql(); p.push(...ENTITY_GUARD_PARAMS); }
  sql += ' ORDER BY mention_count DESC LIMIT ?'; p.push(unlocked ? limit : limit + 64);
  const rows = (await all(sql, ...p)).filter(e => !mustHideEntity(e, unlocked)).map(e => {
    if (!unlocked && isSecretEntity(e)) {
      const { std_id, role_doc_path, ...rest } = e;
      return { ...rest, locked: true };
    }
    return e;
  });
  return unlocked ? rows : rows.slice(0, limit);
};

/** 未解锁时实体是否必须隐藏（供 server 层对单条实体判定 404/403） */
export const entityVisible = (e, unlocked) => !!e && !mustHideEntity(e, unlocked);

export const entity = async (id, { unlocked = false } = {}) => {
  const e = await one('SELECT * FROM entities WHERE id=?', id);
  if (!e) return null;
  e.aliases = J(e.aliases, []);
  const docG = unlocked ? '' : docGuardSql('d');
  const mentionDocs = (await all(`SELECT d.id,d.path,d.title,d.domain,d.stage,d.mtime,m.hits FROM entity_mentions m
    JOIN documents d ON d.id=m.doc_id WHERE m.entity_id=?${docG} ORDER BY d.mtime DESC LIMIT 120`, id))
    .map(d => (!unlocked && isLockedStub(d)) ? { ...d, locked: true } : d);
  const relG = unlocked ? '' : entityGuardSql('e.');
  const related = (await all(`SELECT e.id,e.std_id,e.role_doc_path,e.display_name,e.relation_group,e.mention_count,COUNT(*) co
    FROM entity_mentions m1 JOIN entity_mentions m2 ON m1.doc_id=m2.doc_id AND m2.entity_id!=m1.entity_id
    JOIN entities e ON e.id=m2.entity_id
    JOIN documents d ON d.id=m1.doc_id AND d.is_index=0
    WHERE m1.entity_id=?${relG} GROUP BY e.id ORDER BY co DESC LIMIT 12`, id, ...(unlocked ? [] : ENTITY_GUARD_PARAMS)))
    .filter(e => !mustHideEntity(e, unlocked))
    .map(({ std_id, role_doc_path, ...e }) =>
      (!unlocked && isSecretEntity({ display_name: e.display_name })) ? { ...e, locked: true } : e);
  const evidence = await all(`SELECT es.kind, es.snippet FROM evidence_spans es WHERE es.doc_id IN
    (SELECT doc_id FROM entity_mentions WHERE entity_id=? LIMIT 40) LIMIT 30`, id);
  const docRow = await one('SELECT body FROM documents WHERE path=?', e.role_doc_path);
  return { ...e, mentionDocs, related, evidence, selfBodyChars: docRow ? docRow.body.length : 0 };
};

/* ---------- 星图 ---------- */
export const graph = async ({ unlocked = false } = {}) => {
  const nodes = (await all(`SELECT id, display_name AS name, relation_group AS grp, stage, mention_count AS mention,
    role_doc_path AS doc, std_id, first_year, last_year FROM entities`))
    .filter(n => unlocked || !(isPrivatePath(n.std_id) || isPrivatePath(n.doc)))
    .map(({ std_id, doc, ...n }) => {
      const locked = !unlocked && isSecretText(n.name);
      return locked ? { ...n, locked: true } : { ...n, doc };
    });
  const co = await all(`SELECT m1.entity_id a, m2.entity_id b, COUNT(*) w
    FROM entity_mentions m1 JOIN entity_mentions m2 ON m1.doc_id=m2.doc_id AND m1.entity_id<m2.entity_id
    JOIN documents d ON d.id=m1.doc_id AND d.is_index=0 AND d.is_private=0
    GROUP BY m1.entity_id, m2.entity_id HAVING COUNT(*)<=999 ORDER BY w DESC LIMIT 2200`);
  const nodesById = new Set(nodes.map(n => n.id));
  const edges = co.filter(e => nodesById.has(e.a) && nodesById.has(e.b)).map(e => [e.a, e.b, e.w]);
  const stardust = (await all('SELECT DISTINCT to_target FROM wikilinks WHERE resolved=0 AND is_private=0 LIMIT 1300'))
    .map(r => r.to_target);
  return { nodes, edges, stardust, legend: { edge: '同篇共现 / wikilink 关联（非关系亲疏）', stardust: '名录留名占位（待建人物页）' } };
};

/* ---------- 五卷 ---------- */
export const volumes = () => all(`SELECT v.*,
  (SELECT COUNT(*) FROM chapters c WHERE c.volume_code=v.code AND c.is_sample=0)::int chapters,
  (SELECT COUNT(*) FROM documents d WHERE d.volume=v.code)::int docs FROM volumes v ORDER BY v.seq`);

export const volume = async (code) => {
  const v = await one('SELECT * FROM volumes WHERE code=?', code);
  if (!v) return null;
  const chapters = await all('SELECT * FROM chapters WHERE volume_code=? ORDER BY is_sample, seq', code);
  const docs = await all('SELECT path,title,doc_type,mtime FROM documents WHERE volume=? ORDER BY is_index, mtime', code);
  const pendingCollect = (await one(`SELECT COUNT(*) c FROM evidence_spans es JOIN documents d ON d.id=es.doc_id
    WHERE d.volume=? AND es.kind='pendingCollect'`, code)).c;
  const foreshadow = await all(`SELECT es.kind, COUNT(*) n FROM evidence_spans es JOIN documents d ON d.id=es.doc_id
    WHERE d.volume=? GROUP BY es.kind`, code);
  return { ...v, chapters, docs, pendingCollect, foreshadow };
};

/* ---------- 意象 ---------- */
export const imagery = async ({ unlocked = false } = {}) =>
  (await all(`SELECT i.*, (SELECT COUNT(*) FROM imagery_occurrences o WHERE o.imagery_id=i.id)::int occ
    FROM imagery i ORDER BY i.candidate, i.seq`))
    .map(i => (!unlocked && isSecretText(i.name)) ? { ...i, locked: true } : i);

export const imageryOne = async (id, { unlocked = false } = {}) => {
  const im = await one('SELECT * FROM imagery WHERE id=?', id);
  if (!im) return null;
  if (!unlocked && isSecretText(im.name)) return { locked: true };
  const occurrences = await all('SELECT * FROM imagery_occurrences WHERE imagery_id=? ORDER BY seq', id);
  return { ...im, occurrences };
};

/* ---------- 问卷 ---------- */
export const questionnaires = async ({ unlocked = false } = {}) =>
  (await all('SELECT id,round,respondent_label,relation_label,doc_path,answers FROM questionnaires ORDER BY id'))
    .map(r => {
      const answers = J(r.answers, {});
      if (unlocked || isParentLabel(r.respondent_label)) return { ...r, answers };
      return { id: r.id, round: r.round, locked: true, answers: [] };
    });

/* ---------- 文档 ---------- */
/** 门禁（三级）：private → { private:true }（server 转 404）；secret（绝密人物/卷二卷三）→ { locked:true }（server 转 403） */
export const doc = async (rawPath, opts = {}) => {
  const unlocked = !!opts.force;
  let p = decodeURIComponent(rawPath || '').replace(/^\/+/, '');
  if (!/\.md$/i.test(p)) p += '.md';
  const base = p.split('/').pop().replace(/\.md$/i, '');
  const d = await one('SELECT * FROM documents WHERE path=? OR path=? OR path LIKE ?', p, p.replace(/\.md$/i, ''), `%/${base}.md`);
  if (!d) return null;
  if (!unlocked) {
    if (d.is_private || isPrivatePath(d.path)) return { private: true };
    if (isSecretPath(d.path) || isSecretText(d.title)) return { locked: true };
    if (SECRET_VOLUMES.includes(String(d.volume || ''))) return { locked: true };
    /* 非父母卷的问卷作答全文属绝密（按 questionnaires.doc_path 精确匹配，勿用文件名模糊判断） */
    if (String(d.path).includes(QUESTIONNAIRE_MARK)) {
      const qr = await one('SELECT respondent_label FROM questionnaires WHERE doc_path=?', d.path);
      if (qr && !isParentLabel(qr.respondent_label)) return { locked: true };
    }
  }
  const blG = unlocked ? '' : docGuardSql('d');
  const backlinks = (await all(`SELECT DISTINCT d.path, d.title, d.domain FROM wikilinks w JOIN documents d ON d.path=w.from_doc
    WHERE w.to_target=? AND w.is_private=0 AND w.resolved=1 AND w.from_doc!=?${blG} LIMIT 60`, base, d.path))
    .map(b => (!unlocked && isLockedStub(b)) ? { ...b, locked: true } : b);
  const pG = unlocked ? '' : entityGuardSql('e.');
  const persons = (await all(`SELECT e.id, e.display_name, e.relation_group, e.mention_count FROM entities e
    JOIN entity_mentions m ON m.entity_id=e.id WHERE m.doc_id=?${pG} ORDER BY e.mention_count DESC LIMIT 30`,
    d.id, ...(unlocked ? [] : ENTITY_GUARD_PARAMS)))
    .map(e => (!unlocked && isSecretText(e.display_name)) ? { ...e, locked: true } : e);
  const evidence = await all('SELECT kind, COUNT(*) n FROM evidence_spans WHERE doc_id=? GROUP BY kind', d.id);
  const evSnippets = await all(`SELECT id, kind, snippet FROM evidence_spans WHERE doc_id=?
    ORDER BY CASE kind WHEN 'conflict' THEN 0 WHEN 'pending' THEN 1 WHEN 'pendingCollect' THEN 2 ELSE 3 END, id
    LIMIT 80`, d.id);
  /* v8 · 3.3 五向互链：同时间事件 + 相关意象（与 store.mjs 同口径，同样受未解锁守卫约束） */
  const tlG2 = unlocked ? '' : timelineGuardSql('t');
  const timeline = (await all(`SELECT t.id, t.year, t.month, t.title, t.kind FROM timeline_events t
    WHERE t.doc_id=?${tlG2} ORDER BY t.year ASC, COALESCE(t.month,0) ASC LIMIT 24`, d.id))
    .map(e => (!unlocked && isLockedStub(e)) ? { ...e, locked: true } : e);
  const imG2 = unlocked ? '' : imageryGuardSql();
  const bodyPlain = String(d.body || '').replace(/\*\*/g, '');
  const imRows = await all(`SELECT i.id, i.name FROM imagery i WHERE i.candidate=0${imG2} ORDER BY i.seq`);
  const occRows = await all('SELECT imagery_id, COUNT(*)::int c FROM imagery_occurrences GROUP BY imagery_id');
  const occMap = new Map(occRows.map(r => [Number(r.imagery_id), Number(r.c)]));
  const imagery = imRows
    .map(im => ({ id: im.id, name: String(im.name).replace(/\*\*/g, '') }))
    .filter(im => im.name.length >= 2 && bodyPlain.includes(im.name))
    .slice(0, 24)
    .map(im => {
      const occ = occMap.get(Number(im.id)) || 0;
      return (!unlocked && isSecretText(im.name)) ? { ...im, occ, locked: true } : { ...im, occ };
    });
  return {
    id: d.id, path: d.path, title: d.title, domain: d.domain, doc_type: d.doc_type, stage: d.stage,
    volume: d.volume, meta: scrubMeta(J(d.meta, {}), unlocked), body: d.body, mtime: d.mtime,
    backlinks, persons, evidence, evSnippets, timeline, imagery,
  };
};

/* ---------- 检索 ---------- */
export async function search(qs, group, opts = {}) {
  const query = (qs || '').trim();
  if (!query) return { groups: {}, terms: [] };
  const terms = query.split(/\s+/).filter(Boolean).slice(0, 6);
  const unlocked = !!opts.unlocked;
  const groups = {};
  /* 与 store.mjs 同一套出口守卫（原实现完全没有守卫，且没有 pinyin 分支） */
  const dG = unlocked ? '' : docGuardSql();
  const eG = unlocked ? '' : entityGuardSql();
  const eP = unlocked ? [] : ENTITY_GUARD_PARAMS;
  const chG = unlocked ? '' : chapterGuardSql();
  const tlG = unlocked ? '' : timelineGuardSql('t');
  const imG = unlocked ? '' : imageryGuardSql();
  const volG = '';
  if (!group || group === 'doc') {
    const where = terms.map(() => '(title ILIKE ? OR body ILIKE ?)').join(' AND ');
    const p = terms.flatMap(t => [`%${t}%`, `%${t}%`]);
    const rows = await all(`SELECT path,title,domain,stage,body FROM documents WHERE 1=1${dG} AND ${where} LIMIT 30`, ...p);
    groups.doc = rows.map(r => ({ path: r.path, title: r.title, domain: r.domain, stage: r.stage, snippet: makeSnippet(r.body, terms) }));
  }
  if (!group || group === 'person') {
    const where = terms.map(() => '(display_name ILIKE ? OR std_id ILIKE ?)').join(' AND ');
    groups.person = await all(`SELECT id,display_name,relation_group,stage,mention_count FROM entities WHERE ${where}${eG}
      ORDER BY mention_count DESC LIMIT 12`, ...terms.flatMap(t => [`%${t}%`, `%${t}%`]), ...eP);
  }
  if (!group || group === 'timeline') {
    const where = terms.map(() => 't.title ILIKE ?').join(' AND ');
    groups.timeline = await all(`SELECT t.id,t.year,t.month,t.exact_date,t.stage,t.volume,t.kind,t.title FROM timeline_events t
      WHERE ${where}${tlG} ORDER BY t.year LIMIT 12`, ...terms.map(t => `%${t}%`));
  }
  if (!group || group === 'imagery') {
    const where = terms.map(() => 'name ILIKE ?').join(' AND ');
    groups.imagery = await all(`SELECT id,name,candidate,(SELECT COUNT(*) FROM imagery_occurrences o WHERE o.imagery_id=imagery.id)::int occ
      FROM imagery WHERE ${where}${imG} LIMIT 12`, ...terms.map(t => `%${t}%`));
  }
  if (!group || group === 'volume') {
    groups.volume = await all(`SELECT code,name AS title,'volume' typ FROM volumes WHERE name ILIKE ?${volG} LIMIT 8`, ...terms.map(() => `%${query}%`));
    if (groups.volume.length < 8) {
      const where = terms.map(() => 'title ILIKE ?').join(' AND ');
      const ch = await all(`SELECT volume_code AS code, title,'chapter' typ, doc_path, seq, is_sample FROM chapters WHERE ${where}${chG} LIMIT 12`, ...terms.map(t => `%${t}%`));
      groups.volume = groups.volume.concat(ch);
    }
  }
  if (!group || group === 'questionnaire') {
    const where = terms.map(() => '(respondent_label ILIKE ? OR answers ILIKE ?)').join(' AND ');
    const qG = unlocked ? '' : questionnaireGuardSql();
    groups.questionnaire = (await all(`SELECT id,respondent_label,doc_path FROM questionnaires WHERE ${where}${qG} LIMIT 12`, ...terms.flatMap(t => [`%${t}%`, `%${t}%`])))
      .map(r => (unlocked || isParentLabel(r.respondent_label)) ? r : { id: r.id, locked: true });
  }
  sanitizeGroups(groups, unlocked);
  return { groups, terms };
}

/* ---------- 审计 ---------- */
export const auditLatest = () => one('SELECT * FROM audit_runs ORDER BY id DESC LIMIT 1')
  .then(a => (a ? { ...a, manifest: J(a.manifest, {}) } : a));

export const yearDensity = () => all('SELECT year, docs FROM year_density ORDER BY year');

export const foreshadow = async ({ unlocked = false } = {}) => ({
  rows: sanitizeForeshadow(
    await all(`SELECT id,level,material,plant,harvest,method,status FROM foreshadow
      ORDER BY CASE level WHEN '🔴' THEN 0 WHEN '青铜' THEN 1 ELSE 2 END, id`),
    unlocked,
  ),
});
