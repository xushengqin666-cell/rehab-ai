import http from 'node:http';
const get = (p, method = 'GET') => new Promise((res, rej) => {
  const req = http.request('http://127.0.0.1:9228' + p, { method }, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); });
  req.on('error', rej); req.end();
});
const v = await get('/json/new?http://127.0.0.1:8000/index.html%23selftest', 'PUT');
const ws = new WebSocket(v.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (msg) => { const m = JSON.parse(msg.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const send = (method, params) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
await send('Runtime.enable');
await new Promise(r => setTimeout(r, 6000));
const res = await send('Runtime.evaluate', { expression: `document.getElementById('selftest-out') ? document.getElementById('selftest-out').textContent : 'NO-EL'`, returnByValue: true });
console.log(res.result.result.value);
ws.close();
process.exit(0);
