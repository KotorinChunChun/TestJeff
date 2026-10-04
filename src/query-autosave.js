// 比較結果を複数件退避し、計測を止めずにサーバー保存を再試行する。
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.QueryAutosave=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const clone=value=>JSON.parse(JSON.stringify(value)),modes=['single','batch'];
 function indexedStore(name='testjeff-query-autosave-v1'){
  let opening=null;
  function open(){
   if(opening)return opening;
   opening=new Promise((resolve,reject)=>{
    const request=globalThis.indexedDB.open(name,1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('comparisons'))request.result.createObjectStore('comparisons',{keyPath:'comparison_id'});};
    request.onerror=()=>reject(request.error||Error('保存領域を開けません。'));
    request.onblocked=()=>reject(Error('保存領域の更新を待機しています。'));
    request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();opening=null;};resolve(db);};
   }).catch(error=>{opening=null;throw error;});
   return opening;
  }
  async function transaction(mode,operation){
   const db=await open();return new Promise((resolve,reject)=>{
    const tx=db.transaction('comparisons',mode),request=operation(tx.objectStore('comparisons'));let result;
    request.onsuccess=()=>{result=request.result;};
    tx.oncomplete=()=>resolve(result);
    tx.onerror=tx.onabort=()=>reject(tx.error||request.error||Error('保存領域を更新できません。'));
   });
  }
  return {load:()=>transaction('readonly',store=>store.getAll()),put:async snapshot=>{await transaction('readwrite',store=>store.put(snapshot));},remove:async id=>{await transaction('readwrite',store=>store.delete(id));}};
 }
 function create({store,send,busy=()=>false,onChange=()=>{},onSaved=()=>{},schedule=setTimeout,cancel=clearTimeout,retryDelay=5000,maxRetryDelay=60000}){
  const queue=new Map(),storageFailures=new Set();let disposed=false,timer=null,flushing=null,storageTail=Promise.resolve(),needsLoad=true,sending=false,delay=retryDelay,lastOrder=0;
  const notify=(callback,...args)=>{if(!disposed)try{callback(...args);}catch{/* 表示側の例外で未保存結果を失わない。 */}};
  const changed=()=>notify(onChange,{pending:queue.size,saving:sending,storageUnavailable:needsLoad||storageFailures.size>0});
  const complete=snapshot=>modes.every(mode=>!snapshot.records[mode]||snapshot.saved[mode]!=null);
  function normalized(snapshot){
   const value=clone(snapshot);
   if(!value||typeof value.comparison_id!=='string'||!value.comparison_id||!value.records||!modes.some(mode=>value.records[mode]))throw Error('比較結果の形式が不正です。');
   for(const mode of modes)if(value.records[mode]&&typeof value.records[mode].run?.id!=='string')throw Error('比較結果の実行IDがありません。');
   value.saved=value.saved||{};return value;
  }
  function add(snapshot){
   const value=normalized(snapshot),existing=queue.get(value.comparison_id);
   if(existing){for(const mode of modes)if(existing.saved[mode]==null&&value.saved[mode]!=null)existing.saved[mode]=value.saved[mode];return existing;}
   const recorded=Number(value.autosave_queued_at)||0;
   value.autosave_queued_at=recorded||Math.max(Date.now(),lastOrder+1);lastOrder=Math.max(lastOrder,value.autosave_queued_at);queue.set(value.comparison_id,value);return value;
  }
  function disk(operation,id){
   const task=storageTail.then(operation).then(()=>{storageFailures.delete(id);changed();return true;},()=>{storageFailures.add(id);changed();return false;});
   storageTail=task;return task;
  }
  const persist=snapshot=>disk(()=>store.put(clone(snapshot)),snapshot.comparison_id);
  async function load(){
   try{const snapshots=await store.load();for(const snapshot of snapshots)add(snapshot);needsLoad=false;changed();return true;}
   catch{needsLoad=true;changed();return false;}
  }
  function arm(wait){
   if(disposed||(!queue.size&&!needsLoad))return;
   if(timer!==null)cancel(timer);
   timer=schedule(()=>{timer=null;void flush();},wait);
  }
  function automatic(){if(!flushing)arm(0);}
  async function init(legacy=null){
   if(disposed)return {latest:null,persistedLegacy:false};
   await load();let persistedLegacy=false;
   if(legacy){try{persistedLegacy=await persist(add(legacy));}catch{/* 不正な旧記録は呼出元に残す。 */}}
   const latest=[...queue.values()].sort((a,b)=>b.autosave_queued_at-a.autosave_queued_at)[0];changed();automatic();
   return {latest:latest?clone(latest):null,persistedLegacy};
  }
  async function enqueue(snapshot){
   if(disposed)return false;
   const value=add(snapshot);changed();const persisted=await persist(value);automatic();return persisted;
  }
  function flush(){
   if(disposed)return Promise.resolve();if(flushing)return flushing;
   if(timer!==null){cancel(timer);timer=null;}
   flushing=(async()=>{
    let failed=false;
    if(needsLoad&&!await load())failed=true;
    for(const snapshot of [...queue.values()]){
     if(disposed)break;
     if(storageFailures.has(snapshot.comparison_id)&&!await persist(snapshot))failed=true;
     for(const mode of modes){
      if(disposed||busy())break;
      const record=snapshot.records[mode];if(!record||snapshot.saved[mode]!=null)continue;
      sending=true;changed();
      try{
       const result=await send(clone(record));
       if(result?.run_id!==record.run.id||!Number.isInteger(result.id)||result.id<=0)throw Error('保存した実行IDが一致しません。');
       snapshot.saved[mode]=result.id;notify(onSaved,snapshot.comparison_id,mode,result.id);
       if(!await persist(snapshot))failed=true;
      }catch{failed=true;}
      finally{sending=false;changed();}
     }
     if(complete(snapshot)){
      if(await disk(()=>store.remove(snapshot.comparison_id),snapshot.comparison_id)){queue.delete(snapshot.comparison_id);changed();}else failed=true;
     }
    }
    return failed;
   })().then(failed=>{
    flushing=null;
    if(queue.size||needsLoad){const wait=failed?delay:retryDelay;if(failed)delay=Math.min(maxRetryDelay,delay*2);arm(wait);}else delay=retryDelay;
   },()=>{flushing=null;arm(delay);delay=Math.min(maxRetryDelay,delay*2);});
   return flushing;
  }
  function dispose(){disposed=true;if(timer!==null)cancel(timer);timer=null;}
  return {init,enqueue,flush,dispose};
 }
 return {indexedStore,create};
});
