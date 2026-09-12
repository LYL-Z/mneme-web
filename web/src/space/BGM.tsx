import { useEffect, useState } from 'react';
import { annoClosed, bgmGet, bgmSet, bgmSub, retryBgm, type BgmState } from '../bgm';

/** 右下角背景曲控件。真正的 Audio 在 bgm.ts，这里只负责开关和音量。 */
export function BGM({ visible = true }: { visible?: boolean }) {
  const [s, setS] = useState<BgmState>(bgmGet);
  const [open, setOpen] = useState(false);

  useEffect(() => bgmSub(setS), []);

  useEffect(() => {
    if (!s.on || !annoClosed()) return;
    let last = 0;
    const kick = () => {
      const now = Date.now();
      if (now - last < 800) return;
      last = now;
      retryBgm();
    };
    window.addEventListener('pointerdown', kick, { passive: true });
    window.addEventListener('keydown', kick, { passive: true });
    document.addEventListener('visibilitychange', kick);
    const t = window.setInterval(kick, 4000);
    return () => {
      window.removeEventListener('pointerdown', kick);
      window.removeEventListener('keydown', kick);
      document.removeEventListener('visibilitychange', kick);
      window.clearInterval(t);
    };
  }, [s.on]);

  const toggle = () => {
    if (s.on) bgmSet({ on: false });
    else bgmSet({ on: true, vol: s.vol || 0.3 });
  };

  const playing = s.on && annoClosed();

  return (
    <div
      className={`bgm glass chrome ${playing ? 'on' : ''} ${open ? 'open' : ''}`}
      hidden={!visible}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        className="bgm-btn"
        onClick={toggle}
        aria-label={playing ? '暂停背景音乐' : '播放背景音乐'}
        title={playing ? '暂停背景曲' : '播放背景曲'}
      >
        {playing ? (
          <span className="bgm-eq" aria-hidden><i /><i /><i /></span>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <path d="M11.5 1.2 4.6 2.6v6.9a2.1 2.1 0 1 0 1.2 1.9V5l4.5-.9v3.6a2.1 2.1 0 1 0 1.2 1.9z" fill="currentColor" />
          </svg>
        )}
      </button>
      <input
        className="bgm-vol"
        type="range" min={0} max={1} step={0.01} value={s.vol}
        onChange={e => bgmSet({ vol: +e.target.value })}
        aria-label="背景音乐音量"
        style={{ '--vol': `${Math.round(s.vol * 100)}%` } as React.CSSProperties}
      />
    </div>
  );
}
