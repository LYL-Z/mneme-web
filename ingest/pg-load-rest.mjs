/**
 * ΜΝΗΜΗ · M7 CloudBase PG 灌库（HTTP 网关通道，适配共享集群无 TCP 直连）
 * 链路：匿名登录取 access_token → REST POST /v1/rdb/rest/<table> 批量插入
 * 用法：MNEME_ENV_ID=... MNEME_PUBKEY=... node pg-load-rest.mjs [--table=xxx]
 * 前置：GRANT USAGE ON SCHEMA public TO anon; GRANT INSERT ON <13 表> TO anon;
 *       （灌库完成后由运维侧 REVOKE + 关闭匿名登录）
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENV_ID = process.env.MNEME_ENV_ID || 'the-memory-d1g13bjvuec88d3c4';
const PUBKEY = process.env.MNEME_PUBKEY || '';
const BASE = `https://${ENV_ID}.api.tcloudbasegateway.com`;
const DB_PATH = process.env.MNEME_DB || path.join(HERE, 'mneme.db');

const TABLES = [
  ['documents', 5],
  ['entities', 200],
  ['entity_mentions', 500],
  ['wikilinks', 500],
  ['timeline_events', 200],
  ['volumes', 50],
  ['chapters', 100],
  ['imagery', 100],
  ['imagery_occurrences', 200],
  ['questionnaires', 100],
  ['evidence_spans', 200],
  ['year_density', 100],
  ['audit_runs', 10],
];

const DEVICE_ID = process.env.MNEME_DEVICE_ID || 'mneme-pgloader-6f1c2b8a'; // 固定设备id：<72字符，复用同一匿名用户（openapi：x-device-id 必填）

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function anonToken() {
  const r = await fetch(`${BASE}/auth/v1/signin/anonymously`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${PUBKEY}`,
      'x-device-id': DEVICE_ID, // openapi 契约：匿名登录必填，缺失报「请在请求头添加设备id」
    },
    body: '{}',
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`匿名登录失败 ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  const token = j?.access_token || j?.data?.access_token;
  if (!token) throw new Error(`匿名登录无 access_token: ${JSON.stringify(j).slice(0, 300)}`);
  return token;
}

async function insertBatch(token, table, rows, attempt = 1) {
  const r = await fetch(`${BASE}/v1/rdb/rest/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (r.status === 401 || r.status === 429 || r.status >= 500) {
    if (attempt >= 4) throw new Error(`${table} 插入失败 ${r.status}: ${(await r.text()).slice(0, 300)}`);
    await sleep(1500 * attempt);
    return insertBatch(token, table, rows, attempt + 1); // token 过期/限流/网关抖动 → 退避重试
  }
  if (r.status !== 201 && r.status !== 200) {
    throw new Error(`${table} 插入失败 ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }
  return rows.length;
}

async function main() {
  if (!PUBKEY) { console.error('缺少 MNEME_PUBKEY'); process.exit(1); }
  const only = process.argv.find(a => a.startsWith('--table='))?.slice(8);
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const token = await anonToken();
  console.log('[load] 匿名令牌获取成功');
  let grand = 0;
  for (const [table, chunk] of TABLES) {
    if (only && table !== only) continue;
    const cols = db.prepare(`SELECT name FROM pragma_table_info('${table}') ORDER BY cid`).all().map(c => c.name);
    const rows = db.prepare(`SELECT ${cols.join(',')} FROM ${table}`).all();
    let n = 0;
    for (let i = 0; i < rows.length; i += chunk) {
      const batch = rows.slice(i, i + chunk).map(r => {
        const o = {};
        for (const c of cols) o[c] = r[c] === undefined ? null : r[c];
        return o;
      });
      n += await insertBatch(token, table, batch);
      process.stdout.write(`\r[load] ${table}: ${n}/${rows.length}`);
    }
    console.log(`\r[load] ${table}: ${n} 行 ✓`);
    grand += n;
  }
  db.close();
  console.log(`[load] 完成，共 ${grand} 行`);
}

main().catch(e => { console.error('[load] 失败:', e.message); process.exit(1); });
