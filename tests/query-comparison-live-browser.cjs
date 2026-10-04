// 8766の専用DBで実CPUとFDSを比較する。Lunaを実行しない。
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base='http://127.0.0.1:8766';
async function download(page){const event=page.waitForEvent('download');await page.locator('#download').click();return JSON.parse(fs.readFileSync(await(await event).path(),'utf8'));}
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const reports=[];
  for(const mode of ['local','fds']){
   const context=await browser.newContext({viewport:{width:1600,height:1000}}),errors=[];
   await context.addInitScript(mode=>{
    localStorage.setItem('testjeff-connection-v1',JSON.stringify({mode,host:'127.0.0.1',port:8767,device:'cpu',local_device:'cpu'}));
    localStorage.setItem('testjeff-query-comparison-inputs-v1',JSON.stringify({target:'道具',candidates:['傘'],count:1,slots:mode==='local'?['qwen-0.8b','','','']:['qwen-0.8b','qwen-2b','','']}));
   },mode);
   const page=await context.newPage();page.setDefaultTimeout(240000);page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'/query-comparison');await page.locator('#start:not([disabled])').waitFor();
   await page.waitForFunction(()=>!document.getElementById('backend').disabled);
   const model=mode==='local'?'qwen-0.8b':'qwen-2b',counts=mode==='local'?[1,30]:[1];
   for(const count of counts){
    await page.locator('#candidate-count').selectOption(String(count));
    const inputs=await page.locator('#candidate-editors input').evaluateAll(ns=>ns.map(n=>n.value));assert.equal(inputs.length,count);
    await page.locator('#start').click();await page.locator('#comparison-wait:not(.hidden)').waitFor();
    await page.waitForFunction(()=>document.getElementById('save-status').textContent==='両方式の結果を保存済み'&&!document.getElementById('start').disabled);
    assert.equal(await page.locator('#error').textContent(),'');const result=await download(page);reports.push(result);
    assert.equal(result.records.single.run.target,'道具');assert.deepEqual(result.records.single.run.candidates,inputs);
    assert.deepEqual(result.records.single.run.candidates,result.records.batch.run.candidates);
    assert.equal(result.records.single.run.parameters.candidate_count,count);
    assert.equal(result.records.batch.run.parameters.comparison_id,result.comparison_id);
    for(const method of ['single','batch']){
     const record=result.records[method],run=record.run,total=run.query_totals[model];
     assert.equal(run.status,'完了');assert.equal(run.results[model].length,count);assert.equal(record.connection.mode,mode);
     assert(total.complete);assert.equal(total.count,count);assert(total.total_ms>0);assert(total.response_sum_ms>0);
     assert.equal(run.execution[model].device,'cpu');assert(run.warmup[model].ms>0);
     const response=await page.request.post(base+'/testjeff/battle-runs',{data:record});assert.equal(response.status(),200,await response.text());
     assert.deepEqual((await response.json()).run,run);
     if(mode==='fds')assert.match(run.skipped['qwen-0.8b'],/未導入/);
    }
    assert(result.metrics[model].comparable,JSON.stringify(result.metrics[model]));
    assert.equal(typeof result.metrics[model].speedup,'number');
    await page.locator('#refresh-history').click();await page.waitForFunction(()=>!document.getElementById('history-select').disabled);
    await page.locator('#target').fill('変更後の質問');await page.locator('input[aria-label="候補1"]').fill('変更後の候補');
    await page.locator('#history-select').selectOption(result.comparison_id);
    await page.waitForFunction(()=>document.getElementById('history-status').textContent==='保存結果を表示中');
    assert.deepEqual(await download(page),result);assert.equal(await page.locator('#target').inputValue(),'変更後の質問');
    assert.equal(await page.locator('input[aria-label="候補1"]').inputValue(),'変更後の候補');
    await page.locator('#comparison-results tr[data-model="'+model+'"] button').click();
    assert.equal(await page.locator('#detail-content tbody tr').count(),count);await page.locator('#close-detail').click();
    await page.screenshot({path:`dev/testing/output/v0180-comparison-${mode}-${count}.png`,fullPage:true});
    await page.locator('#target').fill('道具');await page.locator('input[aria-label="候補1"]').fill('傘');
   }
   assert.deepEqual(errors,[]);await context.close();
  }
  assert.deepEqual(reports[0].method_order,['single','batch']);assert.deepEqual(reports[1].method_order,['batch','single']);
  fs.writeFileSync('dev/testing/output/v0180-comparison-live.json',JSON.stringify(reports,null,2));
  console.log('実CPUの1/30件の両方式・交互順序・合計時間、実FDSの両方式・未導入スキップ、SQLite履歴JSONと入力保持を確認');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
