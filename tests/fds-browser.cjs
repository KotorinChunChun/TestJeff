const {chromium}=require('playwright'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[],records=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('response',async response=>{if((response.url().endsWith('/v1/systemone')||response.url().endsWith('/testjeff/photos'))&&response.ok())records.push(await response.json());});
 await page.goto('http://127.0.0.1:8765/photos');await page.locator('#backend').selectOption('fds');await page.waitForFunction(()=>document.getElementById('connection-status').textContent==='接続済み');
 for(const route of ['/photos','/classification','/nouns','/battle','/']){
  await page.goto('http://127.0.0.1:8765'+route);assert.equal(await page.locator('#backend').inputValue(),'fds');await page.waitForFunction(()=>document.getElementById('connection-status').textContent==='接続済み');
  if(route==='/photos'||route==='/classification'){
   await page.waitForFunction(()=>document.getElementById('prompt-text').value.length>0);
   await page.locator('#file').setInputFiles(path.join(__dirname,'../dev/image/sample1.jpg'));
   await page.waitForFunction(()=>['判定完了','判定失敗'].includes(document.getElementById('status').textContent),null,{timeout:120000});
   assert.equal(await page.locator('#status').textContent(),'判定完了',await page.locator('#error').textContent());
  }else if(route==='/nouns'){
   await page.waitForFunction(()=>!document.getElementById('random').disabled);await page.locator('#random').click();
   await page.waitForFunction(()=>!document.getElementById('random').disabled);assert.equal(await page.locator('#error').textContent(),'');
  }else if(route==='/'){
   await page.locator('#run').click();await page.waitForFunction(()=>!document.getElementById('run').disabled);
  }
 }
 assert(records.length>=13);assert(records.every(r=>r.execution?.backend==='fds'));
 // 無効な接続先は適用しない。
 await page.locator('#fds-port').fill('1');await page.waitForFunction(()=>document.getElementById('connection-status').textContent.startsWith('接続失敗'));
 assert.match(await page.locator('#connection-status').textContent(),/接続できない/);
 await page.locator('#backend').selectOption('local');await page.waitForFunction(()=>document.getElementById('connection-status').textContent==='ローカル');assert.equal(await page.locator('#backend').inputValue(),'local');
 await page.locator('#run').click();await page.waitForFunction(()=>!document.getElementById('run').disabled);
 assert(!records.at(-1).execution?.backend);
 assert.deepEqual(errors,[]);fs.writeFileSync('dev/testing/output/fds-browser.json',JSON.stringify({records,errors},null,2));
 await page.screenshot({path:'dev/testing/output/fds-connection.png',fullPage:true});console.log('全5ページの設定、FDSテキスト・画像、接続失敗、ローカル復帰を確認');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
