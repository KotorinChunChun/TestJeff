const assert=require('node:assert/strict'),core=require('../src/query-comparison-core.js');
function records(count=10){const create=(total,batch)=>({connection:{mode:'local',local_device:'cpu',key:'local:cpu'},run:{target:'動物',candidates:Array.from({length:count},(_,i)=>'候補'+i),selected_models:['qwen-2b'],batch,results:{'qwen-2b':Array.from({length:count},()=>({probability:.9,ms:total/count}))},execution:{'qwen-2b':{backend:'local',model:'qwen',device:'cpu',revision:'固定版'}},query_totals:{'qwen-2b':{total_ms:total,count,complete:true}}}});return {single:create(100,false),batch:create(50,true)};}
for(const count of [1,10,30,100]){const value=core.metrics(records(count))['qwen-2b'];assert.equal(value.reduction_percent,50);assert.equal(value.speedup,2);}
let pair=records();pair.batch.run.query_totals['qwen-2b'].complete=false;assert.equal(core.metrics(pair)['qwen-2b'].comparable,false);
pair=records();pair.batch.run.candidates[0]='別入力';assert.equal(core.metrics(pair)['qwen-2b'].comparable,false);
pair=records();pair.batch.run.execution['qwen-2b'].revision='別の版';assert.equal(core.metrics(pair)['qwen-2b'].execution_condition,'different');
pair=records();delete pair.batch.run.execution['qwen-2b'].revision;assert.equal(core.metrics(pair)['qwen-2b'].execution_condition,'unknown');
pair=records();for(const mode of ['single','batch'])pair[mode].connection={mode:'fds',host:mode==='single'?'127.0.0.1':'127.0.0.2',port:8767,device:'cpu'};assert.equal(core.metrics(pair)['qwen-2b'].comparable,false);
assert.equal(core.executionCondition({backend:'local',precision:'float16'},{backend:'local',precision:'float32'}),'different');
const luna={backend:'codex_cli',model:'gpt-5.6-luna',source:'Codex CLI',reasoning:'low',executable:{sha256:'固定CLI'},timeout_seconds:90,options:{sandbox:'read-only',shell_tool:false},device:null,revision:null};
assert.equal(core.executionCondition(luna,{...luna}),'verified');assert.equal(core.executionCondition(luna,{...luna,reasoning:'high'}),'different');assert.equal(core.executionCondition(luna,{...luna,executable:{sha256:null}}),'unknown');
console.log('問い合わせ速度比較: 件数・同一入力・実行条件・未完了・Luna公開設定を確認');
