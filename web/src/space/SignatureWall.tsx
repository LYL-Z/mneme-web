import { useEffect, useRef, useState } from 'react';

/**
 * Σ1 · 签名墙（v6.3 提取管线 + v4 两翼分层布局）：
 * - 提取：global（纯色底四角采样全局阈值）/ flat（匀光后同款阈值）两种管线，白 alpha 蒙版交 CSS 上色。
 * - 布局：两翼分层确定性排布——同翼纵向分层（间隙 ≥6 单位）、跨翼横向隔离，
 *   逐对验证 bbox 零相交（含旋转膨胀余量）：保证九幅完整清晰、永不重叠、不被遮挡。
 */
interface SigSpec { src: string; x: number; y: number; w: number; hr: number; rot: number; o: number; mode?: 'global' | 'flat'; dead?: number; soft?: number }
/* v4 布局：九幅分散于记忆恒星整页的无卡片空白带（hero 两侧 + 轨道两侧，高约 1036px）——
   每幅层距 ≥200px 疏朗不拥挤；左右两翼 x 互不越界（左 ≤31、右 ≥63，避开中心文字/轨道），
   逐对 bbox 零相交（含旋转膨胀）。坐标为设计空间：容器宽 100 × 带高 102 单位（等比渲染）。 */
const SIGS: SigSpec[] = [
  // 左翼（x 3–11，右缘 ≤29；全部收在工作台上缘 74.6 单位之上）
  { src: '/signatures/807d78.jpg', x: 4, y: 11, w: 19, hr: 0.42, rot: -5, o: 0.5 },    // 白底蓝花体 2008
  { src: '/signatures/bdd283.jpg', x: 11, y: 28, w: 18, hr: 0.89, rot: -2.5, o: 0.4, mode: 'flat', dead: 30, soft: 55 }, // 爸爸 · 活在当下
  { src: '/signatures/2884ff.jpg', x: 4, y: 45, w: 19, hr: 0.68, rot: -3, o: 0.4 },   // 白底重墨
  { src: '/signatures/b8142e.jpg', x: 10, y: 61, w: 19, hr: 0.61, rot: 3, o: 0.34, dead: 30, soft: 55 }, // 便签花体（有横线底纹）
  // 右翼（x 64–79，全部收在工作台上缘之上）
  { src: '/signatures/tobe.jpg', x: 64, y: 9, w: 22, hr: 0.42, rot: -2.4, o: 0.34 }, // To be the Best（白底）
  { src: '/signatures/e8c77a.jpg', x: 76, y: 22, w: 16, hr: 0.54, rot: 4, o: 0.3, dead: 34, soft: 52 },  // 照片底蓝花体（v6 全局阈值原样）
  { src: '/signatures/cc09c7.jpg', x: 72, y: 34, w: 19, hr: 0.46, rot: 2, o: 0.5 },   // 黑底白线
  { src: '/signatures/01a663.jpg', x: 77, y: 46, w: 15, hr: 0.89, rot: 5, o: 0.34, dead: 30, soft: 55 }, // JL 花体（v6 全局阈值原样）
  { src: '/signatures/36a3d6.jpg', x: 71, y: 62, w: 17, hr: 0.76, rot: 3, o: 0.36, mode: 'flat', dead: 30, soft: 55 }, // 妈妈 · 自然而然过好每一天
];
const WALL_W = 100, WALL_H = 102; // 签名带设计空间（正方形单位：aspect-ratio 100/102 等比渲染）

/** 亮度阈值提取：global=四角采样底色；flat=匀光（÷局部背景）后同款全局阈值 → 白色形状（颜色交 CSS） */
function extractSignature(img: HTMLImageElement, mode: 'global' | 'flat', dead = 16, soft = 64): string | null {
  try {
    const maxW = 620;
    const s = Math.min(1, maxW / (img.naturalWidth || maxW));
    const w = Math.max(1, Math.round((img.naturalWidth || maxW) * s));
    const h = Math.max(1, Math.round((img.naturalHeight || 200) * s));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    const px = imgData.data;
    const lum = (i: number) => 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    let bgLum = 235;
    let bgPx: Uint8ClampedArray | null = null;
    if (mode === 'flat') {
      // 匀光底：1/12 降采样 → 双线性放大（慢变光影的等高线图）
      const bw = Math.max(2, Math.round(w / 12)), bh = Math.max(2, Math.round(h / 12));
      const small = document.createElement('canvas');
      small.width = bw; small.height = bh;
      small.getContext('2d')!.drawImage(img, 0, 0, bw, bh);
      const bgcv = document.createElement('canvas');
      bgcv.width = w; bgcv.height = h;
      const bctx = bgcv.getContext('2d')!;
      bctx.imageSmoothingEnabled = true;
      bctx.imageSmoothingQuality = 'high';
      bctx.drawImage(small, 0, 0, w, h);
      bgPx = bctx.getImageData(0, 0, w, h).data;
    } else {
      let bg = 0, n = 0;
      const sample = (x0: number, y0: number) => {
        for (let y = y0; y < Math.min(h, y0 + 12); y++)
          for (let x = x0; x < Math.min(w, x0 + 12); x++) { bg += lum((y * w + x) * 4); n++; }
      };
      sample(0, 0); sample(Math.max(0, w - 12), 0); sample(0, Math.max(0, h - 12)); sample(Math.max(0, w - 12), Math.max(0, h - 12));
      bgLum = n ? bg / n : 235;
    }
    const bgL = (i: number) => 0.299 * bgPx![i] + 0.587 * bgPx![i + 1] + 0.114 * bgPx![i + 2];
    for (let i = 0; i < px.length; i += 4) {
      const d = bgPx
        ? (1 - Math.min(1, lum(i) / Math.max(24, bgL(i)))) * 255 // 匀光比值差：光影压平、墨迹保持
        : Math.abs(lum(i) - bgLum);
      const a = Math.max(0, Math.min(1, (d - dead) / soft));
      px[i] = 255; px[i + 1] = 255; px[i + 2] = 255;
      px[i + 3] = Math.round(a * 255);
    }
    ctx.putImageData(imgData, 0, 0);
    return cv.toDataURL('image/png');
  } catch { return null; }
}

export function SignatureWall() {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let alive = true;
    const run = async () => {
      const out: Record<string, string> = {};
      for (const spec of SIGS) {
        if (!alive) return;
        try {
          const img = new Image();
          img.src = spec.src;
          await img.decode();
          const u = extractSignature(img, spec.mode ?? 'global', spec.dead, spec.soft);
          if (u && alive) {
            out[spec.src] = u;
            setUrls(prev => ({ ...prev, [spec.src]: u })); // 逐张就位逐张显现
          }
        } catch { /* 单张失败不影响其余 */ }
      }
    };
    run();
    return () => { alive = false; };
  }, []);

  return (
    <div className="sigwall" aria-hidden>
      {SIGS.map(s => urls[s.src] ? (
        <img loading="lazy" decoding="async"
          key={s.src}
          className="sig"
          src={urls[s.src]}
          alt=""
          style={{
            left: `${s.x}%`,
            top: `${(s.y / WALL_H * 100).toFixed(2)}%`,
            width: `${s.w}%`,
            opacity: s.o,
            ['--rot' as string]: `${s.rot}deg`,
          }}
        />
      ) : null)}
    </div>
  );
}
