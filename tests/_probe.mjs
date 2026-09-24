const CDP='http://127.0.0.1:9228', APP='http://127.0.0.1:8000/index.html';
const tab = await (await fetch(CDP+'/json/new?'+encodeURIComponent('about:blank'),{method:'PUT'})).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
let idc=0;const pending=new Map();const errs=[];
ws.onmessage=(ev)=>{const m=JSON.parse(String(ev.data)); if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);return;}
 if(m.method==='Runtime.exceptionThrown'){const d=m.params.exceptionDetails;errs.push('EXC: '+(d.exception?.description||d.text).slice(0,200)+' @'+d.url+':'+d.lineNumber);}
 else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errs.push('CONSOLE: '+m.params.args.map(a=>a.value??a.description??'').join(' ').slice(0,200));};
const send=(m,p={})=>new Promise(res=>{const id=++idc;pending.set(id,res);ws.send(JSON.stringify({id,method:m,params:p}))});
const evl=async(e)=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});return r.result.result.value;};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});
await send('Page.navigate',{url:APP}); await sleep(3500);
console.log('chips:', await evl("document.querySelectorAll('#ex-chips .chip').length"), 'ver:', await evl("(document.getElementById('about-version')||{}).textContent"));
console.log('errors:', errs.length); console.log(errs.slice(0,6).join('\n'));
process.exit(0);
