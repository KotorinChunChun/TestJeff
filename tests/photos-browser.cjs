const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),live=process.env.LIVE_URL,base=live||'http://127.0.0.1:8767';
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[],records=[];let selected='qwen-2b',mode='normal';
 page.on('pageerror',e=>errors.push(e.message));
 if(!live)await page.route('**/*',async route=>{const url=new URL(route.request().url());
  if(url.pathname==='/photos'||url.pathname==='/assets/photos.js')return route.fulfill({body:fs.readFileSync(path.join(root,url.pathname==='/photos'?'src/photos.html':'src/photos.js'),'utf8'),contentType:url.pathname==='/photos'?'text/html':'text/javascript'});
  if(url.pathname==='/testjeff/photo-samples')return route.fulfill({json:{prompts:{text:'文字情報の試験',landscape:'風景の試験',coverage:'面積の試験'},samples:[]}});
  if(url.pathname==='/health')return route.fulfill({json:{authentication:false}});
  if(url.pathname==='/testjeff/model'){selected=route.request().postDataJSON().model;return route.fulfill({json:{ready:true,selected}});}
  if(url.pathname==='/testjeff/photos'){if(mode==='failure')return route.fulfill({status:422,json:{detail:'画像試験エラー'}});return route.fulfill({json:{model:`jeff-qwen3.5-${selected==='qwen-2b'?'2b':'0.8b'}`,answers:{文字情報:{noul:.8},風景:{noul:.5}},input_size:[512,320],coverage_percent:30,response_ms:123,prompts:{},created_at:'2026-10-04',revision:'test'}});}
  return route.fulfill({status:404});
 });
 page.on('response',async response=>{if(response.url().endsWith('/testjeff/photos')&&response.ok())records.push(await response.json());});
 await page.goto(base+'/photos');
 // 外部素材を使わず、読み取り経路の試験用に日本語文字のある画像を作る。
 const data=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=512;canvas.height=320;const c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,512,320);c.fillStyle='#182a26';c.font='bold 52px sans-serif';c.fillText('本日の営業時間',35,95);c.font='40px sans-serif';c.fillText('午前９時〜午後６時',30,180);return canvas.toDataURL('image/png').split(',')[1];});
 await page.waitForFunction(()=>document.getElementById('prompt-text').value.length>0);
 const transfer=await page.evaluateHandle(data=>{const t=new DataTransfer();t.items.add(new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],'営業時間.png',{type:'image/png'}));return t;},data);
 await page.locator('#dropzone').dispatchEvent('drop',{dataTransfer:transfer});
 await page.waitForFunction(()=>['判定完了','判定失敗'].includes(document.getElementById('status').textContent),null,{timeout:120000});
 assert.equal(await page.locator('#status').textContent(),'判定完了',await page.locator('#error').textContent());
 assert.equal(await page.locator('.percent').filter({hasText:'%'}).count(),2);
 await page.locator('#model').selectOption('qwen-0.8b');
 await page.waitForFunction(()=>['判定完了','判定失敗'].includes(document.getElementById('status').textContent)&&!document.getElementById('model').disabled,null,{timeout:120000});
 assert.equal(await page.locator('#status').textContent(),'判定完了',await page.locator('#error').textContent());
 assert.equal(records.length,2);
 assert.match(await page.locator('#coverage').textContent(),/約 \d+%/);
 await page.locator('#prompts').evaluate(e=>e.open=true);
 await page.locator('#prompt-coverage').fill('看板の背景を含む面積の割合を推定してください。');
 const sent=page.waitForRequest(r=>r.url().endsWith('/testjeff/photos'));
 await page.locator('#evaluate').click();
 assert.equal((await sent).postDataJSON().prompts.coverage,'看板の背景を含む面積の割合を推定してください。');
 await page.waitForFunction(()=>!document.getElementById('model').disabled);
 assert.equal(await page.locator('#status').textContent(),'判定完了');
 await page.screenshot({path:path.join(root,`dev/testing/output/photos-${live?'live':'mock'}.png`),fullPage:true});
 if(!live){assert.equal(await page.locator('#summary').textContent(),'文字情報を含む風景の写真');mode='failure';await page.locator('#evaluate').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='判定失敗');assert.equal(await page.locator('#summary').textContent(),'未判定');}
 await page.locator('#file').setInputFiles({name:'不正.txt',mimeType:'text/plain',buffer:Buffer.from('画像ではありません')});assert((await page.locator('#error').textContent()).includes('JPEG'));assert(await page.locator('#evaluate').isDisabled());
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(root,`dev/testing/output/photos-${live?'live':'mock'}.json`),JSON.stringify({fixture:'日本語の営業時間を描いた合成画像（写真精度の試験ではない）',records,errors},null,2));console.log('画像ドロップ・2モデル・面積表示・プロンプト編集・不正入力を確認しました。');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
