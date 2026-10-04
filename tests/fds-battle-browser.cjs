const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const context=await browser.newContext();await context.addInitScript(()=>localStorage.setItem('testjeff-connection-v1',JSON.stringify({mode:'fds',host:'127.0.0.1',port:8767,device:'auto'})));
 const page=await context.newPage();const records=[];
 // CLI部分だけを模擬し、3モデルのFDS振り分けを実測する。
 await page.route('**/testjeff/luna',route=>route.fulfill({json:{model:'gpt-5.6-luna',verdict:true,source:'test-fixture',reasoning:'low',duration_ms:1}}));
 page.on('response',async r=>{if(r.url().endsWith('/v1/systemone')&&r.ok())records.push(await r.json());});
 await page.goto('http://127.0.0.1:8765/battle');await page.locator('#start').click();
 await page.waitForFunction(()=>!document.getElementById('start').disabled,null,{timeout:180000});
 const error=await page.locator('#error').textContent(),status=await page.locator('#progress').textContent();
 console.log(JSON.stringify({status,error,models:[...new Set(records.map(r=>r.execution?.model))]},null,2));
 fs.writeFileSync('dev/testing/output/fds-battle.json',JSON.stringify({status,error,records},null,2));
 if(error){assert.match(error,/FDS: モデルが未導入/);assert.match(status,/累積には加算していません/);}else assert.equal(records.length,33);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
