// 実サーバー・実モデルを使わず、同一入力・合計計測・保存・履歴を確認する。
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),ids={'qwen-0.8b':'jeff-qwen3.5-0.8b','qwen-2b':'jeff-qwen3.5-2b','gemma-e2b':'jeff-gemma-4-e2b-it'},delay=ms=>new Promise(r=>setTimeout(r,ms));
async function download(page){const pending=page.waitForEvent('download');await page.locator('#download').click();return JSON.parse(fs.readFileSync(await(await pending).path(),'utf8'));}
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[],requests=[],saved=[],saveAttempts=[],mutations=[];let selected='qwen-0.8b',inferences=0,runCount=1,methodOrder=['single','batch'],warmDelay=10,loadDelay=5,itemDelay=2,batchDelay=5,failSave=false,failItem=0,holdWarmup=false,held=null,release=null;
 await page.addInitScript(()=>{window.TestJeffConnection={config:{mode:'local',local_device:'cpu'},key:'local:cpu'};localStorage.setItem('testjeff-query-comparison-inputs-v1',JSON.stringify({target:'動物',count:1,candidates:['犬'],slots:['qwen-0.8b','','','']}));});
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url()),files={'/query-comparison':'src/query-comparison.html','/assets/query-comparison.js':'src/query-comparison.js','/assets/query-comparison-core.js':'src/query-comparison-core.js','/assets/noun-combo.js':'src/noun-combo.js','/assets/nouns-core.js':'src/nouns-core.js','/assets/battle-core.js':'src/battle-core.js','/testjeff/nouns':'src/data/nouns.json','/testjeff/abstract-nouns':'src/data/abstract-nouns.json'};
  if(request.method()==='POST')mutations.push(url.pathname);
  if(files[url.pathname])return route.fulfill({body:fs.readFileSync(path.join(root,files[url.pathname]),'utf8'),contentType:url.pathname==='/query-comparison'?'text/html':url.pathname.endsWith('.js')?'text/javascript':'application/json'});
  if(url.pathname==='/health')return route.fulfill({json:{authentication:false}});
  if(url.pathname==='/testjeff/status')return route.fulfill({json:{ready:true,selected}});
  if(url.pathname==='/testjeff/model'){selected=request.postDataJSON().model;inferences=0;await delay(loadDelay);return route.fulfill({json:{ready:true,selected,revision:'固定版',device:'cpu'}});}
  if(url.pathname==='/v1/systemone'){
   const body=request.postDataJSON(),index=inferences++,warm=index===0||(methodOrder[0]==='single'?index===runCount+1:index===1);requests.push({kind:warm?'warmup':'single',body});
   if(holdWarmup&&warm){held();await release.promise;}
   await delay(warm?warmDelay:itemDelay);if(!warm&&failItem&&index===failItem)return route.fulfill({status:503,json:{detail:'試験用の途中失敗'}});
   const execution={backend:'local',model:ids[selected],device:'cpu',revision:'固定版',precision:'float32'};
   return route.fulfill({json:{model:ids[selected],answers:{判定:{noul:.8}},execution,reproduction:{schema_version:1,request:body,execution}}});
  }
  if(url.pathname==='/testjeff/battle-batch'){const body=request.postDataJSON();requests.push({kind:'batch',body});await delay(batchDelay);const execution={backend:'local',model:ids[selected],device:'cpu',revision:'固定版',precision:'float32'};return route.fulfill({json:{results:body.candidates.map(()=>({probability:.7,execution})),reproduction:{schema_version:1,request:body,batches:[{reproduction:{request:body,execution}}]}}});}
  if(url.pathname==='/testjeff/battle-runs'){
   if(request.method()==='POST'){const data=request.postDataJSON();saveAttempts.push(data);if(failSave&&data.run.batch){failSave=false;return route.fulfill({status:503,json:{detail:'試験用の保存失敗'}});}let item=saved.find(x=>x.run_id===data.run.id);if(!item){item={id:saved.length+1,run_id:data.run.id,recorded_at:data.run.at,...data};saved.push(item);}return route.fulfill({json:item});}
   const rows=[...saved].reverse().map(item=>({id:item.id,run_id:item.run_id,recorded_at:item.recorded_at,target:item.run.target,status:item.run.status,selected_models:item.run.selected_models,batch:item.run.batch,connection:item.connection,comparison_id:item.run.parameters.comparison_id,comparison_mode:item.run.parameters.comparison_mode}));return route.fulfill({json:{rows,next_before:null}});
  }
  if(url.pathname.startsWith('/testjeff/battle-runs/'))return route.fulfill({json:saved.find(x=>x.id===Number(url.pathname.split('/').at(-1)))});
  return route.fulfill({status:404});
 });
 await page.goto('http://127.0.0.1:18766/query-comparison');await page.locator('#start:not([disabled])').waitFor();
 assert.equal(await page.locator('#random').textContent(),'ランダムに変更');
 assert.equal(await page.locator('#start').evaluate(n=>getComputedStyle(n).backgroundColor),await page.locator('#random').evaluate(n=>getComputedStyle(n).backgroundColor));
 // 全候補コンボ・件数配置と、1/10/30/100件で両方式が同じA/Bを送ること。
 await page.getByRole('button',{name:'質問する名詞の一覧を開く'}).click();assert(await page.locator('.noun-combo-popup:not([hidden]) [role=option]').count()>10);await page.keyboard.press('Escape');
 for(const count of [1,10,30,100]){
  runCount=count;methodOrder=(saved.length/2)%2?['batch','single']:['single','batch'];await page.locator('#candidate-count').selectOption(String(count));assert.equal(await page.locator('#candidate-editors input').count(),count);const before=requests.length;
  if(count===1){warmDelay=600;loadDelay=250;itemDelay=30;batchDelay=20;failSave=true;}else{warmDelay=5;loadDelay=3;itemDelay=1;batchDelay=3;}
  if(count===1){
   await page.locator('#target').fill('試験専用分類');await page.locator('input[aria-label="候補1"]').fill('試験専用候補');const beforeRandom=mutations.length;
   await page.locator('#random').click();await page.waitForLoadState('networkidle');
   assert.equal(mutations.length,beforeRandom,'ランダム変更だけでは読込・推論・保存を送信しない');assert(!(await page.locator('#comparison-wait').isVisible()));assert(await page.locator('#start').isEnabled());
   assert.notEqual(await page.locator('#target').inputValue(),'試験専用分類');assert.notEqual(await page.locator('input[aria-label="候補1"]').inputValue(),'試験専用候補');
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('testjeff-query-comparison-inputs-v1')).input_method),'random');
  }
  await page.locator('#start').click();assert(await page.locator('#comparison-wait').isVisible());
  if(count===1){await page.waitForFunction(()=>parseInt(document.getElementById('elapsed').textContent)>=1);}
  await page.waitForFunction(()=>document.getElementById('progress').textContent==='両方式の計測終了'&&!document.getElementById('start').disabled);
  if(count===1){assert.match(await page.locator('#save-status').textContent(),/保存失敗/);const attempts=saveAttempts.length;await page.locator('#retry-save').click();await page.waitForFunction(()=>document.getElementById('save-status').textContent==='両方式の結果を保存済み');assert.equal(saveAttempts.length,attempts+1,'失敗した一括レコードだけを再送');}
  const value=await download(page);assert.deepEqual(value.method_order,methodOrder);assert.equal(value.records.single.run.candidates.length,count);assert.deepEqual(value.records.single.run.candidates,value.records.batch.run.candidates);assert.equal(value.records.single.run.parameters.comparison_id,value.comparison_id);assert.equal(value.records.batch.run.parameters.comparison_id,value.comparison_id);assert.equal(value.records.single.run.parameters.input_method,count===1?'random':'manual');assert.equal(value.records.batch.run.parameters.input_method,count===1?'random':'manual');
  const sent=requests.slice(before),single=sent.filter(x=>x.kind==='single'),batch=sent.filter(x=>x.kind==='batch');assert.equal(single.length,count);assert.equal(batch.length,1);assert.equal(sent.filter(x=>x.kind==='warmup').length,2);assert.deepEqual(single.map(x=>x.body.state.対象),batch[0].body.candidates);assert.equal(batch[0].body.target,value.records.single.run.target);
  for(const mode of ['single','batch']){const run=value.records[mode].run,total=run.query_totals['qwen-0.8b'];assert.equal(total.count,count);assert.equal(total.complete,true);assert.equal(run.parameters.candidate_count,count);assert.equal(run.results['qwen-0.8b'].length,count);assert(run.warmup['qwen-0.8b'].reproduction);assert.equal(run.execution['qwen-0.8b'].device,'cpu');assert(total.total_ms+2>=total.response_sum_ms);if(count===1)assert(total.total_ms<200,'ロード・予備判定の待ちを合計から除外');}
  assert(value.records.batch.run.parameters.batch_execution['qwen-0.8b']);assert.equal(value.metrics['qwen-0.8b'].comparable,true);assert(!(await page.locator('#comparison-wait').isVisible()));
  await page.locator('#comparison-results tr').first().getByRole('button',{name:'詳細',exact:true}).click();
  assert.deepEqual(await page.locator('#detail-content thead th').allTextContents(),['候補','個別の判定','個別応答','一括の判定']);
  assert.equal(await page.locator('#detail-content tbody tr').count(),count);
  assert.match(await page.locator('#detail-content tbody tr').first().locator('td').nth(2).textContent(),/ms/);
  assert.doesNotMatch(await page.locator('#detail-content tbody tr').first().locator('td').nth(3).textContent(),/ms|平均/);
  assert.match(await page.locator('#detail-content tbody tr').first().locator('td').nth(3).textContent(),/70.0%/);
  assert(value.records.batch.run.results['qwen-0.8b'][0].ms>=0,'表示を除いても計測JSONは保持');
  await page.locator('#close-detail').click();
 }
 // ランダム変更でも直前の比較結果・未保存情報は上書きしない。
 const priorRandom=await download(page),beforeRandomPosts=mutations.length;await page.locator('#random').click();await page.waitForLoadState('networkidle');assert.equal(mutations.length,beforeRandomPosts);assert.deepEqual(await download(page),priorRandom);
 // 編集中のA/Bを履歴表示で上書きせず、2方式の保存結果を復元する。
 const prior=await download(page);await page.locator('#target').fill('持ち歩く物');await page.locator('input[aria-label="候補1"]').fill('買い物袋');await page.locator('#refresh-history').click();await page.waitForFunction(()=>document.getElementById('history-select').options.length>1);await page.locator('#history-select').selectOption(prior.comparison_id);await page.waitForFunction(()=>document.getElementById('history-status').textContent==='保存結果を表示中');assert.equal(await page.locator('#target').inputValue(),'持ち歩く物');assert.equal(await page.locator('input[aria-label="候補1"]').inputValue(),'買い物袋');const restored=await download(page);assert.deepEqual(restored.records,prior.records);
 // 予備判定の待機中に中止したら本問い合わせを1件も送らない。
 runCount=1;methodOrder=['single','batch'];await page.locator('#candidate-count').selectOption('1');holdWarmup=true;const started=new Promise(resolve=>held=resolve);let unblock;release={promise:new Promise(resolve=>unblock=resolve)};const beforeStop=requests.length;await page.locator('#start').click();await started;await page.locator('#stop').click();holdWarmup=false;unblock();await page.waitForFunction(()=>document.getElementById('progress').textContent==='比較を中止しました'&&!document.getElementById('start').disabled);let stopped=await download(page);assert.equal(requests.length,beforeStop+1);assert.equal(stopped.records.single.run.status,'中止');assert.equal(stopped.metrics['qwen-0.8b'].comparable,false);
 // 本判定の途中失敗を保持し、一括側を継続する。
 runCount=10;methodOrder=['batch','single'];await page.locator('#candidate-count').selectOption('10');failItem=3;await page.locator('#start').click();await page.waitForFunction(()=>document.getElementById('progress').textContent==='両方式の計測終了'&&!document.getElementById('start').disabled);const failed=await download(page);assert(failed.records.single.run.partial_results['qwen-0.8b'].length>0);assert.match(failed.records.single.run.skipped['qwen-0.8b'],/途中失敗/);assert.equal(failed.records.batch.run.query_totals['qwen-0.8b'].complete,true);assert.equal(failed.metrics['qwen-0.8b'].comparable,false);failItem=0;
 // FDSの未導入モデルを除外して、他のモデルは両方式とも計測する。
 await page.evaluate(()=>{window.TestJeffConnection.config={mode:'fds',host:'127.0.0.1',port:8767,device:'cpu'};window.TestJeffConnection.key='fds:127.0.0.1:8767:cpu';window.TestJeffConnection.capabilities={capabilities:[{local_id:'qwen-0.8b',available:false,unavailable_reason:'未導入',devices:[]},{local_id:'qwen-2b',available:true,devices:['cpu']}]};window.dispatchEvent(new Event('fds-capabilities'));});
 await page.locator('.comparison-model').nth(1).selectOption('qwen-2b');await page.locator('#candidate-count').selectOption('1');runCount=1;methodOrder=['single','batch'];const beforeSkip=requests.length;await page.locator('#start').click();await page.waitForFunction(()=>document.getElementById('progress').textContent==='両方式の計測終了'&&!document.getElementById('start').disabled);const skipped=await download(page);assert.equal(skipped.records.single.run.skipped['qwen-0.8b'],'未導入');assert.equal(skipped.records.batch.run.results['qwen-2b'].length,1);assert.equal(requests.length-beforeSkip,4);assert.equal(skipped.metrics['qwen-2b'].comparable,true);assert.match(await page.locator('#comparison-results').textContent(),/計測不能/);
 assert.deepEqual(errors,[]);console.log('問い合わせ比較画面: 1/10/30/100件・同一A/B・交互実行順・合計時間・再保存・履歴・中止・途中失敗・未導入継続を確認');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
