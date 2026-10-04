/* 処理先変更を自動確認し、実行単位をページ再読込で分離する。 */
(()=>{
'use strict';
const storage='testjeff-connection-v1';let config={mode:'local',host:'127.0.0.1',port:8767,device:'auto',local_device:null,auto_unload:true};
try{config={...config,...JSON.parse(localStorage.getItem(storage)||'{}')};}catch{}
config.auto_unload=config.auto_unload!==false;
let selected='qwen-2b',active=0,checking=false,pending=false,approvalOpen=false;
const originalFetch=window.fetch.bind(window);
window.TestJeffConnection={config,key:config.mode==='fds'?`fds:${config.host}:${config.port}:${config.device}`:config.local_device==='cpu'?'local:cpu':'local'};
const managementPaths=new Set(['/testjeff/model','/testjeff/fds-models/load','/testjeff/fds-models/unload']);
const inferencePaths=new Set(['/v1/systemone','/testjeff/photos','/testjeff/model','/testjeff/luna','/testjeff/battle-batch',...managementPaths]);
const cancelled=()=>Object.assign(new Error('モデル操作を取り消しました。'),{name:'ApprovalCancelledError',code:'approval_cancelled'});
const isCancelled=error=>error?.code==='approval_cancelled';
function resolvedDevice(model,device){
 if(device!=='auto')return device;
 const capabilities=window.TestJeffConnection.capabilities||{};
 const preferred=capabilities.default_device||capabilities.health?.default_device||model?.default_device||'auto';
 if(preferred!=='auto')return preferred;
 const supported=capabilities.devices||model?.devices||[];
 return supported.includes('cuda')?'cuda':'cpu';
}
function canUse(model,device=config.device){
 if(!model)return false;
 const actual=resolvedDevice(model,device);
 if((model.loaded_devices||[]).includes(actual))return true;
 return model.installed!==false&&model.load_allowed!==false&&(model.loadable??model.available??false)&&((model.devices||[]).includes(device)||(device==='auto'&&(model.devices||[]).includes(actual)));
}
function message(data,fallback){return typeof data?.detail==='string'?data.detail:data?.detail?.message||data?.error?.message||fallback;}
async function checkedServerResponse(response){
 if(!response.ok){const data=await response.clone().json().catch(()=>null),detail=data?.detail;
  if(detail&&typeof detail==='object'&&typeof detail.message==='string')throw Object.assign(new Error(detail.message),typeof detail.code==='string'?{code:detail.code}:{});
 }
 return response;
}
function safeManagement(data){if(!data)return null;return Object.fromEntries(['success','model','device','load_ms','unloaded','loaded_models','generation','auto_unload'].filter(key=>data[key]!==undefined).map(key=>[key,data[key]]));}
Object.assign(window.TestJeffConnection,{canUse,isCancelled,cleanManagement:safeManagement,restoreSelection:model=>{if(model)selected=model;},management:null});
function timeoutMs(path,payload){
 if(path.startsWith('/testjeff/fds-models/')||(path==='/testjeff/model'&&config.mode==='fds'))return 310000;
 if(path==='/testjeff/battle-batch'&&payload?.model!=='gpt-5.6-luna'){
  const count=payload?.candidates?.length;
  if(Number.isInteger(count)&&count>=1&&count<=100)return 15000+Math.ceil(count/8)*120000;
 }
 return inferencePaths.has(path)?135000:15000;
}
window.TestJeffConnection.timeoutMs=timeoutMs;
function lock(){for(const scope of ['connection-form','fds-manager']){const form=document.getElementById(scope);if(form)for(const node of form.querySelectorAll('input,select,button:not([data-close])'))node.disabled=node.dataset.unavailable==='true'||active>0||!!window.TestJeffBusy||checking;}}
function headersFor(value){return {'X-TestJeff-Backend':'fds','X-TestJeff-Host':value.host,'X-TestJeff-Port':String(value.port),'X-TestJeff-Device':value.device,'X-TestJeff-Model':selected,'X-TestJeff-Auto-Unload':String(value.auto_unload!==false)};}
function authHeaders(){const headers={'Content-Type':'application/json'},key=document.getElementById('key')?.value;if(key)headers.Authorization='Bearer '+key;return headers;}
async function approve(approval,value,signal){
 if(approvalOpen)throw Error('別のモデル承認を確認中です。');
 if(signal?.aborted)throw cancelled();
 if(document.readyState==='loading')await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
 const dialog=document.getElementById('fds-approval');if(!dialog)throw Error('承認画面を準備できませんでした。');
 approvalOpen=true;
 const text=id=>document.getElementById(id);text('fds-approval-target').textContent=`${value.host}:${value.port} ／ ${approval.model} ／ ${approval.device==='cuda'?'GPU':'CPU'}`;
 text('fds-approval-reason').textContent=approval.reason||'モデルの解放が必要です。';
 text('fds-approval-action').textContent=approval.action==='unload'?'アンロードを承認':'解放してロード';
 text('fds-approval-list').replaceChildren(...(approval.unload||[]).map(item=>{const li=document.createElement('li');li.textContent=`${item.model} ／ ${item.device==='cuda'?'GPU':'CPU'}`;return li;}));
 return new Promise(resolve=>{
  let accepted=false;const abort=()=>dialog.close();
  text('fds-approval-action').onclick=()=>{accepted=true;dialog.close();};text('fds-approval-cancel').onclick=()=>dialog.close();
  dialog.onclose=()=>{approvalOpen=false;signal?.removeEventListener('abort',abort);resolve(accepted&&!signal?.aborted);};
  signal?.addEventListener('abort',abort,{once:true});dialog.showModal();text('fds-approval-cancel').focus();
 });
}
async function sendWithApproval(input,options,value=config){
 const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;
 let payload;try{payload=JSON.parse(options.body);}catch{}
 const send=body=>originalFetch(input,{...options,...(body?{body:JSON.stringify(body)}:{}),signal:options.signal||AbortSignal.timeout(timeoutMs(path,body))});
 let response=await send(payload);
 if(value.mode!=='fds')return response;
 if(response.status!==409)return checkedServerResponse(response);
 const data=await response.clone().json().catch(()=>null);if(data?.detail?.code!=='approval_required')return checkedServerResponse(response);
 if(!managementPaths.has(path))throw Object.assign(new Error('推論中にモデルの解放承認が必要になりました。モデルを準備してから再実行してください。自動再送はしていません。'),{code:'approval_required'});
 const approval=data.detail.approval;if(!approval?.token||!payload)throw Error('サーバーの承認要求が不正です。');
 if(!await approve(approval,value,options.signal))throw cancelled();
 response=await send({...payload,approval_token:approval.token});
 if(response.status===409){const next=await response.clone().json().catch(()=>null);throw Object.assign(new Error(message(next,'サーバーの状態が変わりました。操作をやり直してください。')),{code:typeof next?.detail?.code==='string'?next.detail.code:'approval_conflict'});}
 return checkedServerResponse(response);
}
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
  const response=await sendWithApproval(input,{...options,headers});
  if(response.ok&&['/testjeff/status','/testjeff/model'].includes(url.pathname)&&config.mode==='fds'){const data=await response.clone().json();if(data.capabilities){window.TestJeffConnection.capabilities=data;window.dispatchEvent(new Event('fds-capabilities'));}}
  if(response.ok&&managementPaths.has(url.pathname)){const data=await response.clone().json();if(data.selected)selected=data.selected;window.TestJeffConnection.management=safeManagement(data.management||data);window.dispatchEvent(new CustomEvent('fds-model-state',{detail:data}));}
  return response;
 }catch(e){if(e.name==='TimeoutError')throw Error('応答の待機期限を超えました。サーバーで計算が続いている場合があります。');throw e;}
 finally{if(tracked){active--;lock();}}
};
window.TestJeffConnection.prepare=async model=>{const response=await fetch('/testjeff/model',{method:'POST',headers:authHeaders(),body:JSON.stringify({model})}),data=await response.json();if(!response.ok||!data.ready)throw Error(message(data,'モデルを準備できませんでした。'));return data;};
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
 #fds-manager,#fds-approval{box-sizing:border-box;width:min(900px,calc(100vw - 24px));height:fit-content;max-height:calc(100dvh - 24px);margin:auto;padding:18px;border:1px solid #9aae9d;border-radius:10px;background:#f4f6f3;color:#23362c;overflow:auto;font:14px system-ui;white-space:normal}
 #fds-approval{width:min(560px,calc(100vw - 24px))}#fds-manager::backdrop,#fds-approval::backdrop{background:#23362c77}
 .fds-dialog-heading,.fds-manager-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}.fds-dialog-heading h2{font-size:18px;margin:0}.fds-dialog-heading button{margin-left:auto}
 #fds-manager table{width:100%;min-width:0;border-collapse:collapse;background:white}#fds-manager td,#fds-manager th{padding:8px;border-bottom:1px solid #ddd;text-align:left;white-space:normal}#fds-manager .fds-table{overflow:auto}#fds-manager button,#fds-manager select,#fds-approval button{font:inherit;padding:6px 9px}#fds-manager-status{white-space:pre-wrap}#fds-approval-target{overflow-wrap:anywhere}#fds-approval-list{padding-left:22px}
 `;document.head.append(style);
 const panel=document.createElement('form');panel.id='connection-form';panel.setAttribute('aria-label','処理先の設定');
 panel.innerHTML='<label>処理先 <select id="backend"><option value="local">ローカル</option><option value="fds">サーバー（FDS）</option></select></label><label>IP <input id="fds-host" size="16" aria-label="FDSのIPアドレス"></label><label>ポート <input id="fds-port" type="number" min="1" max="65535" style="width:85px"></label><label>デバイス <select id="fds-device"><option value="auto">自動</option></select></label><span id="connection-status" role="status"></span>';
 const managerButton=document.createElement('button');managerButton.id='fds-manage';managerButton.type='button';managerButton.textContent='モデル管理';panel.insertBefore(managerButton,panel.lastChild);
 if(['/samples','/samples/'].includes(location.pathname)){const label=document.createElement('label');label.id='fds-default-label';label.append('モデル ');const select=document.createElement('select');select.id='fds-default-model';select.setAttribute('aria-label','FDSモデル');label.append(select);panel.insertBefore(label,managerButton);select.onchange=()=>{selected=select.value;};}
 const manager=document.createElement('dialog');manager.id='fds-manager';manager.setAttribute('aria-labelledby','fds-manager-title');manager.innerHTML='<div class="fds-dialog-heading"><h2 id="fds-manager-title">モデル管理</h2><button type="button" data-close>閉じる</button></div><div class="fds-manager-actions"><label>自動アンロード <select id="fds-auto-unload"><option value="true">許可して確認</option><option value="false">しない</option></select></label><button type="button" id="fds-model-refresh">更新</button></div><div class="fds-table"><table><thead><tr><th>モデル</th><th>状態</th><th>操作許可</th><th>CPU / GPU</th><th>操作</th></tr></thead><tbody id="fds-model-rows"></tbody></table></div><p id="fds-manager-status" role="status"></p>';document.body.append(manager);manager.querySelector('[data-close]').onclick=()=>manager.close();
 const approval=document.createElement('dialog');approval.id='fds-approval';approval.setAttribute('aria-labelledby','fds-approval-title');approval.innerHTML='<h2 id="fds-approval-title">モデルの解放を確認</h2><p id="fds-approval-target"></p><p id="fds-approval-reason"></p><ul id="fds-approval-list"></ul><div class="fds-manager-actions"><button type="button" id="fds-approval-cancel">キャンセル</button><button type="button" id="fds-approval-action">承認</button></div>';document.body.append(approval);
 const header=document.querySelector('main>header')||document.querySelector('body>header'),title=header?.querySelector('h1,.brand');
 const navigation=header?.querySelector('nav');
 if(navigation){
  const actions=[...navigation.children].filter(child=>child.tagName!=='A');
  const pages=[['/','トップページ']];
  const links=pages.map(([href,label])=>{const link=document.createElement('a');link.href=href;link.textContent=label;if(location.pathname===href)link.setAttribute('aria-current','page');return link;});
  navigation.setAttribute('aria-label','ページ移動');navigation.replaceChildren(...links,...actions);
 }
 if(header&&title){header.classList.add('testjeff-page-header');const row=document.createElement('div');row.className='testjeff-title-row';const remaining=[...header.children].filter(child=>child!==title);header.prepend(row);row.append(title,panel,...remaining);}
 else (document.querySelector('main')||document.body).prepend(panel);
 new MutationObserver(()=>{const status=document.getElementById('connection-status');status.classList.toggle('connection-ok',['ローカル','接続済み'].includes(status.textContent));}).observe(document.getElementById('connection-status'),{childList:true});
 const node=id=>document.getElementById(id);node('backend').value=config.mode;node('fds-host').value=config.host;node('fds-port').value=config.port;
 const draft=()=>({mode:node('backend').value,host:node('fds-host').value.trim(),port:Number(node('fds-port').value),device:node('backend').value==='fds'?(node('fds-device').value||config.device):config.device,local_device:node('backend').value==='local'?(node('fds-device').value||config.local_device):config.local_device,auto_unload:config.auto_unload});
 function show(){const hidden=node('backend').value!=='fds';for(const id of ['fds-host','fds-port'])node(id).closest('label').hidden=hidden;managerButton.hidden=hidden;if(node('fds-default-label'))node('fds-default-label').hidden=hidden;}
 node('fds-auto-unload').value=String(config.auto_unload);node('fds-auto-unload').onchange=()=>{config.auto_unload=node('fds-auto-unload').value==='true';localStorage.setItem(storage,JSON.stringify(config));};
 async function refreshModels(){
  node('fds-manager-status').textContent='取得中';
  try{const response=await fetch('/testjeff/fds-models',{headers:authHeaders()}),data=await response.json();if(!response.ok)throw Error(message(data,'一覧を取得できませんでした。'));
   const entries=data.capabilities||data.models||data.data||[];window.TestJeffConnection.capabilities={...window.TestJeffConnection.capabilities,...data,capabilities:entries};window.dispatchEvent(new Event('fds-capabilities'));node('fds-model-rows').replaceChildren();
   for(const model of entries){const tr=document.createElement('tr'),loaded=model.loaded_devices||(data.loaded_models||[]).filter(item=>item.model===model.id).map(item=>item.device),installed=model.installed??model.available;
    for(const value of [model.name||model.id,installed?(loaded.length?'ロード済み':'導入済み・未ロード'):'未導入',`ロード ${model.load_allowed===false?'不可':'可'} ／ 解放 ${model.unload_allowed===false?'不可':'可'}`]){const td=document.createElement('td');td.textContent=value;tr.append(td);}
    const deviceCell=document.createElement('td'),choice=document.createElement('select');choice.setAttribute('aria-label',`${model.name||model.id}のデバイス`);for(const device of model.devices||[]){const option=document.createElement('option');option.value=device;option.textContent=(device==='cuda'?'GPU':device==='cpu'?'CPU':'自動')+(loaded.includes(resolvedDevice(model,device))?'（ロード済み）':'');choice.append(option);}if((model.devices||[]).includes(config.device))choice.value=config.device;deviceCell.append(choice);tr.append(deviceCell);
    const actions=document.createElement('td');for(const action of ['load','unload']){const button=document.createElement('button');button.type='button';button.textContent=action==='load'?'ロード':'アンロード';button.dataset.action=action;button.disabled=action==='load'?!canUse(model,choice.value):model.unload_allowed===false||!loaded.includes(resolvedDevice(model,choice.value));button.onclick=async()=>{node('fds-manager-status').textContent='処理中';try{const response=await fetch('/testjeff/fds-models/'+action,{method:'POST',headers:authHeaders(),body:JSON.stringify({model:model.local_id||model.id,device:choice.value,auto_unload:config.auto_unload})}),result=await response.json();if(!response.ok)throw Error(message(result,'モデル操作に失敗しました。'));await refreshModels();node('fds-manager-status').textContent='操作完了';}catch(e){node('fds-manager-status').textContent=e.message;}};actions.append(button);}
    choice.onchange=()=>{actions.children[0].disabled=!canUse(model,choice.value);actions.children[1].disabled=model.unload_allowed===false||!loaded.includes(resolvedDevice(model,choice.value));for(const button of actions.children)button.dataset.unavailable=String(button.disabled);};choice.onchange();tr.append(actions);node('fds-model-rows').append(tr);
   }node('fds-manager-status').textContent='';
  }catch(e){node('fds-manager-status').textContent=e.message;}
 }
 managerButton.onclick=()=>{manager.showModal();void refreshModels();};node('fds-model-refresh').onclick=refreshModels;
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
  for(const id of ['model-select','model','fds-default-model']){const select=node(id);if(!select||select.tagName!=='SELECT')continue;
   const current=select.value,images=location.pathname.startsWith('/photos')||location.pathname.startsWith('/classification');
   const candidates=data.capabilities.filter(m=>canUse(m)&&m.local_id&&(!images||m.modalities.includes('image')));
   select.replaceChildren();for(const m of candidates){const option=document.createElement('option');option.value=m.local_id;option.textContent=m.name;select.append(option);}
   select.value=candidates.some(m=>m.local_id===current)?current:(candidates[0]?.local_id||'');if(id==='fds-default-model'&&select.value)selected=select.value;
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
    const response=await sendWithApproval('/testjeff/fds-check',{headers},value),result=await response.json();
    if(!response.ok||!result.health?.accepting)throw Error(message(result,'FDSが受付できません。'));
    if(!result.devices?.length)throw Error('サーバーに利用可能なデバイスがありません。');
    if(!result.devices.includes(value.device))value.device=result.devices[0];
    if(!initial&&config.mode==='fds'&&config.host===value.host&&config.port===value.port&&config.device!==value.device){
     const model=node('model-select')?.value||node('model')?.value||node('fds-default-model')?.value||selected;
     const prepared=await sendWithApproval('/testjeff/model',{method:'POST',headers:{...headers,...authHeaders()},body:JSON.stringify({model,device:value.device,auto_unload:value.auto_unload})},value),state=await prepared.json();
     if(!prepared.ok||!state.ready)throw Error(message(state,'モデルを準備できませんでした。'));window.TestJeffConnection.management=safeManagement(state.management);selected=state.selected;
    }
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
  }catch(e){pending=isCancelled(e)?false:!initial;if(isCancelled(e)){node('backend').value=config.mode;node('fds-host').value=config.host;node('fds-port').value=config.port;show();applyCapabilities();}node('connection-status').textContent=isCancelled(e)?'変更を取り消しました':'接続失敗：'+(e.name==='TimeoutError'?'応答がありません。':e.message);}
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
