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
  function complete(run){return models.every(m=>run.results[m.id]?.length===10&&run.results[m.id].every(x=>Number.isFinite(x.ms)&&x.ms>=0&&(m.cloud?typeof x.verdict==='boolean':Number.isFinite(x.probability)&&x.probability>=0&&x.probability<=1)));}
  function compare(run){
    if(!complete(run))throw Error('40件すべての結果が必要です。');
    const wins=Object.fromEntries(models.map(m=>[m.id,0]));let agreement=0;
    for(let i=0;i<10;i++){
      const values=models.map(m=>run.results[m.id][i]);
      if(values.every(x=>positive(x)===positive(values[0])))agreement++;
      const fastest=Math.min(...values.map(x=>x.ms));
      models.forEach((m,j)=>{if(values[j].ms===fastest)wins[m.id]++;});
    }
    return {wins,agreement};
  }
  function accumulate(previous,run){
    const comparison=compare(run), next=JSON.parse(JSON.stringify(previous||{runs:0,agreement:0,models:{}}));
    next.runs++;next.agreement+=comparison.agreement;
    for(const m of models){const s=summarize(run.results[m.id]),old=next.models[m.id]||{count:0,totalMs:0,yes:0,probabilitySum:0,wins:0};
      next.models[m.id]={count:old.count+s.count,totalMs:old.totalMs+s.totalMs,yes:old.yes+s.yes,probabilitySum:old.probabilitySum+s.probabilitySum,wins:old.wins+comparison.wins[m.id]};}
    return next;
  }
  const api={models,positive,summarize,complete,compare,accumulate};
  if(typeof module!=='undefined')module.exports=api;else root.BattleCore=api;
})(globalThis);
