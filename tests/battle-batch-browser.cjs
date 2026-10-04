const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
const page=await browser.newPage(),batch=[],single=[];let selected='qwen-2b';const ids={'qwen-2b':'jeff-qwen3.5-2b','qwen-0.8b':'jeff-qwen3.5-0.8b','gemma-e2b':'jeff-gemma-4-e2b-it'};
await page.route('**/*',async route=>{const r=route.request(),url=new URL(r.url()),files={'/battle':'src/battle.html','/assets/battle.js':'src/battle.js','/assets/battle-core.js':'src/battle-core.js','/assets/nouns-core.js':'src/nouns-core.js','/testjeff/nouns':'src/data/nouns.json','/testjeff/abstract-nouns':'src/data/abstract-nouns.json'};
if(files[url.pathname])return route.fulfill({body:fs.readFileSync(path.join(__dirname,'..',files[url.pathname]),'utf8'),contentType:url.pathname.endsWith('.js')?'text/javascript':url.pathname==='/battle'?'text/html':'application/json'});
if(url.pathname==='/health')return route.fulfill({json:{authentication:false}});
if(url.pathname==='/testjeff/status')return route.fulfill({json:{selected,ready:true}});
if(url.pathname==='/testjeff/model'){selected=r.postDataJSON().model;return route.fulfill({json:{selected,ready:true}});}
if(url.pathname==='/testjeff/battle-batch'){const b=r.postDataJSON();batch.push(b);return route.fulfill({json:{results:b.candidates.map(()=>b.model==='gpt-5.6-luna'?{verdict:true}:{probability:.8})}});}
if(url.pathname==='/v1/systemone'){single.push(r.postDataJSON());return route.fulfill({json:{model:ids[selected],answers:{判定:{noul:.8}}}});}
if(url.pathname==='/testjeff/luna')return route.fulfill({json:{model:'gpt-5.6-luna',verdict:true}});
return route.fulfill({status:404});});
await page.goto('http://127.0.0.1:8767/battle');await page.locator('#start:not([disabled])').waitFor();
await page.locator('#batch-mode').check();await page.locator('#start').click();await page.waitForFunction(()=>document.getElementById('progress').textContent==='40 / 40件完了'&&!document.getElementById('start').disabled);
assert.equal(batch.length,4);assert.equal(single.length,3);assert(batch.every(b=>b.candidates.length===10));assert.match(await page.locator('#summary').innerText(),/10件全体/);assert.match(await page.locator('#rows').innerText(),/平均換算/);
await page.locator('#batch-mode').uncheck();assert.match(await page.locator('#cumulative').innerText(),/累積 0回/);
await page.locator('#start').click();await page.waitForFunction(()=>document.getElementById('progress').textContent==='40 / 40件完了'&&!document.getElementById('start').disabled);assert.equal(single.length,36);assert.equal(batch.length,4);
await page.locator('#batch-mode').check();assert.match(await page.locator('#cumulative').innerText(),/累積 1回/);
const selectors=page.locator('.battle-model');assert.equal(await selectors.count(),4);
await selectors.nth(0).selectOption('qwen-2b');assert.equal(await selectors.nth(1).inputValue(),'qwen-0.8b');
for(const i of [1,2,3])await selectors.nth(i).selectOption('');
const before=batch.length;await page.locator('#start').click();await page.waitForFunction(()=>document.getElementById('progress').textContent==='10 / 10件完了');
assert.equal(batch.length,before+1);assert.equal(batch.at(-1).model,'qwen-2b');assert.equal(await page.locator('.result').count(),10);assert.match(await page.locator('#agreement').textContent(),/—/);
await page.reload();await page.locator('#start:not([disabled])').waitFor();assert.deepEqual(await selectors.evaluateAll(ns=>ns.map(n=>n.value)),['qwen-2b','','','']);assert.match(await page.locator('#cumulative').textContent(),/累積 1回/);
await selectors.nth(0).selectOption('');await page.locator('#start').click();assert.equal(batch.length,before+1);assert.match(await page.locator('#error').textContent(),/モデルを選択/);
console.log('一括・単件に加え、列入替・未選択の送信除外・1モデル比較・選択保存・全未選択を確認');

}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
