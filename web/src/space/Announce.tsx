import { useEffect, useRef } from 'react';
import { animate, stagger } from 'animejs';
import { annihilate, prepareSnapshot } from '../annihilate';
import { canAnnihilate } from '../immersive';
import { tryPlayBgm } from '../bgm';

/**
 * 致谢公告：口令通过后、进首页前弹一次（sessionStorage mneme-anno）。
 * 关闭这一下是用户手势——默认在此时打开背景曲。
 */
const SPONSORS = [
  ['openai', 'OpenAI'], ['huawei', 'Huawei'], ['claude', 'Claude'], ['apple', 'Apple'], ['github', 'GitHub'],
  ['grok', 'Grok'], ['nvidia', 'NVIDIA'], ['doubao', '豆包'], ['huoshan', '火山方舟'], ['google', 'Google'],
];

export function Announce({ onClose }: { onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const closing = useRef(false);

  useEffect(() => {
    const el = rootRef.current;
    const card = el?.querySelector('.anno-card');
    const logos = el?.querySelectorAll('.anno-logo');
    if (!el || !card || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    animate(card, {
      opacity: [0, 1], translateY: [26, 0], scale: [0.965, 1],
      duration: 720, ease: 'outExpo',
    });
    if (logos) animate(logos, {
      opacity: [0, 1], translateY: [14, 0], scale: [0.9, 1],
      delay: stagger(55, { start: 420 }), duration: 560, ease: 'outExpo',
    });
  }, []);

  /* v5 · 空闲预采样：html2canvas 快照缓存 → 关闭时粒子零延迟就位 */
  useEffect(() => {
    const t = window.setTimeout(() => {
      const card = rootRef.current?.querySelector('.anno-card') as HTMLElement | null;
      if (card) prepareSnapshot(card);
    }, 400);
    return () => clearTimeout(t);
  }, []);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    tryPlayBgm();
    const card = rootRef.current?.querySelector('.anno-card') as HTMLElement | null;
    if (card && canAnnihilate()) annihilate(card, onClose);
    else onClose();
  };

  return (
    <div className="anno-mask" ref={rootRef} onMouseDown={close}>
      <div className="anno-card glass chrome" onMouseDown={e => e.stopPropagation()}>
        <div className="anno-glow" aria-hidden />
        <p className="greek anno-kicker">ΕΥΧΑΡΙΣΤΩ · 致谢</p>
        <h1 className="anno-title">
          感谢家人、同学、朋友们的鼎力支持，
          <br />传记将于 <b className="anno-year">2027</b> 年启动撰写，
          <br />同时感谢各企业的支持。
        </h1>
        <div className="anno-wall" aria-label="支持企业">
          {SPONSORS.map(([key, name]) => (
            <figure key={key} className="anno-logo" title={name}>
              <img src={`/sponsors/${key}.jpg`} alt={name} loading="lazy"
                onError={e => { (e.currentTarget.closest('figure') as HTMLElement | null)?.remove(); }} />
              <figcaption>{name}</figcaption>
            </figure>
          ))}
        </div>
        <button className="anno-enter" onClick={close}>
          进入 ΜΝΗΜΗ <span className="greek">→</span>
        </button>
        <p className="anno-foot">本记录为私人数字传记装置 · 仅口令可入</p>
      </div>
    </div>
  );
}
