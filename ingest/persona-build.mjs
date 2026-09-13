#!/usr/bin/env node
/**
 * ΜΝΗΜΗ · persona-build —— 人物「人格体语料包 + 人格规格」构建（P0）
 *
 * 定位：为每个人物产出可对话的语料基底，供前端**本地模型**推理使用。
 *   · persona_pack —— 「能说什么」：分块语料 + tier 分级（public/private/secret）
 *   · persona_spec —— 「怎么说话 / 边界在哪」：六维人格规格（抽取式）
 *
 * 设计铁律：
 *   1. **纯抽取式、不调用任何 LLM**（零账单约束）。所有维度只允许「统计 + 引用原文片段」，
 *      绝不生成新表述——否则就是往人格里注入编造。
 *   2. **tier 由 server/privacy.mjs 单点判定**（唯一事实来源），本文件不得自行复写规则。
 *   3. 构建期允许读取私密层正文（私密正文已入库）；**运行时由服务端按 unlock 状态过滤**，
 *      未授权 chunk 绝不外发。
 *   4. **不得用 mention_count 推断人格或亲疏**（站内铁律）——它只用于门槛判定。
 *
 * 用法：
 *   node --experimental-sqlite ingest/persona-build.mjs
 *   （通常由 ingest/ingest.mjs 末尾自动调用）
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isPrivatePath, isSecretPath, isSecretText } from '../server/privacy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB = path.join(HERE, 'mneme.db');

/* ---------- 参数 ---------- */
const CHUNK_TARGET = 800;        // 目标块长（字符）
const CHUNK_MIN = 60;            // 小于此长度丢弃
const CHUNK_HARD = 1200;         // 单块硬上限
const MAX_CHUNKS = 900;          // 每人 chunk 上限（全量资料口径：放宽；检索仍按预算取 top-K）
const SUMMARY_MAX = 6000;        // 人格基底字符上限

/** 语言特征类语料（唯一能支撑"像他说话"的载体） */
const LANG_RE = /聊天记录|朋友圈|问卷作答|chat|wechat|qq|微信|群聊/i;
/** 支撑素材（门槛判定用） */
const SUPPORT_RE = /聊天记录|朋友圈|问卷|证书|关系图谱|人物分析|成长记录|学业档案|时间线|影像|人物资料/i;

/* ---------- 文本工具 ---------- */
const STOP = new Set(['的', '了', '是', '在', '我', '你', '他', '她', '它', '和', '与', '就', '也', '都', '而', '及', '或', '一个', '这个', '那个', '我们', '他们', '你们', '自己', '没有', '什么', '怎么', '因为', '所以', '但是', '然后', '还是', '可以', '这样', '那样', '一些', '时候', '不会', '不是', '就是', '而且', '已经', '不过', '如果', '只是', '不能']);

/** 按空行分段 → 合并到目标块长 → 超长按句号再切 */
function splitChunks(raw) {
  const text = String(raw || '').replace(/\r\n/g, '\n').trim();
  if (!text) return [];
  const paras = text.split(/\n{2,}/).map(s => s.replace(/\n+/g, ' ').trim())
    .filter(s => s.length >= 12 && !/^#{1,6}\s*$/.test(s));
  const out = [];
  let buf = '';
  const flush = () => { const t = buf.trim(); if (t.length >= CHUNK_MIN) out.push(t); buf = ''; };
  for (const p of paras) {
    if (p.length > CHUNK_HARD) {
      flush();
      for (const s of p.split(/(?<=[。！？；!?])/)) {
        const seg = s.trim();
        if (!seg) continue;
        if ((buf + seg).length > CHUNK_HARD) flush();
        buf += seg;
      }
      flush();
      continue;
    }
    if ((buf + ' ' + p).length > CHUNK_TARGET && buf) flush();
    buf += (buf ? ' ' : '') + p;
  }
  flush();
  return out;
}

/** 中文 bigram 集合（供服务端检索复用；此处导出以免两处实现漂移） */
export function bigrams(s) {
  const t = String(s || '').replace(/[\s\p{P}]+/gu, '');
  const set = new Set();
  if (t.length === 1) { set.add(t); return set; }
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
}

/** n-gram 词频（n=2..4），去停用词 */
function topNgrams(text, limit = 10, minCount = 3) {
  const t = String(text || '').replace(/[\s\p{P}a-zA-Z0-9]+/gu, ' ');
  const freq = new Map();
  for (const seg of t.split(/\s+/)) {
    if (!seg) continue;
    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i + n <= seg.length; i++) {
        const g = seg.slice(i, i + n);
        if (STOP.has(g)) continue;
        freq.set(g, (freq.get(g) || 0) + 1);
      }
    }
  }
  return [...freq.entries()].filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .slice(0, limit).map(([g, c]) => ({ g, c }));
}

/** 抽句子（含任一关键词），返回原文片段（不加工） */
function pickSentences(text, re, limit = 8, maxLen = 60) {
  const out = [];
  for (const s of String(text || '').split(/(?<=[。！？!?；;\n])/)) {
    const t = s.trim();
    if (t.length < 8 || t.length > 200) continue;
    if (!re.test(t)) continue;
    out.push(t.length > maxLen ? t.slice(0, maxLen) + '…' : t);
    if (out.length >= limit) break;
  }
  return [...new Set(out)];
}

/** 标点/语气画像（抽取式统计） */
function punctProfile(texts) {
  let endPeriod = 0, endBang = 0, endQ = 0, endNone = 0;
  for (const t of texts) {
    for (const s of String(t).split(/(?<=[。！？!?；;\n])/)) {
      const s2 = s.trim();
      if (s2.length < 4) continue;
      const last = s2.slice(-1);
      if (last === '。') endPeriod++;
      else if (last === '！' || last === '!') endBang++;
      else if (last === '？' || last === '?') endQ++;
      else endNone++;
    }
  }
  const total = endPeriod + endBang + endQ + endNone;
  if (!total) return null;
  return { 句号: Math.round(endPeriod / total * 100), 叹号: Math.round(endBang / total * 100), 问号: Math.round(endQ / total * 100), 无标点: Math.round(endNone / total * 100), 样本句: total };
}

/** 高频称呼/人称（抽取式计数） */
const ADDRESS = ['我', '你', '您', '他', '她', '哥', '姐', '弟', '妹', '老师', '同学', '同桌', '班长', '朋友', '爸', '妈'];
function addressProfile(texts) {
  const joined = texts.join('\n');
  if (!joined) return [];
  return ADDRESS.map(w => ({ w, c: joined.split(w).length - 1 }))
    .filter(x => x.c >= 3).sort((a, b) => b.c - a.c).slice(0, 6);
}

/** 年份/事件抽取（抽取式） */
function extractFacts(texts, years) {
  const facts = [];
  for (const y of years) facts.push({ year: y, phrase: '（纪年锚点）' });
  const seen = new Set();
  for (const t of texts) {
    for (const s of String(t).split(/(?<=[。！？!?；;\n])/)) {
      const s2 = s.trim();
      if (s2.length < 8 || s2.length > 160) continue;
      const m = s2.match(/(19|20)\d{2}/);
      if (!m) continue;
      const key = s2.slice(0, 24);
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push({ year: Number(m[0]), phrase: s2.length > 70 ? s2.slice(0, 70) + '…' : s2 });
      if (facts.length >= 24) break;
    }
    if (facts.length >= 24) break;
  }
  return facts;
}

/* ---------- 建表 ---------- */
const DDL = `
CREATE TABLE IF NOT EXISTS persona_pack (
  entity_id INTEGER PRIMARY KEY,
  display_name TEXT,
  mention_count INTEGER,
  has_role_doc INTEGER,
  support_assets INTEGER,
  can_chat INTEGER,
  has_lang_corpus INTEGER,
  tier_counts TEXT,
  chunks TEXT,
  built_at TEXT
);
CREATE TABLE IF NOT EXISTS persona_spec (
  entity_id INTEGER PRIMARY KEY,
  lang_style TEXT,
  facts TEXT,
  relations TEXT,
  values_topics TEXT,
  habits TEXT,
  boundaries TEXT,
  summary TEXT,
  lang_confirmed_by TEXT,
  built_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_persona_can_chat ON persona_pack(can_chat);
`;

/* ---------- 主流程 ---------- */
export function buildPersonas(dbPath = DEFAULT_DB, opts = {}) {
  const t0 = Date.now();
  const log = opts.quiet ? () => {} : (...a) => console.log('  ', ...a);
  if (!fs.existsSync(dbPath)) throw new Error(`未找到数据库：${dbPath}`);
  const db = new DatabaseSync(dbPath);
  db.exec(DDL);

  const docs = new Map();          // id → {path,title,raw,domain,docType,isPrivate}
  for (const d of db.prepare('SELECT id, path, title, raw_text, domain, doc_type, is_private FROM documents').all()) {
    docs.set(Number(d.id), {
      path: String(d.path || ''), title: String(d.title || ''), raw: String(d.raw_text || ''),
      domain: String(d.domain || ''), docType: String(d.doc_type || ''), isPrivate: Number(d.is_private) === 1,
    });
  }
  const byPath = new Map([...docs.values()].map(d => [d.path, d]));

  const mentions = new Map();      // entity_id → [{docId,hits}]
  for (const m of db.prepare('SELECT entity_id, doc_id, hits FROM entity_mentions').all()) {
    const k = Number(m.entity_id);
    if (!mentions.has(k)) mentions.set(k, []);
    mentions.get(k).push({ docId: Number(m.doc_id), hits: Number(m.hits) || 0 });
  }
  const evid = new Map();          // doc_id → [{kind,snippet}]
  for (const e of db.prepare('SELECT doc_id, kind, snippet FROM evidence_spans').all()) {
    const k = Number(e.doc_id);
    if (!evid.has(k)) evid.set(k, []);
    evid.get(k).push({ kind: String(e.kind || ''), snippet: String(e.snippet || '') });
  }
  const yearsOf = new Map();       // doc_id → [year]
  for (const t of db.prepare('SELECT doc_id, year FROM timeline_events WHERE doc_id IS NOT NULL AND year IS NOT NULL').all()) {
    const k = Number(t.doc_id);
    if (!yearsOf.has(k)) yearsOf.set(k, []);
    yearsOf.get(k).push(Number(t.year));
  }
  const privateDocs = [...docs.values()].filter(d => d.isPrivate);

  /* ---------- 姓名精度守卫（防"语料串味"的核心） ----------
     · 通用称谓（母亲/父亲/老师/同学…）**禁止**正文含名匹配：这类词在语料里到处出现，
       会把别人家的母亲、叙述性文字整篇灌进这个人物——这正是"搞混"的最大来源。
     · 具体姓名也有子串误命中（「张三」命中「张三丰」）与同名实体问题，
       宽松匹配要求满足其一：**文档标题含其姓名** 或 **密度达标**（≥8 次，或 ≥3 次/千字）。
     · 同名多实体时无法可靠归属 → 一律不做正文匹配（宁缺毋滥，资料以双链与自档为准）。 */
  const GENERIC_NAME_RE = /^(母亲|父亲|妈妈|爸爸|爸|妈|老师|同学|爷爷|奶奶|外公|外婆|叔叔|阿姨|伯父|伯母|舅舅|舅妈|姑母|姑父|哥哥|姐姐|弟弟|妹妹|表哥|表姐|表弟|表妹|堂哥|堂姐|堂弟|堂妹|教练|同桌|朋友|邻居|某某)$/;
  const nameCount = new Map();
  for (const r of db.prepare('SELECT display_name n, COUNT(*) c FROM entities GROUP BY display_name HAVING c > 1').all()) {
    nameCount.set(String(r.n || ''), Number(r.c));
  }
  const looseAllowed = (nm) => !!nm && !GENERIC_NAME_RE.test(nm) && !nameCount.has(nm);
  const isAbout = (d, nm) => {
    if (!looseAllowed(nm)) return false;
    if (String(d.title || '').includes(nm)) return true;
    const c = d.raw.split(nm).length - 1;
    if (c === 0) return false;
    if (c >= 8) return true;
    return (c / (d.raw.length / 1000)) >= 3;
  };

  const insPack = db.prepare(`INSERT INTO persona_pack(entity_id,display_name,mention_count,has_role_doc,support_assets,can_chat,has_lang_corpus,tier_counts,chunks,built_at)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(entity_id) DO UPDATE SET
    display_name=excluded.display_name, mention_count=excluded.mention_count, has_role_doc=excluded.has_role_doc,
    support_assets=excluded.support_assets, can_chat=excluded.can_chat, has_lang_corpus=excluded.has_lang_corpus,
    tier_counts=excluded.tier_counts, chunks=excluded.chunks, built_at=excluded.built_at`);
  const insSpec = db.prepare(`INSERT INTO persona_spec(entity_id,lang_style,facts,relations,values_topics,habits,boundaries,summary,built_at)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(entity_id) DO UPDATE SET
    lang_style=excluded.lang_style, facts=excluded.facts, relations=excluded.relations,
    values_topics=excluded.values_topics, habits=excluded.habits, boundaries=excluded.boundaries,
    summary=excluded.summary, built_at=excluded.built_at`);

  const now = new Date().toISOString();
  const ents = db.prepare('SELECT id, display_name, role_doc_path, mention_count, first_year, last_year, relation_group, stage, aliases FROM entities').all();
  const stat = { entities: 0, canChat: 0, langCorpus: 0, chunksPublic: 0, chunksPrivate: 0, chunksSecret: 0, noRoleDoc: 0, skipped: 0 };

  db.exec('BEGIN');
  try {
    for (const e of ents) {
      const eid = Number(e.id);
      const name = String(e.display_name || '').trim();
      if (!name) { stat.skipped++; continue; }
      const rolePath = String(e.role_doc_path || '');
      const roleDoc = rolePath ? byPath.get(rolePath) : null;
      const isSecretEntity = isSecretText(name);
      const secret = isSecretEntity || (!!rolePath && isSecretPath(rolePath));

      /* ---- 语料装配 ---- */
      const chunks = [];
      let cid = 0;
      const push = (text, tier, p, kind, year, evKind) => {
        const t = String(text || '').trim();
        if (t.length < CHUNK_MIN) return;
        cid += 1;
        chunks.push({ id: cid, tier, text: t, path: p || '', kind: kind || '', year: year ?? null, evidence_kind: evKind || '' });
      };
      const tierOf = (doc) => (secret || (doc && isSecretPath(doc.path)) ? 'secret'
        : (doc && (doc.isPrivate || isPrivatePath(doc.path)) || isPrivatePath(rolePath)) ? 'private' : 'public');

      // ① 自档页
      if (roleDoc) {
        for (const c of splitChunks(roleDoc.raw)) push(c, tierOf(roleDoc), roleDoc.path, '自档', e.first_year ?? null, '');
      }
      // ② 共现文档：**全量**——林哥要求每个人物用尽知识库里与其对应的全部资料
      const ms = (mentions.get(eid) || []).slice().sort((a, b) => b.hits - a.hits);
      const seenDocs = new Set();
      const langTexts = [];
      for (const m of ms) {
        const d = docs.get(m.docId);
        if (!d || d.isPrivate || isSecretPath(d.path)) continue;
        if (d.path === rolePath) continue;
        seenDocs.add(m.docId);
        for (const c of splitChunks(d.raw)) push(c, 'public', d.path, d.domain || d.docType || '共现', (yearsOf.get(m.docId) || [])[0] ?? null, '');
        /* 语言特征语料必须是**他本人的**语料（其聊天记录／朋友圈／问卷作答全文）：
           仅「文件名像语言载体」不够，还要求路径含其姓名——否则会把别人的语气当成他的。 */
        if (LANG_RE.test(d.path) && d.path.includes(name)) langTexts.push(d.raw);
      }
      // ②b 公开层**正文命中**补充（带精度守卫）：有些资料提到他但没有双链（entity_mentions 抓不到）
      if (looseAllowed(name)) {
        for (const [docId, d] of docs) {
          if (d.isPrivate || isSecretPath(d.path)) continue;
          if (d.path === rolePath || seenDocs.has(docId)) continue;
          if (!isAbout(d, name)) continue;
          seenDocs.add(docId);
          for (const c of splitChunks(d.raw)) push(c, 'public', d.path, d.domain || d.docType || '提及', null, '');
          if (LANG_RE.test(d.path) && d.path.includes(name)) langTexts.push(d.raw);
        }
      }
      // ③ 证据片段（全量共现文档）
      for (const m of ms) {
        for (const sp of evid.get(m.docId) || []) {
          const d = docs.get(m.docId);
          if (!d || d.isPrivate) continue;
          push(sp.snippet, 'public', d.path, '证据', null, sp.kind);
        }
      }
      // ④ 私密正文补充（构建期唯一途径：entity_mentions 不挂私密文档）——同样带精度守卫
      if (!secret && looseAllowed(name)) {
        for (const d of privateDocs) {
          if (!isAbout(d, name)) continue;
          for (const c of splitChunks(d.raw)) push(c, 'private', d.path, d.domain || '私密', null, '');
          if (LANG_RE.test(d.path) && d.path.includes(name)) langTexts.push(d.raw);
        }
      }
      // 截断：public 优先、id 升序
      if (chunks.length > MAX_CHUNKS) {
        const keep = chunks.filter(c => c.tier === 'public').slice(0, MAX_CHUNKS);
        const rest = chunks.filter(c => c.tier !== 'public');
        chunks.length = 0;
        chunks.push(...keep);
        for (const c of rest) { if (chunks.length >= MAX_CHUNKS) break; chunks.push(c); }
        chunks.sort((a, b) => a.id - b.id);
      }

      /* ---- 门槛与统计 ---- */
      const hasRoleDoc = !!roleDoc;
      if (!hasRoleDoc) stat.noRoleDoc++;
      const roleSize = roleDoc ? roleDoc.raw.length : 0;
      /* 支撑素材：必须是"该人物确实出现在其中"（走 entity_mentions 链接，精确）或私密命中；
         不能用「任意公开文档正文含该姓名」——那对常见姓名会大量误判。 */
      const supportDocs = ms.map(m => docs.get(m.docId)).filter(d => d && !d.isPrivate && SUPPORT_RE.test(d.path));
      const hasSupport = (supportDocs.length > 0 || privateDocs.some(d => d.raw.includes(name))) ? 1 : 0;
      const mention = Number(e.mention_count) || 0;
      const canChat = hasRoleDoc && (mention >= 20 || roleSize >= 4096 || hasSupport === 1) ? 1 : 0;
      const hasLang = langTexts.length > 0 ? 1 : 0;
      const tierCounts = { public: 0, private: 0, secret: 0 };
      for (const c of chunks) tierCounts[c.tier] = (tierCounts[c.tier] || 0) + 1;

      /* ---- 六维人格规格（纯抽取式） ---- */
      const selfText = roleDoc ? roleDoc.raw : '';
      const langCorpusTexts = langTexts.length ? langTexts : [];
      const langStyle = langCorpusTexts.length ? {
        语料载体: langCorpusTexts.length + ' 份',
        标点画像: punctProfile(langCorpusTexts),
        称呼人称: addressProfile(langCorpusTexts),
        高频片段: topNgrams(langCorpusTexts.join('\n'), 8, 3),
        原句示例: pickSentences(langCorpusTexts.join('\n'), /./, 5, 50),
        _note: '纯抽取式统计；未生成任何新表述',
      } : null;

      const allTexts = [selfText, ...chunks.filter(c => c.tier !== 'public').map(c => c.text)];
      const facts = extractFacts([selfText], (yearsOf.get([...docs.entries()].find(([, d]) => d.path === rolePath)?.[0]) || []).slice(0, 8));
      const relations = pickSentences(selfText, /同学|老师|父亲|母亲|家人|朋友|同桌|班长|班主任|教练|亲戚|哥|姐|弟|妹|叔叔|阿姨/, 10, 60);
      const valuesTop = topNgrams(selfText, 12, 2);
      const habits = pickSentences(allTexts.join('\n'), /经常|总是|每次|习惯|喜欢|每天|常常|一向|偶尔/, 8, 60);

      const missing = [];
      if (!hasLang) missing.push('无语言特征类语料（聊天记录／朋友圈／问卷）——无法模仿其口吻');
      if (tierCounts.private === 0) missing.push('无私密层素材');
      if (!/大学|四川大学|强基/.test(selfText)) missing.push('无大学阶段素材');
      if (!/小学|初中|高中/.test(selfText)) missing.push('无中小学学段素材');
      if (!/父|母|家/.test(selfText)) missing.push('无家庭素材');
      if (mention < 20) missing.push('全库提及量偏低，语料稀薄');
      if (missing.length === 0) missing.push('（未检出明显缺口）');

      const summaryParts = [
        `【人物】${name}`,
        e.relation_group ? `【关系分组】${e.relation_group}` : '',
        e.stage ? `【学段】${e.stage}` : '',
        (e.first_year || e.last_year) ? `【时间跨度】${e.first_year ?? '—'}–${e.last_year ?? '—'}` : '',
        `【语料】自档${hasRoleDoc ? '有' : '无'}·公开块${tierCounts.public}·私密块${tierCounts.private}·绝密块${tierCounts.secret}·语言特征语料${hasLang ? '有' : '无'}`,
        langStyle ? `\n【语域特征·抽取】标点画像 ${JSON.stringify(langStyle.标点画像)}\n称呼人称 ${langStyle.称呼人称.map(x => `${x.w}×${x.c}`).join(' ')}\n高频片段 ${langStyle.高频片段.map(x => x.g).join('、')}` : '\n【语域特征】无可用的语言特征语料——不要模仿口吻，用中性表达。',
        facts.length ? `\n【可核事实（${facts.length} 条，抽取自档案）】\n` + facts.slice(0, 12).map(f => `· ${f.year} ${f.phrase}`).join('\n') : '',
        relations.length ? `\n【关系原句（抽取，非推断）】\n` + relations.slice(0, 6).map(s => `· ${s}`).join('\n') : '',
        valuesTop.length ? `\n【高频话题词】${valuesTop.map(x => x.g).join('、')}` : '',
        `\n【信息边界（你不知道的部分）】\n` + missing.map(s => `· ${s}`).join('\n'),
      ].filter(Boolean).join('\n');
      const summary = summaryParts.length > SUMMARY_MAX
        ? summaryParts.slice(0, SUMMARY_MAX) + '\n…（已截断）'
        : summaryParts;

      insPack.run(eid, name, mention, hasRoleDoc ? 1 : 0, hasSupport, canChat, hasLang,
        JSON.stringify(tierCounts), JSON.stringify(chunks), now);
      insSpec.run(eid, langStyle ? JSON.stringify(langStyle) : null, JSON.stringify(facts),
        JSON.stringify(relations), JSON.stringify(valuesTop), JSON.stringify(habits),
        JSON.stringify(missing), summary, now);

      stat.entities++;
      stat.canChat += canChat;
      stat.langCorpus += hasLang;
      stat.chunksPublic += tierCounts.public;
      stat.chunksPrivate += tierCounts.private;
      stat.chunksSecret += tierCounts.secret;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.close();
    throw err;
  }
  db.close();
  stat.ms = Date.now() - t0;
  log(`persona_pack/persona_spec 写入完成：entity=${stat.entities} canChat=${stat.canChat} hasLangCorpus=${stat.langCorpus}`);
  log(`chunks: public=${stat.chunksPublic} private=${stat.chunksPrivate} secret=${stat.chunksSecret} · 无自档=${stat.noRoleDoc} · 耗时 ${stat.ms}ms`);
  return stat;
}

/* ---------- CLI ---------- */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('=== ΜΝΗΜΗ · persona-build ===');
  try {
    const s = buildPersonas(process.argv[2] || DEFAULT_DB);
    console.log(`=== 完成：${s.entities} 人 · 可对话 ${s.canChat} · 有语言语料 ${s.langCorpus} ===`);
  } catch (e) {
    console.error('persona-build 失败：', e.message);
    process.exitCode = 1;
  }
}
