/**
 * ΜΝΗΜΗ · 证据分级标签（唯一事实来源）
 *
 * 原先 Σ9 证据灯塔有一张中文映射表，Σ7 原文档案馆的「证据片段」检查器却直接渲染
 * 数据库里的英文 kind（pendingCollect / inferred …）——同一份数据两处两种语言。
 * 现在两处共用本模块。
 */
export interface KindLabel { name: string; desc: string }

export const EVIDENCE_KIND: Record<string, KindLabel> = {
  pendingCollect: { name: '待采', desc: '已发现线索，素材尚未归档' },
  conflict: { name: '冲突', desc: '多源口径不一致，登记待裁' },
  inferred: { name: '推断', desc: '由线索合理推出，保留【推断】标' },
  pending: { name: '待核', desc: '存在但未与原件核对' },
  confirmed: { name: '确证', desc: '用户确证或原件核对通过' },
  literary: { name: '文学', desc: '文学引文与素材片段' },
  perspective: { name: '视角', desc: '他者视角与观察记录' },
  retrospect: { name: '回顾', desc: '回溯性补充与追记' },
};

/** 未登记的 kind 原样回显，但兜底描述统一 */
export const evidenceLabel = (k: string): KindLabel => EVIDENCE_KIND[k] || { name: k, desc: '证据片段' };
