import { immLevel } from './immersive';

/**
 * v5 · 粒子湮灭（WebGL2 · 对标 HarmonyOS 沉浸光感原生实现）
 *
 * 三层架构（对齐华为 ArkUI Particle）：
 * ── 纹理采样层 ──
 *   SVG foreignObject 快照（浏览器原生渲染，color()/color-mix()/渐变全支持）
 *   → 4×4px 网格采样 → 每格取该像素真实颜色成粒
 *   （粒子颜色 = 原卡片像素：字形笔画/按钮/边框真实还原，杜绝颜色跳变）
 * ── GPU 驱动层 ──
 *   粒子属性（位置/初速度/颜色/延迟/寿命/种子）一次性写入 GPU buffer；
 *   欧拉积分（阻尼解析解 + 浮力 + 湍流）在顶点着色器并行计算；
 *   每帧仅更新 u_time 并提交一次 drawArrays(POINTS)——零 CPU 逐粒循环。
 * ── 渲染层 ──
 *   gl.POINTS + 圆形软边片元 + 加色混合（lighter），叠加自然成光团。
 *
 * 流程：点击关闭 → 卡片保持原样 → 底→顶噪声参差锋面激活，DOM 由 clip-path 随锋面
 *   同步裁切；快照就绪瞬间 DOM 隐由粒子接管 → 原地弥漫上浮 → 消亡即销毁清理。
 * 性能：快照预采样缓存（弹窗打开后空闲预跑，关闭零延迟）、单次 getImageData、
 *   GPU buffer 一次性上传、DPR 上限 2、档位量化、动画毕即销毁。
 * 回退：WebGL2 不可用 → Canvas 2D（同采样与物理模型）。
 */

const TAU = Math.PI * 2;
const n2 = (x: number, y: number): number => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/** 档位参数（粒子密度与步长，对齐文档强/均衡/弱分级） */
const tier = () => {
  const l = immLevel();
  return l === 'exquisite' ? { step: 3, keep: 0.16 } : l === 'gentle' ? { step: 4, keep: 0.11 } : { step: 6, keep: 0.07 };
};

/* ------------------------------------------------------------------ */
/* 快照采样：SVG foreignObject（浏览器原生渲染，无解析器限制）               */
/* ------------------------------------------------------------------ */

interface Sample { w: number; h: number; data: Uint8ClampedArray }
const snapCache = new WeakMap<HTMLElement, { p: Promise<Sample | null> }>();

async function snapshotCard(card: HTMLElement): Promise<Sample | null> {
  try {
    const doc = card.ownerDocument;
    const win = doc.defaultView || window;
    const R = card.getBoundingClientRect();
    if (R.width < 20 || R.height < 20) return null;

    const clone = card.cloneNode(true) as HTMLElement;
    const inline = (from: Element, to: Element) => {
      const cs = win.getComputedStyle(from);
      const el = to as HTMLElement;
      for (let i = 0; i < cs.length; i++) {
        const p = cs.item(i);
        if (!p || p.startsWith('--')) continue;           // 自定义属性跳过
        try { el.style.setProperty(p, cs.getPropertyValue(p)); } catch { /* 跳过 */ }
      }
      const kids = Array.from(from.children), tk = Array.from(to.children);
      for (let i = 0; i < kids.length && i < tk.length; i++) inline(kids[i], tk[i]);
    };
    inline(card, clone);
    clone.style.setProperty('position', 'relative');
    clone.style.setProperty('left', '0px');
    clone.style.setProperty('top', '0px');
    clone.style.setProperty('margin', '0px');
    clone.style.setProperty('width', R.width + 'px');
    clone.style.setProperty('height', R.height + 'px');

    const xhtml = new XMLSerializer().serializeToString(clone);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + R.width + '" height="' + R.height + '">'
      + '<foreignObject x="0" y="0" width="100%" height="100%">'
      + '<div xmlns="http://www.w3.org/1999/xhtml" style="width:' + R.width + 'px;height:' + R.height + 'px;overflow:hidden">'
      + xhtml + '</div></foreignObject></svg>';
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('svg snapshot load failed'));
      img.src = url;
    });
    const cv = doc.createElement('canvas');
    cv.width = Math.round(R.width);
    cv.height = Math.round(R.height);
    const ctx = cv.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = 'rgba(246,242,233,0.9)';             // 玻璃底补底
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    return { w: cv.width, h: cv.height, data: ctx.getImageData(0, 0, cv.width, cv.height).data }; // 单次
  } catch { return null; }
}

/** 弹窗打开后空闲预采样（快照缓存 → 关闭零延迟） */
export function prepareSnapshot(el: HTMLElement): void {
  if (snapCache.has(el)) return;
  snapCache.set(el, { p: snapshotCard(el) });
}

async function getSample(el: HTMLElement): Promise<Sample | null> {
  const hit = snapCache.get(el);
  if (hit) return hit.p;
  prepareSnapshot(el);
  return snapCache.get(el)!.p;
}

/* ------------------------------------------------------------------ */
/* WebGL2 着色器：欧拉积分阻尼解析解 + 浮力 + 湍流，全部并行                 */
/* ------------------------------------------------------------------ */

const VERT = `#version 300 es
precision highp float;
in vec2 a_pos;
in vec2 a_vel;
in vec3 a_color;
in float a_delay;
in float a_life;
in float a_seed;
uniform float u_time;
uniform vec2 u_res;
uniform float u_dpr;
uniform float u_size;
out vec3 v_color;
out float v_alpha;
void main() {
  float age = (u_time - a_delay) / 1000.0;
  float life = a_life / 1000.0;
  if (age < 0.0 || age > life) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    gl_PointSize = 0.0;
    v_alpha = 0.0;
    v_color = a_color;
    return;
  }
  float k = age / life;
  /* 欧拉积分阻尼解析解：位移 = v0·(1−e^{−c·t})/c */
  float c = 0.62;
  float inv = (1.0 - exp(-c * age)) / c;
  /* 持续向上浮力（参考帧：先爆发后缓慢上飘） */
  float buoy = -9.0 * age * age * 0.5;
  /* 弱湍流：随生命增强，相位由随机种子偏移 */
  vec2 turb = vec2(
    sin(age * 0.9 + a_seed * 6.28318),
    cos(age * 0.7 + a_seed * 6.28318)
  ) * (9.0 + 20.0 * k);
  /* 悬浮呼吸：每个粒子按自身相位缓慢上下浮动（仙境感） */
  float breathe = sin(age * 1.1 + a_seed * 12.566) * 5.0;
  vec2 p = a_pos + a_vel * inv + turb + vec2(0.0, buoy + breathe);
  vec2 clip = (p / u_res) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  float fade = pow(1.0 - k, 0.72);   // 中段维持可见（玻璃态绵长），尾部快速消隐
  gl_PointSize = u_size * u_dpr * (0.45 + fade * 0.8);
  v_color = a_color;
  v_alpha = fade * 0.88;              // 半透明玻璃颗粒（lighter 叠加成通透光雾）
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec3 v_color;
in float v_alpha;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float core = 0.55 + 0.45 * pow(1.0 - clamp(r, 0.0, 1.0), 2.0);
  float a = smoothstep(1.0, 0.45, r) * v_alpha * core;
  outColor = vec4(v_color, a);
}`;

const compile = (gl: WebGL2RenderingContext, type: number, src: string) => {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return null; }
  return s;
};

const motionOff = () =>
  typeof document !== 'undefined' && (
    document.documentElement.classList.contains('no-motion')
    || matchMedia('(prefers-reduced-motion: reduce)').matches
  );

/* ------------------------------------------------------------------ */
/* 主入口                                                              */
/* ------------------------------------------------------------------ */

/**
 * 粒子画布挂在 document.body，与 React 树解耦——卡片可先裁切隐藏，光尘仍播完。
 * onDone 在崩解锋面走完时回调（约 420ms），不把界面卡在粒子寿命上。
 */
export function annihilate(el: HTMLElement, onDone?: () => void): void {
  const done = (() => {
    let once = false;
    return () => { if (once) return; once = true; onDone?.(); };
  })();

  const doc = el.ownerDocument;
  const w = doc.defaultView!;
  if (motionOff()) { done(); return; }

  const card = (el.matches?.('.anno-card, .sg, .gp-sheet') ? el : null)
    || (el.querySelector('.anno-card, .sg, .gp-sheet') as HTMLElement)
    || el;
  const mask = card.closest('.anno-mask, .sg-mask') as HTMLElement | null;
  if (mask) mask.classList.add('annihilating');

  const R = card.getBoundingClientRect();
  if (R.width < 40 || R.height < 40) { done(); return; }

  const t0 = performance.now();
  const BURST = 420;   // 工作台预算：关闭 400ms 级，粒子可在身后继续

  let clipRaf = 0;
  const releaseUi = () => {
    cancelAnimationFrame(clipRaf);
    if (card.isConnected) {
      card.style.clipPath = 'inset(0 0 100% 0)';
      card.style.visibility = 'hidden';
    }
    done();
  };

  /* DOM 裁切驱动：随崩解锋面从底部裁起（独立于渲染后端） */
  const driveClip = () => {
    const pct = Math.min(100, ((performance.now() - t0) / BURST) * 100);
    if (card.isConnected) card.style.clipPath = 'inset(0 0 ' + pct.toFixed(2) + '% 0)';
    if (pct < 100 && card.isConnected) clipRaf = requestAnimationFrame(driveClip);
    else releaseUi();
  };
  clipRaf = requestAnimationFrame(driveClip);

  void (async () => {
    const sample = await getSample(card);
    if (card.isConnected) card.style.visibility = 'hidden';   // 快照就绪瞬间 DOM 隐由粒子接管

    const { step, keep } = tier();
    if (!sample) { releaseUi(); return; }

    /* ── 网格采样：step×step 一格一粒子，取像素真实颜色 ── */
    const sw = sample.w, sh = sample.h, data = sample.data;
    const sx = R.width / sw, sy = R.height / sh;
    const cap = 60000;
    const px: number[] = [], py: number[] = [], pvx: number[] = [], pvy: number[] = [];
    const pcl: number[] = [], pdl: number[] = [], plf: number[] = [], psd: number[] = [];
    let maxEnd = BURST + 400;
    for (let gy = 0; gy < sh; gy += step) {
      for (let gx = 0; gx < sw; gx += step) {
        if (px.length / 2 >= cap) break;
        const i = (gy * sw + gx) * 4;
        if (data[i + 3] < 48) continue;
        if (keep < 1 && Math.random() > keep) continue;
        const x = R.left + gx * sx, y = R.top + gy * sy;
        px.push(x, y);
        pvx.push((Math.random() - 0.5) * 150);
        pvy.push(-(18 + Math.random() * 64));
        const lum = (data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11) / 255;
                if (Math.random() < 0.85) {
                  /* 发光尘：原色向暖白提亮混合（浅底上呈光点而非灰雾） */
                  const mixW = 0.62 + (1 - lum) * 0.22;
                  pcl.push(Math.min(1, data[i] / 255 * (1 - mixW) + 1.0 * mixW * 0.99),
                           Math.min(1, data[i + 1] / 255 * (1 - mixW) + 0.985 * mixW),
                           Math.min(1, data[i + 2] / 255 * (1 - mixW) + 0.95 * mixW));
                } else {
                  pcl.push(Math.min(1, data[i] / 255 * 1.08 + 0.02), Math.min(1, data[i + 1] / 255 * 1.08 + 0.02), Math.min(1, data[i + 2] / 255 * 1.08 + 0.03));
                }
        const dly = ((R.bottom - y) / R.height) * BURST * (0.75 + n2(x * 0.08, y * 0.08) * 0.5) + n2(x * 0.31, y * 0.17) * 24;
        const life = 520 + Math.random() * 360;
        pdl.push(dly);
        plf.push(life);
        psd.push(Math.random());
        maxEnd = Math.max(maxEnd, dly + life);
      }
    }
    const N = px.length / 2;
    if (N === 0) { releaseUi(); return; }
    maxEnd += 80; // 尾尘淡出余量，避免最后一粒被掐断

    const cvs = doc.createElement('canvas');
    const dpr = Math.min(2, w.devicePixelRatio || 1);
    cvs.width = Math.round(w.innerWidth * dpr);
    cvs.height = Math.round(w.innerHeight * dpr);
    const FADE_TAIL = 260; // 尾尘收束时整幅画布淡出，避免最后一帧硬切
    const paintFade = (elapsed: number) => {
      const remain = maxEnd - elapsed;
      cvs.style.opacity = remain < FADE_TAIL ? String(Math.max(0, remain / FADE_TAIL)) : '1';
    };
    cvs.style.cssText = 'position:fixed;left:0;top:0;width:' + w.innerWidth + 'px;height:' + w.innerHeight + 'px;z-index:200;pointer-events:none;transform:translateZ(0);will-change:transform,opacity;';
    doc.body.appendChild(cvs);

    const gl = cvs.getContext('webgl2', { alpha: true, antialias: false, depth: false });
    if (gl) {
      /* ── WebGL2：buffer 一次上传，shader 并行计算，每帧一次 draw ── */
      const vs = compile(gl, gl.VERTEX_SHADER, VERT);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
      const prog = vs && fs ? gl.createProgram() : null;
      if (prog) { gl.attachShader(prog, vs!); gl.attachShader(prog, fs!); gl.linkProgram(prog); }
      if (!prog || !gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        cvs.remove(); releaseUi(); return;
      }
      gl.useProgram(prog);
      const setAttr = (arr: number[], name: string, size: number) => {
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
        const a = gl.getAttribLocation(prog, name);
        gl.enableVertexAttribArray(a);
        gl.vertexAttribPointer(a, size, gl.FLOAT, false, 0, 0);
      };
      setAttr(px, 'a_pos', 2);
      const vel: number[] = [];
      for (let i = 0; i < N; i++) vel.push(pvx[i], pvy[i]);
      setAttr(vel, 'a_vel', 2);
      setAttr(pcl, 'a_color', 3);
      setAttr(pdl, 'a_delay', 1);
      setAttr(plf, 'a_life', 1);
      setAttr(psd, 'a_seed', 1);
      const uTime = gl.getUniformLocation(prog, 'u_time');
      gl.uniform2f(gl.getUniformLocation(prog, 'u_res'), w.innerWidth, w.innerHeight);
      gl.uniform1f(gl.getUniformLocation(prog, 'u_dpr'), dpr);
      gl.uniform1f(gl.getUniformLocation(prog, 'u_size'), step * 0.42);
      gl.viewport(0, 0, cvs.width, cvs.height);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);       // lighter 加色叠加成光团
      gl.clearColor(0, 0, 0, 0);
      const loop = () => {
        const el0 = performance.now() - t0;
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform1f(uTime, el0);
        gl.drawArrays(gl.POINTS, 0, N);          // 单次绘制调用
        paintFade(el0);
        if (el0 < maxEnd) requestAnimationFrame(loop);
        else { cvs.remove(); releaseUi(); }
      };
      requestAnimationFrame(loop);
      return;
    }

    /* ── 回退：Canvas 2D（同采样与物理） ── */
    const ctx2 = cvs.getContext('2d');
    if (!ctx2) { cvs.remove(); releaseUi(); return; }
    ctx2.scale(dpr, dpr);
    ctx2.globalCompositeOperation = 'lighter';
    const vx2 = new Float32Array(N), vy2 = new Float32Array(N), life2 = new Float32Array(N), age2 = new Float32Array(N);
    for (let i = 0; i < N; i++) { vx2[i] = pvx[i]; vy2[i] = pvy[i]; life2[i] = plf[i]; }
    let last = performance.now();
    const loop2 = () => {
      const now = performance.now();
      const dt = Math.min(34, now - last); last = now;
      const el0 = now - t0;
      ctx2.clearRect(0, 0, w.innerWidth, w.innerHeight);
      let alive = 0;
      for (let i = 0; i < N; i++) {
        if (el0 < pdl[i]) continue;
        age2[i] += dt;
        if (age2[i] > life2[i]) continue;
        alive++;
        const k = age2[i] / life2[i];
        vy2[i] -= 0.0006 * dt;
        vx2[i] += Math.sin(age2[i] * 0.0011 + psd[i] * TAU) * 0.0011 * dt;
        vx2[i] *= 0.992; vy2[i] *= 0.992;
        px[i * 2] += vx2[i] * (dt / 16);
        py[i * 2] += vy2[i] * (dt / 16);
        const fade = Math.pow(1 - k, 0.72);
        ctx2.globalAlpha = fade * 0.5;
        const s = step * 0.5 * (0.45 + fade * 0.8);
        ctx2.fillStyle = 'rgb(' + (pcl[i * 3] * 255 | 0) + ',' + (pcl[i * 3 + 1] * 255 | 0) + ',' + (pcl[i * 3 + 2] * 255 | 0) + ')';
        ctx2.fillRect(px[i * 2], py[i * 2], s, s);
      }
      ctx2.globalAlpha = 1;
      paintFade(el0);
      if ((alive > 0 || el0 < BURST + 280) && el0 < maxEnd) requestAnimationFrame(loop2);
      else { cvs.remove(); releaseUi(); }
    };
    requestAnimationFrame(loop2);
  })();
}

/** 兼容旧调用：DOM 隐身现由 annihilate 在快照就绪瞬间内部执行 */
export function hideForAnnihilation(_el: HTMLElement): void {
  /* no-op（保持调用点兼容） */
}
