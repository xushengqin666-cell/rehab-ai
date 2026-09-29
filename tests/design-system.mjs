// tests/design-system.mjs — 设计系统专项验收（v2.43.0）
//
// 验证 DESIGN.md 的 token 真的落到了运行时，而不是只写在文档里。断言分四类：
//   ① 规范层：DESIGN.md 存在且八个 ## 小节按规范顺序
//   ② token 层：覆盖层已加载、关键 token 生效、旧变量已指向 token
//   ③ 统一度：字号/圆角/阴影/动效节奏的唯一值数量（越少越统一）
//   ④ 无障碍：焦点环、触控热区 ≥44px、对比度达 WCAG AA、跟随系统减少动效
// 用法：先启动 tests/start-servers.ps1 与 9228 无头 Chrome，然后 node tests/design-system.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CDP = 'http://127.0.0.1:' + (process.env.RH_CDP_PORT || '9228');
const APP = 'http://127.0.0.1:8000/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, failN = 0;
const ok = (m) => { console.log('OK   ' + m); pass++; };
const bad = (m) => { console.log('FAIL ' + m); failN++; };

// ── ① 规范层：DESIGN.md 的小节顺序（DESIGN.md 规范要求八个 ## 按固定顺序）──────────
const CANON = ['Overview', 'Colors', 'Typography', 'Layout', 'Elevation & Depth', 'Shapes', 'Components', "Do's and Don'ts"];
try {
  const md = readFileSync(join(ROOT, 'DESIGN.md'), 'utf8');
  const heads = [...md.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
  const missing = CANON.filter((h) => !heads.includes(h));
  const known = heads.filter((h) => CANON.includes(h));
  const ordered = known.every((h, i) => CANON.indexOf(h) >= (i ? CANON.indexOf(known[i - 1]) : 0));
  (!missing.length && ordered)
    ? ok(`DESIGN.md 八节齐全且顺序正确（${heads.length} 节）`)
    : bad(`DESIGN.md 小节不合规：缺 ${missing.join('/') || '无'}、顺序 ${ordered ? '正确' : '错误'}`);
  const hasFrontMatter = /^---\n[\s\S]*?\n---\n/.test(md) && /colors:/.test(md) && /components:/.test(md);
  hasFrontMatter ? ok('DESIGN.md 含 YAML token 前置（colors/components）') : bad('DESIGN.md 缺 YAML token 前置');
} catch (e) { bad('读不到 DESIGN.md：' + e.message); }

// ── 浏览器 ────────────────────────────────────────────────────────────────────
const tab = await (await fetch(CDP + '/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let idc = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(String(ev.data)); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((resolve) => { const id = ++idc; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evl = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
  return r.result.result.value;
};

await send('Runtime.enable'); await send('Page.enable');
// 禁缓存：否则可能测到上一次的 app.js / css（只清 SW 与 Cache Storage 不够，见 tests/README.md）
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.navigate', { url: APP });
await sleep(2500);
await evl(`navigator.serviceWorker.getRegistrations().then(rs=>Promise.all(rs.map(r=>r.unregister()))).then(()=>caches.keys()).then(ks=>Promise.all(ks.map(k=>caches.delete(k)))).then(()=>location.reload())`);
await sleep(3500);
await evl(`(function(){const b=document.getElementById('btn-auth-skip'); if(b) b.click(); return 1;})()`);
await sleep(800);

// ── ② token 层 ────────────────────────────────────────────────────────────────
const t = await evl(`(function(){
  const r = getComputedStyle(document.documentElement);
  const g = (n) => (r.getPropertyValue(n) || '').trim();
  return {
    sheets: [...document.styleSheets].map(s => (s.href || '').split('/').pop()).filter(Boolean),
    primary: g('--color-primary'), radiusMd: g('--radius-md'), textBody: g('--text-body'), dur: g('--dur-base'),
    bg: g('--bg'), dim: g('--dim'), red: g('--red'), green: g('--green'), shadowVar: g('--shadow')
  };
})()`);
t.sheets.includes('rehab-design-system.css') ? ok('覆盖层已加载（在 style.css / demo.css 之后）') : bad('覆盖层未加载：' + t.sheets.join(','));
(t.primary === '#0e7c66' && t.radiusMd === '12px' && t.textBody === '15px' && t.dur === '200ms')
  ? ok(`核心 token 生效（primary ${t.primary} / radius-md ${t.radiusMd} / text-body ${t.textBody} / dur-base ${t.dur})`)
  : bad(`核心 token 异常：${JSON.stringify(t)}`);
(t.dim === '#5c6472' && t.red === '#c8443f' && t.green === '#0f6f49' && t.bg === '#f6f4ef')
  ? ok(`旧变量已指向 token（--dim ${t.dim} / --red ${t.red} / --green ${t.green} / --bg ${t.bg}）`)
  : bad(`旧变量未指向 token：dim=${t.dim} red=${t.red} green=${t.green} bg=${t.bg}`);
t.shadowVar.includes('rgba(34, 38, 46') ? ok('--shadow 已收敛到 elevation-2（阴影色为 ink 透明，非纯黑）') : bad('--shadow 未收敛：' + t.shadowVar);

// ── ③/④ 逐页采集聚合指标 ──────────────────────────────────────────────────────
const TABS = ['home', 'posture', 'train', 'recheck', 'record', 'settings'];
const COLLECT = `(function(){
  const els = [...document.querySelectorAll('*')].filter(e => e.tagName !== 'HTML' && e.getClientRects().length);
  const cs = els.map(e => getComputedStyle(e));
  const uniq = (a) => [...new Set(a)];
  const hitH = (b) => { const h = b.getBoundingClientRect().height; const a = parseFloat(getComputedStyle(b, '::after').height) || 0; return Math.round(Math.max(h, a)); };
  const btns = [...document.querySelectorAll('.btn')].filter(b => b.getClientRects().length);
  return {
    fontSizes: uniq(cs.map(s => s.fontSize)), radii: uniq(cs.map(s => s.borderRadius)),
    shadows: uniq(cs.map(s => s.boxShadow)).filter(s => s !== 'none'),
    durs: uniq(cs.flatMap(s => s.transitionDuration.split(',').map(x => x.trim()))),
    easings: uniq(cs.flatMap(s => s.transitionTimingFunction.replace(/cubic-bezier\\([^)]*\\)/g, 'cubic-bezier(X)').split(',').map(x => x.trim()))),
    tnum: els.filter(e => getComputedStyle(e).fontVariantNumeric.includes('tabular-nums')).length,
    btnMin: btns.length ? Math.min(...btns.map(hitH)) : null, btnCount: btns.length
  };
})()`;
const agg = { fontSizes: new Set(), radii: new Set(), shadows: new Set(), durs: new Set(), easings: new Set(), tnum: 0, btnMin: null, btnCount: 0 };
for (const tb of TABS) {
  await evl(`(function(){const b=document.querySelector('.bottom-nav button[data-tab="${tb}"]'); if(b) b.click(); return 1;})()`);
  await sleep(650);
  const r = await evl(COLLECT);
  r.fontSizes.forEach((v) => agg.fontSizes.add(v));
  r.radii.forEach((v) => agg.radii.add(v));
  r.shadows.forEach((v) => agg.shadows.add(v));
  r.durs.forEach((v) => agg.durs.add(v));
  r.easings.forEach((v) => agg.easings.add(v));
  agg.tnum += r.tnum; agg.btnCount += r.btnCount;
  if (r.btnMin != null) agg.btnMin = agg.btnMin == null ? r.btnMin : Math.min(agg.btnMin, r.btnMin);
}
// 允许的残留：0px（无圆角）、50%（正圆）、999px（胶囊）；字号上限 8 档（音阶 9 档，display/hero 未在本批页面出现）
const fontStrays = [...agg.fontSizes].filter((v) => !/^(11|12|13|15|17|20|26|40)px$/.test(v));
fontStrays.length === 0
  ? ok(`字号全部落在音阶上（可见 UI 共 ${agg.fontSizes.size} 档：${[...agg.fontSizes].sort((a, b) => parseFloat(a) - parseFloat(b)).join(' ')}）`)
  : bad(`仍有音阶外字号：${fontStrays.join(' ')}`);
const radStrays = [...agg.radii].filter((v) => !/^(0px|8px|12px|16px|22px|999px|50%)$/.test(v));
radStrays.length === 0
  ? ok(`圆角全部落在音阶上（共 ${agg.radii.size} 种：${[...agg.radii].join(' ')}）`)
  : bad(`仍有音阶外圆角：${radStrays.join(' ')}`);
agg.durs.size <= 3 ? ok(`动效时长收敛到 ${agg.durs.size} 档：${[...agg.durs].sort().join(' ')}`) : bad(`动效时长仍有 ${agg.durs.size} 档：${[...agg.durs].join(' ')}`);
agg.easings.size <= 1 ? ok(`缓动收敛到 ${agg.easings.size} 种：${[...agg.easings].join(' ')}`) : bad(`缓动仍有 ${agg.easings.size} 种`);
agg.shadows.size <= 6 ? ok(`阴影收敛到 ${agg.shadows.size} 种（4 档 + 光晕）`) : bad(`阴影仍有 ${agg.shadows.size} 种`);
agg.tnum >= 30 ? ok(`等宽数字生效（${agg.tnum} 个元素启用 tabular-nums）`) : bad(`等宽数字只覆盖 ${agg.tnum} 个元素`);
agg.btnMin != null && agg.btnMin >= 44 ? ok(`按钮有效热区最小 ${agg.btnMin}px（共 ${agg.btnCount} 个，全部 ≥44px）`) : bad(`最小按钮热区仅 ${agg.btnMin}px`);

// ── ④ 焦点环（真实 Tab 触发 :focus-visible）──────────────────────────────────
await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 9, key: 'Tab' });
await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 9, key: 'Tab' });
await sleep(300);
const f = await evl(`(function(){const a=document.activeElement; const s=getComputedStyle(a); return {fv:a.matches(':focus-visible'), w:s.outlineWidth, st:s.outlineStyle, c:s.outlineColor};})()`);
(f.fv && f.st !== 'none' && parseFloat(f.w) >= 2 && f.c === 'rgb(14, 124, 102)')
  ? ok(`键盘焦点环统一（${f.w} ${f.st} ${f.c}）`)
  : bad(`焦点环异常：${JSON.stringify(f)}`);

// ── ④ 对比度 ─────────────────────────────────────────────────────────────────
const c = await evl(`(function(){
  const lum = (hex) => { const s = hex.replace('#',''); const v = [0,2,4].map(i => parseInt(s.substr(i,2),16)/255)
    .map(x => x <= 0.03928 ? x/12.92 : Math.pow((x+0.055)/1.055, 2.4)); return 0.2126*v[0]+0.7152*v[1]+0.0722*v[2]; };
  const ratio = (a,b) => { const [x,y]=[lum(a),lum(b)].sort((m,n)=>n-m); return Math.round(((x+0.05)/(y+0.05))*100)/100; };
  const r = getComputedStyle(document.documentElement);
  const g = (n) => (r.getPropertyValue(n)||'').trim();
  return { mutedBg: ratio(g('--dim'), g('--bg')), mutedCard: ratio(g('--dim'), g('--card')),
    inkCard: ratio(g('--text'), g('--card')), onDanger: ratio('#ffffff', g('--red')), onSuccess: ratio('#ffffff', g('--green')) };
})()`);
const AA = [['次要文字/暖纸底', c.mutedBg], ['次要文字/卡片', c.mutedCard], ['正文/卡片', c.inkCard], ['白字/危险底', c.onDanger], ['白字/成功底', c.onSuccess]];
const failed = AA.filter(([, v]) => v < 4.5);
failed.length === 0
  ? ok(`对比度全部达 WCAG AA（${AA.map(([k, v]) => k + ' ' + v).join(' · ')}）`)
  : bad(`对比度不达标：${failed.map(([k, v]) => k + ' ' + v).join(' · ')}`);

// ── ④ 跟随系统「减少动态效果」────────────────────────────────────────────────
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await sleep(200);
const rm = await evl(`(function(){const b=document.querySelector('.btn'); return getComputedStyle(b).transitionDuration;})()`);
await send('Emulation.setEmulatedMedia', { features: [] });
parseFloat(rm) <= 0.002
  ? ok(`系统开启「减少动态效果」时动画被压缩（transition-duration ${rm}）`)
  : bad(`未遵守 prefers-reduced-motion：transition-duration=${rm}`);

// ── ⑤ 渲染清晰度：叠加层画布必须按设备像素比分配 ────────────────────────────────
// v2.43.3 修的真缺陷：此前只用 CSS 像素分配画布，高分屏手机上骨架被放大 → 火柴人发虚。
// 用 CDP 模拟 2× 屏幕来核对。注意必须走**演示模式**：假摄像头画面里没有人，MediaPipe 检测不到
// 人体，训练循环会在「未检测到人」分支提前 return，根本走不到画布尺寸那段（本断言踩过）。
await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 2, mobile: true });
await evl(`(function(){const b=document.querySelector('.bottom-nav button[data-tab="posture"]'); if(b) b.click(); return 1;})()`);
await sleep(700);
await evl(`document.getElementById('btn-pa-demo').click()`);
let dprInfo = null;
for (let i = 0; i < 12; i++) {
  await sleep(1000);
  dprInfo = await evl(`(function(){const o=document.getElementById('pa-overlay'); const cap=Math.min(window.devicePixelRatio||1,2);
    return { w:o.width, h:o.height, cw:o.clientWidth, ch:o.clientHeight, dpr:window.devicePixelRatio, want:Math.round(o.clientWidth*cap) };})()`);
  if (dprInfo.cw > 0 && dprInfo.w === dprInfo.want && dprInfo.w > dprInfo.cw) break;
}
(dprInfo && dprInfo.cw > 0 && dprInfo.w === dprInfo.want && dprInfo.w > dprInfo.cw)
  ? ok(`叠加层按设备像素比分配（CSS ${dprInfo.cw}×${dprInfo.ch} → 画布 ${dprInfo.w}×${dprInfo.h}，DPR ${dprInfo.dpr}，上限 2×）`)
  : bad(`画布未按 DPR 分配（骨架会发虚）：${JSON.stringify(dprInfo)}`);
// 恢复：停演示 + 撤掉模拟设备
await evl(`(function(){const b=document.getElementById('btn-pa-demo'); if(b) b.click(); return 1;})()`);
await send('Emulation.clearDeviceMetricsOverride');
await sleep(400);

console.log(`\nPASS ${pass} / FAIL ${failN} / 总计 ${pass + failN}`);
ws.close();
process.exit(failN ? 1 : 0);
