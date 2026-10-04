// 8766の専用SQLiteへ実CPU推論を保存する統合検証。本番DBでは実行しない。
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base='http://127.0.0.1:8766';
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[],records=[];
  page.setDefaultTimeout(180000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   localStorage.setItem('testjeff-connection-v1',JSON.stringify({mode:'local',host:'127.0.0.1',port:8767,device:'cpu',local_device:'cpu'}));
   localStorage.setItem('testjeff-battle-slots',JSON.stringify(['qwen-0.8b','','','']));
  });
  await page.goto(base+'/battle');await page.locator('#start:not([disabled])').waitFor();
  await page.waitForFunction(()=>!document.getElementById('backend').disabled);
  assert.deepEqual(await page.locator('#candidate-count option').evaluateAll(nodes=>nodes.map(n=>n.value)),['1','10','30','100']);
  for(const [mode,count] of [['single',1],['batch',100]]){
   await page.locator('#candidate-count').selectOption(String(count));
   await page.locator('#target').fill('道具');await page.locator('input[aria-label="候補1"]').fill('傘');
   await page.locator('#'+mode+'-mode').click();
   assert.equal(await page.locator('#rows tr').count(),count);
   await page.locator('#start').click();
   await page.waitForFunction(()=>document.getElementById('run-save-status').textContent==='結果を保存済み'&&!document.getElementById('start').disabled);
   assert.equal(await page.locator('#error').textContent(),'');
   const download=page.waitForEvent('download');await page.locator('#export').click();
   const record=JSON.parse(fs.readFileSync(await(await download).path(),'utf8')),run=record.run;records.push(record);
   assert.equal(run.status,'完了');assert.equal(run.target,'道具');assert.equal(run.candidates[0],'傘');
   assert.equal(run.candidates.length,count);assert.equal(run.parameters.candidate_count,count);
   assert.equal(run.results['qwen-0.8b'].length,count);
   const total=run.query_totals['qwen-0.8b'];assert(total.complete);assert.equal(total.count,count);
   assert(total.total_ms>0);assert(total.response_sum_ms>0);assert(total.total_ms>=total.response_sum_ms-.1);
   assert.match(await page.locator('#summary').innerText(),/合計時間/);
   assert.equal(run.execution['qwen-0.8b'].device,'cpu');
   if(mode==='batch'){
    const batches=run.parameters.batch_execution['qwen-0.8b'].batches;
    assert.equal(batches.length,13);assert.equal(batches.reduce((sum,b)=>sum+b.count,0),100);
    assert(batches.every(b=>b.count<=8));
   }
   const response=await page.request.post(base+'/testjeff/battle-runs',{data:record});assert.equal(response.status(),200,await response.text());
   assert.deepEqual((await response.json()).run,run);
  }
  await page.screenshot({path:'dev/testing/output/v0180-count-live.png',fullPage:true});
  assert.deepEqual(errors,[]);
  fs.writeFileSync('dev/testing/output/v0180-count-live.json',JSON.stringify({records,errors},null,2));
  console.log('実CPUで個別1件・一括100件（8件以下×13要求）、合計時間、再現JSON、SQLite同一記録再送を確認');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
