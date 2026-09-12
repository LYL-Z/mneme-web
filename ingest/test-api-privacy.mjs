/**
 * ΜΝΗΜΗ · API 级隐私红线测试（v8 新增 · 最关键的一道门）
 *
 * 为什么必须有它：
 *   原有的 test-privacy.mjs 只扫数据库，所以「documents 里躺着私密行」能被发现，
 *   但 /api/search、/api/graph、/api/entities、/api/timeline、/api/domains/:name/docs
 *   这些出口的旁路一个都没测出来——这正是 281 处泄漏长期被忽略的根因。
 *   本测试以「仅持访问口令、未解锁绝密门」的身份，对每个 API 出口做断言。
 *
 * 用法：
 *   # A. 自起服务（默认）：用本机 ingest/mneme.db 在随机端口起服务，跑完自动关
 *   node ingest/test-api-privacy.mjs
 *
 *   # B. 打已部署的实例
 *   MNEME_BASE=https://your.site MNEME_TOKEN=xxx node ingest/test-api-privacy.mjs
 *
 * 退出码：0 = 全部通过；1 = 存在泄漏（禁止交付）
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SECRET_NAME, SECRET_DOC } from '../server/privacy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const TOKEN = process.env.MNEME_TOKEN || 'mneme';
const PRIV_RE = /私人资料|隐私\//;
const QN_MARK = '问卷作答全文';
const PARENT_LABELS = ['母亲', '父亲', '妈妈', '爸爸'];

/* 需要按「私密路径」判定的字段名。绝密姓名可以出现在公开层路径（锁定档可点开）。 */
const IDENT_KEYS = ['path', 'doc_path', 'std_id', 'role_doc_path', 'doc', 'to_target', 'from_doc'];
/* 问卷作答全文文档型实体不得被枚举（父母卷按设计公开） */
const NAME_KEYS = ['display_name', 'title', 'name', 'respondent_label'];
/* 需要整体脱敏的字段名（元数据不得带私密路径 / 问卷全文路径） */
const META_KEYS = ['meta'];

/** 单条实体探测用 id：入库会重排主键，禁止写死。不向 stdout 打印姓名。 */
function probeHiddenEntityIds() {
  const envPriv = process.env.MNEME_PRIV_ENTITY_ID ? +process.env.MNEME_PRIV_ENTITY_ID : 0;
  const envSec = process.env.MNEME_SECRET_ENTITY_ID ? +process.env.MNEME_SECRET_ENTITY_ID : 0;
  if (envPriv && envSec) return { privId: envPriv, secId: envSec };
  try {
    const db = new DatabaseSync(path.join(HERE, 'mneme.db'), { readOnly: true });
    const priv = db.prepare(
      `SELECT id FROM entities WHERE COALESCE(std_id,'') LIKE '%私人资料%' OR COALESCE(role_doc_path,'') LIKE '%私人资料%'
        OR COALESCE(std_id,'') LIKE '%隐私%' OR COALESCE(role_doc_path,'') LIKE '%隐私%' LIMIT 1`,
    ).get();
    /* 绝密 403 探测要避开同时也落在私密路径的行：那些按规则先走 404。 */
    const sec = SECRET_NAME
      ? db.prepare(
        `SELECT id FROM entities WHERE display_name LIKE ?
          AND COALESCE(std_id,'') NOT LIKE '%私人资料%' AND COALESCE(role_doc_path,'') NOT LIKE '%私人资料%'
          AND COALESCE(std_id,'') NOT LIKE '%隐私%' AND COALESCE(role_doc_path,'') NOT LIKE '%隐私%'
          LIMIT 1`,
      ).get(`%${SECRET_NAME}%`)
      : null;
    db.close();
    return { privId: envPriv || priv?.id || 0, secId: envSec || sec?.id || 0 };
  } catch {
    return { privId: envPriv, secId: envSec };
  }
}

const fails = [];
const ok = (label, cond, extra = '') => {
  if (cond) console.log(`  ✅ ${label}${extra ? ' ' + extra : ''}`);
  else { console.log(`  ❌ ${label}${extra ? ' ' + extra : ''}`); fails.push(label); }
};

/* ---------- 通用：在 JSON 的结构化字段里找私密/绝密残留 ---------- */
function scan(value, hits = [], keyPath = '') {
  if (value == null) return hits;
  if (Array.isArray(value)) { value.forEach((v, i) => scan(v, hits, `${keyPath}[${i}]`)); return hits; }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) scan(v, hits, keyPath ? `${keyPath}.${k}` : k);
    return hits;
  }
  if (typeof value !== 'string') return hits;
  const key = keyPath.split('.').pop().replace(/\[\d+\]$/, '');
  if (IDENT_KEYS.includes(key)) {
    if (PRIV_RE.test(value)) hits.push(`${keyPath} 含私密路径: ${value.slice(0, 80)}`);
  } else if (NAME_KEYS.includes(key)) {
    if (value.includes(QN_MARK) && ![...PARENT_LABELS].some(l => value.startsWith(l))) {
      hits.push(`${keyPath} 暴露问卷作答全文实体: ${value.slice(0, 80)}`);
    }
  } else if (META_KEYS.includes(key)) {
    if (PRIV_RE.test(value) || value.includes(QN_MARK)) {
      hits.push(`${keyPath} 未脱敏: ${value.slice(0, 80)}`);
    }
  }
  return hits;
}

/** 锁定档可以露姓名/标题，不得带正文、摘要、私密路径字段 */
function stubLeak(value, hits = []) {
  if (value == null) return hits;
  if (Array.isArray(value)) { value.forEach(v => stubLeak(v, hits)); return hits; }
  if (typeof value !== 'object') return hits;
  if (value.locked) {
    if (value.sn || value.snippet) hits.push('锁定档带摘要');
    if (value.detail) hits.push('锁定档带 detail');
    if (value.ref || value.ref_title) hits.push('锁定档带原文路径');
    if (value.std_id || value.role_doc_path || value.doc) hits.push('锁定档带 std_id/doc');
    if (typeof value.body === 'string' && value.body.length) hits.push('锁定档带正文');
  }
  for (const v of Object.values(value)) stubLeak(v, hits);
  return hits;
}

let BASE = process.env.MNEME_BASE || '';
let child = null;

async function waitHealth(url, timeoutMs = 20000) {
  const t0 = Date.now();
  let cookie = '';
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${url}/api/health`);
      if (r.ok) {
        /* 波4：health 对未登录只回 {ok:true}——先过口令门再取部署态（strict/build/mode） */
        if (!cookie) {
          try {
            const lr = await fetch(`${url}/api/login`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ token: process.env.MNEME_TOKEN || 'mneme' }),
            });
            cookie = lr.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
          } catch { /* 门还没起来 */ }
        }
        if (cookie) {
          const r2 = await fetch(`${url}/api/health`, { headers: { cookie } });
          if (r2.ok) return await r2.json();
        }
        return await r.json();
      }
    } catch { /* 还没起来 */ }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('服务未在超时内就绪');
}

let cookie = '';
async function api(pathname) {
  const r = await fetch(`${BASE}${pathname}`, { headers: cookie ? { cookie } : {} });
  let body = null;
  const text = await r.text();
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}
async function login() {
  const r = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: TOKEN }),
  });
  if (!r.ok) throw new Error(`登录失败（${r.status}）：MNEME_TOKEN 是否正确？`);
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
  cookie = sc.filter(Boolean).map(s => s.split(';')[0]).join('; ');
}

async function main() {
  /* ---------- 准备服务 ---------- */
  if (!BASE) {
    const port = 8531 + Math.floor(Math.random() * 100);
    BASE = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['--experimental-sqlite', 'server/server.mjs'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), MNEME_LOG: '0', MNEME_WATCH: '0', MNEME_DB: path.join(HERE, 'mneme.db') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr.on('data', d => { const s = String(d); if (!/ExperimentalWarning|trace-warnings/.test(s)) process.stderr.write(`[server] ${s}`); });
    child.stdout.on('data', () => {});
  }
  const health = await waitHealth(BASE);
  console.log(`目标：${BASE}  (mode=${health.mode}, build=${health.build ?? '-'}, strict=${health.strict ? 'on' : 'off'})`);
  if (!process.env.MNEME_BASE) {
    ok('本机自起服务 STRICT 默认关闭', health.strict === false);
  }
  await login();
  console.log('已登录（持访问口令、未解锁绝密门）\n');

  /* ---------- 1. 实体枚举 ---------- */
  {
    const { status, body } = await api('/api/entities?limit=1000');
    const rows = Array.isArray(body) ? body : [];
    const leaks = [...scan(rows), ...stubLeak(rows)];
    ok('GET /api/entities 无私密层 / 锁定档无正文', status === 200 && rows.length > 0 && leaks.length === 0,
      `(${rows.length} 条)`);
    if (leaks.length) console.log('     ' + leaks.slice(0, 3).join('\n     '));
    if (SECRET_NAME) {
      const locked = rows.filter(e => e.locked && String(e.display_name || '').includes(SECRET_NAME));
      ok('GET /api/entities 绝密人物以锁定档出现', locked.length > 0, `(${locked.length} 条)`);
    }
  }

  /* ---------- 2. 星图 ---------- */
  {
    const { status, body } = await api('/api/graph');
    const leaks = [...scan(body), ...stubLeak(body)];
    ok('GET /api/graph 无私密路径 / 锁定星无 doc', status === 200 && leaks.length === 0,
      `(${body?.nodes?.length ?? '?'} 节点 / ${body?.edges?.length ?? '?'} 边)`);
    if (leaks.length) console.log('     ' + leaks.slice(0, 3).join('\n     '));
    if (SECRET_NAME) {
      const locked = (body?.nodes || []).filter(n => n.locked && String(n.name || '').includes(SECRET_NAME));
      ok('GET /api/graph 绝密人物以锁定星出现', locked.length > 0, `(${locked.length} 颗)`);
    }
  }

  /* ---------- 3. 单条实体（枚举绕过） ---------- */
  {
    const { privId, secId } = probeHiddenEntityIds();
    if (privId) {
      const priv = await api(`/api/entities/${privId}`);
      ok(`GET /api/entities/${privId}（私密实体）→ 404`, priv.status === 404, `得到 ${priv.status}`);
    } else {
      console.log('  ⏭  私密实体直取跳过（库内未定位到私密实体 id）');
    }
    if (secId) {
      const sec = await api(`/api/entities/${secId}`);
      ok(`GET /api/entities/${secId}（绝密实体）→ 403`, sec.status === 403, `得到 ${sec.status}`);
    } else if (SECRET_NAME) {
      console.log('  ⏭  绝密实体直取跳过（库内未定位到绝密实体 id）');
    }
  }

  /* ---------- 4. 检索（拼音 + 中文 + 私密关键词） ---------- */
  const searches = [['拼音 zwz', 'zwz'], ['私密关键词', '私人资料'], ['问卷全文', QN_MARK]];
  if (SECRET_NAME) searches.splice(1, 0, ['姓名', SECRET_NAME]);
  for (const [label, q] of searches) {
    const { status, body } = await api(`/api/search?q=${encodeURIComponent(q)}`);
    const hits = [...scan(body?.groups ?? {}), ...stubLeak(body?.groups ?? {})];
    ok(`GET /api/search（${label}）无私密层 / 锁定档无摘要`, status === 200 && hits.length === 0);
    if (hits.length) console.log('     ' + hits.slice(0, 3).join('\n     '));
    if (SECRET_NAME && q === SECRET_NAME) {
      const people = body?.groups?.person || [];
      ok('  └ 姓名检索得到锁定人物', people.some(p => p.locked && String(p.display_name || '').includes(SECRET_NAME)));
    }
  }

  /* ---------- 5. 时间线 ---------- */
  {
    const { status, body } = await api('/api/timeline');
    const rows = Array.isArray(body) ? body : [];
    const sec = SECRET_NAME ? rows.filter(e => String(e.title || '').includes(SECRET_NAME)) : [];
    const stubHits = stubLeak(rows);
    ok('GET /api/timeline 锁定档无 detail/ref', status === 200 && stubHits.length === 0, `(${rows.length} 条)`);
    if (SECRET_NAME && sec.length) ok('GET /api/timeline 点名事件均锁定', sec.every(e => e.locked && !e.detail && !e.ref));
  }
  {
    const { status } = await api('/api/timeline?stage=' + encodeURIComponent('高中'));
    ok('GET /api/timeline?stage= 不再 500', status === 200, `得到 ${status}`);
  }

  /* ---------- 6. 域内文档清单（含 meta） ---------- */
  {
    const { status, body } = await api('/api/domains/' + encodeURIComponent('成长叙事') + '/docs');
    const hits = scan(body);
    ok('GET /api/domains/:name/docs 无私密层/问卷全文/meta 残留', status === 200 && hits.length === 0
      && stubLeak(body).length === 0,
      `(${body?.total ?? '?'} 篇)`);
    if (hits.length) console.log('     ' + hits.slice(0, 3).join('\n     '));
  }

  /* ---------- 7. 问卷：身份字段 ---------- */
  {
    const { status, body } = await api('/api/questionnaires');
    const rows = Array.isArray(body) ? body : [];
    const locked = rows.filter(r => r.locked);
    const leak = locked.filter(r => r.respondent_label !== undefined || r.doc_path !== undefined);
    ok('GET /api/questionnaires 锁定卷无身份/路径', status === 200 && leak.length === 0,
      `(${locked.length}/${rows.length} 锁定)`);
  }

  /* ---------- 8. 文档出口（三级状态码） ---------- */
  const docCases = [
    ['私密层文档 → 404', '/api/doc/' + encodeURIComponent('私人资料/人物/刘弈帆/刘弈帆人物多维度特征全分析-用户原文-2026-08-13（私密）.md'), 404],
    ['卷二旧设计稿 → 403', '/api/doc/' + encodeURIComponent('长篇创作/章节设计-第二卷-青春与阵痛.md'), 403],
    ['卷三试写样章 → 403', '/api/doc/' + encodeURIComponent('长篇创作/试写/第三卷样章-烟花与婚礼进行曲.md'), 403],
    ['第三部章稿 → 403', '/api/doc/' + encodeURIComponent('百万长文写作/章稿/第三部-桌上.md'), 403],
    ['人物调度页 → 403', '/api/doc/' + encodeURIComponent('百万长文写作/人物.md'), 403],
    ['非父母卷问卷 → 403', '/api/doc/' + encodeURIComponent('问卷回收/2026-09-08-V3-向睿馨问卷作答全文.md'), 403],
    ['路径穿越 → 404', '/api/doc/' + encodeURIComponent('../../etc/passwd'), 404],
  ];
  if (SECRET_DOC) docCases.splice(1, 0, ['绝密实体文档 → 403', '/api/doc/' + encodeURIComponent(SECRET_DOC), 403]);
  for (const [label, url, want] of docCases) {
    const { status } = await api(url);
    ok(`GET /api/doc（${label}）`, status === want, `期望 ${want}，得到 ${status}`);
  }
  {
    const { status, body } = await api('/api/doc/' + encodeURIComponent('问卷回收/2026-09-05-母亲问卷作答全文.md'));
    ok('GET /api/doc（父母卷问卷 → 200，公开）', status === 200, `得到 ${status}`);
    ok('  └ 且返回内容确实有正文', typeof body?.body === 'string' && body.body.length > 0);
  }

  /* ---------- 9. 意象 / 卷 / 章节 ---------- */
  {
    const { status, body } = await api('/api/imagery');
    const rows = Array.isArray(body) ? body : [];
    const secretIm = SECRET_NAME ? rows.filter(i => String(i.name || '').includes(SECRET_NAME)) : [];
    ok('GET /api/imagery 绝密意象以锁定档出现', status === 200 && (!SECRET_NAME || (secretIm.length > 0 && secretIm.every(i => i.locked))), `(${rows.length} 条)`);
    ok('GET /api/imagery 锁定档无泄漏字段', stubLeak(rows).length === 0);
    const one = await api('/api/imagery/26');
    ok('GET /api/imagery/26（绝密意象）→ 403', one.status === 403, `得到 ${one.status}`);
  }
  {
    const v = await api('/api/volumes/B3');
    const chs = Array.isArray(v.body?.chapters) ? v.body.chapters : [];
    const lockedCh = chs.filter(c => c.locked);
    const vols = await api('/api/volumes');
    ok('GET /api/volumes 八扇门', vols.status === 200 && Array.isArray(vols.body) && vols.body.length === 8, `得到 ${vols.body?.length ?? '?'}`);
    ok('GET /api/volumes/B3 → 200（目录公开）', v.status === 200, `得到 ${v.status}`);
    ok('GET /api/volumes/B3 密章带 lock 标、标题仍在', v.status === 200 && lockedCh.length > 0 && lockedCh.every(c => c.title), `(${lockedCh.length} 题)`);
    const openCh = await api('/api/chapter/B1/1');
    ok('GET /api/chapter/B1/1（公开章）→ 200', openCh.status === 200, `得到 ${openCh.status}`);
    const secretCh = await api('/api/chapter/B3/26');
    ok('GET /api/chapter/B3/26（密章）→ 403', secretCh.status === 403, `得到 ${secretCh.status}`);
  }

  /* ---------- 9b. 伏应矩阵（未解锁不得带出绝密姓名） ---------- */
  {
    const { status, body } = await api('/api/foreshadow');
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    const blob = JSON.stringify(rows);
    ok('GET /api/foreshadow 无绝密姓名', status === 200 && (!SECRET_NAME || !blob.includes(SECRET_NAME)), `(${rows.length} 条)`);
  }

  /* ---------- 9c. 待核队列（未解锁不得带出绝密姓名 / 私密路径） ---------- */
  {
    const { status, body } = await api('/api/queue');
    const rows = Array.isArray(body) ? body : [];
    const hits = scan(body);
    ok('GET /api/queue 无私密路径 / 锁定档无摘要', status === 200 && hits.length === 0 && stubLeak(rows).length === 0, `(${rows.length} 条)`);
    if (hits.length) console.log('     ' + hits.slice(0, 3).join('\n     '));
  }

  /* ---------- 9d. 写作台：未授权不得写；私密层不可取源 ---------- */
  {
    const pub = '/api/source/' + encodeURIComponent('问卷回收/2026-09-05-母亲问卷作答全文.md');
    const priv = '/api/source/' + encodeURIComponent('私人资料/人物/刘佑林/刘佑林朋友圈148则完整转录与索引-2018至2024（私密）.md');
    const g = await api(priv);
    ok('GET /api/source（私密层）→ 404', g.status === 404, `得到 ${g.status}`);
    const put = await fetch(`${BASE}/api/source/` + encodeURIComponent('问卷回收/2026-09-05-母亲问卷作答全文.md'), {
      method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ text: 'should-not-write' }),
    });
    ok('PUT /api/source 拒绝写回知识库 → 501', put.status === 501, `得到 ${put.status}`);
    const ai = await fetch(`${BASE}/api/ai/draft`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ path: '私人资料/x.md', text: 'hi', mode: 'continue' }),
    });
    ok('POST /api/ai/draft 拒绝代写写回 → 501', ai.status === 501, `得到 ${ai.status}`);
    const st = await api('/api/admin/status');
    ok('GET /api/admin/status 默认未授权', st.status === 200 && st.body?.admin === false);
    const pubGet = await api(pub);
    ok('GET /api/source（公开父母卷）可读', pubGet.status === 200 && typeof pubGet.body?.text === 'string');
  }

  /* ---------- 10. 解锁后应当恢复（确认不是「一刀切锁死」） ---------- */
  if (process.env.MNEME_SECRET) {
    const r = await fetch(`${BASE}/api/secret/unlock`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ password: process.env.MNEME_SECRET }),
    });
    if (r.ok) {
      const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
      /* 追加而非替换：解锁 cookie 必须与访问口令 cookie 并存 */
      cookie = [cookie, ...sc.filter(Boolean).map(s => s.split(';')[0])].filter(Boolean).join('; ');
      const g = await api('/api/graph');
      ok('解锁后 /api/graph 恢复绝密节点', (g.body?.nodes?.length ?? 0) > 0, `(${g.body?.nodes?.length} 节点)`);
      if (SECRET_DOC) {
        const d = await api('/api/doc/' + encodeURIComponent(SECRET_DOC));
        ok('解锁后绝密文档可读', d.status === 200, `得到 ${d.status}`);
      }
    } else {
      console.log(`  ⏭  解锁用例跳过（MNEME_SECRET 不匹配，HTTP ${r.status}）`);
    }
  } else {
    console.log('  ⏭  解锁用例跳过（未设 MNEME_SECRET）');
  }
}

main()
  .then(() => {
    console.log(fails.length
      ? `\n❌ API 级红线测试失败 ${fails.length} 项，禁止交付：\n   - ${fails.join('\n   - ')}`
      : '\n✅ API 级红线测试全部通过（私密层不可枚举；绝密以锁定档出现，正文仍 403）');
    process.exitCode = fails.length ? 1 : 0;
  })
  .catch((e) => {
    console.error(`\n❌ 测试执行失败：${e.message}`);
    process.exitCode = 1;
  })
  .finally(() => { if (child) child.kill(); });
