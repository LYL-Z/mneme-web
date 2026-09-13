import { notify } from './toast';

function permalinkParts(opts?: { title?: string; heading?: string; snippet?: string }): { title: string; snippet: string; link: string; text: string } {
  const ar = document.querySelector('.ar') as HTMLElement | null;
  const title = opts?.title || ar?.dataset.docTitle || (document.title.endsWith(' · ΜΝΗΜΗ') ? document.title.replace(/ · ΜΝΗΜΗ$/, '') : '');
  const heading = opts?.heading || ar?.dataset.activeH || '';
  const snippetIn = opts?.snippet ?? selectionSnippet();
  const url = new URL(location.href);
  if (opts?.heading && !url.searchParams.get('h') && !url.searchParams.get('ev')) {
    url.searchParams.set('h', opts.heading);
  }
  const link = url.toString();
  const snippet = snippetIn.replace(/\s+/g, ' ').trim().slice(0, 200);
  const parts: string[] = [];
  if (title) parts.push(`《${title}》`);
  if (snippet) parts.push(`「${snippet}」`);
  parts.push(link);
  return { title, snippet, link, text: parts.join('\n') };
}

/* ---------- 剪贴板写入：三级回退链 ----------
   根因：`navigator.clipboard.writeText` 在 **iframe 或未授予 clipboard-write 权限**的上下文里
   会直接 reject（WorkBuddy 预览面板、内嵌 WebView 都是这种环境），旧实现只报「复制失败」。
   世界级处理是回退而不是报错：
     ① Clipboard API（异步、需安全上下文 + 权限）
     ② document.execCommand('copy') + 离屏 textarea（同一次用户手势内可用，iframe 里通常可行）
     ③ 仍失败 → 弹出**手动复制面板**（文本已全选，用户 Ctrl/⌘+C 即可），绝不只丢一句「失败」 */
let manualEl: HTMLElement | null = null;

function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    const sel = document.getSelection();
    const prev = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (prev && sel) { sel.removeAllRanges(); sel.addRange(prev); }
    return ok;
  } catch { return false; }
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* 权限/上下文不允许 → 走回退 */ }
  return legacyCopy(text);
}

/** 三级都失败时的兜底：把文本摊开、全选，让用户手动复制。 */
export function showManualCopy(text: string): void {
  manualEl?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'cp-manual-mask';
  wrap.innerHTML = `
    <div class="cp-manual surface" role="dialog" aria-modal="true" aria-labelledby="cp-manual-title">
      <h3 id="cp-manual-title">复制这段深链</h3>
      <p>当前环境（可能嵌在预览面板或受限 WebView 内）不允许网页直接写剪贴板。文本已选中，按 <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>C</kbd> 即可。</p>
      <textarea readonly aria-label="深链文本"></textarea>
      <div class="cp-manual-actions">
        <button type="button" class="cp-manual-retry">再试一次自动复制</button>
        <button type="button" class="cp-manual-close">关闭</button>
      </div>
    </div>`;
  const ta = wrap.querySelector('textarea') as HTMLTextAreaElement;
  ta.value = text;
  const close = () => { wrap.remove(); manualEl = null; document.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
  (wrap.querySelector('.cp-manual-close') as HTMLElement).onclick = close;
  (wrap.querySelector('.cp-manual-retry') as HTMLElement).onclick = () => {
    if (legacyCopy(text)) { close(); notify('已复制深链', 'info'); }
  };
  document.body.appendChild(wrap);
  document.addEventListener('keydown', onKey);
  manualEl = wrap;
  requestAnimationFrame(() => { ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length); });
}

/** 复制当前页深链；有选区时附标题与摘句。不写回知识库。 */
export function copyPermalink(opts?: { title?: string; heading?: string; snippet?: string }): void {
  const { snippet, text } = permalinkParts(opts);
  /* 先同步走一次 execCommand：它必须发生在用户手势的同一个任务里，
     一旦先 await Clipboard API 就可能丢失手势窗口（这正是很多站"偶发复制失败"的原因）。 */
  if (legacyCopy(text)) { notify(snippet ? '已复制摘句与深链' : '已复制本页深链', 'info'); return; }
  void writeClipboard(text).then(ok => {
    if (ok) notify(snippet ? '已复制摘句与深链' : '已复制本页深链', 'info');
    else showManualCopy(text);
  });
}

/** 凡系统能分享的壳都走分享；取消或不能则回复制。?h= 只在调用方显式给了标题锚点时附加。 */
export function shareOrCopyPermalink(opts?: { title?: string; heading?: string; snippet?: string }): void {
  const { title, snippet, link } = permalinkParts(opts);
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (nav?.share) {
    const payload: ShareData = { title: title ? `${title} · ΜΝΗΜΗ` : 'ΜΝΗΜΗ', url: link };
    if (snippet) payload.text = `「${snippet}」`;
    const can = typeof nav.canShare !== 'function' || nav.canShare(payload);
    if (can) {
      void nav.share(payload).catch((err: unknown) => {
        const name = err instanceof Error ? err.name : '';
        if (name === 'AbortError') return;
        copyPermalink(opts);
      });
      return;
    }
  }
  copyPermalink({ ...opts, title, snippet });
}

export function selectionSnippet(): string {
  const t = window.getSelection()?.toString().replace(/\s+/g, ' ').trim() ?? '';
  return t.length >= 2 && t.length <= 280 ? t : '';
}
