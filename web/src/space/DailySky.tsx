import { useEffect, useRef, useState } from 'react';
import { api, apiErrorMessage } from '../api';
import { notify } from '../toast';
import { getLastChapter } from '../history';
import { loadPublicCatalog, nextChapterHint, recordPerson, type PublicChapterHint } from '../silk';

/**
 * v4 · C2 每日星座：「今天的天空记住今天」。
 * 以日期为种子的确定性生成星空——同一天重访，看见同一片；星等=真实提及量，
 * 连线=真实共现边，成员=当日星群（真实实体的确定性抽样）。不伪造任何数据。
 * 生成艺术按"哲学先行"：种子确定性 → 仪式感（与记忆主题同构）。
 */
interface SkyNode { id: number; name: string; x: number; y: number; r: number; color: string; }
interface SkyEdge { a: number; b: number; w: number; }

const mulberry32 = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const hashStr = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
const hexTint = (hex: string, k: number) => {
  const v = parseInt(hex.replace('#', ''), 16);
  const r = Math.round(((v >> 16) & 255) + (255 - ((v >> 16) & 255)) * k);
  const g = Math.round(((v >> 8) & 255) + (255 - ((v >> 8) & 255)) * k);
  const b = Math.round((v & 255) + (255 - (v & 255)) * k);
  return `rgb(${r},${g},${b})`;
};

const GROUP_PALETTE: Record<string, string> = {
  '家族亲属': '#C2A46B', '师长': '#8FA38A', '同窗友人': '#6E8AA8', '其他': '#A86A6A',
};
let graphCache: Promise<{ nodes: { id: number; name: string; grp: string; mention: number }[]; edges: { s: number; t: number; w: number }[] }> | null = null;
export function clearDailySkyCache(): void { graphCache = null; }
/* v8：缓存「失败」不缓存——一次网络抖动不会让当日星图永久空白 */
const loadGraph = () => {
  if (!graphCache) {
    graphCache = api.graph().then(g => ({
      nodes: g.nodes.map(n => ({ id: n.id, name: n.name, grp: n.grp, mention: n.mention })),
      edges: g.edges.map(e => ({ s: e[0], t: e[1], w: e[2] })),
    })).catch((e: unknown) => { graphCache = null; throw e; });
  }
  return graphCache;
};

export function DailySky({ theme, onOpenPerson, onOpenChapter }: {
  theme: 'paper' | 'night';
  onOpenPerson: (id: number) => void;
  onOpenChapter?: (code: string, seq: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [today] = useState(() => new Date());
  const [hover, setHover] = useState<{ name: string; x: number; y: number } | null>(null);
  const [hint, setHint] = useState<PublicChapterHint | null>(null);
  const [gen, setGen] = useState(0);
  const [skyStat, setSkyStat] = useState<'load' | 'ok' | 'empty' | 'err'>('load');
  const skyRef = useRef<{ nodes: SkyNode[]; edges: SkyEdge[] }>({ nodes: [], edges: [] });

  useEffect(() => {
    const onUnlocked = () => { clearDailySkyCache(); setGen(n => n + 1); };
    window.addEventListener('mneme:unlocked', onUnlocked);
    return () => window.removeEventListener('mneme:unlocked', onUnlocked);
  }, []);
  useEffect(() => {
    let dead = false;
    loadPublicCatalog().then(cat => {
      if (!dead) setHint(nextChapterHint(getLastChapter(), cat));
    });
    return () => { dead = true; };
  }, [gen]);

  useEffect(() => {
    let disposed = false;
    setSkyStat('load');
    loadGraph().then(g => {
      if (disposed) return;
      if (g.nodes.length === 0) {
        skyRef.current = { nodes: [], edges: [] };
        setSkyStat('empty');
        return;
      }
      const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const rnd = mulberry32(hashStr('mneme-sky:' + dateKey));
      // 确定性抽样：种子洗牌 → 当日星群 24 颗（前 90 高提及中取，保证星座有故事）
      const pool = [...g.nodes].sort((a, b) => b.mention - a.mention).slice(0, 90);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const members = pool.slice(0, 24);
      const ids = new Set(members.map(m => m.id));
      const W = 1000, H = 420, cxm = W / 2, cym = H / 2;
      // 星位：内圈（前 8 颗=当日主星）与外圈，角度均匀 + 种子抖动
      const nodes: SkyNode[] = members.map((m, i) => {
        const inner = i < 8;
        const base = (i / members.length) * Math.PI * 2 + rnd() * 0.35;
        const rad = inner ? 120 + rnd() * 55 : 175 + rnd() * 55;
        return {
          id: m.id, name: m.name,
          x: cxm + Math.cos(base) * rad * 1.9, y: cym + Math.sin(base) * rad * 0.86,
          r: 2.4 + Math.sqrt(m.mention) * 0.85,
          color: GROUP_PALETTE[m.grp] || '#A9864A',
        };
      });
      const byId = new Map(nodes.map(n => [n.id, n]));
      const edges: SkyEdge[] = g.edges
        .filter(e => ids.has(e.s) && ids.has(e.t))
        .map(e => ({ a: e.s, b: e.t, w: e.w }));
      skyRef.current = { nodes, edges };
      setSkyStat('ok');
    }).catch(e => {
      if (disposed) return;
      skyRef.current = { nodes: [], edges: [] };
      setSkyStat('err');
      notify(apiErrorMessage(e), 'error');
    });
    return () => { disposed = true; };
  }, [today, gen]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    let raf = 0; let running = true; let idle = 0; let lastSig = ''; let frame = 0;
    const night = theme === 'night';
    const bg = night ? 'rgba(20,18,15,0)' : 'rgba(0,0,0,0)';
    void bg;
    const ink = night ? '#EDE7DA' : '#3E382E';
    const edgeC = night ? '#8A8378' : '#5B544A';

    const resize = () => {
      // CSS 锁定高度（.ds-canvas 300px）——动态回写 style.height 会与容器高度形成反馈回路
      const w = wrap.clientWidth;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.round(300 * dpr);
      canvas.style.width = '100%';
      canvas.style.height = '300px';
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const draw = (t: number) => {
      if (document.hidden || !running) { running = false; raf = 0; return; }
      raf = requestAnimationFrame(draw);
      frame++;
      const { nodes, edges } = skyRef.current;
      const byId = new Map(nodes.map(n => [n.id, n]));
      const W = canvas.width / dpr, H = canvas.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (nodes.length === 0) return;
      const sx = W / 1000, sy = H / 420;
      const X = (wx: number) => wx * sx, Y = (wy: number) => wy * sy;

      // 背景微星（确定性 46 颗）
      const rnd = mulberry32(hashStr(String(today.toDateString()) + ':bg'));
      ctx.fillStyle = ink;
      for (let i = 0; i < 46; i++) {
        const a = 0.10 + 0.16 * (0.5 + 0.5 * Math.sin((t + i * 640) / 1500));
        ctx.globalAlpha = a;
        ctx.fillRect(rnd() * W, rnd() * H, 1.3, 1.3);
      }
      // 连线（真实共现边）
      ctx.strokeStyle = edgeC;
      for (const e of edges) {
        const a = byId.get(e.a), b = byId.get(e.b);
        if (!a || !b) continue;
        ctx.globalAlpha = Math.min(0.05 + e.w * 0.02, 0.2);
        ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y)); ctx.stroke();
      }
      // 星体（微闪烁）
      for (const n of nodes) {
        const tw = 0.82 + 0.18 * Math.sin((t + n.id * 730) / 1200);
        ctx.globalAlpha = 0.15 * tw;
        ctx.fillStyle = n.color;
        ctx.beginPath(); ctx.arc(X(n.x), Y(n.y), n.r * 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = tw;
        const g = ctx.createRadialGradient(X(n.x) - n.r * 0.3, Y(n.y) - n.r * 0.35, n.r * 0.1, X(n.x), Y(n.y), n.r);
        g.addColorStop(0, hexTint(n.color, 0.55));
        g.addColorStop(1, n.color);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(X(n.x), Y(n.y), n.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      // 停帧：纯动画星云无交互脏时 90 帧后休眠（动画相位不参与 sig——常驻微闪也省电）
      const sig = `${canvas.width}|${skyRef.current.nodes.length}`;
      if (sig === lastSig && ++idle > 90) { running = false; cancelAnimationFrame(raf); }
      else if (sig !== lastSig) { idle = 0; lastSig = sig; }
    };
    raf = requestAnimationFrame(draw);
    const wake = () => { if (!running) { running = true; raf = requestAnimationFrame(draw); } };
    wrap.addEventListener('pointermove', wake, { passive: true });
    wrap.addEventListener('pointerleave', wake);
    const onVis = () => { if (document.hidden) { running = false; cancelAnimationFrame(raf); raf = 0; } else wake(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      cancelAnimationFrame(raf); running = false; ro.disconnect(); canvas.width = 0; canvas.height = 0;
      wrap.removeEventListener('pointermove', wake);
      wrap.removeEventListener('pointerleave', wake);
    };
  }, [theme, today, gen]);

  const pick = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const mx = (e.clientX - r.left) / (r.width / 1000), my = (e.clientY - r.top) / (r.height / 420);
    let best: SkyNode | null = null; let bd = 14;
    for (const n of skyRef.current.nodes) {
      const d = Math.hypot(n.x - mx, n.y - my);
      if (d < Math.max(10, n.r + 6) && d < bd) { bd = d; best = n; }
    }
    setHover(best ? { name: best.name, x: e.clientX - r.left, y: e.clientY - r.top } : null);
  };
  const click = () => {
    if (!hover) return;
    const n = skyRef.current.nodes.find(x => x.name === hover.name);
    if (n) { recordPerson({ id: n.id, name: n.name }); onOpenPerson(n.id); }
  };

  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return (
    <div className="ds surface" ref={wrapRef}>
      <header className="ds-head">
        <p className="greek ds-kicker">ΩΡΑΣΚΟΠΙΟΝ · 今日星座</p>
        <h2>{today.getFullYear()} 年 {mm} 月 {dd} 日 的天空</h2>
        <p className="ds-sub">以今天为种子生成的星座——同一天重访，看见同一片。星等=真实提及量，连线=真实共现。</p>
        {hint && onOpenChapter && (
          <button type="button" className="ds-next" onClick={() => onOpenChapter(hint.code, hint.seq)}>
            按昨天停的地方往下翻 · {hint.volume} · {hint.title}
          </button>
        )}
      </header>
      <canvas
        ref={canvasRef}
        className="ds-canvas"
        onPointerMove={pick}
        onPointerLeave={() => setHover(null)}
        onClick={click}
        style={{ cursor: hover ? 'pointer' : 'default' }}
      />
      {skyStat !== 'ok' && (
        <div className="ds-empty" role="status">
          {skyStat === 'load' && <p>正在展开今日星座…</p>}
          {skyStat === 'empty' && <p>今日星群还没有可画的星。</p>}
          {skyStat === 'err' && (
            <>
              <p>星座没能取回——档案服务暂时连不上。</p>
              <button type="button" className="ds-retry" onClick={() => { clearDailySkyCache(); setGen(n => n + 1); }}>再取一次</button>
            </>
          )}
        </div>
      )}
      {hover && (
        <div className="ds-tip surface" style={{ left: hover.x + 12, top: hover.y - 30 }}>
          {hover.name}
        </div>
      )}
    </div>
  );
}
