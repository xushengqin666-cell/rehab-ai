// synctest 执行器
const CDP_HTTP = 'http://127.0.0.1:' + (process.env.RH_CDP_PORT || '9228');
const APP = process.env.RH_APP_URL || 'http://127.0.0.1:8000/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const created = await (await fetch(CDP_HTTP + '/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' })).json();
const ws = new WebSocket(created.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let idc = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(String(ev.data)); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((resolve) => { const id = ++idc; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: APP + '?synctest=1' });
await sleep(4500);
const r = await send('Runtime.evaluate', { expression: `document.getElementById('selftest-out').textContent.replace(/\\s+/g,' ')`, returnByValue: true });
console.log('SYNCTEST:', r.result.result.value.trim());
ws.close();
process.exit(r.result.result.value.includes('❌') ? 1 : 0);
