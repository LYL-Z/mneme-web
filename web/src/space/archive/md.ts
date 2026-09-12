import MarkdownIt from 'markdown-it';
import { headingSlug } from '../../api';

export const md = new MarkdownIt({ html: true, linkify: false, breaks: true });

export const escHtml = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));

/** [[目标|别名]] / [[目标]] → 真实内链（/doc/…，事件委托接管点击） */
export const renderWiki = (src: string) =>
  src.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, t: string, l?: string) => {
    const target = t.trim();
    const label = (l || target).trim();
    return `<a class="wl" href="/doc/${encodeURIComponent(target)}" data-wl="${escHtml(target)}" title="${escHtml(target)}">${escHtml(label)}</a>`;
  });

/** 工作区已有文题 h1。正文标题整体 +1，避免 h1 叠 h1、h1 后直接 h3。 */
const bumpHeading = (tag: string) => {
  const n = Number(tag.slice(1));
  return Number.isFinite(n) && n >= 1 && n < 6 ? `h${n + 1}` : tag;
};
{
  const open = md.renderer.rules.heading_open;
  const close = md.renderer.rules.heading_close;
  md.renderer.rules.heading_open = (tokens, idx, opts, env, self) => {
    tokens[idx].tag = bumpHeading(tokens[idx].tag);
    const text = tokens[idx + 1]?.type === 'inline' ? tokens[idx + 1].content : '';
    const base = headingSlug(text);
    const e = (env ?? {}) as { used?: Map<string, number> };
    const used = (e.used ??= new Map<string, number>());
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    tokens[idx].attrSet('id', n === 0 ? base : `${base}-${n}`);
    return open ? open(tokens, idx, opts, env, self) : self.renderToken(tokens, idx, opts);
  };
  md.renderer.rules.heading_close = (tokens, idx, opts, env, self) => {
    tokens[idx].tag = bumpHeading(tokens[idx].tag);
    return close ? close(tokens, idx, opts, env, self) : self.renderToken(tokens, idx, opts);
  };
}

const DANGEROUS_TAGS = 'script,style,iframe,object,embed,base,form,link,meta,svg,math,video,audio,textarea,input';
export function sanitizeInto(target: HTMLElement, html: string) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelectorAll(DANGEROUS_TAGS).forEach(n => n.remove());
  tpl.content.querySelectorAll('*').forEach(el => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.replace(/[\s]/g, '').toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc') el.removeAttribute(attr.name);
      else if (name.startsWith('data-') && name !== 'data-wl') el.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'src' || name === 'xlink:href' || name === 'srcset')
        && /^(javascript|vbscript|data:text\/html)/.test(value)) {
        el.removeAttribute(attr.name);
      }
    }
  });
  target.replaceChildren(...tpl.content.childNodes);
}
