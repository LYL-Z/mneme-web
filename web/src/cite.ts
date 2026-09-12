import { notify } from './toast';

/** 复制当前页深链；有选区时附标题与摘句。不写回知识库。 */
export function copyPermalink(opts?: { title?: string; heading?: string; snippet?: string }): void {
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
  const text = parts.join('\n');
  const ok = () => notify(snippet ? '已复制摘句与深链' : '已复制本页深链', 'info');
  const fail = () => notify('复制失败', 'warn');
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(ok).catch(fail);
  else fail();
}

export function selectionSnippet(): string {
  const t = window.getSelection()?.toString().replace(/\s+/g, ' ').trim() ?? '';
  return t.length >= 2 && t.length <= 280 ? t : '';
}
