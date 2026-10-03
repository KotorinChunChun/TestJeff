const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const core=require('../src/battle-core.js');
const root=path.join(__dirname,'..'),live=process.env.LIVE_URL,base=live||'http://127.0.0.1:8767';
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
  const page=await browser.newPage({viewport:{width:1250,height:1000}}),errors=[],calls=[],switches=[];
  let selected='qwen-2b',mode='normal';
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().endsWith('/v1/systemone'))calls.push(r.postDataJSON());if(r.url().endsWith('/testjeff/model'))switches.push(r.postDataJSON().model);});
  if(!live)await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    const files={'/battle':'src/battle.html','/assets/battle.js':'src/battle.js','/assets/battle-core.js':'src/battle-core.js','/assets/nouns-core.js':'src/nouns-core.js','/testjeff/nouns':'src/data/nouns.json','/testjeff/abstract-nouns':'src/data/abstract-nouns.json'};
    if(files[url.pathname])return route.fulfill({body:fs.readFileSync(path.join(root,files[url.pathname]),'utf8'),contentType:url.pathname.endsWith('.js')?'text/javascript':url.pathname==='/battle'?'text/html':'application/json'});
    if(url.pathname==='/health')return route.fulfill({json:{authentication:false}});
    if(url.pathname==='/testjeff/status')return route.fulfill({json:{selected,ready:true,reserved_gib:2}});
    if(url.pathname==='/testjeff/model'){selected=req.postDataJSON().model;return route.fulfill({json:{selected,ready:true,revision:'試験'}});}
    if(url.pathname==='/v1/systemone'){
      await new Promise(r=>setTimeout(r,mode==='slow'?250:10));
      if(mode==='error')return route.fulfill({status:503,json:{}});
      const model=core.models.find(m=>m.id===selected);
      return route.fulfill({json:{model:model.api,answers:{判定:{noul:selected==='gemma-e2b'?.2:.8}}}});
    }
    return route.fulfill({status:404});
  });
  await page.goto(base+'/battle');await page.locator('#start:not([disabled])').waitFor();
  const original=live?(await (await page.request.get(base+'/testjeff/status')).json()).selected:selected;
  await page.locator('#target').fill('持ち運べる物');
  const candidates=await page.locator('#rows input').evaluateAll(ns=>ns.map(n=>n.value));
  await page.locator('#start').click();
  await page.waitForFunction(()=>document.getElementById('progress').textContent==='30 / 30件完了',null,{timeout:240000});
  assert.equal(calls.length,33);assert.equal(switches.at(-1),original);
  for(const m of core.models){const batch=calls.filter(c=>c.model===m.api);assert.equal(batch.length,11);assert.deepEqual(batch.slice(1).map(c=>c.state.対象),candidates);assert(batch.every(c=>c.questions.判定.instructions.startsWith('これは持ち運べる物ですか？')));}
  assert.equal(await page.locator('.result').count(),30);
  const stats=await page.evaluate(()=>JSON.parse(localStorage.getItem('testjeff-battle-v1')));
  assert.equal(stats.runs,1);assert(core.models.every(m=>stats.models[m.id].count===10));
  const downloaded=page.waitForEvent('download');await page.locator('#export').click();
  const record=JSON.parse(fs.readFileSync(await (await downloaded).path(),'utf8'));
  assert.equal(record.run.status,'完了');assert(core.complete(record.run));
  await page.screenshot({path:path.join(root,`dev/testing/output/battle-${live?'live':'mock'}.png`),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(root,`dev/testing/output/battle-${live?'live':'mock'}-mobile.png`),fullPage:true});
  await page.reload();await page.locator('#start:not([disabled])').waitFor();assert((await page.locator('#cumulative').textContent()).includes('累積 1回'));
  if(!live){
    const before=calls.length;await page.locator('#target').fill(' ');await page.locator('#start').click();assert.equal(calls.length,before);
    await page.locator('#target').fill('道具');mode='slow';await page.locator('#start').click();await page.locator('#stop').click();await page.locator('#start:not([disabled])').waitFor();assert((await page.locator('#progress').textContent()).includes('中止'));assert((await page.locator('#cumulative').textContent()).includes('累積 1回'));
    mode='error';await page.locator('#start').click();await page.locator('#start:not([disabled])').waitFor();assert((await page.locator('#progress').textContent()).includes('失敗'));assert((await page.locator('#cumulative').textContent()).includes('累積 1回'));
    mode='normal';const offset=switches.length;await page.locator('#random').click();await page.waitForFunction(()=>document.getElementById('progress').textContent==='30 / 30件完了');assert.equal(switches[offset],'qwen-2b');assert((await page.locator('#cumulative').textContent()).includes('累積 2回'));
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(root,`dev/testing/output/battle-${live?'live':'mock'}.json`),JSON.stringify({record,errors},null,2));
  console.log('3モデル同一入力・33送信・予備判定除外・集計保存・復元・JSON出力を確認しました。');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
