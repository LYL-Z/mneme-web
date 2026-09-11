/**
 * 学段 → 年份区间：River（Σ2 时间长河）的学段色带与 Archive 检查器的「学段」互链
 * 共用同一张表。此前该表只写在 River.tsx 内部，检查器要跳转学段就得再抄一份
 * （改一处忘一处）；现在收敛到这里，双方 import 同一个事实来源。
 */
export const YEAR_MIN = 1990;
export const YEAR_MAX = 2032;

export const STAGE_EPOCH: { from: number; to: number; stage: string }[] = [
  { from: YEAR_MIN, to: 2006, stage: '诞生前' },
  { from: 2007, to: 2012, stage: '学龄前' },
  { from: 2013, to: 2018, stage: '小学' },
  { from: 2019, to: 2021, stage: '初中' },
  { from: 2022, to: 2024, stage: '高中' },
  { from: 2025, to: YEAR_MAX, stage: '大学' },
];

/** 学段 → 该区间中点年份（用于把「学段」互链定位到时间长河的对应刻度）。
 *  表内没有的学段（如「跨学段」「家庭」）返回 null —— 调用方应降级为纯标签、不做跳转。 */
export const stageAnchorYear = (stage: string): number | null => {
  const e = STAGE_EPOCH.find(x => x.stage === String(stage || '').trim());
  return e ? Math.round((e.from + e.to) / 2) : null;
};
