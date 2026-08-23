// 康复AI 端到端冒烟测试（CDP）：中文默认 + 英文切换 + 自测 + 模型加载验证
const CDP_HTTP = 'http://127.0.0.1:' + (process.env.RH_CDP_PORT || '9228');
const APP = 'http://127.0.0.1:8000/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.log(msg + ' -> FAIL'); process.exitCode = 1; };
const ok = (msg) => console.log(msg + ' -> OK');

const created = await (await fetch(CDP_HTTP + '/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' })).json();
const ws = new WebSocket(created.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let idc = 0;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(String(ev.data));
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  } else if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    consoleErrors.push('log: ' + m.params.entry.text);
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++idc;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});

await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await send('Page.navigate', { url: APP });
await sleep(3000);

const evl = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) throw new Error('eval failed: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  return r.result.result.value;
};
const txt = (sel) => `document.querySelector(${JSON.stringify(sel)}).textContent.replace(/\\s+/g,' ')`;
const sleepTxt = async (sel, ms = 150) => { await sleep(ms); return evl(txt(sel)); };

// ============ Part A：强制中文 ============
await evl(`localStorage.clear(); localStorage.setItem('rehab_lang','zh'); location.reload()`);
await sleep(2500);
const zhChips = await evl(`[...document.querySelectorAll('#ex-chips .chip')].map(b=>b.textContent).join('|')`);
console.log('ZH CHIPS:', zhChips);
(zhChips.includes('深蹲') && zhChips.includes('弓步蹲') && zhChips.includes('俯卧撑')) ? ok('ZH chips') : fail('ZH chips');

for (const t of ['record', 'assess', 'schedule', 'settings', 'train']) {
  await evl(`document.querySelector('.bottom-nav button[data-tab="${t}"]').click()`);
  const active = await evl(`document.querySelector('#tab-${t}').classList.contains('active')`);
  active ? ok('ZH tab ' + t) : fail('ZH tab ' + t);
}

// 预约：今天(未到) + 明天
await evl(`document.querySelector('.bottom-nav button[data-tab="schedule"]').click()`);
const d = new Date();
const pad = (n) => String(n).padStart(2, '0');
const iso = (dt) => dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
const tm = new Date(d); tm.setDate(d.getDate() + 1);
await evl(`(() => {
  document.getElementById('appt-date').value = '${iso(d)}'; document.getElementById('appt-time').value = '23:50';
  document.getElementById('appt-place').value = '测试诊所'; document.getElementById('appt-form').requestSubmit();
  document.getElementById('appt-date').value = '${iso(tm)}'; document.getElementById('appt-time').value = '09:00';
  document.getElementById('appt-place').value = '明日诊所'; document.getElementById('appt-form').requestSubmit();
  return true;
})()`);
await sleep(150);
const zhAppts = await evl(`document.getElementById('appt-list').textContent.replace(/\\s+/g,' ')`);
(zhAppts.includes('今天') && zhAppts.includes('明天')) ? ok('ZH appt tags') : fail('ZH appt tags: ' + zhAppts);
(await evl(`[...document.querySelectorAll('#appt-list .item')].every(i => !i.style.opacity)`)) ? ok('ZH appt not-past') : fail('ZH appt not-past');

// 评估
await evl(`document.querySelector('.bottom-nav button[data-tab="assess"]').click()`);
await evl(`document.getElementById('btn-assess').click()`);
await sleep(150);
const zhAssess = await evl(`document.getElementById('assess-result').textContent.replace(/\\s+/g,' ')`);
zhAssess.includes('评估分') ? ok('ZH assess') : fail('ZH assess: ' + zhAssess);

// 自定义动作
await evl(`document.querySelector('.bottom-nav button[data-tab="settings"]').click()`);
await evl(`document.getElementById('btn-new-custom').click()`);
await evl(`document.getElementById('cf-name').value = '单腿蹲'; document.getElementById('cf-save').click()`);
await sleep(200);
(await evl(`[...document.querySelectorAll('#ex-chips .chip')].some(c=>c.textContent.includes('单腿蹲'))`)) ? ok('ZH custom') : fail('ZH custom');

// 注入一条训练记录
await evl(`localStorage.setItem('rehab_sessions', JSON.stringify([{id:'t1', ts: Date.now(), ex:'squat', exName:'深蹲', reps:5, dur:30, depth:'shallow', badPct:10, valgusPct:5, collectCount:0}])); location.reload()`);
await sleep(2200);

// ============ Part B：切英文 ============
await evl(`document.getElementById('btn-lang').click()`);
await sleep(300);
const langAttr = await evl(`document.documentElement.lang`);
(langAttr === 'en') ? ok('EN html lang') : fail('EN html lang: ' + langAttr);
const enChips = await evl(`[...document.querySelectorAll('#ex-chips .chip')].map(b=>b.textContent).join('|')`);
console.log('EN CHIPS:', enChips);
(enChips.includes('Squat') && enChips.includes('Lunge') && enChips.includes('Push-up')) ? ok('EN chips') : fail('EN chips');
const enNav = await evl(`document.querySelector('.bottom-nav button[data-tab="train"]').textContent.replace(/\\s+/g,' ')`);
enNav.includes('Train') ? ok('EN nav') : fail('EN nav: ' + enNav);

await evl(`document.querySelector('.bottom-nav button[data-tab="schedule"]').click()`);
await sleep(150);
const enAppts = await evl(`document.getElementById('appt-list').textContent.replace(/\\s+/g,' ')`);
console.log('EN APPTS:', enAppts);
(enAppts.includes('Today') && enAppts.includes('Tomorrow')) ? ok('EN appt tags') : fail('EN appt tags');

await evl(`document.querySelector('.bottom-nav button[data-tab="record"]').click()`);
await sleep(150);
const enRec = await evl(`document.getElementById('session-list').textContent.replace(/\\s+/g,' ')`);
console.log('EN REC:', enRec);
(enRec.includes('Squat') && enRec.includes('reps') && enRec.includes('Shallow')) ? ok('EN records') : fail('EN records');
const enSum = await evl(`document.getElementById('summary-line').textContent`);
enSum.includes('streak') ? ok('EN summary') : fail('EN summary: ' + enSum);

await evl(`document.querySelector('.bottom-nav button[data-tab="assess"]').click()`);
await sleep(150);
const enAssessList = await evl(`document.getElementById('assess-list').textContent.replace(/\\s+/g,' ')`);
enAssessList.includes('Score') ? ok('EN assess list') : fail('EN assess list: ' + enAssessList);

// ============ Part C：英文自测 ============
await evl(`location.hash = '#selftest'; location.reload()`);
await sleep(2500);
const enSt = await evl(`document.getElementById('selftest-out').textContent.replace(/\\s+/g,' ')`);
console.log('EN SELFTEST:', enSt);
(enSt.includes('All tests passed') && !enSt.includes('❌')) ? ok('EN selftest') : fail('EN selftest');

// ============ Part D：模型加载自检 ============
await send('Page.navigate', { url: APP + '?modeltest=1' });
let mt = '';
for (let i = 0; i < 40; i++) {
  await sleep(1000);
  mt = await evl(`document.getElementById('selftest-out').textContent`);
  if (mt.includes('model load')) break;
}
console.log('MODELTEST:', mt.trim());
mt.includes('model load OK') ? ok('model load') : fail('model load: ' + mt);

console.log('CONSOLE_ERRORS:', consoleErrors.length ? consoleErrors.join(' ||| ') : 'none');
if (consoleErrors.length) process.exitCode = 1;
console.log('RESULT:', process.exitCode ? 'FAIL' : 'PASS');
ws.close();
process.exit(process.exitCode || 0);
