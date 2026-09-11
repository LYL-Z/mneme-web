import { useEffect, useRef, useState } from 'react';
import { bgmGet, bgmSet, bgmSub, type BgmState } from '../bgm';

/**
 * v5.1 · 背景曲控件（右下角液态玻璃；与偏好面板共用 bgm store）
 *
 * 行为约定：
 *  - 关闭致谢弹窗（用户手势）后立即自动开启，此后持续保持；
 *  - 文件 404 / 解码失败立即停播，避免 4 秒一轮空转；
 *  - 只有用户显式点击暂停按钮才停（成功加载之后）。
 * 性能：preload=none 首屏零流量，首次播放时才加载。
 */
export function BGM() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const failedRef = useRef(false);
  const [s, setS] = useState<BgmState>(bgmGet);
  const [open, setOpen] = useState(false);

  useEffect(() => bgmSub(setS), []);

  /* 状态 → 音频（唯一控制点；失败只静默重试，绝不自动关闭） */
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.volume = s.vol;
    if (!s.on) { a.pause(); return; }
    a.play().catch(() => { /* 保持 on，交给守护重试 */ });
  }, [s]);

  /* 守护重试：只要 on=true 而音频未在播，交互/可见性/定时点补播（不打扰、不关闭） */
  useEffect(() => {
    if (!s.on) return;
    let last = 0;
    const kick = () => {
      if (failedRef.current) return;
      const now = Date.now();
      if (now - last < 800) return;
      last = now;
      const a = audioRef.current;
      if (a && a.paused) a.play().catch(() => {});
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
    if (s.on) { bgmSet({ on: false }); audioRef.current?.pause(); return; }
    bgmSet({ on: true, vol: s.vol || 0.3 });
    audioRef.current?.play().catch(() => { /* 保持 on，守护重试接管 */ });
  };

  const playing = s.on;

  return (
    <div
      className={`bgm glass ${playing ? 'on' : ''} ${open ? 'open' : ''}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <audio
        ref={audioRef}
        src="/audio/bgm.mp3"
        loop
        preload="none"
        onError={() => { failedRef.current = true; bgmSet({ on: false }); }}
      />
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
        onChange={e => bgmSet({ vol: +e.target.value, on: true })}
        aria-label="背景音乐音量"
        style={{ '--vol': `${Math.round(s.vol * 100)}%` } as React.CSSProperties}
      />
    </div>
  );
}
