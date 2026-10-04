// 通信・保存領域・時計を模擬化し、自動保存キューだけを検証する。
const assert=require('node:assert/strict'),{create,indexedStore}=require('../src/query-autosave.js');
const clone=value=>JSON.parse(JSON.stringify(value));
function snapshot(id){return {comparison_id:id,method_order:['single','batch'],records:Object.fromEntries(['single','batch'].map(mode=>[mode,{run:{id:id+'-'+mode,target:'動物',candidates:['猫'],results:{}}}])),saved:{}};}
function memoryStore(){const data=new Map();return {data,fail:false,failRemove:false,async load(){if(this.fail)throw Error('保存領域停止');return [...data.values()].map(clone);},async put(value){if(this.fail)throw Error('保存領域停止');data.set(value.comparison_id,clone(value));},async remove(id){if(this.fail||this.failRemove)throw Error('保存領域停止');data.delete(id);}};}
function clock(){const jobs=new Map();let id=0;return {jobs,schedule(fn,wait){jobs.set(++id,{fn,wait});return id;},cancel(id){jobs.delete(id);},next(){const [id,job]=jobs.entries().next().value||[];assert(job,'自動再試行が予定される');jobs.delete(id);job.fn();return job.wait;}};}
function harness(options={}){
 const store=options.store||memoryStore(),time=clock(),calls=[],states=[],saved=[];let serverId=0;
 const queue=create({store,send:async record=>{calls.push(clone(record));return options.send?options.send(record,calls.length):{id:++serverId,run_id:record.run.id};},busy:options.busy,onChange:state=>states.push(state),onSaved:(...args)=>saved.push(args),schedule:time.schedule,cancel:time.cancel});
 return {queue,store,time,calls,states,saved,last:()=>states.at(-1)};
}
async function retry(h){const delay=h.time.next();await h.queue.flush();return delay;}

(async()=>{
 // 正常保存と呼出元からの独立。自動開始の0秒タイマーも検証する。
 {
  const h=harness();await h.queue.init();const value=snapshot('正常');assert.equal(await h.queue.enqueue(value),true);value.records.single.run.target='呼出元の後続変更';
  assert.equal(await retry(h),0);assert.deepEqual(h.calls.map(record=>record.run.id),['正常-single','正常-batch']);assert.equal(h.calls[0].run.target,'動物');
  assert.equal(h.store.data.size,0);assert.deepEqual(h.last(),{pending:0,saving:false,storageUnavailable:false});assert.equal(h.saved.length,2);h.queue.dispose();
 }
 // 片方式の失敗は5秒後に自動再送し、成功した方式は再送しない。
 {
  let fail=true;const h=harness({send:async record=>{if(record.run.id.endsWith('batch')&&fail)throw Error('通信失敗');return {id:1,run_id:record.run.id};}});
  await h.queue.init();await h.queue.enqueue(snapshot('片方式'));await h.queue.flush();assert.equal(h.store.data.get('片方式').saved.single,1);assert.equal(h.last().pending,1);
  fail=false;assert.equal(await retry(h),5000);assert.deepEqual(h.calls.map(record=>record.run.id),['片方式-single','片方式-batch','片方式-batch']);assert.equal(h.last().pending,0);h.queue.dispose();
 }
 // 再生成（再読込）後も成功方式と最後の比較を復元する。
 {
  const store=memoryStore(),first=harness({store,send:async record=>{if(record.run.id.endsWith('batch'))throw Error('通信失敗');return {id:7,run_id:record.run.id};}});
  await first.queue.init();await first.queue.enqueue(snapshot('前回'));await first.queue.flush();first.queue.dispose();
  const second=harness({store});const restored=await second.queue.init();assert.equal(restored.latest.comparison_id,'前回');assert.equal(restored.latest.saved.single,7);
  await retry(second);assert.deepEqual(second.calls.map(record=>record.run.id),['前回-batch']);assert.equal(store.data.size,0);second.queue.dispose();
 }
 // 古い比較が失敗中でも次の比較を失わない。再送は同じrun.idを使う。
 {
  let offline=true;const h=harness({send:async record=>{if(offline)throw Error('通信失敗');return {id:3,run_id:record.run.id};}});
  await h.queue.init();await h.queue.enqueue(snapshot('比較1'));await h.queue.flush();await h.queue.enqueue(snapshot('比較2'));await h.queue.flush();assert.equal(h.store.data.size,2);assert.equal(h.last().pending,2);
  h.queue.dispose();const recovered=harness({store:h.store});const {latest}=await recovered.queue.init();assert.equal(latest.comparison_id,'比較2');await retry(recovered);
  assert.deepEqual(recovered.calls.map(record=>record.run.id),['比較1-single','比較1-batch','比較2-single','比較2-batch']);assert.equal(recovered.last().pending,0);recovered.queue.dispose();
 }
 // 実行ID不一致を成功扱いしない。バックオフは最大60秒まで。
 {
  const h=harness({send:async()=>({id:4,run_id:'別の実行'})});await h.queue.init();await h.queue.enqueue(snapshot('不一致'));await h.queue.flush();assert.equal(h.saved.length,0);assert.deepEqual(h.store.data.get('不一致').saved,{});
  for(const wait of [5000,10000,20000,40000,60000,60000])assert.equal(await retry(h),wait);assert.equal(h.last().pending,1);h.queue.dispose();assert.equal(h.time.jobs.size,0);await h.queue.flush();assert.equal(h.time.jobs.size,0);
 }
 // 計測中はHTTPを開始せず、計測解除後に自動実行する。
 {
  let busy=true;const h=harness({busy:()=>busy});await h.queue.init();await h.queue.enqueue(snapshot('計測中'));await h.queue.flush();assert.equal(h.calls.length,0);assert.equal(h.last().pending,1);
  busy=false;assert.equal(await retry(h),5000);assert.equal(h.calls.length,2);h.queue.dispose();
 }
 // 保存領域の停止でサーバー送信を止めない。通信も失敗した分はメモリに残す。
 {
  const store=memoryStore();store.fail=true;let offline=true;const h=harness({store,send:async record=>{if(offline)throw Error('通信も停止');return {id:9,run_id:record.run.id};}});
  const result=await h.queue.init(snapshot('旧退避'));assert.equal(result.persistedLegacy,false);assert.equal(result.latest.comparison_id,'旧退避');assert.equal(await h.queue.enqueue(snapshot('メモリ退避')),false);await h.queue.flush();
  assert.equal(h.calls.length,4);assert.equal(h.last().pending,2);assert.equal(h.last().storageUnavailable,true);assert.equal(h.saved.length,0);
  offline=false;await retry(h);assert.equal(h.saved.length,4);assert.equal(h.last().pending,2,'完了の削除に失敗してもキューを残す');assert.equal(h.last().storageUnavailable,true);
  store.fail=false;const sent=h.calls.length;await retry(h);assert.equal(h.calls.length,sent,'通信成功分を再送しない');assert.deepEqual(h.last(),{pending:0,saving:false,storageUnavailable:false});h.queue.dispose();
 }
 // 旧localStorageからの移行完了はIndexedDB退避成功時だけ返す。
 {
  const h=harness({busy:()=>true});const legacy=snapshot('移行');const result=await h.queue.init(legacy);assert.equal(result.persistedLegacy,true);assert.equal(h.store.data.size,1);assert.equal(result.latest.comparison_id,'移行');result.latest.records.single.run.target='表示側の編集';assert.equal(h.store.data.get('移行').records.single.run.target,'動物');h.queue.dispose();
 }
 // 応答だけ失われた場合は同じIDで再送し、別の保存記録を作るIDを生成しない。
 {
  let first=true;const received=new Set(),h=harness({send:async record=>{received.add(record.run.id);if(first){first=false;throw Error('応答だけ喪失');}return {id:11,run_id:record.run.id};}});
  await h.queue.init();await h.queue.enqueue(snapshot('応答喪失'));await h.queue.flush();await retry(h);assert.equal(received.size,2);assert.deepEqual(h.calls.map(record=>record.run.id),['応答喪失-single','応答喪失-batch','応答喪失-single']);h.queue.dispose();
 }
 // 保存HTTP中に次比較を追加しても、更新と削除の競合で消失しない。
 {
  let release;const gate=new Promise(resolve=>{release=resolve;});const h=harness({send:async record=>{await gate;return {id:12,run_id:record.run.id};}});
  await h.queue.init();await h.queue.enqueue(snapshot('実行中1'));const flushing=h.queue.flush();await h.queue.enqueue(snapshot('実行中2'));release();await flushing;await retry(h);assert.equal(h.last().pending,0);assert.equal(h.calls.length,4);h.queue.dispose();
 }
 // IndexedDB未提供も同期例外にせずPromiseで拒否する。
 assert.equal(typeof indexedStore().load,'function');await assert.rejects(indexedStore().load());
 console.log('比較自動保存: 2方式・部分再試行・復元・複数待機・ID検証・計測待機・保存領域失敗・旧退避移行・応答喪失・競合・再試行停止を確認');
})().catch(error=>{console.error(error);process.exitCode=1;});
