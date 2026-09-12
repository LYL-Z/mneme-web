import { notify } from './toast';

function permalinkParts(opts?: { title?: string; heading?: string; snippet?: string }): { title: string; snippet: string; link: string; text: string } {
  const ar = document.querySelector('.ar') as HTMLElement | null;
  const title = opts?.title || ar?.dataset.docTitle || (document.title.endsWith(' · ΜΝΗΜΗ') ? document.title.replace(/ · ΜΝΗΜΗ$/, '') : '');
  const heading = opts?.heading || ar?.dataset.activeH || '';
  const snippetIn = opts?.snippet ?? selectionSnippet();
  const url = new URL(location.href);
  if (heading && !url.searchParams.get('h') && !url.searchParams.get('ev')) {
    url.searchParams.set('h', heading);
  }
  const link = url.toString();
  const snippet = snippetIn.replace(/\s+/g, ' ').trim().slice(0, 200);
  const parts: string[] = [];
  if (title) parts.push(`《${title}》`);
  if (snippet) parts.push(`「${snippet}」`);
  parts.push(link);
  return { title, snippet, link, text: parts.join('\n') };
}

/** 复制当前页深链；有选区时附标题与摘句。不写回知识库。 */
export function copyPermalink(opts?: { title?: string; heading?: string; snippet?: string }): void {
  const { snippet, text } = permalinkParts(opts);
  const ok = () => notify(snippet ? '已复制摘句与深链' : '已复制本页深链', 'info');
  const fail = () => notify('复制失败', 'warn');
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(ok).catch(fail);
  else fail();
}

/** 手机走系统分享；桌面或取消分享则回复制。 */
export function shareOrCopyPermalink(opts?: { title?: string; heading?: string; snippet?: string }): void {
  const { title, snippet, link, text } = permalinkParts(opts);
  const phone = typeof document !== 'undefined' && document.documentElement.dataset.shell === 'phone';
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (phone && nav?.share) {
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
