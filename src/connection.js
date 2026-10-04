/* 処理先変更を自動確認し、実行単位をページ再読込で分離する。 */
(()=>{
'use strict';
const storage='testjeff-connection-v1';let config={mode:'local',host:'127.0.0.1',port:8767,device:'auto',local_device:null};
try{config={...config,...JSON.parse(localStorage.getItem(storage)||'{}')};}catch{}
let selected='qwen-2b',active=0,checking=false,pending=false;
const originalFetch=window.fetch.bind(window);
window.TestJeffConnection={config,key:config.mode==='fds'?`fds:${config.host}:${config.port}:${config.device}`:config.local_device==='cpu'?'local:cpu':'local'};
const inferencePaths=new Set(['/v1/systemone','/testjeff/photos','/testjeff/model','/testjeff/luna','/testjeff/battle-batch']);
function timeoutMs(path,payload){
 if(path==='/testjeff/battle-batch'&&payload?.model!=='gpt-5.6-luna'){
  const count=payload?.candidates?.length;
  if(Number.isInteger(count)&&count>=1&&count<=100)return 15000+Math.ceil(count/8)*120000;
 }
 return inferencePaths.has(path)?135000:15000;
}
window.TestJeffConnection.timeoutMs=timeoutMs;
function lock(){const form=document.getElementById('connection-form');if(form)for(const node of form.querySelectorAll('input,select'))node.disabled=active>0||!!window.TestJeffBusy||checking;}
function headersFor(value){return {'X-TestJeff-Backend':'fds','X-TestJeff-Host':value.host,'X-TestJeff-Port':String(value.port),'X-TestJeff-Device':value.device,'X-TestJeff-Model':selected};}
window.fetch=async(input,options={})=>{
 const url=new URL(typeof input==='string'?input:input.url,location.href);
 if(url.origin!==location.origin)return originalFetch(input,options);
 const tracked=inferencePaths.has(url.pathname);
 if(tracked&&(pending||checking))throw Error('接続設定の確認が終わってから再実行してください。');
 const headers=new Headers(options.headers||{});
 if(config.mode==='fds'&&(url.pathname.startsWith('/testjeff/')||url.pathname==='/v1/systemone'))for(const [k,v] of Object.entries(headersFor(config)))headers.set(k,v);
 if(config.mode==='local'&&config.local_device){
  headers.set('X-TestJeff-Local-Device',config.local_device);
  if(url.pathname==='/testjeff/model'&&options.body){options={...options,body:JSON.stringify({...JSON.parse(options.body),device:config.local_device})};}
 }
 if(tracked){active++;lock();}
 try{
  let payload;try{if(typeof options.body==='string')payload=JSON.parse(options.body);}catch{}
  const response=await originalFetch(input,{...options,headers,signal:options.signal||AbortSignal.timeout(timeoutMs(url.pathname,payload))});
  if(response.ok&&['/testjeff/status','/testjeff/model'].includes(url.pathname)&&config.mode==='fds'){const data=await response.clone().json();if(data.capabilities){window.TestJeffConnection.capabilities=data;window.dispatchEvent(new Event('fds-capabilities'));}}
  if(response.ok&&url.pathname==='/testjeff/model')selected=(await response.clone().json()).selected;
  return response;
 }catch(e){if(e.name==='TimeoutError'||e.name==='AbortError')throw Error('応答の待機期限を超えました。サーバーで計算が続いている場合があります。');throw e;}
 finally{if(tracked){active--;lock();}}
};
window.addEventListener('testjeff-busy',lock);
window.addEventListener('DOMContentLoaded',()=>{
 const style=document.createElement('style');style.textContent=`
 .testjeff-page-header{display:block;min-width:0}
 .testjeff-title-row{display:flex;align-items:center;flex-wrap:nowrap;gap:16px;overflow-x:auto;max-width:100%;min-width:0;white-space:nowrap}
 .testjeff-title-row>*{flex:0 0 auto}
 .testjeff-title-row>h1,.testjeff-title-row>.brand{flex:0 0 auto;white-space:nowrap;margin:0;font-size:clamp(16px,1.7vw,22px)}
 .testjeff-title-row>nav{display:flex;align-items:center;justify-content:flex-end;flex-wrap:nowrap;gap:12px;margin:0;white-space:nowrap}
 .testjeff-title-row>nav>*{flex:0 0 auto}
 #connection-form{display:flex;gap:7px;align-items:center;flex:0 0 auto;margin:0 0 0 auto;padding:0;border:0;font:12px system-ui;white-space:nowrap}
 #connection-form [hidden]{display:none!important}#connection-form label{display:inline-flex;align-items:center;gap:4px;margin:0;white-space:nowrap}
 #connection-form input,#connection-form select{width:auto;margin:0;padding:5px;min-width:0;font:inherit}
 #connection-form #fds-host{width:118px}#connection-form #fds-port{width:65px!important}
 #connection-status.connection-ok{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
 #connection-status:not(.connection-ok){white-space:nowrap}
 `;document.head.append(style);
 const panel=document.createElement('form');panel.id='connection-form';panel.setAttribute('aria-label','処理先の設定');
 panel.innerHTML='<label>処理先 <select id="backend"><option value="local">ローカル</option><option value="fds">サーバー（FDS）</option></select></label><label>IP <input id="fds-host" size="16" aria-label="FDSのIPアドレス"></label><label>ポート <input id="fds-port" type="number" min="1" max="65535" style="width:85px"></label><label>デバイス <select id="fds-device"><option value="auto">自動</option></select></label><span id="connection-status" role="status"></span>';
 const header=document.querySelector('main>header')||document.querySelector('body>header'),title=header?.querySelector('h1,.brand');
 const navigation=header?.querySelector('nav');
 if(navigation){
  const actions=[...navigation.children].filter(child=>child.tagName!=='A');
  const pages=[['/','トップページ'],['/query-comparison','問い合わせ速度比較'],['/battle','モデル対戦'],['/nouns','名詞判定'],['/photos','文字風景判定'],['/classification','画像分類']];
  const links=pages.map(([href,label])=>{const link=document.createElement('a');link.href=href;link.textContent=label;if(location.pathname===href)link.setAttribute('aria-current','page');return link;});
  navigation.setAttribute('aria-label','ページ移動');navigation.replaceChildren(...links,...actions);
 }
 if(header&&title){header.classList.add('testjeff-page-header');const row=document.createElement('div');row.className='testjeff-title-row';const remaining=[...header.children].filter(child=>child!==title);header.prepend(row);row.append(title,panel,...remaining);}
 else (document.querySelector('main')||document.body).prepend(panel);
 new MutationObserver(()=>{const status=document.getElementById('connection-status');status.classList.toggle('connection-ok',['ローカル','接続済み'].includes(status.textContent));}).observe(document.getElementById('connection-status'),{childList:true});
 const node=id=>document.getElementById(id);node('backend').value=config.mode;node('fds-host').value=config.host;node('fds-port').value=config.port;
 const draft=()=>({mode:node('backend').value,host:node('fds-host').value.trim(),port:Number(node('fds-port').value),device:node('backend').value==='fds'?(node('fds-device').value||config.device):config.device,local_device:node('backend').value==='local'?(node('fds-device').value||config.local_device):config.local_device});
 function show(){for(const id of ['fds-host','fds-port'])node(id).closest('label').hidden=node('backend').value!=='fds';}
 function deviceOptions(devices,wanted,remote){
  const choice=node('fds-device');choice.replaceChildren();
  for(const device of devices){const option=document.createElement('option');option.value=device;option.textContent=device==='auto'?'自動':(remote?'サーバー':'')+(device==='cpu'?'CPU':'GPU');choice.append(option);}
  choice.value=devices.includes(wanted)?wanted:(devices[0]||'');
 }
 function applyCapabilities(){
  if(config.mode==='local'){
   const data=window.TestJeffConnection.localCapabilities;if(data)deviceOptions(data.devices||[],config.local_device,false);return;
  }
  const data=window.TestJeffConnection.capabilities;if(!data)return;
  deviceOptions(data.devices||[],config.device,true);
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
  const value=initial?{...config}:draft();let modelReloaded=false;checking=true;lock();show();node('connection-status').textContent='接続を確認中';
  try{
   if(value.mode==='fds'){
    const headers=headersFor(value),key=node('key')?.value;if(key)headers.Authorization=`Bearer ${key}`;
    const response=await originalFetch('/testjeff/fds-check',{headers,signal:AbortSignal.timeout(12000)}),result=await response.json();
    if(!response.ok||!result.health?.accepting)throw Error(typeof result.detail==='string'?result.detail:'FDSが受付できません。');
    if(!result.devices?.length)throw Error('サーバーに利用可能なデバイスがありません。');
    if(!result.devices.includes(value.device))value.device=result.devices[0];
    window.TestJeffConnection.capabilities=result;
   }else{
    const headers={},key=node('key')?.value;if(key)headers.Authorization=`Bearer ${key}`;
    let response=await originalFetch('/testjeff/status',{headers,signal:AbortSignal.timeout(12000)}),state=await response.json();
    if(!response.ok||!state.devices?.length)throw Error(typeof state.detail==='string'?state.detail:'ローカルの対応デバイスを確認できません。');
    if(!state.devices.includes(value.local_device))value.local_device=state.devices.includes(state.device)?state.device:state.devices[0];
    if(state.device!==value.local_device||!state.ready){
     node('connection-status').textContent='ローカルモデルを切り替え中';
     response=await originalFetch('/testjeff/model',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({model:state.selected||'qwen-2b',device:value.local_device}),signal:AbortSignal.timeout(135000)});state=await response.json();
     if(!response.ok||!state.ready||state.device!==value.local_device)throw Error(typeof state.detail==='string'?state.detail:'ローカルモデルを切り替えられませんでした。');
     modelReloaded=true;
    }
    selected=state.selected;window.TestJeffConnection.localCapabilities=state;
   }
   const changed=JSON.stringify(value)!==JSON.stringify(config);
   if(changed||modelReloaded){localStorage.setItem(storage,JSON.stringify(value));location.reload();return;}
   pending=false;applyCapabilities();window.dispatchEvent(new Event('fds-capabilities'));node('connection-status').textContent=value.mode==='fds'?'接続済み':'ローカル';
  }catch(e){pending=!initial;node('connection-status').textContent='接続失敗：'+(e.name==='TimeoutError'?'応答がありません。':e.message);}
  finally{checking=false;lock();}
 }
 function schedule(immediate=false){pending=true;clearTimeout(debounce);node('connection-status').textContent='変更を確認中';if(immediate)void apply();else debounce=setTimeout(()=>apply(),650);}
 node('backend').onchange=()=>{
  show();const remote=node('backend').value==='fds',data=remote?window.TestJeffConnection.capabilities:window.TestJeffConnection.localCapabilities;
  deviceOptions(data?.devices||(remote?[config.device]:[]),remote?config.device:config.local_device,remote);schedule(true);
 };
 node('fds-device').onchange=()=>schedule(true);
 for(const id of ['fds-host','fds-port'])node(id).oninput=()=>schedule();
 panel.onsubmit=e=>{e.preventDefault();schedule(true);};
 show();node('connection-status').textContent=config.mode==='fds'?'接続を確認中':'ローカル';
 void apply(true);
});
})();
