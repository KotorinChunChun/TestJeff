const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 for(const mode of ['local','fds']){
  const context=await browser.newContext({viewport:{width:1400,height:1000}});
  await context.addInitScript(mode=>localStorage.setItem('testjeff-connection-v1',JSON.stringify({mode,host:'127.0.0.1',port:8767,device:'cpu',local_device:'cuda'})),mode);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const state={selected:'qwen-2b',ready:true,device:mode==='local'?'cuda':'cpu',devices:['cpu','cuda'],models:['qwen-2b'],health:{accepting:true},capabilities:[{id:'jeff-qwen-2b',local_id:'qwen-2b',name:'Qwen 2B',available:true,modalities:['text','image'],devices:['cpu','cuda']}]};
  for(const path of ['status','model','fds-check'])await page.route('**/testjeff/'+path,r=>r.fulfill({json:state}));
  await page.route('**/health',r=>r.fulfill({json:{status:'ok',authentication:false}}));
  await page.route('**/testjeff/photo-samples',r=>r.fulfill({json:{prompts:{text:'文字',landscape:'風景',coverage:'面積',monochrome:'白黒'},samples:[]}}));
  await page.route('**/testjeff/image-history?*',r=>r.fulfill({json:{rows:[]}}));
  await page.route('**/testjeff/resources',r=>r.fulfill({json:{device:'cpu'}}));
  // 開発中の新しい部品も、本サーバーのPython再起動前から配置試験できる。
  await page.route('**/assets/noun-combo.js',r=>r.fulfill({body:fs.readFileSync('src/noun-combo.js','utf8'),contentType:'text/javascript'}));
  for(const path of ['/','/nouns','/battle','/photos','/classification']){
   await page.goto('http://127.0.0.1:8765'+path);
   await page.waitForFunction(()=>!document.getElementById('backend').disabled);
   for(const width of [1400,1078,390]){
    await page.setViewportSize({width,height:1000});
    const layout=await page.locator('.testjeff-title-row').evaluate(row=>{
     const title=row.querySelector('h1,.brand').getBoundingClientRect(),form=row.querySelector('form').getBoundingClientRect();
     return {title:{x:title.x,y:title.y,height:title.height},form:{x:form.x,y:form.y,height:form.height},parent:row.parentElement.tagName,overflow:document.documentElement.scrollWidth>innerWidth+1};
    });
    assert.equal(layout.parent,'HEADER');assert(layout.form.x>layout.title.x);
    assert(Math.abs(layout.form.y+layout.form.height/2-layout.title.y-layout.title.height/2)<2,JSON.stringify({mode,path,width,layout}));
    assert(!layout.overflow,JSON.stringify({mode,path,width,layout}));
   }
   await page.setViewportSize({width:1400,height:1000});
   if(path==='/battle')await page.screenshot({path:`dev/testing/output/v0170-header-${mode}.png`,fullPage:true});
  }
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('全5ページで処理先設定がタイトル右端・同一行。ローカル/FDS、1400/1078/390pxを確認');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
