const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const core=require('../src/battle-core.js');
const root=path.join(__dirname,'..'),live=process.env.LIVE_URL,base=live||process.env.KNOWLEDGE_URL||'http://127.0.0.1:8767';
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
  const page=await browser.newPage({viewport:{width:1250,height:1000}}),errors=[],calls=[],lunaCalls=[],switches=[];
  let selected='qwen-2b',mode='normal';const knowledge=[],records=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().endsWith('/v1/systemone'))calls.push(r.postDataJSON());if(r.url().endsWith('/testjeff/luna'))lunaCalls.push(r.postDataJSON());if(r.url().endsWith('/testjeff/model'))switches.push(r.postDataJSON().model);});
  if(!live)await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    const files={'/battle':'src/battle.html','/assets/battle.js':'src/battle.js','/assets/noun-combo.js':'src/noun-combo.js','/assets/battle-core.js':'src/battle-core.js','/assets/nouns-core.js':'src/nouns-core.js','/testjeff/nouns':'src/data/nouns.json','/testjeff/abstract-nouns':'src/data/abstract-nouns.json'};
    if(files[url.pathname])return route.fulfill({body:fs.readFileSync(path.join(root,files[url.pathname]),'utf8'),contentType:url.pathname.endsWith('.js')?'text/javascript':url.pathname==='/battle'?'text/html':'application/json'});
    if(url.pathname==='/testjeff/knowledge'){if(process.env.KNOWLEDGE_URL)return route.continue();if(req.method()==='GET')return route.fulfill({json:{latest:knowledge.slice(-1),history:knowledge}});const value=req.postDataJSON();knowledge.push(value);return route.fulfill({json:value});}
    if(url.pathname==='/health')return route.fulfill({json:{authentication:false}});
    if(url.pathname==='/testjeff/battle-runs'){const record=req.postDataJSON();records.push(record);return route.fulfill({json:{id:records.length,run_id:record.run.id}});}
    if(url.pathname==='/testjeff/status')return route.fulfill({json:{selected,ready:true,reserved_gib:2}});
    if(url.pathname==='/testjeff/model'){selected=req.postDataJSON().model;return route.fulfill({json:{selected,ready:true,revision:'試験'}});}
    if(url.pathname==='/testjeff/luna'&&mode==='luna-error')return route.fulfill({status:503,json:{detail:'Luna試験エラー'}});
    if(url.pathname==='/testjeff/luna')return route.fulfill({json:{model:'gpt-5.6-luna',verdict:true,source:'Codex CLI',duration_ms:10,reasoning:'low'}});
    if(url.pathname==='/v1/systemone'){
      await new Promise(r=>setTimeout(r,mode==='slow'?250:10));
      if(mode==='error')return route.fulfill({status:503,json:{}});
      const model=core.models.find(m=>m.id===selected);
      return route.fulfill({json:{model:model.api,answers:{判定:{noul:selected==='gemma-e2b'?.2:selected==='qwen-2b'?.5:.8}}}});
    }
    return route.fulfill({status:404});
  });
  await page.goto(base+'/battle');await page.locator('#start:not([disabled])').waitFor();
  assert.equal(await page.locator('.toolbar').count(),1);
  assert.equal(await page.locator('input[list]').count(),0);
  const targetCount=JSON.parse(fs.readFileSync(path.join(root,'src/data/abstract-nouns.json'),'utf8')).length;
  await page.getByRole('button',{name:'質問する名詞の一覧を開く',exact:true}).click();assert.equal(await page.locator('#target-listbox [role="option"]').count(),targetCount);
  await page.locator('#target-listbox').getByRole('option',{name:'道具',exact:true}).click();assert.equal(await page.locator('#target').inputValue(),'道具');
  await page.getByRole('button',{name:'候補1の一覧を開く',exact:true}).click();assert.equal(await page.getByRole('listbox',{name:'候補1の候補一覧'}).getByRole('option').count(),1000);
  await page.getByRole('listbox',{name:'候補1の候補一覧'}).getByRole('option',{name:'猫',exact:true}).click();assert.equal(await page.locator('input[aria-label="候補1"]').inputValue(),'猫');
  await page.locator('input[aria-label="候補1"]').fill('犬');
  const original=live?(await (await page.request.get(base+'/testjeff/status')).json()).selected:selected;
  await page.locator('#target').fill('持ち運べる物');
  assert.equal(await page.locator('#target-listbox [role="option"]').count(),targetCount);
  assert.equal(await page.locator('[aria-label="候補1の候補一覧"] [role="option"]').count(),1000);
  const candidates=await page.locator('#rows input').evaluateAll(ns=>ns.map(n=>n.value));
  await page.locator('#start').click();
  await page.waitForFunction(()=>document.getElementById('progress').textContent==='40 / 40件完了',null,{timeout:240000});
  assert.equal(calls.length,33);assert.equal(switches.at(-1),original);
  for(const m of core.models.filter(m=>!m.cloud)){const batch=calls.filter(c=>c.model===m.api);assert.equal(batch.length,11);assert.deepEqual(batch.slice(1).map(c=>c.state.対象),candidates);assert(batch.every(c=>c.questions.判定.instructions.startsWith('これは持ち運べる物ですか？')));}
  assert.equal(lunaCalls.length,11);assert.deepEqual(lunaCalls.slice(1).map(x=>x.candidate),candidates);assert(lunaCalls.every(x=>x.target==='持ち運べる物'));
  assert.equal(await page.locator('.result').count(),40);
  const stats=await page.evaluate(()=>JSON.parse(localStorage.getItem('testjeff-battle-v2')));
  assert.equal(stats.runs,1);assert(core.models.every(m=>stats.models[m.id].count===10));
  const downloaded=page.waitForEvent('download');await page.locator('#export').click();
  const record=JSON.parse(fs.readFileSync(await (await downloaded).path(),'utf8'));
  assert.equal(record.run.status,'完了');assert(core.complete(record.run));
  assert.equal(await page.locator('thead th').count(),6);
  assert.equal(await page.locator('.probability-track').count(),30);
  const displayed=await page.locator('#rows tr').evaluateAll(nodes=>nodes.map(tr=>[...tr.querySelectorAll('.answer-box')].map(box=>({fast:box.classList.contains('fastest'),width:box.querySelector('.probability-fill')?.style.width,green:box.querySelector('.probability')?.classList.contains('yes')}))));
  displayed.forEach((row,i)=>{const times=core.models.map(m=>record.run.results[m.id][i].ms);row.forEach((box,j)=>{const item=record.run.results[core.models[j].id][i];assert.equal(box.fast,item.ms===Math.min(...times));if(j<3){assert(Math.abs(parseFloat(box.width)-item.probability*100)<.001);assert.equal(box.green,item.probability>=.5);}else assert.equal(box.width,undefined);});});
  if(!live){
    await page.locator('#sort').selectOption('name');
    const reviewed=page.locator('#rows tr').filter({has:page.locator('input[aria-label="候補1"]')});
    await reviewed.locator('.review select').selectOption('です');await reviewed.locator('textarea').fill('日常の使い方で判断しました。');
    const selectBox=await reviewed.locator('.review select').boundingBox(),commentBox=await reviewed.locator('textarea').boundingBox();
    assert(Math.abs(selectBox.y-commentBox.y)<2);assert(selectBox.x+selectBox.width<=commentBox.x);
    assert.equal(await reviewed.locator('.review').evaluate(node=>getComputedStyle(node).display),'table-cell');
    await page.locator('#save-knowledge').click();await page.getByText('保存済み',{exact:true}).waitFor();
    assert(await page.locator('#save-knowledge').isDisabled());
    await reviewed.locator('.review select').selectOption('ではありません');
    await page.locator('#save-knowledge').click();await page.getByText('保存済み',{exact:true}).waitFor();
    const download=page.waitForEvent('download');await page.locator('#download-knowledge').click();
    const saved=JSON.parse(fs.readFileSync(await (await download).path(),'utf8'));
    assert.equal(saved.latest.at(-1).annotations[0].expected,'ではありません');
    assert.equal(saved.latest.at(-1).run.candidates[0],candidates[0]);
    assert.equal(saved.latest.at(-1).annotations[0].comment,'日常の使い方で判断しました。');
    fs.writeFileSync(path.join(root,'dev/testing/output/knowledge-browser.json'),JSON.stringify(saved,null,2));
  }
  await page.screenshot({path:path.join(root,`dev/testing/output/battle-${live?'live':'mock'}.png`),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(root,`dev/testing/output/battle-${live?'live':'mock'}-mobile.png`),fullPage:true});
  await page.reload();await page.locator('#start:not([disabled])').waitFor();assert((await page.locator('#cumulative').textContent()).includes('累積 1回'));
  assert.equal(await page.locator('#target').inputValue(),'持ち運べる物');assert.deepEqual(await page.locator('#rows input').evaluateAll(ns=>ns.map(n=>n.value)),candidates);
  const toolbar=await page.locator('.toolbar').evaluate(node=>({wrap:getComputedStyle(node).flexWrap,overflow:getComputedStyle(node).overflowX,children:[...node.children].map(n=>n.getBoundingClientRect().top+n.getBoundingClientRect().height/2)}));
  assert.equal(toolbar.wrap,'nowrap');assert.equal(toolbar.overflow,'auto');assert(Math.max(...toolbar.children)-Math.min(...toolbar.children)<2);
  if(!live){
    const before=calls.length;await page.locator('#target').fill(' ');await page.locator('#start').click();assert.equal(calls.length,before);
    await page.locator('#target').fill('道具');mode='slow';await page.locator('#start').click();await page.locator('#stop').click();await page.locator('#start:not([disabled])').waitFor();assert((await page.locator('#progress').textContent()).includes('中止'));assert((await page.locator('#cumulative').textContent()).includes('累積 1回'));
    mode='error';await page.locator('#start').click();await page.locator('#start:not([disabled])').waitFor();assert((await page.locator('#progress').textContent()).includes('3モデル計測不能'));assert((await page.locator('#cumulative').textContent()).includes('累積 2回'));
    mode='luna-error';await page.locator('#start').click();await page.locator('#start:not([disabled])').waitFor();assert((await page.locator('#progress').textContent()).includes('1モデル計測不能'));assert.equal(await page.locator('.result').count(),30);assert((await page.locator('#cumulative').textContent()).includes('累積 3回'));
    mode='normal';await page.locator('[aria-label="ユーザー判定1"]').selectOption('です');await page.locator('[aria-label="評価コメント1"]').fill('変更前の評価');
    const beforeRandom={calls:calls.length,luna:lunaCalls.length,switches:switches.length,records:records.length,knowledge:knowledge.length};
    const oldInputs=await page.locator('#rows input').evaluateAll(ns=>ns.map(n=>n.value));
    await page.evaluate(()=>{globalThis.originalRandom=Math.random;Math.random=()=>0;});
    await page.locator('#random').click();await page.evaluate(()=>{Math.random=globalThis.originalRandom;delete globalThis.originalRandom;});
    assert.deepEqual({calls:calls.length,luna:lunaCalls.length,switches:switches.length,records:records.length,knowledge:knowledge.length},beforeRandom);
    assert.equal(await page.locator('#target').inputValue(),JSON.parse(fs.readFileSync(path.join(root,'src/data/abstract-nouns.json'),'utf8'))[0]);
    const randomInputs=await page.locator('#rows input').evaluateAll(ns=>ns.map(n=>n.value));assert.notDeepEqual(randomInputs,oldInputs);assert.equal(new Set(randomInputs).size,10);
    assert.equal(await page.locator('.result,.quality-score,.rank-medal,.battle-model.batch-fastest').count(),0);assert(await page.locator('#battle-wait').evaluate(node=>node.classList.contains('hidden')));
    assert.deepEqual(await page.locator('#rows .review select').evaluateAll(ns=>ns.map(n=>n.value)),Array(10).fill('未評価'));assert((await page.locator('#rows textarea').evaluateAll(ns=>ns.map(n=>n.value))).every(value=>value===''));
    assert(await page.locator('#export').isDisabled());assert(await page.locator('#save-run').isDisabled());assert(await page.locator('#save-knowledge').isDisabled());assert.equal(await page.locator('#progress').textContent(),'同じ10件で対戦');assert((await page.locator('#cumulative').textContent()).includes('累積 3回'));
    const prepared=await page.evaluate(()=>JSON.parse(localStorage.getItem('testjeff-battle-inputs-v1')));assert.equal(prepared.input_method,'random');assert.deepEqual(prepared.candidates,randomInputs);
    await page.reload();await page.locator('#start:not([disabled])').waitFor();assert.deepEqual(await page.locator('#rows input').evaluateAll(ns=>ns.map(n=>n.value)),randomInputs);
    assert.deepEqual({calls:calls.length,luna:lunaCalls.length,switches:switches.length,records:records.length,knowledge:knowledge.length},beforeRandom);
    await page.locator('#start').click();await page.waitForFunction(()=>document.getElementById('progress').textContent==='40 / 40件完了'&&!document.getElementById('start').disabled);
    assert.equal(switches[beforeRandom.switches],'qwen-0.8b');assert((await page.locator('#cumulative').textContent()).includes('累積 4回'));assert.equal(records.length,beforeRandom.records+1);assert.equal(records.at(-1).run.parameters.input_method,'random');assert.deepEqual(records.at(-1).run.candidates,randomInputs);
    await page.locator('#target').fill('手入力の名詞');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('testjeff-battle-inputs-v1')).input_method),'manual');
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(root,`dev/testing/output/battle-${live?'live':'mock'}.json`),JSON.stringify({record,errors},null,2));
  console.log('4モデル同一入力・44送信・予備判定除外・集計保存・復元・JSON出力・ランダム候補変更だけでは送信せず開始操作で判定することを確認しました。');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
