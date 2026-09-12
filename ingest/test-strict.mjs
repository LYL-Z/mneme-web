/**
 * STRICT 启动门：云模式 / MNEME_STRICT=1 时，内置开发口令必须被拒绝。
 * 不打印任何口令值。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const ok = (label, cond) => {
  if (cond) console.log(`  ✅ ${label}`);
  else { console.log(`  ❌ ${label}`); fails.push(label); }
};

function run(env, { label, refuse = false, waitMs = 2800 } = {}) {
  return new Promise(resolve => {
    const port = 8700 + Math.floor(Math.random() * 200);
    const child = spawn(process.execPath, ['--experimental-sqlite', 'server/server.mjs'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        MNEME_LOG: '0',
        MNEME_WATCH: '0',
        MNEME_DB: path.join(ROOT, 'ingest', 'mneme.db'),
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', d => { out += String(d); });
    child.stderr.on('data', d => { out += String(d); });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ code: 0, started: /strict=/.test(out), out });
    }, waitMs);
    child.on('exit', code => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, started: /strict=/.test(out), out });
    });
  }).then(r => {
    ok(label, refuse ? (r.code !== 0 && !r.started) : r.started);
    return r;
  });
}

const VISITOR_DEV = 'mneme';
const covered = {
  MNEME_TOKEN: 'ci-visitor-strict',
  MNEME_ADMIN_TOKEN: 'ci-admin-strict',
  MNEME_SECRET: 'ci-secret-strict',
  MNEME_SECRET_NAME: 'STRICT测试姓名',
};

await run({ MNEME_STRICT: '1' }, { label: 'STRICT=1 且口令未覆盖 → 拒绝启动', refuse: true });
await run({ MNEME_MODE: 'cloud' }, { label: '云模式且口令未覆盖 → 拒绝启动', refuse: true });
await run({ MNEME_MODE: 'cloud', MNEME_TOKEN: VISITOR_DEV }, { label: '云模式口令仍为内置开发值 → 拒绝启动', refuse: true });
await run({ MNEME_MODE: 'cloud', ...covered }, { label: '云模式且三项口令已覆盖 → 可启动' });
await run({ MNEME_MODE: 'cloud', MNEME_STRICT: '0' }, { label: 'MNEME_STRICT=0 可回滚启动' });

if (fails.length) {
  console.error(`\n❌ STRICT 启动门未通过：${fails.join('；')}`);
  process.exit(1);
}
console.log('\n✅ STRICT 启动门通过');
