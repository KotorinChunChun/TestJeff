// Edgeでランダム生成から10件評価まで確認する。LIVE_URL指定時は実GPUへ送信する。
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const live = process.env.LIVE_URL;
const base = live || 'http://127.0.0.1:8767';
const output = path.join(root, 'dev/testing/output');
fs.mkdirSync(output, {recursive:true});
(async () => {
  const browser = await chromium.launch({channel:'msedge', headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1180,height:1100}});
    const errors = [], calls = [], results = [];
    let active = 0, maxActive = 0, mode = 'normal';
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.url().endsWith('/v1/systemone')) {calls.push(request.postDataJSON()); active++; maxActive = Math.max(maxActive, active);}
    });
    page.on('requestfinished', request => {if (request.url().endsWith('/v1/systemone')) active--;});
    page.on('requestfailed', request => {if (request.url().endsWith('/v1/systemone')) active--;});
    page.on('response', async response => {
      if (response.url().endsWith('/v1/systemone') && response.ok()) results.push(await response.json());
    });
    if (!live) await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      const files = {'/nouns':'src/nouns.html','/assets/nouns.js':'src/nouns.js','/assets/nouns-core.js':'src/nouns-core.js','/testjeff/nouns':'src/data/nouns.json'};
      if (files[url.pathname]) return route.fulfill({body:fs.readFileSync(path.join(root,files[url.pathname]),'utf8'),contentType:url.pathname.endsWith('.js')?'text/javascript':url.pathname==='/nouns'?'text/html':'application/json'});
      if (url.pathname === '/health') return route.fulfill({json:{model:'画面検証',authentication:false}});
      if (url.pathname === '/v1/systemone') {
        await new Promise(resolve => setTimeout(resolve, mode === 'slow' ? 1200 : 20));
        if (mode === 'unauthorized') return route.fulfill({status:401,json:{}});
        return route.fulfill({json:{model:'画面検証',answers:{判定:{type:'noul',noul:.75}}}});
      }
      return route.fulfill({status:404,body:''});
    });
    await page.goto(base+'/nouns');
    await page.locator('#random:not([disabled])').waitFor();
    assert.equal(await page.locator('#rows tr').count(),10);
    assert.equal(await page.locator('#word-count').textContent(),'1,000語');
    if (live) {
      await page.getByRole('button',{name:'評価する',exact:true}).click();
      await page.waitForFunction(() => document.getElementById('progress').textContent === '10 / 10件完了', {timeout:120000});
    }
    const before = calls.length;
    await page.getByRole('button',{name:'ランダム生成',exact:true}).click();
    await page.waitForFunction(() => document.getElementById('progress').textContent === '10 / 10件完了', {timeout:120000});
    assert.equal(calls.length-before,10);
    const target = await page.locator('#target').inputValue();
    const candidates = await page.locator('#rows input').evaluateAll(nodes => nodes.map(node => node.value));
    assert.equal(new Set(candidates).size,10);
    assert.deepEqual(calls.slice(before).map(call => call.state.対象),candidates);
    assert(calls.slice(before).every(call => call.questions.判定.instructions.startsWith(`これは${target}ですか？`)));
    assert.equal(await page.locator('.percent').filter({hasText:'%'}).count(),10);
    assert.equal(maxActive,1);
    if (!live) {
      await page.locator('#target').fill('');
      await page.getByRole('button',{name:'評価する',exact:true}).click();
      assert((await page.locator('#error').textContent()).includes('名詞を入力'));
      assert.equal(calls.length,10);
      mode='slow';
      await page.locator('#random').click();
      await page.locator('#cancel').click();
      await page.waitForFunction(() => document.getElementById('progress').textContent.includes('中止'));
      assert.equal(await page.locator('#random').isEnabled(),true);
      mode='unauthorized';
      await page.locator('#evaluate').click();
      await page.locator('#auth:not(.hidden)').waitFor();
      assert((await page.locator('#error').textContent()).includes('APIキー'));
    }
    assert.deepEqual(errors,[]);
    await page.screenshot({path:path.join(output,live?'nouns-live.png':'nouns-mock.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(output,live?'nouns-mobile.png':'nouns-mock-mobile.png'),fullPage:true});
    fs.writeFileSync(path.join(output,live?'nouns-live.json':'nouns-browser.json'),JSON.stringify({target,candidates,requests:calls,results,maxActive,errors},null,2));
    console.log(`${live?'実GPU':'画面試験'}: ワンクリック抽選・10件評価・逐次送信・表示を確認しました。`);
  } finally {await browser.close();}
})().catch(error => {console.error(error);process.exitCode=1;});
