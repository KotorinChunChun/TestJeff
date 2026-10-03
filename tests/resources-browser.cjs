// 取得・更新・障害・復旧をブラウザーで検証する。
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1400,height:1100}});
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.goto((process.env.LIVE_URL||'http://127.0.0.1:8765')+'/nouns');
    await page.waitForFunction(()=>document.getElementById('resource-cpu').textContent.includes('%'));
    const values=await page.locator('[aria-label="サーバー使用量"]').innerText();
    assert(values.includes('GiB'));
    await page.locator('#random:not([disabled])').click();
    await page.waitForFunction(()=>document.getElementById('progress').textContent==='10 / 10件完了');
    await page.route('**/testjeff/resources',route=>route.fulfill({status:503,body:''}));
    await page.waitForFunction(()=>document.getElementById('resource-cpu').textContent==='取得不可');
    assert.equal(await page.locator('#resource-memory').textContent(),'取得不可');
    await page.unroute('**/testjeff/resources');
    await page.waitForFunction(()=>document.getElementById('resource-cpu').textContent.includes('%'));
    await page.screenshot({path:path.join(__dirname,'../dev/testing/output/resources-live.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert(await page.locator('#resource-cpu').isVisible());
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(__dirname,'../dev/testing/output/resources-live.json'),JSON.stringify({values,errors},null,2));
    console.log('実測表示・ランダム判定・通信失敗・復旧・狭幅表示を確認しました。');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
