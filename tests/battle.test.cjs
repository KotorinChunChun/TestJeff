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
