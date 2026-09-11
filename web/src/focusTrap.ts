import { useEffect, useRef, type RefObject } from 'react';

const SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function list(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(SELECTOR)].filter(el =>
    !el.hasAttribute('disabled') && el.getClientRects().length > 0,
  );
}

/**
 * 把 Tab 关在浮层内。Esc 可选关闭。卸层时把焦点还给打开前的控件。
 */
export function trapFocus(root: HTMLElement, onEscape?: () => void): () => void {
  const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusFirst = () => {
    const n = list(root);
    const cur = document.activeElement;
    if (n[0] && !(cur instanceof Node && root.contains(cur))) n[0].focus({ preventScroll: true });
    else if (!n.length) {
      root.tabIndex = -1;
      root.focus({ preventScroll: true });
    }
  };
  focusFirst();
  const onKey = (e: KeyboardEvent) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape' && onEscape) {
      e.preventDefault();
      e.stopPropagation();
      onEscape();
      return;
    }
    if (e.key !== 'Tab') return;
    const n = list(root);
    if (n.length === 0) { e.preventDefault(); return; }
    const i = n.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey) {
      if (i <= 0) { e.preventDefault(); n[n.length - 1].focus(); }
    } else if (i === -1 || i === n.length - 1) {
      e.preventDefault();
      n[0].focus();
    }
  };
  root.addEventListener('keydown', onKey, true);
  return () => {
    root.removeEventListener('keydown', onKey, true);
    if (prev && document.contains(prev)) prev.focus({ preventScroll: true });
  };
}

export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, onEscape?: () => void) {
  const esc = useRef(onEscape);
  esc.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    return trapFocus(el, esc.current ? () => esc.current?.() : undefined);
  }, [active, ref]);
}
