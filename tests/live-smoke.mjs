import http from 'node:http';
const get = (p, method = 'GET') => new Promise((res, rej) => {
  const req = http.request('http://127.0.0.1:9228' + p, { method }, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); });
  req.on('error', rej); req.end();
});
const URL_ = process.env.RH_APP_URL || 'https://xushengqin666-cell.github.io/rehab-ai/';
const v = await get('/json/new?about:blank', 'PUT');
const ws = new WebSocket(v.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (msg) => {
  const m = JSON.parse(msg.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value || a.description).join(' '));
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
};
await new Promise(r => ws.onopen = r);
const send = (method, params) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: URL_ });
await new Promise(r => setTimeout(r, 9000));
const res = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    title: document.title,
    hasLogin: !!document.getElementById('auth-screen'),
    authVisible: (() => { const e = document.getElementById('auth-screen'); return e ? !e.classList.contains('hidden') : null; })(),
    hasVersion: document.getElementById('about-version') ? document.getElementById('about-version').textContent : '',
  })`, returnByValue: true
});
console.log('PAGE:', res.result.result.value);
console.log('CONSOLE_ERRORS:', errors.length ? errors.join(' || ') : 'none');
ws.close();
process.exit(0);
