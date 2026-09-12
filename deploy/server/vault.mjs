/**
 * ΜΝΗΜΗ · 知识库只读入口（本机 vault）
 * 网站只读、只记录，不写回任何路径。ingest 监听仍是知识库 → 网站单向。
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

export const writeSource = () => {
  throw new Error('site does not write vault');
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
