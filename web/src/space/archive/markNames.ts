/**
 * 正文人名点选。收集文本节点后分片处理，避免一次走完整棵树卡住 INP。
 */

type Person = { id: number; display_name: string; locked?: boolean };

function wrapOne(node: Text, list: Person[]) {
  const text = node.textContent || '';
  if (!text.trim()) return;
  const hit = list.find(p => text.includes(p.display_name));
  if (!hit) return;
  const i = text.indexOf(hit.display_name);
  const frag = document.createDocumentFragment();
  if (i > 0) frag.append(text.slice(0, i));
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `ar-pname${hit.locked ? ' locked' : ''}`;
  btn.dataset.pid = String(hit.id);
  if (hit.locked) btn.dataset.locked = '1';
  btn.textContent = hit.display_name;
  frag.append(btn);
  const rest = i + hit.display_name.length < text.length ? text.slice(i + hit.display_name.length) : '';
  if (rest) frag.append(rest);
  node.parentNode?.replaceChild(frag, node);
}

export function wrapPersonNames(
  root: HTMLElement,
  persons: Person[],
): () => void {
  const list = persons
    .filter(p => p.display_name && p.display_name.length >= 2)
    .sort((a, b) => b.display_name.length - a.display_name.length)
    .slice(0, 24);
  if (!list.length) return () => {};

  const skip = new Set(['A', 'BUTTON', 'CODE', 'PRE', 'SCRIPT', 'TEXTAREA', 'MARK']);
  const nodes: Text[] = [];
  const collect = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (skip.has(el.tagName) || el.classList.contains('ar-pname') || el.classList.contains('h-copy')) return;
      node.childNodes.forEach(collect);
      return;
    }
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) nodes.push(node as Text);
  };
  collect(root);

  let i = 0;
  let cancelled = false;
  let handle = 0;
  const CHUNK = 6;

  const step = (deadline?: IdleDeadline) => {
    if (cancelled) return;
    let n = 0;
    const hasTime = () => !deadline || deadline.timeRemaining() > 6;
    while (i < nodes.length && n < CHUNK && hasTime()) {
      const node = nodes[i];
      i += 1;
      n += 1;
      if (node.parentNode) wrapOne(node, list);
    }
    if (i < nodes.length) {
      if (typeof requestIdleCallback === 'function') handle = requestIdleCallback(step);
      else handle = window.setTimeout(() => step(), 16);
    }
  };

  if (typeof requestIdleCallback === 'function') handle = requestIdleCallback(step);
  else handle = window.setTimeout(() => step(), 0);

  return () => {
    cancelled = true;
    if (typeof cancelIdleCallback === 'function') cancelIdleCallback(handle);
    else window.clearTimeout(handle);
  };
}
