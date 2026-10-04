const {chromium}=require('playwright'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
for(const [route,title] of [['photos','文字風景判定'],['classification','画像分類']]){
 await page.goto('http://127.0.0.1:8765/'+route);
 assert.equal(await page.locator('h1').textContent(),title);
 await page.waitForFunction(()=>document.getElementById('prompt-text').value.length>0);
 await page.locator('#folder').setInputFiles(path.join(__dirname,'../dev/image'));
 await page.waitForFunction(()=>document.getElementById('status').textContent==='フォルダ判定完了',null,{timeout:180000});
 assert.equal(await page.locator('#folder-status').textContent(),'5枚完了・0枚失敗・0枚未判定');
 await page.waitForFunction(()=>document.querySelectorAll('#history tr').length>=5);
 await page.reload();await page.waitForFunction(()=>document.querySelectorAll('#history tr').length>=5);
 await page.locator('#history img').first().click();assert(await page.locator('#image-dialog').isVisible());await page.keyboard.press('Escape');
 const saved=await(await page.request.get('http://127.0.0.1:8765/testjeff/image-history?mode='+route)).json();
 assert(saved.rows.slice(0,5).every(r=>r.image.startsWith('data:image/jpeg;base64,')));
 if(route==='classification')assert(saved.rows.slice(0,5).every(r=>r.result.image_type&&r.result.primary_content));
 console.log(route,JSON.stringify(saved.rows.slice(0,5).map(r=>({name:r.name,major:r.result.image_type_label,minor:r.result.primary_content_label,ms:r.result.response_ms}))));
 await page.screenshot({path:'dev/testing/output/'+route+'-sqlite.png',fullPage:true});
}
assert.deepEqual(errors,[]);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
