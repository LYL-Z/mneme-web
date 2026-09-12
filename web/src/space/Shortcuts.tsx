import { useRef } from 'react';
import type { SpaceKey } from '../route';
import { useFocusTrap } from '../focusTrap';

export type GoChord =
  | { t: 'space'; key: SpaceKey; name: string }
  | { t: 'foreshadow'; name: string };

/** Linear 风：先按 g，再按字母跳转。h/s 都回门厅。 */
export const G_THEN: Record<string, GoChord> = {
  a: { t: 'space', key: 'archive', name: '原文档案馆' },
  h: { t: 'space', key: 'stars', name: '记忆恒星' },
  s: { t: 'space', key: 'stars', name: '记忆恒星' },
  r: { t: 'space', key: 'river', name: '时间之河' },
  p: { t: 'space', key: 'graph', name: '人物星图' },
  t: { t: 'space', key: 'themes', name: '主题域' },
  v: { t: 'space', key: 'voices', name: '他者之声' },
  y: { t: 'space', key: 'study', name: '书房' },
  m: { t: 'space', key: 'museum', name: '意象博物馆' },
  l: { t: 'space', key: 'lighthouse', name: '证据灯塔' },
  f: { t: 'foreshadow', name: '伏应矩阵' },
};

const ROWS: { keys: string; name: string }[] = [
  { keys: 'g a', name: '原文档案馆' },
  { keys: 'g h / g s', name: '记忆恒星' },
  { keys: 'g r', name: '时间之河' },
  { keys: 'g p', name: '人物星图' },
  { keys: 'g t', name: '主题域' },
  { keys: 'g v', name: '他者之声' },
  { keys: 'g y', name: '书房' },
  { keys: 'g m', name: '意象博物馆' },
  { keys: 'g l', name: '证据灯塔' },
  { keys: 'g f', name: '伏应矩阵' },
  { keys: '/', name: '检索全库' },
  { keys: '⌘K', name: '检索全库' },
  { keys: '?', name: '本面板' },
  { keys: 'Esc', name: '关闭浮层；写作台未写回则先确认' },
  { keys: 'j', name: '向下滚动' },
  { keys: 'k', name: '向上滚动' },
  { keys: '← / →', name: '书房八扇门 · 左 / 右' },
  { keys: '↑ / ↓', name: '书房目录 · 上一行 / 下一行' },
  { keys: '[ / ]', name: '章节链上一题 / 下一题；原文则走邻篇' },
  { keys: 'f / ⌘F', name: '本篇查找（原文）' },
  { keys: '← / →', name: '放大图上一张 / 下一张' },
  { keys: 'n / N', name: '下一处 / 上一处检索标' },
  { keys: 'c', name: '复制深链（有选区则带摘句）' },
  { keys: 't / i / d / a', name: '原文：目录 / 检查器 / 对照 / Aa' },
  { keys: 'e', name: '编辑本篇' },
  { keys: '⌘S', name: '写作台写回知识库' },
  { keys: 'Tab', name: '写作台缩进' },
  { keys: '⌘Enter', name: '写作台插入代写稿' },
];

export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  useFocusTrap(boxRef, open, onClose);
  if (!open) return null;
  return (
    <div className="ck-mask" onMouseDown={onClose} role="presentation">
      <div ref={boxRef} className="sk glass" onMouseDown={e => e.stopPropagation()} role="dialog" aria-labelledby="sk-title" aria-modal="true">
        <p className="greek sk-kicker">ΠΛΗΚΤΡΑ</p>
        <h1 id="sk-title">键盘</h1>
        <button type="button" className="gp-sheet-x sk-x" onClick={onClose} aria-label="关闭">×</button>
        <div className="sk-grid">
          {ROWS.map(r => (
            <p key={r.keys} className="sk-row"><kbd>{r.keys}</kbd><span>{r.name}</span></p>
          ))}
        </div>
        <p className="sk-foot">输入框内不响应跳转。g 后一秒内按第二键。</p>
      </div>
    </div>
  );
}
