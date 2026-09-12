/**
 * 设备壳：手机 / 平板 / 电脑。系统：鸿蒙 / iOS / Android / Windows / macOS。
 * 不只看宽度——鸿蒙手机横屏、折叠屏展开、MatePad 用触点与短边判断。
 * 视觉视口写入 --vvh / --vv-kb，给 ArkWeb / iOS 地址栏与键盘用。
 */

export type DeviceOs = 'harmony' | 'ios' | 'android' | 'windows' | 'mac' | 'linux' | 'other';
export type DeviceShell = 'phone' | 'tablet' | 'desktop';
export type DeviceOrient = 'port' | 'land';

export interface DeviceInfo {
  os: DeviceOs;
  shell: DeviceShell;
  orient: DeviceOrient;
  standalone: boolean;
  coarse: boolean;
  vw: number;
  vh: number;
}

const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent);

export function detectOs(): DeviceOs {
  const s = ua();
  if (/HarmonyOS|OpenHarmony|ArkWeb/i.test(s)) return 'harmony';
  const iPadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  if (/iP(hone|ad|od)/.test(s) || iPadOs) return 'ios';
  if (/Android/i.test(s)) return 'android';
  if (/Windows/i.test(s)) return 'windows';
  if (/Linux/i.test(s)) return 'linux';
  if (/Mac OS X|Macintosh/i.test(s)) return 'mac';
  return 'other';
}

export function detectShell(): DeviceShell {
  const w = window.visualViewport?.width ?? window.innerWidth;
  const h = window.visualViewport?.height ?? window.innerHeight;
  const short = Math.min(w, h);
  let fineHover = false;
  try { fineHover = matchMedia('(hover: hover) and (pointer: fine)').matches; }
  catch { /* 旧内核 */ }
  if (short <= 520 || w <= 720 || h <= 520) return 'phone';
  if (!fineHover) return 'tablet';
  if (w <= 1180) return 'tablet';
  return 'desktop';
}

export function readDevice(): DeviceInfo {
  const w = window.visualViewport?.width ?? window.innerWidth;
  const h = window.visualViewport?.height ?? window.innerHeight;
  let coarse = true;
  try { coarse = matchMedia('(pointer: coarse)').matches || matchMedia('(hover: none)').matches; }
  catch { /* */ }
  let standalone = false;
  try {
    standalone = matchMedia('(display-mode: standalone)').matches
      || !!(navigator as Navigator & { standalone?: boolean }).standalone;
  } catch { /* */ }
  return {
    os: detectOs(),
    shell: detectShell(),
    orient: w > h ? 'land' : 'port',
    standalone,
    coarse,
    vw: Math.round(w),
    vh: Math.round(h),
  };
}

export const osLabel = (os: DeviceOs) =>
  ({ harmony: '鸿蒙', ios: 'iOS', android: 'Android', windows: 'Windows', mac: 'macOS', linux: 'Linux', other: '其他' }[os]);

export const shellLabel = (s: DeviceShell) =>
  ({ phone: '手机', tablet: '平板', desktop: '电脑' }[s]);

function applyVars(info: DeviceInfo) {
  const root = document.documentElement;
  root.dataset.os = info.os;
  root.dataset.shell = info.shell;
  root.dataset.orient = info.orient;
  root.dataset.display = info.standalone ? 'standalone' : 'browser';
  root.dataset.pointer = info.coarse ? 'coarse' : 'fine';
  const vv = window.visualViewport;
  const vh = vv?.height ?? window.innerHeight;
  root.style.setProperty('--vvh', `${Math.round(vh)}px`);
  const kb = Math.max(0, window.innerHeight - vh - (vv?.offsetTop ?? 0));
  root.style.setProperty('--vv-kb', kb > 64 ? `${Math.round(kb)}px` : '0px');
  const bar = info.shell !== 'phone' ? '68px'
    : info.orient === 'land' ? '52px'
    : info.os === 'harmony' ? '72px'
    : info.os === 'android' ? '70px'
    : info.os === 'ios' ? '68px'
    : '68px';
  root.style.setProperty('--phone-bar', bar);
  if (info.vw >= 1600) root.dataset.wide = '1';
  else delete root.dataset.wide;
}

let lastSig = '';
export function applyDevice() {
  const info = readDevice();
  const sig = `${info.os}|${info.shell}|${info.orient}|${info.standalone}|${info.vw}|${info.vh}`;
  if (sig === lastSig) return info;
  lastSig = sig;
  applyVars(info);
  return info;
}

export function bootDevice() {
  applyDevice();
  const on = () => applyDevice();
  window.addEventListener('resize', on, { passive: true });
  window.addEventListener('orientationchange', on);
  const vv = window.visualViewport;
  vv?.addEventListener('resize', on);
  vv?.addEventListener('scroll', on);
  try { matchMedia('(pointer: coarse)').addEventListener('change', on); } catch { /* */ }
  try { matchMedia('(hover: hover) and (pointer: fine)').addEventListener('change', on); } catch { /* */ }
  return () => {
    window.removeEventListener('resize', on);
    window.removeEventListener('orientationchange', on);
    vv?.removeEventListener('resize', on);
    vv?.removeEventListener('scroll', on);
  };
}
