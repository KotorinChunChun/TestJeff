const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const context=await browser.newContext();await context.addInitScript(()=>localStorage.setItem('testjeff-connection-v1',JSON.stringify({mode:'fds',host:'127.0.0.1',port:8767,device:'auto'})));
 const page=await context.newPage();const records=[];
 // CLI部分だけを模擬し、3モデルのFDS振り分けを実測する。
 await page.route('**/testjeff/luna',route=>route.fulfill({json:{model:'gpt-5.6-luna',verdict:true,source:'test-fixture',reasoning:'low',duration_ms:1}}));
 page.on('response',async r=>{if(r.url().endsWith('/v1/systemone')&&r.ok())records.push(await r.json());});
 await page.goto('http://127.0.0.1:8765/battle');await page.locator('#start').click();
 await page.waitForFunction(()=>!document.getElementById('start').disabled,null,{timeout:180000});
 const error=await page.locator('#error').textContent(),status=await page.locator('#progress').textContent();
 console.log(JSON.stringify({status,error,models:[...new Set(records.map(r=>r.execution?.model))]},null,2));
 fs.writeFileSync('dev/testing/output/fds-battle.json',JSON.stringify({status,error,records},null,2));
 assert.equal(error,'');assert.equal(status,'2モデル計測完了・2モデル計測不能');assert.equal(records.length,11);assert(records.every(r=>r.execution.model==='jeff-qwen-2b'));
 await page.goto('http://127.0.0.1:8765/nouns');await page.waitForFunction(()=>document.querySelector('#model-select option')?.textContent.includes('2B'));assert.deepEqual(await page.locator('#model-select option').evaluateAll(ns=>ns.map(n=>n.value)),['qwen-2b']);
 await page.route('**/testjeff/fds-check',async route=>{const response=await route.fetch(),data=await response.json();data.devices=['auto','cpu'];data.capabilities.forEach(m=>m.devices=m.devices.filter(d=>d!=='cuda'));await route.fulfill({json:data});});
 await page.locator('#fds-check').click();await page.waitForFunction(()=>document.querySelectorAll('#fds-device option').length===2);
 assert.deepEqual(await page.locator('#fds-device option').evaluateAll(ns=>ns.map(n=>n.value)),['auto','cpu']);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
