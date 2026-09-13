#!/usr/bin/env node
/**
 * ΜΝΗΜΗ · 本地模型调度器单测
 *
 * 直接测**真实实现**：先用 tsc 把 web/src/localModel.ts 编译到临时目录，再 import 编译产物，
 * 用合成能力画像验算选型与预算推导。（不重写一份逻辑来"测试自己"。）
 *
 * 用法：node web/scripts/test-localmodel.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '..');
const OUT = path.join(WEB, 'tmp', 'lm-test');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const tsc = path.join(WEB, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(process.execPath, [
  tsc, path.join(WEB, 'src', 'localModel.ts'),
  '--outDir', OUT, '--module', 'esnext', '--target', 'es2022',
  '--moduleResolution', 'bundler', '--skipLibCheck', '--strict', 'false',
], { stdio: 'inherit' });

const mod = await import(pathToFileURL(path.join(OUT, 'localModel.js')).href);
const { pickModel, deriveBudget, downloadBudget } = mod;

let pass = 0, fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.log(`❌ ${name}${detail ? '  → ' + detail : ''}`); }
};

const GB = 1024 ** 3;
const base = {
  webgpu: false, wasmSimd: true, memoryGB: 4, cores: 8,
  saveData: false, effectiveType: '4g', batteryLevel: null, charging: null,
  shell: 'desktop', os: 'windows', secure: true,
};
const M = (o) => ({
  id: 'm', name: 'm', path: '/models/x.gguf', runtime: '/models/runtime.js',
  backend: 'wasm', sizeBytes: 400 * 1024 * 1024, params: 0.5, quantization: 'Q4_K_M',
  minMemoryGB: 2, contextWindow: 2048, maxOutputTokens: 320, qualityScore: 50,
  languages: ['zh'], ...o,
});

/* ---------- 下载预算 ---------- */
ok(downloadBudget({ ...base, saveData: true }) === 120 * 1024 * 1024, '省流量模式收紧到 120MB');
ok(downloadBudget({ ...base, effectiveType: '2g' }) === 120 * 1024 * 1024, '2G 网络收紧到 120MB');
ok(downloadBudget({ ...base, shell: 'phone' }) === 700 * 1024 * 1024, '手机预算 700MB');
ok(downloadBudget({ ...base, shell: 'tablet' }) === 1400 * 1024 * 1024, '平板预算 1400MB');
ok(downloadBudget({ ...base, shell: 'desktop' }) === 2500 * 1024 * 1024, '桌面预算 2500MB');

/* ---------- 后端可用性是硬门 ---------- */
{
  const reg = [M({ id: 'gpu-only', backend: 'webgpu', qualityScore: 90 })];
  const d1 = pickModel({ ...base, webgpu: false }, reg);
  ok(d1.model === null && d1.fallbackToSource, '无 WebGPU 时淘汰 WebGPU 模型并回退信源档');
  ok(d1.rejected.some(r => r.id === 'gpu-only'), '淘汰原因被记录（可解释）');
  const d2 = pickModel({ ...base, webgpu: true, memoryGB: 8 }, reg);
  ok(d2.model?.id === 'gpu-only', '有 WebGPU 时选用 WebGPU 模型');
}
{
  const d = pickModel(base, [M({ id: 'simd', backend: 'wasm' })]);
  ok(d.model?.id === 'simd', 'WASM SIMD 可用时保留 wasm 模型');
  const d2 = pickModel({ ...base, wasmSimd: false }, [M({ id: 'simd', backend: 'wasm' })]);
  ok(d2.model === null, 'WASM SIMD 不可用时淘汰 wasm 模型');
}

/* ---------- 中文支持是硬门 ---------- */
{
  const d = pickModel(base, [M({ id: 'en', languages: ['en'], qualityScore: 99 }), M({ id: 'zh', qualityScore: 40 })]);
  ok(d.model?.id === 'zh', '不支持中文的模型即使质量分更高也被淘汰');
}

/* ---------- 内存下限 ---------- */
{
  const d = pickModel({ ...base, memoryGB: 1 }, [M({ id: 'big', minMemoryGB: 4, qualityScore: 95 })]);
  ok(d.model === null, '内存不足（1GB < 需 4GB）时淘汰');
  ok(d.rejected[0].why.includes('内存'), '淘汰原因写明内存不足');
}

/* ---------- 体积预算：已缓存的模型不受预算限制 ---------- */
{
  const big = M({ id: 'big', sizeBytes: 2 * GB, minMemoryGB: 8, qualityScore: 80 });
  const small = M({ id: 'small', sizeBytes: 300 * 1024 * 1024, qualityScore: 50 });
  const capped = { ...base, shell: 'phone', memoryGB: 8 };   // 手机预算 700MB
  const d1 = pickModel(capped, [big, small]);
  ok(d1.model?.id === 'small', '体积超预算的模型被淘汰（手机 2GB > 700MB）');
  const d2 = pickModel(capped, [big, small], { [big.path]: true });
  ok(d2.model?.id === 'big', '已缓存的模型不受下载预算限制（避免重复下载）');
}

/* ---------- 缓存加权必须压过质量差 ---------- */
{
  const a = M({ id: 'cached-weak', path: '/models/a.gguf', qualityScore: 50 });
  const b = M({ id: 'fresh-strong', path: '/models/b.gguf', qualityScore: 62 });
  const d = pickModel(base, [a, b], { [a.path]: true });
  ok(d.model?.id === 'cached-weak', '已缓存(+40) 压过质量分领先 12 的新模型');
}

/* ---------- 手机偏好小模型 ---------- */
{
  const s = M({ id: 'p05', params: 0.5, qualityScore: 50 });
  const m = M({ id: 'p15', params: 1.5, minMemoryGB: 4, qualityScore: 68 });
  const d = pickModel({ ...base, shell: 'phone', memoryGB: 8 }, [s, m]);
  ok(d.model?.id === 'p05', '手机端按参数量重罚后选用小模型（速度/耗电优先）');
  const d2 = pickModel({ ...base, shell: 'desktop', memoryGB: 8 }, [s, m]);
  ok(d2.model?.id === 'p15', '桌面端则选用质量更高的 1.5B');
}

/* ---------- 低电量 / 省流量扣分 ---------- */
{
  const d = pickModel({ ...base, batteryLevel: 0.1, charging: false }, [M({ id: 'x' })]);
  ok(d.model?.id === 'x', '低电量仍可选（扣分不淘汰）——但理由中体现能力画像');
  ok(/电量偏低/.test(d.reason), '理由字符串包含电量提示');
}

/* ---------- 预算推导 ---------- */
{
  const b = deriveBudget(M({ contextWindow: 2048, maxOutputTokens: 320 }));
  /* 注意实现里有 512 的可用下限保护：usable = max(512, 2048-320-1400) = 512 */
  ok(b.maxChars === Math.round(Math.max(512, 2048 - 320 - 1400) * 1.5), 'maxChars 按可用窗口推导（含 512 下限保护）', JSON.stringify(b));
  ok(b.topK >= 4 && b.topK <= 24, 'topK 落在 4–24 区间内');
  const huge = deriveBudget(M({ contextWindow: 4096, maxOutputTokens: 480 }));
  ok(huge.maxChars === Math.round((4096 - 480 - 1400) * 1.5), '更大窗口得到更大预算（线性换算正确）', JSON.stringify(huge));
  const big = deriveBudget(M({ contextWindow: 32768, maxOutputTokens: 1024 }));
  ok(big.topK === 24, '超大窗口时 topK 收敛到上限 24（避免一次塞太多拖慢小模型）');
  const none = deriveBudget(null);
  ok(none.maxChars === 12000 && none.topK === 8, '无模型时给安全默认预算');
}

/* ---------- 空清单 ---------- */
{
  const d = pickModel(base, []);
  ok(d.model === null && d.fallbackToSource, '空清单 → 回退信源档，不抛错');
  ok(/信源档/.test(d.reason), '理由明确说明回退到信源档');
}

console.log(`\n合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
