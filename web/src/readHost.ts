/**
 * 分栏或写作台打开时，正文在 `.ar-pane` 里滚；
 * 否则 `.space-host` 才是滚动容器。进度条、目录侦听、剩余时间、j/k 共用这里。
 */
export function readScroller(): HTMLElement | null {
  const pane = document.querySelector('.ar.is-split .ar-pane:not(.sec)') as HTMLElement | null;
  if (pane && pane.scrollHeight > pane.clientHeight + 4) return pane;
  return document.querySelector('.space-host') as HTMLElement | null;
}

export function emitLayout() {
  window.dispatchEvent(new CustomEvent('mneme:layout'));
}
