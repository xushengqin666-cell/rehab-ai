// 完整系统测试：统计/成就/计划/资料/提醒/云配置
const CDP_HTTP = 'http://127.0.0.1:' + (process.env.RH_CDP_PORT || '9228');
const APP = 'http://127.0.0.1:8000/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const created = await (await fetch(CDP_HTTP + '/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' })).json();
const ws = new WebSocket(created.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let idc = 0; const pending = new Map();
const consoleErrors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(String(ev.data));
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  else if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
};
const send = (method, params = {}) => new Promise((resolve) => { const id = ++idc; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evl = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result.result.value; };
const ok = (m) => console.log('OK  ' + m);
const fail = (m) => { console.log('FAIL ' + m); process.exitCode = 1; };

await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await send('Page.navigate', { url: APP });
await sleep(3000);
const day = 86400000;
await evl(`localStorage.clear(); localStorage.setItem('rehab_lang','zh');
localStorage.setItem('rehab_sessions', JSON.stringify([
  {id:'s1', ts: Date.now()-${day}, ex:'squat', exName:'深蹲', reps:30, dur:300, depth:'ok', badPct:5, valgusPct:0, collectCount:0},
  {id:'s2', ts: Date.now()-2*${day}, ex:'pushup', exName:'俯卧撑', reps:40, dur:200, depth:'shallow', badPct:25, valgusPct:0, collectCount:0},
  {id:'s3', ts: Date.now(), ex:'squat', exName:'深蹲', reps:30, dur:250, depth:'ok', badPct:10, valgusPct:0, collectCount:0}
]));
location.reload()`);
await sleep(2500);

// 统计
await evl(`document.querySelector('.bottom-nav button[data-tab="record"]').click()`);
await sleep(200);
const trends = await evl(`document.querySelectorAll('#trend-chart svg, #quality-chart svg').length`);
trends === 2 ? ok('30 天趋势图 ×2') : fail('趋势图数量: ' + trends);
const distRows = await evl(`document.querySelectorAll('#dist-chart .dist-row').length`);
distRows === 2 ? ok('动作分布 2 个动作') : fail('分布行数: ' + distRows);
const achCount = await evl(`document.querySelectorAll('#ach-grid .ach-item').length`);
const achOn = await evl(`document.querySelectorAll('#ach-grid .ach-item.on').length`);
(achCount === 9 && achOn >= 2) ? ok(`成就 9 项，已解锁 ${achOn} 项`) : fail(`成就: ${achCount}/${achOn}`);

// 计划
await evl(`document.querySelector('.bottom-nav button[data-tab="schedule"]').click()`);
await sleep(150);
await evl(`document.getElementById('btn-plan-add').click()`);
await sleep(200);
await evl(`[...document.querySelectorAll('#plan-days [data-day]')].forEach(b=>{ if(!b.classList.contains('on')) b.click(); }); document.getElementById('plan-reps').value = 20; document.getElementById('btn-plan-save').click()`);
await sleep(250);
const planRows = await evl(`document.querySelectorAll('#plan-list .item').length`);
planRows === 1 ? ok('计划已创建') : fail('计划列表: ' + planRows);
const todayItem = await evl(`document.querySelectorAll('#today-plan .item').length`);
todayItem === 1 ? ok('今日任务出现（勾选了全部星期）') : fail('今日任务: ' + todayItem);
await evl(`document.querySelector('#today-plan .todo-check').click()`);
await sleep(200);
const progTxt = await evl(`document.querySelector('#today-plan .plan-progress-txt').textContent`);
progTxt.includes('1 / 1') ? ok('今日任务打卡 1/1') : fail('进度: ' + progTxt);

// 训练页「今日目标」联动显示
await evl(`document.querySelector('.bottom-nav button[data-tab="train"]').click()`);
await sleep(200);
const goalTxt = await evl(`document.getElementById('goal-line').textContent.replace(/\\s+/g,' ').trim()`);
goalTxt.includes('今日目标') ? ok('训练页显示今日目标: ' + goalTxt.slice(0, 40)) : fail('今日目标: ' + goalTxt);

// 资料
await evl(`document.querySelector('.bottom-nav button[data-tab="settings"]').click()`);
await sleep(150);
await evl(`document.getElementById('pf-name').value='小明'; document.getElementById('btn-save-profile').click()`);
await sleep(150);
const pfSaved = await evl(`JSON.parse(localStorage.getItem('rehab_profile')).name`);
pfSaved === '小明' ? ok('个人资料保存') : fail('资料: ' + pfSaved);

// 提醒
const remTime = await evl(`document.getElementById('rem-time').value`);
remTime === '18:00' ? ok('提醒时间默认 18:00') : fail('提醒时间: ' + remTime);

// 云配置
// 账号卡片 + 登录屏（开发模式解锁配置入口）
const hasAccount = await evl(`!!document.getElementById('account-avatar')`);
hasAccount ? ok('设置页顶部账号卡片存在') : fail('账号卡片缺失');
await evl(`document.getElementById('btn-config-server').classList.remove('hidden'); document.getElementById('btn-config-server').click()`);
await sleep(250);
await evl(`document.getElementById('auth-url').value='https://fake.supabase.co'; document.getElementById('auth-key').value='fake-key-123'; document.getElementById('btn-auth-cfg-save').click()`);
await sleep(300);
const authFormVisible = await evl(`!document.getElementById('auth-form').classList.contains('hidden')`);
const authStatus = await evl(`document.getElementById('cloud-status').textContent.trim()`);
(authFormVisible && authStatus === '未登录') ? ok('登录屏配置后显示登录表单') : fail('登录屏: ' + authFormVisible + '/' + authStatus);
await evl(`document.getElementById('btn-auth-skip').click()`);
await sleep(200);
(await evl(`document.getElementById('auth-screen').classList.contains('hidden')`)) ? ok('访客模式跳过登录') : fail('跳过失败');

// 首次引导
await evl(`localStorage.removeItem('rehab_onboarded'); location.reload()`);
await sleep(2500);
(await evl(`!document.getElementById('onboard').classList.contains('hidden')`)) ? ok('首次启动显示引导页') : fail('引导页未出现');
await evl(`document.getElementById('btn-ob-next').click()`);
await sleep(150);
const obTitle2 = await evl(`document.getElementById('ob-title').textContent`);
obTitle2.includes('计划') ? ok('引导第 2 步') : fail('引导切换: ' + obTitle2);
await evl(`document.getElementById('btn-ob-next').click(); document.getElementById('btn-ob-next').click(); document.getElementById('btn-ob-next').click()`);
await sleep(300);
(await evl(`document.getElementById('onboard').classList.contains('hidden') && localStorage.getItem('rehab_onboarded') === 'true'`)) ? ok('引导完成并记住（下次不再出现）') : fail('引导完成失败');

// 自测 + 同步自测
await evl(`location.hash='#selftest'; location.reload()`);
await sleep(2500);
const st = await evl(`document.getElementById('selftest-out').textContent`);
st.includes('❌') ? fail('引擎自测失败') : ok('引擎自测通过');
await send('Page.navigate', { url: APP + '?synctest=1' });
await sleep(4500);
const sy = await evl(`document.getElementById('selftest-out').textContent`);
sy.includes('❌') ? fail('同步自测失败') : ok('同步自测通过');

console.log('CONSOLE_ERRORS:', consoleErrors.length ? consoleErrors.join(' ||| ') : 'none');
if (consoleErrors.length) process.exitCode = 1;
console.log('RESULT:', process.exitCode ? 'FAIL' : 'PASS');
ws.close();
process.exit(process.exitCode || 0);
