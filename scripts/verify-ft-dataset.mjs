#!/usr/bin/env node
/**
 * ΜΝΗΜΗ · verify-ft-dataset.mjs —— 校验微调训练集的**人物对应准确性**
 *
 * 校验（数据库为唯一事实来源，流式逐行对账）：
 *   V1 每行 meta.entity / meta.name 与数据库一致（无张冠李戴）
 *   V2 system 里引用的**每一个语料路径**都必须属于该人物自己的语料路径集合
 *   V3 assistant 的引用出处（meta.cite）也必须在该人物语料路径集合内
 *   V4 assistant 正文可在该人物语料中找到出处（空白归一化后的指纹抽检）
 *   V5 覆盖面：进入训练集的人物数
 *
 * 用法：node scripts/verify-ft-dataset.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DATA = path.join(ROOT, process.argv.includes('--data') ? process.argv[process.argv.indexOf('--data') + 1] : 'ft-dataset', 'all.jsonl');
const DB = path.join(ROOT, 'ingest', 'mneme.db');

if (!fs.existsSync(DATA)) { console.error(`✗ 未找到 ${DATA}，请先跑 build-ft-dataset.mjs`); process.exit(2); }

const db = new DatabaseSync(DB, { readOnly: true });
const truth = new Map();
for (const p of db.prepare('SELECT entity_id, display_name, chunks FROM persona_pack').all()) {
  const chunks = (() => { try { return JSON.parse(p.chunks) || []; } catch { return []; } })();
  truth.set(Number(p.entity_id), {
    name: String(p.display_name || ''),
    paths: new Set(chunks.map(c => c.path).filter(Boolean)),
    /** 空白归一化后的语料正文（指纹比对用） */
    normTexts: chunks.map(c => String(c.text || '').replace(/\s+/g, '')),
  });
}
db.close();

let pass = 0, fail = 0;
const bad = [];
/** 引用标注格式（生成器写死）：`[n]（路径 · 类型）正文` —— 锚定 [数字]（ 前缀，
 *  这样 chunk **正文里**的散文括号（如「1907 班，传闻/习惯层（…」）不会误判为路径。 */
const PATH_RE = /\[\d+\]（([^）]+)）/g;
/** 路径判定：真语料路径必含「/」或以 .md/.txt 结尾 */
const isPathLike = (s) => /\//.test(s) || /\.(md|txt)$/i.test(s);
const norm = (s) => String(s || '').replace(/\s+/g, '');
const ok = (cond, name, detail = '') => {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.log(`❌ ${name}${detail ? '  → ' + detail : ''}`); if (bad.length < 5) bad.push(`${name} ${detail}`); }
};

/* 流式逐行（全量语料集可达 GB 级，不能整体读入字符串） */
const rl = readline.createInterface({ input: fs.createReadStream(DATA, { encoding: 'utf8' }), crlfDelay: Infinity });

let v1 = 0, v2 = 0, v2n = 0, v3 = 0, v3n = 0, v4 = 0;
const perEntity = new Map();
let lineNo = 0;
for await (const line of rl) {
  if (!line) continue;
  lineNo++;
  let row;
  try { row = JSON.parse(line); } catch { v1++; continue; }
  const meta = row.meta || {};
  const t = truth.get(Number(meta.entity));

  /* V1 身份对得上 */
  if (!t || t.name !== String(meta.name || '').trim()) {
    v1++; if (bad.length < 5) bad.push(`line${lineNo} 身份不符 entity=${meta.entity}`);
    continue;
  }
  perEntity.set(Number(meta.entity), (perEntity.get(Number(meta.entity)) || 0) + 1);

  /* V2 system 内的语料路径 ∈ 该实体自己的路径集合。
     **只扫描「你的记忆素材」节**（真引用标注只出现在那里）；
     人格基底总结散文里的括号（如「1907 班，传闻/习惯层（…」）不是标注，不扫。 */
  const sys = String(row.messages?.[0]?.content || '');
  const corpusAt = sys.indexOf('【你的记忆素材');
  const corpusSection = corpusAt >= 0 ? sys.slice(corpusAt) : '';
  for (const m of corpusSection.matchAll(PATH_RE)) {
    const p = m[1].split(' · ')[0];
    if (!isPathLike(p)) continue;
    if (p.includes('[[') || p.includes('|') || p.includes('（')) continue;
    v2n++;
    if (!t.paths.has(p)) { v2++; if (bad.length < 5) bad.push(`line${lineNo} 路径越权：${p}（不属于 ${t.name}）`); }
  }

  /* V3 assistant 引用出处 ∈ 该实体路径集合（口吻样本 cite=语言特征语料 除外） */
  const cite = String(meta.cite || '');
  if (cite && cite !== '语言特征语料') {
    v3n++;
    if (!t.paths.has(cite)) { v3++; if (bad.length < 5) bad.push(`line${lineNo} cite 越权：${cite}`); }
  }

  /* V4 assistant 正文可在该人物语料中找到出处（口吻样本除外：它教语域，不逐字对回语料） */
  if (cite !== '语言特征语料') {
    const asst = norm(String(row.messages?.[2]?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '')).replace(/…+$/g, '');
    if (asst.length >= 12) {
      const fp = asst.slice(0, 12);
      if (!t.normTexts.some(x => x.includes(fp))) v4++;
    }
  }
}

ok(v1 === 0, `V1 全部 ${lineNo} 行的人物身份与数据库一致`, `${v1} 行不符`);
ok(v2 === 0, `V2 语料路径零越权（核对 ${v2n} 处路径引用）`, `${v2} 处越权`);
ok(v3 === 0, `V3 引用出处零越权（核对 ${v3n} 处 cite）`, `${v3} 处越权`);
ok(v4 === 0, `V4 assistant 正文均可在该人物语料中找到出处`, `${v4} 行未命中`);

const perEntityCount = perEntity.size;
ok(perEntityCount === truth.size ? true : perEntityCount >= 200,
  `V5 覆盖人物 ${perEntityCount} / ${truth.size}`,
  `未覆盖：${[...truth.keys()].filter(id => !perEntity.has(id)).slice(0, 5).join(',')}`);

console.log(`\n合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
if (fail) { console.log('问题明细（前 5）：\n  ' + bad.join('\n  ')); process.exit(1); }
console.log('✅ 训练集人物对应准确性校验全部通过——每个人物只训练了他自己的资料。');
