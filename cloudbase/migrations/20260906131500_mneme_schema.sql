-- ΜΝΗΜΗ · M7 CloudBase PG schema
-- 与本地 SQLite（ingest/mneme.db）14 表对齐；files_fts 虚表不建——
-- PG 侧检索改用 pg_trgm GIN 索引 + LIKE，snippet 由服务层 JS 计算。
-- 所有 id 列保留原值（integer PRIMARY KEY，不用 serial），
-- entity_mentions / evidence_spans 等跨表引用依赖这些原值。

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS documents(
  id INTEGER PRIMARY KEY,
  path TEXT UNIQUE,
  title TEXT,
  domain TEXT,
  doc_type TEXT,
  stage TEXT,
  volume TEXT,
  is_index INTEGER,
  meta TEXT,
  body TEXT,
  raw_text TEXT,
  sha256 TEXT,
  mtime TEXT,
  ingested_at TEXT
);

CREATE TABLE IF NOT EXISTS entities(
  id INTEGER PRIMARY KEY,
  std_id TEXT UNIQUE,
  display_name TEXT,
  aliases TEXT,
  relation_group TEXT,
  stage TEXT,
  role_doc_path TEXT,
  mention_count INTEGER,
  first_year INTEGER,
  last_year INTEGER
);

CREATE TABLE IF NOT EXISTS entity_mentions(
  entity_id INTEGER,
  doc_id INTEGER,
  hits INTEGER,
  PRIMARY KEY(entity_id, doc_id)
);

CREATE TABLE IF NOT EXISTS wikilinks(
  id INTEGER PRIMARY KEY,
  from_doc TEXT,
  to_target TEXT,
  display_text TEXT,
  resolved INTEGER,
  is_private INTEGER
);

CREATE TABLE IF NOT EXISTS timeline_events(
  id INTEGER PRIMARY KEY,
  doc_id INTEGER,
  year INTEGER,
  month INTEGER,
  exact_date TEXT,
  stage TEXT,
  volume TEXT,
  kind TEXT,
  title TEXT,
  is_public_background INTEGER,
  ref TEXT
);

CREATE TABLE IF NOT EXISTS volumes(
  code TEXT PRIMARY KEY,
  seq INTEGER,
  name TEXT,
  years TEXT,
  line_metaphor TEXT,
  mood TEXT,
  word_target TEXT,
  color_token TEXT
);

CREATE TABLE IF NOT EXISTS chapters(
  id INTEGER PRIMARY KEY,
  volume_code TEXT,
  seq INTEGER,
  title TEXT,
  est_chapters INTEGER,
  est_words TEXT,
  doc_path TEXT,
  status TEXT,
  is_sample INTEGER
);

CREATE TABLE IF NOT EXISTS imagery(
  id INTEGER PRIMARY KEY,
  name TEXT,
  seq INTEGER,
  candidate INTEGER
);

CREATE TABLE IF NOT EXISTS imagery_occurrences(
  id INTEGER PRIMARY KEY,
  imagery_id INTEGER,
  doc_id TEXT,
  volume_code TEXT,
  scene TEXT,
  old_meaning TEXT,
  new_meaning TEXT,
  source_note TEXT,
  seq INTEGER
);

CREATE TABLE IF NOT EXISTS questionnaires(
  id INTEGER PRIMARY KEY,
  respondent_label TEXT,
  relation_label TEXT,
  doc_path TEXT,
  answers TEXT
);

CREATE TABLE IF NOT EXISTS evidence_spans(
  id INTEGER PRIMARY KEY,
  doc_id INTEGER,
  kind TEXT,
  snippet TEXT
);

CREATE TABLE IF NOT EXISTS year_density(
  year INTEGER PRIMARY KEY,
  docs INTEGER
);

CREATE TABLE IF NOT EXISTS audit_runs(
  id INTEGER PRIMARY KEY,
  started_at TEXT,
  finished_at TEXT,
  scanned INTEGER,
  ingested INTEGER,
  excluded_private INTEGER,
  excluded_system INTEGER,
  masked INTEGER,
  manifest TEXT
);

-- 统计视图（与 SQLite 版同构）
DROP VIEW IF EXISTS v_domain_stats;
CREATE VIEW v_domain_stats AS SELECT domain, COUNT(*) n FROM documents GROUP BY domain ORDER BY n DESC;

DROP VIEW IF EXISTS v_stage_stats;
CREATE VIEW v_stage_stats AS SELECT stage, COUNT(*) n FROM documents GROUP BY stage ORDER BY n DESC;

DROP VIEW IF EXISTS v_entity_mention_rank;
CREATE VIEW v_entity_mention_rank AS SELECT id, display_name, relation_group, stage, mention_count FROM entities ORDER BY mention_count DESC;

DROP VIEW IF EXISTS v_year_density;
CREATE VIEW v_year_density AS SELECT year, docs FROM year_density ORDER BY year;

-- 常规索引（对齐 SQLite 版）
CREATE INDEX IF NOT EXISTS idx_docs_domain ON documents(domain);
CREATE INDEX IF NOT EXISTS idx_docs_stage ON documents(stage);
CREATE INDEX IF NOT EXISTS idx_docs_volume ON documents(volume);
CREATE INDEX IF NOT EXISTS idx_links_from ON wikilinks(from_doc);
CREATE INDEX IF NOT EXISTS idx_links_target ON wikilinks(to_target);
CREATE INDEX IF NOT EXISTS idx_ev_doc ON evidence_spans(doc_id);
CREATE INDEX IF NOT EXISTS idx_tl_year ON timeline_events(year);

-- trgm GIN 索引（替代 SQLite FTS5；加速 LIKE '%kw%' 全文检索）
CREATE INDEX IF NOT EXISTS idx_docs_body_trgm ON documents USING GIN (body gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_docs_title_trgm ON documents USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ent_name_trgm ON entities USING GIN (display_name gin_trgm_ops);
