/**
 * 多端实验室 / 本机现场对照。Cookie 不打印。
 * 用法：node scripts/lighthouse-field.mjs
 * 环境：MNEME_BASE（默认本机）MNEME_TOKEN（本机开发口令，不写进输出）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.MNEME_BASE || 'http://127.0.0.1:8421';
const TOKEN = process.env.MNEME_TOKEN || 'mneme';
const tmp = os.tmpdir();

const PROFILES = [
  { id: 'iphone', form: 'mobile', width: 390, height: 844, dpr: 3 },
  { id: 'android', form: 'mobile', width: 360, height: 800, dpr: 2.75 },
  { id: 'windows-hidpi', form: 'desktop', width: 1440, height: 900, dpr: 2 },
];

const login = await fetch(`${BASE}/api/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ token: TOKEN }),
});
if (!login.ok) {
  console.error('login failed', login.status);
  process.exit(1);
}
const raw = login.headers.getSetCookie?.() ?? [];
const pair = raw.map(s => s.split(';')[0]).find(s => s.startsWith('mneme_k='));
if (!pair) {
  console.error('no session cookie');
  process.exit(1);
}
const hdrFile = path.join(tmp, 'mneme-lh-headers.json');
fs.writeFileSync(hdrFile, JSON.stringify({ Cookie: pair }));

const num = (a, id) => (a[id]?.numericValue != null ? Math.round(a[id].numericValue) : null);

async function one(profile) {
  const out = path.join(tmp, `mneme-lh-${profile.id}.json`);
  const args = [
    'lighthouse', `${BASE}/`,
    '--quiet',
    '--no-enable-error-reporting',
    '--chrome-flags=--headless --disable-gpu --no-sandbox',
    '--only-categories=performance,accessibility,best-practices,seo',
    '--output=json',
    `--output-path=${out}`,
    `--extra-headers=${hdrFile}`,
    `--form-factor=${profile.form}`,
    `--screenEmulation.mobile=${profile.form === 'mobile'}`,
    `--screenEmulation.width=${profile.width}`,
    `--screenEmulation.height=${profile.height}`,
    `--screenEmulation.deviceScaleFactor=${profile.dpr}`,
  ];
  if (profile.form === 'desktop') args.push('--preset=desktop');
  const child = spawn('cmd.exe', ['/c', 'npx', '--yes', ...args], { stdio: 'inherit', windowsHide: true });
  const code = await new Promise(res => child.on('exit', res));
  if (!fs.existsSync(out)) throw new Error(`${profile.id} lighthouse exit ${code}（无报告）`);
  const r = JSON.parse(fs.readFileSync(out, 'utf8'));
  const cat = {};
  for (const [k, v] of Object.entries(r.categories || {})) cat[k] = Math.round((v.score || 0) * 100);
  const a = r.audits || {};
  return {
    id: profile.id,
    kind: 'lab-emulated',
    form: profile.form,
    viewport: `${profile.width}x${profile.height}@${profile.dpr}`,
    url: r.finalDisplayedUrl || r.requestedUrl,
    fetchTime: r.fetchTime,
    categories: cat,
    lcp_ms: num(a, 'largest-contentful-paint'),
    inp_ms: num(a, 'interaction-to-next-paint'),
    tbt_ms: num(a, 'total-blocking-time'),
    cls: a['cumulative-layout-shift']?.numericValue ?? null,
  };
}

const rows = [];
try {
  for (const p of PROFILES) rows.push(await one(p));
} finally {
  try { fs.unlinkSync(hdrFile); } catch { /* ignore */ }
}

console.log(JSON.stringify({
  kind: 'lab-field-proxy',
  note: 'iPhone / Android 为 Lighthouse 屏幕仿真，不是真机 CrUX；windows-hidpi 是本机高 DPI 桌面仿真。',
  base: BASE.replace(/\/\/.*@/, '//'),
  rows,
}, null, 2));
