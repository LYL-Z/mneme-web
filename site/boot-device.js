/* 首屏写入壳。必须外置：生产 CSP script-src 'self' 会拦内联脚本。 */
(function () {
  var ua = navigator.userAgent || '';
  var os = /HarmonyOS|OpenHarmony|ArkWeb/i.test(ua) ? 'harmony'
    : (/iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) ? 'ios'
    : /Android/i.test(ua) ? 'android'
    : /Windows/i.test(ua) ? 'windows'
    : /Linux/i.test(ua) ? 'linux'
    : /Mac OS X|Macintosh/i.test(ua) ? 'mac' : 'other';
  var vv = window.visualViewport;
  var w = (vv && vv.width) || innerWidth;
  var h = (vv && vv.height) || innerHeight;
  var short = Math.min(w, h);
  var fine = false;
  try { fine = matchMedia('(hover: hover) and (pointer: fine)').matches; } catch (e) {}
  var shell = (short <= 520 || w <= 720 || h <= 520) ? 'phone'
    : !fine ? 'tablet'
    : w <= 1180 ? 'tablet' : 'desktop';
  var el = document.documentElement;
  el.dataset.os = os;
  el.dataset.shell = shell;
  el.dataset.orient = w > h ? 'land' : 'port';
  var coarse = true;
  try { coarse = matchMedia('(pointer: coarse)').matches || matchMedia('(hover: none)').matches; } catch (e2) {}
  el.dataset.pointer = coarse ? 'coarse' : 'fine';
  var stand = false;
  try { stand = matchMedia('(display-mode: standalone)').matches || !!navigator.standalone; } catch (e3) {}
  el.dataset.display = stand ? 'standalone' : 'browser';
  if (w >= 1600) el.dataset.wide = '1';
  var bar = shell !== 'phone' ? '68px' : (w > h ? '52px' : os === 'harmony' ? '72px' : os === 'android' ? '70px' : '68px');
  el.style.setProperty('--phone-bar', bar);
  el.style.setProperty('--vvh', Math.round(h) + 'px');
})();
