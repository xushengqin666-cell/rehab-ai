// 模拟 Supabase 服务器（auth/signup + token + userdata 表）—— 用于云同步端到端测试
import http from 'node:http';

const users = new Map();       // email -> {id, password}
const store = new Map();       // uid -> payload

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (code, obj) => {
    res.writeHead(code, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, prefer',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    });
    res.end(JSON.stringify(obj));
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, prefer', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' });
    res.end();
    return;
  }
  const body = () => new Promise((resolve) => { let d = ''; req.on('data', (c) => d += c); req.on('end', () => resolve(d ? JSON.parse(d) : {})); });
  (async () => {
    try {
      if (req.method === 'POST' && u.pathname === '/auth/v1/signup') {
        const b = await body();
        if (users.has(b.email)) { send(400, { msg: 'User already registered' }); return; }
        const id = 'u-' + Math.random().toString(36).slice(2, 8);
        users.set(b.email, { id, password: b.password });
        send(200, { access_token: 'tok-' + id, refresh_token: 'r', user: { id, email: b.email } });
      } else if (req.method === 'POST' && u.pathname === '/auth/v1/token') {
        const b = await body();
        const uu = users.get(b.email);
        if (!uu || uu.password !== b.password) { send(400, { msg: 'Invalid login credentials' }); return; }
        send(200, { access_token: 'tok-' + uu.id, refresh_token: 'r', user: { id: uu.id, email: b.email } });
      } else if (req.method === 'GET' && u.pathname === '/rest/v1/userdata') {
        const uid = (u.searchParams.get('user_id') || '').replace('eq.', '');
        const rows = store.has(uid) ? [{ payload: store.get(uid), updated_at: new Date().toISOString() }] : [];
        send(200, rows);
      } else if (req.method === 'POST' && u.pathname === '/rest/v1/userdata') {
        const b = await body();
        store.set(b.user_id, b.payload);
        send(201, []);
      } else if (req.method === 'POST' && u.pathname === '/rest/v1/rpc/delete_my_account') {
        // v2.36.0：与 supabase/schema.sql 里的 delete_my_account() 对齐 —— 注销账号要连云端数据一起删
        const auth = String(req.headers['authorization'] || '');
        const uid = auth.startsWith('Bearer tok-') ? auth.slice('Bearer tok-'.length) : '';
        if (!uid) { send(401, { msg: 'not authenticated' }); return; }
        store.delete(uid);
        for (const [em, v] of [...users.entries()]) { if (v.id === uid) users.delete(em); }
        send(204, null);
      } else {
        send(404, { msg: 'not found: ' + req.method + ' ' + u.pathname });
      }
    } catch (e) { send(500, { msg: String(e) }); }
  })();
});
server.listen(8555, '127.0.0.1', () => console.log('mock-supabase listening on 8555'));
