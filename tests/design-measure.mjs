// tests/design-measure.mjs — 设计系统实测：用无头浏览器统计"看得见的成熟度"指标
//
// 用途：改造前后各跑一次，用同一把尺子出数（用户的交付约定：声称"更成熟"必须给改前改后数据）。
// 指标：字号/圆角/阴影/动效时长的唯一值数量（越少越统一）、等宽数字覆盖数、按钮最小高度、
//       焦点环、对比度（由 CSS 变量现场算 WCAG 比值）。
// 用法：先启动 tests/start-servers.ps1 与 9228 无头 Chrome，然后
//   node tests/design-measure.mjs            # 输出 JSON
import { writeFileSync } from 'node:fs';

const CDP = 'http://127.0.0.1:' + (process.env.RH_CDP_PORT || '9228');
const APP = 'http://127.0.0.1:8000/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
await send('Page.navigate', { url: APP });
await sleep(2500);
// 先清掉 Service Worker 与缓存再重载：否则测到的是上一次缓存的旧样式（覆盖层会被漏掉）
await evl(`navigator.serviceWorker.getRegistrations().then(rs=>Promise.all(rs.map(r=>r.unregister()))).then(()=>caches.keys()).then(ks=>Promise.all(ks.map(k=>caches.delete(k)))).then(()=>location.reload())`);
await sleep(3500);
// 进访客模式（有登录屏时）
await evl(`(function(){const b=document.getElementById('btn-auth-skip'); if(b){b.click(); return 'skipped';} return 'no-login';})()`);
await sleep(800);

// 逐页各采一次，合并统计（面板是切换显示，单页采不到全部组件）
const TABS = ['home', 'posture', 'train', 'recheck', 'record', 'settings'];
const COLLECT = `(function(){
  // 排除 html 根元素：它的 16px 是浏览器画布默认值，不渲染文字（body 已设为 --text-body）
  const els = [...document.querySelectorAll('*')].filter(e => e.tagName !== 'HTML' && e.getClientRects().length);
  const cs = els.map(e => getComputedStyle(e));
  const uniq = (a) => [...new Set(a)];
  const durs = uniq(cs.flatMap(s => s.transitionDuration.split(',').map(x => x.trim())));
  const norm = (v) => v.replace(/cubic-bezier\\([^)]*\\)/g, 'cubic-bezier(X)');
  const easings = uniq(cs.flatMap(s => norm(s.transitionTimingFunction).split(',').map(x => x.trim())));
  const nums = els.filter(e => getComputedStyle(e).fontVariantNumeric.includes('tabular-nums'));
  const btns = [...document.querySelectorAll('.btn')].filter(b => b.getClientRects().length);
  // 有效热区：.small 按钮视觉高度不变，但用 ::after 把热区撑到 44px，必须按热区算
  const hitH = (b) => { const h = b.getBoundingClientRect().height; const a = parseFloat(getComputedStyle(b, '::after').height) || 0; return Math.round(Math.max(h, a)); };
  const bhs = btns.map(hitH);
  return {
    elements: els.length,
    fontSizes: uniq(cs.map(s => s.fontSize)),
    radii: uniq(cs.map(s => s.borderRadius)),
    shadows: uniq(cs.map(s => s.boxShadow)).filter(s => s !== 'none'),
    durations: durs, easings, numericElements: nums.length,
    btnCount: btns.length, btnMinHeight: bhs.length ? Math.min(...bhs) : null,
    btnUnder44: bhs.filter(h => h < 44).length
  };
})()`;

const agg = { elements: 0, fontSizes: new Set(), radii: new Set(), shadows: new Set(), durations: new Set(), easings: new Set(), numericElements: 0, btnCount: 0, btnMinHeight: null, btnUnder44: 0 };
for (const t of TABS) {
  await evl(`(function(){const b=document.querySelector('.bottom-nav button[data-tab="${t}"]'); if(b) b.click(); return 1;})()`);
  await sleep(700);
  const r = await evl(COLLECT);
  agg.elements = Math.max(agg.elements, r.elements);
  r.fontSizes.forEach((v) => agg.fontSizes.add(v));
  r.radii.forEach((v) => agg.radii.add(v));
  r.shadows.forEach((v) => agg.shadows.add(v));
  r.durations.forEach((v) => agg.durations.add(v));
  r.easings.forEach((v) => agg.easings.add(v));
  agg.numericElements += r.numericElements;
  agg.btnCount += r.btnCount;
  agg.btnUnder44 += r.btnUnder44;
  if (r.btnMinHeight != null) agg.btnMinHeight = agg.btnMinHeight == null ? r.btnMinHeight : Math.min(agg.btnMinHeight, r.btnMinHeight);
}

// 焦点环 + 对比度（现场按 CSS 变量算 WCAG 相对亮度比）
const extra = await evl(`(function(){
  const lum = (hex) => { const c = hex.replace('#',''); const v = [0,2,4].map(i => parseInt(c.substr(i,2),16)/255)
    .map(x => x <= 0.03928 ? x/12.92 : Math.pow((x+0.055)/1.055, 2.4)); return 0.2126*v[0]+0.7152*v[1]+0.0722*v[2]; };
  const ratio = (a,b) => { const [x,y] = [lum(a), lum(b)].sort((m,n) => n-m); return Math.round(((x+0.05)/(y+0.05))*100)/100; };
  const root = getComputedStyle(document.documentElement);
  const get = (n) => (root.getPropertyValue(n) || '').trim();
  const probe = document.createElement('button'); probe.className = 'btn'; probe.textContent = 'x';
  document.body.appendChild(probe); probe.focus();
  const fs = getComputedStyle(probe);
  const focus = { outlineWidth: fs.outlineWidth, outlineColor: fs.outlineColor, outlineStyle: fs.outlineStyle };
  probe.remove();
  const tok = { bg: get('--color-background') || get('--bg'), surface: get('--color-surface') || get('--card'),
    muted: get('--color-ink-muted') || get('--dim'), ink: get('--color-ink') || get('--text'),
    danger: get('--red') || get('--color-danger'), success: get('--green') || get('--color-success') };
  const hexOf = (e) => { const s = getComputedStyle(e); return s.backgroundColor; };
  return {
    focus, tokens: tok,
    contrast: {
      muted_on_bg: ratio(tok.muted, tok.bg),
      muted_on_surface: ratio(tok.muted, tok.surface),
      ink_on_surface: ratio(tok.ink, tok.surface),
      white_on_danger: ratio('#ffffff', tok.danger),
      white_on_success: ratio('#ffffff', tok.success)
    },
    hasFocusVisibleRule: [...document.styleSheets].some(sh => { try { return [...sh.cssRules].some(r => r.selectorText && r.selectorText.includes(':focus-visible')); } catch { return false; } }),
    stylesheets: [...document.styleSheets].map(sh => (sh.href || '').split('/').pop()).filter(Boolean)
  };
})()`);

const round = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);
const out = {
  elements: agg.elements,
  uniqueFontSizes: agg.fontSizes.size, fontSizes: [...agg.fontSizes].sort((a, b) => parseFloat(a) - parseFloat(b)),
  uniqueRadii: agg.radii.size, radii: [...agg.radii].sort(),
  uniqueShadows: agg.shadows.size,
  uniqueDurations: agg.durations.size, durations: [...agg.durations].sort(),
  uniqueEasings: agg.easings.size,
  numericElements: agg.numericElements,
  btnCount: agg.btnCount, btnMinHeight: agg.btnMinHeight, btnUnder44: agg.btnUnder44,
  focus: extra.focus, focusVisibleRule: extra.hasFocusVisibleRule,
  contrast: Object.fromEntries(Object.entries(extra.contrast).map(([k, v]) => [k, round(v)])),
  tokens: extra.tokens, stylesheets: extra.stylesheets
};
console.log(JSON.stringify(out, null, 2));
if (process.env.RH_MEASURE_OUT) writeFileSync(process.env.RH_MEASURE_OUT, JSON.stringify(out, null, 2));
ws.close();
process.exit(0);
