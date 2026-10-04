// 8766の専用DB・CPU試験サーバーで保存と実推論メタデータを確認する。
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base='http://127.0.0.1:8766';
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[],records=[];
 page.setDefaultTimeout(120000);page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  if(!localStorage.getItem('testjeff-connection-v1'))localStorage.setItem('testjeff-connection-v1',JSON.stringify({mode:'local',host:'127.0.0.1',port:8767,device:'auto',local_device:'cpu'}));
  if(!localStorage.getItem('testjeff-battle-slots'))localStorage.setItem('testjeff-battle-slots',JSON.stringify(['qwen-0.8b','','','']));
 });
 await page.goto(base+'/battle');await page.locator('#start:not([disabled])').waitFor();await page.waitForFunction(()=>!document.getElementById('backend').disabled);
 await page.locator('#target').fill('暮らしで使う道具');await page.locator('input[aria-label="候補1"]').fill('雨傘');
 const before=(await (await page.request.get(base+'/testjeff/battle-runs')).json()).rows.length;
 for(const mode of ['single','batch']){
  await page.locator('#'+mode+'-mode').click();await page.locator('#start').click();
  await page.waitForFunction(()=>document.getElementById('run-save-status').textContent==='結果を保存済み'&&!document.getElementById('start').disabled);
  assert.equal(await page.locator('#error').textContent(),'');assert.equal(await page.locator('.result').count(),10);
  const download=page.waitForEvent('download');await page.locator('#export').click();
  const record=JSON.parse(fs.readFileSync(await(await download).path(),'utf8'));records.push(record);
  assert.equal(record.run.status,'完了');assert.equal(record.connection.local_device,'cpu');
  assert.equal(record.run.execution['qwen-0.8b'].device,'cpu');assert.equal(record.run.execution['qwen-0.8b'].precision,'torch.float32');
  const meta=mode==='single'?record.run.results['qwen-0.8b'][0].reproduction:record.run.parameters.batch_execution['qwen-0.8b'].batches[0].reproduction;
  assert.equal(meta.application.source_sha256.length,64);assert.equal(meta.execution.backend,'local');
  assert.deepEqual(Object.keys(Object.values(meta.request.questions)[0].criteria),['true','false']);
  const size=Buffer.byteLength(JSON.stringify(record));assert(size<512*1024);
  const retry=await page.request.post(base+'/testjeff/battle-runs',{data:record});assert.equal(retry.status(),200);const stored=await retry.json();
  assert.deepEqual(stored.run,record.run);assert.deepEqual(stored.connection,record.connection);
  const changed=structuredClone(record);changed.run.target='異なる入力';assert.equal((await page.request.post(base+'/testjeff/battle-runs',{data:changed})).status(),409);
 }
 const listed=await(await page.request.get(base+'/testjeff/battle-runs')).json();assert.equal(listed.rows.length,before+2);
 await page.reload();await page.locator('#show-history:not([disabled])').waitFor();await page.locator('#show-history').click();
 await page.locator('.history-entry').first().click();await page.locator('#history-download').waitFor();assert.match(await page.locator('#history-detail').innerText(),/雨傘/);
 const download=page.waitForEvent('download');await page.locator('#history-download').click();const latest=JSON.parse(fs.readFileSync(await(await download).path(),'utf8'));assert.deepEqual(latest.run,records[1].run);
 await page.screenshot({path:'dev/testing/output/v0170-history-live.png',fullPage:true});await page.locator('#close-history').click();
 // 画像も専用DBへ保存し、前処理・完全な質問・元画像識別が残る。
 const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=64;c.height=48;const x=c.getContext('2d');x.fillStyle='green';x.fillRect(0,0,64,48);return c.toDataURL('image/png');});
 const photoResponse=await page.request.post(base+'/testjeff/photos',{data:{model:'qwen-0.8b',mode:'photos',image,filename:'再現情報試験.png'},timeout:120000});
 assert.equal(photoResponse.status(),200,await photoResponse.text());const photo=await photoResponse.json();
 assert.equal(photo.parameters.preprocessing.jpeg_quality,90);assert.equal(photo.parameters.original_image.sha256.length,64);assert.equal(photo.parameters.questions.白黒.type,'noul');assert.equal(photo.reproduction.execution.device,'cpu');assert(!JSON.stringify(photo).includes(image));
 const history=await(await page.request.get(base+'/testjeff/image-history?mode=photos')).json();assert.deepEqual(history.rows[0].result.parameters,photo.parameters);
 // FDSは要求autoと実際deviceを区別し、変換された送信内容も返す。
 const remoteResponse=await page.request.post(base+'/v1/systemone',{headers:{'X-TestJeff-Backend':'fds','X-TestJeff-Host':'127.0.0.1','X-TestJeff-Port':'8767','X-TestJeff-Device':'auto','X-TestJeff-Model':'qwen-2b'},data:{model:'jeff-qwen3.5-2b',state:'猫',questions:{判定:{type:'noul',instructions:'動物ですか？',criteria:{true:'該当',false:'非該当'}}}},timeout:120000});
 assert.equal(remoteResponse.status(),200,await remoteResponse.text());const remote=await remoteResponse.json();assert.equal(remote.execution.requested_device,'auto');assert(['cpu','cuda'].includes(remote.execution.device));assert.equal(remote.reproduction.submitted_requests[0].device,'auto');
 assert.deepEqual(errors,[]);
 fs.writeFileSync('dev/testing/output/v0170-storage-live.json',JSON.stringify({records,record_bytes:records.map(r=>Buffer.byteLength(JSON.stringify(r))),photo,remote,errors},null,2));
 console.log('実CPUの個別/一括対戦保存・同一ID再送・履歴JSON、画像再現情報、実FDSの要求/実deviceを確認');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
