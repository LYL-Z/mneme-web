/**
 * ΜΝΗΜΗ · 阶段 0 只读勘察脚本（v3 提示词 §2 要求）
 * 铁律：对 vault 只读；本脚本与产物全部位于 vault 之外的 mneme-web/。
 * 私密层（私人资料/、隐私/）：不读取内容，只计数。
 */
import fs from 'node:fs';
import path from 'node:path';

const VAULT = 'D:/The Memory/The Memory';
const OUT_DIR = 'D:/The Memory/mneme-web/ingest';

const SYS_DIRS = new Set(['.git', '.obsidian', '.claudian', '.workbuddy', '.trash', '.smart-env', 'node_modules', 'tmp', 'scripts']);
const PRIVACY_SEGS = new Set(['私人资料', '隐私']);
const ASSET_EXT = /\.(png|jpe?g|gif|webp|svg|pdf|mp4|mp3|wav|zip|excalidraw|csv|txt)$/i;

const S = {
  scannedAt: new Date().toISOString(),
  vaultRoot: VAULT,
  totalMd: 0, publicMd: 0,
  excluded: { privateMd: 0, privateOther: 0, systemMd: 0, excalidrawMd: 0 },
  attachmentsByExt: {},
  metaCalloutFiles: 0, docnoFiles: 0,
  calloutTypes: {},
  evidence: { confirmed: 0, perspective: 0, retrospect: 0, pending: 0, literary: 0, pendingCollect: 0 },
  mask: {
    phone: { hits: 0, files: 0 }, idcard: { hits: 0, files: 0 }, qq: { hits: 0, files: 0 },
    wechat: { hits: 0, files: 0 }, examNo: { hits: 0, files: 0 },
  },
  domainCounts: {}, dirTopCounts: {}, stageCounts: {},
  personDirFiles: 0, personTypeFiles: 0,
  links: { edgeTotal: 0, edgeResolved: 0, edgeUnresolved: 0, unresolvedUnique: 0 },
  unresolvedSample: [],
  yearMentions: {},
  volumes: [], changJianFiles: [], sampleCandidates: [],
  imagery: { file: null, rows: 0, oldNewPairs: 0 },
  foreshadow: { file: null, rows: 0 },
  timeline: { file: null, rows: 0 },
  parallelDraft: null,
  questionnaires: [],
  latest: [],
  parseErrors: 0,
};

const files = [];
function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('~$')) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name.startsWith('.') || SYS_DIRS.has(e.name)) {
        if (e.name === '.git' || e.name === '.obsidian') continue; // 不深入也不统计内容
        walkCountOnly(abs, e.name);
        continue;
      }
      walk(abs);
    } else if (e.isFile()) {
      files.push({ abs, rel: path.relative(VAULT, abs).split(path.sep).join('/') });
    }
  }
}
// 系统目录：统计 md 数量但不读取（tmp/scripts/.workbuddy 等为工程性目录）
function walkCountOnly(dir, label) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) { if (!e.name.startsWith('.')) walkCountOnly(abs, label); continue; }
    if (e.isFile() && e.name.toLowerCase().endsWith('.md')) S.excluded.systemMd++;
    else if (e.isFile() && !ASSET_EXT.test(e.name) === false) { /* attachments in sys dirs not tracked */ }
  }
}

walk(VAULT);

const publicDocs = [];
for (const f of files) {
  const ext = path.extname(f.abs).toLowerCase();
  const segs = f.rel.split('/');
  if (ext === '.md') {
    S.totalMd++;
    if (segs.some(s => PRIVACY_SEGS.has(s))) { S.excluded.privateMd++; continue; } // 零提取：不读
    if (segs[0] === 'Excalidraw') { S.excluded.excalidrawMd++; continue; }          // 仅计数不解析手绘
    publicDocs.push(f);
  } else {
    const k = ext.replace('.', '') || 'noext';
    if (segs.some(s => PRIVACY_SEGS.has(s))) { S.excluded.privateOther++; continue; }
    S.attachmentsByExt[k] = (S.attachmentsByExt[k] || 0) + 1;
  }
}
S.publicMd = publicDocs.length;

const linkStore = []; // {doc, targets:[]}
const fm = (block, key) => {
  const m = block.match(new RegExp(`^${key}\\s*[:：]\\s*(.+)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
};

for (const f of publicDocs) {
  let raw = '';
  try { raw = fs.readFileSync(f.abs, 'utf8'); } catch { S.parseErrors++; continue; }
  const st = fs.statSync(f.abs);
  S.latest.push({ path: f.rel, mtime: st.mtime.toISOString() });

  // frontmatter
  let head = '';
  if (raw.startsWith('---')) {
    const end = raw.indexOf('\n---', 3);
    if (end > 0) head = raw.slice(4, end);
  }
  const domain = fm(head, '分类标签');
  if (domain) S.domainCounts[domain] = (S.domainCounts[domain] || 0) + 1;
  const stage = fm(head, '学段');
  if (stage) S.stageCounts[stage] = (S.stageCounts[stage] || 0) + 1;
  const type = fm(head, '类型') || '';
  if (type.includes('人物')) S.personTypeFiles++;

  // 顶层目录计数（对照）
  const top = f.rel.split('/')[0];
  S.dirTopCounts[top] = (S.dirTopCounts[top] || 0) + 1;

  // [!meta] 页眉与文件编号
  if (/\[!meta\]/.test(raw)) S.metaCalloutFiles++;
  if (/\*\*文件编号\*\*\s*[:：]/.test(raw)) S.docnoFiles++;

  // callout 类型直方图
  for (const m of raw.matchAll(/\[!([a-zA-Z\u4e00-\u9fa5]+)\]/g)) {
    const k = m[1].toLowerCase();
    S.calloutTypes[k] = (S.calloutTypes[k] || 0) + 1;
  }

  // 五类证据标记 + 待采
  S.evidence.confirmed += (raw.match(/\[已确认\]/g) || []).length;
  S.evidence.perspective += (raw.match(/\[来源视角[/／·|]?单方回忆\]|\[单方回忆\]|\[来源视角\]/g) || []).length;
  S.evidence.retrospect += (raw.match(/\[回望解释\]/g) || []).length;
  S.evidence.pending += (raw.match(/\[待核\]/g) || []).length;
  S.evidence.literary += (raw.match(/\[文学化重构\]/g) || []).length;
  S.evidence.pendingCollect += (raw.match(/【待采】|\[!待采\]|\[待采\]/g) || []).length;

  // 二次脱敏扫描（公开层内的敏感字段，仅计数，不落内容）
  const maskDefs = [
    ['phone', /(?<!\d)1[3-9]\d{9}(?!\d)/g],
    ['idcard', /(?<!\d)\d{17}[\dXx](?!\d)/g],
    ['qq', /(QQ|qq)\s*(号)?\s*[:：]?\s*(?<!\d)\d{5,11}(?!\d)/g],
    ['wechat', /(微信|weixin|WeChat|WX|wx)\s*(号|ID|id)?\s*[:：]\s*[A-Za-z0-9_-]{6,20}/g],
    ['examNo', /(准考证号?|考号|学号|报名号)\s*[:：]?\s*(?<!\d)\d{6,}(?!\d)/g],
  ];
  for (const [k, re] of maskDefs) {
    const hits = raw.match(re);
    if (hits && hits.length) { S.mask[k].hits += hits.length; S.mask[k].files++; }
  }

  // 人物页（路径含「人物」层）
  if (f.rel.split('/').includes('人物')) S.personDirFiles++;

  // wikilinks
  const targets = [];
  for (const m of raw.matchAll(/\[\[([^\]\[]+?)\]\]/g)) {
    let t = m[1].split('|')[0].split('#')[0].trim();
    if (!t || ASSET_EXT.test(t)) continue;
    t = t.replace(/\.md$/i, '');
    targets.push(t.split('/').pop());
  }
  S.links.edgeTotal += targets.length;
  linkStore.push({ doc: f.rel, targets });

  // 年份密度（2000—2026）
  for (const m of raw.matchAll(/(?<!\d)(20[0-2]\d)(?!\d)/g)) {
    const y = +m[1];
    if (y >= 2000 && y <= 2026) S.yearMentions[y] = (S.yearMentions[y] || 0) + 1;
  }

  // 长篇创作/样章候选
  if (f.rel.startsWith('长篇创作/')) S.changJianFiles.push(f.rel);
  const nameHit = ['补写的手册', '婚礼进行曲', '十八岁的清单'].find(k => f.rel.includes(k));
  if (nameHit || /样章/.test(path.basename(f.rel))) S.sampleCandidates.push(f.rel);
}

// wikilink 解析（basename 归一，不区分大小写，模拟 Obsidian 最短路径解析）
const byRel = new Set(), byBase = new Map();
for (const f of publicDocs) {
  const rel = f.rel.replace(/\.md$/i, '').toLowerCase();
  byRel.add(rel);
  const b = path.basename(f.rel).replace(/\.md$/i, '').toLowerCase();
  byBase.set(b, (byBase.get(b) || 0) + 1);
}
const unresolvedSet = new Set();
for (const l of linkStore) {
  for (const t of l.targets) {
    const tb = t.toLowerCase();
    if (byRel.has(tb) || byBase.has(tb)) S.links.edgeResolved++;
    else { S.links.edgeUnresolved++; unresolvedSet.add(t); }
  }
}
S.links.unresolvedUnique = unresolvedSet.size;
S.unresolvedSample = [...unresolvedSet].slice(0, 15);

// 五卷章节设计
for (const rel of S.changJianFiles.filter(r => /章节设计/.test(r))) {
  let raw = ''; try { raw = fs.readFileSync(path.join(VAULT, rel), 'utf8'); } catch { continue; }
  const chs = new Set((raw.match(/第[一二三四五六七八九十百零〇0-9]+章/g) || []));
  const wait = (raw.match(/【待采】/g) || []).length;
  const size = (raw.match(/预估体量\s*[:：]?\s*([^\n|]*)/) || [])[1]?.trim() || null;
  S.volumes.push({ file: rel, chapters: chs.size, waitCollect: wait, estSize: size });
}
S.imagery.file = S.changJianFiles.find(r => /意象台账/.test(r)) || null;
if (S.imagery.file) {
  const raw = fs.readFileSync(path.join(VAULT, S.imagery.file), 'utf8');
  S.imagery.rows = raw.split('\n').filter(l => /^\s*\|/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l)).length - 1;
  S.imagery.oldNewPairs = (raw.match(/旧义/g) || []).length;
}
S.foreshadow.file = S.changJianFiles.find(r => /伏应回收矩阵/.test(r)) || null;
if (S.foreshadow.file) {
  const raw = fs.readFileSync(path.join(VAULT, S.foreshadow.file), 'utf8');
  S.foreshadow.rows = raw.split('\n').filter(l => /^\s*\|/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l)).length - 1;
}
S.timeline.file = S.changJianFiles.find(r => /时间线一致性表/.test(r)) || null;
if (S.timeline.file) {
  const raw = fs.readFileSync(path.join(VAULT, S.timeline.file), 'utf8');
  S.timeline.rows = raw.split('\n').filter(l => /^\s*\|/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l)).length - 1;
}
S.parallelDraft = S.changJianFiles.find(r => /平行时空/.test(r)) || null;

// 问卷回收
const qDir = path.join(VAULT, '问卷回收');
if (fs.existsSync(qDir)) {
  S.questionnaires = fs.readdirSync(qDir).filter(n => n.endsWith('.md'));
}

// 最近更新 Top10
S.latest.sort((a, b) => b.mtime.localeCompare(a.mtime));
S.latest = S.latest.slice(0, 10);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'survey-stats.json'), JSON.stringify(S, null, 2), 'utf8');

// stdout 摘要
const line = (k, v) => console.log(`${k}: ${v}`);
console.log('=== ΜΝΗΜΗ 阶段0 只读勘察摘要 ===');
line('md 总数', S.totalMd);
line('公开层 md（已解析）', S.publicMd);
line('排除·私密层 md', S.excluded.privateMd, `（另含非md文件 ${S.excluded.privateOther}，零读取）`);
line('排除·系统目录 md', S.excluded.systemMd);
line('排除·Excalidraw md', S.excluded.excalidrawMd);
line('十域计数', JSON.stringify(S.domainCounts));
line('学段计数', JSON.stringify(S.stageCounts));
line('人物页·路径含人物层', S.personDirFiles, `· 类型=人物 ${S.personTypeFiles}`);
line('wikilink 边 总/解析/未解析', `${S.links.edgeTotal} / ${S.links.edgeResolved} / ${S.links.edgeUnresolved}`);
line('未解析唯一目标（留名星尘）', S.links.unresolvedUnique);
line('证据标记', JSON.stringify(S.evidence));
line('脱敏命中', JSON.stringify(S.mask));
line('[!meta] 页眉 / 文件编号', `${S.metaCalloutFiles} / ${S.docnoFiles}`);
line('五卷章节', JSON.stringify(S.volumes));
line('意象台账', `${S.imagery.file} 行=${S.imagery.rows} 旧义出现=${S.imagery.oldNewPairs}`);
line('伏应矩阵', `${S.foreshadow.file} 行=${S.foreshadow.rows}`);
line('时间线一致性表', `${S.timeline.file} 行=${S.timeline.rows}`);
line('平行时空草案', S.parallelDraft);
line('问卷文件', S.questionnaires.length, JSON.stringify(S.questionnaires));
line('样章候选', JSON.stringify(S.sampleCandidates));
line('附件分布', JSON.stringify(S.attachmentsByExt));
line('解析失败', S.parseErrors);
console.log('最近更新Top10:', JSON.stringify(S.latest, null, 0));
console.log('未解析样例:', JSON.stringify(S.unresolvedSample));
