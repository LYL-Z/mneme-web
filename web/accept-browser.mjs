/**
 * 验收脚本共用的浏览器解析（v8）
 *
 * 此前 5 个 accept 脚本各自硬编码
 *   'C:/Users/Lenovo/.agent-browser/browsers/chrome-152.0.7977.82/chrome.exe'
 * ——换机器 / 换浏览器版本就直接崩，CI 上更是必然失败。
 *
 * 解析优先级：
 *   1. MNEME_CHROME                       （显式指定，CI 用）
 *   2. PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH（playwright 生态通用变量）
 *   3. 常见安装位置探测（agent-browser 各版本目录 / 系统 Chrome / Edge）
 *   4. 不指定 executablePath —— 交给 playwright-core 自行解析其自带浏览器
 * 全部落空时返回 { skip: true, reason }，调用方打印告警并**跳过**（退出码 0），
 * 不把「本机没装浏览器」误报成「站点验收不通过」。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** 目录里挑一个可用的 chrome.exe（按版本号倒序，取最新） */
const newestChromeIn = (dir) => {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory());
    const cands = entries
      .map(e => ({ name: e.name, exe: path.join(dir, e.name, 'chrome.exe') }))
      .filter(c => fs.existsSync(c.exe))
      .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
    return cands[0]?.exe ?? null;
  } catch { return null; }
};

const CANDIDATES = [
  process.env.MNEME_CHROME,
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  newestChromeIn(path.join(os.homedir(), '.agent-browser', 'browsers')),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

/** 返回 { chromium, executablePath, skip, reason } */
export function resolveBrowser() {
  let chromium = null;
  try { ({ chromium } = require('playwright-core')); }
  catch { /* 交给调用方处理 */ }

  if (!chromium) {
    return { chromium: null, executablePath: null, skip: true, reason: '未安装 playwright-core' };
  }
  const found = CANDIDATES.find(p => { try { return fs.existsSync(p); } catch { return false; } });
  if (found) return { chromium, executablePath: found, skip: false, reason: '' };
  /* 没探测到：让 playwright 用自带浏览器；它自己找不到会抛错，那时按 skip 处理 */
  return { chromium, executablePath: undefined, skip: false, reason: '' };
}

/** 统一的跳过提示 */
export function skipNotice(script, reason) {
  console.log(`⏭  ${script} 跳过：${reason}`);
  console.log('   （设 MNEME_CHROME=/path/to/chrome 可指定浏览器后重跑）');
}

/** 启动浏览器；不可用时返回 null（调用方应跳过而非失败） */
export async function launch(script = 'accept') {
  const { chromium, executablePath, skip, reason } = resolveBrowser();
  if (skip) { skipNotice(script, reason); return null; }
  try {
    const opts = { headless: true };
    if (executablePath) opts.executablePath = executablePath;
    return await chromium.launch(opts);
  } catch (e) {
    skipNotice(script, `无法启动浏览器（${e?.message || e}）`);
    return null;
  }
}
