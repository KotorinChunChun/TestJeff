(function(root){
  'use strict';
  const models=[{id:'qwen-0.8b',name:'Qwen 0.8B',api:'jeff-qwen3.5-0.8b'},
    {id:'qwen-2b',name:'Qwen 2B',api:'jeff-qwen3.5-2b'},
    {id:'gemma-e2b',name:'Gemma E2B',api:'jeff-gemma-4-e2b-it'},
    {id:'gpt-5.6-luna',name:'GPT-5.6-Luna',api:'gpt-5.6-luna',cloud:true}];
  const positive=item=>typeof item.verdict==='boolean'?item.verdict:item.probability>=.5;
  function summarize(items){
    const times=items.map(x=>x.ms).sort((a,b)=>a-b), total=times.reduce((a,b)=>a+b,0);
    return {count:items.length,totalMs:total,mean:total/items.length,
      median:times.length?(times[Math.floor((times.length-1)/2)]+times[Math.floor(times.length/2)])/2:0,
      yes:items.filter(positive).length,probabilitySum:items.reduce((a,b)=>a+(b.probability??0),0)};
  }
  function participants(run){const ids=run.selected_models??models.map(m=>m.id);if(!Array.isArray(ids)||!ids.length||ids.length>4||new Set(ids).size!==ids.length||ids.some(id=>!models.some(m=>m.id===id)))return [];return ids.map(id=>models.find(m=>m.id===id));}
  function candidateCount(run){if(run.candidates===undefined)return 10;return Array.isArray(run.candidates)&&run.candidates.length>=1&&run.candidates.length<=100?run.candidates.length:0;}
  function measured(run){const count=candidateCount(run);return count?participants(run).filter(m=>run.results[m.id]?.length===count&&run.results[m.id].every(x=>x&&Number.isFinite(x.ms)&&x.ms>=0&&(m.cloud?typeof x.verdict==='boolean':Number.isFinite(x.probability)&&x.probability>=0&&x.probability<=1))):[];}
  function rankings(run){
    if(!run?.results)return [];
    const ranked=[];
    for(const model of measured(run)){
      if(Object.hasOwn(run.skipped||{},model.id))continue;
      let totalMs;
      if(Object.hasOwn(run.query_totals||{},model.id)){
        const total=run.query_totals[model.id];
        if(total?.complete!==true||!Number.isFinite(total.total_ms)||total.total_ms<0)continue;
        totalMs=total.total_ms;
      }else totalMs=summarize(run.results[model.id]).totalMs;
      if(Number.isFinite(totalMs)&&totalMs>=0)ranked.push({id:model.id,totalMs});
    }
    ranked.sort((a,b)=>a.totalMs-b.totalMs);
    let rank=0;
    return ranked.map((item,index)=>{if(!index||item.totalMs!==ranked[index-1].totalMs)rank=index+1;return {...item,rank};});
  }
  function hasMismatch(items,expected='未評価'){
    const judgments=new Set();
    for(const item of items||[]){
      if(typeof item?.verdict==='boolean')judgments.add(item.verdict);
      else if(Number.isFinite(item?.probability)&&item.probability>=0&&item.probability<=1)judgments.add(item.probability>=.5);
    }
    if(expected==='です')judgments.add(true);
    else if(expected==='ではありません')judgments.add(false);
    return judgments.size===2;
  }
  function complete(run){const valid=measured(run);return valid.length>0&&participants(run).every(m=>valid.includes(m)||typeof run.skipped?.[m.id]==='string')&&Object.keys(run.results).every(id=>participants(run).some(m=>m.id===id));}
  function compare(run){
    if(!complete(run))throw Error('利用可能なモデルの計測完了が必要です。');
    const active=measured(run),wins=Object.fromEntries(models.map(m=>[m.id,0]));let agreement=0;
    if(active.length<2)return {wins,agreement:null};
    for(let i=0;i<candidateCount(run);i++){
      const values=active.map(m=>run.results[m.id][i]);
      if(values.every(x=>positive(x)===positive(values[0])))agreement++;
      const fastest=Math.min(...values.map(x=>x.ms));
      active.forEach((m,j)=>{if(values[j].ms===fastest)wins[m.id]++;});
    }
    return {wins,agreement};
  }
  function accumulate(previous,run){
    const comparison=compare(run),next=JSON.parse(JSON.stringify(previous||{runs:0,agreement:0,comparisons:0,models:{}}));
    next.comparisons??=next.runs;next.comparison_items??=next.comparisons*10;next.runs++;
    if(comparison.agreement!==null){next.agreement+=comparison.agreement;next.comparisons++;next.comparison_items+=candidateCount(run);}
    for(const m of measured(run)){const s=summarize(run.results[m.id]),old=next.models[m.id]||{count:0,totalMs:0,yes:0,probabilitySum:0,wins:0};
      next.models[m.id]={count:old.count+s.count,totalMs:old.totalMs+s.totalMs,yes:old.yes+s.yes,probabilitySum:old.probabilitySum+s.probabilitySum,wins:old.wins+comparison.wins[m.id]};}
    return next;
  }
  const api={models,participants,candidateCount,positive,summarize,measured,rankings,hasMismatch,complete,compare,accumulate};
  if(typeof module!=='undefined')module.exports=api;else root.BattleCore=api;
})(globalThis);
