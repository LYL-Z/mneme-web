import fs from 'fs';
const BASE = process.argv[2] || 'https://mneme-309301-9-1455680663.sh.run.tcloudbase.com';
const PW = process.env.MNEME_SECRET || (() => { try { return JSON.parse(fs.readFileSync('server/privacy.local.json', 'utf8')).secretPassword || ''; } catch { return ''; } })();
const SECRET_DOC = '初中/素材/成长记录/赵问竹2021-2022开福区优秀学生干部.md';
const PRIV_DOC = '私人资料/人物/刘佑林/刘佑林朋友圈148则完整转录与索引-2018至2024（私密）.md';
const NONPARENT_Q = '问卷回收/2026-09-05-刘弈帆问卷作答全文.md';
const PARENT_Q = '问卷回收/2026-09-05-母亲问卷作答全文.md';
const out = [];
(async () => {
  const lr = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'mneme' }) });
  const cookie = lr.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  out.push('① 登录: ' + lr.status + (cookie ? ' ✓' : ' ✗'));
  const g = async (p, ck = cookie) => { const r = await fetch(BASE + p, { headers: ck ? { cookie: ck } : {} }); let b = ''; try { b = await r.text(); } catch {} return { s: r.status, b }; };

  const h = await g('/api/health');
  let hj = {}; try { hj = JSON.parse(h.b); } catch {}
  out.push(`② health ${h.s} build=${hj.build} ${String(hj.build).includes('grok46b') ? '✅' : '⚠️ 期望 20260912-grok46b'}`);
  out.push(`   模式 mode=${hj.mode} pg=${hj.pg}`);

  /* ③ 绝密正文：未解锁一律 403（多路由） */
  const s1 = await g('/api/doc/' + encodeURIComponent(SECRET_DOC));
  const s2 = await g('/api/volumes/B3');
  const s3 = await g('/api/chapter/B1/1');
  const s4 = await g('/api/chapter/B3/26');
  out.push(`③ 绝密正文门禁: doc=${s1.s}${s1.s === 403 ? '✅' : '❌'} B3目录=${s2.s}${s2.s === 200 ? '✅' : '❌'} 公开章=${s3.s}${s3.s === 200 ? '✅' : '❌'} 密章=${s4.s}${s4.s === 403 ? '✅' : '❌'}`);

  /* ④ 私密：404 + 不可枚举 */
  const p1 = await g('/api/doc/' + encodeURIComponent(PRIV_DOC));
  const pe = await g('/api/entities?limit=400');
  const pg = await g('/api/graph');
  const privLeak = /私人资料|\/隐私\//.test(pe.b) || /私人资料|\/隐私\//.test(pg.b);
  out.push(`④ 私密: doc=${p1.s}${p1.s === 404 ? '✅' : '❌'} 列表泄漏=${privLeak ? '❌ 含私密路径' : '0 ✅'}`);

  /* ⑤ 非父母卷问卷：不可枚举 + 正文 403；父母卷公开 200 */
  const q = await g('/api/questionnaires');
  const labels = [...q.b.matchAll(/"respondent_label"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
  const nonParent = labels.filter(l => !['母亲', '父亲', '妈妈', '爸爸'].includes(l));
  const qn = await g('/api/doc/' + encodeURIComponent(NONPARENT_Q));
  const qp = await g('/api/doc/' + encodeURIComponent(PARENT_Q));
  out.push(`⑤ 问卷: labels=[${labels.join('/')}] 非父母卷枚举=${nonParent.length ? '❌' + nonParent.join(',') : '0 ✅'} | 非父母卷正文=${qn.s}${qn.s === 403 ? '✅' : '❌'} 父母卷=${qp.s}${qp.s === 200 ? '✅' : '❌'}`);

  /* ⑥ 锁定档语义：搜索绝密姓名 → 可命中（锁定档），但不得含正文 snippet */
  const z = await g('/api/search?q=' + encodeURIComponent('赵问竹'));
  const hasDoc = /赵问竹[^"]*\.md/.test(z.b);
  let zj = {}; try { zj = JSON.parse(z.b); } catch {}
  const docs = (zj.groups?.doc) || [];
  const lockedFlag = z.b.includes('locked') || z.b.includes('isLocked') || z.b.includes('stub');
  const bodyLeak = docs.some(d => (d.snippet || '').replace(/<[^>]+>/g, '').length > 40);
  out.push(`⑥ 检索绝密名: ${z.s} 命中文档=${docs.length} 锁定标记=${lockedFlag ? '✓' : '（前端标记）'} 正文snippet泄漏=${bodyLeak ? '❌ 疑泄漏' : '0 ✅'}`);

  /* ⑦ 中文搜索稳定性 */
  const zh = [];
  for (const t of ['高中', '问卷作答全文', '刘弈帆', '私人资料']) { const r = await g('/api/search?q=' + encodeURIComponent(t)); zh.push(`${t}=${r.s}`); }
  out.push('⑦ 中文搜索: ' + zh.join(' ') + (zh.every(x => x.endsWith('200')) ? ' ✅' : ' ⚠️'));

  /* ⑧ PWA / 静态 */
  const st = [];
  for (const p of ['/sw.js', '/offline.html', '/robots.txt', '/manifest.webmanifest', '/favicon.svg', '/icon-512.png']) { const r = await fetch(BASE + p); st.push(`${p}=${r.status}`); }
  out.push('⑧ 静态/PWA: ' + st.join(' ') + (st.every(x => x.endsWith('200')) ? ' ✅' : ' ⚠️'));

  /* ⑨ 解锁链路：解锁后可取绝密正文 */
  const u = await fetch(BASE + '/api/secret/unlock', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ password: PW }) });
  if (u.ok) {
    const c2 = u.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const d = await fetch(BASE + '/api/doc/' + encodeURIComponent(SECRET_DOC), { headers: { cookie: cookie + '; ' + c2 } });
    out.push(`⑨ 解锁后取绝密正文: ${d.status}${d.status === 200 ? ' ✅' : ' ❌'}`);
  } else out.push(`⑨ 解锁: ${u.s} ${(await u.text()).slice(0, 50)}`);

  /* ⑩ 管理写入 API 在云端应被禁（isAdmin false / !CLOUD） */
  const w = await fetch(BASE + '/api/source/' + encodeURIComponent('00-知识库首页.md'), { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ body: 'x' }) });
  const ai = await fetch(BASE + '/api/ai/draft', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ prompt: 'x' }) });
  out.push(`⑩ 写入API门禁: PUT source=${w.s}${w.s === 403 ? '✅' : '⚠️'} ai/draft=${ai.s}${ai.s === 403 ? '✅' : '⚠️'}`);

  /* ⑪ 安全头 */
  const csp = h.b && (await fetch(BASE + '/api/health')).headers.get('content-security-policy');
  const sw = await fetch(BASE + '/sw.js');
  out.push(`⑪ 头: CSP=${csp ? '✅' : '❌'} sw cache-control=${sw.headers.get('cache-control') || '-'}`);

  fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/cb-audit.txt', out.join('\n'));
})().catch(e => fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/cb-audit.txt', out.join('\n') + '\nERR ' + e.message));
