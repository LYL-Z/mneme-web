/**
 * ΜΝΗΜΗ · M2 API 服务（Hono + @hono/node-server）
 *
 * 安全模型（v8 加固）：
 *   · 全站访问口令门（HttpOnly cookie `mneme_k`）；仅 /api/health、/api/login、/gate.js 免鉴权
 *   · 支持 `Authorization: Bearer <MNEME_TOKEN>`（自动化调用；与部署手册示例一致）
 *   · 三级可见性（判定唯一事实来源 = ./privacy.mjs）：
 *       public  → 正常返回
 *       private → 未解锁一律 404（与「不存在」不可区分，不可枚举）
 *       secret  → 列表/星图/检索以锁定档出现；点开正文一律 403（管理员密码）
 *   · 所有只读出口都从 store 层取「已按解锁状态过滤」的数据，server 层再做一次出口净化
 *   · 绝密门 /api/secret/unlock 与主登录共用失败退避（5 次/分钟/IP）
 *   · 安全响应头：CSP（强制，可用 MNEME_CSP_REPORT_ONLY=1 一键回退观察模式）、nosniff、no-referrer 等
 *
 * 启动：node server.mjs
 * 环境变量：MNEME_TOKEN / MNEME_ADMIN_TOKEN / MNEME_SECRET / PORT / MNEME_MODE=cloud
 *           MNEME_STRICT=1（强制：缺失或仍为内置开发口令则拒绝启动）
 *           云模式（MNEME_MODE=cloud）默认等同 STRICT；回滚设 MNEME_STRICT=0
 *           MNEME_LOG=0（关闭请求日志）/ MNEME_BUILD=<hash>（/api/health 回显构建版本）
 */
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { compress } from 'hono/compress';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
/* 隐私门禁规则的唯一事实来源（server / store / store-pg 共用，禁止各写一套） */
import { SECRET_NAME, LOCAL_PRIVACY, isPrivatePath, isSecretText, isSecretPath, isQuestionnaireEntity, mustHideEntity } from './privacy.mjs';
/* 人物人格体：授权语料组装（门禁核心；tier 判定仍复用上面 privacy.mjs 的唯一事实来源） */
import { personaMeta, buildPersonaContext } from './persona.mjs';
import { vaultReady, normRel, writeClass, readSource, titleFromRaw } from './vault.mjs';
import { startVaultWatch, requestIngest, syncStatus } from './sync-watch.mjs';

/* M7：MNEME_PG 存在时切 CloudBase PG 适配器（同接口），否则用本地 SQLite */
const store = await (process.env.MNEME_PG ? import('./store-pg.mjs') : import('./store.mjs'));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.join(HERE, '..', 'site');
const DIST_DIR = path.join(HERE, '..', 'web', 'dist');
const WEB_DIST = [SITE_DIR, DIST_DIR, path.join(HERE, '..', 'deploy', 'web-dist')].find(d => fs.existsSync(d)) || DIST_DIR;

/* v8 · 陈旧发布根告警：site/ 排在 WEB_DIST 首位（发布器会排除 dist/ 这类构建产物目录，
   故另起 site/ 做发布根）。一旦有人只跑了 vite build 而没跑 sync:dist，site/ 就停在旧包，
   新产物全部落到 index.html 兜底——线上「看着能开，实际是旧的」。这里主动喊一声。 */
if (WEB_DIST === SITE_DIR) {
  try {
    const a = fs.statSync(path.join(SITE_DIR, 'index.html')).mtimeMs;
    const b = fs.statSync(path.join(DIST_DIR, 'index.html')).mtimeMs;
    if (b - a > 60_000) {
      console.warn(`[发布告警] site/index.html 比 web/dist/index.html 旧 ${Math.round((b - a) / 1000)}s`
        + ' —— 疑似忘记执行 npm run sync:dist，线上仍在跑旧包');
    }
  } catch { /* 任一缺失不必告警 */ }
}
const PORT = +(process.env.PORT || 8421);
const VISITOR_DEV = 'mneme';
const ADMIN_DEV = 'mneme-admin';
const TOKEN = process.env.MNEME_TOKEN || VISITOR_DEV;
const ADMIN_TOKEN = process.env.MNEME_ADMIN_TOKEN || ADMIN_DEV;
const CLOUD = process.env.MNEME_MODE === 'cloud';
/* 云端默认 STRICT：口令必须来自环境且不得等于内置开发值。本机开发不受影响。回滚：MNEME_STRICT=0 */
const STRICT = process.env.MNEME_STRICT === '1' || (CLOUD && process.env.MNEME_STRICT !== '0');
const readBuildStamp = () => {
  for (const p of [path.join(HERE, '..', 'BUILD'), path.join(HERE, '..', 'deploy', 'BUILD')]) {
    try {
      const s = fs.readFileSync(p, 'utf8').trim();
      if (s) return s;
    } catch { /* 无戳则退回环境变量 */ }
  }
  return '';
};
const PACK = readBuildStamp();
const BUILD = PACK || process.env.MNEME_BUILD || 'dev';
const LOG_ON = process.env.MNEME_LOG !== '0';
const KEY = crypto.createHash('sha256').update(`mneme:${TOKEN}`).digest('hex').slice(0, 32);

const DEFAULTS_IN_USE = [
  (!process.env.MNEME_TOKEN || process.env.MNEME_TOKEN === VISITOR_DEV) && 'MNEME_TOKEN',
  (!process.env.MNEME_ADMIN_TOKEN || process.env.MNEME_ADMIN_TOKEN === ADMIN_DEV) && 'MNEME_ADMIN_TOKEN',
  !process.env.MNEME_SECRET && !LOCAL_PRIVACY.secretPassword && 'MNEME_SECRET',
].filter(Boolean);
const SECRET_NAME_MISSING = !SECRET_NAME;
if (DEFAULTS_IN_USE.length || (STRICT && SECRET_NAME_MISSING)) {
  const bits = [...DEFAULTS_IN_USE, STRICT && SECRET_NAME_MISSING ? 'MNEME_SECRET_NAME' : ''].filter(Boolean);
  const msg = `[安全告警] 以下口令/过滤仍是内置开发值或未设置：${bits.join(' / ')}。生产请只在托管平台环境变量覆盖。`;
  if (STRICT) { console.error(`${msg}\nSTRICT 已开启，拒绝启动。回滚请设 MNEME_STRICT=0。`); process.exit(1); }
  console.warn(msg);
} else if (CLOUD) {
  console.log('[安全] 云端 STRICT 已开：口令与绝密姓名过滤均来自环境，不是内置开发值。');
}
if (!STRICT && SECRET_NAME_MISSING) console.warn('[安全告警] 未配置绝密姓名过滤（MNEME_SECRET_NAME 或 privacy.local.json）。');

/* ---------- 绝密档案门禁（绝密人物全宗 + 卷二卷三 + 非父母卷问卷） ----------
   密码只有库主本人持有；服务端校验后下发 HttpOnly cookie，前端不落明文。
   实体锁按姓名：数据库重扫描会重编实体 id，按姓名锁对重编号免疫。 */
const SECRET_PASSWORD = String(process.env.MNEME_SECRET || LOCAL_PRIVACY.secretPassword || '');
const SECRET_COOKIE = 'mneme_s';
const SECRET_TOKEN = SECRET_PASSWORD
  ? crypto.createHash('sha256').update(`mneme-secret:${SECRET_PASSWORD}`).digest('hex').slice(0, 32)
  : '';
const isUnlocked = (c) => !!SECRET_TOKEN && getCookie(c, SECRET_COOKIE) === SECRET_TOKEN;
const ADMIN_COOKIE = 'mneme_a';
const ADMIN_KEY = crypto.createHash('sha256').update(`mneme-admin:${ADMIN_TOKEN}`).digest('hex').slice(0, 32);
/* 波4 · 恒定时间比较：口令 / 令牌 / 管理口令一律不按字符短路，避免计时侧信道 */
const safeEq = (a, b) => {
  const x = Buffer.from(String(a ?? ''), 'utf8');
  const y = Buffer.from(String(b ?? ''), 'utf8');
  /* timingSafeEqual 要求等长；先用一次 hash 对齐长度，再恒定时间比对 */
  const hx = crypto.createHash('sha256').update(x).digest();
  const hy = crypto.createHash('sha256').update(y).digest();
  return crypto.timingSafeEqual(hx, hy) && String(a ?? '') === String(b ?? '');
};
const isAdmin = (c) => {
  if (safeEq(getCookie(c, ADMIN_COOKIE) || '', ADMIN_KEY)) return true;
  if (safeEq(c.req.header('x-admin-token') || '', ADMIN_TOKEN)) return true;
  const bearer = (c.req.header('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return safeEq(bearer, ADMIN_TOKEN);
};
const locked = (c) => c.json({ error: 'locked', message: '此为绝密档案，需输入管理员密码' }, 403);
/* 已通过访问口令（cookie 或 Bearer）。health / overview 据此决定信息量。 */
const isVisitor = (c) => {
  if (safeEq(getCookie(c, 'mneme_k') || '', KEY)) return true;
  const bearer = (c.req.header('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return safeEq(bearer, TOKEN) || safeEq(bearer, ADMIN_TOKEN);
};
const notFound = (c) => c.json({ error: 'not found' }, 404);

/* ---------- Cookie 选项 ----------
   Secure 只在真实 HTTPS 链路上加：CloudBase/workbuddy.link 是 HTTPS；局域网 http 调试不加，
   否则浏览器不会回传 cookie 导致「登录后仍被弹回口令页」。 */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 天（与部署手册一致）
const isHttps = (c) => CLOUD || (c.req.header('x-forwarded-proto') || '').split(',')[0].trim() === 'https';
const cookieOpts = (c) => ({ httpOnly: true, sameSite: 'Lax', path: '/', maxAge: COOKIE_MAX_AGE, secure: isHttps(c) });
/* 绝密门：会话 cookie，关浏览器即失效；客户端次日再锁。不写可导出存储。 */
const secretCookieOpts = (c) => ({ httpOnly: true, sameSite: 'Lax', path: '/', secure: isHttps(c) });

const app = new Hono();

/* ---------- 安全响应头 + CSP ---------- */
const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",   // React 内联 style 属性与口令页内联 <style> 需要
  /* 'wasm-unsafe-eval'：本地模型（onnxruntime-web 等 WASM 运行时）编译实例化所必需。
     这是比 'unsafe-eval' **窄得多**的指令——只放行 WebAssembly 编译，不放行 eval()/Function()，
     是 MDN/OWASP 对「页面要跑 WASM」场景的标准做法。没有它，浏览器直接拒绝编译：
     "Refused to compile or instantiate WebAssembly module because 'unsafe-eval' is not
      an allowed source of script …" */
  "script-src 'self' 'wasm-unsafe-eval' blob:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Frame-Options', 'SAMEORIGIN');
  c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  c.header('Cross-Origin-Opener-Policy', 'same-origin');
  c.header('X-DNS-Prefetch-Control', 'off');
  /* CSP 默认强制；MNEME_CSP_REPORT_ONLY=1 可一键回退为观察模式（应急回滚用） */
  c.header(process.env.MNEME_CSP_REPORT_ONLY === '1' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy', CSP);
  if (c.req.path === '/sw.js' || c.req.path === '/offline.html' || c.req.path === '/offline.js' || c.req.path === '/boot-device.js') c.header('Cache-Control', 'no-cache');
  if (isHttps(c)) c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
});

/* ---------- 压缩（/api/graph 等大响应收益明显） ---------- */
app.use('*', compress());

/* ---------- 结构化请求日志 ---------- */
app.use('*', async (c, next) => {
  if (!LOG_ON) return next();
  const t0 = Date.now();
  await next();
  if (c.req.path.startsWith('/api/')) {
    console.log(JSON.stringify({
      t: new Date().toISOString(), m: c.req.method, p: c.req.path,
      s: c.res.status, ms: Date.now() - t0,
    }));
  }
});

/* ---------- 登录限速：失败退避（单实例内存计数，5 次/分钟/IP）；绝密门共用 ---------- */
const loginFails = new Map();
const clientIp = (c) => (
  (c.req.header('x-forwarded-for') || '').split(',')[0].trim()
  || (c.req.header('x-real-ip') || '').trim()
  || (c.req.header('cf-connecting-ip') || '').trim()
  || 'unknown'
);
const loginGate = (ip) => {
  if (!ip) return false; /* 取不到来源仍进 unknown 桶，不敞开 */
  const rec = loginFails.get(ip);
  if (!rec) return true;
  if (Date.now() - rec.t > 60_000) { loginFails.delete(ip); return true; }
  return rec.n < 5;
};
const loginFail = (ip) => {
  if (!ip) return; /* 调用处已保证非空 */
  const rec = loginFails.get(ip);
  if (!rec || Date.now() - rec.t > 60_000) loginFails.set(ip, { n: 1, t: Date.now() });
  else { rec.n += 1; rec.t = Date.now(); }
};

/* ---------- 访问口令门 ---------- */
const GATE_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>ΜΝΗΜΗ · 访问口令</title><style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0E0D0B;color:#EDE7DA;
font-family:"Source Han Serif SC","Noto Serif SC",Georgia,serif}
.card{padding:48px 44px;border-radius:28px;text-align:center;max-width:420px;
background:rgba(28,26,22,.38);border:1px solid rgba(255,255,255,.14);
box-shadow:0 8px 24px rgba(0,0,0,.25),0 32px 64px rgba(0,0,0,.35)}
h1{font-family:Georgia,serif;font-weight:500;letter-spacing:.35em;margin:0 0 4px;font-size:26px}
p{color:#9A927F;font-size:13px;line-height:1.8;margin:8px 0 28px}
input{width:100%;box-sizing:border-box;padding:12px 16px;border-radius:14px;border:1px solid rgba(255,255,255,.18);
background:rgba(255,255,255,.06);color:#EDE7DA;font-size:15px;outline:none}
input:focus{border-color:#A9864A}
button{margin-top:14px;width:100%;padding:12px;border-radius:14px;border:none;cursor:pointer;
background:#A9864A;color:#141210;font-size:15px;font-family:inherit}
.err{color:#C07A6A;font-size:13px;min-height:18px;margin-top:12px}
</style></head><body><div class="card">
<h1>ΜΝΗΜΗ</h1><p>Τὸ πρῶτον ἥμισυ τοῦ βίου<br>这是一座私人记忆的数字建筑，请出示访问口令。</p>
<form id="f"><label for="t" style="display:block;text-align:left;font-size:12px;letter-spacing:.12em;color:#C4BBA8;margin:0 0 8px">访问口令</label><input id="t" type="password" placeholder="访问口令" autocomplete="current-password" autofocus><button type="submit">进入</button>
<div class="err" id="e"></div></form></div>
<script src="/gate.js" defer></script>
</body></html>`;

/* 口令页脚本外置（CSP script-src 'self' 不含 unsafe-inline，内联脚本会被拦下） */
const GATE_JS = `document.getElementById('f').addEventListener('submit',async ev=>{ev.preventDefault();
const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({token:document.getElementById('t').value})});
if(r.ok){try{sessionStorage.removeItem('mneme-gate');sessionStorage.removeItem('mneme-anno');sessionStorage.removeItem('mneme-bgm-entered')}catch(e){}location.reload()}else if(r.status===429)document.getElementById('e').textContent='尝试过于频繁，请稍后再试。';else document.getElementById('e').textContent='口令不符，请再试一次。';});`;
app.get('/gate.js', (c) => c.body(GATE_JS, 200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' }));

app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  const open = ['/api/login', '/api/health', '/gate.js', '/sw.js', '/offline.html', '/offline.js', '/boot-device.js', '/manifest.webmanifest'];
  if (open.some(p => url.pathname === p)) return next();
  if (getCookie(c, 'mneme_k') === KEY) return next();
  /* Bearer 令牌（自动化调用）：与部署手册示例一致 */
  const bearer = (c.req.header('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (bearer && (bearer === TOKEN || bearer === ADMIN_TOKEN)) return next();
  if (url.pathname.startsWith('/api/')) return c.json({ error: 'unauthorized' }, 401);
  c.header('Cache-Control', 'no-store');
  return c.html(GATE_HTML);
});

app.post('/api/login', async (c) => {
  const ip = clientIp(c);
  if (!loginGate(ip)) return c.json({ error: 'too many attempts' }, 429);
  const { token } = await c.req.json().catch(() => ({}));
  if (!safeEq(token || '', TOKEN)) { loginFail(ip); return c.json({ error: 'bad token' }, 403); }
  loginFails.delete(ip);
  setCookie(c, 'mneme_k', KEY, cookieOpts(c));
  return c.json({ ok: true });
});
/* 登出必须同时清掉绝密 cookie，否则「登出后仍是解锁态」 */
app.get('/api/logout', (c) => {
  deleteCookie(c, 'mneme_k', { path: '/' });
  deleteCookie(c, SECRET_COOKIE, { path: '/' });
  deleteCookie(c, ADMIN_COOKIE, { path: '/' });
  return c.redirect('/');
});
app.get('/api/health', (c) => {
  /* 波4：未过口令门只回 ok——不对外暴露部署形态、构建标识与运行态 */
  if (!isVisitor(c)) return c.json({ ok: true });
  return c.json({
    ok: true, service: 'mneme', mode: CLOUD ? 'cloud' : 'local', pg: !!process.env.MNEME_PG, build: BUILD,
    pack: PACK || null,
    strict: STRICT,
    write: { vault: false, watch: syncStatus().watching, ai: false },
  });
});

/* ---------- 只读 API ---------- */
/* v4 · A5 问卷回收总数：单一事实来源移到服务端（前端不再硬编码「103+」）。
   口径为库主核账值（V1–V3 累计回收），暂无台账数据源——核账后更新此常量。 */
const SURVEY_TOTAL = 103;
/* 只读端点缓存：数据随镜像更新，60 秒浏览器私有缓存足以削掉重复请求，又不至于让重扫描后长期看到旧数据 */
const cache = (c, secs = 60) => c.header('Cache-Control', `private, max-age=${secs}`);

app.get('/api/overview', (c) => {
  cache(c);
  const ov = store.overview();
  /* 波4：锁定档份数属馆藏内部账，不对外——只对已解锁的管理会话给出 */
  const showCounts = isAdmin(c) && isUnlocked(c);
  const out = { ...ov, surveyTotal: SURVEY_TOTAL };
  if (!showCounts) delete out.secretDocs;
  return c.json(out);
});
app.get('/api/domains', (c) => { cache(c, 300); return c.json(store.domains()); });
app.get('/api/domains/:name/docs', (c) => {
  cache(c);
  return c.json(store.domainDocs(c.req.param('name'),
    Math.min(+c.req.query('limit') || 60, 500), +c.req.query('offset') || 0,
    { unlocked: isUnlocked(c) }));
});
app.get('/api/shelf', async (c) => {
  cache(c);
  return c.json(await store.shelf({ unlocked: isUnlocked(c) }));
});
app.get('/api/catalog', async (c) => {
  const p = c.req.query('path') || '';
  if (!p) return c.json({ prev: null, next: null, source: 'none' });
  return c.json(await store.catalogNeighbors(p, { unlocked: isUnlocked(c) }));
});
app.get('/api/queue', async (c) => {
  cache(c);
  return c.json(await store.evidenceQueue({ unlocked: isUnlocked(c) }));
});
app.get('/api/timeline', (c) => {
  cache(c);
  return c.json(store.timeline({
    from: +c.req.query('from') || 2000, to: +c.req.query('to') || 2030,
    stage: c.req.query('stage') || undefined, kind: c.req.query('kind') || undefined,
    unlocked: isUnlocked(c),
  }));
});
app.get('/api/entities', (c) => {
  cache(c, 300);
  const unlocked = isUnlocked(c);
  const rows = store.entities({
    group: c.req.query('group') || undefined, q: c.req.query('q') || undefined,
    limit: Math.min(+c.req.query('limit') || 400, 1000), unlocked,
  });
  /* 出口净化（纵深防御）：store 已过滤，这里再兜一层，防止将来 store 改动漏网 */
  return c.json(unlocked ? rows : rows.filter(e => !mustHideEntity(e, unlocked)));
});
app.get('/api/entities/:id', (c) => {
  const unlocked = isUnlocked(c);
  const e = store.entity(+c.req.param('id'), { unlocked });
  if (!e) return notFound(c);
  if (!unlocked) {
    /* 私密层实体：与「不存在」不可区分；绝密档案实体：明确 403 */
    if (isPrivatePath(e.std_id) || isPrivatePath(e.role_doc_path)) return notFound(c);
    if (isSecretText(e.display_name)) return locked(c);
    /* 非父母卷的问卷作答全文文档型实体：枚举出口已隐藏，直取同样 404 */
    if (isQuestionnaireEntity(e)) return notFound(c);
  }
  return c.json(e);
});

/* ---------- 绝密档案：解锁端点（密码校验 → HttpOnly cookie） ---------- */
app.post('/api/secret/unlock', async (c) => {
  const ip = clientIp(c);
  /* 与主登录共用退避：原实现无任何限速，可被离线爆破 */
  if (!loginGate(ip)) return c.json({ error: 'too many attempts' }, 429);
  const { password } = await c.req.json().catch(() => ({}));
  if (!SECRET_PASSWORD) return c.json({ error: 'secret not configured' }, 503);
  if (!safeEq(password || '', SECRET_PASSWORD)) { loginFail(ip); return c.json({ error: 'bad password' }, 403); }
  loginFails.delete(ip);
  setCookie(c, SECRET_COOKIE, SECRET_TOKEN, secretCookieOpts(c));
  return c.json({ ok: true });
});
app.post('/api/secret/lock', (c) => {
  deleteCookie(c, SECRET_COOKIE, { path: '/' });
  return c.json({ ok: true });
});
app.get('/api/secret/status', (c) => c.json({ unlocked: isUnlocked(c) }));

app.get('/api/graph', (c) => { cache(c, 300); return c.json(store.graph({ unlocked: isUnlocked(c) })); });
app.get('/api/volumes', (c) => { cache(c, 300); return c.json(store.volumes()); });
app.get('/api/volumes/:code', (c) => {
  const code = c.req.param('code').toUpperCase();
  const v = store.volume(code, { unlocked: isUnlocked(c) });
  return v ? c.json(v) : notFound(c);
});
/* 章节材料链：目录公开；赵纲密章未解锁 → 403 弹窗 */
app.get('/api/chapter/:code/:seq', (c) => {
  const code = c.req.param('code').toUpperCase();
  const ch = store.chapter(code, +c.req.param('seq'), { unlocked: isUnlocked(c) });
  if (ch?.locked) return locked(c);
  return ch ? c.json(ch) : notFound(c);
});
app.get('/api/imagery', (c) => { cache(c, 300); return c.json(store.imagery({ unlocked: isUnlocked(c) })); });
app.get('/api/imagery/:id', (c) => {
  const im = store.imageryOne(+c.req.param('id'), { unlocked: isUnlocked(c) });
  if (im?.locked) return locked(c);
  return im ? c.json(im) : notFound(c);
});

/* 问卷档案：父母卷（label 精确为 母亲/父亲/爸爸/妈妈）公开；
   其余作答全文均为绝密——未解锁时服务端连「作答人身份 + 文档路径」一并剥离。 */
app.get('/api/questionnaires', (c) => c.json(store.questionnaires({ unlocked: isUnlocked(c) })));
app.get('/api/year-density', (c) => { cache(c, 300); return c.json(store.yearDensity()); });

/* 文档：私密层 404（不可枚举）、绝密档案 403（需管理员密码解锁）。
   判定全部收在 store.doc()（含非父母卷问卷作答全文、卷二卷三、绝密人物全宗），此处只做状态码映射。 */
app.get('/api/doc/*', (c) => {
  const raw = c.req.path.replace(/^\/api\/doc\//, '');
  if (raw.includes('..')) return notFound(c);
  const d = store.doc(raw, { force: isUnlocked(c) });
  if (!d) return notFound(c);
  if (d.private) return notFound(c);   // 私密层：404，不可枚举
  if (d.locked) return locked(c);      // 绝密档案：403，提示解锁
  const cls = writeClass(normRel(raw) || d.path || '');
  c.header('X-Mneme-Cache', cls === 'public' ? 'public' : 'no');
  return c.json(d);
});

const sourceGate = (c, rawPath) => {
  const rel = normRel(rawPath);
  if (!rel || rel.includes('..')) return { err: notFound(c) };
  const cls = writeClass(rel);
  if (cls === 'private') return { err: notFound(c) };
  const d = store.doc(rel, { force: isUnlocked(c) });
  if (d?.private || (!d && cls === 'private')) return { err: notFound(c) };
  if (d?.locked && !isUnlocked(c)) return { err: locked(c) };
  if (!d && cls === 'secret' && !isUnlocked(c)) return { err: locked(c) };
  return { rel, doc: d };
};

app.get('/api/source/*', (c) => {
  const g = sourceGate(c, c.req.path.replace(/^\/api\/source\//, ''));
  if (g.err) return g.err;
  /* 波4：公开层只吐入库已掩码正文；vault 原文仅管理会话可读，私密层始终不可读。 */
  const admin = isAdmin(c);
  const file = (vaultReady() && admin && g.cls !== 'private') ? readSource(g.rel) : null;
  const text = file?.text ?? g.doc?.body ?? '';
  if (!file && !g.doc) return notFound(c);
  return c.json({
    path: file?.path || g.doc?.path || g.rel,
    text,
    mtime: file?.mtime || g.doc?.mtime || null,
    sha256: file?.sha256 || null,
    writable: false,
    title: g.doc?.title || titleFromRaw(text, g.rel),
  });
});

app.put('/api/source/*', (c) => c.json({ error: 'site does not write vault' }, 501));

/* ---------- 人物人格体（P0） ----------
   定位见 docs/人物AI对话-技术方案-2026-09-13.md §14：「由档案构建、可以超越档案」的人格体。
   服务端**只做两件事**：① 授权——未授权 chunk 绝不下发（本地推理不得绕过门禁）；
   ② 组装——档位 systemPrompt + 常驻人格基底 + 检索注入片段。推理在浏览器本地完成（零账单）。
   · persona-policy.json 当前**不启用**：isPersonaDisabled 默认 false（全放行）。
   · 绝密人物沿用现有绝密门：未解锁 → 403 locked（与正文同级）。 */
app.get('/api/persona/:id', (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad id' }, 400);
  const meta = personaMeta(id);
  if (!meta.ok) return notFound(c);
  if (isSecretText(meta.display_name) && !isUnlocked(c)) return locked(c);
  return c.json(meta);
});

app.post('/api/persona/:id/context', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad id' }, 400);
  const body = await c.req.json().catch(() => ({}));
  const mode = body?.mode ?? 'persona';
  if (mode != null && !['persona', 'voice', 'source'].includes(mode)) return c.json({ error: 'bad mode' }, 400);
  const out = buildPersonaContext(id, {
    mode,
    query: body?.query || '',
    unlocked: isUnlocked(c),
    /* 预算由前端按本机模型的窗口大小传入（本地小模型有效窗口远小于标称值） */
    maxChars: body?.maxChars,
    topK: body?.topK,
  });
  if (!out.ok) {
    if (out.reason === 'locked') return locked(c);
    if (out.code === 404) return notFound(c);
    return c.json({ error: out.reason }, out.code || 403);
  }
  return c.json(out);
});

app.post('/api/admin/session', async (c) => {
  const ip = clientIp(c);
  if (!loginGate(ip)) return c.json({ error: 'too many attempts' }, 429);
  const { token } = await c.req.json().catch(() => ({}));
  if (token !== ADMIN_TOKEN) { loginFail(ip); return c.json({ error: 'bad token' }, 403); }
  loginFails.delete(ip);
  setCookie(c, ADMIN_COOKIE, ADMIN_KEY, cookieOpts(c));
  return c.json({ ok: true, admin: true });
});
app.get('/api/admin/status', (c) => c.json({
  admin: isAdmin(c),
  vault: false,
  ai: false,
  sync: syncStatus(),
}));

app.post('/api/ai/draft', (c) => c.json({ error: 'site does not write vault' }, 501));

app.post('/api/admin/ingest', (c) => {
  if (!isAdmin(c)) return c.json({ error: 'forbidden' }, 403);
  if (CLOUD) return c.json({ error: 'rescan unavailable in cloud mode (vault stays local)' }, 501);
  requestIngest('manual');
  return c.json({ started: true, ...syncStatus() });
});

/* 检索 */
app.get('/api/search', (c) => c.json(store.search(c.req.query('q') || '', c.req.query('group') || undefined, {
  unlocked: isUnlocked(c), offset: +c.req.query('offset') || 0, limit: +c.req.query('limit') || 0,
})));
/* v4 · C4 伏应矩阵：创作台账（口令门禁后的登录态内容） */
app.get('/api/foreshadow', async (c) => c.json(await store.foreshadow({ unlocked: isUnlocked(c) })));

/* 审计与重扫描 */
app.get('/api/audit/latest', (c) => c.json(store.auditLatest()));
app.post('/api/admin/rescan', (c) => {
  if (CLOUD) return c.json({ error: 'rescan unavailable in cloud mode (vault stays local)' }, 501);
  if (!isAdmin(c)) return c.json({ error: 'forbidden' }, 403);
  const child = spawn(process.execPath, ['--experimental-sqlite', 'ingest/ingest.mjs'], {
    cwd: path.join(HERE, '..'), stdio: 'ignore', detached: true,
  });
  child.unref();
  return c.json({ started: true, pid: child.pid });
});

/* ---------- 静态前端 ---------- */
/* 构建产物带内容哈希，可长缓存 */
app.use('/assets/*', async (c, next) => {
  await next();
  if (c.res.status === 200) c.header('Cache-Control', 'public, max-age=31536000, immutable');
});
if (fs.existsSync(WEB_DIST)) {
  const INDEX_HTML = () => fs.readFileSync(path.join(WEB_DIST, 'index.html'), 'utf8');
  const isSpaPath = (p) => p === '/' || p === '/foreshadow'
    || /^\/(space|doc|person|imagery|volume|chapter)(\/|$)/.test(p);
  /* History API 深链必须先回 index.html，不能让 serveStatic 去找 /space/stars 这种假文件 */
  app.get('*', async (c, next) => {
    if (!isSpaPath(c.req.path)) return next();
    c.header('Cache-Control', 'no-store');
    return c.html(INDEX_HTML());
  });
  app.use('*', serveStatic({ root: path.relative(process.cwd(), WEB_DIST) || '.', rewriteRequestPath: (p) => p }));
  /* /models/* 缺失必须**真 404**：否则会掉进 SPA 兜底返回 index.html（200 + HTML），
     本地模型的 onnxruntime 拿 HTML 当 protobuf 解析 → "protobuf parsing failed"。
     这与第八轮修过的「/assets/* 404 返回 HTML 导致整页空白」是同一类问题。
     另外：dtype 降级链请求不存在的变体文件时，靠这个 404 才能让上层如实报告"该档不存在"。 */
  app.get('/models/*', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ error: 'model file not found' }, 404);
  });
  app.get('*', (c) => {
    /* 哈希分包找不到时必须 404，不能回 index.html，否则浏览器会把 HTML 当 JS 加载、整页空白 */
    if (c.req.path.startsWith('/assets/')) return c.notFound();
    c.header('Cache-Control', 'no-store');
    return c.html(INDEX_HTML());
  });
} else {
  app.get('/', (c) => c.text('ΜΝΗΜΗ · API 就绪（前端 dist 未构建，接口见 /api/overview）'));
}

/* ---------- 错误兜底：不把堆栈吐给客户端 ---------- */
app.onError((err, c) => {
  console.error(JSON.stringify({ t: new Date().toISOString(), level: 'error', p: c.req.path, msg: err?.message, stack: String(err?.stack || '').split('\n').slice(0, 4) }));
  return c.json({ error: 'internal error', ...(process.env.MNEME_DEBUG ? { msg: String(err?.message || ''), where: String(err?.stack || '').slice(0, 200) } : {}) }, 500);
});

startVaultWatch();
serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`ΜΝΗΜΗ API · http://127.0.0.1:${info.port} · mode=${CLOUD ? 'cloud' : 'local'} · build=${BUILD} · strict=${STRICT ? 'on' : 'off'} · token=${process.env.MNEME_TOKEN ? '(env)' : '(builtin)'}`);
});
