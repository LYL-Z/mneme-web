/**
 * ΜΝΗΜΗ · M7 PG 灌库：mneme.db（SQLite）→ CloudBase PostgreSQL，幂等。
 * 容器内入口：server.mjs 启动前调用 ensurePgLoaded()（MNEME_AUTOLOAD=0 可关闭）。
 * - documents 有数据 → 跳过
 * - 否则读本地 mneme.db 全部 13 表，单事务批量 INSERT
 * 环境：MNEME_PG（必填）、MNEME_PG_SSL=1、MNEME_DB（覆盖库路径）
 */
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

pg.types.setTypeParser(20, (v) => parseInt(v, 10));

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* 列清单与 migration 20260906131500_mneme_schema 一致 */
const TABLES = [
  ['documents', ['id', 'path', 'title', 'domain', 'doc_type', 'stage', 'volume', 'is_index', 'meta', 'body', 'raw_text', 'sha256', 'mtime', 'ingested_at']],
  ['entities', ['id', 'std_id', 'display_name', 'aliases', 'relation_group', 'stage', 'role_doc_path', 'mention_count', 'first_year', 'last_year']],
  ['entity_mentions', ['entity_id', 'doc_id', 'hits']],
  ['wikilinks', ['id', 'from_doc', 'to_target', 'display_text', 'resolved', 'is_private']],
  ['timeline_events', ['id', 'doc_id', 'year', 'month', 'exact_date', 'stage', 'volume', 'kind', 'title', 'is_public_background', 'ref']],
  ['volumes', ['code', 'seq', 'name', 'years', 'line_metaphor', 'mood', 'word_target', 'color_token']],
  ['chapters', ['id', 'volume_code', 'seq', 'title', 'est_chapters', 'est_words', 'doc_path', 'status', 'is_sample']],
  ['imagery', ['id', 'name', 'seq', 'candidate']],
  ['imagery_occurrences', ['id', 'imagery_id', 'doc_id', 'volume_code', 'scene', 'old_meaning', 'new_meaning', 'source_note', 'seq']],
  ['questionnaires', ['id', 'respondent_label', 'relation_label', 'doc_path', 'answers']],
  ['evidence_spans', ['id', 'doc_id', 'kind', 'snippet']],
  ['year_density', ['year', 'docs']],
  ['audit_runs', ['id', 'started_at', 'finished_at', 'scanned', 'ingested', 'excluded_private', 'excluded_system', 'masked', 'manifest']],
];

export async function ensurePgLoaded() {
  const pool = new pg.Pool({
    connectionString: process.env.MNEME_PG,
    max: 2,
    connectionTimeoutMillis: 10_000,
    ssl: process.env.MNEME_PG_SSL === '1' ? { rejectUnauthorized: false } : undefined,
  });
  try {
    const { rows } = await pool.query('SELECT COUNT(*)::int n FROM documents');
    if (rows[0].n > 0) {
      console.log(`[pg-load] documents 已有 ${rows[0].n} 行，跳过灌库`);
      return { skipped: true, docs: rows[0].n };
    }
    const dbPath = process.env.MNEME_DB || path.join(HERE, '..', 'ingest', 'mneme.db');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let total = 0;
      for (const [table, cols] of TABLES) {
        const dbRows = db.prepare(`SELECT ${cols.join(',')} FROM ${table}`).all();
        const CHUNK = table === 'documents' ? 20 : 200; // documents 含大文本，切小批
        for (let i = 0; i < dbRows.length; i += CHUNK) {
          const chunk = dbRows.slice(i, i + CHUNK);
          const values = [];
          const params = [];
          let pi = 0;
          for (const r of chunk) {
            values.push(`(${cols.map(() => `$${++pi}`).join(',')})`);
            for (const col of cols) params.push(r[col] === undefined ? null : r[col]);
          }
          await client.query(`INSERT INTO ${table}(${cols.join(',')}) VALUES ${values.join(',')}`, params);
        }
        total += dbRows.length;
        console.log(`[pg-load] ${table}: ${dbRows.length} 行`);
      }
      await client.query('COMMIT');
      console.log(`[pg-load] 灌库完成，共 ${total} 行`);
      return { loaded: true, total };
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    } finally {
      client.release();
      db.close();
    }
  } finally {
    await pool.end();
  }
}

/* 直接运行：node pg-load.mjs */
if (process.argv[1] && process.argv[1].endsWith('pg-load.mjs')) {
  ensurePgLoaded().then(r => { console.log(JSON.stringify(r)); process.exit(0); })
    .catch(e => { console.error('[pg-load] 失败:', e.message); process.exit(1); });
}
