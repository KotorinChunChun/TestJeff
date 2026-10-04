const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.TESTJEFF_URL||'http://127.0.0.1:8765';
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
  for(const path of ['/','/nouns','/battle','/query-comparison','/photos','/classification']){
   await page.goto(base+path);
   await page.waitForFunction(()=>!document.getElementById('backend').disabled);
   for(const width of [1400,1078,390]){
    await page.setViewportSize({width,height:1000});
    const row=page.locator('.testjeff-title-row');
    const layout=await row.evaluate(row=>{
     row.scrollLeft=0;
     const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,center:r.top+r.height/2,width:r.width,height:r.height};};
     const title=row.querySelector('h1,.brand'),form=row.querySelector('form'),nav=row.querySelector('nav');
     const labels=[...form.querySelectorAll('label')].filter(node=>!node.hidden).map(node=>{
      const range=document.createRange();range.selectNodeContents(node.firstChild);
      return {box:rect(node),control:rect(node.querySelector('input,select')),nowrap:getComputedStyle(node).whiteSpace,textLines:range.getClientRects().length};
     });
     return {title:rect(title),form:rect(form),nav:nav&&rect(nav),navigation:nav?[...nav.children].map(rect):[],firstLink:nav?.querySelector('a')?.getAttribute('href'),labels,parent:row.parentElement.tagName,children:[...row.children].map(node=>node.tagName),blocks:[...row.children].map(rect),overflow:document.documentElement.scrollWidth>innerWidth+1,scrollable:row.scrollWidth>row.clientWidth+1,overflowX:getComputedStyle(row).overflowX};
    });
    const detail=JSON.stringify({mode,path,width,layout});
    assert.equal(layout.parent,'HEADER',detail);assert(layout.nav,detail);assert.deepEqual(layout.children.slice(1,3),['FORM','NAV'],detail);if(path!=='/')assert.equal(layout.firstLink,'/',detail);
    assert(layout.title.right<=layout.form.left+1,detail);assert(layout.form.right<=layout.navigation[0].left+1,detail);
    for(const box of [...layout.blocks,...layout.navigation,...layout.labels.map(label=>label.box)])assert(Math.abs(box.center-layout.title.center)<2,detail);
    for(const label of layout.labels){assert.equal(label.nowrap,'nowrap',detail);assert.equal(label.textLines,1,detail);assert(Math.abs(label.box.center-label.control.center)<2,detail);}
    for(const boxes of [layout.blocks,layout.navigation,layout.labels.map(label=>label.box)])for(let i=1;i<boxes.length;i++)assert(boxes[i-1].right<=boxes[i].left+1,detail);
    assert(!layout.overflow,detail);
    if(width===390){assert(layout.scrollable,detail);assert(['auto','scroll'].includes(layout.overflowX),detail);}
    const name=path==='/'?'home':path.slice(1),prefix=`dev/testing/output/header-nav-${name}-${mode}-${width}`;
    await page.locator('.testjeff-page-header').screenshot({path:prefix+'.png'});
    if(layout.scrollable){
     const reached=await row.evaluate(row=>{
      const rect=node=>node.getBoundingClientRect(),view=rect(row),items=[...row.querySelectorAll('form label:not([hidden]),nav>a,nav>button'),...[...row.children].slice(3)];
      const results=items.map(node=>{row.scrollLeft=0;row.scrollLeft=rect(node).left-view.left;const box=rect(node);return {text:node.textContent,visible:box.left>=view.left-1&&box.right<=view.right+1};});
      row.scrollLeft=row.scrollWidth;
      const last=rect(row.lastElementChild.tagName==='NAV'?row.lastElementChild.lastElementChild:row.lastElementChild);
      return {items:results,lastVisible:last.left>=view.left-1&&last.right<=view.right+1,scrollLeft:row.scrollLeft,overflow:document.documentElement.scrollWidth>innerWidth+1};
     });
     assert(reached.items.every(item=>item.visible),JSON.stringify({mode,path,width,reached}));assert(reached.lastVisible,JSON.stringify({mode,path,width,reached}));assert(reached.scrollLeft>0,detail);assert(!reached.overflow,detail);
     if(width===390)await page.locator('.testjeff-page-header').screenshot({path:prefix+'-end.png'});
     await row.evaluate(row=>row.scrollLeft=0);
    }
   }
  }
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('全6ページのタイトル・処理先設定・navが1行で非重複。local/FDS×1400/1078/390px、label改行なし・ヘッダー内スクロール・ページ横はみ出しなしを確認');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
