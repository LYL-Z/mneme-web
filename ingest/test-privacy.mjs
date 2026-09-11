/**
 * ΜΝΗΜΗ · 数据库级隐私结构测试（v8 修订）
 *
 * ⚠️ 策略说明（v3 → v4 的变更，务必先读）
 *   v3 铁律是「私密层零提取」——私密层内容完全不进库。
 *   v4 起改为「私密层 md 收录 + 加密门禁后展示」（见 ingest.mjs:62 的注释）：
 *     私密文档**允许**以 is_private=1 入 documents 表，由 /api/secret/unlock 门禁保护。
 *   因此「库里存在私密路径」不再等于缺陷；本测试改为断言 v4 策略下必须成立的结构不变量。
 *
 *   ★ 真正的红线（「未解锁时私密/绝密内容一个字都不能出去」）由 API 级测试守护：
 *     node ingest/test-api-privacy.mjs
 *
 * 本测试断言（全部为结构不变量，不依赖随机抽样）：
 *   P1  files_fts 中不存在任何私密文档（私密内容不进全文索引）
 *   P2  私密 wikilink 的 to_target 一律为占位符 '[私密·已隔离]'，不落真实路径
 *   P3  路径命中私密段（私人资料/隐私）的文档，is_private 必须为 1（不得被误标为公开）
 *   P4  evidence_spans / entity_mentions / timeline_events 不得挂在私密文档上
 *   P5  chapters.doc_path 不得指向私密文档
 *   P6  FTS 索引可用性探针（中文用例）
 *
 * 运行：node --experimental-sqlite ingest/test-privacy.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VAULT = 'D:/The Memory/The Memory';
const db = new DatabaseSync(path.join(HERE, 'mneme.db'), { readOnly: true });

const fails = [];
const check = (label, bad, detail = '') => {
  if (bad > 0) { fails.push(label); console.log(`❌ ${label}：${bad} 处 ${detail}`); }
  else console.log(`✅ ${label}`);
};

/* ---------- 0. 基线：私密层规模（仅统计，不作失败判定） ---------- */
const privDocs = db.prepare('SELECT COUNT(*) c FROM documents WHERE is_private=1').get().c;
const pubDocs = db.prepare('SELECT COUNT(*) c FROM documents WHERE is_private=0').get().c;
console.log(`库内文档：公开 ${pubDocs} / 私密（加密门禁保护） ${privDocs}`);
console.log(`vault 私密层 md 样本：${(() => {
  const names = new Set();
  (function walk(dir) {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (!e.name.startsWith('.')) walk(abs); continue; }
      if (!e.name.toLowerCase().endsWith('.md')) continue;
      const rel = path.relative(VAULT, abs).split(path.sep).join('/');
      if (/私人资料|隐私\//.test(rel)) names.add(rel.replace(/\.md$/i, ''));
    }
  })(VAULT);
  return names.size;
})()} 个`);

/* ---------- P1：私密文档不得进全文索引 ---------- */
check('P1 files_fts 无私密文档',
  db.prepare(`SELECT COUNT(*) c FROM files_fts f JOIN documents d ON d.id=f.doc_id WHERE d.is_private=1`).get().c,
  '（私密内容泄漏进全文检索）');
check('P1b files_fts.path 无私密路径',
  db.prepare(`SELECT COUNT(*) c FROM files_fts WHERE path LIKE '%私人资料%' OR path LIKE '%隐私/%'`).get().c);

/* ---------- P2：私密边必须占位 ---------- */
check('P2 私密 wikilink 已占位',
  db.prepare(`SELECT COUNT(*) c FROM wikilinks WHERE is_private=1 AND to_target != '[私密·已隔离]'`).get().c,
  '（真实私密路径留在库里，等待被别的查询漏出去）');
check('P2b 公开 wikilink 无私密目标',
  db.prepare(`SELECT COUNT(*) c FROM wikilinks WHERE is_private=0 AND (to_target LIKE '%私人资料%' OR to_target LIKE '%隐私/%')`).get().c);

/* ---------- P3：私密路径必须标 is_private=1 ---------- */
check('P3 私密路径未被误标为公开',
  db.prepare(`SELECT COUNT(*) c FROM documents WHERE is_private=0 AND (path LIKE '%私人资料%' OR path LIKE '%隐私/%')`).get().c);

/* ---------- P4：关联表不得挂私密文档 ---------- */
for (const [label, sql] of [
  ['P4a evidence_spans 无挂私密文档', 'SELECT COUNT(*) c FROM evidence_spans es JOIN documents d ON d.id=es.doc_id WHERE d.is_private=1'],
  ['P4b entity_mentions 无挂私密文档', 'SELECT COUNT(*) c FROM entity_mentions m JOIN documents d ON d.id=m.doc_id WHERE d.is_private=1'],
  ['P4c timeline_events 无挂私密文档', 'SELECT COUNT(*) c FROM timeline_events t JOIN documents d ON d.id=t.doc_id WHERE d.is_private=1'],
]) check(label, db.prepare(sql).get().c);

/* ---------- P5：章节不得指向私密文档 ---------- */
check('P5 chapters.doc_path 无私密指向',
  db.prepare(`SELECT COUNT(*) c FROM chapters WHERE COALESCE(doc_path,'') LIKE '%私人资料%' OR COALESCE(doc_path,'') LIKE '%隐私/%'`).get().c);

/* ---------- P6：FTS 可用性探针 ---------- */
const ftsHit = (q) => db.prepare('SELECT COUNT(*) c FROM files_fts WHERE files_fts MATCH ?').get(`"${q}"`).c;
const probes = ['物理竞赛', '桃园三结义', '补写的手册'];
const dead = probes.filter(q => ftsHit(q) === 0);
probes.forEach(q => console.log(`   FTS「${q}」命中 ${ftsHit(q)} 篇`));
check('P6 FTS 索引可用', dead.length, dead.join(','));

db.close();
if (fails.length === 0) {
  console.log('\n✅ 数据库级隐私结构测试通过（P1–P6）');
  console.log('   下一步请跑 API 级红线测试：node ingest/test-api-privacy.mjs');
} else {
  console.log(`\n❌ ${fails.length} 组断言失败，禁止交付：${fails.join(' / ')}`);
  process.exit(1);
}
