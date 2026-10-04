/* 全ページ共通の処理先。設定変更はページ再読込で実行単位を分離する。 */
(()=>{
'use strict';
const storage='testjeff-connection-v1';let config={mode:'local',host:'127.0.0.1',port:8767,device:'auto'};
try{config={...config,...JSON.parse(localStorage.getItem(storage)||'{}')};}catch{}
let selected='qwen-2b',active=0;
const originalFetch=window.fetch.bind(window);
window.TestJeffConnection={config,key:config.mode==='fds'?`fds:${config.host}:${config.port}:${config.device}`:'local'};
const inferencePaths=new Set(['/v1/systemone','/testjeff/photos','/testjeff/model','/testjeff/luna']);
function lock(){const form=document.getElementById('connection-form');if(form)for(const node of form.querySelectorAll('input,select,button'))node.disabled=active>0||!!window.TestJeffBusy;}
window.fetch=async(input,options={})=>{
 const url=new URL(typeof input==='string'?input:input.url,location.href);
 if(url.origin!==location.origin)return originalFetch(input,options);
 const headers=new Headers(options.headers||{});
 if(config.mode==='fds'&&(url.pathname.startsWith('/testjeff/')||url.pathname==='/v1/systemone')){
  headers.set('X-TestJeff-Backend','fds');headers.set('X-TestJeff-Host',config.host);headers.set('X-TestJeff-Port',String(config.port));headers.set('X-TestJeff-Device',config.device);headers.set('X-TestJeff-Model',selected);
 }
 const tracked=inferencePaths.has(url.pathname);if(tracked){active++;lock();}
 try{
  const response=await originalFetch(input,{...options,headers});
  if(response.ok&&url.pathname==='/testjeff/model')selected=(await response.clone().json()).selected;
  return response;
 }finally{if(tracked){active--;lock();}}
};
window.addEventListener('testjeff-busy',lock);
window.addEventListener('DOMContentLoaded',()=>{
 const panel=document.createElement('form');panel.id='connection-form';panel.style.cssText='display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px;margin:8px 0;border:1px solid #cbd8cd;border-radius:8px;font:14px system-ui';
 panel.innerHTML='<label>処理先 <select id="backend"><option value="local">ローカル</option><option value="fds">サーバー（FDS）</option></select></label><label>IP <input id="fds-host" size="16" aria-label="FDSのIPアドレス"></label><label>ポート <input id="fds-port" type="number" min="1" max="65535" style="width:85px"></label><label>デバイス <select id="fds-device"><option value="auto">自動</option><option value="cuda">GPU</option><option value="cpu">CPU</option></select></label><button type="button" id="fds-check">接続確認</button><button type="submit" id="connection-apply">適用</button><span id="connection-status" role="status"></span>';
 (document.querySelector('main')||document.body).prepend(panel);
 const node=id=>document.getElementById(id);node('backend').value=config.mode;node('fds-host').value=config.host;node('fds-port').value=config.port;node('fds-device').value=config.device;
 const draft=()=>({mode:node('backend').value,host:node('fds-host').value.trim(),port:Number(node('fds-port').value),device:node('fds-device').value});
 function show(){for(const id of ['fds-host','fds-port','fds-device','fds-check'])node(id).closest(id==='fds-check'?'button':'label').hidden=node('backend').value!=='fds';}
 node('backend').onchange=show;show();node('connection-status').textContent=config.mode==='fds'?`FDS ${config.host}:${config.port}`:'ローカル';
 async function check(value){
  const headers={'X-TestJeff-Backend':'fds','X-TestJeff-Host':value.host,'X-TestJeff-Port':String(value.port),'X-TestJeff-Device':value.device,'X-TestJeff-Model':'qwen-2b'};
  const key=document.getElementById('key')?.value;if(key)headers.Authorization=`Bearer ${key}`;
  const response=await originalFetch('/testjeff/fds-check',{headers});const result=await response.json();if(!response.ok||!result.ready)throw Error(result.detail||'FDSが準備できていません');return result;
 }
 node('fds-check').onclick=async()=>{active++;lock();try{await check(draft());node('connection-status').textContent='接続確認済み';}catch(e){node('connection-status').textContent=e.message;}finally{active--;lock();}};
 panel.onsubmit=async e=>{e.preventDefault();if(active||window.TestJeffBusy)return;const value=draft();active++;lock();try{if(value.mode==='fds')await check(value);localStorage.setItem(storage,JSON.stringify(value));location.reload();}catch(e){node('connection-status').textContent=e.message;}finally{active--;lock();}};
});
})();
