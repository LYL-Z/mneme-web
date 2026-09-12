import { type Ref } from 'react';

export function FindBar({
  open, q, n, i, inputRef, onToggle, onChange, onJump, onClose,
}: {
  open: boolean;
  q: string;
  n: number;
  i: number;
  inputRef: Ref<HTMLInputElement>;
  onToggle: () => void;
  onChange: (q: string) => void;
  onJump: (dir: 1 | -1) => void;
  onClose: () => void;
}) {
  return (
    <>
      <button className={`ar-tool ${open ? 'on' : ''}`} onClick={onToggle} title="本篇查找">找</button>
      {open && (
        <span className="ar-find">
          <input
            ref={inputRef}
            className="ar-find-q"
            value={q}
            onChange={e => onChange(e.target.value)}
            placeholder="本篇查找"
            aria-label="本篇查找"
            onKeyDown={e => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === 'Enter') { e.preventDefault(); onJump(e.shiftKey ? -1 : 1); }
              if (e.key === 'Escape') { onClose(); }
            }}
          />
          <button type="button" className="ar-find-btn" aria-label="上一条" disabled={!n} onClick={() => onJump(-1)}>上</button>
          <em aria-live="polite">{n ? `第 ${i} / ${n}` : '无'}</em>
          <button type="button" className="ar-find-btn" aria-label="下一条" disabled={!n} onClick={() => onJump(1)}>下</button>
        </span>
      )}
    </>
  );
}
