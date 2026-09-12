import { useEffect, useMemo, useRef, useState } from 'react';
import {
  forceSimulation, forceCollide,
  type Simulation, type SimulationNodeDatum,
} from 'd3-force';
import { api, ApiError, apiErrorMessage, type EntityDetail, type GraphData } from '../api';
import { notify } from '../toast';
import { evidenceLabel } from '../evidenceKind';
import { useFocusTrap } from '../focusTrap';
import { askUnlock } from '../unlock';

/**
 * Σ3 人物星图 · v7「行星旷野」
 * 210 真人物实星如行星般均匀扩散在整个界面（向日葵分布 + 碰撞松弛，大星居中），
 * 每颗行星常驻姓名标签（缩放分级显现：俯瞰看大星，放大看全部）；
 * 拖拽平移（鼠标/单指）· 滚轮/双指捏合缩放（以指针为锚）· 双击推进 · 角落 ±/复位；
 * 搜索框：命中人物平滑飞行定位 + 脉冲高亮 + 自动开档；保留类别配色与星表。
 * 性能协议沿用 v6：行星/共现边 ∈ 静态位图（离屏 canvas），标签/悬停/脉冲 ∈ 动态层，
 * 视图状态全走 ref（不触发 React 渲染），无脏自动停 rAF。
 */
const GROUP_ORDER = ['家族亲属', '师长', '同窗友人', '其他'];
const GROUP_PALETTE: Record<string, string> = {
  '家族亲属': '#C2A46B', '师长': '#8FA38A', '同窗友人': '#6E8AA8', '其他': '#A86A6A',
};
const GOLDEN = 2.399963229728653;
/** 行星旷野世界尺寸（世界坐标，原点 = 世界中心） */
const WORLD = { w: 2600, h: 1600 };
const MARGIN = 96;          // 世界边缘留白（防标签被裁）
const K_MIN = 0.24, K_MAX = 3.4;
const VIEW_KEY = 'mneme-graph-view';

interface GNode extends SimulationNodeDatum {
  id: number; name: string; grp: string; mention: number; r: number; color: string;
  rank: number; // 星等排名（0 = 提及最多；低倍俯瞰时的名牌预算按此分级）
  locked?: boolean;
}
interface GEdge { source: number | GNode; target: number | GNode; w: number }
interface View { x: number; y: number; k: number }
interface Dust { x: number; y: number; ph: number; s: number }

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const hash1 = (n: number) => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };
/** 十六进制色向白提亮（行星立体高光用） */
const tint = (hex: string, k: number) => {
  const m = hex.replace('#', '');
  const v = parseInt(m.length === 3 ? m.split('').map(c => c + c).join('') : m, 16);
  const r = Math.round(((v >> 16) & 255) + (255 - ((v >> 16) & 255)) * k);
  const g2 = Math.round(((v >> 8) & 255) + (255 - ((v >> 8) & 255)) * k);
  const b = Math.round((v & 255) + (255 - (v & 255)) * k);
  return `rgb(${r},${g2},${b})`;
};

export function Graph({ theme, focusPersonId, onOpenDoc, onOpenPerson, onClearFocus }: {
  theme: 'paper' | 'night';
  focusPersonId: number | null;
  onOpenDoc: (path: string) => void;
  onOpenPerson?: (id: number) => void;
  onClearFocus: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<GraphData | null>(null);
  const [hover, setHover] = useState<GNode | null>(null);
  const [sheet, setSheet] = useState<EntityDetail | null>(null);
  const sheetIdRef = useRef<number | null>(null);
  sheetIdRef.current = sheet?.id ?? null;
  /* 星表：星图等价列表入口（键盘可达——所有人物皆为 <button>，可 Tab / Enter 打开） */
  const [listOpen, setListOpen] = useState(false);
  const [listQ, setListQ] = useState('');
  const [rosterCur, setRosterCur] = useState(0);
  const rosterRef = useRef<HTMLDivElement>(null);
  useFocusTrap(rosterRef, listOpen, () => setListOpen(false));
  /* 类别过滤：关掉的关系组不绘星、不参与点选。提及次数仍不是亲密度。 */
  const [offGroups, setOffGroups] = useState<Set<string>>(() => new Set());
  const offGroupsRef = useRef(offGroups);
  offGroupsRef.current = offGroups;
  /* 绝密解锁后丢掉锁定态星图，重新拉全量节点 */
  const [graphGen, setGraphGen] = useState(0);
  /* 搜索（v7）：常驻搜索框 + 候选下拉 + 飞行定位 */
  const [q, setQ] = useState('');
  const [qFocus, setQFocus] = useState(false);

  const viewRef = useRef<View>({ x: 0, y: 0, k: 1 });
  const hoverRef = useRef<GNode | null>(null);
  const simRef = useRef<Simulation<GNode, undefined> | null>(null);
  const dustRef = useRef<Dust[]>([]);
  const nodesRef = useRef<GNode[]>([]);
  const spriteRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const edgeMapRef = useRef<HTMLCanvasElement | null>(null); // 星云+静态星尘+共现边 预烘焙世界贴图
  const byIdRef = useRef<Map<number, GNode>>(new Map());
  const edgesRef = useRef<GEdge[]>([]);
  const adjRef = useRef<Map<number, { id: number; w: number }[]>>(new Map());
  const roRef = useRef<() => void>(() => {}); // 唤醒渲染循环（停绘后由交互触发）
  const flyRef = useRef<{ t0: number; dur: number; from: View; to: View } | null>(null);
  const pulseRef = useRef<{ node: GNode; t0: number } | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ dist: number; mid: { x: number; y: number }; view: View } | null>(null);
  const dragRef = useRef<{ last: { x: number; y: number } | null; moved: boolean }>({ last: null, moved: false });

  /* Canvas 颜色随主题（M6）：星尘/共现边/标签从 CSS 变量取色，切换即时生效 */
  const themeColRef = useRef({ dust: '#1D1A16', edge: '#274B6E', ring: '#1D1A16', label: '#4A443A', labelHi: '#1D1A16' });
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
    themeColRef.current = {
      dust: v('--ink', '#1D1A16'), edge: v('--aegean', '#274B6E'),
      ring: v('--ink', '#1D1A16'), label: v('--ink-soft', '#4A443A'), labelHi: v('--ink', '#1D1A16'),
    };
    edgeMapRef.current = null; // 主题换色 → 世界贴图重烘焙
    roRef.current(); // 主题切换 → 重绘一帧
  }, [theme]);

  /* ---------- 视图工具（全 ref 路径，绕开 React 渲染） ---------- */
  const clampView = (v: View): View => {
    const k = Math.min(K_MAX, Math.max(K_MIN, v.k));
    const mx = (WORLD.w / 2) * k + 420, my = (WORLD.h / 2) * k + 420;
    return { k, x: Math.max(-mx, Math.min(mx, v.x)), y: Math.max(-my, Math.min(my, v.y)) };
  };
  const saveView = () => {
    try { sessionStorage.setItem(VIEW_KEY, JSON.stringify(viewRef.current)); } catch { /* 隐私模式 */ }
  };
  const fitView = (vw: number, vh: number): View =>
    ({ x: 0, y: 0, k: Math.min(K_MAX, Math.max(K_MIN, Math.min(vw / WORLD.w, vh / WORLD.h) * 0.94)) });

  /* 缩放动画（按钮 / 双击 / 搜索飞行共用）：rAF 插值 view，期间保持渲染循环 */
  const animViewTo = (to: View, dur = 420, onDone?: () => void) => {
    const from = { ...viewRef.current };
    flyRef.current = { t0: performance.now(), dur, from, to: clampView(to) };
    const step = () => {
      const f = flyRef.current;
      if (!f) return;
      const t = Math.min(1, (performance.now() - f.t0) / f.dur);
      const e = easeInOutCubic(t);
      viewRef.current = {
        x: f.from.x + (f.to.x - f.from.x) * e,
        y: f.from.y + (f.to.y - f.from.y) * e,
        k: f.from.k + (f.to.k - f.from.k) * e,
      };
      roRef.current();
      if (t >= 1) { flyRef.current = null; onDone?.(); }
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const zoomAt = (mx: number, my: number, factor: number) => {
    const v = viewRef.current;
    const k2 = Math.min(K_MAX, Math.max(K_MIN, v.k * factor));
    const s = k2 / v.k;
    viewRef.current = clampView({ k: k2, x: mx - (mx - v.x) * s, y: my - (my - v.y) * s });
    roRef.current();
  };
  /** 飞行至某行星：居中 + 放大到可读档位，抵达后脉冲高亮 */
  const flyTo = (node: GNode, thenSheet = true) => {
    if (!wrapRef.current || node.x == null || node.y == null) return;
    const k2 = Math.min(2.2, Math.max(viewRef.current.k, 1.3));
    animViewTo({ x: -node.x * k2, y: -node.y * k2, k: k2 }, 760, () => {
      pulseRef.current = { node, t0: performance.now() };
      roRef.current();
      if (thenSheet) openSheet(node.id);
    });
  };
  /** 按 id 飞行（搜索 / 星表共用；API 节点类型与画布节点解耦） */
  const flyToId = (id: number, thenSheet = true) => {
    const n = byIdRef.current.get(id);
    if (n) flyTo(n, thenSheet);
  };

  /* ---------- 数据与行星旷野布局 ---------- */
  useEffect(() => {
    api.graph().then(g => {
      // 星等降序 → 大行星先落位（向日葵分布自中心展开：核心亮星居中，外缘渐小）
      const members = [...g.nodes].sort((a, b) => b.mention - a.mention);
      const N = members.length || 1;
      const rx = WORLD.w / 2 - MARGIN, ry = WORLD.h / 2 - MARGIN;
      const nodes: GNode[] = members.map((m, i) => {
        const t = Math.sqrt((i + 0.6) / N);
        const ang = i * GOLDEN + hash1(m.id) * 0.22; // 确定性抖动去网格感
        const r = Math.max(2.6, Math.min(3.2 + Math.sqrt(m.mention) * 1.15, 15));
        return {
          id: m.id, name: m.name, grp: m.grp, mention: m.mention, r,
          color: GROUP_PALETTE[m.grp] || '#A9864A',
          locked: m.locked,
          rank: i,
          x: Math.cos(ang) * t * rx + (hash1(m.id + 7) - 0.5) * 30,
          y: Math.sin(ang) * t * ry + (hash1(m.id + 13) - 0.5) * 30,
        };
      });
      // 碰撞松弛：只推开重叠，骨架不动；预跑 120 帧让布局即刻成形
      const sim = forceSimulation<GNode>(nodes)
        .force('collide', forceCollide<GNode>().radius(d => d.r + 14).strength(0.9))
        .alphaDecay(0.03);
      sim.stop();
      for (let i = 0; i < 120; i++) sim.tick();
      simRef.current = sim;
      nodesRef.current = nodes;
      // v7.3 松弛无锚定会整体漂移收缩——无条件逐轴归一化回设计边界，保证行星铺满整个界面
      {
        let mx = 0, my = 0;
        for (const n of nodes) { mx = Math.max(mx, Math.abs(n.x ?? 0)); my = Math.max(my, Math.abs(n.y ?? 0)); }
        if (mx > 0 && my > 0) {
          const sx = rx / mx, sy = ry / my;
          for (const n of nodes) { if (n.x != null) n.x *= sx; if (n.y != null) n.y *= sy; }
        }
      }
      byIdRef.current = new Map(nodes.map(n => [n.id, n]));
      /* 共现边降采样 top700（低权重边 alpha<0.05 本就不可见）+ 邻接表（hover 聚焦） */
      const edges: GEdge[] = g.edges
        .filter(e => byIdRef.current.has(e[0]) && byIdRef.current.has(e[1]))
        .sort((a, b) => b[2] - a[2])
        .slice(0, 700)
        .map(e => ({ source: byIdRef.current.get(e[0])!, target: byIdRef.current.get(e[1])!, w: e[2] }));
      const adj = new Map<number, { id: number; w: number }[]>();
      for (const e of edges) {
        const s = e.source as GNode, t2 = e.target as GNode;
        if (!adj.has(s.id)) adj.set(s.id, []);
        if (!adj.has(t2.id)) adj.set(t2.id, []);
        adj.get(s.id)!.push({ id: t2.id, w: e.w });
        adj.get(t2.id)!.push({ id: s.id, w: e.w });
      }
      adjRef.current = adj;
      edgesRef.current = edges;
      edgeMapRef.current = null; // 新数据 → 世界贴图重烘焙
      setData(g);
      /* v7.4 星尘分层：动态闪烁只留 60 颗（逐帧），其余 240 颗静态烘进世界贴图 */
      dustRef.current = Array.from({ length: 60 }, () => ({
        x: (Math.random() - 0.5) * WORLD.w * 1.12, y: (Math.random() - 0.5) * WORLD.h * 1.12,
        ph: Math.random() * Math.PI * 2, s: 0.6 + Math.random() * 1.1,
      }));
    }).catch(e => notify(apiErrorMessage(e), 'error'));
    return () => { simRef.current?.stop(); };
  }, [graphGen]);

  /* 打开抽屉（v4：绝密人物档案 → 403 弹管理员密码，解锁后自动补开） */
  const pendingSheet = useRef<number | null>(null);
  const tryPerson = (id: number) => {
    const n = byIdRef.current.get(id) ?? data?.nodes.find(x => x.id === id);
    if (n?.locked) { askUnlock(); return; }
    if (onOpenPerson) onOpenPerson(id);
    else openSheet(id);
  };
  const openSheet = (id: number) => {
    const n = byIdRef.current.get(id);
    if (n?.locked) { pendingSheet.current = id; askUnlock(); return; }
    api.entity(id).then(d => {
      if (d) { setSheet(d); pendingSheet.current = null; }
    }).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 403) {
        pendingSheet.current = id;
        window.dispatchEvent(new CustomEvent('mneme:locked'));
        return;
      }
      notify(apiErrorMessage(e), 'error');
    });
  };
  useEffect(() => {
    const onUnlocked = () => {
      setGraphGen(n => n + 1);
      if (pendingSheet.current != null) { const id = pendingSheet.current; pendingSheet.current = null; openSheet(id); }
    };
    window.addEventListener('mneme:unlocked', onUnlocked);
    return () => window.removeEventListener('mneme:unlocked', onUnlocked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (focusPersonId == null) return;
    openSheet(focusPersonId);
    if (byIdRef.current.has(focusPersonId)) flyToId(focusPersonId, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPersonId, data]);

  /* ---------- 渲染循环 v7.3：行星精灵 + 逐帧视口裁剪直绘（世界任意处恒可见） ----------
     旧「静态位图」只覆盖画布视口大小的世界窗口（±720×±402），旷野 60% 行星在位图之外——
     俯瞰时被硬边裁掉。改为：每颗行星预烘焙 2× 精灵（渐变本体+光晕+大行星环），
     逐帧按视图变换 drawImage + 视口裁剪；共现边同帧直绘。 */
  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let running = true;
    let idleFrames = 0;
    let lastSig = '';
    let frame = 0;
    const dpr = Math.min(devicePixelRatio || 1, 2);

    const resize = () => {
      canvas.width = wrap.clientWidth * dpr;
      canvas.height = wrap.clientHeight * dpr;
      canvas.style.width = `${wrap.clientWidth}px`;
      canvas.style.height = `${wrap.clientHeight}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    roRef.current = () => { if (!running) { running = true; raf = requestAnimationFrame(draw); } };

    /* 行星精灵：大气光晕 + 大行星环 + 渐变本体，2× 分辨率烘焙一次（数据就绪后调用） */
    const buildSprites = () => {
      const map = new Map<number, HTMLCanvasElement>();
      for (const n of nodesRef.current) {
        const R = n.r * 1.95;
        const size = Math.max(14, Math.ceil(R * 2) * 2);
        const cv = document.createElement('canvas');
        cv.width = size; cv.height = size;
        const c = cv.getContext('2d')!;
        const s = size / 2;
        c.globalAlpha = 0.16;
        c.fillStyle = n.color;
        c.beginPath(); c.arc(s, s, R, 0, Math.PI * 2); c.fill();
        c.globalAlpha = 1;
        if (n.mention >= 15) {
          c.save();
          c.translate(s, s);
          c.rotate((hash1(n.id + 31) - 0.5) * 0.9);
          c.scale(1, 0.36);
          c.strokeStyle = n.color;
          c.globalAlpha = 0.4;
          c.lineWidth = Math.max(1, n.r * 0.1);
          c.beginPath(); c.arc(0, 0, n.r * 1.62, 0, Math.PI * 2); c.stroke();
          c.restore();
          c.globalAlpha = 1;
        }
        const g = c.createRadialGradient(s - n.r * 0.38, s - n.r * 0.42, n.r * 0.12, s, s, n.r);
        g.addColorStop(0, tint(n.color, 0.55));
        g.addColorStop(0.65, n.color);
        g.addColorStop(1, n.color);
        c.fillStyle = g;
        c.beginPath(); c.arc(s, s, n.r, 0, Math.PI * 2); c.fill();
        if (n.locked) {
          c.save();
          c.strokeStyle = '#C2A46B';
          c.setLineDash([3, 2.4]);
          c.lineWidth = 1.5;
          c.beginPath(); c.arc(s, s, n.r + 2.6, 0, Math.PI * 2); c.stroke();
          c.restore();
        }
        map.set(n.id, cv);
      }
      spriteRef.current = map;
    };

    /* 世界贴图：星云 + 静态星尘 240 + 全量共现边，一次烘焙（0.75× 世界分辨率 ≈ 9MB）。
       每帧 1 次 drawImage 替代 ~1200 次 draw call——苹果流畅性原则：交互帧内最少化绘制工作量。 */
    const buildEdgeMap = () => {
      const ES = 0.75;
      const w = Math.ceil(WORLD.w * ES), h = Math.ceil(WORLD.h * ES);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const c = cv.getContext('2d')!;
      c.setTransform(ES, 0, 0, ES, w / 2, h / 2);
      for (const nb of NEBULA) {
        const g = c.createRadialGradient(nb.x, nb.y, 0, nb.x, nb.y, nb.r);
        g.addColorStop(0, nb.c + '0A');
        g.addColorStop(1, nb.c + '00');
        c.fillStyle = g;
        c.fillRect(nb.x - nb.r, nb.y - nb.r, nb.r * 2, nb.r * 2);
      }
      c.fillStyle = themeColRef.current.dust;
      c.globalAlpha = 0.5;
      for (let i = 0; i < 240; i++) {
        const x = (hash1(i * 3 + 1) - 0.5) * WORLD.w * 1.1;
        const y = (hash1(i * 7 + 3) - 0.5) * WORLD.h * 1.1;
        c.fillRect(x, y, 1.6, 1.6);
      }
      c.globalAlpha = 1;
      c.strokeStyle = themeColRef.current.edge;
      for (const e of edgesRef.current) {
        const s = e.source as GNode, tt = e.target as GNode;
        if (s.x == null || s.y == null || tt.x == null || tt.y == null) continue;
        const off = offGroupsRef.current;
        if (off.has(s.grp) || off.has(tt.grp)) continue;
        const mx = (s.x + tt.x) / 2, my = (s.y + tt.y) / 2;
        const dx = tt.x - s.x, dy = tt.y - s.y;
        const len = Math.hypot(dx, dy) || 1;
        const bow = Math.min(e.w, 9) * 3.2;
        c.globalAlpha = Math.min(0.04 + e.w * 0.016, 0.13);
        c.lineWidth = 0.7;
        c.beginPath();
        c.moveTo(s.x, s.y);
        c.quadraticCurveTo(mx - (dy / len) * bow, my + (dx / len) * bow, tt.x, tt.y);
        c.stroke();
      }
      c.globalAlpha = 1;
      edgeMapRef.current = cv;
    };

    const NEBULA = [
      { x: -WORLD.w * 0.3, y: -WORLD.h * 0.28, r: 620, c: '#C2A46B' },
      { x: WORLD.w * 0.32, y: -WORLD.h * 0.22, r: 560, c: '#8FA38A' },
      { x: -WORLD.w * 0.26, y: WORLD.h * 0.3, r: 600, c: '#6E8AA8' },
      { x: WORLD.w * 0.28, y: WORLD.h * 0.32, r: 640, c: '#A86A6A' },
    ];

    /* 名牌分级：俯瞰（k<0.5）只标星等前 26（小屏不糊成团）；中档提及≥6；放大后全部可见 */
    const labelAlphaFor = (n: GNode, k: number): number => {
      if (k >= 0.85) return 0.8;
      if (k >= 0.5) return (n.rank < 26 || n.mention >= 6) ? 0.72 : 0;
      return n.rank < 26 ? 0.66 : 0;
    };

    const draw = (t: number) => {
      if (document.hidden) { running = false; raf = 0; return; }
      const sim = simRef.current;
      const active = !!(sim && sim.alpha() > 0.015);
      if (active) sim.tick();
      if (nodesRef.current.length && spriteRef.current.size !== nodesRef.current.length) buildSprites();

      const { x: vx, y: vy, k } = viewRef.current;
      const W = canvas.width, H = canvas.height;
      const cx = W / (2 * dpr), cy = H / (2 * dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // 世界坐标变换 + 可视世界边界（裁剪用）
      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (vx + cx), dpr * (vy + cy));
      const wx0 = (-cx - vx) / k - 60, wx1 = (W / dpr - cx - vx) / k + 60;
      const wy0 = (-cy - vy) / k - 60, wy1 = (H / dpr - cy - vy) / k + 60;

      // 世界贴图：一次 drawImage（星云+静态星尘+全量共现边；懒烘焙，主题/数据变更后自动重建）
      if (!edgeMapRef.current) buildEdgeMap();
      ctx.drawImage(edgeMapRef.current!, -WORLD.w / 2, -WORLD.h / 2, WORLD.w, WORLD.h);

      // 动态星尘 60 颗（方点闪烁；其余静态星尘已烘进世界贴图）
      frame++;
      const tw = 0.05 + 0.10 * (0.5 + 0.5 * Math.sin((t + (frame % 2) * 700) / 1400));
      ctx.fillStyle = themeColRef.current.dust;
      ctx.globalAlpha = tw;
      for (const d of dustRef.current) {
        if (d.x < wx0 || d.x > wx1 || d.y < wy0 || d.y > wy1) continue;
        ctx.fillRect(d.x - d.s * 0.8, d.y - d.s * 0.8, d.s * 1.6, d.s * 1.6);
      }
      ctx.globalAlpha = 1;

      // 行星精灵：逐帧 drawImage（2× 烘焙，缩放不糊）
      const sprites = spriteRef.current;
      const off = offGroupsRef.current;
      const sid = sheetIdRef.current;
      const nbrSet = sid != null
        ? new Set<number>([sid, ...(adjRef.current.get(sid) ?? []).map(x => x.id)])
        : null;
      for (const n of nodesRef.current) {
        if (n.x == null || n.y == null) continue;
        if (off.has(n.grp)) continue;
        if (n.x < wx0 || n.x > wx1 || n.y < wy0 || n.y > wy1) continue;
        const sp = sprites.get(n.id);
        if (!sp) continue;
        const hw = sp.width / 4;
        ctx.globalAlpha = nbrSet && !nbrSet.has(n.id) ? 0.16 : 1;
        ctx.drawImage(sp, n.x - hw, n.y - hw, hw * 2, hw * 2);
      }
      ctx.globalAlpha = 1;

      // 名牌（屏幕空间常量字号，缩放不糊）；视口裁剪 + 分级显现
      const TC = themeColRef.current;
      const h = hoverRef.current;
      const pulse = pulseRef.current;
      const pulseLive = pulse && t - pulse.t0 < 1700 ? pulse : null;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = '11.5px "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const sx = (wx: number) => wx * k + vx + cx;
      const sy = (wy: number) => wy * k + vy + cy;
      for (const n of nodesRef.current) {
        if (n.x == null || n.y == null) continue;
        if (off.has(n.grp)) continue;
        const px = sx(n.x), py = sy(n.y) + (n.r + 3) * k + 2;
        if (px < -40 || px > W / dpr + 40 || py < -20 || py > H / dpr + 20) continue;
        const emphasized = (h && h.id === n.id) || (pulseLive && pulseLive.node.id === n.id) || (sid != null && n.id === sid);
        const a = emphasized ? 1 : labelAlphaFor(n, k);
        if (a <= 0) continue;
        ctx.globalAlpha = nbrSet && !nbrSet.has(n.id) ? a * 0.28 : a;
        ctx.fillStyle = emphasized ? TC.labelHi : TC.label;
        ctx.font = (emphasized || n.rank < 7)
          ? '600 11.5px "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'
          : '11.5px "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillText(n.name, px, py);
      }

      // hover 邻域高亮（动态层：只画当前星的邻接边与邻星环，不动位图）
      if (h && h.x != null && h.y != null) {
        ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (vx + cx), dpr * (vy + cy));
        const nbrs = adjRef.current.get(h.id) ?? [];
        ctx.strokeStyle = TC.edge;
        ctx.lineWidth = 1 / k;
        for (const nb of nbrs) {
          const nn = byIdRef.current.get(nb.id);
          if (!nn || nn.x == null || nn.y == null) continue;
          ctx.globalAlpha = Math.min(0.25 + nb.w * 0.03, 0.5);
          ctx.beginPath();
          ctx.moveTo(h.x, h.y);
          ctx.lineTo(nn.x, nn.y);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = nn.color;
          ctx.lineWidth = 1.2 / k;
          ctx.beginPath();
          ctx.arc(nn.x, nn.y, nn.r + 3 / k, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = TC.edge;
          ctx.lineWidth = 1 / k;
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = TC.ring;
        // 悬停行星放大重绘（动态层覆盖静态位图，球体感 + 光晕）
        const hr = h.r * 1.2;
        const hgr = h.x != null && h.y != null ? ctx.createRadialGradient(h.x - hr * 0.38, h.y - hr * 0.42, hr * 0.12, h.x, h.y, hr) : null;
        if (hgr) {
          hgr.addColorStop(0, tint(h.color, 0.6));
          hgr.addColorStop(1, h.color);
          ctx.globalAlpha = 1;
          ctx.fillStyle = h.color;
          ctx.beginPath();
          ctx.arc(h.x, h.y, h.r * 2.0, 0, Math.PI * 2);
          ctx.globalAlpha = 0.22;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.fillStyle = hgr;
          ctx.beginPath();
          ctx.arc(h.x, h.y, hr, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.lineWidth = 1.4 / k;
        ctx.beginPath();
        ctx.arc(h.x, h.y, hr + 4 / k, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 搜索/定位脉冲：抵达后扩散金环
      if (pulseLive && pulseLive.node.x != null && pulseLive.node.y != null) {
        ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (vx + cx), dpr * (vy + cy));
        const pn = pulseLive.node;
        const pnx = pn.x ?? 0, pny = pn.y ?? 0, pnr = pn.r;
        const pt = (t - pulseLive.t0) / 1700;
        ctx.globalAlpha = (1 - pt) * 0.85;
        ctx.strokeStyle = '#C7A45E';
        ctx.lineWidth = 2 / k;
        ctx.beginPath();
        ctx.arc(pnx, pny, pnr + 6 / k + pt * 26 / k, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (pulseRef.current && t - pulseRef.current.t0 >= 1700) {
        pulseRef.current = null;
      }

      /* 停绘判定：无脏（sim 收敛 + 视图/悬停/脉冲/尺寸不变）持续 ~1.2s → 停 rAF */
      const sig = `${active}|${viewRef.current.x},${viewRef.current.y},${viewRef.current.k}|${hoverRef.current?.id ?? ''}|${pulseLive ? pulseLive.node.id : ''}|${canvas.width}`;
      if (sig !== lastSig) { idleFrames = 0; lastSig = sig; }
      else if (!active && !pulseLive) idleFrames += 1;
      if (active || idleFrames < 72) {
        raf = requestAnimationFrame(draw);
      } else {
        running = false;
        raf = 0;
      }
    };
    raf = requestAnimationFrame(draw);
    const onVis = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
        raf = 0;
      } else if (!running) {
        running = true;
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      cancelAnimationFrame(raf);
      running = false;
      ro.disconnect();
      // v7.4：立即释放大位图（2880×1608 canvas 纹理等 GC 回收会造成切页长帧——主动置零即释）
      canvas.width = 0; canvas.height = 0;
      spriteRef.current.clear();
      edgeMapRef.current = null;
    };
  }, [data, theme]);

  /* 初始视野：有本机记忆则恢复，否则全景适配 */
  useEffect(() => {
    if (!data) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    let restored = false;
    try {
      const raw = sessionStorage.getItem(VIEW_KEY);
      if (raw) {
        const v = JSON.parse(raw) as View;
        if (typeof v.k === 'number' && typeof v.x === 'number' && typeof v.y === 'number') {
          viewRef.current = clampView(v);
          restored = true;
        }
      }
    } catch { /* 损坏则俯瞰 */ }
    if (!restored) viewRef.current = fitView(wrap.clientWidth, wrap.clientHeight);
    roRef.current();
  }, [data]);

  useEffect(() => {
    edgeMapRef.current = null;
    roRef.current();
  }, [offGroups, sheet?.id]);

  useEffect(() => () => saveView(), []);

  /* 滚轮缩放：原生非被动监听（React onWheel 为被动，preventDefault 无效会连带页面滚动）。
     v7.3：鼠标滚轮、触控板双指（deltaY）、触控板捏合（ctrlKey 加速）与横向滚轮统一收敛为缩放。 */
  useEffect(() => {
    const canvas = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      roRef.current();
      flyRef.current = null; // 手动操作打断飞行
      const d = e.ctrlKey ? e.deltaY * 1.8
        : (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX);
      const rect = canvas.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-d * 0.0012));
    };
    const onAuxClick = (e: MouseEvent) => { if (e.button === 1) e.preventDefault(); };
    const onMiddleDown = (e: MouseEvent) => { if (e.button === 1) e.preventDefault(); }; // 中键拖拽=平移，拦下浏览器自动滚动
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMiddleDown);
    canvas.addEventListener('auxclick', onAuxClick);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onMiddleDown);
      canvas.removeEventListener('auxclick', onAuxClick);
    };
  }, []);

  /* ---------- 交互（Pointer Events：鼠标 / 触屏 / 触控笔统一；双指捏合） ---------- */
  const toWorld = (clientX: number, clientY: number): GNode | null => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const { x: vx, y: vy, k } = viewRef.current;
    const wx = (clientX - rect.left - vx - rect.width / 2) / k;
    const wy = (clientY - rect.top - vy - rect.height / 2) / k;
    let best: GNode | null = null;
    let bd = 16 / k;
    for (const n of nodesRef.current) {
      if (n.x == null || n.y == null) continue;
      if (offGroupsRef.current.has(n.grp)) continue;
      const d = Math.hypot(n.x - wx, n.y - wy);
      if (d < Math.max(bd, n.r + 4 / k) && d < bd + n.r) { best = n; bd = d; }
    }
    return best;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    roRef.current();
    if (pointersRef.current.size === 1) {
      flyRef.current = null;
      dragRef.current = { last: { x: e.clientX, y: e.clientY }, moved: false };
    } else if (pointersRef.current.size === 2) {
      dragRef.current.last = null;
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        view: { ...viewRef.current },
      };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    roRef.current();
    if (!pointersRef.current.has(e.pointerId)) {
      // 悬停（仅鼠标形态）
      if (e.pointerType === 'mouse' && pointersRef.current.size === 0) {
        const n = toWorld(e.clientX, e.clientY);
        hoverRef.current = n;
        setHover(n);
        if (tipRef.current) {
          const rect = canvasRef.current!.getBoundingClientRect();
          tipRef.current.style.opacity = n ? '1' : '0';
          tipRef.current.style.transform = `translate(${e.clientX - rect.left + 14}px, ${e.clientY - rect.top + 10}px)`;
        }
      }
      return;
    }
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size >= 2 && pinchRef.current) {
      // 双指捏合：以两指中点为锚缩放 + 平移
      const [a, b] = [...pointersRef.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const p = pinchRef.current;
      const rect = canvasRef.current!.getBoundingClientRect();
      const k2 = Math.min(K_MAX, Math.max(K_MIN, p.view.k * (dist / p.dist)));
      const s = k2 / p.view.k;
      const anchor = { x: p.mid.x - rect.left, y: p.mid.y - rect.top };
      viewRef.current = clampView({
        k: k2,
        x: anchor.x - (anchor.x - p.view.x) * s + (mid.x - p.mid.x),
        y: anchor.y - (anchor.y - p.view.y) * s + (mid.y - p.mid.y),
      });
      dragRef.current.moved = true;
      return;
    }
    if (dragRef.current.last) {
      const dx = e.clientX - dragRef.current.last.x, dy = e.clientY - dragRef.current.last.y;
      if (Math.abs(dx) + Math.abs(dy) > 0) {
        if (Math.abs(dx) + Math.abs(dy) > 3) dragRef.current.moved = true;
        viewRef.current = clampView({ ...viewRef.current, x: viewRef.current.x + dx, y: viewRef.current.y + dy });
        dragRef.current.last = { x: e.clientX, y: e.clientY };
      }
    }
  };
  const endPointer = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) {
      dragRef.current.last = null;
      saveView();
    }
    else if (pointersRef.current.size === 1) {
      const [p] = [...pointersRef.current.values()];
      dragRef.current = { last: { x: p.x, y: p.y }, moved: true }; // 捏合余指转平移，不误触点击
    }
  };
  const onClick = (e: React.MouseEvent) => {
    if (dragRef.current.moved) { dragRef.current.moved = false; return; }
    const n = toWorld(e.clientX, e.clientY);
    if (n) tryPerson(n.id);
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const v = viewRef.current;
    const k2 = Math.min(K_MAX, v.k * 1.6);
    const s = k2 / v.k;
    animViewTo({ k: k2, x: mx - (mx - v.x) * s, y: my - (my - v.y) * s }, 300);
  };

  /* 搜索候选（姓名包含即命中；回车取第一个） */
  const qHits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s || !data) return [];
    return data.nodes.filter(n => n.name.toLowerCase().includes(s) && !offGroups.has(n.grp))
      .sort((a, b) => b.mention - a.mention).slice(0, 8);
  }, [q, data, offGroups]);
  const searchGo = (id: number) => {
    setQFocus(false);
    setQ('');
    flyToId(id, false);
    tryPerson(id);
  };

  const legend = useMemo(() => {
    if (!data) return [];
    const gs = [...new Set(data.nodes.map(n => n.grp))];
    return gs
      .sort((a, b) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99))
      .map(grp => ({ name: grp, color: GROUP_PALETTE[grp] || '#A9864A' }));
  }, [data]);

  /* 星表数据：按提及数排序，可搜索 */
  const roster = useMemo(() => {
    if (!data) return [];
    const s = listQ.trim().toLowerCase();
    return data.nodes
      .filter(n => !offGroups.has(n.grp) && (!s || n.name.toLowerCase().includes(s)))
      .sort((a, b) => b.mention - a.mention);
  }, [data, listQ, offGroups]);

  useEffect(() => { setRosterCur(0); }, [listQ, listOpen]);
  useEffect(() => {
    rosterRef.current?.querySelector('.gp-roster-item.on')?.scrollIntoView({ block: 'nearest' });
  }, [rosterCur]);

  return (
    <div className="gp" ref={wrapRef}>
      <h1 className="sr-only">人物星图</h1>
      <canvas
        ref={canvasRef}
        aria-label="人物星图画布：拖拽平移，滚轮或双指缩放，点击行星打开人物档案"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={e => {
          endPointer(e);
          hoverRef.current = null; setHover(null);
          if (tipRef.current) tipRef.current.style.opacity = '0';
        }}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
      />
      <div className="gp-tip glass" ref={tipRef} style={{ opacity: 0 }}>
        {hover && <><b>{hover.name}</b><span>{hover.locked ? '绝密档案 · 需管理员密码' : `${hover.grp} · 提及 ${hover.mention}`}</span></>}
      </div>

      {/* v7 · 人物搜索（常驻，命中即飞行定位） */}
      <div className={`gp-search glass ${qFocus && qHits.length ? 'open' : ''}`}>
        <input
          className="gp-search-q" value={q}
          onChange={e => { setQ(e.target.value); setQFocus(true); }}
          onFocus={() => setQFocus(true)}
          onBlur={() => window.setTimeout(() => setQFocus(false), 160)}
          onKeyDown={e => { if (e.key === 'Enter' && qHits[0]) searchGo(qHits[0].id); if (e.key === 'Escape') { setQ(''); (e.target as HTMLInputElement).blur(); } }}
          placeholder="寻找一颗行星…" aria-label="搜索人物姓名并定位"
        />
        {qHits.length > 0 && (
          <div className="gp-search-hits" role="listbox" aria-label="搜索候选">
            {qHits.map(n => (
              <button key={n.id} role="option" aria-selected={false}
                onPointerDown={e => e.preventDefault()} // 防止 blur 先于 click 吞掉选择
                onClick={() => searchGo(n.id)}>
                <i style={{ background: GROUP_PALETTE[n.grp] || '#A9864A' }} />
                <span>{n.name}{n.locked ? ' · 锁' : ''}</span>
                <em>{n.grp}</em>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 缩放操控（触屏友好：≥40px 热区） */}
      <div className="gp-zoom" aria-hidden={false}>
        <button aria-label="放大" title="放大" onClick={() => animViewTo({ ...viewRef.current, k: viewRef.current.k * 1.45 }, 260)}>+</button>
        <button aria-label="缩小" title="缩小" onClick={() => animViewTo({ ...viewRef.current, k: viewRef.current.k / 1.45 }, 260)}>−</button>
        <button aria-label="复位全景" title="俯瞰全景" onClick={() => { const w = wrapRef.current!; animViewTo(fitView(w.clientWidth, w.clientHeight), 420); }}>
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="8" cy="8" r="2.1" /><path d="M8 1.2v2M8 12.8v2M1.2 8h2M12.8 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M12.8 3.2l-1.4 1.4M4.6 11.4l-1.4 1.4" />
          </svg>
        </button>
      </div>

      <div className="gp-legend glass">
        {legend.map(l => (
          <button
            key={l.name}
            type="button"
            className={`gp-leg ${offGroups.has(l.name) ? 'off' : ''}`}
            aria-pressed={!offGroups.has(l.name)}
            onClick={() => {
              setOffGroups(prev => {
                const next = new Set(prev);
                if (next.has(l.name)) next.delete(l.name); else next.add(l.name);
                return next;
              });
            }}
          >
            <i style={{ background: l.color }} />{l.name}
          </button>
        ))}
        <span className="gp-legend-note">点图例显隐 · 打开档案只亮一跳邻域 · 提及/共现 ≠ 亲密</span>
        <button className="gp-roster-btn" onClick={() => setListOpen(v => !v)} aria-expanded={listOpen}>
          {listOpen ? '收起星表' : '星表'}
        </button>
      </div>

      {listOpen && (
        <div
          ref={rosterRef}
          className="gp-roster glass"
          role="dialog"
          aria-label="人物星表"
          onKeyDown={e => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            const t = e.target as HTMLElement;
            const inQ = t.tagName === 'INPUT';
            if ((e.key === 'ArrowDown' || (e.key === 'j' && !inQ))) {
              e.preventDefault();
              setRosterCur(c => Math.min(c + 1, Math.max(0, roster.length - 1)));
            } else if ((e.key === 'ArrowUp' || (e.key === 'k' && !inQ))) {
              e.preventDefault();
              setRosterCur(c => Math.max(c - 1, 0));
            } else if (e.key === 'Enter' && roster[rosterCur] && !inQ) {
              e.preventDefault();
              tryPerson(roster[rosterCur].id);
            }
          }}
        >
          <div className="gp-roster-head">
            <b>星表 · {roster.length} 位实星</b>
            <input
              className="gp-roster-q" value={listQ} onChange={e => setListQ(e.target.value)}
              placeholder="检索姓名…" aria-label="检索人物姓名"
            />
          </div>
          <p className="gp-roster-note">↑↓ 选择 · Enter 定位 · 提及次数不是亲密度</p>
          <div className="gp-roster-list" role="listbox" aria-label="人物名单">
            {roster.map((n, i) => (
              <button
                key={n.id}
                type="button"
                role="option"
                aria-selected={i === rosterCur}
                className={`gp-roster-item ${i === rosterCur ? 'on' : ''}`}
                onMouseEnter={() => setRosterCur(i)}
                onClick={() => tryPerson(n.id)}
              >
                <i style={{ background: GROUP_PALETTE[n.grp] || '#A9864A' }} />
                <span className="gp-roster-name">{n.name}{n.locked ? ' · 锁' : ''}</span>
                <span className="gp-roster-grp">{n.grp}</span>
                <em>{n.mention}</em>
              </button>
            ))}
            {roster.length === 0 && <p className="gp-roster-empty">无所检出。</p>}
          </div>
        </div>
      )}

      {sheet && (
        <aside className="gp-sheet glass">
          <button className="gp-sheet-x" onClick={() => { setSheet(null); if (focusPersonId != null) onClearFocus(); }}>×</button>
          <p className="gp-sheet-grp" style={{ color: GROUP_PALETTE[sheet.relation_group] || 'var(--bronze)' }}>
            {sheet.relation_group}{sheet.stage ? ` · ${sheet.stage}` : ''}
          </p>
          <h2>{sheet.display_name}</h2>
          <p className="gp-sheet-meta">
            提及 {sheet.mention_count} 次 · {sheet.first_year ?? '—'}–{sheet.last_year ?? '—'}
            {sheet.aliases.length > 0 && <> · 又名 {sheet.aliases.slice(0, 3).join('、')}</>}
          </p>
          {sheet.related.length > 0 && (
            <>
              <h3>同篇共现</h3>
              <div className="gp-sheet-rel">
                {sheet.related.map(r => (
                  <button key={r.id} type="button" onClick={() => { if (onOpenPerson) onOpenPerson(r.id); else openSheet(r.id); }}>{r.display_name}<em>{r.co}</em></button>
                ))}
              </div>
            </>
          )}
          {(sheet.mentionDocs?.length ?? 0) > 0 && (
            <>
              <h3>出现于</h3>
              <div className="gp-sheet-rel">
                {(sheet.mentionDocs ?? []).slice(0, 8).map(d => (
                  <button key={d.path} type="button" className="gp-ment" onClick={() => onOpenDoc(d.path)}>
                    {d.title}<em>{d.hits}</em>
                  </button>
                ))}
              </div>
            </>
          )}
          {sheet.evidence.length > 0 && (
            <>
              <h3>证据片段</h3>
              <ul className="gp-sheet-ev">
                {sheet.evidence.slice(0, 4).map((ev, i) => (
                  <li key={i}><i>{evidenceLabel(ev.kind).name}</i>{ev.snippet.slice(0, 60)}…</li>
                ))}
              </ul>
            </>
          )}
          {sheet.role_doc_path && (
            <button className="gp-sheet-doc" type="button" onClick={() => onOpenDoc(sheet.role_doc_path)}>打开自档页 →</button>
          )}
        </aside>
      )}
    </div>
  );
}
