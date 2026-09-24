// 上市级完整系统验收测试（CDP）——覆盖全部功能模块
// 前置：8000 静态服务器 + 9228 无头 Chrome（带假摄像头）+ 8555 mock-supabase
import { writeFileSync, mkdtempSync, readFileSync, readdirSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// v2.21.9：全程日志落盘 tests/_last-run.txt —— 终端/任务输出会被截断时仍能读全量结果
const LOG_FILE = join(dirname(fileURLToPath(import.meta.url)), '_last-run.txt');
try { writeFileSync(LOG_FILE, ''); } catch { /* ignore */ }
const rawLog = console.log.bind(console);
console.log = (...a) => { rawLog(...a); try { appendFileSync(LOG_FILE, a.join(' ') + '\n'); } catch { /* ignore */ } };

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
(chipsTxt.includes('深蹲') && chipsTxt.includes('椅子起坐') && chipsTxt.includes('搬重物') && chipsTxt.includes('上台阶') && chipsTxt.includes('肩上举') && chipsTxt.includes('站姿') && chipsTxt.includes('坐姿') && chipsTxt.includes('自定义')) ? ok('9 个内置动作（含站姿/坐姿）+ 自定义') : bad('动作列表: ' + chipsTxt);
(await evl(`document.getElementById('ex-desc').textContent.includes('标准')`)) ? ok('动作说明含统一标准') : bad('无统一标准说明');

console.log('===== 2. 摄像头（假设备） =====');
await evl(`document.getElementById('btn-start').click()`);
let camOn = false;
for (let i = 0; i < 30; i++) { await sleep(1000); if (await evl(`document.getElementById('btn-start-label').textContent === '停止分析'`)) { camOn = true; break; } }
camOn ? ok('摄像头启动 → 模型加载 → 分析运行') : bad('摄像头流程失败');
(await evl(`document.getElementById('btn-start-label').textContent === '停止分析'`)) ? ok('按钮状态=停止分析') : bad('按钮状态异常');
(await evl(`!document.getElementById('train-timer').classList.contains('hidden') && document.getElementById('train-timer').textContent.includes('⏱')`)) ? ok('训练时长计时器显示（画面角标）') : bad('计时器缺失');
await evl(`document.getElementById('btn-start').click()`);
await sleep(900);
(await evl(`document.getElementById('btn-start-label').textContent === '开始分析'`)) ? ok('停止恢复开始分析') : bad('停止失败');
(await evl(`document.getElementById('train-timer').classList.contains('hidden')`)) ? ok('停止后计时器隐藏') : bad('计时器未隐藏');
(await evl(`document.getElementById('stats-box').classList.contains('hidden') && document.getElementById('feedback').classList.contains('hidden')`)) ? ok('停止后统计与提示面板清空（无过期残留）') : bad('停止后残留面板');
(await evl(`(() => { const c = document.getElementById('overlay'); const ctx = c.getContext('2d'); const d = ctx.getImageData(0, 0, c.width, c.height).data; let sum = 0; for (let i = 3; i < d.length; i += 4) sum += d[i]; return sum === 0 && !document.getElementById('placeholder').classList.contains('hidden'); })()`)) ? ok('停止后画面清空+占位图恢复（无残留火柴人）') : bad('停止后画面残留');
// 语言切换后成就与 AI 卡片也切换
await evl(`document.getElementById('btn-lang').click()`);
await sleep(300);
(await evl(`document.getElementById('ai-card').textContent.includes('AI System Manager')`)) ? ok('切英文后 AI 卡片同步翻译') : bad('AI 卡片未翻译');
(await evl(`document.getElementById('ach-grid').textContent.includes('First session') || document.getElementById('ach-grid').textContent.includes('Completed your first')`)) ? ok('切英文后成就网格同步翻译') : bad('成就网格未翻译');
await evl(`document.getElementById('btn-lang').click()`);   // 切回中文，恢复后续测试基线
await sleep(300);

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
(await evl(`document.getElementById('plan-list').textContent.includes('本周') && document.getElementById('plan-list').querySelector('.plan-bar') != null`)) ? ok('计划条目显示本周完成进度条') : bad('计划进度缺失');
(await evl(`document.querySelectorAll('#today-plan .item').length === 1`)) ? ok('今日任务出现') : bad('今日任务失败');
await evl(`document.querySelector('#today-plan .todo-check').click()`);
await sleep(200);
(await evl(`document.querySelector('#today-plan .plan-progress-txt').textContent.includes('1 / 1')`)) ? ok('今日任务打卡 1/1') : bad('打卡失败');
await evl(`document.querySelector('.bottom-nav button[data-tab="train"]').click()`);
await sleep(200);
await evl(`document.querySelector('.chip[data-ex="squat"]').click()`);   // 智能识别默认站姿，切到计划对应的深蹲
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
(await evl(`document.getElementById('ach-count').textContent.includes('9/9')`)) ? ok('成就解锁进度显示 9/9') : bad('成就进度缺失');
(await evl(`document.querySelectorAll('#dist-chart .dist-row').length === 3`)) ? ok('动作分布 3 个动作') : bad('分布图异常');
(await evl(`document.getElementById('dist-chart').textContent.includes('%')`)) ? ok('动作分布显示占比') : bad('占比缺失');
(await evl(`document.getElementById('week-best').textContent.includes('最多') || document.getElementById('week-best').textContent.includes('Best')`)) ? ok('本周单日最佳显示') : bad('周最佳缺失');

console.log('===== 6. 评估 + 趋势 + 删除 =====');
await evl(`document.querySelector('.bottom-nav button[data-tab="assess"]').click()`);
await sleep(150);
await evl(`document.getElementById('btn-assess').click()`);
await sleep(250);
(await evl(`!document.getElementById('assess-result').classList.contains('hidden')`)) ? ok('评估报告生成') : bad('评估报告失败');
(await evl(`document.getElementById('assess-result').textContent.includes('状态良好')`)) ? ok('评估报告带等级（状态良好）') : bad('评估等级缺失');
(await evl(`document.querySelectorAll('#assess-list .item').length === 1`)) ? ok('历史评估 1 条') : bad('历史评估失败');
// 第二次评估（改动疼痛答案 0→1）→ 与上次对比
await evl(`(() => { const seg = document.querySelector('#tab-assess .seg[data-q="pain"]'); seg.querySelector('button[data-v="1"]').click(); return true; })()`);
await evl(`document.getElementById('btn-assess').click()`);
await sleep(250);
(await evl(`document.getElementById('assess-result').textContent.includes('较上次')`)) ? ok('评估报告与上次对比（↑需关注）') : bad('评估对比缺失');
(await evl(`document.querySelectorAll('#assess-list .item').length === 2`)) ? ok('历史评估 2 条') : bad('历史评估计数失败');
(await evl(`document.querySelectorAll('#assess-trend svg').length === 1`)) ? ok('评估趋势图') : bad('趋势图失败');
await evl(`document.querySelector('#assess-list .del').click()`);
await sleep(200);
await evl(`document.querySelector('#assess-list .del').click()`);
await sleep(200);
(await evl(`document.querySelectorAll('#assess-list .item').length === 0`)) ? ok('删除评估（带确认）') : bad('删除评估失败');

console.log('===== 7. 预约：今天/明天/已过期 + 删除 =====');
await evl(`document.querySelector('.bottom-nav button[data-tab="schedule"]').click()`);
await sleep(150);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const t = new Date(), tm = new Date(Date.now() + day), ty = new Date(Date.now() - day), t3 = new Date(Date.now() + 3 * day);
await evl(`(() => {
  const add = (date, time, place) => { document.getElementById('appt-date').value = date; document.getElementById('appt-time').value = time; document.getElementById('appt-place').value = place; document.getElementById('appt-form').requestSubmit(); };
  add('${iso(t)}', '23:59', '今天诊所'); add('${iso(tm)}', '09:00', '明天诊所'); add('${iso(ty)}', '10:00', '过去诊所'); add('${iso(t3)}', '14:00', '未来诊所');
})()`);
await sleep(250);
const apptTxt = await evl(`document.getElementById('appt-list').textContent.replace(/\\s+/g, ' ')`);
(apptTxt.includes('今天') && apptTxt.includes('明天') && apptTxt.includes('已过期')) ? ok('预约三态标签（今天/明天/已过期）') : bad('预约标签: ' + apptTxt);
(apptTxt.includes('天后') || apptTxt.includes('in ')) ? ok('未来预约显示「N 天后」倒计时') : bad('未来预约标签缺失');
await evl(`document.querySelector('#appt-list .del').click()`);
await sleep(200);
(await evl(`document.querySelectorAll('#appt-list .item').length === 3`)) ? ok('删除预约（带确认）') : bad('删除预约失败');

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

console.log('===== 9b. 设置模块细化（v2.21.9：数据占用/备份完整性/导入确认/清空完整性/版本号/同步数据面） =====');
// 数据占用：总量 + 分类明细（进入设置页自动刷新）
await evl(`document.querySelector('.bottom-nav button[data-tab="settings"]').click()`);
await sleep(250);
(await evl(`/KB|MB|B/.test(document.getElementById('storage-size').textContent) && document.getElementById('storage-break').textContent.length > 5`)) ? ok('数据占用：总量 + 分类明细（记录/采集/自定义/其他）') : bad('数据占用缺失');
// 备份内容完整性：导出 JSON 必须含 计划/打卡/资料/功能测试/体态/指数
await evl(`(() => {
  localStorage.setItem('rehab_plan', JSON.stringify([{ id: 'bp1', ex: 'squat', reps: 8, days: [1] }]));
  localStorage.setItem('rehab_plan_done', JSON.stringify({ '2026-01-01': ['squat'] }));
  localStorage.setItem('rehab_profile', JSON.stringify({ name: '备份前', goal: 'knee', injury: '' }));
  localStorage.setItem('rehab_ft_history', JSON.stringify([{ key: 'squat', ts: 1700000000000, score: 80, dims: {}, m: {}, issues: [], sim: 80, curve: [], ref: [] }]));
  localStorage.setItem('rehab_pa_history', JSON.stringify([{ kind: 'standing', ts: 1700000000001, score: 75, grade: 'B', items: [], priorities: [] }]));
  localStorage.setItem('rehab_home_idx', JSON.stringify([{ d: '2026-01-01', v: 60 }]));
  return true;
})()`);
await evl(`document.getElementById('btn-export').click()`);
await sleep(900);
let bakJson = null;
for (const fname of downloads.filter((x) => x.endsWith('.json'))) {
  try { bakJson = JSON.parse(readFileSync(join(dlDir, fname), 'utf8')); break; } catch { /* 换下一个候选 */ }
}
if (!bakJson) {
  try { const cand = readdirSync(dlDir).find((x) => x.endsWith('.json')); if (cand) bakJson = JSON.parse(readFileSync(join(dlDir, cand), 'utf8')); } catch { /* ignore */ }
}
(bakJson && Array.isArray(bakJson.plan) && bakJson.planDone && bakJson.profile && Array.isArray(bakJson.ftHistory) && Array.isArray(bakJson.paHistory) && Array.isArray(bakJson.homeIdx)) ? ok('备份 JSON 完整（计划/打卡/资料/功能测试/体态/指数历史全含）') : bad('备份缺字段: ' + JSON.stringify(bakJson && Object.keys(bakJson)));
(await evl(`document.getElementById('last-backup').textContent.includes('今天')`)) ? ok('备份卡显示「上次导出备份：今天」') : bad('上次备份提示缺失');
// 导入：新格式备份可恢复全部数据（含确认弹窗）
const bakFull = join(dlDir, 'backup-full.json');
writeFileSync(bakFull, JSON.stringify({ app: 'RehabAI', version: 3, sessions: [], assessments: [], appts: [], customExercises: [], plan: [{ id: 'p9', ex: 'lunge', reps: 6, days: [0, 1, 2, 3, 4, 5, 6] }], planDone: {}, profile: { name: '备份小明', goal: 'knee', injury: '' }, ftHistory: [{ key: 'arm', ts: 1700000000000, score: 66, dims: {}, m: {}, issues: [], sim: 66, curve: [], ref: [] }], paHistory: [{ kind: 'walk', ts: 1700000000001, score: 70, grade: 'B', items: [], priorities: [] }], homeIdx: [{ d: '2026-01-02', v: 55 }] }));
await setFiles('#import-input', bakFull);
await sleep(800);
(await evl(`(() => { const L = (k) => JSON.parse(localStorage.getItem(k) || '[]'); return L('rehab_plan').some((p) => p.id === 'p9') && L('rehab_ft_history').some((r) => r.key === 'arm') && L('rehab_pa_history').some((r) => r.kind === 'walk') && L('rehab_home_idx').some((r) => r.d === '2026-01-02' && r.v === 55) && JSON.parse(localStorage.getItem('rehab_profile') || '{}').name === '备份小明'; })()`)) ? ok('导入备份：计划/资料/功能测试/体态/指数全部恢复（含确认弹窗）') : bad('导入恢复不全');
(await evl(`document.getElementById('storage-break').textContent.length > 5`)) ? ok('导入后数据占用自动刷新') : bad('导入后占用未刷新');
// 清空完整性：功能测试/体态/指数历史也一并清除
await evl(`document.getElementById('btn-clear').click()`);
await sleep(500);
(await evl(`!localStorage.getItem('rehab_sessions') && !localStorage.getItem('rehab_plan') && !localStorage.getItem('rehab_ft_history') && !localStorage.getItem('rehab_pa_history') && !localStorage.getItem('rehab_home_idx')`)) ? ok('清空全部数据：含功能测试/体态/指数历史（无残留）') : bad('清空不完整');
// 关于页版本号随语言切换（原实现只在启动时设置一次）
await evl(`document.getElementById('btn-lang').click()`);
await sleep(450);
(await evl(`document.getElementById('about-version').textContent.startsWith('Version')`)) ? ok('关于页版本号随语言切换（Version）') : bad('版本号未随语言切换');
await evl(`document.getElementById('btn-lang').click()`);
await sleep(450);
(await evl(`document.getElementById('about-version').textContent.includes('版本')`)) ? ok('版本号切回中文') : bad('版本号回中文失败');
// 二维码同步：空判据补齐（只有功能测试历史也能发起同步）
await evl(`(() => { localStorage.setItem('rehab_ft_history', JSON.stringify([{ key: 'squat', ts: 1700000000000, score: 80, dims: {}, m: {}, issues: [], sim: 80, curve: [], ref: [] }])); return true; })()`);
await evl(`document.getElementById('btn-sync-show').click()`);
await sleep(900);
(await evl(`!document.getElementById('qr-modal').classList.contains('hidden')`)) ? ok('二维码同步：仅功能测试历史也能发起（空判据已补齐）') : bad('同步空判据未更新');
await evl(`document.getElementById('qr-close').click()`);
await sleep(200);
await evl(`['rehab_sessions','rehab_plan','rehab_plan_done','rehab_profile','rehab_ft_history','rehab_pa_history','rehab_home_idx'].forEach((k) => localStorage.removeItem(k))`);

console.log('===== 10. 账号系统（本地账号 + 登录屏 + mock Supabase） =====');
// 启动即应显示登录屏（未登录 + 未跳过）
(await evl(`!document.getElementById('auth-screen').classList.contains('hidden')`)) ? ok('启动即显示登录页') : bad('登录页未在启动时出现');
// 首次配置服务器（登录屏内，测试用开发入口解锁）
await evl(`document.getElementById('btn-auth-cfg-toggle').classList.remove('hidden'); document.getElementById('btn-auth-cfg-toggle').click()`);
await sleep(250);
await evl(`document.getElementById('auth-url').value='http://127.0.0.1:8555'; document.getElementById('auth-key').value='test-anon-key'; document.getElementById('btn-auth-cfg-save').click()`);
await sleep(300);
(await evl(`!document.getElementById('auth-form').classList.contains('hidden')`)) ? ok('配置后显示登录表单') : bad('登录表单未出现');
// 本地账号注册（同时自动注册云端账号）
await evl(`document.getElementById('auth-email').value='fulltest@t.com'; document.getElementById('auth-pass').value='pw123456'; document.getElementById('btn-auth-signup').click()`);
await sleep(2000);
(await evl(`document.getElementById('auth-screen').classList.contains('hidden')`)) ? ok('注册成功直接进入主界面') : bad('注册后未进入主界面');
(await evl(`document.getElementById('cloud-status').textContent.includes('fulltest@t.com')`)) ? ok('账号卡片显示邮箱') : bad('账号卡片邮箱缺失');
(await evl(`JSON.parse(localStorage.getItem('rehab_accounts')).hasOwnProperty('fulltest@t.com')`)) ? ok('本地账号已加密保存(PBKDF2)') : bad('本地账号缺失');
// 推送（写入账号分区）
await evl(`(() => { const u = JSON.parse(localStorage.getItem('rehab_current_user')); const uk = (k) => 'u:' + u + ':' + k; localStorage.setItem(uk('rehab_sessions'), JSON.stringify([{ id: 'cloud1', ts: Date.now(), ex: 'squat', exName: '深蹲', reps: 12, dur: 60, depth: 'ok', badPct: 3, valgusPct: 0, riskPct: 0, collectCount: 0 }])); })()`);
await evl(`document.getElementById('btn-cloud-sync').click()`);
await sleep(1200);
// 换设备恢复
await evl(`(() => { const u = JSON.parse(localStorage.getItem('rehab_current_user')); localStorage.removeItem('u:' + u + ':rehab_sessions'); })()`);
await evl(`location.reload()`);
await sleep(2200);
await evl(`document.querySelector('.bottom-nav button[data-tab="settings"]').click()`);
await sleep(200);
await evl(`document.getElementById('btn-cloud-sync').click()`);
await sleep(1200);
(await evl(`(() => { const u = JSON.parse(localStorage.getItem('rehab_current_user')); return JSON.parse(localStorage.getItem('u:' + u + ':rehab_sessions')).length; })() === 1`)) ? ok('云端数据恢复（换设备）') : bad('云恢复失败');
// 退出登录 → 重新加载 → 启动即显示登录页
await evl(`document.getElementById('btn-cloud-logout').click()`);
await sleep(300);
await evl(`location.reload()`);
await sleep(2500);
(await evl(`!document.getElementById('auth-screen').classList.contains('hidden')`)) ? ok('退出后启动再次显示登录页') : bad('登录页未出现');
// 重新登录
await evl(`document.getElementById('auth-email').value='fulltest@t.com'; document.getElementById('auth-pass').value='pw123456'; document.getElementById('btn-auth-login').click()`);
await sleep(2000);
(await evl(`document.getElementById('auth-screen').classList.contains('hidden')`)) ? ok('重新登录直接进入主界面') : bad('重新登录失败');
(await evl(`(() => { const u = JSON.parse(localStorage.getItem('rehab_current_user')); return JSON.parse(localStorage.getItem('u:' + u + ':rehab_sessions')).length; })() === 1`)) ? ok('登录后账号数据自动恢复(云端拉回)') : bad('账号数据未恢复');
// 采集缓冲区账号隔离（防串数据）：A 有 1 条 → 退出归零 → 重新登录恢复 1 条
await evl(`(() => { const u = JSON.parse(localStorage.getItem('rehab_current_user')); localStorage.setItem('u:' + u + ':rehab_collect', JSON.stringify([{ex:'squat',feats:[1],label:'good'}])); location.reload(); })()`);
await sleep(2500);
(await evl(`document.getElementById('collect-count').textContent.includes('1')`)) ? ok('采集缓冲区随账号加载') : bad('缓冲区未加载');
await evl(`document.getElementById('btn-cloud-logout').click()`);
await sleep(300);
(await evl(`document.getElementById('collect-count').textContent.includes('0')`)) ? ok('退出账号缓冲区归零（防串数据）') : bad('缓冲区串数据');
await evl(`document.getElementById('auth-email').value='fulltest@t.com'; document.getElementById('auth-pass').value='pw123456'; document.getElementById('btn-auth-login').click()`);
await sleep(2000);
(await evl(`document.getElementById('collect-count').textContent.includes('1')`)) ? ok('重新登录缓冲区恢复') : bad('登录未恢复缓冲区');
// 删除账号（Play 政策要求）：确认弹窗 → 数据清除 + 回登录页
await evl(`document.querySelector('.bottom-nav button[data-tab="settings"]').click()`);
await sleep(200);
await evl(`document.getElementById('btn-delete-account').click()`);
await sleep(800);
(await evl(`(() => { const u = JSON.parse(localStorage.getItem('rehab_current_user') || 'null'); const acc = JSON.parse(localStorage.getItem('rehab_accounts') || '{}'); return u === null && localStorage.getItem('u:fulltest@t.com:rehab_sessions') === null && !acc['fulltest@t.com']; })()`)) ? ok('删除账号：数据清除 + 账号注销') : bad('删除账号失败');
(await evl(`!document.getElementById('auth-screen').classList.contains('hidden')`)) ? ok('删除后回到登录页') : bad('删除后未回登录页');

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
(await evl(`/v\\d+\\.\\d+/.test(document.getElementById('about-version').textContent)`)) ? ok('版本号显示') : bad('版本号失败');
(await evl(`document.getElementById('tab-settings').textContent.includes('隐私政策') && document.getElementById('tab-settings').textContent.includes('免责声明')`)) ? ok('隐私政策 + 免责声明') : bad('法务文案缺失');
await evl(`document.getElementById('btn-share').click()`);
await sleep(400);
(await evl(`document.getElementById('toast') ? document.getElementById('toast').textContent.includes('复制') : false`)) ? ok('分享按钮（复制链接）') : bad('分享失败');

console.log('===== 13. 自主更新 =====');
(await evl(`!!document.getElementById('btn-check-update')`)) ? ok('「检查更新」按钮存在') : bad('检查更新按钮缺失');
await evl(`document.getElementById('btn-check-update').click()`);
await sleep(4500);
(await evl(`(() => { const t = document.getElementById('toast'); return t && /更新|最新|update|Update/i.test(t.textContent); })()`)) ? ok('检查更新有反馈（离线时优雅失败）') : bad('检查更新无反馈');

console.log('===== 14. AI 系统管家 =====');
await evl(`document.querySelector('.bottom-nav button[data-tab="settings"]').click()`);
await sleep(600);
(await evl(`(() => { const c = document.getElementById('ai-card'); return c && c.textContent.includes('/100') && c.textContent.includes('AI'); })()`)) ? ok('AI 管家卡片（健康评分+建议）') : bad('AI 卡片缺失');
await evl(`document.getElementById('btn-ai-check').click()`);
await sleep(300);
(await evl(`(() => { const t = document.getElementById('toast'); return t && /评分|score/i.test(t.textContent); })()`)) ? ok('AI 立即体检有反馈') : bad('体检无反馈');
await evl(`document.getElementById('btn-ai-fb').click()`);
await sleep(300);
(await evl(`!document.getElementById('fb-modal').classList.contains('hidden') && document.getElementById('fb-report').textContent.includes('系统体检')`)) ? ok('反馈弹窗 + 自动附体检报告') : bad('反馈弹窗失败');
await evl(`document.getElementById('btn-fb-copy').click()`);
await sleep(400);
(await evl(`(() => { const t = document.getElementById('toast'); return t && /复制|Copied/i.test(t.textContent); })()`)) ? ok('复制反馈报告') : bad('复制报告失败');
await evl(`document.getElementById('btn-fb-close').click()`);
await evl(`document.getElementById('upd-mode').value = 'prompt'; document.getElementById('upd-mode').dispatchEvent(new Event('change'))`);
await sleep(200);
(await evl(`JSON.parse(localStorage.getItem('rehab_upd_mode')) === 'prompt'`)) ? ok('更新方式可切换并保存') : bad('更新方式保存失败');

console.log('===== 15. 更新卡片 UI（模拟新版本） =====');
await send('Page.navigate', { url: APP + '?updatetest=1' });
await sleep(2500);
(await evl(`document.getElementById('feedback').textContent.includes('9.9.9')`)) ? ok('更新卡片：新版本号显示') : bad('更新卡片版本号失败');
(await evl(`document.getElementById('feedback').textContent.includes('TestNotes')`)) ? ok('更新卡片：版本说明显示') : bad('更新说明失败');
(await evl(`!!document.getElementById('btn-upd-now') && !!document.getElementById('btn-upd-later')`)) ? ok('更新卡片：两个按钮齐全') : bad('更新按钮缺失');
await evl(`document.getElementById('btn-upd-later').click()`);
await sleep(200);
(await evl(`document.getElementById('feedback').classList.contains('hidden')`)) ? ok('「稍后再说」关闭卡片') : bad('稍后按钮失败');
await send('Page.navigate', { url: APP + '?updatetest=1' });
await sleep(2500);
await evl(`document.querySelector('.bottom-nav button[data-tab="settings"]').click()`);
await sleep(300);
(await evl(`document.getElementById('ai-card').textContent.includes('9.9.9')`)) ? ok('AI 管家感知新版本（重要更新）') : bad('AI 未感知新版本');

console.log('===== 16. 新增功能（v2.18：倒计时/休息/久坐提醒/AI计划） =====');
await send('Page.navigate', { url: APP });
await sleep(2500);
// AI 一键生成计划
await evl(`document.querySelector('.bottom-nav button[data-tab="schedule"]').click()`);
await sleep(200);
await evl(`document.getElementById('btn-ai-plan').click()`);
await sleep(300);
(await evl(`document.querySelectorAll('#plan-list .item').length >= 3`)) ? ok('AI 一键生成康复计划') : bad('AI 计划失败');
// 久坐提醒设置
await evl(`document.querySelector('.bottom-nav button[data-tab="settings"]').click()`);
await sleep(200);
(await evl(`!!document.getElementById('btn-sed-toggle') && !!document.getElementById('sed-interval')`)) ? ok('久坐提醒设置存在') : bad('久坐设置缺失');
await evl(`document.getElementById('btn-sed-toggle').click()`);
await sleep(150);
(await evl(`JSON.parse(localStorage.getItem('rehab_sedentary')).on === true`)) ? ok('久坐提醒可开启') : bad('久坐提醒开启失败');
await evl(`document.getElementById('btn-sed-toggle').click()`);
// 组间休息计时器
await evl(`document.querySelector('.bottom-nav button[data-tab="train"]').click()`);
await sleep(200);
await evl(`document.getElementById('btn-rest').click()`);
await sleep(300);
(await evl(`document.getElementById('feedback').textContent.includes('休息')`)) ? ok('组间休息计时器') : bad('休息计时失败');
await evl(`document.getElementById('btn-rest').click()`);   // 再次点击重置
// 3-2-1 倒计时不影响开始流程
await evl(`document.getElementById('btn-start').click()`);
let started = false;
for (let i = 0; i < 40; i++) { await sleep(1000); if (await evl(`document.getElementById('btn-start-label').textContent === '停止分析'`)) { started = true; break; } }
started ? ok('开始流程（含3-2-1倒计时）正常') : bad('开始流程异常');
await evl(`document.getElementById('btn-start').click()`);
await sleep(400);

console.log('===== 17. 全身体态评估（v2.19：先完整识别再评价 + 指导性报告） =====');
await send('Page.navigate', { url: APP });
await sleep(2500);
// 17a. 体态 tab + 五种体态
await evl(`document.querySelector('.bottom-nav button[data-tab="posture"]').click()`);
await sleep(300);
(await evl(`document.querySelectorAll('#pa-kinds .pa-kind').length === 5`)) ? ok('体态评估页 5 种体态（站立/单腿/深蹲/走路/跑步）') : bad('体态种类缺失');
(await evl(`!!document.getElementById('btn-pa-start') && !!document.getElementById('btn-pa-demo') && !!document.getElementById('pa-gate')`)) ? ok('开始/演示按钮 + 完整性检查面板存在') : bad('体态控件缺失');
// 17b. 演示模式·站立：门控通过 → 报告（评分 + 不足 + 建议）
await evl(`document.querySelector('.pa-kind[data-pa="standing"]').click()`);
await sleep(100);
await evl(`document.getElementById('btn-pa-demo').click()`);
let paReport = false;
for (let i = 0; i < 15; i++) { await sleep(1000); if (await evl(`!document.getElementById('pa-report').classList.contains('hidden')`)) { paReport = true; break; } }
paReport ? ok('演示模式·站立：识别完整后自动生成报告（6 秒稳定门控）') : bad('站立评估未出报告');
(await evl(`(() => { const r = document.getElementById('pa-report'); return /\\d+/.test(r.querySelector('.pa-score-num').textContent) && r.querySelectorAll('.pa-item').length >= 5 && (r.textContent.includes('改进建议') || r.textContent.includes('How to improve')) && r.textContent.includes('%'); })()`)) ? ok('报告含综合评分 + 逐项指标 + 改进建议 + 百分比单位') : bad('报告结构缺失');
(await evl(`JSON.parse(localStorage.getItem('rehab_pa_history')).length === 1`)) ? ok('报告自动存入历史') : bad('历史未保存');
// 17c. 演示模式·走路：步态节律门控（≥6 步）→ 报告含步频
await evl(`document.querySelector('.pa-kind[data-pa="walk"]').click()`);
await sleep(100);
await evl(`document.getElementById('btn-pa-demo').click()`);
let paWalk = false;
for (let i = 0; i < 18; i++) { await sleep(1000); if (await evl(`!document.getElementById('pa-report').classList.contains('hidden')`)) { paWalk = true; break; } }
paWalk ? ok('演示模式·走路：步态节律门控通过后生成报告') : bad('走路评估未出报告');
(await evl(`JSON.parse(localStorage.getItem('rehab_pa_history')).length === 2`)) ? ok('历史累计 2 条') : bad('历史累计失败');
// 17f. 单腿站立：报告识别抬起侧（v2.21.4）
await evl(`document.querySelector('.pa-kind[data-pa="single"]').click()`);
await sleep(100);
await evl(`document.getElementById('btn-pa-demo').click()`);
let paSingle = false;
for (let i = 0; i < 15; i++) { await sleep(1000); if (await evl(`!document.getElementById('pa-report').classList.contains('hidden')`)) { paSingle = true; break; } }
(paSingle && await evl(`document.getElementById('pa-report').textContent.includes('抬右腿')`)) ? ok('单腿站立报告识别抬起侧（抬右腿）') : bad('抬起侧识别缺失');
// 17d. 语言切换：体态页文案随语言变化
await evl(`document.getElementById('btn-lang').click()`);
await sleep(400);
(await evl(`document.getElementById('tab-posture').textContent.includes('Posture Assessment')`)) ? ok('体态页英文切换') : bad('体态页语言切换失败');
await evl(`document.getElementById('btn-lang').click()`);
await sleep(300);
// 17e. 切走自动停止体态会话
await evl(`document.querySelector('.bottom-nav button[data-tab="record"]').click()`);
await sleep(300);
(await evl(`document.getElementById('btn-pa-start-label').textContent !== '停止评估' && document.getElementById('pa-gate').classList.contains('hidden')`)) ? ok('离开体态页自动停止评估+收起检查面板') : bad('离开体态页未停止');

console.log('===== 18. 运动功能测试（v2.20：动态动作运动学 + 知识库 + 档案） =====');
await send('Page.navigate', { url: APP });
await sleep(2500);
await evl(`document.querySelector('.bottom-nav button[data-tab="ft"]').click()`);
await sleep(300);
(await evl(`document.querySelectorAll('#ft-moves .pa-kind').length === 5 && !!document.getElementById('btn-ft-start') && !!document.getElementById('btn-ft-battery') && !!document.getElementById('btn-ft-demo')`)) ? ok('功能测试页：5 动作 + 开始/连测/演示按钮') : bad('功能测试控件缺失');
await evl(`document.querySelector('#ft-moves [data-ft="squat"]').click()`);
await sleep(100);
await evl(`document.getElementById('btn-ft-demo').click()`);
let ftReport = false;
for (let i = 0; i < 20; i++) { await sleep(1000); if (await evl(`!document.getElementById('ft-report').classList.contains('hidden')`)) { ftReport = true; break; } }
ftReport ? ok('演示模式·动态深蹲：全程分析后自动出报告') : bad('深蹲测试未出报告');
(await evl(`(() => { const r = document.getElementById('ft-report'); return /\\d+/.test(r.querySelector('.pa-score-num').textContent) && r.querySelectorAll('.pa-item').length >= 4 && r.textContent.includes('%') && !!r.querySelector('.ft-curve') && r.textContent.includes('你') && r.textContent.includes('标准'); })()`)) ? ok('报告含评分+逐项指标+相似度曲线+图例（你/标准）') : bad('报告结构缺失');
(await evl(`document.getElementById('ft-report').textContent.includes('良好') || document.getElementById('ft-report').textContent.includes('优秀') || document.getElementById('ft-report').textContent.includes('一般') || document.getElementById('ft-report').textContent.includes('需改进')`)) ? ok('相似度带等级评价（优秀/良好/一般/需改进）') : bad('相似度等级缺失');
(await evl(`document.getElementById('ft-history').textContent.includes('/3')`)) ? ok('测试历史显示完成次数（3/3）') : bad('历史次数缺失');
(await evl(`document.getElementById('ft-report').textContent.includes('蚌式开合')`)) ? ok('知识库处方（膝内扣→蚌式开合等训练）') : bad('知识库处方缺失');
(await evl(`JSON.parse(localStorage.getItem('rehab_ft_history')).filter(r => r.key === 'squat').length === 1`)) ? ok('测试记录已存（每动作一条）') : bad('记录未保存');
(await evl(`document.getElementById('ft-profile').textContent.includes('动态深蹲') && !!document.getElementById('ft-profile').querySelector('.ft-table')`)) ? ok('数字人体档案（最新评分+ROM/对称性表）') : bad('人体档案缺失');
await evl(`document.getElementById('btn-lang').click()`);
await sleep(400);
(await evl(`document.getElementById('ft-moves').textContent.includes('Squat') && document.getElementById('ft-moves').textContent.includes('Forward bend')`)) ? ok('功能测试页英文切换') : bad('功能测试语言切换失败');
await evl(`document.getElementById('btn-lang').click()`);
await sleep(300);
await evl(`window.__ftBatteryDemo()`);
let ftBatt = false;
for (let i = 0; i < 110; i++) { await sleep(1000); if (await evl(`JSON.parse(localStorage.getItem('rehab_ft_history') || '[]').some(r => r.battery)`)) { ftBatt = true; break; } }
ftBatt ? ok('完整测试 5 项连测 → 聚合综合记录（六维加权）') : bad('连测未出综合记录');
(await evl(`(() => { const h = JSON.parse(localStorage.getItem('rehab_ft_history') || '[]'); const b = h.find(r => r.battery); return b && b.score >= 0 && b.score <= 100 && !document.getElementById('ft-report').classList.contains('hidden'); })()`)) ? ok('综合报告显示（总分+5 项明细）') : bad('综合报告失败');
(await evl(`document.getElementById('ft-profile').textContent.includes('完整测试报告')`)) ? ok('档案显示最近一次完整测试') : bad('档案未更新');
(await evl(`(() => { const h = JSON.parse(localStorage.getItem('rehab_ft_history') || '[]'); const s = h.find(r => r.key === 'single'); const a = h.find(r => r.key === 'arm'); return s && s.m && s.m.reps === 4 && a && a.m && a.m.reps === 3; })()`)) ? ok('连测·单腿蹲 4 次 + 双臂上举 3 次完整完成（演示缺陷修复）') : bad('连测演示次数异常');

console.log('===== 19. 今日总览 + AI 跟练（v2.21：Tonal/Tempo 对标） =====');
await send('Page.navigate', { url: APP });
await sleep(2500);
await evl(`document.querySelector('.bottom-nav button[data-tab="home"]').click()`);
await sleep(300);
(await evl(`document.getElementById('home-index').textContent.length > 20`)) ? ok('今日页：综合运动指数卡渲染（含数据或引导文案）') : bad('指数卡缺失');
(await evl(`document.querySelectorAll('#home-heat .hm-cell').length === 30`)) ? ok('30 天坚持热力图（30 格）') : bad('热力图缺失');
await evl(`document.querySelector('.bottom-nav button[data-tab="guide"]').click()`);
await sleep(300);
(await evl(`document.querySelectorAll('#gw-list .gw-card').length === 3`)) ? ok('跟练页：3 节课程（膝盖/体态/全身）') : bad('课程缺失');
await evl(`document.querySelector('#gw-list [data-gw="knee"]').click()`);
await sleep(4600);   // 准备 3 秒 + 第一个动作节拍（4 秒处 +1）
(await evl(`!document.getElementById('gw-active').classList.contains('hidden') && document.getElementById('gw-stage').textContent.includes('深蹲') && document.getElementById('gw-stage').querySelector('.gw-dots') != null && document.getElementById('gw-stage').querySelector('.gw-bar') != null`)) ? ok('跟练开始：节拍器计数界面（准备→计数）+ 节进度点 + 进度条') : bad('跟练未开始');
await evl(`window.__gwSkip()`);
await sleep(400);
(await evl(`JSON.parse(localStorage.getItem('rehab_sessions') || '[]').some(s => s.ex === 'guided' && s.reps > 0)`)) ? ok('跟练完成 → 写入标准训练记录（流入记录/趋势/成就）') : bad('训练记录未写入');
(await evl(`!!document.getElementById('gw-again') && document.getElementById('gw-list').textContent.includes('已计入训练记录')`)) ? ok('跟练完成卡：再练一次/回今日 + 已保存提示') : bad('完成卡缺失');
await evl(`document.querySelector('.bottom-nav button[data-tab="ft"]').click()`);
await sleep(300);
await evl(`document.querySelector('#ft-moves [data-ft="squat"]').click()`);
await sleep(100);
await evl(`document.getElementById('btn-ft-demo').click()`);
let ft21 = false;
for (let i = 0; i < 20; i++) { await sleep(1000); if (await evl(`!document.getElementById('ft-report').classList.contains('hidden')`)) { ft21 = true; break; } }
(ft21 && await evl(`!!document.getElementById('btn-ft-guide') && !!document.getElementById('ft-traj')`)) ? ok('测试报告：动作轨迹回放图 + 「去跟练巩固」入口') : bad('轨迹/跟练入口缺失');
// 19d. 今日任务：与日程页同一数据源 + 一键打卡（v2.21.1 细化）
await evl(`(() => { const today = new Date().getDay(); localStorage.setItem('rehab_plan', JSON.stringify([{ id: 'h1', ex: 'squat', reps: 10, days: [today] }])); localStorage.setItem('rehab_plan_done', '{}'); return true; })()`);
await evl(`document.querySelector('.bottom-nav button[data-tab="home"]').click()`);
await sleep(300);
(await evl(`document.getElementById('home-today').querySelector('.todo-check') != null`)) ? ok('今日任务：读取计划并显示打卡按钮') : bad('今日任务缺失');
await evl(`document.getElementById('home-today').querySelector('.todo-check').click()`);
await sleep(300);
(await evl(`(() => { const dd = JSON.parse(localStorage.getItem('rehab_plan_done') || '{}'); const k = Object.keys(dd)[0]; return k && dd[k].includes('squat'); })()`)) ? ok('今日任务：一键打卡写入计划完成') : bad('打卡未写入');
// 19e. 指数历史趋势（v2.21.1 细化）
await evl(`(() => { const d = new Date(); const k = (x) => { const t = new Date(d); t.setDate(t.getDate() - x); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); }; localStorage.setItem('rehab_home_idx', JSON.stringify([{ d: k(1), v: 60 }, { d: k(2), v: 55 }])); return true; })()`);
await evl(`document.querySelector('.bottom-nav button[data-tab="home"]').click()`);
await sleep(300);
(await evl(`document.getElementById('home-index').textContent.includes('上升') || document.getElementById('home-index').textContent.includes('下降') || document.getElementById('home-index').textContent.includes('up') || document.getElementById('home-index').textContent.includes('down')`)) ? ok('指数趋势：与上次对比显示') : bad('趋势缺失');
(await evl(`document.getElementById('home-heat').textContent.includes('近 30 天') || document.getElementById('home-heat').textContent.includes('of 30 days')`)) ? ok('热力图汇总：近 30 天/本周训练天数') : bad('热力图汇总缺失');

console.log('===== 20. 训练页细化（v2.21.5：今日任务小条 + 打卡串联） =====');
await evl(`document.querySelector('.bottom-nav button[data-tab="train"]').click()`);
await sleep(300);
(await evl(`!document.getElementById('train-today').classList.contains('hidden') && document.getElementById('train-today').querySelector('.todo-check') != null`)) ? ok('训练页今日任务小条（与日程同源）') : bad('训练页任务条缺失');
const ttBefore = await evl(`(() => { const dd = JSON.parse(localStorage.getItem('rehab_plan_done') || '{}'); const k = Object.keys(dd)[0]; return !!(dd[k] && dd[k].includes('squat')); })()`);
await evl(`document.getElementById('train-today').querySelector('.todo-check').click()`);
await sleep(300);
const ttAfter = await evl(`(() => { const dd = JSON.parse(localStorage.getItem('rehab_plan_done') || '{}'); const k = Object.keys(dd)[0]; return !!(dd[k] && dd[k].includes('squat')); })()`);
(ttBefore !== ttAfter) ? ok('训练页任务一键打卡（状态切换，写入计划完成）') : bad('训练页打卡失败');

console.log('===== 21. 全局打磨（v2.21.10：键盘操作 / 无障碍语义 / 焦点接管 / 切页复位 / 动效偏好） =====');
await evl(`localStorage.setItem('rehab_onboarded', 'true'); localStorage.setItem('rehab_sessions', JSON.stringify([{ id: 'g1', ts: Date.now(), ex: 'squat', exName: '深蹲', reps: 5, dur: 30, depth: 'ok', badPct: 0, valgusPct: 0, riskPct: 0, collectCount: 0 }])); location.reload()`);
await sleep(2600);
// 21a 导航无障碍语义
(await evl(`document.querySelectorAll('.bottom-nav button[aria-label]').length >= 9 && document.querySelectorAll('.bottom-nav button:not(.nav-hidden)').length === 6`)) ? ok('底部导航：6 个主入口可见 + 全部带 aria-label') : bad('导航结构异常');
await evl(`document.querySelector('.bottom-nav button[data-tab="record"]').click()`);
await sleep(250);
(await evl(`document.querySelector('.bottom-nav button[data-tab="record"]').getAttribute('aria-current') === 'page' && !document.querySelector('.bottom-nav button[data-tab="settings"]').hasAttribute('aria-current')`)) ? ok('aria-current 跟随当前页（记录）') : bad('aria-current 未同步');
// 21b 数字键切页 + 输入框内不误触发
await evl(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '8', bubbles: true }))`);
await sleep(300);
(await evl(`document.getElementById('tab-schedule').classList.contains('active')`)) ? ok('数字键 8 → 切到「日程」') : bad('数字键切页失败');
await evl(`document.querySelector('.bottom-nav button[data-tab="settings"]').click()`);
await sleep(250);
await evl(`(() => { const i = document.getElementById('pf-name'); i.focus(); i.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true })); return true; })()`);
await sleep(300);
(await evl(`document.getElementById('tab-settings').classList.contains('active')`)) ? ok('输入框里按数字不切页（防误触）') : bad('输入框误触发切页');
// 21c 切页滚动位置复位
await evl(`window.scrollTo(0, 400)`);
await sleep(200);
await evl(`document.querySelector('.bottom-nav button[data-tab="record"]').click()`);
await sleep(300);
(await evl(`window.scrollY === 0`)) ? ok('切页滚动位置复位到顶部') : bad('切页未复位滚动');
// 21d 弹窗语义 + 焦点接管 + Esc 关闭
await evl(`document.querySelector('.bottom-nav button[data-tab="settings"]').click()`);
await sleep(250);
await evl(`document.getElementById('btn-sync-show').click()`);
await sleep(900);
const qrOpen = await evl(`!document.getElementById('qr-modal').classList.contains('hidden')`);
(qrOpen && await evl(`document.getElementById('qr-modal').contains(document.activeElement)`)) ? ok('二维码弹窗打开后自动接管焦点') : bad('弹窗焦点未接管 (open=' + qrOpen + ')');
(await evl(`document.getElementById('qr-modal').getAttribute('role') === 'dialog' && document.getElementById('qr-modal').getAttribute('aria-modal') === 'true' && !!document.getElementById('qr-title')`)) ? ok('弹窗具备 dialog 语义（role/aria-modal/labelledby）') : bad('弹窗语义缺失');
await evl(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(400);
(await evl(`document.getElementById('qr-modal').classList.contains('hidden')`)) ? ok('Esc 关闭二维码弹窗') : bad('Esc 关闭失败');
// 21e 提示条 aria-live
await evl(`document.getElementById('btn-save-profile').click()`);
await sleep(400);
(await evl(`(() => { const t = document.getElementById('toast'); return !!t && t.getAttribute('role') === 'status' && t.getAttribute('aria-live') === 'polite'; })()`)) ? ok('提示条 aria-live（读屏可播报）') : bad('toast 缺 aria-live');
// 21f 跟随系统「减少动态效果」
(await evl(`fetch('style.css').then((r) => r.text()).then((s) => s.includes('prefers-reduced-motion'))`)) ? ok('样式支持系统「减少动态效果」偏好') : bad('缺少 reduced-motion 支持');
// 21g 导航 aria-label 随语言切换
await evl(`document.getElementById('btn-lang').click()`);
await sleep(500);
const navAria = await evl(`document.querySelector('.bottom-nav button[data-tab="train"]').getAttribute('aria-label')`);
(navAria === 'Train') ? ok('导航 aria-label 随语言切换（Train）') : bad('aria-label 未切换: ' + navAria);
await evl(`document.getElementById('btn-lang').click()`);
await sleep(400);
(await evl(`document.querySelector('.bottom-nav button[data-tab="train"]').getAttribute('aria-label') === '训练'`)) ? ok('导航 aria-label 切回中文（训练）') : bad('aria-label 未回中文');
await evl(`document.querySelector('.bottom-nav button[data-tab="train"]').click()`);
await sleep(200);

console.log('===== 22. 疼痛管理（v2.22.0：VAS 评分 / 前后对比 / 趋势 / 全数据面） =====');
await evl(`localStorage.removeItem('rehab_pain_history'); location.reload()`);
await sleep(2600);
await evl(`document.querySelector('.bottom-nav button[data-tab="record"]').click()`);
await sleep(300);
(await evl(`!!document.getElementById('btn-pain-pre') && !!document.getElementById('pain-chart') && !!document.getElementById('pain-list')`)) ? ok('记录页疼痛卡渲染（记录按钮+趋势+列表）') : bad('疼痛卡缺失');
(await evl(`document.getElementById('pain-list').textContent.includes('还没有疼痛记录')`)) ? ok('无记录时显示引导文案') : bad('空状态缺失');
await evl(`document.getElementById('btn-pain-pre').click()`);
await sleep(350);
(await evl(`document.querySelectorAll('#pain-scale .pain-btn').length === 11`)) ? ok('评分弹窗 0–10 共 11 档') : bad('评分档位异常');
await evl(`document.querySelector('#pain-scale [data-pv="3"]').click()`);
await sleep(200);
await evl(`document.getElementById('pain-note').value='上下楼加重'; document.getElementById('pain-save').click()`);
await sleep(450);
(await evl(`(() => { const h = JSON.parse(localStorage.getItem('rehab_pain_history') || '[]'); return h.length === 1 && h[0].v === 3 && h[0].when === 'pre' && h[0].note.includes('上下楼'); })()`)) ? ok('记录训练前疼痛 3 分（含备注）') : bad('疼痛记录失败');
await evl(`document.getElementById('btn-pain-post').click()`);
await sleep(350);
await evl(`document.querySelector('#pain-scale [data-pv="7"]').click(); document.getElementById('pain-save').click()`);
await sleep(450);
(await evl(`document.getElementById('pain-now').textContent.includes('↑4')`)) ? ok('前后对比显示 ↑4（训练后加重）') : bad('前后对比缺失');
(await evl(`document.querySelectorAll('#pain-list .item').length === 2`)) ? ok('疼痛历史列表 2 条') : bad('疼痛列表异常');
(await evl(`!!document.querySelector('#pain-chart svg path') && document.querySelectorAll('#pain-chart .pain-legend .pl').length === 3`)) ? ok('14 天双线趋势图 + 图例（训练前/后/风险线）') : bad('趋势图未绘制');
(await evl(`(() => { document.querySelector('.bottom-nav button[data-tab="home"]').click(); const el = document.getElementById('home-pain'); return el.textContent.includes('7') && el.className.includes('warn'); })()`)) ? ok('今日页显示近 7 天峰值疼痛（≥7 标黄）') : bad('今日页疼痛提示缺失');
(await evl(`(() => { document.querySelector('.bottom-nav button[data-tab="train"]').click(); return document.getElementById('pain-strip').textContent.includes('7'); })()`)) ? ok('训练页疼痛快记条同步当天前后评分') : bad('训练页快记条缺失');
(await evl(`(() => { document.querySelector('.bottom-nav button[data-tab="settings"]').click(); return document.getElementById('ai-card').textContent.includes('疼痛'); })()`)) ? ok('AI 管家即时提示疼痛信号（模块串联）') : bad('AI 管家未感知疼痛');
await evl(`document.getElementById('btn-export').click()`);
await sleep(1000);
let painBak = null;
for (const f of downloads.filter((x) => x.endsWith('.json'))) {
  try { const j = JSON.parse(readFileSync(join(dlDir, f), 'utf8')); if (j.painHistory) { painBak = j; break; } } catch { /* 下一个 */ }
}
(painBak && Array.isArray(painBak.painHistory) && painBak.painHistory.length === 2) ? ok('备份 JSON 含疼痛记录（全数据面串联）') : bad('备份缺疼痛字段: ' + JSON.stringify(painBak && Object.keys(painBak)));
await evl(`document.getElementById('btn-clear').click()`);
await sleep(600);
(await evl(`!localStorage.getItem('rehab_pain_history')`)) ? ok('清除全部数据含疼痛记录') : bad('清空未清疼痛');

console.log('===== 23. 康复小课堂 + 疼痛预警（v2.23.0：患者教育闭环） =====');
await evl(`localStorage.setItem('rehab_pain_history', JSON.stringify([{ id: 'p1', ts: Date.now(), when: 'pre', v: 3, part: 'knee', note: '' }, { id: 'p2', ts: Date.now() + 1, when: 'post', v: 6, part: 'knee', note: '' }])); location.reload()`);
await sleep(2600);
await evl(`document.querySelector('.bottom-nav button[data-tab="posture"]').click()`);
await sleep(350);
(await evl(`document.querySelectorAll('#edu-list .edu-card').length === 5`)) ? ok('康复小课堂：5 张教育卡渲染') : bad('小课堂卡片数异常');
await evl(`document.querySelector('#edu-list .edu-head').click()`);
await sleep(350);
(await evl(`(() => { const b = document.querySelector('#edu-list .edu-body'); return !!b && b.textContent.includes('为什么会这样') && b.textContent.includes('不纠正会怎样') && b.textContent.includes('日常注意'); })()`)) ? ok('展开卡片显示「成因 / 后果 / 日常注意」三段') : bad('教育卡内容缺失');
await evl(`document.querySelector('#edu-list [data-edugo]').click()`);
await sleep(350);
(await evl(`document.getElementById('tab-guide').classList.contains('active')`)) ? ok('教育卡「去练习」跳转到对应训练页（端到端串联）') : bad('教育卡跳转失败');
await evl(`document.querySelector('.bottom-nav button[data-tab="record"]').click()`);
await sleep(350);
(await evl(`(() => { const el = document.querySelector('#pain-now .pain-spike'); return !!el && el.textContent.includes('3'); })()`)) ? ok('训练后疼痛上升 3 分 → 疼痛卡显示预警（≥2 分自动提醒）') : bad('疼痛上升预警缺失');
(await evl(`(() => { document.querySelector('.bottom-nav button[data-tab="home"]').click(); const el = document.getElementById('home-pain'); return el.textContent.includes('上升') && el.className.includes('warn'); })()`)) ? ok('今日页显示疼痛上升预警') : bad('今日页预警缺失');
(await evl(`(() => { document.querySelector('.bottom-nav button[data-tab="settings"]').click(); return document.getElementById('ai-card').textContent.includes('疼痛'); })()`)) ? ok('AI 管家含疼痛上升预警建议') : bad('AI 管家无预警');
await evl(`document.getElementById('btn-lang').click()`);
await sleep(550);
(await evl(`(() => { document.querySelector('.bottom-nav button[data-tab="posture"]').click(); const s = document.getElementById('edu-list').textContent; return s.includes('Rounded shoulders') && s.includes('Rehab classroom') === false || s.includes('Rounded shoulders'); })()`)) ? ok('小课堂内容随语言切换（英文）') : bad('小课堂未翻译');
await evl(`document.getElementById('btn-lang').click()`);
await sleep(450);
await evl(`localStorage.removeItem('rehab_pain_history')`);

console.log('===== 24. 治疗师报告（v2.24.0：汇总 / HTML / 图片 / 摘要） =====');
await evl(`(() => { const now = Date.now(); const d = (i) => now - i * 86400000;
  localStorage.setItem('rehab_sessions', JSON.stringify([0,1,2,5,9,15].map((i, k) => ({ id: 'r' + k, ts: d(i), ex: 'squat', exName: '深蹲', reps: 20, dur: 60, depth: 'ok', badPct: 2, valgusPct: 0, riskPct: 0, collectCount: 0 }))));
  localStorage.setItem('rehab_profile', JSON.stringify({ name: '徐小明', goal: 'knee', injury: '半月板术后' }));
  localStorage.setItem('rehab_pain_history', JSON.stringify([{ id: 'q1', ts: now, when: 'pre', v: 3, part: 'knee', note: '' }]));
  return true; })()`);
await evl(`location.reload()`);
await sleep(2600);
await evl(`document.querySelector('.bottom-nav button[data-tab="record"]').click()`);
await sleep(450);
(await evl(`!!document.getElementById('btn-rep-html') && !!document.getElementById('btn-rep-png') && !!document.getElementById('btn-rep-copy')`)) ? ok('记录页治疗师报告卡（HTML/图片/摘要三种输出）') : bad('报告卡缺失');
(await evl(`(() => { const s = document.getElementById('rep-summary').textContent; return s.includes('徐小明') && s.includes('6 天'); })()`)) ? ok('报告摘要含患者资料与训练依从（6 天 · 6 次）') : bad('报告摘要内容缺失');
await evl(`document.getElementById('btn-rep-html').click()`);
await sleep(1300);
const repFile = downloads.filter((x) => x.endsWith('.html')).pop();
let repTxt = '';
try { repTxt = readFileSync(join(dlDir, repFile), 'utf8'); } catch { /* ignore */ }
(repTxt.includes('徐小明') && repTxt.includes('治疗师报告') && repTxt.includes('治疗建议') && repTxt.includes('不构成医疗诊断')) ? ok('导出 HTML 报告：含患者/建议/免责声明（浏览器打印即可存 PDF）') : bad('HTML 报告内容缺失: ' + repFile);
(repTxt.includes('<svg') && repTxt.includes('疼痛趋势')) ? ok('HTML 报告内嵌疼痛趋势图（自包含，无外部资源）') : bad('报告缺趋势图');
await evl(`document.getElementById('btn-rep-png').click()`);
await sleep(1600);
downloads.some((x) => x.endsWith('.png')) ? ok('导出 PNG 长图（可直接发给治疗师）') : bad('PNG 导出失败');
await evl(`document.getElementById('btn-rep-copy').click()`);
await sleep(600);
(await evl(`(() => { const el = document.getElementById('toast'); return !!el && el.textContent.length > 3; })()`)) ? ok('复制摘要后有反馈提示') : bad('复制无反馈');
// v2.25.0：六维雷达 + 体态骨架截图 + 30 天趋势
await evl(`localStorage.setItem('rehab_ft_history', JSON.stringify([{ key: 'battery', battery: true, ts: Date.now(), score: 78, sim: 80, dims: { sym: 82, align: 74, dyn: 80, stab: 70, rom: 76, cons: 84, total: 78 }, m: {} }]))`);
await evl(`localStorage.setItem('rehab_pa_history', JSON.stringify([{ kind: 'standing', ts: Date.now(), score: 80, grade: 'B', items: [], priorities: [], snap: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA==' }]))`);
await evl(`document.querySelector('.bottom-nav button[data-tab="record"]').click()`);
await sleep(600);
(await evl(`!!document.querySelector('#rep-summary .radar-chart') && document.querySelectorAll('#rep-summary .radar-vals .rv').length === 6`)) ? ok('报告摘要含六维雷达图（6 轴 + 数值）') : bad('雷达图缺失');
(await evl(`(() => { const im = document.querySelector('#rep-summary .rep-snap'); return !!im && im.getAttribute('src').startsWith('data:image/jpeg'); })()`)) ? ok('报告摘要含体态骨架截图（隐私友好：只有火柴人）') : bad('体态截图缺失');
(await evl(`document.querySelectorAll('#rep-summary .rep-sec').length >= 3`)) ? ok('报告分段：体态截图 / 六维雷达 / 30 天趋势') : bad('报告分段缺失');
await evl(`document.getElementById('btn-rep-html').click()`);
await sleep(1500);
const rep2 = downloads.filter((x) => x.endsWith('.html')).pop();
let repTxt2 = '';
try { repTxt2 = readFileSync(join(dlDir, rep2), 'utf8'); } catch { /* ignore */ }
(repTxt2.includes('radar-chart') && repTxt2.includes('data:image/jpeg') && repTxt2.includes('30 天训练趋势')) ? ok('导出 HTML 含雷达+骨架截图+30 天趋势（自包含单文件）') : bad('HTML 报告缺新内容');
await evl(`document.getElementById('btn-rep-png').click()`);
await sleep(1800);
downloads.filter((x) => x.endsWith('.png')).length >= 2 ? ok('导出图片：新版长图（截图+雷达+趋势）成功') : bad('新版 PNG 导出失败');
await evl(`document.getElementById('btn-lang').click()`);
await sleep(600);
(await evl(`(() => { document.querySelector('.bottom-nav button[data-tab="record"]').click(); const s = document.getElementById('rep-summary').textContent; return s.includes('Adherence') || s.includes('Patient'); })()`)) ? ok('报告摘要随语言切换（英文）') : bad('报告未翻译');
await evl(`document.getElementById('btn-lang').click()`);
await sleep(450);
await evl(`['rehab_sessions','rehab_profile','rehab_pain_history'].forEach((k) => localStorage.removeItem(k))`);

console.log('===== 25. ROM 关节活动度（v2.26.0：测量 / 等级 / 左右差异 / 报告串联） =====');
await evl(`localStorage.removeItem('rehab_rom_history'); location.reload()`);
await sleep(2600);
await evl(`document.querySelector('.bottom-nav button[data-tab="posture"]').click()`);
await sleep(350);
(await evl(`document.querySelectorAll('#rom-items .pa-kind').length === 5 && !!document.getElementById('rom-side')`)) ? ok('ROM 卡：5 个测量项 + 左/右侧切换') : bad('ROM 卡缺失');
await evl(`document.querySelector('#rom-items [data-rom="kneeFlex"]').click()`);
await sleep(250);
await evl(`document.getElementById('btn-rom-demo').click()`);
let romDone = false;
for (let i = 0; i < 18; i++) { await sleep(1000); romDone = await evl(`JSON.parse(localStorage.getItem('rehab_rom_history') || '[]').length >= 1`); if (romDone) break; }
romDone ? ok('演示模式 6 秒完成 ROM 测量并写入历史') : bad('ROM 测量未完成');
(await evl(`(() => { const h = JSON.parse(localStorage.getItem('rehab_rom_history') || '[]'); return h.length === 1 && h[0].key === 'kneeFlex' && h[0].side === 'L' && h[0].rom >= 125 && h[0].rom <= 145; })()`)) ? ok('膝屈曲 ROM 落在 125–145°（关键点几何计算正确）') : bad('ROM 数值异常');
(await evl(`!!document.querySelector('#rom-result .rom-lv') && document.getElementById('rom-result').textContent.includes('°')`)) ? ok('结果卡显示活动范围 + 等级 + 参考值') : bad('ROM 结果卡缺失');
await evl(`document.querySelector('#rom-side [data-side="R"]').click()`);
await sleep(250);
await evl(`document.getElementById('btn-rom-demo').click()`);
for (let i = 0; i < 18; i++) { await sleep(1000); const n = await evl(`JSON.parse(localStorage.getItem('rehab_rom_history') || '[]').length`); if (n >= 2) break; }
(await evl(`JSON.parse(localStorage.getItem('rehab_rom_history') || '[]').length === 2`)) ? ok('右侧测量写入第 2 条 ROM 记录（左右可分别测）') : bad('右侧 ROM 记录缺失');
await evl(`document.querySelector('.bottom-nav button[data-tab="record"]').click()`);
await sleep(450);
(await evl(`(() => { const s = document.getElementById('rep-summary').textContent; return s.includes('ROM') || s.includes('Range of motion'); })()`)) ? ok('治疗师报告出现 ROM 汇总（模块端到端串联）') : bad('报告缺 ROM 行');
await evl(`localStorage.removeItem('rehab_rom_history')`);

console.log('===== 26. PROMs 标准化量表（v2.27.0：ODI/NDI/KOOS-12/EQ-5D-5L） =====');
await evl(`localStorage.removeItem('rehab_proms_history'); location.reload()`);
await sleep(2600);
await evl(`document.querySelector('.bottom-nav button[data-tab="assess"]').click()`);
await sleep(350);
(await evl(`document.querySelectorAll('#prom-list .pa-kind').length === 4 && !!document.getElementById('btn-prom-start')`)) ? ok('PROMs 卡：4 个量表（ODI/NDI/KOOS-12/EQ-5D-5L）') : bad('PROMs 卡缺失');
await evl(`document.getElementById('btn-prom-start').click()`);
await sleep(400);
(await evl(`document.querySelectorAll('#prom-form .prom-q').length === 10 && document.querySelectorAll('#prom-form [data-qi="0"]').length === 6`)) ? ok('ODI 表单：10 题 × 6 级应答') : bad('ODI 表单结构异常');
// 全部选最高级（5）→ ODI 应得 100% 且分级为重度受限
await evl(`document.querySelectorAll('#prom-form .prom-q').forEach((q) => { const b = q.querySelector('[data-qv="5"]'); if (b) b.click(); })`);
await sleep(500);
await evl(`document.getElementById('btn-prom-submit').click()`);
await sleep(600);
(await evl(`(() => { const h = JSON.parse(localStorage.getItem('rehab_proms_history') || '[]'); return h.length === 1 && h[0].key === 'odi' && h[0].total === 100 && h[0].band === 'Bed' && h[0].level === 'bad'; })()`)) ? ok('ODI 计分正确（全 5 分 → 100% · 极重度 · 严重级别）') : bad('ODI 计分异常');
(await evl(`document.querySelector('#prom-result .prom-big').textContent.includes('100')`)) ? ok('结果卡显示分数与分级') : bad('结果卡缺失');
// KOOS-12：全选「无」→ 满分 100 优秀
await evl(`document.querySelector('#prom-list [data-prom="koos"]').click()`);
await sleep(300);
await evl(`document.getElementById('btn-prom-start').click()`);
await sleep(400);
await evl(`document.querySelectorAll('#prom-form .prom-q').forEach((q) => { const b = q.querySelector('[data-qv="0"]'); if (b) b.click(); })`);
await sleep(500);
await evl(`document.getElementById('btn-prom-submit').click()`);
await sleep(600);
(await evl(`(() => { const h = JSON.parse(localStorage.getItem('rehab_proms_history') || '[]'); const r = h.find((x) => x.key === 'koos'); return !!r && r.total === 100 && r.band === 'Exc' && Object.keys(r.subs).length === 5; })()`)) ? ok('KOOS-12 计分正确（12 题全 0 → 100 · 优秀 · 5 个维度）') : bad('KOOS 计分异常');
(await evl(`document.querySelectorAll('#prom-history .item').length === 2`)) ? ok('量表历史累计 2 条（可删除）') : bad('量表历史异常');
await evl(`document.querySelector('.bottom-nav button[data-tab="record"]').click()`);
await sleep(450);
(await evl(`(() => { const s = document.getElementById('rep-summary').textContent; return s.includes('PROMs') || s.includes('ODI'); })()`)) ? ok('治疗师报告出现量表评分（模块串联）') : bad('报告缺 PROMs 行');
await evl(`localStorage.removeItem('rehab_proms_history')`);

console.log('===== 27. 自适应智能引擎（v2.28.0：个人基线 / 可调规则 / 可学习处方） =====');
await evl(`['rehab_ai_prefs','rehab_ai_feedback','rehab_plan','rehab_rom_history','rehab_pain_history','rehab_sessions'].forEach((k) => localStorage.removeItem(k)); location.reload()`);
await sleep(2600);
await evl(`document.querySelector('.bottom-nav button[data-tab="home"]').click()`);
await sleep(400);
(await evl(`!!document.getElementById('ai-plan') && document.getElementById('ai-plan').textContent.trim().length > 20`)) ? ok('今日页出现 AI 处方卡') : bad('AI 处方卡缺失');
(await evl(`(() => { const s = document.getElementById('ai-plan').textContent; return s.length > 20 && !!document.getElementById('btn-ai-apply'); })()`)) ? ok('处方含剂量行与「采用/不用/改规则」按钮') : bad('处方结构异常');
// 采用 → 写入今日计划 + 学习计数
await evl(`document.getElementById('btn-ai-apply').click()`);
await sleep(600);
(await evl(`(() => { const p = JSON.parse(localStorage.getItem('rehab_plan') || '[]'); const f = JSON.parse(localStorage.getItem('rehab_ai_feedback') || '{}'); return p.length === 1 && p[0].days.includes(new Date().getDay()) && f.accepted === 1; })()`)) ? ok('采用处方 → 写入今日计划 + 采纳计数 +1（端到端）') : bad('采用失败');
await evl(`document.getElementById('btn-ai-ignore').click()`);
await sleep(500);
(await evl(`JSON.parse(localStorage.getItem('rehab_ai_feedback') || '{}').ignored === 1`)) ? ok('忽略处方 → 被 AI 记住（用于下次更保守）') : bad('忽略未记录');
// 规则可改：疼痛阈值 1 分即预警
await evl(`(() => { document.querySelector('.bottom-nav button[data-tab="settings"]').click(); return true; })()`);
await sleep(400);
(await evl(`!!document.getElementById('ai-pain-alarm') && !!document.getElementById('ai-intensity') && document.getElementById('ai-rom-targets').querySelectorAll('input').length === 5`)) ? ok('智能引擎卡：阈值/强度/ROM 目标全部可改') : bad('智能引擎卡缺失');
await evl(`(() => { const s = document.getElementById('ai-pain-alarm'); s.value = '1'; s.onchange(); return true; })()`);
await sleep(300);
await evl(`(() => { localStorage.setItem('rehab_pain_history', JSON.stringify([{ id: 'e1', ts: Date.now(), when: 'pre', v: 3, part: 'knee', note: '' }, { id: 'e2', ts: Date.now() + 1, when: 'post', v: 4, part: 'knee', note: '' }])); location.reload(); })()`);
await sleep(2600);
await evl(`document.querySelector('.bottom-nav button[data-tab="record"]').click()`);
await sleep(400);
(await evl(`!!document.querySelector('#pain-now .pain-spike')`)) ? ok('阈值改为 1 分后：上升 1 分即触发预警（规则真的可改）') : bad('阈值未生效');
await evl(`(() => { const s = document.getElementById('ai-pain-alarm'); s.value = '4'; s.onchange(); return true; })()`);
await sleep(400);
(await evl(`!document.querySelector('#pain-now .pain-spike')`)) ? ok('阈值改为 4 分后：上升 1 分不再预警（同一数据、不同规则→不同结论）') : bad('阈值回退失败');
// ROM 目标可改 → 处方依据随之改变
await evl(`(() => { const inp = document.querySelector('#ai-rom-targets [data-tgt="kneeFlex"]'); inp.value = '150'; inp.dispatchEvent(new Event('change')); return true; })()`);
await sleep(400);
(await evl(`JSON.parse(localStorage.getItem('rehab_ai_prefs') || '{}').romTargets.kneeFlex === 150`)) ? ok('ROM 目标值可自行设定并持久化') : bad('ROM 目标未保存');
await evl(`['rehab_pain_history','rehab_plan','rehab_ai_prefs','rehab_ai_feedback'].forEach((k) => localStorage.removeItem(k))`);

console.log('===== 28. 康复路径（v2.29.0：分阶段 / 条件可改 / 按数据推荐） =====');
await evl(`['rehab_path','rehab_plan','rehab_pain_history','rehab_ft_history','rehab_proms_history'].forEach((k) => localStorage.removeItem(k)); location.reload()`);
await sleep(2600);
await evl(`document.querySelector('.bottom-nav button[data-tab="schedule"]').click()`);
await sleep(450);
(await evl(`document.querySelectorAll('#path-pick .pa-kind').length === 3 && !!document.getElementById('path-body')`)) ? ok('康复路径卡：3 条路径（腰痛/膝痛/肩颈）+ 阶段面板') : bad('康复路径卡缺失');
(await evl(`document.getElementById('path-rec').textContent.includes('推荐')`)) ? ok('显示按数据推荐的路径与理由') : bad('推荐行缺失');
await evl(`(() => { localStorage.setItem('rehab_pain_history', JSON.stringify([{ id: 'p1', ts: Date.now(), when: 'post', v: 2, part: 'lowback', note: '' }])); return true; })()`);
await evl(`document.querySelector('.bottom-nav button[data-tab="train"]').click(); document.querySelector('.bottom-nav button[data-tab="schedule"]').click()`);
await sleep(550);
(await evl(`document.getElementById('path-rec').textContent.includes('腰痛') || document.getElementById('path-rec').textContent.includes('腰部')`)) ? ok('推荐随数据变化（疼痛部位=腰 → 腰痛路径）') : bad('推荐未跟随数据');
await evl(`document.getElementById('path-use-rec').click()`);
await sleep(550);
(await evl(`JSON.parse(localStorage.getItem('rehab_path') || '{}').path === 'lowback'`)) ? ok('采用推荐路径并写入状态') : bad('采用推荐失败');
await evl(`document.getElementById('btn-path-apply').click()`);
await sleep(650);
(await evl(`JSON.parse(localStorage.getItem('rehab_plan') || '[]').length >= 2`)) ? ok('本期动作一键写入今日计划（端到端串联）') : bad('写入计划失败');
(await evl(`document.getElementById('path-body').textContent.includes('未满足')`)) ? ok('进阶条件未满足时如实显示（3 次训练后疼痛 ≤3 分）') : bad('达标判定异常');
await evl(`(() => { const s = document.querySelector('#path-body [data-cond="streak"]'); s.value = '1'; s.dispatchEvent(new Event('change')); const m = document.querySelector('#path-body [data-cond="painMax"]'); m.value = '10'; m.dispatchEvent(new Event('change')); const y = document.querySelector('#path-body [data-cond="sym"]'); y.value = '0'; y.dispatchEvent(new Event('change')); return true; })()`);
await sleep(600);
(await evl(`(() => { const c = JSON.parse(localStorage.getItem('rehab_path') || '{}').cond || {}; return c.streak === 1 && c.painMax === 10 && c.sym === 0; })()`)) ? ok('进阶条件（疼痛上限/连续次数/对称性）全部可改并持久化') : bad('条件未保存');
(await evl(`document.getElementById('path-body').textContent.includes('已满足')`)) ? ok('条件放宽后判定为「已满足」（同数据不同规则→不同结论）') : bad('放宽后仍未达标');
await evl(`document.getElementById('btn-path-up').click()`);
await sleep(650);
(await evl(`(() => { const c = JSON.parse(localStorage.getItem('rehab_path') || '{}'); return c.phase === 1 && Array.isArray(c.log) && c.log.length === 1; })()`)) ? ok('进入下一阶段并留下进阶记录') : bad('进阶失败');
await evl(`['rehab_path','rehab_plan','rehab_pain_history'].forEach((k) => localStorage.removeItem(k))`);

console.log('===== 29. 影像能力升级（v2.30.0：视野/距离引导/设备能力） =====');
await evl(`['rehab_cam_prefs'].forEach((k) => localStorage.removeItem(k)); location.reload()`);
await sleep(2600);
await evl(`document.querySelector('.bottom-nav button[data-tab="settings"]').click()`);
await sleep(450);
(await evl(`document.querySelectorAll('#cam-aspect [data-cam-asp]').length === 2 && !!document.getElementById('cam-follow') && !!document.getElementById('cam-guide-chk') && !!document.getElementById('btn-cam-pick')`)) ? ok('影像设置卡：比例/跟随/引导/自动挑选齐全') : bad('影像卡缺失');
(await evl(`(document.getElementById('cam-status').textContent || '').length > 4`)) ? ok('影像状态行显示当前画面与变焦能力') : bad('影像状态行为空');
await evl(`(() => { document.querySelector('#cam-aspect [data-cam-asp="169"]').click(); return true; })()`);
await sleep(400);
(await evl(`JSON.parse(localStorage.getItem('rehab_cam_prefs') || '{}').aspect === '169'`)) ? ok('画面比例可切换并持久化（3:4 ↔ 16:9）') : bad('比例未保存');
await evl(`(() => { const c = document.getElementById('cam-guide-chk'); c.checked = false; c.onchange(); return true; })()`);
await sleep(400);
(await evl(`JSON.parse(localStorage.getItem('rehab_cam_prefs') || '{}').guide === false`)) ? ok('入镜引导可关闭（就地生效）') : bad('引导开关未保存');
(await evl(`(() => { document.querySelector('.bottom-nav button[data-tab="train"]').click(); return !!document.getElementById('cam-guide'); })()`)) ? ok('训练画面已挂载入镜/距离引导条') : bad('引导条未挂载');
await evl(`['rehab_cam_prefs'].forEach((k) => localStorage.removeItem(k))`);

console.log('===== 30. 康复闭环（v2.31.0：评估→问题→训练→疼痛→复评 全链路联动） =====');
await evl(`['rehab_pa_history','rehab_ft_history','rehab_rom_history','rehab_plan','rehab_sessions','rehab_pain_history','rehab_proms_history'].forEach((k) => localStorage.removeItem(k)); location.reload()`);
await sleep(2600);
await evl(`document.querySelector('.bottom-nav button[data-tab="home"]').click()`);
await sleep(450);
(await evl(`document.querySelectorAll('#care-loop .loop-step').length === 5`)) ? ok('今日页出现康复闭环面板（五步）') : bad('闭环面板缺失');
(await evl(`document.getElementById('care-loop').textContent.includes('评估') && !!document.getElementById('btn-loop-next')`)) ? ok('无数据时提示先做评估（含一键动作）') : bad('闭环首步提示缺失');
await evl(`document.getElementById('btn-loop-next').click()`);
await sleep(400);
(await evl(`document.getElementById('tab-posture').classList.contains('active')`)) ? ok('点「去做」直接跳到体态评估页（模块联动）') : bad('闭环跳转失败');
// 播种评估数据 → 问题清单 + 一键生成计划
await evl(`(() => { const now = Date.now();
  localStorage.setItem('rehab_pa_history', JSON.stringify([{ kind: 'standing', ts: now, score: 62, grade: 'C', items: [], priorities: [{ label: '肩部前倾', level: 'warn', text: '肩部前倾 12°', advice: '多做划船类拉的动作' }] }]));
  localStorage.setItem('rehab_ft_history', JSON.stringify([{ key: 'battery', battery: true, ts: now, score: 70, sim: 70, dims: { sym: 58, align: 80, dyn: 80, stab: 80, rom: 80, cons: 80 }, m: {} }]));
  return true; })()`);
await evl(`document.querySelector('.bottom-nav button[data-tab="train"]').click(); document.querySelector('.bottom-nav button[data-tab="home"]').click()`);
await sleep(550);
(await evl(`document.querySelectorAll('#care-loop .loop-issue').length >= 2`)) ? ok('问题清单自动汇总（体态 + 功能测试低分维度）') : bad('问题清单为空');
(await evl(`document.getElementById('care-loop').textContent.includes('体态') && document.getElementById('care-loop').textContent.includes('功能测试')`)) ? ok('每条问题标注来源模块（可见联动）') : bad('问题来源未标注');
await evl(`document.getElementById('btn-loop-next').click()`);
await sleep(700);
(await evl(`JSON.parse(localStorage.getItem('rehab_plan') || '[]').length >= 1`)) ? ok('按问题清单一键生成今日训练计划（评估→训练联动）') : bad('生成计划失败');
// 播种今日训练 → 闭环提示记训练后疼痛
await evl(`(() => { localStorage.setItem('rehab_sessions', JSON.stringify([{ id: 'c1', ts: Date.now(), ex: 'squat', exName: '深蹲', reps: 10, dur: 60, depth: 'ok', badPct: 0, valgusPct: 0, riskPct: 0, collectCount: 0 }])); return true; })()`);
await evl(`document.querySelector('.bottom-nav button[data-tab="train"]').click(); document.querySelector('.bottom-nav button[data-tab="home"]').click()`);
await sleep(550);
(await evl(`document.getElementById('care-loop').textContent.includes('疼痛')`)) ? ok('练完后闭环提示记「训练后疼痛」（训练→疼痛联动）') : bad('未提示记疼痛');
await evl(`document.getElementById('btn-loop-next').click()`);
await sleep(500);
(await evl(`!document.getElementById('pain-modal').classList.contains('hidden')`)) ? ok('点闭环动作直接打开疼痛评分弹窗') : bad('疼痛弹窗未打开');
await evl(`document.getElementById('pain-cancel').click()`);
// 复评对比：两次 ROM
await evl(`(() => { const now = Date.now(); localStorage.setItem('rehab_rom_history', JSON.stringify([{ id: 'r2', ts: now, key: 'kneeFlex', side: 'L', min: 45, max: 175, rom: 135, level: 'good' }, { id: 'r1', ts: now - 86400000, key: 'kneeFlex', side: 'L', min: 52, max: 175, rom: 128, level: 'warn' }])); return true; })()`);
await evl(`document.querySelector('.bottom-nav button[data-tab="settings"]').click(); document.querySelector('.bottom-nav button[data-tab="home"]').click()`);
await sleep(550);
(await evl(`document.getElementById('care-loop').textContent.includes('+7')`)) ? ok('复评对比自动算出（活动度 +7°，训练→复评→对比闭环）') : bad('对比未显示');
await evl(`['rehab_pa_history','rehab_ft_history','rehab_rom_history','rehab_plan','rehab_sessions'].forEach((k) => localStorage.removeItem(k))`);

console.log('===== 31. 端手接力（v2.32.0：导出→传文件→导入合并 真互通） =====');
await evl(`['rehab_sessions','rehab_rom_history','rehab_pain_history','rehab_last_backup'].forEach((k) => localStorage.removeItem(k)); location.reload()`);
await sleep(2600);
await evl(`document.querySelector('.bottom-nav button[data-tab="home"]').click()`);
await sleep(450);
(await evl(`!!document.getElementById('btn-relay-export') && !!document.getElementById('btn-relay-import') && !!document.getElementById('btn-relay-qr') && !!document.getElementById('relay-state')`)) ? ok('今日页出现端手接力卡（导出/导入合并/二维码 + 状态行）') : bad('端手接力卡缺失');
// 合并语义：本机已有 1 条 + 导入文件里 2 条（其中 1 条同 id）→ 合并后应为 2 条（不是覆盖成 2 条重复 3 条）
await evl(`(() => { localStorage.setItem('rehab_sessions', JSON.stringify([{ id: 'loc1', ts: Date.now(), ex: 'squat', exName: '深蹲', reps: 10, dur: 60, depth: 'ok', badPct: 0, valgusPct: 0, riskPct: 0, collectCount: 0 }])); return true; })()`);
const relayBak = join(dlDir, 'relay.json');
writeFileSync(relayBak, JSON.stringify({ app: 'RehabAI', v: 3, sessions: [{ id: 'loc1', ts: Date.now(), ex: 'squat', exName: '深蹲', reps: 12, dur: 60, depth: 'ok', badPct: 0, valgusPct: 0, riskPct: 0, collectCount: 0 }, { id: 'from2', ts: Date.now() - 1000, ex: 'lunge', exName: '弓步蹲', reps: 9, dur: 60, depth: 'ok', badPct: 0, valgusPct: 0, riskPct: 0, collectCount: 0 }], assessments: [], appts: [], customExercises: [], romHistory: [{ id: 'romA', ts: Date.now(), key: 'kneeFlex', side: 'L', min: 40, max: 175, rom: 140, level: 'good' }], painHistory: [{ id: 'pA', ts: Date.now(), when: 'post', v: 2, part: 'knee', note: '' }] }));
await setFiles('#import-input', relayBak);
await sleep(900);
(await evl(`(() => { const s = JSON.parse(localStorage.getItem('rehab_sessions') || '[]'); return s.length === 2 && s.some((x) => x.id === 'from2') && s.some((x) => x.id === 'loc1' && x.reps === 12); })()`)) ? ok('导入 = 合并（本机 1 条 + 文件 2 条 → 2 条，同 id 被更新而非重复）') : bad('合并语义失败');
(await evl(`JSON.parse(localStorage.getItem('rehab_rom_history') || '[]').length === 1 && JSON.parse(localStorage.getItem('rehab_pain_history') || '[]').length === 1`)) ? ok('活动度与疼痛也随文件合并进本机') : bad('其它数据未合并');
(await evl(`(() => { const el = document.getElementById('relay-state'); return el && el.textContent.length > 5; })()`)) ? ok('接力卡显示本机数据量与上次导出日期') : bad('接力状态行缺失');
await evl(`['rehab_sessions','rehab_rom_history','rehab_pain_history'].forEach((k) => localStorage.removeItem(k))`);

console.log('===== 32. 三块式架构 + 复评 + 肌群分析（v2.33.0） =====');
await evl(`['rehab_pa_history','rehab_ft_history','rehab_rom_history','rehab_proms_history','rehab_sessions','rehab_pain_history','rehab_plan'].forEach((k) => localStorage.removeItem(k)); location.reload()`);
await sleep(2600);
await evl(`document.querySelector('.bottom-nav button[data-tab="posture"]').click()`);
await sleep(450);
(await evl(`document.querySelectorAll('#block-sub .bs-btn').length === 3 && document.getElementById('block-sub').textContent.includes('评估')`)) ? ok('进入体态页显示「评估块」子标签栏（3 个子页）') : bad('评估块子标签缺失');
await evl(`document.querySelector('#block-sub [data-bs="ft"]').click()`);
await sleep(400);
(await evl(`document.getElementById('tab-ft').classList.contains('active')`)) ? ok('子标签可在评估块内切换到功能测试') : bad('子标签切换失败');
await evl(`document.querySelector('#block-sub [data-bs="assess"]').click()`);
await sleep(350);
await evl(`document.querySelector('.bottom-nav button[data-tab="train"]').click()`);
await sleep(350);
(await evl(`document.getElementById('block-sub').textContent.includes('训练')`)) ? ok('训练块子标签栏出现（跟练/专项/训练）') : bad('训练块子标签缺失');
await evl(`document.querySelector('.bottom-nav button[data-tab="recheck"]').click()`);
await sleep(450);
(await evl(`document.getElementById('tab-recheck').classList.contains('active') && !!document.getElementById('rc-compare') && !!document.getElementById('body-analysis')`)) ? ok('复评页存在（对比 + 肌群分析 + 趋势）') : bad('复评页缺失');
(await evl(`document.getElementById('rc-compare').textContent.includes('还没有') || document.getElementById('rc-compare').textContent.length > 3`)) ? ok('无数据时复评给引导文案') : bad('复评空态异常');
// 播种两次评估 → 对比出差值；肌群分析给出结论
await evl(`(() => { const now = Date.now();
  localStorage.setItem('rehab_rom_history', JSON.stringify([{ id: 'n1', ts: now, key: 'kneeFlex', side: 'L', min: 42, max: 175, rom: 138, level: 'good' }, { id: 'n2', ts: now - 86400000, key: 'kneeFlex', side: 'L', min: 52, max: 175, rom: 128, level: 'warn' }]));
  localStorage.setItem('rehab_ft_history', JSON.stringify([{ key: 'battery', battery: true, ts: now, score: 74, sim: 74, dims: { sym: 62, align: 78, dyn: 80, stab: 80, rom: 80, cons: 80 }, m: {} }, { key: 'battery', battery: true, ts: now - 86400000, score: 70, sim: 70, dims: { sym: 60, align: 76, dyn: 78, stab: 78, rom: 78, cons: 78 }, m: {} }]));
  localStorage.setItem('rehab_pa_history', JSON.stringify([{ kind: 'standing', ts: now, score: 78, grade: 'B', items: [], priorities: [{ label: '膝内扣趋势', level: 'warn', text: '', advice: '' }] }]));
  return true; })()`);
await evl(`document.querySelector('.bottom-nav button[data-tab="train"]').click(); document.querySelector('.bottom-nav button[data-tab="recheck"]').click()`);
await sleep(550);
(await evl(`document.getElementById('rc-compare').textContent.includes('+10')`)) ? ok('复评对比自动算出活动度 +10°（前后对照）') : bad('复评差值未显示');
(await evl(`document.querySelectorAll('#rc-compare .rc-row').length >= 2`)) ? ok('对比表含活动度与功能测试等多项') : bad('对比表项目不足');
(await evl(`(() => { const s = document.getElementById('body-analysis').textContent; return s.includes('肌群') && s.includes('推荐动作'); })()`)) ? ok('AI 分析给出薄弱环节 + 建议肌群 + 推荐动作') : bad('肌群分析缺失');
await evl(`document.getElementById('btn-an-plan').click()`);
await sleep(650);
(await evl(`JSON.parse(localStorage.getItem('rehab_plan') || '[]').length >= 1`)) ? ok('按分析一键生成今日计划（分析→训练块联动）') : bad('计划生成失败');
await evl(`['rehab_rom_history','rehab_ft_history','rehab_pa_history','rehab_plan'].forEach((k) => localStorage.removeItem(k))`);

console.log('===== 结果 =====');
console.log('CONSOLE_ERRORS:', consoleErrors.length ? consoleErrors.join(' ||| ') : 'none');
if (consoleErrors.length) failN++;
console.log(`PASS ${pass} / FAIL ${failN} / 总计 ${pass + failN}`);
ws.close();
process.exit(failN ? 1 : 0);
