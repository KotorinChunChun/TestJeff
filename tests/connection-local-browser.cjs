const {chromium}=require('playwright'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),root=path.join(__dirname,'..');
// HTMLもモックで配信し、実サーバーや実モデルを変更せず接続UIを確認する。
async function mockPage(page){
 await page.route('**/*',route=>{
  const pathname=new URL(route.request().url()).pathname;
  const files={'/battle':'src/battle.html','/nouns':'src/nouns.html','/testjeff/nouns':'src/data/nouns.json','/testjeff/abstract-nouns':'src/data/abstract-nouns.json'};
  if(pathname.startsWith('/assets/')&&/^\/assets\/[a-z-]+\.js$/.test(pathname))files[pathname]='src/'+path.basename(pathname);
  if(files[pathname]){let body=fs.readFileSync(path.join(root,files[pathname]),'utf8');const html=pathname==='/battle'||pathname==='/nouns';if(html)body=body.replace('<head>','<head><script src="/assets/connection.js"></script>');return route.fulfill({body,contentType:html?'text/html':pathname.endsWith('.js')?'text/javascript':'application/json'});}
  if(pathname==='/health')return route.fulfill({json:{authentication:false}});
  if(pathname==='/testjeff/resources')return route.fulfill({json:{device:'cpu',memory_bytes:0,cpu_percent:0}});
  return route.fulfill({status:404});
 });
}
async function savedConfig(context,value){await context.addInitScript(value=>{if(!localStorage.getItem('testjeff-connection-v1'))localStorage.setItem('testjeff-connection-v1',JSON.stringify(value));},value);}
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{for(const devices of [['cpu'],['cpu','cuda']]){
 const context=await browser.newContext();await context.addInitScript(()=>{if(!localStorage.getItem('testjeff-connection-v1'))localStorage.setItem('testjeff-connection-v1',JSON.stringify({mode:'local',host:'127.0.0.1',port:8767,device:'auto',local_device:'cpu'}));});
 const page=await context.newPage(),changes=[];let device='cpu';const state=()=>({selected:'qwen-2b',ready:true,device,devices,models:['qwen-0.8b','qwen-2b','gemma-e2b']});
 await mockPage(page);
 await page.route('**/testjeff/status',r=>r.fulfill({json:state()}));
 await page.route('**/testjeff/model',r=>{const body=r.request().postDataJSON();changes.push(body);device=body.device;return r.fulfill({json:state()});});
 await page.goto('http://127.0.0.1:8765/battle');await page.waitForFunction(()=>document.getElementById('connection-status').textContent==='ローカル'&&!document.getElementById('fds-device').disabled);
 assert.deepEqual(await page.locator('#fds-device option').evaluateAll(ns=>ns.map(n=>n.value)),devices);assert(await page.locator('#fds-device').isVisible());
 if(devices.includes('cuda')){await page.locator('#fds-device').selectOption('cuda');await page.waitForFunction(()=>JSON.parse(localStorage.getItem('testjeff-connection-v1')).local_device==='cuda'&&document.getElementById('connection-status').textContent==='ローカル');assert.equal(changes.at(-1).device,'cuda');await page.locator('#fds-device').selectOption('cpu');await page.waitForFunction(()=>JSON.parse(localStorage.getItem('testjeff-connection-v1')).local_device==='cpu'&&document.getElementById('connection-status').textContent==='ローカル');assert.equal(changes.at(-1).device,'cpu');}
 await context.close();
}
// 保存済みCPUと実状態GPUが違う場合、名詞ページがロード途中を読んでも再読込で回復する。
{
 const context=await browser.newContext();await savedConfig(context,{mode:'local',host:'127.0.0.1',port:8767,device:'auto',local_device:'cpu'});
 const page=await context.newPage();await mockPage(page);
 let device='cuda',reloading=false,navigations=0,notReadyReplies=0;const changes=[],predictions=[];
 let modelStarted,unreadyObserved;const start=new Promise(resolve=>{modelStarted=resolve;}),observed=new Promise(resolve=>{unreadyObserved=resolve;});
 const state=()=>({selected:reloading?null:'qwen-2b',ready:!reloading,device,devices:['cpu','cuda'],models:['qwen-0.8b','qwen-2b','gemma-e2b']});
 page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});
 await page.route('**/testjeff/status',async route=>{
  if(device==='cuda'&&route.request().headers()['x-testjeff-local-device'])await start;
  const data=state();await route.fulfill({json:data});if(!data.ready){notReadyReplies++;unreadyObserved();}
 });
 await page.route('**/testjeff/model',async route=>{
  const body=route.request().postDataJSON();changes.push(body);reloading=true;modelStarted();await observed;
  await page.waitForFunction(()=>document.getElementById('evaluate').disabled&&document.getElementById('progress').textContent==='10件');
  device=body.device;reloading=false;await route.fulfill({json:state()});
 });
 await page.route('**/v1/systemone',route=>{predictions.push(route.request().headers());return route.fulfill({json:{model:'jeff-qwen3.5-2b',answers:{判定:{noul:.8}}}});});
 await page.goto('http://127.0.0.1:8765/nouns');
 await page.waitForFunction(()=>document.getElementById('connection-status').textContent==='ローカル'&&!document.getElementById('evaluate').disabled);
 assert(navigations>=2);assert.equal(notReadyReplies,1);assert.deepEqual(changes,[{model:'qwen-2b',device:'cpu'}]);
 await page.locator('#evaluate').click();await page.waitForFunction(()=>document.getElementById('progress').textContent==='10 / 10件完了');
 assert.equal(predictions.length,10);assert(predictions.every(headers=>headers['x-testjeff-local-device']==='cpu'));
 assert.equal(await page.locator('#fds-device').inputValue(),'cpu');await context.close();
}
// FDSのCPU指定とローカルのGPU指定を、処理先の往復後も別々に保持する。
{
 const context=await browser.newContext();await savedConfig(context,{mode:'local',host:'127.0.0.1',port:8767,device:'cpu',local_device:'cuda'});
 const page=await context.newPage();await mockPage(page);const checks=[],changes=[];
 await page.route('**/testjeff/status',route=>route.fulfill({json:{selected:'qwen-2b',ready:true,device:'cuda',devices:['cpu','cuda']}}));
 await page.route('**/testjeff/model',route=>{changes.push(route.request().postDataJSON());return route.fulfill({status:500,json:{detail:'予期しないローカルモデル変更'}});});
 await page.route('**/testjeff/fds-check',route=>{checks.push(route.request().headers());return route.fulfill({json:{selected:'qwen-2b',ready:true,health:{accepting:true},devices:['auto','cpu','cuda'],capabilities:[{local_id:'qwen-2b',name:'Qwen 2B',available:true,devices:['auto','cpu','cuda'],modalities:['text','image']}]}});});
 await page.goto('http://127.0.0.1:8765/battle');await page.waitForFunction(()=>document.getElementById('connection-status').textContent==='ローカル');
 assert.equal(await page.locator('#fds-device').inputValue(),'cuda');
 await page.locator('#backend').selectOption('fds');await page.waitForFunction(()=>window.TestJeffConnection.config.mode==='fds'&&document.getElementById('connection-status').textContent==='接続済み');
 assert.equal(await page.locator('#fds-device').inputValue(),'cpu');assert(checks.length>=2);assert(checks.every(headers=>headers['x-testjeff-device']==='cpu'&&!headers['x-testjeff-local-device']));
 await page.locator('#backend').selectOption('local');await page.waitForFunction(()=>window.TestJeffConnection.config.mode==='local'&&document.getElementById('connection-status').textContent==='ローカル');
 assert.equal(await page.locator('#fds-device').inputValue(),'cuda');const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('testjeff-connection-v1')));
 assert.equal(saved.device,'cpu');assert.equal(saved.local_device,'cuda');assert.equal(changes.length,0);await context.close();
}
console.log('CPU/GPU候補・自動適用・初期切替後の名詞判定復帰・FDSとローカルのデバイス設定保持を確認');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
