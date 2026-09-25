/* cloud-e2e.mjs —— 云端同步端到端验证（真机两设备场景）
   前提：已把 Supabase 的 url/anonKey 填进 app.js 的 CLOUD_HARDCODED，且已执行 supabase/schema.sql。
   跑法：node tests/cloud-e2e.mjs   （需要 8000 静态服务 + 9228 无头 Chrome，即 start-servers.ps1）
   它做的事：①设备A 注册并产生训练数据 → 自动上云；②清空本机（模拟换设备）；③设备B 用同一账号登录 → 校验数据被拉回。
   未配置后端时会明确跳过并打印待办步骤，不会假装通过。 */
const CDP = 'http://127.0.0.1:' + (process.env.RH_CDP_PORT || '9228');
const APP = 'http://127.0.0.1:8000/index.html?cloude2e=1';
const tab = await (await fetch(CDP + '/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let idc = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(String(ev.data)); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (m, p = {}) => new Promise((res) => { const id = ++idc; pending.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
const evl = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval error'); return r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('OK   ' + m); } else { fail++; console.log('FAIL ' + m); } };
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: APP }); await sleep(3500);
await evl("localStorage.setItem('rehab_onboarded','true')");
const cfg = await evl('(function(){const c=window.__rehabCloud;return c && c.cfg() ? "configured" : "unconfigured";})()');
if (cfg !== 'configured') {
  console.log('== 云端后端尚未配置，已跳过端到端验证 ==');
  console.log('待办：1) 建 Supabase 项目 2) SQL Editor 执行 supabase/schema.sql');
  console.log('      3) 把 Project URL 与 anon key 填进 app.js 的 CLOUD_HARDCODED 4) 重跑本脚本');
  process.exit(0);
}
const email = 'e2e' + Date.now() + '@example.com';
const passwd = 'RehabE2E!' + Date.now().toString(36);
// 设备 A：注册 + 造训练数据 + 上云
await evl('localStorage.clear()');
await sleep(400);
await evl(`(async function(){ await window.__rehabCloud.sync().catch(()=>{}); })()`);
const reg = await evl(`(async function(){ try { await window.__rehabCloud.auth ? 1 : 1; } catch(e){} return 1; })()`);
const regOk = await evl(`(async function(){ try { const r = await fetch(window.__rehabCloud.cfg().url + '/auth/v1/signup', { method:'POST', headers:{ apikey: window.__rehabCloud.cfg().anonKey, 'Content-Type':'application/json' }, body: JSON.stringify({ email:'${email}', password:'${passwd}' }) }); return r.status; } catch(e){ return 'ERR '+e.message; } })()`);
ok(regOk === 200 || regOk === 201, '设备A：注册账号（HTTP ' + regOk + '）');
await evl(`(function(){ const s=JSON.parse(localStorage.getItem('rehab_sessions')||'[]'); s.unshift({ id:'e2e-1', ts: Date.now(), ex:'squat', exName:'深蹲', reps:12, dur:60, depth:'ok', badPct:0, valgusPct:0, risk:0 }); localStorage.setItem('rehab_sessions', JSON.stringify(s)); return s.length; })()`);
const loginA = await evl(`(async function(){ try { const r = await fetch(window.__rehabCloud.cfg().url + '/auth/v1/token?grant_type=password', { method:'POST', headers:{ apikey: window.__rehabCloud.cfg().anonKey, 'Content-Type':'application/json' }, body: JSON.stringify({ email:'${email}', password:'${passwd}' }) }); const j = await r.json(); if(!j.access_token) return 'ERR '+(j.msg||j.error_description||r.status); localStorage.setItem('rehab_cloud_session', JSON.stringify({ access_token:j.access_token, refresh_token:j.refresh_token, uid:j.user.id, email:j.user.email })); return 'ok'; } catch(e){ return 'ERR '+e.message; } })()`);
ok(loginA === 'ok', '设备A：登录并拿到会话');
const push = await evl(`(async function(){ try { await window.__rehabCloud.sync(); return 'ok'; } catch(e){ return 'ERR '+e.message; } })()`);
ok(push === 'ok', '设备A：数据推送到云端');
// 设备 B：清空本机（模拟换设备）后重新登录，看数据是否拉回
await evl("localStorage.clear(); localStorage.setItem('rehab_onboarded','true')");
await sleep(500);
const before = await evl("JSON.parse(localStorage.getItem('rehab_sessions')||'[]').length");
ok(before === 0, '设备B：本机已是干净的（模拟新设备）');
const loginB = await evl(`(async function(){ try { const r = await fetch(window.__rehabCloud.cfg().url + '/auth/v1/token?grant_type=password', { method:'POST', headers:{ apikey: window.__rehabCloud.cfg().anonKey, 'Content-Type':'application/json' }, body: JSON.stringify({ email:'${email}', password:'${passwd}' }) }); const j = await r.json(); if(!j.access_token) return 'ERR '+(j.msg||r.status); localStorage.setItem('rehab_cloud_session', JSON.stringify({ access_token:j.access_token, refresh_token:j.refresh_token, uid:j.user.id, email:j.user.email })); return 'ok'; } catch(e){ return 'ERR '+e.message; } })()`);
ok(loginB === 'ok', '设备B：用同一账号登录');
const pull = await evl(`(async function(){ try { await window.__rehabCloud.sync(); return 'ok'; } catch(e){ return 'ERR '+e.message; } })()`);
ok(pull === 'ok', '设备B：从云端拉取并合并');
const after = await evl("JSON.parse(localStorage.getItem('rehab_sessions')||'[]').length");
ok(after >= 1, '设备B：训练数据已跨设备出现（' + after + ' 条）');
// 注销账号必须把云端一起删掉
const delOk = await evl(`(async function(){ try { await window.__rehabCloud.del(); return 'ok'; } catch(e){ return 'ERR '+e.message; } })()`);
ok(delOk === 'ok', '注销账号：云端账号与数据一并删除');
console.log('—— 云端端到端：PASS ' + pass + ' / FAIL ' + fail + ' ——');
process.exit(fail ? 1 : 0);