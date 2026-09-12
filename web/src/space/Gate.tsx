import { useEffect, useRef, useState } from 'react';
import { animate, stagger } from 'animejs';

import { skipHeavyFx } from '../immersive';

/**
 * Σ0 序章之门 · 一次性入场（2.4s master timeline）
 * 0.00–0.60 手册封面翻启（rotateY 展开）
 * 0.20–0.90 ΜΝΗΜΗ 希腊题字逐字母上浮（28ms stagger）
 * 0.50–1.30 副题与格言浮现
 * 1.30–2.30 化星汇聚：星尘自边缘飞向主恒星，题字退为幽灵
 * 2.30–2.40 门整体淡出 → onDone
 * 小屏 / 省流 / 减动效：立即放行，不挡首屏 LCP。
 */
const SPARKS = 36;

export function Gate({ onDone }: { onDone: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const [skipOn, setSkipOn] = useState(false);

  const lite = skipHeavyFx();
  useEffect(() => {
    if (lite) { if (!done.current) { done.current = true; onDone(); } return; }
    const root = rootRef.current;
    if (!root) return;
    const finish = () => { if (!done.current) { done.current = true; onDone(); } };
    const skipT = setTimeout(() => setSkipOn(true), 700); // 0.7s 后出现「跳过序章」
    const autoT = setTimeout(finish, 2870);

    const rect = root.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2 - 40;

    // 预布星尘：随机散布在画布边缘环带
    const sparks = Array.from(root.querySelectorAll<HTMLElement>('.spark'));
    sparks.forEach((s, i) => {
      const ang = (i / SPARKS) * Math.PI * 2 + Math.random() * 0.5;
      const rad = Math.max(cx, cy) * (0.72 + Math.random() * 0.5);
      s.style.left = `${cx + Math.cos(ang) * rad}px`;
      s.style.top = `${cy + Math.sin(ang) * rad * 0.72}px`;
    });

    const D = (ms: number) => ({ delay: ms });

    /* 0.00 手册翻启 */
    animate(root.querySelector('.gate-book')!, {
      rotateY: [-26, 0], opacity: [0, 1], scale: [0.92, 1],
      duration: 700, ease: 'outExpo',
    });
    /* 0.20 希腊题字逐字母 */
    animate(root.querySelectorAll('.g-ch'), {
      opacity: [0, 1], translateY: [30, 0], rotateZ: [5, 0],
      delay: stagger(28, { start: 200 }), duration: 720, ease: 'outExpo',
    });
    /* 0.50 分隔线 + 副题 */
    animate(root.querySelector('.gate-rule')!, { width: ['0px', '220px'], duration: 640, ...D(520), ease: 'outExpo' });
    animate(root.querySelectorAll('.gate-sub, .gate-note'), {
      opacity: [0, 1], translateY: [16, 0], delay: stagger(130, { start: 640 }), duration: 640, ease: 'outExpo',
    });
    /* 1.30 化星汇聚 */
    const t0 = 1320;
    sparks.forEach((s, i) => {
      const r = s.getBoundingClientRect();
      animate(s, {
        translateX: [0, cx - (r.left + r.width / 2)],
        translateY: [0, cy - (r.top + r.height / 2)],
        scale: [1, 0.2], opacity: [0.9, 0],
        duration: 760 + (i % 5) * 60, ...D(t0 + (i % 9) * 34), ease: 'out(3)',
      });
    });
    animate(root.querySelectorAll('.g-ch'), {
      opacity: [1, 0.16], duration: 700, ...D(t0 + 120), ease: 'outQuad',
    });
    animate(root.querySelector('.gate-star')!, {
      opacity: [0, 1], scale: [0.5, 1], duration: 900, ...D(t0 + 360), ease: 'outExpo',
    });
    /* 2.30 门淡出 */
    animate(root, { opacity: [1, 0], duration: 520, ...D(2320), ease: 'outQuad' });
    return () => { clearTimeout(skipT); clearTimeout(autoT); };
  }, [lite, onDone]);

  if (lite) return null;

  const skip = () => {
    if (rootRef.current) rootRef.current.style.opacity = '0';
    setTimeout(onDone, 100);
  };

  return (
    <div
      className="gate" ref={rootRef} role="button" tabIndex={0}
      onClick={skip}
      onKeyDown={e => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') skip(); }}
      title="点击任意处 / Esc 跳过序章"
    >
      <div className="gate-center gate-book">
        <div className="gate-greek greek" aria-label="MNEME">
          {'ΜΝΗΜΗ'.split('').map((c, i) => <span key={i} className="g-ch">{c}</span>)}
        </div>
        <div className="gate-rule" />
        <div className="gate-sub">刘佑林的前半生</div>
        <div className="gate-note">Τὸ πρῶτον ἥμισυ τοῦ βίου · 一座私人记忆的数字建筑</div>
      </div>
      <div className="gate-star" aria-hidden>
        <div className="gate-star-core" />
        <div className="gate-star-halo" />
      </div>
      {Array.from({ length: SPARKS }, (_, i) => (
        <span key={i} className="spark" aria-hidden style={{ opacity: 0.9 }} />
      ))}
      {skipOn && <button className="gate-skip" onClick={e => { e.stopPropagation(); skip(); }}>跳过序章 →</button>}
    </div>
  );
}
