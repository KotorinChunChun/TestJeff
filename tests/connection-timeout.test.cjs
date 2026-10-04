const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const seen=[],timers=[];
const context={window:{fetch:async(input,options)=>{seen.push(options);return {ok:true};},addEventListener:()=>{}},
 localStorage:{getItem:()=>null},document:{getElementById:()=>null},location:{href:'http://127.0.0.1:8765/',origin:'http://127.0.0.1:8765'},
 URL,Headers,AbortSignal:{timeout:ms=>{timers.push(ms);return {timeout:ms};}}};
vm.runInNewContext(fs.readFileSync('src/connection.js','utf8'),context);
(async()=>{
 for(const [count,expected] of [[1,135000],[10,255000],[30,495000],[100,1575000]]){
  const payload={model:'qwen-2b',candidates:Array(count).fill('犬')};
  assert.equal(context.window.TestJeffConnection.timeoutMs('/testjeff/battle-batch',payload),expected);
  await context.window.fetch('/testjeff/battle-batch',{method:'POST',body:JSON.stringify(payload)});
  assert.equal(seen.at(-1).signal.timeout,expected);
 }
 assert.equal(context.window.TestJeffConnection.timeoutMs('/testjeff/battle-batch',{model:'gpt-5.6-luna',candidates:Array(100)}),135000);
 assert.equal(context.window.TestJeffConnection.timeoutMs('/v1/systemone',{}),135000);
 assert.equal(context.window.TestJeffConnection.timeoutMs('/testjeff/battle-runs',{}),15000);
 for(const count of [0,101])assert.equal(context.window.TestJeffConnection.timeoutMs('/testjeff/battle-batch',{candidates:Array(count)}),135000);
 const explicit={user:true},before=timers.length;
 await context.window.fetch('/testjeff/battle-batch',{body:'{}',signal:explicit});
 assert.equal(seen.at(-1).signal,explicit);assert.equal(timers.length,before);
 console.log('問い合わせ件数に応じた有限待機期限と明示signalの維持を確認');
})().catch(e=>{console.error(e);process.exitCode=1;});
