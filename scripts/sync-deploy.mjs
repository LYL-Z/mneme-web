#!/usr/bin/env node
/**
 * sync-deploy.mjs — 发布镜像前把本机产物收进 deploy/
 *
 * 过去靠手拷两步，漏一次线上就吃旧库或旧 server：
 *   ingest/mneme.db → deploy/mneme.db
 *   server/*.mjs    → deploy/server/
 *
 * 另写 deploy/BUILD（日期 + 主 JS 哈希）。容器 health.build 优先读它，
 * 不再被控制台里过期的 MNEME_BUILD 骗过。
 *
 * 用法：node scripts/sync-deploy.mjs
 * 退出码：0 成功或无本地库（CI）；1 拷贝失败
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DB = path.join(ROOT, 'ingest', 'mneme.db');
const DST_DB = path.join(ROOT, 'deploy', 'mneme.db');
const SRC_SERVER = path.join(ROOT, 'server');
const DST_SERVER = path.join(ROOT, 'deploy', 'server');
const SKIP = new Set(['privacy.local.json']);

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)}MB`;
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const copyIfChanged = (from, to) => {
  if (!fs.existsSync(from)) throw new Error(`缺少 ${path.relative(ROOT, from)}`);
  const same = fs.existsSync(to) && sha(from) === sha(to);
  if (same) return { copied: false, bytes: fs.statSync(to).size };
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return { copied: true, bytes: fs.statSync(to).size };
};

console.log('ΜΝΗΜΗ · sync-deploy');

if (!fs.existsSync(SRC_DB)) {
  console.warn('  ⚠ 无 ingest/mneme.db，跳过库同步（CI 或尚未 ingest）');
} else {
  try {
    const db = copyIfChanged(SRC_DB, DST_DB);
    console.log(`  ${db.copied ? '✓' : '·'} deploy/mneme.db  ${mb(db.bytes)}${db.copied ? '  已从 ingest 覆盖' : '  已是同一份'}`);
  } catch (e) {
    console.error(`  ✗ 库同步失败：${e.message}`);
    process.exit(1);
  }
}

let changed = 0;
for (const e of fs.readdirSync(SRC_SERVER, { withFileTypes: true })) {
  if (!e.isFile() || SKIP.has(e.name)) continue;
  const ext = path.extname(e.name);
  if (ext !== '.mjs' && e.name !== 'package.json' && e.name !== 'package-lock.json') continue;
  const r = copyIfChanged(path.join(SRC_SERVER, e.name), path.join(DST_SERVER, e.name));
  if (r.copied) {
    changed += 1;
    console.log(`  ✓ deploy/server/${e.name}`);
  }
}
console.log(`  ${changed ? `✓ server 更新 ${changed} 个文件` : '· server 已与本机一致'}（未拷 privacy.local.json）`);

const indexHtml = [
  path.join(ROOT, 'deploy', 'web-dist', 'index.html'),
  path.join(ROOT, 'site', 'index.html'),
].find(p => fs.existsSync(p));
let jsHash = 'nojs';
if (indexHtml) {
  const m = fs.readFileSync(indexHtml, 'utf8').match(/assets\/index-([A-Za-z0-9_-]+)\.js/);
  if (m) jsHash = m[1];
}
const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const stamp = `${day}-${jsHash}`;
fs.writeFileSync(path.join(ROOT, 'deploy', 'BUILD'), `${stamp}\n`);
console.log(`  ✓ deploy/BUILD  ${stamp}`);
