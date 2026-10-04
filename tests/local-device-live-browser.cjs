// 起動中のTestJeffとFDSでデバイス切替・入力保持・推論を確認する。
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base='http://127.0.0.1:8765';
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[],measurements=[];
 page.setDefaultTimeout(120000);page.on('pageerror',e=>errors.push(e.message));
 const original=await (await page.request.get(base+'/testjeff/status')).json();
 assert(original.ready);assert(original.devices.includes('cuda'));
 try{
  await page.addInitScript(()=>{
   if(!localStorage.getItem('testjeff-connection-v1'))localStorage.setItem('testjeff-connection-v1',JSON.stringify({mode:'local',host:'127.0.0.1',port:8767,device:'cpu',local_device:'cuda'}));
   if(!localStorage.getItem('testjeff-battle-slots'))localStorage.setItem('testjeff-battle-slots',JSON.stringify(['qwen-2b','','','']));
  });
  const waitConnection=async mode=>page.waitForFunction(mode=>document.getElementById('connection-status')?.textContent===(mode==='local'?'ローカル':'接続済み')&&!document.getElementById('backend').disabled,mode);
  await page.goto(base+'/battle');await waitConnection('local');await page.locator('#start:not([disabled])').waitFor();
  await page.locator('#target').fill('暮らしで使う道具');
  await page.locator('input[aria-label="候補1"]').fill('雨傘');
  await page.locator('input[aria-label="候補2"]').fill('料理用の鍋');
  const inputs=async()=>({target:await page.locator('#target').inputValue(),candidates:await page.locator('#rows input').evaluateAll(ns=>ns.map(n=>n.value))});
  const expected=await inputs();
  const preserved=async()=>{await page.locator('#start:not([disabled])').waitFor();assert.deepEqual(await inputs(),expected);};
  for(const device of ['cpu','cuda']){
   await page.locator('#fds-device').selectOption(device);
   await page.waitForFunction(device=>JSON.parse(localStorage.getItem('testjeff-connection-v1')).local_device===device,device);
   await waitConnection('local');await preserved();
   const state=await (await page.request.get(base+'/testjeff/status')).json();assert.equal(state.device,device);assert(state.ready);
   const result=await page.evaluate(async()=>{
    const started=performance.now(),response=await fetch('/v1/systemone',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'jeff-qwen3.5-2b',state:{対象:'猫'},questions:{判定:{type:'noul',instructions:'これは動物ですか？',criteria:{true:'動物です',false:'動物ではありません'}}}})});
    return {status:response.status,data:await response.json(),ms:performance.now()-started};
   });
   assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(typeof result.data.answers.判定.noul,'number');measurements.push({device,...result});
  }
  for(const [device,status] of [['cpu',409],['auto',422]]){
   const response=await page.request.post(base+'/v1/systemone',{headers:{'X-TestJeff-Local-Device':device},data:{}});assert.equal(response.status(),status);
  }
  await page.locator('#backend').selectOption('fds');await waitConnection('fds');await preserved();
  assert.equal(await page.locator('#fds-device').inputValue(),'cpu');
  await page.locator('#backend').selectOption('local');await waitConnection('local');await preserved();
  assert.equal(await page.locator('#fds-device').inputValue(),'cuda');
  await page.locator('.battle-model').nth(0).selectOption('');await preserved();
  await page.locator('.battle-model').nth(0).selectOption('qwen-2b');await preserved();
  await page.locator('#batch-mode').click();await preserved();
  await page.locator('#start').click();await page.locator('#battle-wait:not(.hidden)').waitFor();
  await page.locator('#start:not([disabled])').waitFor();
  assert.equal(await page.locator('#error').textContent(),'');assert.equal(await page.locator('.result').count(),10);
  assert(await page.locator('#battle-wait').evaluate(n=>n.classList.contains('hidden')));
  const download=page.waitForEvent('download');await page.locator('#export').click();
  const record=JSON.parse(fs.readFileSync(await (await download).path(),'utf8'));assert.equal(record.run.status,'完了');assert.equal(record.run.batch,true);
  await page.screenshot({path:'dev/testing/output/v0160-battle-live.png',fullPage:true});
  for(const route of ['/samples','/nouns','/photos','/classification']){
   await page.goto(base+route);await waitConnection('local');
   assert.deepEqual(await page.locator('#fds-device option').evaluateAll(ns=>ns.map(n=>n.value)),['cpu','cuda']);
   if(route==='/nouns')await page.locator('#random:not([disabled])').waitFor();
  }
  assert.deepEqual(errors,[]);
  fs.writeFileSync('dev/testing/output/v0160-local-device-live.json',JSON.stringify({measurements,record,errors},null,2));
  console.log('実機CPU/GPU推論、全5ページの候補、FDS往復とモデル変更時のA/B保持、一括対戦10件を確認');
 }finally{
  const restored=await page.request.post(base+'/testjeff/model',{data:{model:original.selected,device:original.device},timeout:120000});
  if(!restored.ok())console.error('開始時モデルの復元失敗',await restored.text());
  await browser.close();
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
