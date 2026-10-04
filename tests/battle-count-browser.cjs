const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),core=require('../src/battle-core.js'),base='http://127.0.0.1:8767';
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[],saved=[],reviews=[],calls=[];let selected='qwen-2b',slowWarmup=false;
 const legacy={runs:1,comparisons:1,agreement:9,models:Object.fromEntries(core.models.map(m=>[m.id,{count:10,totalMs:100,yes:9,probabilitySum:8,wins:2}]))};
 await page.addInitScript(({legacy})=>{
  if(!localStorage.getItem('testjeff-battle-v2'))localStorage.setItem('testjeff-battle-v2',JSON.stringify(legacy));
  if(!localStorage.getItem('testjeff-battle-inputs-v1'))localStorage.setItem('testjeff-battle-inputs-v1',JSON.stringify({target:'日用品',candidates:['買い物袋','猫','馬','象','イルカ','りんご','椅子','自転車','鉛筆','雨']}));
  window.requestTrace=[];const original=window.fetch.bind(window);window.fetch=async(input,options={})=>{const entry={path:new URL(input,location.href).pathname,body:options.body?JSON.parse(options.body):null,start:performance.now()};window.requestTrace.push(entry);const response=await original(input,options);entry.end=performance.now();return response;};
 },{legacy});
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),files={'/battle':'src/battle.html','/assets/battle.js':'src/battle.js','/assets/battle-core.js':'src/battle-core.js','/assets/nouns-core.js':'src/nouns-core.js','/assets/noun-combo.js':'src/noun-combo.js','/testjeff/nouns':'src/data/nouns.json','/testjeff/abstract-nouns':'src/data/abstract-nouns.json'};
  if(files[url.pathname])return route.fulfill({body:fs.readFileSync(path.join(root,files[url.pathname]),'utf8'),contentType:url.pathname.endsWith('.js')?'text/javascript':url.pathname==='/battle'?'text/html':'application/json'});
  if(url.pathname==='/health')return route.fulfill({json:{authentication:false}});
  if(url.pathname==='/testjeff/status')return route.fulfill({json:{selected,ready:true,device:'cpu',revision:'試験'}});
  if(url.pathname==='/testjeff/model'){selected=request.postDataJSON().model;await new Promise(resolve=>setTimeout(resolve,20));return route.fulfill({json:{selected,ready:true,device:'cpu',revision:'試験'}});}
  if(url.pathname==='/v1/systemone'||url.pathname==='/testjeff/luna'){
   const body=request.postDataJSON();calls.push({path:url.pathname,body});if(slowWarmup)await new Promise(resolve=>setTimeout(resolve,180));
   const isLuna=url.pathname==='/testjeff/luna';return route.fulfill({json:isLuna?{model:'gpt-5.6-luna',verdict:true,source:'Codex CLI',reasoning:'low'}:{model:body.model,answers:{判定:{noul:.8}},execution:{backend:'local',device:'cpu'}}});
  }
  if(url.pathname==='/testjeff/battle-batch'){const body=request.postDataJSON();calls.push({path:url.pathname,body});await new Promise(resolve=>setTimeout(resolve,20));return route.fulfill({json:{results:body.candidates.map(()=>body.model==='gpt-5.6-luna'?{verdict:true}:{probability:.8}),reproduction:{count:body.candidates.length}}});}
  if(url.pathname==='/testjeff/battle-runs'){const record=request.postDataJSON();saved.push(record);return route.fulfill({json:{id:saved.length,run_id:record.run.id,...record}});}
  if(url.pathname==='/testjeff/knowledge'){const review=request.postDataJSON();reviews.push(review);return route.fulfill({json:review});}
  return route.fulfill({status:404});
 });
 const ready=()=>page.waitForFunction(()=>!document.getElementById('start').disabled);
 const done=()=>page.waitForFunction(()=>document.getElementById('run-save-status').textContent==='結果を保存済み'&&!document.getElementById('start').disabled);
 const inputs=()=>page.locator('#rows input').evaluateAll(nodes=>nodes.map(node=>node.value));
 await page.goto(base+'/battle');await ready();assert.equal(await page.locator('#candidate-count').inputValue(),'10');assert.match(await page.locator('#cumulative').textContent(),/累積 1回・一致 9 \/ 10件/);assert.equal(await page.locator('#target').inputValue(),'日用品');
 const selectors=page.locator('.battle-model');await selectors.nth(0).selectOption('qwen-2b');await selectors.nth(1).selectOption('');await selectors.nth(2).selectOption('');
 let prefix=await inputs();const singleKeys=[],batchKeys=[];
 for(const count of [1,30,100]){
  await page.locator('#candidate-count').selectOption(String(count));const current=await inputs();assert.equal(current.length,count);assert.deepEqual(current.slice(0,Math.min(prefix.length,count)),prefix.slice(0,count));assert.equal(new Set(current).size,count);assert.equal(await page.locator('#target').inputValue(),'日用品');prefix=current;
  assert.match(await page.locator('#cumulative').textContent(),/累積 0回/);assert.equal(await page.locator('.review').count(),count);
  await page.evaluate(()=>{window.requestTrace=[];});let offset=calls.length;await page.locator('#start').click();await done();
  let record=saved.at(-1),run=record.run;singleKeys.push(run.parameters.statistics_key);assert.equal(run.candidates.length,count);assert.equal(run.parameters.candidate_count,count);assert.equal(run.results['qwen-2b'].length,count);assert.equal(run.results['gpt-5.6-luna'].length,count);assert.equal(calls.length-offset,2*(count+1));assert.equal(record.statistics.comparison_items,count);assert.equal(record.statistics.models['qwen-2b'].count,count);assert.match(await page.locator('#agreement').textContent(),new RegExp(`${count} / ${count}件`));
  const trace=await page.evaluate(()=>window.requestTrace);
  for(const id of run.selected_models){const total=run.query_totals[id],model=core.models.find(model=>model.id===id),requests=trace.filter(entry=>entry.path===(model.cloud?'/testjeff/luna':'/v1/systemone'));
   assert.equal(total.count,count);assert.equal(total.complete,true);assert.equal(total.total_ms,total.end_ms-total.start_ms);assert(total.start_ms>=requests[0].end);assert(total.start_ms<=requests[1].start);assert(total.end_ms>=requests.at(-1).end);
   assert(Math.abs(total.response_sum_ms-run.results[id].reduce((sum,item)=>sum+item.ms,0))<1e-6);assert(total.total_ms>=total.response_sum_ms);
   assert.equal(await page.locator(`[data-model-id="${id}"] [data-metric="total_ms"] strong`).textContent(),`${total.total_ms.toFixed(1)} ms`);assert.match(await page.locator(`[data-model-id="${id}"] [data-metric="total_ms"]`).getAttribute('title'),/API時間合計/);
  }
  await page.locator(`[aria-label="ユーザー判定${count}"]`).selectOption('です');await page.locator('#save-knowledge').click();await page.waitForFunction(()=>document.getElementById('knowledge-status').textContent==='保存済み');assert.equal(reviews.at(-1).annotations.length,count);assert.deepEqual(reviews.at(-1).run.query_totals,run.query_totals);
  const download=page.waitForEvent('download');await page.locator('#export').click();assert.deepEqual(JSON.parse(fs.readFileSync(await (await download).path(),'utf8')).run.query_totals,run.query_totals);
  await page.locator('#batch-mode').click();assert.deepEqual(await inputs(),current);assert.match(await page.locator('#cumulative').textContent(),/累積 0回/);offset=calls.length;await page.locator('#start').click();await done();record=saved.at(-1);run=record.run;batchKeys.push(run.parameters.statistics_key);
  assert.equal(calls.length-offset,4);assert.equal(calls.slice(offset).filter(call=>call.path==='/testjeff/battle-batch').length,2);assert(calls.slice(offset).filter(call=>call.path==='/testjeff/battle-batch').every(call=>call.body.candidates.length===count));assert.equal(record.statistics.comparison_items,count);
  for(const id of run.selected_models){const total=run.query_totals[id];assert.equal(total.count,count);assert.equal(total.complete,true);assert.equal(total.total_ms,total.end_ms-total.start_ms);assert(run.results[id].every(item=>item.ms===total.total_ms/count));assert.equal(run.parameters.model_requests[id].client_timeout_ms,id==='gpt-5.6-luna'?135000:15000+Math.ceil(count/8)*120000);assert.equal(await page.locator(`[data-model-id="${id}"] [data-metric="total_ms"] strong`).textContent(),`${total.total_ms.toFixed(1)} ms`);}
  await page.locator('#single-mode').click();assert.deepEqual(await inputs(),current);assert.match(await page.locator('#cumulative').textContent(),/累積 1回/);
 }
 assert.equal(new Set([...singleKeys,...batchKeys]).size,6);assert(singleKeys.every(key=>/:count:(1|30|100)$/.test(key)));
 await page.reload();await ready();assert.equal(await page.locator('#candidate-count').inputValue(),'100');assert.deepEqual(await inputs(),prefix);assert.match(await page.locator('#cumulative').textContent(),/累積 1回・一致 100 \/ 100件/);
 // 予備判定中に止めた場合、長い一括問い合わせへ進まず終了する。
 await page.locator('#batch-mode').click();slowWarmup=true;const before=calls.length;await page.locator('#start').click();await page.waitForFunction(()=>document.getElementById('progress').textContent.includes('予備判定'));assert(await page.locator('#candidate-count').isDisabled());await page.locator('#stop').click();await done();assert.equal(saved.at(-1).run.status,'中止');assert.deepEqual(saved.at(-1).run.query_totals,{});assert.equal(calls.slice(before).filter(call=>call.path==='/testjeff/battle-batch').length,0);
 await page.locator('#candidate-count').selectOption('10');await page.locator('#single-mode').click();await selectors.nth(0).selectOption('qwen-0.8b');await selectors.nth(1).selectOption('qwen-2b');await selectors.nth(2).selectOption('gemma-e2b');assert.match(await page.locator('#cumulative').textContent(),/累積 1回・一致 9 \/ 10件/);assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('testjeff-battle-v2'))),legacy);
 assert.deepEqual(errors,[]);console.log('1/30/100件の個別・一括・評価保存・入力保持・件数別累積・合計時間/応答時間の分離・10件互換・予備判定中止を確認');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
