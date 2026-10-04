/* 起動済みFDSを読む受入試験。既存モデルを解放せず、承認を取り消す。 */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const context=await browser.newContext({viewport:{width:1400,height:1000}});
 await context.addInitScript(()=>localStorage.setItem('testjeff-connection-v1',JSON.stringify({mode:'fds',host:'127.0.0.1',port:8767,device:'auto',local_device:'cuda',auto_unload:true})));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const headers={'X-TestJeff-Backend':'fds','X-TestJeff-Host':'127.0.0.1','X-TestJeff-Port':'8767','X-TestJeff-Device':'auto'};
 const before=await (await context.request.get('http://127.0.0.1:8765/testjeff/fds-models',{headers})).json();
 assert.equal(before.capabilities_version,2);
 for(const route of ['/samples','/nouns','/battle','/query-comparison','/photos','/classification']){
  await page.goto('http://127.0.0.1:8765'+route);await page.waitForFunction(()=>document.querySelector('#connection-status')?.textContent==='接続済み');
  await page.locator('#fds-manage').click();await page.waitForFunction(()=>document.querySelectorAll('#fds-model-rows tr').length===3);
  assert.equal(await page.locator('#fds-model-rows').getByText('未導入',{exact:true}).count(),2);
  await page.locator('#fds-manager [data-close]').click();
 }
 await page.goto('http://127.0.0.1:8765/query-comparison');await page.waitForFunction(()=>document.querySelector('#connection-status')?.textContent==='接続済み');
 await page.locator('#fds-manage').click();
 const row=page.locator('#fds-model-rows tr').filter({hasText:'Jeff Qwen3.5-2B'});
 await row.getByRole('button',{name:'アンロード',exact:true}).click();
 await page.locator('#fds-approval').waitFor({state:'visible'});
 assert.match(await page.locator('#fds-approval-list').innerText(),/jeff-qwen-2b.*GPU/);
 await page.screenshot({path:path.join(__dirname,'../dev/testing/output/v0200-live-approval.png')});
 await page.locator('#fds-approval-cancel').click();
 await page.waitForFunction(()=>document.querySelector('#fds-manager-status')?.textContent.includes('取り消し'));
 const after=await (await context.request.get('http://127.0.0.1:8765/testjeff/fds-models',{headers})).json();
 assert.equal(after.generation,before.generation);assert.deepEqual(after.loaded_models,before.loaded_models);
 assert.deepEqual(errors,[]);console.log('実FDS: 全6ページの一覧・未導入表示・GPU解放確認・取消後常駐維持 成功');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
