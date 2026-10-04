/* 同じ入力の個別・一括結果だけを速度比較する。 */
(function(root){
  'use strict';
  function sameInputs(a,b){return !!a&&!!b&&a.target===b.target&&JSON.stringify(a.candidates)===JSON.stringify(b.candidates)&&JSON.stringify(a.selected_models)===JSON.stringify(b.selected_models);}
  function valid(item){return item&&Number.isFinite(item.ms)&&item.ms>=0&&(typeof item.verdict==='boolean'||Number.isFinite(item.probability)&&item.probability>=0&&item.probability<=1);}
  function finished(run,id){const total=run?.query_totals?.[id],count=run?.candidates?.length;return !!total?.complete&&total.count===count&&Number.isFinite(total.total_ms)&&total.total_ms>=0&&run.results?.[id]?.length===count&&run.results[id].every(valid);}
  function executionCondition(a,b){
    if(a?.precision!=null&&b?.precision!=null&&a.precision!==b.precision)return 'different';
    if(a?.backend==='codex_cli'&&b?.backend==='codex_cli'){
      const values=x=>({backend:x.backend,model:x.model,source:x.source,reasoning:x.reasoning,executable_sha256:x.executable?.sha256,timeout_seconds:x.timeout_seconds,options:x.options});
      const left=values(a),right=values(b),keys=Object.keys(left),canonical=x=>JSON.stringify(x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(key=>[key,x[key]])):x);
      if(keys.some(key=>left[key]!=null&&right[key]!=null&&canonical(left[key])!==canonical(right[key])))return 'different';
      return keys.every(key=>left[key]!=null&&right[key]!=null)?'verified':'unknown';
    }
    const keys=['backend','model','device','revision'];
    if(keys.some(key=>a?.[key]!=null&&b?.[key]!=null&&a[key]!==b[key]))return 'different';
    return keys.every(key=>a?.[key]!=null&&b?.[key]!=null)?'verified':'unknown';
  }
  function sameExecution(a,b){return executionCondition(a,b)==='verified';}
  function connectionCondition(a,b){
    if(!a||!b||!a.mode||!b.mode)return 'unknown';if(a.mode!==b.mode)return 'different';
    const keys=a.mode==='fds'?['host','port','device','key']:['local_device','key'];
    return keys.some(key=>(a[key]??null)!==(b[key]??null))?'different':'verified';
  }
  function metrics(records){
    const single=records.single?.run,batch=records.batch?.run,ids=single?.selected_models||batch?.selected_models||[];
    return Object.fromEntries(ids.map(id=>{
      const execution=executionCondition(single?.execution?.[id],batch?.execution?.[id]),connection=connectionCondition(records.single?.connection,records.batch?.connection),condition=[execution,connection].includes('different')?'different':[execution,connection].includes('unknown')?'unknown':'verified';
      const comparable=sameInputs(single,batch)&&finished(single,id)&&finished(batch,id)&&condition==='verified';
      const s=single?.query_totals?.[id]?.total_ms??null,b=batch?.query_totals?.[id]?.total_ms??null;
      return [id,{comparable,execution_condition:condition,single_total_ms:s,batch_total_ms:b,reduction_percent:comparable&&s>0?(s-b)/s*100:null,speedup:comparable&&b>0?s/b:null}];
    }));
  }
  const api={sameInputs,valid,finished,sameExecution,executionCondition,connectionCondition,metrics};
  if(typeof module!=='undefined')module.exports=api;else root.QueryComparisonCore=api;
})(globalThis);
