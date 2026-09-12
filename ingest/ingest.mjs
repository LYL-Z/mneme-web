/**
 * ΜΝΗΜΗ · M1 只读 ETL（v3 §4.3 schema）
 * 对 vault 绝对只读（网站不写回）。私密层入库但零出站（is_private=1，API 未解锁当 404）。
 * 附件二进制仍不读。公开层敏感字段入库前掩码。
 * 产物：ingest/mneme.db（SQLite，本地开发库）+ ingest/snapshot.json（PG 灌库快照）
 * 运行：node --experimental-sqlite ingest.mjs
 * 增量：mtime 未变且 ingest 版本一致时跳过读盘，仍全量重建 SQLite（FTS/实体需全局重算）。
 * 掩码规则或版本变更后请设 MNEME_INGEST_FULL=1。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import Pinyin from 'tiny-pinyin';
import { BOOKS, parseCatalog, parseForeshadow, volumeOfRel } from './catalog.mjs';

const VAULT = process.env.MNEME_VAULT || 'D:/The Memory/The Memory';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.MNEME_DB || path.join(HERE, 'mneme.db');
const SNAP_PATH = path.join(HERE, 'snapshot.json');
const INGEST_VERSION = 'mneme-ingest-1.1.0-handbook';

const SYS_DIRS = new Set(['.git', '.obsidian', '.claudian', '.workbuddy', '.trash', '.smart-env', 'node_modules', 'tmp', 'scripts']);
const PRIVACY_SEGS = new Set(['私人资料', '隐私']);
const ASSET_EXT = /\.(png|jpe?g|gif|webp|svg|pdf|mp4|mp3|wav|zip|excalidraw|csv|txt)$/i;

const startedAt = new Date().toISOString();
const audit = { scanned: 0, ingested: 0, excluded_private: 0, excluded_private_other: 0, excluded_system: 0, excluded_excalidraw: 0, masked: 0, maskEvents: [], parseErrors: 0, reused: 0 };

/* ---------- 1. 遍历与分类（私密层零读取） ---------- */
const rawFiles = [];
(function walk(dir) {
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('~$')) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name.startsWith('.') || SYS_DIRS.has(e.name)) { audit.excluded_system++; continue; }
      walk(abs);
    } else if (e.isFile()) rawFiles.push({ abs, rel: path.relative(VAULT, abs).split(path.sep).join('/') });
  }
})(VAULT);

const docs = []; const privatePaths = new Set(); const allPublicPaths = new Set();
const normKey = (s) => s.toLowerCase().replace(/[（(【\[]?(私密|隐私)[）)】\]]?/g, '').replace(/[\s（）()【】\-_.·]/g, '');
const privacyNorm = new Set();   // 私密层归一化名（路径与文件名）
const privacyNames = new Set();  // 私密层 md 基名（搜索层脱敏用）
const privacySegTest = (s) => /私人资料|(^|\/)隐私\//.test(s);
for (const f of rawFiles) {
  const segs = f.rel.split('/');
  if (segs.some(s => PRIVACY_SEGS.has(s))) {
    audit.excluded_private++;
    if (!/\.(md|png|jpe?g|gif|webp|svg|pdf|mp4|mp3|csv|txt)$/i.test(f.rel)) audit.excluded_private_other++;
    const base = path.basename(f.rel).replace(/\.md$/i, '');
    privatePaths.add(f.rel.replace(/\.md$/i, '').toLowerCase());
    privatePaths.add(base.toLowerCase());
    privacyNorm.add(normKey(f.rel.replace(/\.md$/i, ''))); privacyNorm.add(normKey(base));
    if (f.rel.toLowerCase().endsWith('.md')) privacyNames.add(base);
    continue; // 附件（图片/音视频等二进制）仍不入库——只收录私密层 md 正文
  }
  if (!f.rel.toLowerCase().endsWith('.md')) continue;
  if (segs[0] === 'Excalidraw') { audit.excluded_excalidraw++; continue; }
  allPublicPaths.add(f.rel.replace(/\.md$/i, '').toLowerCase());
}
/* v4 · 私密层 md 收录（加密门禁后展示）：仅正文与元数据入 documents（is_private=1），
   不入 FTS 索引、不贡献实体提及/证据片段/聚合统计；附件二进制零提取不变。 */
const privateMdFiles = new Set(rawFiles.filter(f => {
  const segs = f.rel.split('/');
  return f.rel.toLowerCase().endsWith('.md') && segs.some(s => PRIVACY_SEGS.has(s));
}).map(f => f.rel));
audit.private_collected = privateMdFiles.size;
const publicBase = new Map();
for (const p of allPublicPaths) { const b = p.split('/').pop(); publicBase.set(b, (publicBase.get(b) || 0) + 1); }
audit.scanned = rawFiles.length;

/* ---------- 2. 解析工具 ---------- */
const fmField = (block, key) => {
  const m = block.match(new RegExp(`^${key}\\s*[:：]\\s*(.+)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
};
const fmTags = (block) => {
  const inline = block.match(/^tags\s*[:：]\s*\[(.+)\]/m);
  if (inline) return inline[1].split(/[,，]/).map(s => s.trim()).filter(Boolean);
  const m = block.match(/^tags\s*[:：]\s*$/m);
  if (m) {
    const idx = block.indexOf(m[0]);
    const out = [];
    for (const line of block.slice(idx + m[0].length).split('\n')) {
      const t = line.match(/^\s*-\s*(.+)$/); if (t) out.push(t[1].trim()); else if (out.length) break;
    }
    return out;
  }
  return [];
};
const metaField = (raw, key) => {
  const m = raw.match(new RegExp(`\\*\\*${key}\\*\\*\\s*[:：]\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : null;
};
const splitList = (s) => s ? s.split(/\s*[·、,，;；]\s*/).filter(Boolean) : [];
const relatedLinks = (s) => s ? [...s.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map(m => m[1].trim()) : [];

/* 域归并（frontmatter 优先，杂值按目录回退，全部记录在 audit.domainsFallback） */
const CANON_DOMAINS = new Set(['人物谱系', '成长叙事', '写作技法', '风格参考', '创作规格', '长篇创作', '背景资料', '审美档案', '项目运维', '私密层']);
audit.domainsFallback = {};
function domainOf(fmDomain, rel) {
  if (fmDomain && CANON_DOMAINS.has(fmDomain)) return fmDomain;
  let d;
  const top = rel.split('/')[0];
  if (rel.startsWith('写作体系/技法库/')) d = '写作技法';
  else if (rel.startsWith('写作体系/风格参考/')) d = '风格参考';
  else if (top === '写作体系') d = '创作规格';
  else if (['初中', '高中', '小学', '大学', '家庭', '人物关系', '问卷回收'].includes(top)) d = '成长叙事';
  else if (top === '文化与审美') d = '审美档案';
  else if (top === '背景资料') d = '背景资料';
  else if (top === '项目管理') d = '项目运维';
  else if (top === '长篇创作' || top === '百万长文写作') d = '长篇创作';
  else d = '项目运维';
  const key = `${fmDomain || '(空)'}→${d}`;
  audit.domainsFallback[key] = (audit.domainsFallback[key] || 0) + 1;
  return d;
}
/* 学段归并 */
const STAGE_MAP = { '高等教育': '大学', '大学（境外）': '大学', '大学（大一下学期）': '大学', '大学（大一下暑假）': '大学', '完全中学': '跨学段', '十二年一贯制或完全中学相关办学形态（按具体年份核对）': '跨学段', '小学；初中；高中；大学': '跨学段', '高中；大学': '跨学段' };
function stageOf(fmStage, rel) {
  if (fmStage) { if (STAGE_MAP[fmStage]) return STAGE_MAP[fmStage]; if (['小学', '初中', '高中', '大学', '家庭', '跨学段'].includes(fmStage)) return fmStage; }
  const top = rel.split('/')[0];
  if (['小学', '初中', '高中', '大学', '家庭'].includes(top)) return top === '家庭' ? '家庭' : top;
  return '跨学段';
}
function stageOfPath(rel) {
  if (/G2204|G2205|麓山|2025届/.test(rel)) return '高中';
  if (/金海|1907/.test(rel)) return '初中';
  if (/实验小学|86班|1305/.test(rel)) return '小学';
  if (/四川大学|川大|浙江大学|强基/.test(rel)) return '大学';
  if (rel.startsWith('家庭/')) return '家庭';
  return null;
}

/* 敏感字段掩码（入库前执行；vault 原文不动） */
const MASK_RULES = [
  ['phone', /(?<!\d)1[3-9]\d{9}(?!\d)/g, m => m.slice(0, 3) + '****' + m.slice(7)],
  ['idcard', /(?<!\d)\d{17}[\dXx](?!\d)/g, m => m.slice(0, 6) + '********' + m.slice(-4)],
  ['qq', /(QQ\s*(号)?\s*[:：]\s*)(\d{5,11})/gi, (m, g) => g[1] + g[3].slice(0, 2) + '****' + g[3].slice(-2)],
  ['wechat', /((?:微信|WeChat|weixin)\s*(?:号|ID)?\s*[:：]\s*)([A-Za-z0-9_-]{6,20})/g, (m, g) => g[1] + g[2].slice(0, 2) + '****'],
  ['examNo', /((?:准考证号?|考号|学号|报名号)\s*[:：]?\s*)(\d{6,})/g, (m, g) => g[1] + g[2].slice(0, 4) + '****'],
];
function maskText(text, rel) {
  let out = text; let n = 0; const kinds = [];
  for (const [kind, re, fn] of MASK_RULES) {
    out = out.replace(re, (...args) => {
      const groups = args.slice(0, -2);
      n++; if (!kinds.includes(kind)) kinds.push(kind);
      return fn(args[0], groups);
    });
  }
  if (n) { audit.masked += n; audit.maskEvents.push({ path: rel, kinds, count: n }); }
  return { text: out, count: n };
}

/* 证据标记（多模式） */
const EVIDENCE_PATTERNS = [
  ['confirmed', /\[已确认\]|【已确认】|已确证[（(]/g],
  ['perspective', /\[来源视角[/／·|]?单方回忆\]|\[单方回忆\]|【单方回忆】|【来源视角[／/]?单方回忆】/g],
  ['retrospect', /\[回望解释\]|【回望解释】/g],
  ['pending', /\[待核\]|【待核】|（待核）|\(待核\)/g],
  ['literary', /\[文学化重构\]|【文学化重构】|【文学化推演】|\[文学化推演\]/g],
  ['pendingCollect', /【待采】/g],
];
function evidenceSpans(text) {
  const spans = [];
  for (const [kind, re] of EVIDENCE_PATTERNS) {
    re.lastIndex = 0; let m; let c = 0;
    while ((m = re.exec(text)) && c < 20 && spans.length < 120) {
      const s = Math.max(0, m.index - 40);
      spans.push({ kind, snippet: text.slice(s, m.index + m[0].length + 40).replace(/\s+/g, ' ').trim() });
      c++;
    }
  }
  return spans;
}

const linksFromText = (text) => {
  const links = [];
  for (const m of text.matchAll(/\[\[([^\]\[]+?)\]\]/g)) {
    let target = m[1].split('|')[0].split('#')[0].trim();
    const display = m[1].includes('|') ? m[1].split('|')[1].trim() : null;
    if (!target || ASSET_EXT.test(target)) continue;
    target = target.replace(/\.md$/i, '');
    const base = target.split('/').pop();
    links.push({ target, base, display, private: privacySegTest(target) || privacyNorm.has(normKey(base)) || privacyNorm.has(normKey(target)) });
  }
  return links;
};
const YEAR_HI = new Date().getFullYear() + 1;
const yearsFromText = (text) => {
  const years = new Set();
  for (const m of text.matchAll(/(?<!\d)(20[0-2]\d)(?!\d)/g)) {
    const y = +m[1]; if (y >= 2000 && y <= YEAR_HI) years.add(y);
  }
  return [...years].sort();
};

function loadPrevDocs() {
  const map = new Map();
  if (process.env.MNEME_INGEST_FULL === '1' || !fs.existsSync(DB_PATH)) return map;
  let old;
  try {
    old = new DatabaseSync(DB_PATH, { readOnly: true });
    const last = old.prepare('SELECT manifest FROM audit_runs ORDER BY id DESC LIMIT 1').get();
    const ver = last ? JSON.parse(last.manifest || '{}').version : '';
    if (ver !== INGEST_VERSION) { old.close(); return map; }
    for (const row of old.prepare('SELECT path, title, domain, doc_type, stage, volume, is_index, is_private, meta, body, raw_text, sha256, mtime FROM documents').all()) {
      map.set(row.path, row);
    }
    old.close();
  } catch {
    try { if (old) old.close(); } catch { /* 旧库打不开就全量 */ }
  }
  return map;
}

/* ---------- 3. 文档解析 ---------- */
const prevDocs = loadPrevDocs();
const parsed = [];
for (const f of rawFiles) {
  const rel = f.rel;
  const segs = rel.split('/');
  const isPrivateMd = privateMdFiles.has(rel);
  if (!rel.toLowerCase().endsWith('.md') || segs[0] === 'Excalidraw') continue;
  let st; try { st = fs.statSync(f.abs); } catch { audit.parseErrors++; continue; }
  const prev = prevDocs.get(rel);
  const mtimeIso = st.mtime.toISOString();
  if (prev && prev.mtime === mtimeIso && !!prev.is_private === isPrivateMd && prev.raw_text) {
    let meta = null;
    try { meta = JSON.parse(prev.meta || '{}'); } catch { meta = null; }
    if (meta) {
      parsed.push({
        rel, abs: f.abs, title: prev.title, domain: prev.domain,
        isPrivate: isPrivateMd,
        doc_type: prev.doc_type, stage: prev.stage, volume: prev.volume,
        meta,
        tags: Array.isArray(meta.tags) ? meta.tags.join(',') : '',
        body: prev.body, raw: prev.raw_text,
        sha256: prev.sha256, mtime: prev.mtime,
        years: yearsFromText(prev.raw_text),
        links: linksFromText(prev.raw_text),
        evidence: evidenceSpans(prev.raw_text),
        isIndex: !!prev.is_index,
      });
      audit.reused++;
      continue;
    }
  }
  let raw = ''; try { raw = fs.readFileSync(f.abs, 'utf8'); } catch { audit.parseErrors++; continue; }

  let fm = '';
  if (raw.startsWith('---')) { const end = raw.indexOf('\n---', 3); if (end > 0) fm = raw.slice(4, end); }
  const bodyStart = raw.startsWith('---') && fm ? raw.indexOf('\n---', 3) + 4 : 0;
  const titleM = raw.match(/^#\s+(.+)$/m);
  const title = (titleM ? titleM[1].trim() : path.basename(rel, '.md')).replace(/^#+\s*/, '');

  const docno = metaField(raw, '文件编号');
  const masked = maskText(raw, rel);
  parsed.push({
    rel, abs: f.abs, title, domain: isPrivateMd ? '私人资料' : domainOf(fmField(fm, '分类标签'), rel),
    isPrivate: isPrivateMd,
    doc_type: fmField(fm, '类型'), stage: stageOf(fmField(fm, '学段'), rel),
    volume: null, meta: {
      docno, themes: splitList(metaField(raw, '核心主题')), related: relatedLinks(metaField(raw, '关联文件')),
      persons: splitList(metaField(raw, '核心出场人物')), timespan: metaField(raw, '时间跨度'),
      公开等级: fmField(fm, '公开等级'), tags: fmTags(fm),
    },
    tags: fmTags(fm).join(','),
    body: masked.text.slice(bodyStart).replace(/^#\s.*\n/, ''), raw: masked.text,
    sha256: crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16),
    mtime: mtimeIso, years: yearsFromText(masked.text),
    links: linksFromText(masked.text),
    evidence: evidenceSpans(masked.text),
    isIndex: /^00-|索引|总览$|选编|标准库/.test(path.basename(rel, '.md')),
  });
}
audit.ingested = parsed.length;

/* 卷归属：现行六部；过往五卷设计稿并入对应部 */
for (const d of parsed) {
  d.volume = volumeOfRel(d.rel);
  if (/百万长文写作\/章稿\//.test(d.rel)) d.doc_type = d.doc_type || '卷级章节设计';
}

/* ---------- 4. 实体（人物页） ---------- */
const isPersonDoc = (d) => (d.rel.split('/').includes('人物') && !d.isIndex && !/人物标准库|人物总索引|人物出场索引/.test(d.rel)) || (d.meta && (d.meta.人物 || '').toString().includes('人物'));
const entities = [];
for (const d of parsed) {
  const type = d.doc_type || '';
  const inPersonDir = d.rel.split('/').includes('人物');
  if (!(inPersonDir && !d.isIndex) && !(type.includes('人物') && !d.isIndex)) continue;
  if (/标准库|总索引|出场索引/.test(d.rel)) continue;
  const name = d.title.replace(/^人物[：:]\s*/, '');
  let group;
  if (/教练|老师|教师|班主任/.test(name)) group = '师长';
  else if (d.rel.startsWith('家庭/')) group = '家族亲属';
  else if (/老师|教师|师长|班主任|导师|教授/.test(d.rel)) group = '师长';
  else if (/同学|朋友|好友|室友|同窗|往来/.test(d.rel)) group = '同窗友人';
  else group = '其他';
  entities.push({
    std_id: d.meta.docno || d.rel, display_name: name, aliases: [], relation_group: group,
    stage: stageOfPath(d.rel) || d.stage, role_doc_path: d.rel, mention_count: 0,
    first_year: d.years[0] || null, last_year: d.years[d.years.length - 1] || null,
  });
}
const entityByBase = new Map();
const usedStdIds = new Set();
for (const e of entities) {
  if (usedStdIds.has(e.std_id)) e.std_id = e.role_doc_path; // 编号重复（库内已知 29 页 RZ-CZ-0266 重号）→ 路径兜底
  usedStdIds.add(e.std_id);
}
for (const e of entities) { const b = path.basename(e.role_doc_path).replace(/\.md$/i, '').toLowerCase(); if (!entityByBase.has(b)) entityByBase.set(b, e); }
const entityByPath = new Map(entities.map(e => [e.role_doc_path.replace(/\.md$/i, '').toLowerCase(), e]));

/* ---------- 5. 链接解析（私密断链标记） ---------- */
let resolvedEdges = 0, unresolvedEdges = 0, privateEdges = 0;
const unresolvedTargets = new Set();
const scrubNames = new Set(); // 全量私密文件名（搜索层脱敏用，不落任何库）；与公开层同名的除外
const privateMdByLower = new Map([...privateMdFiles].map(p => [p.replace(/\.md$/i, '').toLowerCase(), p]));
for (const n of privacyNames) if (n.length >= 4 && !publicBase.has(n.toLowerCase()) && !allPublicPaths.has(n.toLowerCase())) scrubNames.add(n);
for (const d of parsed) {
  if (d.isPrivate) continue; // 私密文档不贡献实体热度（星图/榜单口径不受加密收录影响）
  for (const L of d.links) {
    if (L.private) {
      privateEdges++; L.isPrivate = true;
      // v4：目标是已收录的私密 md → resolved（前端点击后走加密门禁），否则仍是断链
      L.resolved = privateMdByLower.has(L.target.toLowerCase()) || privateMdByLower.has(L.base.toLowerCase());
      if (L.resolved) resolvedEdges++; else { unresolvedEdges++; if (L.base.length >= 4) scrubNames.add(L.base); }
      continue;
    }
    const tb = L.target.toLowerCase(), bb = L.base.toLowerCase();
    if (allPublicPaths.has(tb) || allPublicPaths.has(bb) || publicBase.get(bb)) { L.resolved = true; resolvedEdges++; }
    else { L.resolved = false; unresolvedEdges++; unresolvedTargets.add(L.base); }
    const ent = entityByBase.get(bb) || entityByPath.get(tb);
    if (ent) ent.mention_count++;
  }
}

/* ---------- v4 · C3 拼音检索：检索表预计算拼音列（全拼+首字母，两段同存） ---------- */
const pyOf = (s) => {
  if (!s) return '';
  const full = Pinyin.convertToPinyin(String(s), '', true);
  const abbr = Pinyin.convertToPinyin(String(s), ' ', true).split(' ').map(w => w[0] || '').join('');
  return full === abbr ? full : full + ' ' + abbr;
};

/* ---------- 6. 《补写的手册》六部 / 章节 / 意象 / 问卷 ---------- */
const VOLUMES = BOOKS;
const catalogDoc = parsed.find(d => d.rel.replace(/\\/g, '/') === '百万长文写作/目录.md')
  || { raw: fs.readFileSync(path.join(VAULT, '百万长文写作', '目录.md'), 'utf8') };
const chapters = parseCatalog(catalogDoc.raw);

const imagery = []; const imageryOcc = [];
const ledger = parsed.find(d => /意象台账-2026-09-06\.md$/.test(d.rel));
if (ledger) {
  const lines = ledger.raw.split('\n');
  let cur = null, candidateMode = false, occSeq = 0;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const sec = L.match(/^###\s*(\d+)[\.、]\s*(.+)$/);
    if (sec) {
      const name = sec[2].trim().replace(/[（(].*$/, '').replace(/（次意象）/, '').trim();
      cur = { name, seq: +sec[1], candidate: candidateMode };
      if (!imagery.find(x => x.name === name)) imagery.push(cur);
      continue;
    }
    if (/^##\s*二、新增候选意象/.test(L)) { candidateMode = true; cur = null; continue; }
    if (/^##/.test(L)) { cur = null; continue; }
    if (!cur || !/^\s*\|/.test(L)) continue;
    const cells = L.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 4 || /^[-:\s]*$/.test(cells[0]) || cells[0] === '#') continue;
    if (candidateMode) { continue; } // 候选意象只在 imagery 表标注，不进出场登记
    if (cells.length >= 7) imageryOcc.push({ imagery: cur.name, scene: cells[3], old_meaning: cells[4] === '—' ? null : cells[4], new_meaning: cells[5] === '—' ? null : cells[5], source_note: cells[6], volume_code: cells[2], seq: ++occSeq });
    else if (cells.length >= 4) imageryOcc.push({ imagery: cur.name, scene: cells[2], old_meaning: null, new_meaning: null, source_note: cells[3], volume_code: cells[1], seq: ++occSeq });
  }
  // 候选意象登记
  let inCand = false;
  for (const L of lines) {
    if (/^##\s*二、新增候选意象/.test(L)) { inCand = true; continue; }
    if (inCand && /^##\s/.test(L)) break;
    if (!inCand || !/^\s*\|/.test(L)) continue;
    const cells = L.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 2 || /^[-:\s]*$/.test(cells[0]) || cells[0] === '意象') continue;
    if (!imagery.find(x => x.name === cells[0])) imagery.push({ name: cells[0], seq: imagery.length + 1, candidate: true });
  }
}

/* ---------- 6.1 意象全库扩充（v7.2）：台账之外的四类登记来源 ----------
   一、总提纲「五卷结构」表线形隐喻（拼图·结绳·省略号·建模）→ 主意象；
   二、卷五章节设计「全书回收表」新增意象行（浙大的笔记本、多一丝笑容）→ 主意象；
   三、各卷章节设计「伏应与意象设计」节书名号《…》物件（如工程控制论）→ 候选；
   四、物件史 A 区「有实证的物」逐行 → 候选。
   去重：与既有条目互为子串（归一化后 ≥2 字）即视为同一意象，不重复登记。
   全部条目均可溯源到库内原文路径，不新增任何库外素材。 */
const VOL_CODE = { '序章': 'P0', '第一卷': 'B1', '第二卷': 'B2', '第三卷': 'B3', '第四卷': 'B4', '第五卷': 'B6', '第一部': 'B1', '第二部': 'B2', '第三部': 'B3', '第四部': 'B4', '第五部': 'B5', '第六部': 'B6' };
const normIm = (s) => String(s).replace(/\*\*/g, '').replace(/[（(][^）)]*[)）]/g, '').replace(/[／/]/g, '/').replace(/[""「」『』]/g, '').replace(/\s/g, '');
const imExists = (name) => {
  const n = normIm(name);
  if (!n) return true;
  return imagery.some(x => {
    const e = normIm(x.name);
    return e === n || (e.length >= 2 && n.includes(e)) || (n.length >= 2 && e.includes(n));
  });
};
const imOcc = (name, scene, source_note, volume_code) =>
  imageryOcc.push({ imagery: name, scene, old_meaning: null, new_meaning: null, source_note, volume_code, seq: imageryOcc.length + 1 });

// 一、总提纲五卷线形隐喻
const outline = parsed.find(d => /总提纲-百万字自传小说\.md$/.test(d.rel));
if (outline) {
  for (const L of outline.raw.split('\n')) {
    if (!/^\s*\|/.test(L)) continue;
    const cells = L.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 5 || /^[-:\s]*$/.test(cells[0])) continue;
    const bold = cells[2].match(/\*\*([^*]+)\*\*/); // 序章行无加粗，由去重规则跳过
    if (!bold) continue;
    const name = bold[1].trim();
    if (imExists(name)) continue;
    imagery.push({ name, seq: imagery.length + 1, candidate: false });
    imOcc(name, `${cells[0]} 线形隐喻 · ${cells[2].replace(/\*\*/g, '')}`, outline.rel, VOL_CODE[cells[0]] || null);
  }
}

// 二、卷五「全书回收表」新增意象行
const v5design = parsed.find(d => /章节设计-第五卷-和解与当下\.md$/.test(d.rel));
if (v5design) {
  let inSec = false;
  for (const L of v5design.raw.split('\n')) {
    if (/伏应与意象设计/.test(L)) { inSec = true; continue; }
    if (inSec && /^##\s/.test(L)) break;
    if (!inSec || !/^\s*\|/.test(L)) continue;
    const cells = L.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 3 || /^[-:\s]*$/.test(cells[0]) || /意象\/伏笔/.test(cells[0])) continue;
    const name = cells[0].replace(/["「」]/g, '').trim();
    if (imExists(name)) continue;
    imagery.push({ name, seq: imagery.length + 1, candidate: false });
    imOcc(name, `首置 ${cells[1]}；本卷回收 ${cells[2]}`, v5design.rel, 'V5');
  }
}

// 三、章节设计「伏应与意象设计」节书名号物件
for (const d of parsed.filter(x => /章节设计-第[一二三四五]卷-.+\.md$/.test(x.rel))) {
  const vm = d.rel.match(/章节设计-(第[一二三四五]卷)/);
  const code = vm ? VOL_CODE[vm[1]] : null;
  let inSec = false;
  for (const L of d.raw.split('\n')) {
    if (/伏应与意象设计/.test(L)) { inSec = true; continue; }
    if (inSec && /^##\s/.test(L)) break;
    if (!inSec) continue;
    for (const m of L.matchAll(/《([^》]+)》/g)) {
      const name = m[1].trim();
      if (imExists(name)) continue;
      imagery.push({ name, seq: imagery.length + 1, candidate: true });
      imOcc(name, '章节设计埋线', d.rel, code);
    }
  }
}

// 四、物件史 A 区（有实证的物）逐行登记为候选
const objDoc = parsed.find(d => /我的物件史与文化消费年表-2026-09-06\.md$/.test(d.rel));
if (objDoc) {
  let inA = false, inSub = false;
  for (const L of objDoc.raw.split('\n')) {
    if (/^##\s*A[\.、]?\s*物件史/.test(L)) { inA = true; continue; }
    if (inA && /^##\s*B\./.test(L)) break;
    if (!inA) continue;
    if (/^###/.test(L)) { inSub = /^###\s*A\d/.test(L); continue; }
    if (!inSub || !/^\s*\|/.test(L)) continue;
    const cells = L.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 3 || /^[-:\s]*$/.test(cells[0]) || cells[0] === '物') continue;
    const name = cells[0].replace(/\*\*/g, '').trim();
    if (imExists(name)) continue;
    const year = cells[1], src = cells[2], meaning = cells[3];
    imagery.push({ name, seq: imagery.length + 1, candidate: true });
    imOcc(
      name,
      [year, meaning && meaning !== '—' ? meaning : ''].filter(Boolean).join(' · ') || '（场景待补）',
      [src && src !== '—' ? `出处：${src}` : '', objDoc.rel.replace(/\.md$/, '')].filter(Boolean).join(' · '),
      null,
    );
  }
}

const questionnaires = [];
/* v7.3 全量收录：V1（2026-09-05）+ V2/V3（2026-09-08）三轮作答全文，round 记轮次。
   父母卷（respondent_label 精确为 母亲/父亲/爸爸/妈妈）公开；其余问卷为绝密档案（服务端锁）。 */
for (const d of parsed.filter(x => /^问卷回收\/\d{4}-\d{2}-\d{2}-(V\d-)?.+问卷作答全文\.md$/.test(x.rel))) {
  const m = d.rel.match(/^问卷回收\/(\d{4}-\d{2}-\d{2})-((V\d)-)?(.+?)问卷作答全文\.md$/);
  const round = m[3] || 'V1';
  const label = m[4].trim();
  // 逐题解析三行式：**N. 题干** 类型 →（选项行，跳过）→ > 答案 blockquote
  // callout 元数据块（[!meta]/[!note]）出现在任何题行之前，天然被过滤
  const answers = [];
  let cur = null;
  // CRLF 规范化：JS 正则的 . 不吃 \r 且 $ 不认 \r 前，带 \r 的行尾会使 ^...$ 失配
  for (const line of d.body.replace(/\r/g, '').split('\n')) {
    const qm = line.match(/^\*\*(\d+)\.\s*(.+?)\*\*/);
    if (qm) { cur = { n: qm[1], q: qm[2].replace(/\s+`[^`]*`$/, '').trim(), a: '' }; answers.push(cur); continue; }
    if (!cur || /^>?\s*<sub>/.test(line)) continue;
    const am = line.match(/^>\s?(.*)$/);
    if (am && am[1].trim() && !am[1].includes('[!')) cur.a += (cur.a ? ' ' : '') + am[1].trim();
  }
  questionnaires.push({ round, respondent_label: label, relation_label: label, doc_path: d.rel, answers });
}

/* ---------- 7. 时间线（锚点 + 时代底板 + 年密度） ---------- */
const TL = '长篇创作/时间线一致性表-2026-09-06', FY = '长篇创作/伏应回收矩阵-2026-09-06', IM = '长篇创作/意象台账-2026-09-06';
const timeline = [
  { year: 2007, month: 11, exact: '2007-11-05', stage: '家庭', volume: 'B1', kind: 'anchor', title: '诞生·益阳', ref: TL },
  { year: 2011, month: null, exact: null, stage: '家庭', volume: 'B1', kind: 'anchor', title: '张家界四岁生日', ref: null },
  { year: 2013, month: 9, exact: null, stage: '小学', volume: 'B1', kind: 'anchor', title: '入学益阳市实验小学（86班）', ref: TL },
  { year: 2014, month: 8, exact: null, stage: '家庭', volume: 'B1', kind: 'anchor', title: '杭州两日游（母亲相册）', ref: TL },
  { year: 2015, month: null, exact: null, stage: '家庭', volume: 'B1', kind: 'anchor', title: '第一次北京（青岛→北京连游）', ref: TL },
  { year: 2016, month: 10, exact: null, stage: '家庭', volume: 'B1', kind: 'anchor', title: '父亲回益阳同住资阳区', ref: TL },
  { year: 2018, month: 9, exact: null, stage: '小学', volume: 'B1', kind: 'anchor', title: '六年级·1305班', ref: TL },
  { year: 2019, month: null, exact: null, stage: '初中', volume: 'B2', kind: 'anchor', title: '金海提前录取', ref: null },
  { year: 2019, month: 9, exact: null, stage: '初中', volume: 'B2', kind: 'anchor', title: '入学金海1907班', ref: TL },
  { year: 2022, month: 1, exact: '2022-01-25', stage: '初中', volume: 'B2', kind: 'anchor', title: '写给父母的信', ref: FY },
  { year: 2022, month: 6, exact: null, stage: '初中', volume: 'B2', kind: 'anchor', title: '中考', ref: TL },
  { year: 2022, month: 9, exact: null, stage: '高中', volume: 'B3', kind: 'anchor', title: '入学麓山国际 G2204', ref: TL },
  { year: 2022, month: null, exact: null, stage: '高中', volume: 'B3', kind: 'anchor', title: '橘子洲烟花之夜（G2204）', ref: IM },
  { year: 2023, month: 9, exact: null, stage: '高中', volume: 'B4', kind: 'anchor', title: '分班 G2205', ref: TL },
  { year: 2024, month: 7, exact: null, stage: '高中', volume: 'B4', kind: 'anchor', title: '沪浙之行', ref: null },
  { year: 2024, month: 8, exact: '2024-08-12', stage: '高中', volume: 'B4', kind: 'anchor', title: '麓山宿舍切蛋糕', ref: FY },
  { year: 2025, month: 6, exact: '2025-06-07', stage: '高中', volume: 'B5', kind: 'anchor', title: '高考（06-07 至 06-09）', ref: TL },
  { year: 2025, month: 8, exact: '2025-08-25', stage: '家庭', volume: 'B5', kind: 'anchor', title: '益阳站开火车（朋友圈）', ref: IM },
  { year: 2025, month: 9, exact: null, stage: '大学', volume: 'B6', kind: 'anchor', title: '入学四川大学物理学强基（江安）', ref: TL },
  { year: 2025, month: 10, exact: '2025-10-01', stage: '大学', volume: 'B6', kind: 'anchor', title: '归家高铁·江安的水送我归家', ref: IM },
  { year: 2025, month: 11, exact: '2025-11-05', stage: '大学', volume: 'B6', kind: 'anchor', title: '十八岁生日', ref: TL },
  { year: 2026, month: 5, exact: null, stage: '大学', volume: 'B6', kind: 'anchor', title: '西安之行（与母亲）', ref: null },
  { year: 2026, month: 7, exact: '2026-07-19', stage: '大学', volume: 'B6', kind: 'anchor', title: '新加坡访学（07-19 至 07-25）', ref: TL },
  { year: 2026, month: 9, exact: null, stage: '大学', volume: 'B6', kind: 'anchor', title: '写书当下', ref: TL },
];
for (const d of parsed.filter(x => x.domain === '背景资料')) {
  const ym = /(场景稿|年份|时代底板)/.test(d.rel) ? d.rel.match(/(20[0-2]\d)/) : d.title.match(/^(20[0-2]\d)/);
  const y = ym ? +ym[1] : null;
  if (y >= 2007 && y <= YEAR_HI) timeline.push({ year: y, month: null, exact: null, stage: '跨学段', volume: null, kind: 'background', title: d.title, ref: d.rel });
}
const yearDensity = {};
for (const d of parsed) for (const y of d.years) yearDensity[y] = (yearDensity[y] || 0) + 1;

/* ---------- 8. 建库 ---------- */
for (const suffix of ['', '-wal', '-shm']) { try { fs.rmSync(DB_PATH + suffix); } catch {} }
const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode=WAL;
CREATE TABLE documents(id INTEGER PRIMARY KEY, path TEXT UNIQUE, title TEXT, title_pinyin TEXT, domain TEXT, doc_type TEXT, stage TEXT, volume TEXT, is_index INTEGER, is_private INTEGER DEFAULT 0, meta TEXT, body TEXT, raw_text TEXT, sha256 TEXT, mtime TEXT, ingested_at TEXT);
CREATE TABLE entities(id INTEGER PRIMARY KEY, pinyin TEXT, std_id TEXT UNIQUE, display_name TEXT, aliases TEXT, relation_group TEXT, stage TEXT, role_doc_path TEXT, mention_count INTEGER, first_year INTEGER, last_year INTEGER);
CREATE TABLE entity_mentions(entity_id INTEGER, doc_id INTEGER, hits INTEGER, PRIMARY KEY(entity_id, doc_id));
CREATE TABLE wikilinks(id INTEGER PRIMARY KEY, from_doc TEXT, to_target TEXT, display_text TEXT, resolved INTEGER, is_private INTEGER);
CREATE TABLE timeline_events(id INTEGER PRIMARY KEY, pinyin TEXT, doc_id INTEGER, year INTEGER, month INTEGER, exact_date TEXT, stage TEXT, volume TEXT, kind TEXT, title TEXT, is_public_background INTEGER, ref TEXT);
CREATE TABLE volumes(code TEXT PRIMARY KEY, seq INTEGER, pinyin TEXT, name TEXT, years TEXT, line_metaphor TEXT, mood TEXT, word_target TEXT, color_token TEXT);
/* v4 · C4 伏应矩阵：来自 vault 台账「伏应回收矩阵」，等级 🔴跨卷/🟠/🟡 与中/低三档 */
CREATE TABLE foreshadow(id INTEGER PRIMARY KEY, level TEXT, material TEXT, plant TEXT, harvest TEXT, method TEXT, status TEXT);
CREATE TABLE chapters(id INTEGER PRIMARY KEY, volume_code TEXT, seq INTEGER, pinyin TEXT, title TEXT, est_chapters INTEGER, est_words TEXT, doc_path TEXT, status TEXT, is_sample INTEGER, fascicle TEXT, kind TEXT, sections TEXT, secret INTEGER);
CREATE TABLE imagery(id INTEGER PRIMARY KEY, pinyin TEXT, name TEXT, seq INTEGER, candidate INTEGER);
CREATE TABLE imagery_occurrences(id INTEGER PRIMARY KEY, imagery_id INTEGER, doc_id TEXT, volume_code TEXT, scene TEXT, old_meaning TEXT, new_meaning TEXT, source_note TEXT, seq INTEGER);
CREATE TABLE questionnaires(id INTEGER PRIMARY KEY, round TEXT, respondent_label TEXT, relation_label TEXT, doc_path TEXT, answers TEXT);
CREATE TABLE evidence_spans(id INTEGER PRIMARY KEY, doc_id INTEGER, kind TEXT, snippet TEXT);
CREATE TABLE year_density(year INTEGER PRIMARY KEY, docs INTEGER);
CREATE TABLE audit_runs(id INTEGER PRIMARY KEY, started_at TEXT, finished_at TEXT, scanned INTEGER, ingested INTEGER, excluded_private INTEGER, excluded_system INTEGER, masked INTEGER, manifest TEXT);
CREATE VIRTUAL TABLE files_fts USING fts5(doc_id UNINDEXED, path, title, tags, body, tokenize='trigram');
CREATE VIEW v_domain_stats AS SELECT domain, COUNT(*) n FROM documents GROUP BY domain ORDER BY n DESC;
CREATE VIEW v_stage_stats AS SELECT stage, COUNT(*) n FROM documents GROUP BY stage ORDER BY n DESC;
CREATE VIEW v_entity_mention_rank AS SELECT id, display_name, relation_group, stage, mention_count FROM entities ORDER BY mention_count DESC;
CREATE VIEW v_year_density AS SELECT year, docs FROM year_density ORDER BY year;
CREATE INDEX idx_docs_domain ON documents(domain); CREATE INDEX idx_docs_stage ON documents(stage); CREATE INDEX idx_docs_volume ON documents(volume);
CREATE INDEX idx_links_from ON wikilinks(from_doc); CREATE INDEX idx_links_target ON wikilinks(to_target);
CREATE INDEX idx_ev_doc ON evidence_spans(doc_id); CREATE INDEX idx_tl_year ON timeline_events(year);
`);

const insDoc = db.prepare('INSERT INTO documents(path,title,title_pinyin,domain,doc_type,stage,volume,is_index,is_private,meta,body,raw_text,sha256,mtime,ingested_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
const insEnt = db.prepare('INSERT INTO entities(pinyin,std_id,display_name,aliases,relation_group,stage,role_doc_path,mention_count,first_year,last_year) VALUES (?,?,?,?,?,?,?,?,?,?)');
const insLink = db.prepare('INSERT INTO wikilinks(from_doc,to_target,display_text,resolved,is_private) VALUES (?,?,?,?,?)');
const insTL = db.prepare('INSERT INTO timeline_events(pinyin,doc_id,year,month,exact_date,stage,volume,kind,title,is_public_background,ref) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
const insCh = db.prepare('INSERT INTO chapters(volume_code,seq,pinyin,title,est_chapters,est_words,doc_path,status,is_sample,fascicle,kind,sections,secret) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
const insIm = db.prepare('INSERT INTO imagery(pinyin,name,seq,candidate) VALUES (?,?,?,?)');
const insImOcc = db.prepare('INSERT INTO imagery_occurrences(imagery_id,doc_id,volume_code,scene,old_meaning,new_meaning,source_note,seq) VALUES (?,?,?,?,?,?,?,?)');
const insQ = db.prepare('INSERT INTO questionnaires(round,respondent_label,relation_label,doc_path,answers) VALUES (?,?,?,?,?)');
const insEv = db.prepare('INSERT INTO evidence_spans(doc_id,kind,snippet) VALUES (?,?,?)');
const insYD = db.prepare('INSERT INTO year_density(year,docs) VALUES (?,?)');

/* 伏应：现行百万长文写作/伏应.md（1–60 章号）。旧五卷矩阵只作过往参考。 */
{
  const foPath = path.join(VAULT, '百万长文写作', '伏应.md');
  const foText = fs.existsSync(foPath)
    ? fs.readFileSync(foPath, 'utf8')
    : fs.readFileSync(path.join(VAULT, '长篇创作', '伏应回收矩阵-2026-09-06.md'), 'utf8');
  const insFo = db.prepare('INSERT INTO foreshadow(level,material,plant,harvest,method,status) VALUES (?,?,?,?,?,?)');
  for (const row of parseForeshadow(foText)) {
    insFo.run(row.level, row.material, row.plant, row.harvest, row.method, row.status);
  }
  console.log('  伏应:', db.prepare('SELECT COUNT(*) n FROM foreshadow').get().n, '条');
}

db.exec('BEGIN');
const docIdByPath = new Map();
const scrubRe = new RegExp([...scrubNames].map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
for (const d of parsed) {
  const r = insDoc.run(d.rel, d.title, pyOf(d.title), d.domain, d.doc_type, d.stage, d.volume, d.isIndex ? 1 : 0, d.isPrivate ? 1 : 0, JSON.stringify(d.meta), d.body, d.raw, d.sha256, d.mtime, startedAt);
  docIdByPath.set(d.rel, Number(r.lastInsertRowid));
  if (d.isPrivate) continue; // 私密文档：正文入 documents（加密门禁保护），不入 FTS 索引/外链表/证据库
  const ftsBody = scrubNames.size ? d.body.replace(scrubRe, '[已隔离]') : d.body; // 搜索层脱敏：正文原文不动
  db.prepare('INSERT INTO files_fts(doc_id,path,title,tags,body) VALUES (?,?,?,?,?)').run(Number(r.lastInsertRowid), d.rel, d.title, d.tags, ftsBody);
  /* v8 修订：私密边的 to_target 一律落占位符，不落真实私密路径。
     原实现（v4）落真名，理由是「加密门禁后可点击到达」，但私密边从不出现在任何公开出口
     （backlinks / stardust 均按 is_private=0 过滤），真实路径只是留在库里等着被别的查询漏出去。
     与 PG manifest 的写法（to_target: '[私密·已隔离]'）统一。 */
  for (const L of d.links) insLink.run(d.rel, L.isPrivate ? '[私密·已隔离]' : L.base, L.display, L.resolved ? 1 : 0, L.isPrivate ? 1 : 0);
  for (const sp of d.evidence) insEv.run(Number(r.lastInsertRowid), sp.kind, sp.snippet);
}
const entIdByBase = new Map();
for (const e of entities) {
  const r = insEnt.run(pyOf(e.display_name), e.std_id, e.display_name, JSON.stringify(e.aliases), e.relation_group, e.stage, e.role_doc_path, e.mention_count, e.first_year, e.last_year);
  entIdByBase.set(path.basename(e.role_doc_path).replace(/\.md$/i, '').toLowerCase(), Number(r.lastInsertRowid));
}
// entity_mentions：文档内人物双链命中（私密文档不贡献——加密内容不进人物图谱）
for (const d of parsed) {
  if (d.isPrivate) continue;
  const hits = new Map();
  for (const L of d.links) {
    const eid = entIdByBase.get(L.base.toLowerCase());
    if (eid && !L.isPrivate) hits.set(eid, (hits.get(eid) || 0) + 1);
  }
  for (const [eid, h] of hits) db.prepare('INSERT OR IGNORE INTO entity_mentions(entity_id,doc_id,hits) VALUES (?,?,?)').run(eid, docIdByPath.get(d.rel), h);
}
for (const t of timeline) insTL.run(pyOf(t.title), t.ref ? docIdByPath.get(t.ref + '.md') || docIdByPath.get(t.ref) || null : null, t.year, t.month, t.exact, t.stage, t.volume, t.kind, t.title, t.kind === 'background' ? 1 : 0, t.ref);
for (const v of VOLUMES) db.prepare('INSERT INTO volumes(code,seq,pinyin,name,years,line_metaphor,mood,word_target,color_token) VALUES (?,?,?,?,?,?,?,?,?)').run(v.code, v.seq, pyOf(v.name), v.name, v.years, v.line_metaphor, v.mood, v.word_target, v.color_token);
for (const c of chapters) insCh.run(c.volume_code, c.seq, pyOf(c.title), c.title, c.fasc_seq || null, (c.sections || []).length ? `${c.sections.length}节` : null, c.doc_path, c.status, c.is_sample || 0, c.fascicle || '', c.kind || 'chapter', JSON.stringify(c.sections || []), c.secret || 0);
const imIdByName = new Map();
for (const im of imagery) { const r = insIm.run(pyOf(im.name.replace(/\*\*/g, '')), im.name, im.seq, im.candidate ? 1 : 0); imIdByName.set(im.name, Number(r.lastInsertRowid)); }
for (const o of imageryOcc) insImOcc.run(imIdByName.get(o.imagery) || null, null, o.volume_code, o.scene, o.old_meaning, o.new_meaning, o.source_note, o.seq);
for (const q of questionnaires) insQ.run(q.round, q.respondent_label, q.relation_label, q.doc_path, JSON.stringify(q.answers));
for (const y of Object.keys(yearDensity).map(Number).sort((a, b) => a - b)) insYD.run(y, yearDensity[y]);
const finishedAt = new Date().toISOString();
const manifest = { version: INGEST_VERSION, byDomain: Object.fromEntries(db.prepare('SELECT domain, COUNT(*) n FROM documents GROUP BY domain').all().map(r => [r.domain, r.n])), privateEdges, resolvedEdges, unresolvedUnique: unresolvedTargets.size, maskEvents: audit.maskEvents.length };
db.prepare('INSERT INTO audit_runs(started_at,finished_at,scanned,ingested,excluded_private,excluded_system,masked,manifest) VALUES (?,?,?,?,?,?,?,?)')
  .run(startedAt, finishedAt, audit.scanned, audit.ingested, audit.excluded_private, audit.excluded_system + audit.excluded_excalidraw, audit.masked, JSON.stringify(manifest));
db.exec('COMMIT');

/* ---------- 9. 快照（PG 灌库用） ---------- */
const snap = {
  generatedAt: finishedAt, ingestVersion: INGEST_VERSION, audit: { ...audit, manifest },
  documents: parsed.map(d => ({ path: d.rel, title: d.title, domain: d.domain, doc_type: d.doc_type, stage: d.stage, volume: d.volume, meta: d.meta, raw_text: d.body, sha256: d.sha256, mtime: d.mtime })),
  entities, volumes: VOLUMES, chapters, imagery, imagery_occurrences: imageryOcc, questionnaires, timeline, year_density: yearDensity,
  wikilinks: parsed.flatMap(d => d.links.map(L => ({ from_doc: d.rel, to_target: L.isPrivate ? '[私密·已隔离]' : L.base, display_text: L.display, resolved: !!L.resolved, is_private: !!L.isPrivate }))),
  evidence_spans: parsed.flatMap(d => d.evidence.map(sp => ({ doc: d.rel, kind: sp.kind, snippet: sp.snippet }))),
};
fs.writeFileSync(SNAP_PATH, JSON.stringify(snap));

/* ---------- 10. 摘要 ---------- */
console.log('=== ΜΝΗΜΗ M1 ETL 完成 ===');
console.log(`documents=${parsed.length} reused=${audit.reused} entities=${entities.length} edges(resolved/unresolved/private)=${resolvedEdges}/${unresolvedEdges}/${privateEdges}`);
console.log(`volumes=${VOLUMES.length} chapters=${chapters.length}(章${chapters.filter(c => c.kind === 'chapter').length}/间${chapters.filter(c => c.kind === 'interlude').length}/附${chapters.filter(c => c.kind === 'appendix').length}/密${chapters.filter(c => c.secret).length}) imagery=${imagery.length}(候选${imagery.filter(i => i.candidate).length}) occ=${imageryOcc.length}`);
if (chapters.filter(c => c.kind === 'chapter').length !== 60) console.warn('  ⚠ 目录正文章不是 60');
console.log(`questionnaires=${questionnaires.length} timeline=${timeline.length}(锚点${timeline.filter(t => t.kind === 'anchor').length}) evidenceSpans=${parsed.reduce((s, d) => s + d.evidence.length, 0)} masked=${audit.masked}`);
console.log(`excluded: private=${audit.excluded_private}(+other ${audit.excluded_private_other}) system=${audit.excluded_system} excalidraw=${audit.excluded_excalidraw} parseErrors=${audit.parseErrors}`);
console.log(`DB: ${DB_PATH}  snapshot: ${(fs.statSync(SNAP_PATH).size / 1048576).toFixed(1)} MB`);
