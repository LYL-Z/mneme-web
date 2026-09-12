import { annihilate, prepareSnapshot } from './annihilate';
import { canAnnihilate } from './immersive';

/** 弹窗关闭：有档位就走粒子消散，否则立刻卸。 */
export function dismissGlass(el: HTMLElement | null, done: () => void): void {
  if (el && canAnnihilate()) {
    annihilate(el, done);
    return;
  }
  done();
}

/** 打开后预采样，关闭时粒子零等待。 */
export function armSnapshot(el: HTMLElement | null): void {
  if (el && canAnnihilate()) prepareSnapshot(el);
}
