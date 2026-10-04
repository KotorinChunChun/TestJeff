// 判定時の設定が保存・JSON出力まで残ることを、実モデルを起動せず確認する。
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const reproduction={schema_version:1,request:{orders:1},execution:{backend:'fds',device:'cpu',revision:'server-test'}};
async function downloaded(page,button){const pending=page.waitForEvent('download');await page.locator(button).click();return JSON.parse(fs.readFileSync(await(await pending).path(),'utf8'));}
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext();
  await context.addInitScript(()=>{window.TestJeffConnection={config:{mode:'fds',host:'127.0.0.1',port:8767,device:'cpu',local_device:'cuda',secret:'秘密にする試験値'},key:'fds:127.0.0.1:8767:cpu'};});
  const page=await context.newPage(),errors=[],saved=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   const files={'/nouns':'src/nouns.html','/assets/nouns.js':'src/nouns.js','/assets/nouns-core.js':'src/nouns-core.js','/testjeff/nouns':'src/data/nouns.json','/testjeff/abstract-nouns':'src/data/abstract-nouns.json'};
   if(files[url.pathname])return route.fulfill({body:fs.readFileSync(path.join(root,files[url.pathname]),'utf8'),contentType:url.pathname.endsWith('.js')?'text/javascript':url.pathname==='/nouns'?'text/html':'application/json'});
   if(url.pathname==='/health')return route.fulfill({json:{authentication:false}});
   if(url.pathname==='/testjeff/status')return route.fulfill({json:{ready:true,selected:'qwen-2b'}});
   if(url.pathname==='/v1/systemone')return route.fulfill({json:{model:req.postDataJSON().model,answers:{判定:{noul:.8}},reproduction}});
   if(url.pathname==='/testjeff/feedback'){
    if(req.method()==='GET')return route.fulfill({json:saved});
    saved.push(req.postDataJSON());return route.fulfill({json:saved.at(-1)});
   }
   return route.fulfill({status:404});
  });
  await page.goto('http://127.0.0.1:18765/nouns');await page.locator('#evaluate:not([disabled])').waitFor();
  await page.locator('#target').fill('道具');await page.locator('#evaluate').click();
  await page.waitForFunction(()=>document.getElementById('progress').textContent==='10 / 10件完了');
  await page.locator('#sort-order').selectOption('name');
  await page.evaluate(()=>{window.TestJeffConnection.config.device='cuda';window.TestJeffConnection.config.port=9876;});
  await page.locator('#rows tr').first().getByRole('button',{name:'良かった',exact:true}).click();
  await page.locator('#rows tr').first().getByText('良かった・記録済み').waitFor();
  let records=await downloaded(page,'#download-feedback');const record=records[0];
  assert.equal(record.parameters.connection.device,'cpu');assert.equal(record.parameters.connection.port,8767);
  assert.equal(record.parameters.threshold,.5);assert.equal(record.parameters.sort_mode,'time');
  assert.equal(record.parameters.accumulate,false);assert.equal(record.parameters.input_method,'manual');
  assert.equal(record.parameters.request.state.対象,record.candidate);assert.equal(record.parameters.request.orders,1);
  assert.match(record.parameters.request.questions.判定.instructions,/道具/);assert.deepEqual(record.reproduction,reproduction);
  assert(!JSON.stringify(record).includes('秘密にする試験値'));
  await page.locator('#random').click();await page.waitForFunction(()=>document.getElementById('progress').textContent==='10 / 10件完了');
  await page.locator('#rows tr').first().getByRole('button',{name:'良かった',exact:true}).click();
  await page.locator('#rows tr').first().getByText('良かった・記録済み').waitFor();
  records=await downloaded(page,'#download-feedback');assert.equal(records[1].parameters.input_method,'random');assert.equal(records[1].parameters.accumulate,true);
  assert.equal(records[0].parameters.connection.device,'cpu');

  const photos=await context.newPage();photos.on('pageerror',e=>errors.push(e.message));
  let requests=0,secondStarted,releaseSecond;const second=new Promise(resolve=>secondStarted=resolve),hold=new Promise(resolve=>releaseSecond=resolve),failures=[];
  await photos.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.pathname==='/photos'||url.pathname==='/assets/photos.js')return route.fulfill({body:fs.readFileSync(path.join(root,url.pathname==='/photos'?'src/photos.html':'src/photos.js'),'utf8'),contentType:url.pathname==='/photos'?'text/html':'text/javascript'});
   if(url.pathname==='/health')return route.fulfill({json:{authentication:false}});
   if(url.pathname==='/testjeff/photo-samples')return route.fulfill({json:{prompts:{text:'判定時の文字指示',landscape:'風景',coverage:'面積',monochrome:'白黒'},samples:[]}});
   if(url.pathname==='/testjeff/image-history')return route.fulfill({json:{rows:[]}});
   if(url.pathname==='/testjeff/model')return route.fulfill({json:{ready:true,selected:'qwen-2b'}});
   if(url.pathname==='/testjeff/image-failure'){failures.push(req.postDataJSON());return route.fulfill({json:{record_id:1}});}
   if(url.pathname==='/testjeff/photos'){
    requests++;if(requests===2){secondStarted();await hold;return route.fulfill({status:422,json:{detail:'試験用の判定失敗'}});}
    return route.fulfill({json:{model:'jeff-qwen3.5-2b',answers:{文字情報:{noul:.9},風景:{noul:.1},白黒:{noul:.1}},coverage_percent:30,response_ms:1,reproduction}});
   }
   return route.fulfill({status:404});
  });
  await photos.goto('http://127.0.0.1:18765/photos');await photos.waitForFunction(()=>document.getElementById('prompt-text').value.length>0);
  await photos.evaluate(async()=>{
   const canvas=document.createElement('canvas');canvas.width=canvas.height=2;
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
   folderImages=['一枚目.png','二枚目.png','三枚目.png'].map((name,i)=>{const file=new File([blob],name,{type:'image/png'});return {id:String(i),name,file,image:URL.createObjectURL(file),result:null};});
   renderSamples(folderImages,'folder-results');setBusy(false);
  });
  await photos.locator('#run-folder').click();await second;
  await photos.locator('#stop-folder').click();releaseSecond();
  await photos.waitForFunction(()=>document.getElementById('status').textContent==='フォルダ判定を停止しました');
  await photos.evaluate(()=>{window.TestJeffConnection.config.device='cuda';document.getElementById('prompt-text').value='終了後の変更';document.getElementById('model').value='qwen-0.8b';});
  const exported=await downloaded(photos,'#export-folder');
  assert.equal(exported.length,3);assert(exported[0].result);assert.match(exported[1].error,/試験用/);assert.equal(exported[2].result,null);
  assert.deepEqual(exported[0].result.reproduction,reproduction);
  for(const entry of exported){assert.equal(entry.schema_version,1);assert.equal(entry.parameters.connection.device,'cpu');assert.equal(entry.parameters.model,'qwen-2b');assert.equal(entry.parameters.prompts.text,'判定時の文字指示');assert.equal(entry.parameters.timeout_ms,135000);assert.deepEqual(entry.parameters.input_order,['一枚目.png','二枚目.png','三枚目.png']);}
  assert.deepEqual(failures[0].parameters,exported[1].parameters);assert(!JSON.stringify(exported).includes('秘密にする試験値'));
  assert.deepEqual(errors,[]);console.log('名詞・画像の実行時パラメータ保持、変更後のJSON、失敗・未判定、秘密値の除外を確認');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
