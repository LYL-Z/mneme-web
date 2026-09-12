/**
 * ΜΝΗΜΗ · 知识库写回（本机 vault）
 * 永远不写 私人资料/ 与 隐私/。路径不得越出 MNEME_VAULT。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isPrivatePath, isSecretPath } from './privacy.mjs';

export const VAULT = process.env.MNEME_VAULT || 'D:/The Memory/The Memory';
const MAX_BYTES = 1_200_000;

export const vaultReady = () => {
  try { return fs.existsSync(VAULT) && fs.statSync(VAULT).isDirectory(); }
  catch { return false; }
};

export const normRel = (raw) => {
  let p = decodeURIComponent(String(raw || '')).replace(/^\/+/, '').replace(/\\/g, '/');
  if (!p || p.includes('..') || p.includes('\0')) return null;
  if (!/\.md$/i.test(p)) p += '.md';
  return p;
};

export const absSafe = (rel) => {
  if (!rel) return null;
  const root = path.resolve(VAULT);
  const abs = path.resolve(root, rel);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(prefix)) return null;
  return abs;
};

/** private | secret | public */
export const writeClass = (rel) => {
  if (!rel || isPrivatePath(rel)) return 'private';
  if (isSecretPath(rel)) return 'secret';
  if (/章节设计-第[二三]卷|试写\/第三卷|第三卷样章/.test(rel)) return 'secret';
  if (rel.includes('问卷作答全文')) {
    if (/母亲问卷|父亲问卷|妈妈问卷|爸爸问卷/.test(rel)) return 'public';
    return 'secret';
  }
  return 'public';
};

export const readSource = (rel) => {
  const abs = absSafe(rel);
  if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  const st = fs.statSync(abs);
  if (st.size > MAX_BYTES) return null;
  const text = fs.readFileSync(abs, 'utf8');
  return {
    path: rel,
    text,
    mtime: st.mtime.toISOString(),
    bytes: st.size,
    sha256: crypto.createHash('sha256').update(text).digest('hex').slice(0, 16),
  };
};

export const writeSource = (rel, text) => {
  if (typeof text !== 'string') throw new Error('not text');
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new Error('too large');
  const abs = absSafe(rel);
  if (!abs || !abs.toLowerCase().endsWith('.md')) throw new Error('bad path');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.mneme-tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, abs);
  return readSource(rel);
};

export const bodyFromRaw = (raw) => {
  const text = String(raw || '');
  if (!text.startsWith('---')) return text.replace(/^#\s.*\n/, '');
  const end = text.indexOf('\n---', 3);
  if (end < 0) return text.replace(/^#\s.*\n/, '');
  return text.slice(end + 4).replace(/^\r?\n/, '').replace(/^#\s.*\n/, '');
};

export const titleFromRaw = (raw, fallback = '') => {
  const m = String(raw || '').match(/^#\s+(.+)$/m);
  return (m ? m[1].trim() : fallback).replace(/^#+\s*/, '') || fallback;
};
