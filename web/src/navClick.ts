/** Linear：普通左键走站内 History API；⌘/Ctrl/Shift/中键交给浏览器开新标签。 */
export function isModifiedClick(e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button: number }): boolean {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
}
