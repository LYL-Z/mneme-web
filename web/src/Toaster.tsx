/**
 * ΜΝΗΜΗ · 全局轻提示容器（挂在 App 根部，见 main.tsx / App.tsx）
 */
import { useEffect, useState } from 'react';
import { dismiss, subscribeToasts, type ToastItem } from './toast';

const ICON: Record<ToastItem['kind'], string> = { info: '·', warn: '!', error: '×' };

export default function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setItems), []);

  if (!items.length) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map(t => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <i className="toast-icon" aria-hidden="true">{ICON[t.kind]}</i>
          <span className="toast-msg">{t.msg}</span>
          <button type="button" className="toast-close" aria-label="关闭提示" onClick={() => dismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
