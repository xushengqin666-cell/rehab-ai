// tests/design-tokens-build.mjs — 由 DESIGN.md 的 token + 现有 style.css 生成设计系统覆盖层
//
// 为什么要生成而不是手写：覆盖层要做的两件事都是"把散落取值吸附到音阶上"——
// 字号（style.css 里 24 个唯一值）与圆角（19 个唯一值）必须逐条覆盖，手写既容易漏也会随
// style.css 变化而失效。生成器保证：改完 style.css 重跑一次即可，覆盖层永远和现状对齐。
//
// 用法：
//   node tests/design-tokens-build.mjs          # 生成/刷新 rehab-design-system.css
//   node tests/design-tokens-build.mjs --check   # 只报告会改多少处，不写文件
//
// token 来源：`npx -y -p "@google/design.md" designmd export --format css-tailwind DESIGN.md`
// 注意导出的是 Tailwind v4 的 `@theme {}`，浏览器不认，必须转写成 `:root {}`（本脚本已做）。
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');

// ── 1) token（与 DESIGN.md 一致；改 DESIGN.md 后请重跑 designmd export 并同步此块）────────
const TOKENS = `  /* 色板：暖纸中性 + 青绿主色 + 语义三元组 */
  --color-primary: #0e7c66;
  --color-primary-strong: #0a5f4e;
  --color-primary-soft: #2ba48a;
  --color-primary-container: #e6f2ee;
  --color-on-primary: #ffffff;
  --color-success: #158a5c;
  --color-success-strong: #0f6f49;
  --color-success-container: #e7f4ee;
  --color-warning: #b45309;
  --color-warning-strong: #8a3f07;
  --color-warning-container: #fdf1e0;
  --color-danger: #c8443f;
  --color-danger-strong: #9e3838;
  --color-danger-container: #f0d9d5;
  --color-ink: #22262e;
  --color-ink-strong: #14181f;
  --color-ink-muted: #5c6472;
  --color-surface: #ffffff;
  --color-surface-soft: #fbfaf6;
  --color-background: #f6f4ef;
  --color-background-alt: #efece4;
  --color-border: #e7e2d7;
  --color-border-strong: #ded9cf;
  --color-info-container: #e7edf3;
  /* 字号音阶（9 级） */
  --text-hero: 40px;
  --text-display: 26px;
  --text-title: 20px;
  --text-title-sm: 17px;
  --text-body: 15px;
  --text-body-sm: 13px;
  --text-caption: 12px;
  --text-micro: 11px;
  --text-numeric: 20px;
  /* 圆角音阶（5 级） */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 22px;
  --radius-pill: 999px;
  /* 间距音阶（4px 基准） */
  --spacing-xxs: 4px;
  --spacing-xs: 8px;
  --spacing-sm: 12px;
  --spacing-md: 16px;
  --spacing-lg: 20px;
  --spacing-xl: 24px;
  --spacing-xxl: 32px;
  /* 高度（4 档，阴影色一律取 ink 透明度，不用纯黑） */
  --elevation-1: 0 1px 2px rgba(34, 38, 46, .05);
  --elevation-2: 0 1px 2px rgba(34, 38, 46, .05), 0 10px 28px rgba(34, 38, 46, .06);
  --elevation-3: 0 4px 12px rgba(34, 38, 46, .08), 0 18px 44px rgba(34, 38, 46, .12);
  --elevation-4: 0 1px 0 rgba(34, 38, 46, .06);
  --glow-brand: 0 4px 14px rgba(14, 124, 102, .28);
  --glow-brand-soft: 0 2px 8px rgba(14, 124, 102, .20);
  --glow-success: 0 4px 14px rgba(21, 138, 92, .26);
  --glow-danger: 0 4px 14px rgba(200, 68, 63, .26);
  /* 动效（3 档时长 + 2 种缓动） */
  --dur-fast: 120ms;
  --dur-base: 200ms;
  --dur-slow: 320ms;
  --ease-standard: cubic-bezier(.2, .8, .3, 1);
  --ease-emphasized: cubic-bezier(.16, 1, .3, 1);
  /* 字体栈 */
  --font-sans: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: ui-monospace, "Cascadia Mono", Consolas, monospace;`;

// ── 2) 音阶吸附 ────────────────────────────────────────────────────────────────
const TYPE_SCALE = [[11, 'micro'], [12, 'caption'], [13, 'body-sm'], [15, 'body'], [17, 'title-sm'], [20, 'title'], [26, 'display'], [40, 'hero']];
const RAD_SCALE = [[8, 'sm'], [12, 'md'], [16, 'lg'], [22, 'xl'], [999, 'pill']];

// 就近吸附；距离相同时取更大的那一档（可读性优先）
function snap(px, scale) {
  let best = null, bestD = Infinity;
  for (const [v, name] of scale) {
    const d = Math.abs(px - v);
    if (d < bestD || (d === bestD && v > best[0])) { best = [v, name]; bestD = d; }
  }
  return best;
}

// ── 3) 解析样式表（跳过 @keyframes 与 @media 内部：关键帧选择器不是规则，
//      媒体查询内的取值属于分场景覆盖，强改会破坏响应式）────────────────────────
// v2.43.1：同时扫 demo.css（示范墙/示范弹窗的样式表）—— 之前只扫 style.css，
// 结果 .dmb-thumb 的 10px 圆角落网，只能手工补一条。
const SOURCES = ['style.css', 'demo.css'];
const raw = SOURCES.map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
let skippedKeyframes = 0, skippedMediaRules = 0;
const noKeyframes = raw.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, () => { skippedKeyframes++; return ''; });
const noMedia = noKeyframes.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, (m) => { skippedMediaRules += (m.match(/\{/g) || []).length - 1; return ''; });

const fontOverrides = new Map();   // selector -> CSS 值（含 !important 时一并带上）
const radiusOverrides = new Map();
const untouched = { font: new Set(), radius: new Set() };
let fontSeen = 0, radiusSeen = 0, fontAlready = 0, radiusAlready = 0;

for (const m of noMedia.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const sel = m[1].trim().replace(/\s+/g, ' ');
  const body = m[2];
  if (sel.startsWith('@') || !sel) continue;

  const fs = body.match(/(?:^|;)\s*font-size\s*:\s*([^;]+)/);
  if (fs) {
    fontSeen++;
    const important = /!important/.test(fs[1]);
    const v = fs[1].replace(/!important/, '').trim();
    const px = /^([\d.]+)px$/.exec(v);
    if (!px) { untouched.font.add(fs[1].trim()); }
    else {
      const [target, name] = snap(parseFloat(px[1]), TYPE_SCALE);
      if (target === parseFloat(px[1]) && !important) fontAlready++;
      else fontOverrides.set(sel, `font-size: var(--text-${name})${important ? ' !important' : ''};`);
    }
  }

  const br = body.match(/(?:^|;)\s*border-radius\s*:\s*([^;]+)/);
  if (br) {
    radiusSeen++;
    const important = /!important/.test(br[1]);
    const v = br[1].replace(/!important/, '').trim();
    const parts = v.split(/\s+/);
    if (!parts.every((p) => /^[\d.]+px$/.test(p))) { untouched.radius.add(v); }
    else {
      const snapped = parts.map((p) => snap(parseFloat(p), RAD_SCALE));
      const same = snapped.every(([t], i) => t === parseFloat(parts[i]));
      if (same && !important) radiusAlready++;
      else radiusOverrides.set(sel, `border-radius: ${snapped.map(([, n]) => `var(--radius-${n})`).join(' ')}${important ? ' !important' : ''};`);
    }
  }
}

// ── 4) 输出覆盖层 ─────────────────────────────────────────────────────────────
// 按「声明内容」分组：同一取值的所有选择器合成一条规则，文件更短也更好读
const groupBy = (map) => {
  const g = new Map();
  for (const [sel, decl] of map) { if (!g.has(decl)) g.set(decl, []); g.get(decl).push(sel); }
  return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]));
};
const rules = (map) => groupBy(map).map(([decl, sels]) => `${sels.join(',\n')} { ${decl} }`).join('\n\n');

const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
const out = `/* rehab-design-system.css — 康复AI 设计系统覆盖层（生成物，请勿手改）
 * 生成：node tests/design-tokens-build.mjs      生成于 ${stamp}
 * 依据：DESIGN.md（Google Labs DESIGN.md 开放格式）的 token
 *
 * 定位：纯新增覆盖层，加载在 style.css 之后。不动旧规则、不动 DOM 与交互逻辑，
 *       只做三件事：① 定义 token；② 把应用的旧变量指向 token（一次改动全局生效）；
 *       ③ 把散落的字号/圆角吸附到音阶（本节由生成器逐条产出）。
 * 改 DESIGN.md 后：重跑 designmd export 同步 token 块 → 重跑本生成器。
 */

:root {
${TOKENS}
}

/* ── ② 旧变量 → token：全局生效，也是对比度达标（WCAG AA）的关键一步 ──────────────
 * --dim  #69707c → #5c6472（对暖纸底 4.54:1 → 5.4:1）
 * --red  #d14a4a → #c8443f（对白字 4.38:1 → 4.82:1，小字合规）
 */
:root {
  --bg: var(--color-background);
  --bg2: var(--color-background-alt);
  --card: var(--color-surface);
  --line: var(--color-border);
  --text: var(--color-ink);
  --dim: var(--color-ink-muted);
  --teal: var(--color-primary);
  --teal-d: var(--color-primary-strong);
  /* 成功色文字用 strong 档：#158a5c 对白底仅 4.36:1（小字不合格），#0f6f49 为 5.48:1 */
  --green: var(--color-success-strong);
  --yellow: var(--color-warning);
  --red: var(--color-danger);
  --radius: var(--radius-lg);
  --shadow: var(--elevation-2);
}

/* ── ③ 字号吸附：${fontSeen} 处声明中 ${fontOverrides.size} 处偏离音阶（${fontAlready} 处已在音阶上）── */
${rules(fontOverrides)}

/* ── ③ 圆角吸附：${radiusSeen} 处声明中 ${radiusOverrides.size} 处偏离音阶（${radiusAlready} 处已在音阶上）── */
${rules(radiusOverrides)}

/* ── ④ 高度：阴影收敛到 4 档 + 光晕，纯黑阴影改 ink 透明 ───────────────────── */
.card, .camera-box, .lang-btn, .retry-card { box-shadow: var(--elevation-2); }
.stat, .feedback, .chip, .btn, .item { box-shadow: var(--elevation-1); }
.auth-card, .modal-card { box-shadow: var(--elevation-3); }
#toast { box-shadow: var(--elevation-3); }
.btn.primary, .pa-kind.on, .stat.big { box-shadow: var(--glow-brand); }
.btn.accent { box-shadow: var(--glow-success); }
.btn.danger { box-shadow: var(--glow-danger); }
.brand-mark, .account-avatar, .auth-brand .brand-mark { box-shadow: var(--glow-brand); }
.chart .bar, .seg button.on, .chip.on { box-shadow: var(--glow-brand-soft); }

/* ── ⑤ 动效：18 种节奏收敛到 3 档时长 + 2 种缓动（只改节奏，不改动画目标）─────── */
*, *::before, *::after {
  transition-duration: var(--dur-base) !important;
  transition-timing-function: var(--ease-standard) !important;
}
.btn, .chip, .seg button, .nav-ico, .cbtn { transition-duration: var(--dur-fast) !important; }
.modal-card, .card, .auth-card { transition-duration: var(--dur-slow) !important; transition-timing-function: var(--ease-emphasized) !important; }
/* 注意：这里**不要**加 html { scroll-behavior: smooth }。
 * 应用的设计是切换页面时"立刻"回到顶部（full.mjs 第 21 节有断言），
 * 平滑滚动会让复位变成动画过程，既拖慢手感也会让断言读到中途位置（v2.43.0 踩过一次）。 */

/* ── ⑥ 无障碍：焦点环统一、触控热区 ≥44px、跟随系统减少动效 ────────────────── */
:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
.btn:not(.small), .form input, .form select, .bottom-nav button { min-height: 44px; }
/* .small 按钮保持原视觉高度（布局不动），用叠加层把热区扩到 44px —— 移动端标准做法 */
.btn.small { position: relative; }
.btn.small::after { content: ''; position: absolute; left: 0; right: 0; top: 50%; height: 44px; transform: translateY(-50%); }
@media (prefers-reduced-motion: reduce) {
  /* 必须把上面带 !important 的选择器一起列进来：它们的优先级高于 *，
   * 否则 .btn/.card 等仍会走 120–320ms 动画，"减少动态效果"形同虚设（本层踩过）。 */
  *, *::before, *::after,
  .btn, .chip, .seg button, .nav-ico, .cbtn, .modal-card, .card, .auth-card {
    transition-duration: 1ms !important;
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
  }
}

/* ── ⑥b 排版基线：去掉浏览器默认的 16px / 13.3333px 游离值，让继承可预测 ────── */
body { font-size: var(--text-body); }
button, input, select, textarea { font-family: inherit; font-size: inherit; }

/* ── ⑧ app.js 运行时拼的内联样式（类选择器抓不到，只能用属性选择器吸附）──────────
 * 这些值由 app.js 的模板串写死（例如 style="margin-top:10px"），不在样式表里，
 * 所以上面的字号/圆角吸附覆盖不到，必须按 style 属性匹配，并用 !important 压过内联样式。
 * v2.43.1 实测出的全部偏离值（app.js 内联 style 里带 px 的写法）：
 *   margin-top: 3 / 6 / 10px → 4 / 8 / 12px（4px 间距音阶）
 *   margin-left: 6px → 8px；border-radius: 10px → 12px（圆角音阶 md）
 *   两处琥珀色字面量 → 警示色 token（原来与 --yellow 是两种不同的琥珀） */
[style*="margin-top:3px"] { margin-top: var(--spacing-xxs) !important; }
[style*="margin-top:6px"] { margin-top: var(--spacing-xs) !important; }
[style*="margin-top:10px"] { margin-top: var(--spacing-sm) !important; }
[style*="margin-left:6px"] { margin-left: var(--spacing-xs) !important; }
[style*="border-radius:10px"] { border-radius: var(--radius-md) !important; }
[style*="color:#b45309"] { color: var(--color-warning-strong) !important; }
[style*="background:rgba(245,158,11,.15)"] { background: var(--color-warning-container) !important; }

/* ── ⑦ 数字：等宽 + tabular，数值不跳动 ──────────────────────────────────── */
.s-value, .stat, .ai-score, .pain-lv, .rom-lv, .hm-cell, .nav-num, .chart-cap,
[class*="value"], [class*="score"], [class*="count"] {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
}
`;

if (CHECK_ONLY) {
  console.log(`字号：${fontSeen} 处声明 → 需覆盖 ${fontOverrides.size} 处（已在音阶 ${fontAlready} 处；非 px 未处理 ${[...untouched.font].join(' ') || '无'}）`);
  console.log(`圆角：${radiusSeen} 处声明 → 需覆盖 ${radiusOverrides.size} 处（已在音阶 ${radiusAlready} 处；非 px/多值未处理 ${[...untouched.radius].join(' ') || '无'}）`);
  console.log(`跳过：@keyframes ${skippedKeyframes} 块、@media 内 ${skippedMediaRules} 条规则`);
} else {
  writeFileSync(join(ROOT, 'rehab-design-system.css'), out, 'utf8');
  console.log(`已生成 rehab-design-system.css`);
  console.log(`  字号：${fontSeen} 处 → 覆盖 ${fontOverrides.size} 处（已在音阶 ${fontAlready} 处）`);
  console.log(`  圆角：${radiusSeen} 处 → 覆盖 ${radiusOverrides.size} 处（已在音阶 ${radiusAlready} 处）`);
  console.log(`  跳过：@keyframes ${skippedKeyframes} 块、@media 内 ${skippedMediaRules} 条规则（避免破坏关键帧与响应式）`);
}
