/**
 * 本机 vault → ingest 单向监听。写回文件后也会走同一条排队。
 * 私密层变更不触发（本来就不进公开索引）。云模式不要开。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VAULT, vaultReady } from './vault.mjs';
import { isPrivatePath } from './privacy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

let timer = 0;
let running = false;
let queued = false;
let last = null;
let watching = false;

const interesting = (rel) => {
  if (!rel || !/\.md$/i.test(rel)) return false;
  if (rel.includes('.mneme-tmp') || rel.includes('.obsidian') || rel.includes('.git')) return false;
  if (isPrivatePath(rel)) return false;
  return true;
};

export const syncStatus = () => ({
  watching,
  vault: vaultReady(),
  last,
  pending: queued || !!timer,
});

export function requestIngest(reason = 'manual') {
  queued = true;
  if (running) return;
  windowClear();
  timer = setTimeout(() => start(reason), reason === 'save' ? 400 : 2200);
}

const windowClear = () => { if (timer) { clearTimeout(timer); timer = 0; } };

function start(reason) {
  timer = 0;
  queued = false;
  if (running) { queued = true; return; }
  running = true;
  const child = spawn(process.execPath, ['--experimental-sqlite', 'ingest/ingest.mjs'], {
    cwd: ROOT,
    stdio: 'ignore',
    env: process.env,
  });
  child.on('exit', (code) => {
    running = false;
    last = { t: new Date().toISOString(), reason, code };
    if (queued) requestIngest('queued');
  });
}

export function startVaultWatch() {
  if (process.env.MNEME_WATCH === '0') return;
  if (process.env.MNEME_MODE === 'cloud') return;
  if (!vaultReady()) return;
  watching = true;
  try {
    fs.watch(VAULT, { recursive: true }, (_ev, file) => {
      if (!file) return;
      const rel = String(file).split(path.sep).join('/');
      if (!interesting(rel)) return;
      requestIngest('watch');
    });
  } catch {
    watching = false;
  }
}
