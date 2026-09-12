/** 打开绝密档案门（管理员密码）。私密层仍不可枚举。 */
export function askUnlock(): void {
  window.dispatchEvent(new CustomEvent('mneme:locked'));
}
