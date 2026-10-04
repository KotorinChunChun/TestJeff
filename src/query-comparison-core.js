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
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  function canonical(value){
    if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
    if(typeof value==='number')return Number.isFinite(value)?JSON.stringify(value):undefined;
    if(Array.isArray(value)){
      const items=Array.from(value,canonical);return items.every(item=>item!==undefined)?'['+items.join(',')+']':undefined;
    }
    if(object(value)){
      const items=Object.keys(value).sort().map(key=>{const item=canonical(value[key]);return item===undefined?undefined:JSON.stringify(key)+':'+item;});
      return items.every(item=>item!==undefined)?'{'+items.join(',')+'}':undefined;
    }
    return undefined;
  }
  function promptRows(request){
    if(!object(request)||!Object.hasOwn(request,'state')||!object(request.questions))return null;
    const orders=Object.hasOwn(request,'orders')?request.orders:1,images=Object.hasOwn(request,'images')?request.images:[];
    if(![1,2].includes(orders)||!Array.isArray(images))return null;
    const questions=Object.values(request.questions);if(!questions.length)return null;
    const rows=[];
    for(const question of questions){
      if(!object(question)||!['noul','choice','score'].includes(question.type)||!Object.hasOwn(question,'instructions')||!Object.hasOwn(question,'criteria'))return null;
      // 状態オブジェクトとchoiceの順序は、実際のプロンプトの文字列・選択肢順に影響する。
      const criteria=question.type==='choice'&&object(question.criteria)?Object.entries(question.criteria):question.criteria;
      const row=canonical({state:JSON.stringify(request.state),question:{type:question.type,instructions:JSON.stringify(question.instructions),criteria},orders,images});
      if(row===undefined)return null;rows.push(row);
    }
    return rows;
  }
  function submittedRows(reproduction,count){
    const original=reproduction?.request,orders=Object.hasOwn(original||{},'orders')?original.orders:1,submitted=reproduction?.submitted_requests;
    // FDSはorders回を別要求として転送する。転送要求自身のorders省略とは区別する。
    if(![1,2].includes(orders)||!Array.isArray(submitted)||submitted.length!==orders)return null;
    const candidates=Array.from({length:count},()=>[]);
    for(const request of submitted){
      const rows=promptRows(request);if(!rows||rows.length!==count)return null;
      rows.forEach((row,index)=>candidates[index].push({prompt:row,model:request.model,device:request.device}));
    }
    return candidates;
  }
  function submittedCondition(singles,batches){
    const individual=[],grouped=[];
    for(const item of singles){const rows=submittedRows(item.reproduction,1);if(!rows)return 'unknown';individual.push(rows[0]);}
    for(const batch of batches){
      const count=Object.keys(batch.reproduction.request.questions).length,rows=submittedRows(batch.reproduction,count);
      if(!rows)return 'unknown';grouped.push(...rows);
    }
    if(grouped.length!==individual.length)return 'unknown';
    for(let index=0;index<individual.length;index++){
      const left=individual[index],right=grouped[index];if(left.length!==right.length)return 'unknown';
      for(let turn=0;turn<left.length;turn++){
        if(left[turn].prompt!==right[turn].prompt)return 'different';
        if(['model','device'].some(key=>left[turn][key]!=null&&right[turn][key]!=null&&left[turn][key]!==right[turn][key]))return 'different';
      }
    }
    return 'verified';
  }
  function promptCondition(singleRun,batchRun,id){
    if(id==='gpt-5.6-luna')return 'not_applicable';
    const count=singleRun?.candidates?.length,singles=singleRun?.results?.[id],batches=batchRun?.parameters?.batch_execution?.[id]?.batches;
    if(!Array.isArray(singleRun?.candidates)||!count||!Array.isArray(batchRun?.candidates)||batchRun.candidates.length!==count||!Array.isArray(singles)||singles.length!==count||!Array.isArray(batches)||!batches.length)return 'unknown';
    const individual=[],grouped=[];
    for(const item of singles){const rows=promptRows(item?.reproduction?.request);if(!rows||rows.length!==1)return 'unknown';individual.push(rows[0]);}
    for(const batch of batches){
      const rows=promptRows(batch?.reproduction?.request);if(!rows)return 'unknown';
      if((Object.hasOwn(batch,'offset')&&batch.offset!==grouped.length)||(Object.hasOwn(batch,'count')&&batch.count!==rows.length))return 'unknown';
      grouped.push(...rows);
    }
    if(grouped.length!==count)return 'unknown';
    if(!individual.every((row,index)=>row===grouped[index]))return 'different';
    return [singleRun,batchRun].some(run=>run.execution?.[id]?.backend==='fds')?submittedCondition(singles,batches):'verified';
  }
  function metrics(records){
    const single=records.single?.run,batch=records.batch?.run,ids=single?.selected_models||batch?.selected_models||[];
    return Object.fromEntries(ids.map(id=>{
      const execution=executionCondition(single?.execution?.[id],batch?.execution?.[id]),connection=connectionCondition(records.single?.connection,records.batch?.connection),condition=[execution,connection].includes('different')?'different':[execution,connection].includes('unknown')?'unknown':'verified';
      const prompt=promptCondition(single,batch,id),comparable=sameInputs(single,batch)&&finished(single,id)&&finished(batch,id)&&condition==='verified'&&(prompt==='verified'||prompt==='not_applicable');
      const s=single?.query_totals?.[id]?.total_ms??null,b=batch?.query_totals?.[id]?.total_ms??null;
      return [id,{comparable,execution_condition:condition,prompt_condition:prompt,single_total_ms:s,batch_total_ms:b,reduction_percent:comparable&&s>0?(s-b)/s*100:null,speedup:comparable&&b>0?s/b:null}];
    }));
  }
  const api={sameInputs,valid,finished,sameExecution,executionCondition,connectionCondition,promptCondition,metrics};
  if(typeof module!=='undefined')module.exports=api;else root.QueryComparisonCore=api;
})(globalThis);
