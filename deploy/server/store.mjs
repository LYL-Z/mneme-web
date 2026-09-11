/**
 * ΜΝΗΜΗ · M2 数据访问层（SQLite 本地适配器；M7 提供 PG 适配器同接口）
 * 每次调用只读打开数据库，无持久句柄（支持运行期重扫描换库）。
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.MNEME_DB || path.join(HERE, '..', 'ingest', 'mneme.db');

/* ============ 私密层 / 绝密档案：判定规则来自 ./privacy.mjs（唯一事实来源） ============
   server.mjs / store.mjs / store-pg.mjs 共用同一套判定，禁止在别处重新实现
   （历史上三套规则不一致，导致「锁了 /api/doc、漏了 /api/search|graph|entities」的旁路）。
   本模块只做再导出，保持既有调用方（server.mjs / 测试）的导入路径不变。 */
import {
  SECRET_NAME, SECRET_VOLUMES, QUESTIONNAIRE_MARK, PARENT_LABELS, isParentLabel,
  isPrivatePath, isSecretPath, isSecretText, isPrivateEntity, isSecretEntity, mustHideEntity,
  entityGuardSql, ENTITY_GUARD_PARAMS, docGuardSql, timelineGuardSql, chapterGuardSql,
  imageryGuardSql, questionnaireGuardSql, scrubMeta, sanitizeGroups, sanitizeForeshadow,
} from './privacy.mjs';

export {
  SECRET_NAME, SECRET_VOLUMES, QUESTIONNAIRE_MARK, PARENT_LABELS, isParentLabel,
  isPrivatePath, isSecretPath, isSecretText, isPrivateEntity, isSecretEntity, mustHideEntity,
  entityGuardSql, ENTITY_GUARD_PARAMS, docGuardSql, timelineGuardSql, chapterGuardSql,
  imageryGuardSql, questionnaireGuardSql, scrubMeta, sanitizeGroups, sanitizeForeshadow,
};

export function withDb(fn) {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try { return fn(db); } finally { db.close(); }
}
const J = (s, fb = null) => { try { return JSON.parse(s); } catch { return fb; } };

/* ---------- 总览 ---------- */
export const overview = () => withDb(db => {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const docs = one('SELECT COUNT(*) c FROM documents WHERE is_private=0').c; // 公开口径：不含私密层
  const secretDocs = one('SELECT COUNT(*) c FROM documents WHERE is_private=1').c;
  const entities = one('SELECT COUNT(*) c FROM entities').c;
  const edges = one('SELECT COUNT(*) c FROM wikilinks WHERE resolved=1').c;
  const stardust = one('SELECT COUNT(DISTINCT to_target) c FROM wikilinks WHERE resolved=0 AND is_private=0').c;
  const anchors = one("SELECT COUNT(*) c FROM timeline_events WHERE kind='anchor'").c;
  const questionnaires = one('SELECT COUNT(*) c FROM questionnaires').c;
  const imagery = one('SELECT COUNT(*) c FROM imagery').c;
  const chapters = one('SELECT COUNT(*) c FROM chapters').c;
  const samples = one('SELECT COUNT(*) c FROM chapters WHERE is_sample=1').c;
  const latest = db.prepare('SELECT path,title,mtime FROM documents WHERE is_private=0 ORDER BY mtime DESC LIMIT 1').get();
  const evidence = db.prepare('SELECT kind, COUNT(*) n FROM evidence_spans GROUP BY kind').all();
  const volumes = db.prepare(`SELECT v.code,v.name,v.years,v.line_metaphor,v.mood,v.word_target,v.color_token,
    (SELECT COUNT(*) FROM chapters c WHERE c.volume_code=v.code AND c.is_sample=0) chapters,
    (SELECT COUNT(*) FROM documents d WHERE d.volume=v.code) docs FROM volumes v ORDER BY v.seq`).all();
  const audit = one('SELECT * FROM audit_runs ORDER BY id DESC LIMIT 1');
  const years = db.prepare('SELECT year, docs FROM year_density ORDER BY year').all();
  const domains = db.prepare('SELECT domain, COUNT(*) n FROM documents WHERE is_private=0 GROUP BY domain ORDER BY n DESC').all();
  if (audit) audit.manifest = J(audit.manifest, {});
  return { docs, secretDocs, entities, edges, stardust, anchors, questionnaires, imagery, chapters, samples, latest, evidence, volumes, audit, years, domains };
});

/* ---------- 十域 ---------- */
export const domains = () => withDb(db =>
  db.prepare(`SELECT domain, COUNT(*) n,
    SUM(CASE WHEN stage='高中' THEN 1 ELSE 0 END) hs,
    SUM(CASE WHEN stage='大学' THEN 1 ELSE 0 END) uni
    FROM documents WHERE is_private=0 GROUP BY domain ORDER BY n DESC`).all());

export const domainDocs = (name, limit = 60, offset = 0, { unlocked = false } = {}) => withDb(db => {
  /* 未解锁时：私密层、问卷作答全文（绝密）、卷二卷三文档、点名绝密人物的文档
     一律不出现在域内文档清单（原实现只过滤 is_private，
     26 份问卷作答全文的标题+路径、以及 绝密人物.md 都被直接列出） */
  const qGuard = unlocked ? '' : docGuardSql();
  const eGuard = unlocked ? '' : entityGuardSql('e.');
  return {
    domain: name,
    total: db.prepare(`SELECT COUNT(*) c FROM documents WHERE domain=?${qGuard}`).get(name).c,
    docs: db.prepare(`SELECT id,path,title,doc_type,stage,volume,mtime,meta FROM documents WHERE domain=?${qGuard} ORDER BY mtime DESC LIMIT ? OFFSET ?`).all(name, limit, offset)
      .map(d => ({ ...d, meta: scrubMeta(J(d.meta, {}), unlocked) })),
    /* v3.1 主题域内容化：域内高频人物（人物页实体）；意象表无域信息，不作假数据 */
    topPersons: db.prepare(`SELECT e.id, e.std_id, e.role_doc_path, e.display_name, e.relation_group, COUNT(*) hits
      FROM entity_mentions m JOIN documents d ON d.id=m.doc_id JOIN entities e ON e.id=m.entity_id
      WHERE d.domain=? AND d.is_private=0 AND (e.std_id LIKE '%/人物/%' OR e.role_doc_path LIKE '%/人物/%')${eGuard}
      GROUP BY m.entity_id ORDER BY hits DESC LIMIT 8`).all(name, ...(unlocked ? [] : ENTITY_GUARD_PARAMS))
      .filter(e => !mustHideEntity(e, unlocked))
      .map(({ std_id, role_doc_path, ...e }) => e),
  };
});

/* ---------- 时间线 ---------- */
export const timeline = ({ from = 2000, to = 2030, stage, kind, unlocked = false } = {}) => withDb(db => {
  /* 修复：JOIN documents 后 stage/volume/year 在 t 与 d 间歧义（documents 同样有 stage/volume 列），
     原写法 `AND stage=?` 触发 SQLITE_ERROR → /api/timeline?stage= 500。全部显式加 t. 前缀。 */
  let sql = 'SELECT t.*, d.title AS ref_title FROM timeline_events t LEFT JOIN documents d ON d.id=t.doc_id WHERE t.year BETWEEN ? AND ?';
  const p = [from, to];
  if (stage) { sql += ' AND t.stage=?'; p.push(stage); }
  if (kind) { sql += ' AND t.kind=?'; p.push(kind); }
  if (!unlocked) {
    /* 绝密档案：卷二/卷三事件 + 标题点名绝密人物者，未解锁一律不出现 */
    sql += ` AND COALESCE(t.volume,'') NOT IN (${SECRET_VOLUMES.map(() => '?').join(',')})`;
    p.push(...SECRET_VOLUMES);
    sql += " AND COALESCE(t.title,'') NOT LIKE ?";
    p.push(`%${SECRET_NAME}%`);
  }
  sql += ' ORDER BY t.year, t.month IS NULL, t.month';
  return db.prepare(sql).all(...p);
});

/* ---------- 人物 ---------- */
export const entities = ({ group, q, limit = 400, unlocked = false } = {}) => withDb(db => {
  let sql = 'SELECT id,std_id,display_name,relation_group,stage,mention_count,first_year,last_year FROM entities WHERE 1=1';
  const p = [];
  if (group) { sql += ' AND relation_group=?'; p.push(group); }
  if (q) { sql += ' AND (display_name LIKE ? OR std_id LIKE ?)'; p.push(`%${q}%`, `%${q}%`); }
  /* 私密层实体（std_id/role_doc_path 落在 私人资料/隐私）与绝密档案实体（姓名命中）：
     未解锁时从枚举列表中整体消失，杜绝「枚举 → 拿到 id → 直取」的旁路 */
  if (!unlocked) { sql += entityGuardSql(); p.push(...ENTITY_GUARD_PARAMS); }
  /* 未解锁时多取一批再按 mustHideEntity 过滤：SQL 守卫 + JS 判定（单一权威）双保险，
     避免「新增一类需隐藏实体但忘了改 SQL」时静默泄漏 */
  sql += ' ORDER BY mention_count DESC LIMIT ?'; p.push(unlocked ? limit : limit + 64);
  const rows = db.prepare(sql).all(...p).filter(e => !mustHideEntity(e, unlocked));
  return unlocked ? rows : rows.slice(0, limit);
});

/** 未解锁时实体是否必须隐藏（供 server 层对单条实体判定 404/403） */
export const entityVisible = (e, unlocked) => !!e && !mustHideEntity(e, unlocked);

export const entity = (id, { unlocked = false } = {}) => withDb(db => {
  const e = db.prepare('SELECT * FROM entities WHERE id=?').get(id);
  if (!e) return null;
  e.aliases = J(e.aliases, []);
  /* 提及文档：私密层与（未解锁时的）绝密档案不出现在实体页的出处列表 */
  const docGuard = unlocked ? '' : ` AND d.is_private=0 AND d.path NOT LIKE '%${QUESTIONNAIRE_MARK}%'`;
  const mentionDocs = db.prepare(`SELECT d.id,d.path,d.title,d.domain,d.stage,d.mtime,m.hits FROM entity_mentions m
    JOIN documents d ON d.id=m.doc_id WHERE m.entity_id=?${docGuard} ORDER BY d.mtime DESC LIMIT 120`).all(id);
  // 关联人物骨架：同篇共现 Top 12（未解锁时剔除私密/绝密实体）
  const relGuard = unlocked ? '' : entityGuardSql('e.');
  const related = db.prepare(`SELECT e.id,e.std_id,e.role_doc_path,e.display_name,e.relation_group,e.mention_count,COUNT(*) co
    FROM entity_mentions m1 JOIN entity_mentions m2 ON m1.doc_id=m2.doc_id AND m2.entity_id!=m1.entity_id
    JOIN entities e ON e.id=m2.entity_id
    JOIN documents d ON d.id=m1.doc_id AND d.is_index=0
    WHERE m1.entity_id=?${relGuard} GROUP BY m2.entity_id ORDER BY co DESC LIMIT 12`)
    .all(id, ...(unlocked ? [] : ENTITY_GUARD_PARAMS))
    .filter(e => !mustHideEntity(e, unlocked))
    .map(({ std_id, role_doc_path, ...e }) => e);
  const evidence = db.prepare(`SELECT es.kind, es.snippet FROM evidence_spans es WHERE es.doc_id IN
    (SELECT doc_id FROM entity_mentions WHERE entity_id=? LIMIT 40) LIMIT 30`).all(id);
  const doc = db.prepare('SELECT body FROM documents WHERE path=?').get(e.role_doc_path);
  return { ...e, mentionDocs, related, evidence, selfBodyChars: doc ? doc.body.length : 0 };
});

/* ---------- 星图 ---------- */
export const graph = ({ unlocked = false } = {}) => withDb(db => {
  const nodes = db.prepare(`SELECT id, display_name AS name, relation_group AS grp, stage, mention_count AS mention,
    role_doc_path AS doc, std_id, first_year, last_year FROM entities
    WHERE std_id LIKE '%/人物/%' OR role_doc_path LIKE '%/人物/%'`).all()
    /* 私密层人物（私人资料/人物/…）与绝密档案人物：未解锁时不得出现在星图
       （原实现直出 224 节点，其中 15 个的 role_doc_path 指向 私人资料/，构成路径旁路）
       注意：节点对象的字段名是 name/doc（已别名化），不能复用 mustHideEntity 的 display_name/role_doc_path 判定 */
    .filter(n => unlocked || !(isPrivatePath(n.std_id) || isPrivatePath(n.doc) || isSecretText(n.name)))
    .map(({ std_id, ...n }) => n); // std_id 仅用于判定，不外泄
  // ^ v3.1 星图只陈列真人物：以"人物页路径"为准（/人物/ 段），片目/规则/技法参考等文档型实体不再混入。
  // 共现边（排除索引页、私密层文档与过度泛化的页）
  const co = db.prepare(`SELECT m1.entity_id a, m2.entity_id b, COUNT(*) w
    FROM entity_mentions m1 JOIN entity_mentions m2 ON m1.doc_id=m2.doc_id AND m1.entity_id<m2.entity_id
    JOIN documents d ON d.id=m1.doc_id AND d.is_index=0 AND d.is_private=0
    GROUP BY m1.entity_id, m2.entity_id HAVING COUNT(*)<=999 ORDER BY w DESC LIMIT 2200`).all();
  const nodesById = new Set(nodes.map(n => n.id));
  const edges = co.filter(e => nodesById.has(e.a) && nodesById.has(e.b)).map(e => [e.a, e.b, e.w]);
  const stardust = db.prepare('SELECT DISTINCT to_target FROM wikilinks WHERE resolved=0 AND is_private=0 LIMIT 1300')
    .all().map(r => r.to_target).filter(t => unlocked || !isSecretText(t));
  return { nodes, edges, stardust, legend: { edge: '同篇共现 / wikilink 关联（非关系亲疏）', stardust: '名录留名占位（待建人物页）' } };
});

/* ---------- 五卷 ---------- */
export const volumes = () => withDb(db =>
  db.prepare(`SELECT v.*,
    (SELECT COUNT(*) FROM chapters c WHERE c.volume_code=v.code AND c.is_sample=0) chapters,
    (SELECT COUNT(*) FROM documents d WHERE d.volume=v.code) docs FROM volumes v ORDER BY v.seq`).all());

/* 卷内意象（volume_code 中文数字映射，volume()/chapter() 共用） */
const volImagery = (db, code) => {
  const NUM = { P0: null, V1: '一', V2: '二', V3: '三', V4: '四', V5: '五' }[code];
  return NUM
    ? db.prepare(`SELECT i.id, i.name, COUNT(*) occ FROM imagery_occurrences o
      JOIN imagery i ON i.id=o.imagery_id WHERE o.volume_code LIKE ? GROUP BY o.imagery_id ORDER BY occ DESC LIMIT 6`)
      .all(`%${NUM}%`)
    : [];
};

export const volume = (code) => withDb(db => {
  const v = db.prepare('SELECT * FROM volumes WHERE code=?').get(code);
  if (!v) return null;
  const chapters = db.prepare('SELECT * FROM chapters WHERE volume_code=? ORDER BY is_sample, seq').all(code);
  const docs = db.prepare('SELECT path,title,doc_type,mtime FROM documents WHERE volume=? ORDER BY is_index, mtime').all(code);
  const pendingCollect = db.prepare(`SELECT COUNT(*) c FROM evidence_spans es JOIN documents d ON d.id=es.doc_id
    WHERE d.volume=? AND es.kind='pendingCollect'`).get(code).c;
  const foreshadow = db.prepare(`SELECT es.kind, COUNT(*) n FROM evidence_spans es JOIN documents d ON d.id=es.doc_id
    WHERE d.volume=? GROUP BY es.kind`).all(code);
  /* v3.1 书房内容化：卷内人物/意象/字数/章节状态（人物=人物页实体，文档型实体排除） */
  const PERSON = "AND (e.std_id LIKE '%/人物/%' OR e.role_doc_path LIKE '%/人物/%')";
  const topPersons = db.prepare(`SELECT e.id, e.display_name, e.relation_group, COUNT(*) hits
    FROM entity_mentions m JOIN documents d ON d.id=m.doc_id JOIN entities e ON e.id=m.entity_id
    WHERE d.volume=? ${PERSON} GROUP BY m.entity_id ORDER BY hits DESC LIMIT 10`).all(code);
  const topImagery = volImagery(db, code);
  const words = db.prepare('SELECT COALESCE(SUM(LENGTH(body)),0) c FROM documents WHERE volume=?').get(code).c;
  const chapterStats = db.prepare('SELECT COALESCE(status,\'设计\') s, COUNT(*) n FROM chapters WHERE volume_code=? AND is_sample=0 GROUP BY status').all(code);
  return { ...v, chapters, docs, pendingCollect, foreshadow, topPersons, topImagery, words, chapterStats };
});

/* ---------- 章节材料链（v3.4 · P3 只读闭环） ----------
   辑级粒度：运行时解析卷章节设计文档正文（documents.body 已入库），
   按「## 辑X」小节切分，把【待采】【待核】归属到各辑；零 schema 变更、零 vault 写入。 */
const CN_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const splitSections = (body) => {
  const secs = [];
  let cur = null;
  for (const line of String(body || '').split(/\r?\n/)) { // CRLF/LF 兼容：vault 文档多为 CRLF
    const m = line.match(/^(#{1,3})\s+(.*)$/);
    if (m) { cur = { head: m[2].trim(), lines: [] }; secs.push(cur); }
    else if (cur) cur.lines.push(line);
  }
  return secs;
};
const pendingItems = (lines, cap = 16) => {
  const out = [];
  const seen = new Set();
  const clean = (s) => s
    .replace(/\[\[[^\]|]*\|([^\]]+)\]\]/g, '$1')  // [[路径|别名]] → 别名
    .replace(/\[\[([^\]|]+)\]\]/g, '$1');            // [[路径]] → 路径
  for (const raw of lines) {
    const m = raw.match(/【(待采|待核)】/);
    if (!m) continue;
    /* 先清洗 wikilink 再切表格列：split 在前会切断 [[路径\|别名]] 致正则失配，
       残留 `路径\` 尾反斜杠（审查文档已知的表格 \| 转义坑）；段尾再 rstrip 一次兜底 */
    const text = clean(raw).split('|').map(s => s.trim().replace(/\\+$/, '')).filter(Boolean).join(' · ')
      .replace(/\s+/g, ' ').trim().slice(0, 110);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({ kind: m[1], text });
    if (out.length >= cap) break;
  }
  return out;
};
/* 本卷待采清单：编号列表（1. …）为主，【】标记表格兜底 */
const listItems = (lines, cap = 16) => {
  const out = lines
    .map(l => l.trim())
    .filter(l => /^\d+[.、]\s*\S/.test(l))
    .map(l => l.replace(/^\d+[.、]\s*/, '')
      .replace(/\[\[[^\]|]*\|([^\]]+)\]\]/g, '$1').replace(/\[\[([^\]|]+)\]\]/g, '$1')
      .replace(/\s+/g, ' ').trim().slice(0, 110))
    .slice(0, cap)
    .map(text => ({ kind: '待采', text }));
  return out.length ? out : pendingItems(lines, cap);
};

export const chapter = (code, seq) => withDb(db => {
  const ch = db.prepare('SELECT * FROM chapters WHERE volume_code=? AND seq=? LIMIT 1').get(code, seq);
  if (!ch) return null;
  const v = db.prepare('SELECT * FROM volumes WHERE code=?').get(code);
  if (!v) return null;

  /* 正文/样章：本辑若是样章行，doc_path 即正文；另列本卷全部样章 */
  const volumeSamples = db.prepare('SELECT seq, title, doc_path FROM chapters WHERE volume_code=? AND is_sample=1 ORDER BY seq').all(code);
  const body = ch.is_sample ? { path: ch.doc_path, title: ch.title } : null;

  /* 提纲：卷级章节设计文档（design 行的 doc_path 即它；样章行按 volume 反查） */
  const outlineRow = db.prepare("SELECT path, title, body FROM documents WHERE volume=? AND doc_type='卷级章节设计' LIMIT 1").get(code)
    || (ch.doc_path && !ch.is_sample ? db.prepare('SELECT path, title, body FROM documents WHERE path=?').get(ch.doc_path) : null);
  let outline = null;
  let pending = [];
  let volumePending = [];
  if (outlineRow) {
    outline = { path: outlineRow.path, title: outlineRow.title, anchor: null, excerpt: null };
    const secs = splitSections(outlineRow.body);
    /* 本辑小节：标题前缀匹配（「辑一 纸上的家族」→「## 辑一 纸上的家族（约8章…）」），兜底「辑N 」 */
    const cn = CN_NUM[ch.seq] || '';
    const mine = (!ch.is_sample && ch.seq >= 1)
      ? secs.find(s => s.head.startsWith(ch.title) || (cn && new RegExp(`^辑${cn}\\s`).test(s.head)))
      : null;
    if (mine) {
      outline.anchor = mine.head;
      const intro = [];
      for (const l of mine.lines) {
        if (/^\s*\|/.test(l)) break;
        if (l.trim()) intro.push(l.trim());
        if (intro.length >= 3) break;
      }
      if (intro.length) outline.excerpt = intro.join(' ').replace(/\s+/g, ' ').slice(0, 180);
      pending = pendingItems(mine.lines);
    }
    const volList = secs.find(s => /待采清单/.test(s.head));
    if (volList) volumePending = listItems(volList.lines);
  }

  /* 本卷草稿：核心章节完稿按标题「第X卷」归属（documents.volume 未挂，标题可判） */
  const NUM2CODE = { '一': 'V1', '二': 'V2', '三': 'V3', '四': 'V4', '五': 'V5' };
  const drafts = db.prepare("SELECT path, title FROM documents WHERE doc_type='核心章节完稿'").all()
    .filter(d => { const m = d.title.match(/第([一二三四五])卷/); return m && NUM2CODE[m[1]] === code; });

  /* 共享台账 + 缺口台账（全卷通用工作件；只列现行版本） */
  const ledgers = db.prepare(`SELECT path, title, doc_type FROM documents
    WHERE path LIKE '长篇创作/%' AND doc_type IN ('运行台账','人物写作件','素材年表') ORDER BY path`).all()
    .map(l => ({ path: l.path, title: l.title, role: l.doc_type }));
  for (const g of db.prepare(`SELECT path, title FROM documents WHERE doc_type='素材缺口台账'
    OR path='项目管理/全库缺口与审计总台账-2026-09-04.md'`).all()) {
    ledgers.push({ path: g.path, title: g.title, role: g.path.startsWith('项目管理/') ? '全库现行台账' : '本卷缺口台账' });
  }

  return {
    chapter: {
      code, seq: ch.seq, title: ch.title, status: ch.status, is_sample: ch.is_sample,
      est_chapters: ch.est_chapters, est_words: ch.est_words,
    },
    volume: { code: v.code, name: v.name, years: v.years, line_metaphor: v.line_metaphor, mood: v.mood, color_token: v.color_token, word_target: v.word_target },
    outline,
    body,
    volumeSamples,
    drafts,
    ledgers,
    pending,
    volumePending,
    imagery: volImagery(db, code),
  };
});

/* ---------- 意象 ---------- */
/** 未解锁时剔除点名绝密人物的意象（如「绝密人物的书面评价」）——意象名本身即泄密 */
export const imagery = ({ unlocked = false } = {}) => withDb(db =>
  db.prepare(`SELECT i.*, (SELECT COUNT(*) FROM imagery_occurrences o WHERE o.imagery_id=i.id) occ FROM imagery i ORDER BY i.candidate, i.seq`).all()
    .filter(i => unlocked || !isSecretText(i.name)));

export const imageryOne = (id, { unlocked = false } = {}) => withDb(db => {
  const im = db.prepare('SELECT * FROM imagery WHERE id=?').get(id);
  if (!im) return null;
  if (!unlocked && isSecretText(im.name)) return { locked: true };
  const occurrences = db.prepare('SELECT * FROM imagery_occurrences WHERE imagery_id=? ORDER BY seq').all(id);
  /* v3.1 博物馆内容化：台账出处（occurrences 的 doc_id 未回链，出处统一指意象台账）
     + 同卷共展意象（volume_code 中文数字重叠度，JS 侧计算） */
  const ledger = db.prepare("SELECT path, title FROM documents WHERE path LIKE '%意象台账%' ORDER BY mtime DESC LIMIT 1").get() || null;
  const byCode = (vc) => (vc || '').split(/[、,，\/]/).map(s => s.trim()).filter(Boolean);
  const myCodes = new Set(occurrences.flatMap(o => byCode(o.volume_code)));
  const relatedImagery = myCodes.size
    ? db.prepare(`SELECT i.id, i.name, GROUP_CONCAT(o.volume_code) vcs FROM imagery i
      LEFT JOIN imagery_occurrences o ON o.imagery_id=i.id WHERE i.id!=? GROUP BY i.id`).all(id)
      .map(i => ({ id: i.id, name: i.name, co: (i.vcs || '').split(',').flatMap(byCode).filter(c => myCodes.has(c)).length }))
      .filter(r => r.co > 0 && (unlocked || !isSecretText(r.name))).sort((a, b) => b.co - a.co).slice(0, 6)
    : [];
  return { ...im, occurrences, ledgerPath: ledger?.path ?? null, relatedImagery };
});

/* ---------- 问卷 ---------- */
/** 未解锁时：父母卷（母亲/父亲）作答公开；其余卷连「作答人身份 + 文档路径」一并剥离，
 *  只留 { id, round, locked }——原实现只剥 answers，respondent_label/doc_path 仍外泄（26 条）。 */
export const questionnaires = ({ unlocked = false } = {}) => withDb(db =>
  db.prepare('SELECT id,round,respondent_label,relation_label,doc_path,answers FROM questionnaires ORDER BY id').all()
    .map(q => {
      const answers = J(q.answers, {});
      if (unlocked || isParentLabel(q.respondent_label)) return { ...q, answers };
      return { id: q.id, round: q.round, locked: true, answers: [] };
    }));

/* ---------- 文档 ---------- */
/** 门禁（三级）：public 正常返回；private 返回 { private:true }（server 层转 404，不可枚举）；
 *  secret（绝密人物全宗 / 卷二卷三）返回 { locked:true }（server 层转 403）。force=true 为已解锁后的取阅。 */
export const doc = (rawPath, opts = {}) => withDb(db => {
  const unlocked = !!opts.force;
  let p = decodeURIComponent(rawPath || '').replace(/^\/+/, '');
  if (!/\.md$/i.test(p)) p += '.md';
  const base = p.split('/').pop().replace(/\.md$/i, '');
  // 全路径优先；wikilink 点击常只带 basename，做一次兜底匹配
  const d = db.prepare('SELECT * FROM documents WHERE path=? OR path=? OR path LIKE ?')
    .get(p, p.replace(/\.md$/i, ''), `%/${base}.md`);
  if (!d) return null;
  if (!unlocked) {
    /* 私密层 → 与「不存在」不可区分（404）；绝密档案 → 明确 403 提示解锁 */
    if (d.is_private || isPrivatePath(d.path)) return { private: true };
    if (isSecretPath(d.path) || isSecretText(d.title)) return { locked: true };
    if (SECRET_VOLUMES.includes(String(d.volume || ''))) return { locked: true };
    /* 非父母卷的问卷作答全文属绝密（父母卷公开）——按 questionnaires.doc_path 精确匹配，
       勿用文件名模糊判断：「刘拓（父亲同事）」含「父亲」二字会误判 */
    if (String(d.path).includes(QUESTIONNAIRE_MARK)) {
      const qr = db.prepare('SELECT respondent_label FROM questionnaires WHERE doc_path=?').get(d.path);
      if (qr && !isParentLabel(qr.respondent_label)) return { locked: true };
    }
  }
  /* 反向链接：私密来源与（未解锁时的）绝密来源都不列出 */
  const blGuard = unlocked ? '' : " AND COALESCE(d.path,'') NOT LIKE '%私人资料%' AND COALESCE(d.path,'') NOT LIKE '%隐私%'"
    + ` AND COALESCE(d.title,'') NOT LIKE '%${SECRET_NAME}%'`;
  const backlinks = db.prepare(`SELECT DISTINCT d.path, d.title, d.domain FROM wikilinks w JOIN documents d ON d.path=w.from_doc
    WHERE w.to_target=? AND w.is_private=0 AND w.resolved=1 AND w.from_doc!=?${blGuard} LIMIT 60`).all(base, d.path);
  const pGuard = unlocked ? '' : entityGuardSql('e.');
  const persons = db.prepare(`SELECT e.id, e.display_name, e.relation_group, e.mention_count FROM entities e
    JOIN entity_mentions m ON m.entity_id=e.id WHERE m.doc_id=?${pGuard} ORDER BY e.mention_count DESC LIMIT 30`)
    .all(d.id, ...(unlocked ? [] : ENTITY_GUARD_PARAMS));
  const evidence = db.prepare('SELECT kind, COUNT(*) n FROM evidence_spans WHERE doc_id=? GROUP BY kind').all(d.id);
  const evSnippets = db.prepare('SELECT kind, snippet FROM evidence_spans WHERE doc_id=? LIMIT 24').all(d.id);
  /* v8 · 3.3 五向互链补全（检查器原只有「人物/反链/证据」三向）：
     - 同时间事件：本文档登记在册的时间线事件（timeline_events.doc_id 直连）
     - 相关意象：正文里真实出现过的意象名（imagery 表逐名子串命中，非伪造）
     两者同样受未解锁守卫约束（V2/V3 事件、绝密人物意象不外泄）。 */
  const tlGuard = unlocked ? '' : timelineGuardSql('t');
  const timeline = db.prepare(`SELECT t.id, t.year, t.month, t.title, t.kind FROM timeline_events t
    WHERE t.doc_id=?${tlGuard} ORDER BY t.year ASC, COALESCE(t.month,0) ASC LIMIT 24`).all(d.id);
  const imGuard = unlocked ? '' : imageryGuardSql();
  const bodyPlain = String(d.body || '').replace(/\*\*/g, '');
  const imagery = db.prepare(`SELECT i.id, i.name FROM imagery i WHERE i.candidate=0${imGuard} ORDER BY i.seq`)
    .all()
    .map(im => ({ id: im.id, name: String(im.name).replace(/\*\*/g, '') }))
    .filter(im => im.name.length >= 2 && bodyPlain.includes(im.name))
    .slice(0, 24)
    .map(im => ({ ...im, occ: db.prepare('SELECT COUNT(*) c FROM imagery_occurrences WHERE imagery_id=?').get(im.id).c }));
  return {
    id: d.id, path: d.path, title: d.title, domain: d.domain, doc_type: d.doc_type, stage: d.stage,
    volume: d.volume, meta: scrubMeta(J(d.meta, {}), unlocked), body: d.body, mtime: d.mtime,
    backlinks, persons, evidence, evSnippets, timeline, imagery,
  };
});

/* ---------- 检索 ---------- */
export function search(q, group, opts = {}) {
  const query = (q || '').trim();
  if (!query) return { groups: {}, terms: [] };
  const terms = query.split(/\s+/).filter(Boolean).slice(0, 6);
  const unlocked = !!opts.unlocked;
  /* v4 · C3 拼音检索：纯字母输入（全拼/首字母，如 zwz/zhaowenzhu）→ 匹配预计算拼音列 */
  const pinyinMode = /^[a-zA-Z]{2,}$/.test(query.replace(/\s+/g, ''));
  return withDb(db => {
    const groups = {};
    /* 最后一道出口净化（纵深防御）：即便将来某条 SQL 守卫被改动或新增分组忘了加守卫，
       这里也保证任何分组都不会把绝密姓名 / 私密路径带出去。 */
    const sanitize = () => sanitizeGroups(groups, unlocked);
    /* ===== 出口守卫 =====
       原实现的致命缺口：锁只加在 /api/doc 一处，检索出口全部裸奔——
       /api/search?q=zwz 能直接搜出「绝密人物」实体、私密路径与绝密问卷身份。
       未解锁时，私密层（私人资料/隐私）与绝密档案（绝密人物全宗 / 卷二卷三 / 非父母卷问卷）
       不得从任何分组出现：标题、路径、摘要一律过滤。 */
    const dGuard = unlocked ? '' : docGuardSql('d');
    const pGuard = unlocked ? '' : docGuardSql();
    const eGuard = unlocked ? '' : entityGuardSql();
    const eParams = unlocked ? [] : ENTITY_GUARD_PARAMS;
    const volGuard = unlocked ? '' : ` AND code NOT IN (${SECRET_VOLUMES.map(v => `'${v}'`).join(',')})`;
    const chGuard = unlocked ? '' : chapterGuardSql();
    const tlGuard = unlocked ? '' : timelineGuardSql('t');
    const imGuard = unlocked ? '' : imageryGuardSql();

    if (pinyinMode) {
      /* C3 拼音模式：全拼/首字母命中拼音列（如 zwz→绝密人物、yanhua→烟花） */
      const like = (col) => terms.map(() => `${col} LIKE ?`).join(' AND ');
      const pv = terms.flatMap(t => [`%${t.toLowerCase()}%`]);
      groups.person = db.prepare(`SELECT id,display_name,relation_group,stage,mention_count FROM entities
        WHERE ${like('pinyin')}${eGuard} ORDER BY mention_count DESC LIMIT 12`).all(...pv, ...eParams);
      groups.imagery = db.prepare(`SELECT id,name,candidate,(SELECT COUNT(*) FROM imagery_occurrences o WHERE o.imagery_id=imagery.id) occ
        FROM imagery WHERE ${like('pinyin')}${imGuard} LIMIT 12`).all(...pv);
      groups.timeline = db.prepare(`SELECT t.id,t.year,t.month,t.exact_date,t.stage,t.volume,t.kind,t.title FROM timeline_events t
        WHERE ${like('t.pinyin')}${tlGuard} ORDER BY t.year LIMIT 12`).all(...pv);
      const vol = db.prepare(`SELECT code,name AS title,'volume' typ FROM volumes WHERE ${like('pinyin')}${volGuard} LIMIT 8`).all(...pv);
      const ch = db.prepare(`SELECT volume_code AS code, title,'chapter' typ, doc_path, seq, is_sample FROM chapters
        WHERE ${like('pinyin')}${chGuard} LIMIT 12`).all(...pv);
      groups.volume = vol.concat(ch);
      // 文档标题拼音：ingest 预计算 title_pinyin 列，纯 SQL 命中（server 无需拼音库）
      const qq = terms.map(t => t.toLowerCase());
      const likeDoc = qq.map(() => `title_pinyin LIKE ?`).join(' AND ');
      groups.doc = db.prepare(`SELECT path,title,domain,stage FROM documents WHERE 1=1${pGuard} AND ${likeDoc} LIMIT 12`)
        .all(...qq.map(t => `%${t}%`)).map(r => ({ ...r, snippet: '' }));
      sanitize();
      return { groups, terms }; // 拼音模式到此为止，不落入中文分支覆盖结果
    }
    if (!group || group === 'doc') {
      let rows;
      if (terms.some(t => [...t].length < 3)) {
        // <3 字符走 LIKE 兜底（trigram 最小 3 字符）
        const where = terms.map(() => "(title LIKE ? OR body LIKE ?)").join(' AND ');
        const p = terms.flatMap(t => [`%${t}%`, `%${t}%`]);
        rows = db.prepare(`SELECT path,title,domain,stage FROM documents WHERE 1=1${pGuard} AND ${where} LIMIT 30`).all(...p)
          .map(r => ({ ...r, snippet: '' }));
      } else {
        const match = terms.map(t => `"${t.replace(/"/g, '')}"`).join(' AND ');
        /* 修复：原 FTS 分支只硬编码排除「问卷作答全文」，缺 is_private=0 —— 检索出口唯一漏私密的一支 */
        try {
          rows = db.prepare(`SELECT files_fts.path, files_fts.title, d.domain, d.stage, snippet(files_fts,-1,'<mark>','</mark>','…',16) sn
          FROM files_fts JOIN documents d ON d.id=files_fts.doc_id WHERE files_fts MATCH ?${dGuard} ORDER BY rank LIMIT 30`).all(match);
        } catch {
          /* 运行环境的 SQLite 未编译 FTS5（如部分精简发行版）→ LIKE 兜底，功能降级不崩 */
          const where = terms.map(() => "(title LIKE ? OR body LIKE ?)").join(' AND ');
          const p = terms.flatMap(t => [`%${t}%`, `%${t}%`]);
          rows = db.prepare(`SELECT path,title,domain,stage FROM documents WHERE 1=1${pGuard} AND ${where} LIMIT 30`).all(...p)
            .map(r => ({ ...r, snippet: '' }));
        }
      }
      groups.doc = rows;
    }
    if (!group || group === 'person') {
      const where = terms.map(() => "(display_name LIKE ? OR std_id LIKE ?)").join(' AND ');
      groups.person = db.prepare(`SELECT id,display_name,relation_group,stage,mention_count FROM entities WHERE ${where}${eGuard}
        ORDER BY mention_count DESC LIMIT 12`).all(...terms.flatMap(t => [`%${t}%`, `%${t}%`]), ...eParams);
    }
    if (!group || group === 'timeline') {
      const where = terms.map(() => 't.title LIKE ?').join(' AND ');
      groups.timeline = db.prepare(`SELECT t.id,t.year,t.month,t.exact_date,t.stage,t.volume,t.kind,t.title FROM timeline_events t
        WHERE ${where}${tlGuard} ORDER BY t.year LIMIT 12`).all(...terms.map(t => `%${t}%`));
    }
    if (!group || group === 'imagery') {
      const where = terms.map(() => 'name LIKE ?').join(' AND ');
      groups.imagery = db.prepare(`SELECT id,name,candidate,(SELECT COUNT(*) FROM imagery_occurrences o WHERE o.imagery_id=imagery.id) occ
        FROM imagery WHERE ${where}${imGuard} LIMIT 12`).all(...terms.map(t => `%${t}%`));
    }
    if (!group || group === 'volume') {
      groups.volume = db.prepare(`SELECT code,name AS title,'volume' typ FROM volumes WHERE name LIKE ?${volGuard} LIMIT 8`).all(...terms.map(t => `%${query}%`));
      if (groups.volume.length < 8) {
        const where = terms.map(() => 'title LIKE ?').join(' AND ');
        const ch = db.prepare(`SELECT volume_code AS code, title,'chapter' typ, doc_path, seq, is_sample FROM chapters WHERE ${where}${chGuard} LIMIT 12`).all(...terms.map(t => `%${t}%`));
        groups.volume = groups.volume.concat(ch);
      }
    }
    if (!group || group === 'questionnaire') {
      const where = terms.map(() => '(respondent_label LIKE ? OR answers LIKE ?)').join(' AND ');
      const qGuard = unlocked ? '' : questionnaireGuardSql();
      groups.questionnaire = db.prepare(`SELECT id,respondent_label,doc_path FROM questionnaires WHERE ${where}${qGuard} LIMIT 12`)
        .all(...terms.flatMap(t => [`%${t}%`, `%${t}%`]))
        /* 即便行被父母卷守卫挡下，身份字段仍不能外泄——非父母卷一律只回 {id, locked} */
        .map(r => (unlocked || isParentLabel(r.respondent_label)) ? r : { id: r.id, locked: true });
    }
    sanitize();
    return { groups, terms };
  });
}

/* ---------- v4 · C4 伏应矩阵（五卷书房创作台账；等级序 🔴跨卷→青铜中等级→淡低等级） ---------- */
export function foreshadow({ unlocked = false } = {}) {
  return withDb(db => ({
    rows: sanitizeForeshadow(
      db.prepare(`SELECT id,level,material,plant,harvest,method,status FROM foreshadow
        ORDER BY CASE level WHEN '🔴' THEN 0 WHEN '青铜' THEN 1 ELSE 2 END, id`).all(),
      unlocked,
    ),
  }));
}

/* ---------- 审计 ---------- */
export const auditLatest = () => withDb(db => {
  const a = db.prepare('SELECT * FROM audit_runs ORDER BY id DESC LIMIT 1').get();
  if (a) a.manifest = J(a.manifest, {});
  return a;
});

export const yearDensity = () => withDb(db => db.prepare('SELECT year, docs FROM year_density ORDER BY year').all());
