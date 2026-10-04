const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),live=process.env.LIVE_URL,base=live||'http://127.0.0.1:8767';
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
const page=await browser.newPage({viewport:{width:1300,height:1000}}),errors=[];let requests=0;
page.on('pageerror',e=>errors.push(e.message));
if(!live)await page.route('**/*',async route=>{const url=new URL(route.request().url());
 if(url.pathname==='/photos'||url.pathname==='/assets/photos.js')return route.fulfill({body:fs.readFileSync(path.join(root,url.pathname==='/photos'?'src/photos.html':'src/photos.js'),'utf8'),contentType:url.pathname==='/photos'?'text/html':'text/javascript'});
 if(url.pathname==='/health')return route.fulfill({json:{authentication:false}});
 if(url.pathname==='/testjeff/photo-samples')return route.fulfill({json:{prompts:{text:'文字',landscape:'風景',coverage:'看板面積'},samples:[]}});
 if(url.pathname==='/testjeff/model')return route.fulfill({json:{ready:true,selected:'qwen-2b'}});
 if(url.pathname==='/testjeff/photos'){requests++;if(requests===2)return route.fulfill({status:422,json:{detail:'画像を読み込めません'}});return route.fulfill({json:{model:'jeff-qwen3.5-2b',answers:{文字情報:{noul:.9},風景:{noul:.1}},coverage_percent:30,response_ms:100,prompts:route.request().postDataJSON().prompts}});}
 return route.fulfill({status:404});
});
await page.goto(base+'/photos');await page.waitForFunction(()=>document.getElementById('prompt-text').value.length>0);
await page.locator('#folder').setInputFiles(path.join(root,'dev/image'));
await page.waitForFunction(()=>document.getElementById('status').textContent==='フォルダ判定完了',null,{timeout:120000});
assert.equal(await page.locator('#folder-results tr').count(),5);
assert.equal(await page.locator('#folder-status').textContent(),live?'5枚完了・0枚失敗・0枚未判定':'4枚完了・1枚失敗・0枚未判定');
if(!live){assert.equal(requests,5);assert.match(await page.locator('#folder-results').innerText(),/画像を読み込めません/);}
const downloading=page.waitForEvent('download');await page.locator('#export-folder').click();const download=await downloading;
const out=path.join(root,`dev/testing/output/folder-${live?'live':'mock'}.json`);await download.saveAs(out);
const rows=JSON.parse(fs.readFileSync(out,'utf8'));assert.equal(rows.length,5);assert.equal(rows.filter(x=>x.result).length,live?5:4);assert(rows.every(x=>!('image' in x)));
// 拡大表示とEscape、処理時間を確認。
await page.locator('#folder-results img').first().click();assert(await page.locator('#image-dialog').isVisible());
await page.keyboard.press('Escape');assert(!(await page.locator('#image-dialog').isVisible()));
assert.match(await page.locator('#folder-elapsed').textContent(),/全体/);
assert(rows.filter(r=>r.result).every(r=>r.result.total_ms>=r.result.response_ms||!live));
if(!live){
 const before=requests;
 const dimensions=await page.evaluate(async()=>{
   const png=new Uint8Array(32);png.set([137,80,78,71]);const v=new DataView(png.buffer);v.setUint32(16,4001);v.setUint32(20,4000);
   const jpeg=new Uint8Array([255,216,255,192,0,11,8,15,160,15,161,0,0,0,0]);
   const webp=new Uint8Array(32);webp.set([82,73,70,70],0);webp.set([87,69,66,80,86,80,56,88],8);webp.set([160,15,0,159,15,0],24);
   const sizes=await Promise.all([png,jpeg,webp].map((b,i)=>imageDimensions(new File([b],'test'+i))));
   folderImages=[{id:'over',name:'解像度超過.png',file:new File([png],'解像度超過.png',{type:'image/png'}),result:null}];
   await runFolder();return sizes;
 });
 assert.deepEqual(dimensions,[[4001,4000],[4001,4000],[4001,4000]]);
 assert.equal(requests,before,'解像度超過を送信していない');
 assert.match(await page.locator('#folder-results').innerText(),/1600万画素超/);
}
await page.screenshot({path:path.join(root,`dev/testing/output/folder-${live?'live':'mock'}.png`),fullPage:true});assert.deepEqual(errors,[]);
console.log('フォルダ選択・全5画像・途中失敗後の継続・結果JSON保存を確認。');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
