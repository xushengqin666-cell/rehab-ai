// 上市级完整系统验收测试（CDP）——覆盖全部功能模块
// 前置：8000 静态服务器 + 9228 无头 Chrome（带假摄像头）+ 8555 mock-supabase
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CDP = 'http://127.0.0.1:' + (process.env.RH_CDP_PORT || '9228');
const APP = 'http://127.0.0.1:8000/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, failN = 0;
const ok = (m) => { console.log('OK   ' + m); pass++; };
const bad = (m) => { console.log('FAIL ' + m); failN++; };
const consoleErrors = [];
const downloads = [];

const tab = await (await fetch(CDP + '/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let idc = 0; const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(String(ev.data));
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  else if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  else if (m.method === 'Page.javascriptDialogOpening') { send('Page.handleJavaScriptDialog', { accept: true }); }
  else if (m.method === 'Page.downloadWillBegin') downloads.push(m.params.suggestedFilename);
};
const send = (method, params = {}) => new Promise((resolve) => { const id = ++idc; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evl = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
  return r.result.result.value;
};
const waitToast = async () => { await sleep(500); return evl(`document.getElementById('toast') ? document.getElementById('toast').textContent : ''`); };
const setFiles = async (sel, filePath) => {
  const doc = await send('DOM.getDocument');
  const node = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: sel });
  await send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files: [filePath] });
};

await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable'); await send('DOM.enable');
const dlDir = mkdtempSync(join(tmpdir(), 'rh-dl-'));
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });

console.log('===== 1. 启动与基础 =====');
await send('Page.navigate', { url: APP });
await sleep(3000);
await evl(`navigator.serviceWorker.getRegistrations().then(rs=>Promise.all(rs.map(r=>r.unregister()))).then(()=>caches.keys()).then(ks=>Promise.all(ks.map(k=>caches.delete(k)))).then(()=>localStorage.clear()).then(()=>location.reload())`);
await sleep(2500);
await evl(`localStorage.setItem('rehab_lang','zh'); location.reload()`);
await sleep(2500);

const chipsTxt = await evl(`[...document.querySelectorAll('#ex-chips .chip')].map(b=>b.textContent).join('|')`);
(chipsTxt.includes('深蹲') && chipsTxt.includes('椅子起坐') && chipsTxt.includes('搬重物') && chipsTxt.includes('上台阶') && chipsTxt.includes('肩上举') && chipsTxt.includes('自定义')) ? ok('7 个内置动作 + 自定义') : bad('动作列表: ' + chipsTxt);
(await evl(`document.getElementById('ex-desc').textContent.includes('标准')`)) ? ok('动作说明含统一标准') : bad('无统一标准说明');

console.log('===== 2. 摄像头（假设备） =====');
await evl(`document.getElementById('btn-start').click()`);
let camOn = false;
for (let i = 0; i < 30; i++) { await sleep(1000); if (await evl(`document.getElementById('btn-start-label').textContent === '停止分析'`)) { camOn = true; break; } }
camOn ? ok('摄像头启动 → 模型加载 → 分析运行') : bad('摄像头流程失败');
(await evl(`document.getElementById('btn-start-label').textContent === '停止分析'`)) ? ok('按钮状态=停止分析') : bad('按钮状态异常');
await evl(`document.getElementById('btn-start').click()`);
await sleep(300);
(await evl(`document.getElementById('btn-start-label').textContent === '开始分析'`)) ? ok('停止恢复开始分析') : bad('停止失败');

console.log('===== 3. 语言切换 =====');
await evl(`document.getElementById('btn-lang').click()`);
await sleep(300);
(await evl(`document.documentElement.lang === 'en'`) && await evl(`document.getElementById('btn-lang').textContent === '中文'`)) ? ok('切英文 + 按钮变「中文」') : bad('切英文失败');
await evl(`document.getElementById('btn-lang').click()`);
await sleep(300);
(await evl(`document.documentElement.lang === 'zh-CN'`)) ? ok('切回中文') : bad('切回中文失败');

console.log('===== 4. 康复计划 + 今日任务 + 目标联动 =====');
await evl(`document.querySelector('.bottom-nav button[data-tab="schedule"]').click()`);
await sleep(150);
await evl(`document.getElementById('btn-plan-add').click()`);
await sleep(200);
await evl(`[...document.querySelectorAll('#plan-days [data-day]')].forEach(b=>{if(!b.classList.contains('on'))b.click()}); document.getElementById('plan-reps').value=10; document.getElementById('btn-plan-save').click()`);
await sleep(250);
(await evl(`document.querySelectorAll('#plan-list .item').length === 1`)) ? ok('计划创建') : bad('计划创建失败');
(await evl(`document.querySelectorAll('#today-plan .item').length === 1`)) ? ok('今日任务出现') : bad('今日任务失败');
await evl(`document.querySelector('#today-plan .todo-check').click()`);
await sleep(200);
(await evl(`document.querySelector('#today-plan .plan-progress-txt').textContent.includes('1 / 1')`)) ? ok('今日任务打卡 1/1') : bad('打卡失败');
await evl(`document.querySelector('.bottom-nav button[data-tab="train"]').click()`);
await sleep(200);
(await evl(`!document.getElementById('goal-line').classList.contains('hidden')`)) ? ok('训练页显示今日目标') : bad('目标条未显示');

console.log('===== 5. 成就全矩阵（9/9 解锁） =====');
const day = 86400000;
const seed = {
  sessions: [...Array(10)].map((_, i) => ({ id: 'f' + i, ts: Date.now() - i * day, ex: i % 3 === 0 ? 'squat' : i % 3 === 1 ? 'lunge' : 'pushup', exName: 'x', reps: 100, dur: 60, depth: 'ok', badPct: 5, valgusPct: 0, riskPct: 0, collectCount: 0 })),
};
const doneMap = {};
[...Array(7)].forEach((_, i) => { const d = new Date(Date.now() - i * day); doneMap[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`] = ['squat']; });
const seedCustom = [{ id: 'c-test', name: '测试动作', icon: 'custom', custom: true, desc: 'x',
  angles: [{ key: 'a1', name: '角度1', type: 'angle', a: 'hip', b: 'knee', c: 'ankle' }, { key: 'a2', name: '角度2', type: 'vertical', a: 'shoulder', b: 'hip' }],
  rules: [{ metric: 'a1', min: 90, max: 125, msgGood: 'ok', msgBad: 'bad' }, { metric: 'a2', min: 0, max: 25, msgGood: 'ok', msgBad: 'bad' }],
  reps: { metric: 'a1', downBelow: 100, upAbove: 150 }, labelSet: ['good', 'bad'] }];
await evl(`localStorage.setItem('rehab_sessions', JSON.stringify(${JSON.stringify(seed.sessions)}));
localStorage.setItem('rehab_plan_done', JSON.stringify(${JSON.stringify(doneMap)}));
localStorage.setItem('rehab_custom_ex', JSON.stringify(${JSON.stringify(seedCustom)}));
localStorage.setItem('rehab_collect', JSON.stringify(${JSON.stringify([...Array(50)].map(() => ({ ex: 'squat', feats: [90, 120, 10, 0.1], label: 'good' })))}));
location.reload()`);
await sleep(2500);
await evl(`document.querySelector('.bottom-nav button[data-tab="record"]').click()`);
await sleep(300);
const achOn = await evl(`document.querySelectorAll('#ach-grid .ach-item.on').length`);
achOn === 9 ? ok('成就 9/9 全部解锁') : bad('成就解锁 ' + achOn + '/9');
(await evl(`document.querySelectorAll('#dist-chart .dist-row').length === 3`)) ? ok('动作分布 3 个动作') : bad('分布图异常');

console.log('===== 6. 评估 + 趋势 + 删除 =====');
await evl(`document.querySelector('.bottom-nav button[data-tab="assess"]').click()`);
await sleep(150);
await evl(`document.getElementById('btn-assess').click()`);
await sleep(250);
(await evl(`!document.getElementById('assess-result').classList.contains('hidden')`)) ? ok('评估报告生成') : bad('评估报告失败');
(await evl(`document.querySelectorAll('#assess-list .item').length === 1`)) ? ok('历史评估 1 条') : bad('历史评估失败');
(await evl(`document.querySelectorAll('#assess-trend svg').length === 1`)) ? ok('评估趋势图') : bad('趋势图失败');
await evl(`document.querySelector('#assess-list .del').click()`);
await sleep(200);
(await evl(`document.querySelectorAll('#assess-list .item').length === 0`)) ? ok('删除评估') : bad('删除评估失败');

console.log('===== 7. 预约：今天/明天/已过期 + 删除 =====');
await evl(`document.querySelector('.bottom-nav button[data-tab="schedule"]').click()`);
await sleep(150);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const t = new Date(), tm = new Date(Date.now() + day), ty = new Date(Date.now() - day);
await evl(`(() => {
  const add = (date, time, place) => { document.getElementById('appt-date').value = date; document.getElementById('appt-time').value = time; document.getElementById('appt-place').value = place; document.getElementById('appt-form').requestSubmit(); };
  add('${iso(t)}', '23:59', '今天诊所'); add('${iso(tm)}', '09:00', '明天诊所'); add('${iso(ty)}', '10:00', '过去诊所');
})()`);
await sleep(250);
const apptTxt = await evl(`document.getElementById('appt-list').textContent.replace(/\\s+/g, ' ')`);
(apptTxt.includes('今天') && apptTxt.includes('明天') && apptTxt.includes('已过期')) ? ok('预约三态标签（今天/明天/已过期）') : bad('预约标签: ' + apptTxt);
await evl(`document.querySelector('#appt-list .del').click()`);
await sleep(200);
(await evl(`document.querySelectorAll('#appt-list .item').length === 2`)) ? ok('删除预约') : bad('删除预约失败');

console.log('===== 8. 个人资料 + 自定义动作增改删 =====');
await evl(`localStorage.setItem('rehab_custom_ex','[]'); location.reload()`);
await sleep(2200);
await evl(`document.querySelector('.bottom-nav button[data-tab="settings"]').click()`);
await sleep(150);
await evl(`document.getElementById('pf-name').value='小明'; document.getElementById('pf-goal').value='posture'; document.getElementById('btn-save-profile').click()`);
await sleep(150);
(await evl(`JSON.parse(localStorage.getItem('rehab_profile')).goal === 'posture'`)) ? ok('资料保存') : bad('资料失败');
await evl(`document.getElementById('btn-new-custom').click()`);
await sleep(200);
await evl(`document.getElementById('cf-name').value='单腿蹲'; document.getElementById('cf-save').click()`);
await sleep(250);
(await evl(`document.querySelectorAll('#custom-list .item').length === 1`)) ? ok('自定义创建') : bad('自定义创建失败');
await evl(`document.querySelector('#custom-list [data-edit]').click()`);
await sleep(200);
await evl(`document.getElementById('cf-name').value='单腿蹲改'; document.getElementById('cf-save').click()`);
await sleep(250);
(await evl(`document.querySelector('#custom-list .item').textContent.includes('单腿蹲改')`)) ? ok('自定义编辑') : bad('自定义编辑失败');
await evl(`document.querySelector('#custom-list [data-del]').click()`);
await sleep(300);
(await evl(`document.querySelectorAll('#custom-list .item').length === 0`)) ? ok('自定义删除（确认弹窗）') : bad('自定义删除失败');

console.log('===== 9. 备份：CSV 导出 + JSON 导入 + 清空 =====');
await evl(`document.getElementById('btn-export-collect').click()`);
await sleep(800);
downloads.some((f) => f.endsWith('.csv')) ? ok('采集 CSV 导出（下载捕获: ' + downloads[downloads.length - 1] + '）') : bad('CSV 导出失败: ' + JSON.stringify(downloads));
const bakPath = join(dlDir, 'backup.json');
writeFileSync(bakPath, JSON.stringify({ app: 'RehabAI', version: 2, sessions: [{ id: 'imp1', ts: Date.now(), ex: 'lunge', exName: '弓步蹲', reps: 9, dur: 60, depth: 'ok', badPct: 0, valgusPct: 0, riskPct: 0, collectCount: 0 }], assessments: [], appts: [], customExercises: [] }));
await setFiles('#import-input', bakPath);
await sleep(600);
(await evl(`JSON.parse(localStorage.getItem('rehab_sessions')).some(s => s.id === 'imp1')`)) ? ok('JSON 备份导入') : bad('导入失败');
await evl(`document.getElementById('btn-clear').click()`);
await sleep(400);
(await evl(`!localStorage.getItem('rehab_sessions')`)) ? ok('清空全部数据（确认弹窗）') : bad('清空失败');

console.log('===== 10. 账号系统（登录屏 + mock Supabase 端到端） =====');
// 通过设置页账号卡片 → 打开登录屏 → 首次配置服务器
await evl(`document.getElementById('btn-config-server').click()`);
await sleep(250);
await evl(`document.getElementById('auth-url').value='http://127.0.0.1:8555'; document.getElementById('auth-key').value='test-anon-key'; document.getElementById('btn-auth-cfg-save').click()`);
await sleep(300);
(await evl(`!document.getElementById('auth-form').classList.contains('hidden')`)) ? ok('登录屏显示登录表单（首次配置后）') : bad('登录表单未出现');
// 注册
await evl(`document.getElementById('auth-email').value='fulltest@t.com'; document.getElementById('auth-pass').value='pw123456'; document.getElementById('btn-auth-signup').click()`);
await waitToast();
(await evl(`document.getElementById('auth-screen').classList.contains('hidden')`)) ? ok('注册成功直接进入主界面') : bad('注册后未进入主界面');
(await evl(`document.getElementById('cloud-status').textContent.includes('fulltest@t.com')`)) ? ok('账号卡片显示邮箱') : bad('账号卡片邮箱缺失');
// 推送
await evl(`localStorage.setItem('rehab_sessions', JSON.stringify([{ id: 'cloud1', ts: Date.now(), ex: 'squat', exName: '深蹲', reps: 12, dur: 60, depth: 'ok', badPct: 3, valgusPct: 0, riskPct: 0, collectCount: 0 }]))`);
await evl(`document.getElementById('btn-cloud-sync').click()`);
await sleep(1200);
// 换设备恢复
await evl(`localStorage.setItem('rehab_sessions','[]'); location.reload()`);
await sleep(2200);
await evl(`document.querySelector('.bottom-nav button[data-tab="settings"]').click()`);
await sleep(200);
await evl(`document.getElementById('btn-cloud-sync').click()`);
await sleep(1200);
(await evl(`JSON.parse(localStorage.getItem('rehab_sessions')).length === 1`)) ? ok('云端数据恢复（换设备）') : bad('云恢复失败');
// 退出登录 → 重新加载 → 启动即显示登录页（真实 App 体验）
await evl(`document.getElementById('btn-cloud-logout').click()`);
await sleep(300);
await evl(`location.reload()`);
await sleep(2500);
(await evl(`!document.getElementById('auth-screen').classList.contains('hidden')`)) ? ok('启动即显示登录页') : bad('登录页未在启动时出现');
await evl(`document.getElementById('auth-email').value='fulltest@t.com'; document.getElementById('auth-pass').value='pw123456'; document.getElementById('btn-auth-login').click()`);
await waitToast();
(await evl(`document.getElementById('auth-screen').classList.contains('hidden')`)) ? ok('重新登录直接进入主界面') : bad('重新登录失败');

console.log('===== 11. 二维码同步 + 警报 UI + PWA + 微信提示 =====');
await send('Page.navigate', { url: APP + '?synctest=1' });
await sleep(4500);
(await evl(`!document.getElementById('selftest-out').textContent.includes('❌')`)) ? ok('二维码同步自检（5 项）') : bad('同步自检失败');
await send('Page.navigate', { url: APP + '?alarmtest=1' });
await sleep(2500);
(await evl(`document.querySelector('#feedback').classList.contains('alarm')`)) ? ok('警报 UI（红色闪烁+警报声）') : bad('警报 UI 失败');
(await (await fetch(APP.replace('index.html', 'manifest.json'))).ok) ? ok('PWA manifest 可访问') : bad('manifest 失败');
await send('Page.navigate', { url: APP });
await sleep(2500);
(await evl(`navigator.serviceWorker.getRegistration().then(r => !!r)`)) ? ok('Service Worker 注册') : bad('SW 注册失败');
await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14) MicroMessenger/8.0.49' });
await evl(`location.reload()`);
await sleep(2500);
(await evl(`document.getElementById('feedback').textContent.includes('微信')`)) ? ok('微信浏览器提示') : bad('微信提示失败');
await send('Emulation.setUserAgentOverride', { userAgent: '' });

console.log('===== 12. 上市要素：版本/隐私/免责/分享 =====');
await send('Page.navigate', { url: APP });
await sleep(2500);
await evl(`document.querySelector('.bottom-nav button[data-tab="settings"]').click()`);
await sleep(200);
(await evl(`document.getElementById('about-version').textContent.includes('v2.8')`)) ? ok('版本号显示') : bad('版本号失败');
(await evl(`document.getElementById('tab-settings').textContent.includes('隐私政策') && document.getElementById('tab-settings').textContent.includes('免责声明')`)) ? ok('隐私政策 + 免责声明') : bad('法务文案缺失');
await evl(`document.getElementById('btn-share').click()`);
await sleep(400);
(await evl(`document.getElementById('toast') ? document.getElementById('toast').textContent.includes('复制') : false`)) ? ok('分享按钮（复制链接）') : bad('分享失败');

console.log('===== 结果 =====');
console.log('CONSOLE_ERRORS:', consoleErrors.length ? consoleErrors.join(' ||| ') : 'none');
if (consoleErrors.length) failN++;
console.log(`PASS ${pass} / FAIL ${failN} / 总计 ${pass + failN}`);
ws.close();
process.exit(failN ? 1 : 0);
