/* 処理先変更を自動確認し、実行単位をページ再読込で分離する。 */
(()=>{
'use strict';
const storage='testjeff-connection-v1';let config={mode:'local',host:'127.0.0.1',port:8767,device:'auto'};
try{config={...config,...JSON.parse(localStorage.getItem(storage)||'{}')};}catch{}
let selected='qwen-2b',active=0,checking=false,pending=false;
const originalFetch=window.fetch.bind(window);
window.TestJeffConnection={config,key:config.mode==='fds'?`fds:${config.host}:${config.port}:${config.device}`:'local'};
const inferencePaths=new Set(['/v1/systemone','/testjeff/photos','/testjeff/model','/testjeff/luna','/testjeff/battle-batch']);
function lock(){const form=document.getElementById('connection-form');if(form)for(const node of form.querySelectorAll('input,select'))node.disabled=active>0||!!window.TestJeffBusy||checking;}
function headersFor(value){return {'X-TestJeff-Backend':'fds','X-TestJeff-Host':value.host,'X-TestJeff-Port':String(value.port),'X-TestJeff-Device':value.device,'X-TestJeff-Model':selected};}
window.fetch=async(input,options={})=>{
 const url=new URL(typeof input==='string'?input:input.url,location.href);
 if(url.origin!==location.origin)return originalFetch(input,options);
 const tracked=inferencePaths.has(url.pathname);
 if(tracked&&(pending||checking))throw Error('接続設定の確認が終わってから再実行してください。');
 const headers=new Headers(options.headers||{});
 if(config.mode==='fds'&&(url.pathname.startsWith('/testjeff/')||url.pathname==='/v1/systemone'))for(const [k,v] of Object.entries(headersFor(config)))headers.set(k,v);
 if(tracked){active++;lock();}
 try{
  const response=await originalFetch(input,{...options,headers,signal:options.signal||AbortSignal.timeout(tracked?135000:15000)});
  if(response.ok&&['/testjeff/status','/testjeff/model'].includes(url.pathname)&&config.mode==='fds'){const data=await response.clone().json();if(data.capabilities){window.TestJeffConnection.capabilities=data;window.dispatchEvent(new Event('fds-capabilities'));}}
  if(response.ok&&url.pathname==='/testjeff/model')selected=(await response.clone().json()).selected;
  return response;
 }catch(e){if(e.name==='TimeoutError'||e.name==='AbortError')throw Error('応答の待機期限を超えました。サーバーで計算が続いている場合があります。');throw e;}
 finally{if(tracked){active--;lock();}}
};
window.addEventListener('testjeff-busy',lock);
window.addEventListener('DOMContentLoaded',()=>{
 const style=document.createElement('style');style.textContent='#connection-form [hidden]{display:none!important}#connection-form label{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}#connection-form input,#connection-form select{width:auto;margin:0;padding:6px;min-width:0}';document.head.append(style);
 const panel=document.createElement('form');panel.id='connection-form';panel.style.cssText='display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px;margin:8px 0;border:1px solid #cbd8cd;border-radius:8px;font:14px system-ui';
 panel.innerHTML='<label>処理先 <select id="backend"><option value="local">ローカル</option><option value="fds">サーバー（FDS）</option></select></label><label>IP <input id="fds-host" size="16" aria-label="FDSのIPアドレス"></label><label>ポート <input id="fds-port" type="number" min="1" max="65535" style="width:85px"></label><label>デバイス <select id="fds-device"><option value="auto">自動</option></select></label><span id="connection-status" role="status"></span>';
 (document.querySelector('main')||document.body).prepend(panel);
 const node=id=>document.getElementById(id);node('backend').value=config.mode;node('fds-host').value=config.host;node('fds-port').value=config.port;
 const draft=()=>({mode:node('backend').value,host:node('fds-host').value.trim(),port:Number(node('fds-port').value),device:node('fds-device').value||config.device});
 function show(){for(const id of ['fds-host','fds-port','fds-device'])node(id).closest('label').hidden=node('backend').value!=='fds';}
 function applyCapabilities(){
  const data=window.TestJeffConnection.capabilities;if(!data)return;
  const choice=node('fds-device'),wanted=config.device;choice.replaceChildren();
  for(const device of data.devices||[]){const option=document.createElement('option');option.value=device;option.textContent={auto:'自動',cpu:'サーバーCPU',cuda:'サーバーGPU'}[device]||device;choice.append(option);}
  choice.value=(data.devices||[]).includes(wanted)?wanted:(data.devices?.[0]||'');
  if(config.mode!=='fds')return;
  for(const id of ['model-select','model']){const select=node(id);if(!select||select.tagName!=='SELECT')continue;
   const current=select.value,images=location.pathname.startsWith('/photos')||location.pathname.startsWith('/classification');
   const candidates=data.capabilities.filter(m=>m.available&&m.local_id&&(!images||m.modalities.includes('image'))&&m.devices.includes(config.device));
   select.replaceChildren();for(const m of candidates){const option=document.createElement('option');option.value=m.local_id;option.textContent=m.name;select.append(option);}
   select.value=candidates.some(m=>m.local_id===current)?current:(candidates[0]?.local_id||'');
   if(!candidates.length)select.disabled=true;
  }
 }
 window.addEventListener('fds-capabilities',applyCapabilities);
 let debounce;
 async function apply(initial=false){
  clearTimeout(debounce);if(active||window.TestJeffBusy){pending=false;node('connection-status').textContent='処理終了後に設定を変更してください。';return;}
  const value=initial?{...config}:draft();checking=true;lock();show();node('connection-status').textContent='接続を確認中';
  try{
   if(value.mode==='fds'){
    const headers=headersFor(value),key=node('key')?.value;if(key)headers.Authorization=`Bearer ${key}`;
    const response=await originalFetch('/testjeff/fds-check',{headers,signal:AbortSignal.timeout(12000)}),result=await response.json();
    if(!response.ok||!result.health?.accepting)throw Error(typeof result.detail==='string'?result.detail:'FDSが受付できません。');
    if(!result.devices?.length)throw Error('サーバーに利用可能なデバイスがありません。');
    if(!result.devices.includes(value.device))value.device=result.devices[0];
    window.TestJeffConnection.capabilities=result;
   }
   const changed=JSON.stringify(value)!==JSON.stringify(config);
   if(changed){localStorage.setItem(storage,JSON.stringify(value));location.reload();return;}
   pending=false;applyCapabilities();window.dispatchEvent(new Event('fds-capabilities'));node('connection-status').textContent=value.mode==='fds'?'接続済み':'ローカル';
  }catch(e){pending=!initial;node('connection-status').textContent='接続失敗：'+(e.name==='TimeoutError'?'応答がありません。':e.message);}
  finally{checking=false;lock();}
 }
 function schedule(immediate=false){pending=true;clearTimeout(debounce);node('connection-status').textContent='変更を確認中';if(immediate)void apply();else debounce=setTimeout(()=>apply(),650);}
 for(const id of ['backend','fds-device'])node(id).onchange=()=>{show();schedule(true);};
 for(const id of ['fds-host','fds-port'])node(id).oninput=()=>schedule();
 panel.onsubmit=e=>{e.preventDefault();schedule(true);};
 show();node('connection-status').textContent=config.mode==='fds'?'接続を確認中':'ローカル';
 if(config.mode==='fds')void apply(true);
});
})();
