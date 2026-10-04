const assert=require('node:assert/strict'),core=require('../src/query-comparison-core.js');
function records(count=10){
 const state='各対象の名詞を一般的な意味で独立に判定してください。';
 const question=index=>({type:'noul',instructions:`対象「候補${index}」は「動物」に当てはまりますか？`,criteria:{true:'当てはまる',false:'当てはまらない'}});
 const create=(total,batch)=>({connection:{mode:'local',local_device:'cpu',key:'local:cpu'},run:{target:'動物',candidates:Array.from({length:count},(_,i)=>'候補'+i),selected_models:['qwen-2b'],batch,
  results:{'qwen-2b':Array.from({length:count},(_,index)=>({probability:.9,ms:total/count,...(!batch?{reproduction:{request:{state,questions:{判定:question(index)}}}}:{})}))},
  parameters:{noun_protocol:'noun-v2'},execution:{'qwen-2b':{backend:'local',model:'qwen',device:'cpu',revision:'固定版'}},query_totals:{'qwen-2b':{total_ms:total,count,complete:true}}}});
 const result={single:create(100,false),batch:create(50,true)},batches=[];
 for(let offset=0;offset<count;offset+=8){const amount=Math.min(8,count-offset);batches.push({offset,count:amount,reproduction:{request:{state,orders:1,images:[],questions:Object.fromEntries(Array.from({length:amount},(_,index)=>['item_'+(offset+index),question(offset+index)]))}}});}
 result.batch.run.parameters.batch_execution={'qwen-2b':{batches}};return result;
}
function fdsRecords(count=10,orders=1){
 const result=records(count);
 const addSubmitted=reproduction=>{
  const request=reproduction.request;request.orders=orders;
  reproduction.submitted_requests=Array.from({length:orders},(_,turn)=>{
   const questions=structuredClone(request.questions);
   for(const question of Object.values(questions))if(orders===2){
    question.type='choice';const choices=[['option_0',question.criteria.false],['option_1',question.criteria.true]];
    question.criteria=Object.fromEntries(turn?choices.reverse():choices);
   }
   return {model:'jeff-qwen3.5-2b',device:'cpu',state:request.state,questions,images:request.images??[],timeout_seconds:120,priority:'normal',auto_unload:true};
  });
 };
 for(const mode of ['single','batch']){
  result[mode].connection={mode:'fds',host:'127.0.0.1',port:8767,device:'cpu',key:'fds:cpu'};
  result[mode].run.execution['qwen-2b'].backend='fds';
 }
 for(const item of result.single.run.results['qwen-2b'])addSubmitted(item.reproduction);
 for(const batch of result.batch.run.parameters.batch_execution['qwen-2b'].batches)addSubmitted(batch.reproduction);
 return result;
}
for(const count of [1,10,30,100]){const value=core.metrics(records(count))['qwen-2b'];assert.equal(value.reduction_percent,50);assert.equal(value.speedup,2);}
let pair=records();pair.batch.run.query_totals['qwen-2b'].complete=false;assert.equal(core.metrics(pair)['qwen-2b'].comparable,false);
pair=records();pair.batch.run.candidates[0]='別入力';assert.equal(core.metrics(pair)['qwen-2b'].comparable,false);
pair=records();pair.batch.run.execution['qwen-2b'].revision='別の版';assert.equal(core.metrics(pair)['qwen-2b'].execution_condition,'different');
pair=records();delete pair.batch.run.execution['qwen-2b'].revision;assert.equal(core.metrics(pair)['qwen-2b'].execution_condition,'unknown');
pair=records();for(const mode of ['single','batch'])pair[mode].connection={mode:'fds',host:mode==='single'?'127.0.0.1':'127.0.0.2',port:8767,device:'cpu'};assert.equal(core.metrics(pair)['qwen-2b'].comparable,false);
assert.equal(core.executionCondition({backend:'local',precision:'float16'},{backend:'local',precision:'float32'}),'different');
const luna={backend:'codex_cli',model:'gpt-5.6-luna',source:'Codex CLI',reasoning:'low',executable:{sha256:'固定CLI'},timeout_seconds:90,options:{sandbox:'read-only',shell_tool:false},device:null,revision:null};
assert.equal(core.executionCondition(luna,{...luna}),'verified');assert.equal(core.executionCondition(luna,{...luna,reasoning:'high'}),'different');assert.equal(core.executionCondition(luna,{...luna,executable:{sha256:null}}),'unknown');
const batchRequest=pair=>pair.batch.run.parameters.batch_execution['qwen-2b'].batches[0].reproduction.request;
const prompt=pair=>core.promptCondition(pair.single.run,pair.batch.run,'qwen-2b');
pair=records();assert.equal(prompt(pair),'verified','質問IDの判定/item_Nとorders/imagesの省略既定値は一致扱い');
const first=batchRequest(pair).questions.item_0;
batchRequest(pair).questions.item_0={criteria:first.criteria,instructions:first.instructions,type:first.type};
assert.equal(prompt(pair),'verified','質問のフィールド順は入力差としない');
{
 const reordered=records(1),single=reordered.single.run.results['qwen-2b'][0].reproduction.request,batch=batchRequest(reordered);
 single.state={前:'猫',後:'犬'};batch.state={後:'犬',前:'猫'};
 assert.equal(prompt(reordered),'different','stateオブジェクトの順序でプロンプトの文字列が変わる');
 single.state=batch.state='同じ状態';single.questions.判定.type=batch.questions.item_0.type='choice';
 single.questions.判定.criteria={a:'猫',b:'犬'};batch.questions.item_0.criteria={b:'犬',a:'猫'};
 assert.equal(prompt(reordered),'different','choiceの選択肢順を失わない');
}
delete pair.single.run.parameters.noun_protocol;delete pair.batch.run.parameters.noun_protocol;
assert.equal(prompt(pair),'verified','保存マーカーではなく実際の要求を照合');
for(const [label,change]of[
 ['state',request=>{request.state='別の状態';}],
 ['type',request=>{request.questions.item_0.type='choice';}],
 ['instructions',request=>{request.questions.item_0.instructions='別の質問';}],
 ['criteria',request=>{request.questions.item_0.criteria.true='別の意味';}],
 ['orders',request=>{request.orders=2;}],
 ['images',request=>{request.images=[{sha256:'別の画像',embedded:false}];}],
 ['候補順',request=>{request.questions=Object.fromEntries(Object.entries(request.questions).reverse());}]
]){
 pair=records();change(batchRequest(pair));const metric=core.metrics(pair)['qwen-2b'];
 assert.equal(metric.prompt_condition,'different',label);assert.equal(metric.comparable,false,label);
 assert.equal(metric.reduction_percent,null,label);assert.equal(metric.speedup,null,label);
 assert.equal(metric.single_total_ms,100);assert.equal(metric.batch_total_ms,50);
}
for(const [label,change]of[
 ['単件証跡なし',value=>{delete value.single.run.results['qwen-2b'][0].reproduction;}],
 ['一括証跡なし',value=>{delete value.batch.run.parameters.batch_execution;}],
 ['stateなし',value=>{delete batchRequest(value).state;}],
 ['questionなし',value=>{delete batchRequest(value).questions;}],
 ['instructionsなし',value=>{delete batchRequest(value).questions.item_0.instructions;}],
 ['criteriaなし',value=>{delete batchRequest(value).questions.item_0.criteria;}],
 ['単件証跡不足',value=>{value.single.run.results['qwen-2b'].pop();}],
 ['単件証跡過剰',value=>{value.single.run.results['qwen-2b'].push(value.single.run.results['qwen-2b'][0]);}],
 ['一括証跡不足',value=>{delete batchRequest(value).questions.item_0;}],
 ['一括証跡過剰',value=>{batchRequest(value).questions.extra=batchRequest(value).questions.item_0;}],
 ['候補数不一致',value=>{value.batch.run.candidates.pop();}],
 ['一括offset矛盾',value=>{value.batch.run.parameters.batch_execution['qwen-2b'].batches[0].offset=1;}],
 ['不正な既定値',value=>{batchRequest(value).orders=null;}]
]){
 pair=records();change(pair);const metric=core.metrics(pair)['qwen-2b'];
 assert.equal(metric.prompt_condition,'unknown',label);assert.equal(metric.comparable,false,label);
 assert.equal(metric.single_total_ms,100);assert.equal(metric.batch_total_ms,50);
}
pair=records();for(const item of pair.single.run.results['qwen-2b'])delete item.reproduction;
delete pair.batch.run.parameters.batch_execution;
assert.equal(prompt(pair),'unknown','noun-v2マーカーだけの旧記録を一致扱いにしない');
assert.equal(core.metrics(pair)['qwen-2b'].reduction_percent,null);
const firstSubmitted=pair=>pair.batch.run.parameters.batch_execution['qwen-2b'].batches[0].reproduction.submitted_requests;
for(const orders of [1,2]){
 pair=fdsRecords(10,orders);assert.equal(prompt(pair),'verified',`FDS転送${orders}回の実質問が候補ごとに一致`);
 assert.equal(core.metrics(pair)['qwen-2b'].comparable,true);assert.equal(core.metrics(pair)['qwen-2b'].speedup,2);
 assert.equal(firstSubmitted(pair).length,orders);assert.equal(Object.hasOwn(firstSubmitted(pair)[0],'orders'),false,'転送側のorders省略を元のordersとは混同しない');
}
for(const [label,orders,change]of[
 ['転送stateのみ不一致',1,requests=>{requests[0].state='転送時だけ異なる状態';}],
 ['転送instructionsのみ不一致',1,requests=>{requests[0].questions.item_0.instructions='転送時だけ異なる質問';}],
 ['転送criteriaのみ不一致',1,requests=>{requests[0].questions.item_0.criteria.true='転送時だけ異なる意味';}],
 ['転送画像のみ不一致',1,requests=>{requests[0].images=[{sha256:'別の画像'}];}],
 ['転送モデルのみ不一致',1,requests=>{requests[0].model='別のモデル';}],
 ['転送deviceのみ不一致',1,requests=>{requests[0].device='cuda:0';}],
 ['2回目の転送文面不一致',2,requests=>{requests[1].questions.item_0.instructions='2回目だけ異なる質問';}],
 ['2回目のchoice順不一致',2,requests=>{requests[1].questions.item_0.criteria=Object.fromEntries(Object.entries(requests[1].questions.item_0.criteria).reverse());}]
]){
 pair=fdsRecords(10,orders);change(firstSubmitted(pair));const metric=core.metrics(pair)['qwen-2b'];
 assert.equal(metric.prompt_condition,'different',label);assert.equal(metric.comparable,false,label);assert.equal(metric.speedup,null,label);
 assert.equal(metric.single_total_ms,100);assert.equal(metric.batch_total_ms,50);
}
for(const [label,orders,change]of[
 ['単件の転送証跡なし',1,value=>{delete value.single.run.results['qwen-2b'][0].reproduction.submitted_requests;}],
 ['一括の転送証跡なし',1,value=>{delete value.batch.run.parameters.batch_execution['qwen-2b'].batches[0].reproduction.submitted_requests;}],
 ['後続chunkの転送証跡なし',1,value=>{delete value.batch.run.parameters.batch_execution['qwen-2b'].batches[1].reproduction.submitted_requests;}],
 ['転送ターン過剰',1,value=>{firstSubmitted(value).push(firstSubmitted(value)[0]);}],
 ['転送質問数不足',1,value=>{delete firstSubmitted(value)[0].questions.item_0;}],
 ['転送質問数過剰',1,value=>{firstSubmitted(value)[0].questions.extra=firstSubmitted(value)[0].questions.item_0;}],
 ['単件転送質問数過剰',1,value=>{const request=value.single.run.results['qwen-2b'][0].reproduction.submitted_requests[0];request.questions.extra=request.questions.判定;}],
 ['2回目の転送証跡なし',2,value=>{firstSubmitted(value).pop();}],
 ['単件2回目の転送証跡なし',2,value=>{value.single.run.results['qwen-2b'][0].reproduction.submitted_requests.pop();}],
 ['2回目の質問数不足',2,value=>{delete firstSubmitted(value)[1].questions.item_0;}]
]){
 pair=fdsRecords(10,orders);change(pair);const metric=core.metrics(pair)['qwen-2b'];
 assert.equal(metric.prompt_condition,'unknown',label);assert.equal(metric.comparable,false,label);assert.equal(metric.reduction_percent,null,label);
 assert.equal(metric.single_total_ms,100);assert.equal(metric.batch_total_ms,50);
}
pair=records();for(const mode of ['single','batch']){
 const run=pair[mode].run;run.selected_models=['gpt-5.6-luna'];
 run.results={'gpt-5.6-luna':run.results['qwen-2b'].map(item=>({ms:item.ms,verdict:true}))};
 run.query_totals={'gpt-5.6-luna':run.query_totals['qwen-2b']};run.execution={'gpt-5.6-luna':{...luna}};run.parameters={};
}
assert.equal(core.metrics(pair)['gpt-5.6-luna'].prompt_condition,'not_applicable');
assert.equal(core.metrics(pair)['gpt-5.6-luna'].comparable,true,'Lunaは公開実行条件の検査を維持');
pair.batch.run.execution['gpt-5.6-luna'].reasoning='high';assert.equal(core.metrics(pair)['gpt-5.6-luna'].comparable,false);
console.log('問い合わせ速度比較: 件数・実質問とFDS各転送の一致/差異/証跡不足・合計保持・実行条件・未完了・Luna公開設定を確認');
