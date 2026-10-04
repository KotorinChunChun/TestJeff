const assert=require('node:assert/strict');
const core=require('../src/battle-core.js');
const run={results:Object.fromEntries(core.models.map((m,j)=>[m.id,Array.from({length:10},(_,i)=>({ms:(j+1)*10,...(m.cloud?{verdict:true}:{probability:j===2&&i===0?.1:.9})}))]))};
assert.equal(core.summarize([{ms:10,probability:1},{ms:20,probability:0}]).median,15);
assert.equal(core.compare(run).agreement,9);
assert.equal(core.compare(run).wins['qwen-0.8b'],10);
const stats=core.accumulate(core.accumulate(null,run),run);
assert.equal(stats.runs,2);assert.equal(stats.models['qwen-2b'].count,20);
assert.equal(stats.models['qwen-2b'].totalMs/20,20);
run.results['qwen-2b'].pop();assert.throws(()=>core.accumulate(stats,run));
const partial={results:{'qwen-0.8b':run.results['qwen-0.8b']},skipped:Object.fromEntries(core.models.slice(1).map(m=>[m.id,'未導入']))};
assert(core.complete(partial));assert.equal(core.compare(partial).agreement,null);
const partialStats=core.accumulate(null,partial);assert.equal(partialStats.comparisons,0);assert.equal(partialStats.models['qwen-2b'],undefined);
assert(!core.complete({results:{},skipped:Object.fromEntries(core.models.map(m=>[m.id,'未導入']))}));
console.log('比較集計・中央値・一致数・最速件数・不完全回の除外を確認しました。');

const chosen={selected_models:['qwen-0.8b'],results:partial.results};assert(core.complete(chosen));assert.equal(core.accumulate(null,chosen).models['qwen-0.8b'].count,10);
assert(!core.complete({...chosen,selected_models:[]}));assert(!core.complete({...chosen,selected_models:['unknown']}));assert(!core.complete({...chosen,selected_models:['qwen-0.8b','qwen-0.8b']}));

for(const count of [1,30,100]){
 const variable={candidates:Array.from({length:count},(_,i)=>`候補${i+1}`),selected_models:['qwen-0.8b','qwen-2b'],results:{
  'qwen-0.8b':Array.from({length:count},()=>({ms:3,probability:.8})),
  'qwen-2b':Array.from({length:count},(_,i)=>({ms:6,probability:i%2?.2:.8}))
 }};
 assert(core.complete(variable));assert.equal(core.candidateCount(variable),count);assert.equal(core.compare(variable).agreement,Math.ceil(count/2));assert.equal(core.compare(variable).wins['qwen-0.8b'],count);
 const accumulated=core.accumulate(core.accumulate(null,variable),variable);assert.equal(accumulated.comparison_items,count*2);assert.equal(accumulated.models['qwen-2b'].count,count*2);
 const one={...variable,selected_models:['qwen-0.8b'],results:{'qwen-0.8b':variable.results['qwen-0.8b']}};assert.equal(core.accumulate(null,one).comparison_items,0);
 variable.results['qwen-2b'].pop();assert(!core.complete(variable));
}
assert.equal(core.candidateCount(run),10);assert(!core.complete({...chosen,candidates:[]}));assert(!core.complete({...chosen,candidates:Array(101).fill('物')}));
const legacy={runs:2,comparisons:2,agreement:18,models:{'qwen-0.8b':{count:20,totalMs:200,yes:20,probabilitySum:18,wins:20}}};
const single={candidates:['物'],selected_models:['qwen-0.8b','qwen-2b'],results:{'qwen-0.8b':[{ms:1,probability:.8}],'qwen-2b':[{ms:2,probability:.8}]}};
assert.equal(core.accumulate(legacy,single).comparison_items,21);assert.equal(core.accumulate(legacy,single).agreement,19);
console.log('1/30/100件の一致数・最速件数・集計分母・旧10件累積からの移行を確認しました。');

function rankingRun(totals){return {
 candidates:['犬','猫'],selected_models:core.models.map(model=>model.id),status:'完了',
 results:Object.fromEntries(core.models.map((model,index)=>[model.id,[0,1].map(()=>({ms:index+1,...(model.cloud?{verdict:true}:{probability:.9})}))])),
 ...(totals?{query_totals:Object.fromEntries(core.models.map((model,index)=>[model.id,{total_ms:totals[index],complete:true}]))}:{})
};}
const wallTimeRun=rankingRun([100,60,70,90]),untouched=JSON.stringify(wallTimeRun);
assert.deepEqual(core.rankings(wallTimeRun),[
 {id:'qwen-2b',totalMs:60,rank:1},{id:'gemma-e2b',totalMs:70,rank:2},
 {id:'gpt-5.6-luna',totalMs:90,rank:3},{id:'qwen-0.8b',totalMs:100,rank:4}
]);
assert.equal(JSON.stringify(wallTimeRun),untouched);
assert.deepEqual(core.rankings({...wallTimeRun,batch:true}),core.rankings(wallTimeRun));
assert.deepEqual(core.rankings(rankingRun([0,0,8,12])).map(item=>item.rank),[1,1,3,4]);
assert.deepEqual(core.rankings(rankingRun([10,10,10,10])).map(item=>item.rank),[1,1,1,1]);
assert.deepEqual(core.rankings(rankingRun()).map(item=>[item.totalMs,item.rank]),[[2,1],[4,2],[6,3],[8,4]]);
const partlyLegacy=rankingRun([100,60,70,90]);delete partlyLegacy.query_totals['qwen-0.8b'];
assert.deepEqual(core.rankings(partlyLegacy)[0],{id:'qwen-0.8b',totalMs:2,rank:1});
for(const invalid of [null,{}, {complete:false,total_ms:1},{complete:'true',total_ms:1},
 {complete:true,total_ms:NaN},{complete:true,total_ms:Infinity},{complete:true,total_ms:-1},{complete:true,total_ms:'1'}]){
 const value=rankingRun([100,60,70,90]);value.query_totals['qwen-0.8b']=invalid;
 assert(!core.rankings(value).some(item=>item.id==='qwen-0.8b'));
}
const failed=rankingRun([100,60,70,90]);failed.results['qwen-0.8b'].pop();failed.skipped={'qwen-2b':'応答失敗'};failed.results['gemma-e2b'][0]=null;
assert.deepEqual(core.rankings(failed),[{id:'gpt-5.6-luna',totalMs:90,rank:1}]);
failed.skipped['gpt-5.6-luna']='計測不能';assert.deepEqual(core.rankings(failed),[]);
assert.deepEqual(core.rankings(null),[]);assert.deepEqual(core.rankings({results:{}}),[]);
assert.deepEqual(core.rankings({...wallTimeRun,candidates:[]}),[]);
assert.deepEqual(core.rankings({...wallTimeRun,selected_models:['unknown']}),[]);
console.log('合計時間による順位・個別/一括・同順位・旧記録・不完全/計測不能の除外を確認しました。');

assert.equal(core.hasMismatch([{probability:.5},{verdict:true}]),false);
assert.equal(core.hasMismatch([{probability:.49},{verdict:false}]),false);
assert.equal(core.hasMismatch([{probability:.5},{probability:.49}]),true);
assert.equal(core.hasMismatch([{verdict:false},{verdict:true}]),true);
assert.equal(core.hasMismatch([{probability:.9}],'ではありません'),true);
assert.equal(core.hasMismatch([{probability:.1}],'です'),true);
assert.equal(core.hasMismatch([{probability:.9}],'です'),false);
assert.equal(core.hasMismatch([{probability:.1}],'ではありません'),false);
for(const expected of ['未評価','判断困難','理由だけの補足','',undefined]){
 assert.equal(core.hasMismatch([{verdict:true}],expected),false);
 assert.equal(core.hasMismatch([{verdict:false},{verdict:true}],expected),true);
}
const invalidPredictions=[undefined,null,{}, {probability:NaN},{probability:Infinity},{probability:-.1},{probability:1.1},{probability:'0.9'},{verdict:'false'}];
assert.equal(core.hasMismatch(invalidPredictions),false);
assert.equal(core.hasMismatch(invalidPredictions,'です'),false);
assert.equal(core.hasMismatch(invalidPredictions,'ではありません'),false);
assert.equal(core.hasMismatch([...invalidPredictions,{verdict:false}],'です'),true);
assert.equal(core.hasMismatch([],'です'),false);
assert.equal(core.hasMismatch([],'ではありません'),false);
console.log('モデル間・ユーザー評価との不一致、判断困難/無効値の除外を確認しました。');
