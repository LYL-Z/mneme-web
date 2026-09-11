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
import { SECRET_NAME, SECRET_DOC } from '../server/privacy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const TOKEN = process.env.MNEME_TOKEN || 'mneme';
const PRIV_RE = /私人资料|隐私\//;
const QN_MARK = '问卷作答全文';
const PARENT_LABELS = ['母亲', '父亲', '妈妈', '爸爸'];

/* 需要按「私密路径」判定的字段名 */
const IDENT_KEYS = ['path', 'doc_path', 'std_id', 'role_doc_path', 'doc', 'to_target', 'from_doc'];
/* 需要按「绝密姓名」判定的字段名 */
const NAME_KEYS = ['display_name', 'title', 'name', 'respondent_label'];
/* 需要整体脱敏的字段名（元数据，必须完全干净） */
const META_KEYS = ['meta'];
/* 检索摘要：只断言「绝密姓名」不得被高亮出来。
   摘要取自**公开文档的正文**，而作者自己的公开正文里会讨论 `私人资料/` 治理规则、
   也会写 `[[问卷回收/…母亲问卷作答全文|母亲卷]]` 这类指向公开文档的链接——
   那是作者的内容，不是 API 的泄漏。真正的门禁是：目标文档本身取不到（403/404）。 */
const SNIPPET_KEYS = ['sn', 'snippet'];

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
    else if (SECRET_NAME && value.includes(SECRET_NAME)) hits.push(`${keyPath} 含绝密姓名: ${value.slice(0, 80)}`);
  } else if (NAME_KEYS.includes(key)) {
    if (SECRET_NAME && value.includes(SECRET_NAME)) hits.push(`${keyPath} 含绝密姓名: ${value.slice(0, 80)}`);
    /* 问卷作答全文文档型实体不得被枚举（父母卷按设计公开，不在此列） */
    if (value.includes(QN_MARK) && ![...PARENT_LABELS].some(l => value.startsWith(l))) {
      hits.push(`${keyPath} 暴露问卷作答全文实体: ${value.slice(0, 80)}`);
    }
  } else if (META_KEYS.includes(key)) {
    if (PRIV_RE.test(value) || (SECRET_NAME && value.includes(SECRET_NAME)) || value.includes(QN_MARK)) {
      hits.push(`${keyPath} 未脱敏: ${value.slice(0, 80)}`);
    }
  } else if (SNIPPET_KEYS.includes(key)) {
    /* 摘要只查绝密姓名（公开正文本身可以提到私密治理规则与公开问卷链接） */
    if (SECRET_NAME && value.includes(SECRET_NAME)) hits.push(`${keyPath} 含绝密姓名: ${value.slice(0, 80)}`);
  }
  return hits;
}

let BASE = process.env.MNEME_BASE || '';
let child = null;

async function waitHealth(url, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${url}/api/health`);
      if (r.ok) return await r.json();
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
      env: { ...process.env, PORT: String(port), MNEME_LOG: '0', MNEME_DB: path.join(HERE, 'mneme.db') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr.on('data', d => { const s = String(d); if (!/ExperimentalWarning|trace-warnings/.test(s)) process.stderr.write(`[server] ${s}`); });
    child.stdout.on('data', () => {});
  }
  const health = await waitHealth(BASE);
  console.log(`目标：${BASE}  (mode=${health.mode}, build=${health.build ?? '-'})`);
  await login();
  console.log('已登录（持访问口令、未解锁绝密门）\n');

  /* ---------- 1. 实体枚举 ---------- */
  {
    const { status, body } = await api('/api/entities?limit=1000');
    const rows = Array.isArray(body) ? body : [];
    ok('GET /api/entities 无私密/绝密实体', status === 200 && rows.length > 0 && scan(rows).length === 0,
      `(${rows.length} 条)`);
    if (scan(rows).length) console.log('     ' + scan(rows).slice(0, 3).join('\n     '));
  }

  /* ---------- 2. 星图 ---------- */
  {
    const { status, body } = await api('/api/graph');
    const hits = scan(body);
    ok('GET /api/graph 无私密/绝密节点', status === 200 && hits.length === 0,
      `(${body?.nodes?.length ?? '?'} 节点 / ${body?.edges?.length ?? '?'} 边)`);
    if (hits.length) console.log('     ' + hits.slice(0, 3).join('\n     '));
  }

  /* ---------- 3. 单条实体（枚举绕过） ---------- */
  {
    const priv = await api('/api/entities/88');
    ok('GET /api/entities/88（私密实体）→ 404', priv.status === 404, `得到 ${priv.status}`);
    const sec = await api('/api/entities/249');
    ok('GET /api/entities/249（绝密实体）→ 403', sec.status === 403, `得到 ${sec.status}`);
  }

  /* ---------- 4. 检索（拼音 + 中文 + 私密关键词） ---------- */
  const searches = [['拼音 zwz', 'zwz'], ['私密关键词', '私人资料'], ['问卷全文', QN_MARK]];
  if (SECRET_NAME) searches.splice(1, 0, ['姓名', SECRET_NAME]);
  for (const [label, q] of searches) {
    const { status, body } = await api(`/api/search?q=${encodeURIComponent(q)}`);
    const hits = scan(body?.groups ?? {});
    ok(`GET /api/search（${label}）无残留`, status === 200 && hits.length === 0);
    if (hits.length) console.log('     ' + hits.slice(0, 3).join('\n     '));
  }

  /* ---------- 5. 时间线 ---------- */
  {
    const { status, body } = await api('/api/timeline');
    const rows = Array.isArray(body) ? body : [];
    const v23 = rows.filter(e => ['V2', 'V3'].includes(e.volume));
    const sec = SECRET_NAME ? rows.filter(e => String(e.title || '').includes(SECRET_NAME)) : [];
    ok('GET /api/timeline 无 V2/V3 事件', status === 200 && v23.length === 0, `(${rows.length} 条)`);
    if (SECRET_NAME) ok('GET /api/timeline 无绝密姓名', sec.length === 0);
  }
  {
    const { status } = await api('/api/timeline?stage=' + encodeURIComponent('高中'));
    ok('GET /api/timeline?stage= 不再 500', status === 200, `得到 ${status}`);
  }

  /* ---------- 6. 域内文档清单（含 meta） ---------- */
  {
    const { status, body } = await api('/api/domains/' + encodeURIComponent('成长叙事') + '/docs');
    const hits = scan(body);
    ok('GET /api/domains/:name/docs 无问卷全文/私密/meta 残留', status === 200 && hits.length === 0,
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
    ['卷二章节设计 → 403', '/api/doc/' + encodeURIComponent('长篇创作/章节设计-第二卷-青春与阵痛.md'), 403],
    ['卷三试写样章 → 403', '/api/doc/' + encodeURIComponent('长篇创作/试写/第三卷样章-烟花与婚礼进行曲.md'), 403],
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
    ok('GET /api/imagery 无绝密意象', status === 200 && (!SECRET_NAME || !rows.some(i => String(i.name || '').includes(SECRET_NAME))), `(${rows.length} 条)`);
    const one = await api('/api/imagery/26');
    ok('GET /api/imagery/26（绝密意象）→ 403', one.status === 403, `得到 ${one.status}`);
  }
  {
    const v = await api('/api/volumes/V2');
    ok('GET /api/volumes/V2 → 403', v.status === 403, `得到 ${v.status}`);
    const c = await api('/api/chapter/V3/1');
    ok('GET /api/chapter/V3/1 → 403', c.status === 403, `得到 ${c.status}`);
  }

  /* ---------- 9b. 伏应矩阵（未解锁不得带出绝密姓名 / 卷二卷三） ---------- */
  {
    const { status, body } = await api('/api/foreshadow');
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    const blob = JSON.stringify(rows);
    const volHit = rows.filter(r => /卷二|卷三|第二卷|第三卷|\bV2\b|\bV3\b/.test(
      [r.material, r.plant, r.harvest, r.method, r.status].map(v => String(v || '')).join('\n'),
    ));
    ok('GET /api/foreshadow 无绝密姓名', status === 200 && (!SECRET_NAME || !blob.includes(SECRET_NAME)), `(${rows.length} 条)`);
    ok('GET /api/foreshadow 无卷二卷三埋设/回收', volHit.length === 0, volHit.length ? `(漏 ${volHit.length} 条)` : '');
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
      : '\n✅ API 级红线测试全部通过（未解锁状态下无任何私密/绝密内容可经 API 取得）');
    process.exitCode = fails.length ? 1 : 0;
  })
  .catch((e) => {
    console.error(`\n❌ 测试执行失败：${e.message}`);
    process.exitCode = 1;
  })
  .finally(() => { if (child) child.kill(); });
