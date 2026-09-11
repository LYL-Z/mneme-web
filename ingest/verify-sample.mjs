/**
 * M2 核对脚本 · 随机抽 20 篇公开文档，数据库 vs 文件系统实测比对（v3 §6.2-M2）
 * 断言：标题一致、sha256 前缀与重算值一致、mtime 日期一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VAULT = 'D:/The Memory/The Memory';
const db = new DatabaseSync(path.join(HERE, 'mneme.db'), { readOnly: true });

const rows = db.prepare("SELECT path,title,sha256,mtime,body FROM documents ORDER BY RANDOM() LIMIT 20").all();
let bad = 0;
for (const r of rows) {
  const abs = path.join(VAULT, r.path);
  let raw = '';
  try { raw = fs.readFileSync(abs, 'utf8'); } catch { console.log(`❌ 读取失败: ${r.path}`); bad++; continue; }
  const h = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
  const titleM = raw.match(/^#\s+(.+)$/m);
  const title = (titleM ? titleM[1].trim() : path.basename(r.path, '.md')).replace(/^#+\s*/, '');
  const st = fs.statSync(abs);
  const okHash = h === r.sha256;
  const okTitle = title === r.title;
  const okMtime = new Date(st.mtime).toISOString() === r.mtime;
  if (!okHash || !okTitle || !okMtime) {
    bad++;
    console.log(`❌ ${r.path} hash:${okHash} title:${okTitle}(${JSON.stringify(r.title)} vs ${JSON.stringify(title)}) mtime:${okMtime}`);
  }
}
console.log(bad === 0 ? `✅ 20 篇抽样全部一致（hash/title/mtime）` : `❌ ${bad} 篇不一致`);
process.exit(bad === 0 ? 0 : 1);
