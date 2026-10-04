const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),base='http://127.0.0.1:8767',targetWords=JSON.parse(fs.readFileSync(path.join(root,'src/data/abstract-nouns.json'),'utf8'));
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1250,height:950}}),errors=[],posts=[],records=[];let mode='normal',failSave=true,holdList=false,listGate=null,releaseList=null,singleCount=0;
 await page.addInitScript(()=>{
  window.TestJeffConnection={config:{mode:'fds',host:'127.0.0.2',port:8767,device:'cpu',local_device:'cuda',api_key:'保存禁止の秘密値'},key:'fds:127.0.0.2:8767:cpu'};
  if(!localStorage.getItem('testjeff-battle-slots'))localStorage.setItem('testjeff-battle-slots',JSON.stringify(['qwen-2b','','','']));
 });
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),files={'/battle':'src/battle.html','/assets/battle.js':'src/battle.js','/assets/battle-core.js':'src/battle-core.js','/assets/nouns-core.js':'src/nouns-core.js','/assets/noun-combo.js':'src/noun-combo.js','/testjeff/nouns':'src/data/nouns.json','/testjeff/abstract-nouns':'src/data/abstract-nouns.json'};
  if(files[url.pathname])return route.fulfill({body:fs.readFileSync(path.join(root,files[url.pathname]),'utf8'),contentType:url.pathname.endsWith('.js')?'text/javascript':url.pathname==='/battle'?'text/html':'application/json'});
  if(url.pathname==='/health')return route.fulfill({json:{authentication:false}});
  const state={selected:'qwen-2b',ready:true,revision:'固定コミット',device:'cpu',backend:'fds',endpoint:'http://127.0.0.2:8767',remote_model:'jeff-qwen-2b'};
  if(url.pathname==='/testjeff/status')return route.fulfill({json:state});
  if(url.pathname==='/testjeff/model')return mode==='model-error'?route.fulfill({status:503,json:{detail:'モデルが未導入です'}}):route.fulfill({json:state});
  if(url.pathname==='/v1/systemone'){
   singleCount++;if(mode==='partial-error'&&singleCount===4)return route.fulfill({status:503,json:{detail:'途中の判定失敗'}});
   if(mode==='slow')await new Promise(resolve=>setTimeout(resolve,160));
   return route.fulfill({json:{model:'jeff-qwen3.5-2b',answers:{判定:{noul:.7}},execution:{backend:'fds',device:'cpu',revision:'固定コミット',inference_ms:8},reproduction:{request:req.postDataJSON(),runtime:{fingerprint:'試験コード固定値'},execution:{device:'cpu',precision:'float32'}}}});
  }
  if(url.pathname==='/testjeff/battle-batch')return route.fulfill({json:{results:Array.from({length:10},()=>({probability:.7,execution:{backend:'fds',device:'cpu'}})),reproduction:{requests:[req.postDataJSON()],runtime:{fingerprint:'一括コード固定値'}}}});
  if(url.pathname==='/testjeff/battle-runs'&&req.method()==='POST'){
   const payload=req.postDataJSON();posts.push(payload);if(failSave){failSave=false;return route.fulfill({status:503,json:{detail:'試験用の保存失敗'}});}
   let stored=records.find(row=>row.run_id===payload.run.id);if(stored)assert.deepEqual({run:stored.run,statistics:stored.statistics,connection:stored.connection},payload);
   else{stored={id:records.length+1,run_id:payload.run.id,recorded_at:new Date().toISOString(),...payload};records.push(stored);}
   return route.fulfill({json:stored});
  }
  if(url.pathname==='/testjeff/battle-runs'){if(holdList)await listGate;return route.fulfill({json:{rows:[...records].reverse().map(row=>({id:row.id,run_id:row.run_id,recorded_at:row.recorded_at,target:row.run.target,status:row.run.status,selected_models:row.run.selected_models,batch:row.run.batch,connection:row.connection})),next_before:null}});}
  if(url.pathname.startsWith('/testjeff/battle-runs/'))return route.fulfill({json:records.find(row=>row.id===Number(url.pathname.split('/').pop()))});
  return route.fulfill({status:404});
 });
 const ready=()=>page.locator('#start:not([disabled])').waitFor();
 const saved=()=>page.waitForFunction(()=>document.getElementById('run-save-status').textContent==='結果を保存済み'&&!document.getElementById('start').disabled);
 await page.goto(base+'/battle');await ready();
 const target=page.locator('#target');assert.equal(await target.getAttribute('role'),'combobox');
 await target.fill('日用品と道具');await target.press('Alt+ArrowDown');assert.equal(await page.locator('#target-listbox [role="option"]').count(),targetWords.length);
 await target.fill('日本語で自由に入力');assert.equal(await page.locator('#target-listbox [role="option"]').count(),targetWords.length);assert.equal(await target.getAttribute('aria-expanded'),'true');
 const ime=await target.evaluate(input=>{const event=new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true});input.dispatchEvent(event);return {value:input.value,prevented:event.defaultPrevented};});assert.deepEqual(ime,{value:'日本語で自由に入力',prevented:false});
 await target.press('Escape');assert.equal(await target.getAttribute('aria-expanded'),'false');await target.press('ArrowDown');await target.press('ArrowDown');assert(await target.getAttribute('aria-activedescendant'));await target.press('Enter');assert.equal(await target.inputValue(),targetWords[1]);
 await target.fill('持ち運べる物');await page.locator('input[aria-label="候補1"]').fill('買い物袋');
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'候補1の一覧を開く',exact:true}).click();
 const list=page.getByRole('listbox',{name:'候補1の候補一覧'});assert.equal(await list.getByRole('option').count(),1000);
  const bounds=await list.boundingBox();assert(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=390&&bounds.y+bounds.height<=844);
  await page.screenshot({path:path.join(root,'dev/testing/output/battle-combo-mobile.png')});
 assert.equal(await list.evaluate(node=>node.parentElement.tagName),'BODY');await page.locator('input[aria-label="候補1"]').fill('入力しても候補は全部');assert.equal(await list.getByRole('option').count(),1000);
 await page.locator('h1').click();assert(await list.isHidden());await page.locator('input[aria-label="候補1"]').fill('買い物袋');await page.setViewportSize({width:1250,height:950});
 await page.locator('#key').evaluate(input=>{input.value='TEST_API_SECRET';});await page.locator('#start').click();await page.waitForFunction(()=>document.getElementById('run-save-status').textContent.includes('結果の保存失敗')&&!document.getElementById('start').disabled);
 assert.equal(posts.length,1);const snapshot=posts[0];assert.equal(snapshot.run.schema_version,2);assert(snapshot.run.ended_at);assert.equal(snapshot.run.parameters.requests.length,10);assert.equal(snapshot.run.parameters.model_requests['qwen-2b'].requests.length,10);assert.equal(snapshot.run.parameters.positive_threshold,.5);assert.equal(snapshot.run.execution['qwen-2b'].device,'cpu');assert.equal(snapshot.run.results['qwen-2b'][0].reproduction.runtime.fingerprint,'試験コード固定値');assert(!JSON.stringify(snapshot).includes('秘密値'));assert(!JSON.stringify(snapshot).includes('TEST_API_SECRET'));
 // 終了後の集計リセットや接続オブジェクト変更を保存・ダウンロードへ混入させない。
 await page.locator('#reset').click();await page.evaluate(()=>{window.TestJeffConnection.config.device='cuda';window.TestJeffConnection.key='fds:127.0.0.2:8767:cuda';});
 await page.locator('#save-run').click();await saved();assert.equal(records.length,1);assert.deepEqual(posts[1],snapshot);
 const download=page.waitForEvent('download');await page.locator('#export').click();const downloaded=JSON.parse(fs.readFileSync(await (await download).path(),'utf8'));assert.deepEqual(downloaded,snapshot);assert.equal(downloaded.connection.device,'cpu');assert.equal(downloaded.statistics.runs,1);
 await page.reload();await ready();assert.equal(await target.inputValue(),'持ち運べる物');assert.equal(await page.locator('input[aria-label="候補1"]').inputValue(),'買い物袋');
 await page.locator('#show-history').click();await page.locator('.history-entry').first().click();await page.locator('#history-download').waitFor();
 assert.match(await page.locator('#history-detail').innerText(),/買い物袋/);assert.match(await page.locator('#history-detail').innerText(),/固定コミット/);assert.match(await page.locator('#history-detail').innerText(),/cpu/);
 const dialog=await page.locator('#battle-history').boundingBox();assert(dialog.width>1200&&dialog.height>900);
 await page.screenshot({path:path.join(root,'dev/testing/output/battle-history-mock.png')});
 const historyDownload=page.waitForEvent('download');await page.locator('#history-download').click();const historyRecord=JSON.parse(fs.readFileSync(await (await historyDownload).path(),'utf8'));assert.deepEqual(historyRecord.run,snapshot.run);assert.deepEqual(historyRecord.connection,snapshot.connection);await page.locator('#close-history').click();
 // 一覧応答の前に閉じて開き直しても、古い応答に妨げられず新たに一覧を取得する。
 holdList=true;listGate=new Promise(resolve=>{releaseList=resolve;});const listRequest=page.waitForRequest(req=>req.url().includes('/testjeff/battle-runs?'));await page.locator('#show-history').click();await listRequest;await page.locator('#close-history').click();holdList=false;
 await page.locator('#show-history').click();await page.waitForFunction(()=>document.getElementById('history-status').textContent==='1件');releaseList();await page.locator('.history-entry').first().click();await page.locator('#history-download').waitFor();await page.locator('#close-history').click();
 mode='slow';await page.locator('#start').click();await page.waitForFunction(()=>document.getElementById('progress').textContent==='Qwen 2B 1 / 10件');assert(await page.locator('#show-history').isDisabled());await page.locator('#stop').click();await saved();assert.equal(records.at(-1).run.status,'中止');assert.equal(records.at(-1).run.results['qwen-2b'].length,1);
 mode='model-error';await page.locator('#start').click();await saved();assert.equal(records.at(-1).run.status,'計測不能');assert.match(records.at(-1).run.skipped['qwen-2b'],/未導入/);
 mode='partial-error';singleCount=0;await page.locator('#start').click();await saved();assert.equal(records.at(-1).run.status,'計測不能');assert.equal(records.at(-1).run.partial_results['qwen-2b'].length,2);assert.equal(records.at(-1).run.results['qwen-2b'],undefined);assert.equal(records.at(-1).run.query_totals['qwen-2b'].complete,false);assert.equal(records.at(-1).run.query_totals['qwen-2b'].count,2);
 mode='normal';await page.evaluate(()=>{BattleCore.accumulate=()=>{throw Error('集計失敗の試験');};});await page.locator('#start').click();await saved();assert.equal(records.at(-1).run.status,'失敗');assert.equal(records.at(-1).run.error,'集計失敗の試験');
 await page.reload();await ready();await page.locator('#batch-mode').click();await page.locator('#start').click();await saved();const batch=records.at(-1).run;assert.equal(batch.parameters.batch_execution['qwen-2b'].runtime.fingerprint,'一括コード固定値');assert(batch.results['qwen-2b'].every(item=>!item.reproduction));
 assert.deepEqual(errors,[]);assert.equal(records.length,6);
 console.log('一体型全候補コンボ・IME/キーボード・狭幅popup・自動保存/再送・履歴復元/JSON・全終了状態・秘密情報除外・実行設定固定を確認');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
