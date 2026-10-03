// 実画面で文章・色・速度順・記録内容・失敗再送・ダウンロードを確認する。
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..'), live=process.env.LIVE_URL;
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1400,height:1100}});
    let index=0, fail=true; const saved=[], attempts=[], errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    if(!live) await page.route('**/*',async route=>{
      const req=route.request(), url=new URL(req.url());
      const files={'/nouns':'src/nouns.html','/assets/nouns.js':'src/nouns.js','/assets/nouns-core.js':'src/nouns-core.js','/testjeff/nouns':'src/data/nouns.json','/testjeff/abstract-nouns':'src/data/abstract-nouns.json'};
      if(files[url.pathname])return route.fulfill({body:fs.readFileSync(path.join(root,files[url.pathname]),'utf8'),contentType:url.pathname.endsWith('.js')?'text/javascript':url.pathname==='/nouns'?'text/html':'application/json'});
      if(url.pathname==='/testjeff/status')return route.fulfill({json:{ready:true,selected:'qwen-0.8b'}});
      if(url.pathname==='/health')return route.fulfill({json:{model:'画面試験',authentication:false}});
      if(url.pathname==='/v1/systemone'){
        const n=index++; await new Promise(r=>setTimeout(r,20+(9-n%10)*15));
        return route.fulfill({json:{model:req.postDataJSON().model,answers:{判定:{noul:n%2?.9:.1}}}});
      }
      if(url.pathname==='/testjeff/feedback'){
        if(req.method()==='GET')return route.fulfill({json:saved});
        const data=req.postDataJSON(); attempts.push(data);
        if(!saved.some(x=>x.event_id===data.event_id))saved.push(data);
        if(fail){fail=false;return route.fulfill({status:500,json:{}});}
        return route.fulfill({json:data});
      }
      return route.fulfill({status:404});
    });
    await page.goto((live||'http://127.0.0.1:8767')+'/nouns');
    await page.locator('#random:not([disabled])').waitFor();
    await page.locator('#target').fill('道具');
    await page.locator('#rows input').first().fill('一年');
    await page.locator('#rows input').nth(1).fill('金槌');
    await page.locator('#evaluate').click();
    await page.waitForFunction(()=>document.getElementById('progress').textContent==='10 / 10件完了',null,{timeout:120000});
    const rendered=await page.locator('#rows tr').evaluateAll(nodes=>nodes.map(tr=>({candidate:tr.querySelector('input').value,sentence:tr.querySelector('.answer').textContent,yes:tr.querySelector('.answer').classList.contains('yes'),ms:parseFloat(tr.querySelector('.timing').textContent)})));
    rendered.forEach((row,i)=>{
      assert.equal(row.sentence,`「${row.candidate}」は「道具」${row.yes?'です':'ではありません'}`);
      if(i)assert(rendered[i-1].ms<=row.ms);
    });
    assert(rendered.some(x=>x.yes)&&rendered.some(x=>!x.yes));
    const row=page.locator('#rows tr').first();
    await row.getByRole('button',{name:'良かった',exact:true}).click();
    if(!live){
      await row.getByText('保存できませんでした。再試行してください。').waitFor();
      await row.getByRole('button',{name:'良かった',exact:true}).click();
    }
    await row.getByText('良かった・記録済み').waitFor();
    await row.getByRole('button',{name:'悪かった',exact:true}).click();
    await row.getByText('悪かった・記録済み').waitFor();
    await page.locator('#sort-order').selectOption('name');
    const names=await page.locator('#rows input').evaluateAll(nodes=>nodes.map(node=>node.value));
    assert.deepEqual(names,[...names].sort(new Intl.Collator('ja',{numeric:true}).compare));
    await page.locator('#sort-order').selectOption('result');
    const ranks=await page.locator('#rows .answer').evaluateAll(nodes=>nodes.map(node=>node.classList.contains('yes')?0:1));
    assert.deepEqual(ranks,[...ranks].sort());
    await page.locator('#sort-order').selectOption('time');
    assert.equal(await row.locator('input').inputValue(),rendered[0].candidate);
    await row.getByText('悪かった・記録済み').waitFor();
    const downloadEvent=page.waitForEvent('download');
    await page.locator('#download-feedback').click();
    const download=await downloadEvent;
    const records=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
    const last=records.slice(-2);
    assert.deepEqual(last.map(x=>x.rating),['良かった','悪かった']);
    assert(last.every(x=>x.candidate===rendered[0].candidate&&x.target==='道具'&&x.model==='qwen-0.8b'));
    assert.equal(last[0].result_id,last[1].result_id);
    if(!live){assert.equal(attempts[0].event_id,attempts[1].event_id);assert.equal(saved.length,2);}
    await page.screenshot({path:path.join(root,`dev/testing/output/feedback-${live?'live':'mock'}.png`),fullPage:true});
    await page.reload(); await page.locator('#random:not([disabled])').waitFor();
    const response=await page.request.get((live||'http://127.0.0.1:8767')+'/testjeff/feedback').catch(()=>null);
    if(live)assert.equal((await response.json()).length,records.length);
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(root,`dev/testing/output/feedback-${live?'live':'mock'}.json`),JSON.stringify({rendered,records,errors},null,2));
    console.log('文章・色・速度順・フィードバック記録・ダウンロードを確認しました。');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
