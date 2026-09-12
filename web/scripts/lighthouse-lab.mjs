/**
 * Lab-only Lighthouse runner. Cookie is never printed.
 * Usage: node scripts/lighthouse-lab.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.MNEME_BASE || 'http://127.0.0.1:8421';
const TOKEN = process.env.MNEME_TOKEN || 'mneme';
const out = path.join(os.tmpdir(), 'mneme-lh.json');

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

const hdrFile = path.join(os.tmpdir(), 'mneme-lh-headers.json');
fs.writeFileSync(hdrFile, JSON.stringify({ Cookie: pair }));

const args = [
  'lighthouse', `${BASE}/`,
  '--quiet',
  '--no-enable-error-reporting',
  '--chrome-flags=--headless --disable-gpu --no-sandbox',
  '--only-categories=performance,accessibility,best-practices,seo',
  '--output=json',
  `--output-path=${out}`,
  `--extra-headers=${hdrFile}`,
];
const child = spawn('cmd.exe', ['/c', 'npx', '--yes', ...args], { stdio: 'inherit', windowsHide: true });
const code = await new Promise(res => child.on('exit', res));
try {
  fs.unlinkSync(hdrFile);
} catch { /* ignore */ }
if (!fs.existsSync(out)) process.exit(code || 1);
const r = JSON.parse(fs.readFileSync(out, 'utf8'));
const cat = {};
for (const [k, v] of Object.entries(r.categories || {})) cat[k] = Math.round((v.score || 0) * 100);
const a = r.audits || {};
const num = id => (a[id]?.numericValue != null ? Math.round(a[id].numericValue) : null);
const a11yFail = (r.categories?.accessibility?.auditRefs || [])
  .filter(ref => (ref.weight || 0) > 0 && a[ref.id]?.score === 0)
  .map(ref => ref.id)
  .slice(0, 12);
console.log(JSON.stringify({
  kind: 'lab',
  url: r.finalDisplayedUrl || r.requestedUrl,
  fetchTime: r.fetchTime,
  categories: cat,
  lcp_ms: num('largest-contentful-paint'),
  fcp_ms: num('first-contentful-paint'),
  tbt_ms: num('total-blocking-time'),
  si_ms: num('speed-index'),
  cls: a['cumulative-layout-shift']?.numericValue ?? null,
  a11yFail,
}, null, 2));
