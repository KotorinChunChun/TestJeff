// ページの実行処理と共通承認処理を実コードのまま検証する。描画とAPIだけを模擬化する。
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),source=name=>fs.readFileSync(path.join(root,'src',name),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const ids=['qwen-2b','gemma-e2b'],slots=[...ids,'',''],count=10,token='test-only-approval-not-for-records';
const apiIds=Object.fromEntries(require('../src/battle-core.js').models.map(model=>[model.id,model.api]));

class Element {
 constructor(tag='div'){
  this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.style={};this.attributes={};this.className='';this.disabled=false;this.open=false;
  this.classList={add:(...names)=>this.classes(names,true),remove:(...names)=>this.classes(names,false),toggle:(name,force)=>{const add=force??!this.className.split(' ').includes(name);this.classes([name],add);return add;}};
 }
 classes(names,add){const values=new Set(this.className.split(' ').filter(Boolean));for(const name of names)add?values.add(name):values.delete(name);this.className=[...values].join(' ');}
 set textContent(value){this.text=String(value);this.replaceChildren();}
 get textContent(){return (this.text||'')+this.children.map(child=>child.textContent).join('');}
 set value(value){this.inputValue=String(value);}
 get value(){return this.inputValue??(this.tagName==='SELECT'?this.children[0]?.value:'')??'';}
 append(...children){for(const child of children){if(child.parent)child.remove();child.parent=this;this.children.push(child);}}
 replaceChildren(...children){for(const child of this.children)child.parent=null;this.children=[];this.append(...children);}
 insertBefore(child,before){child.remove();const index=this.children.indexOf(before);child.parent=this;this.children.splice(index<0?this.children.length:index,0,child);}
 remove(){if(this.parent){this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}}
 get childElementCount(){return this.children.length;}
 get firstChild(){return this.children[0];}
 setAttribute(key,value){this.attributes[key]=String(value);}
 querySelectorAll(){return [];}
 focus(){}
 close(){this.open=false;this.onclose?.();}
}

async function scenario({page,batch=false,reverse=false,failFirst=false,cancel=false}){
 const html=source(page+'.html'),elements=new Map([...html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"/g)].map(match=>[match[2],new Element(match[1])]));
 const get=id=>elements.get(id),headers=Array.from({length:6},()=>new Element('th'));
 for(const id of ['fds-approval','fds-approval-target','fds-approval-reason','fds-approval-action','fds-approval-list','fds-approval-cancel'])elements.set(id,new Element(id==='fds-approval'?'dialog':'div'));
 const descendants=node=>[node,...node.children.flatMap(descendants)];
 const document={readyState:'complete',getElementById:get,createElement:tag=>new Element(tag),createTextNode:text=>{const node=new Element('#text');node.textContent=text;return node;},
  querySelectorAll:selector=>selector==='thead th'?headers:[...elements.values(),...headers].flatMap(descendants).filter(node=>selector.startsWith('.')&&node.className.split(' ').includes(selector.slice(1)))};
 const storage=new Map([
  ['testjeff-connection-v1',JSON.stringify({mode:'fds',host:'mock.invalid',port:8767,device:'cpu',local_device:'cpu',auto_unload:true})],
  ['testjeff-battle-slots',JSON.stringify(slots)],['testjeff-battle-batch',String(batch)],
  ['testjeff-query-comparison-inputs-v1',JSON.stringify({target:'動物',candidates:Array.from({length:count},(_,i)=>'候補'+i),count,slots})],
  ['testjeff-query-comparison-sequence-v1',reverse?'1':'0']]);
 get('target').value='動物';get('candidate-count').value=String(count);if(get('sort'))get('sort').value='name';
 const events=[],records=[],listeners=new Map(),gates=[];let loaded=null,loading=false,requestId=0,approvalCount=0;
 const capabilities=()=>ids.map(id=>({id:apiIds[id],local_id:id,installed:true,available:loaded===id,loadable:true,load_allowed:true,devices:['cpu'],modalities:['text'],loaded_devices:loaded===id?['cpu']:[]}));
 const state=()=>({ready:!!loaded,selected:loaded||ids[0],backend:'fds',device:'cpu',revision:'mock-revision',devices:['cpu'],capabilities:capabilities()});
 const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 const execution=id=>({backend:'fds',model:apiIds[id],device:'cpu',revision:'mock-revision'});
 const originalFetch=async(input,options={})=>{
  const url=new URL(input,'http://mock.invalid:8765'),body=options.body?JSON.parse(options.body):null;
  switch(url.pathname){
   case '/testjeff/nouns':return response([{words:Array.from({length:120},(_,i)=>'候補'+i)}]);
   case '/testjeff/abstract-nouns':return response(['動物','道具']);
   case '/health':return response({authentication:false});
   case '/testjeff/status':return response(state());
   case '/testjeff/model':{
    assert.equal(options.method,'POST');assert.equal(loading,false,'準備操作を並列に送らない');assert(ids.includes(body.model));
    events.push(['prepare',body.model,!!body.approval_token]);
    if(failFirst&&body.model===ids[0])return response({detail:{code:'load_not_allowed',message:'模擬ロード拒否'}},403);
    if(loaded&&loaded!==body.model&&!body.approval_token)return response({detail:{code:'approval_required',message:'解放確認',approval:{token,action:'load',model:body.model,device:'cpu',unload:[{model:loaded,device:'cpu'}],reason:'空き容量不足',generation:1}}},409);
    if(body.approval_token)assert.equal(body.approval_token,token);
    loading=true;await new Promise(resolve=>gates.push({model:body.model,resolve}));loading=false;loaded=body.model;events.push(['ready',loaded]);
    return response({...state(),management:{success:true,model:loaded,device:'cpu',load_ms:5}});
   }
   case '/v1/systemone':
   case '/testjeff/battle-batch':{
    const id=url.pathname==='/v1/systemone'?ids.find(id=>apiIds[id]===body.model):body.model;
    assert.equal(loading,false,'準備応答前に推論を送らない');assert.equal(id,loaded,'実際に準備が完了したモデルだけを推論する');
    events.push([url.pathname==='/v1/systemone'?'single':'batch',id]);
    if(url.pathname==='/v1/systemone')return response({model:apiIds[id],answers:{判定:{noul:.8}},execution:execution(id)});
    assert.equal(body.candidates.length,count);return response({results:body.candidates.map(()=>({probability:.8,execution:execution(id)}))});
   }
   case '/testjeff/battle-runs':
    if(!body)return response({rows:[],next_before:null});
    records.push(body);return response({id:records.length,run_id:body.run.id});
   default:throw Error('想定外API: '+url.pathname);
  }
 };
 get('fds-approval').showModal=()=>{get('fds-approval').open=true;approvalCount++;events.push(['approval',loaded]);setImmediate(()=>get(cancel?'fds-approval-cancel':'fds-approval-action').onclick());};
 const context=vm.createContext({document,URL,Headers,Response,performance,crypto:{randomUUID:()=>`mock-run-${++requestId}`},navigator:{language:'ja',userAgent:'vm-test'},location:{href:'http://mock.invalid:8765/'+page,origin:'http://mock.invalid:8765'},
  localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},
  Event:class{constructor(type){this.type=type;}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},
  addEventListener:(type,fn)=>{if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);},dispatchEvent:event=>{for(const listener of listeners.get(event.type)||[])listener(event);},
  setInterval:()=>1,clearInterval:()=>{},setTimeout,clearTimeout,AbortSignal:{timeout:()=>new AbortController().signal},fetch:originalFetch,
  NounCombo:{attach:()=>({destroy(){},setDisabled(){}})}});
 context.window=context;
 for(const file of ['connection.js','nouns-core.js','battle-core.js','query-comparison-core.js'])vm.runInContext(source(file),context,{filename:file});
 // ヘッダー配置は別のブラウザー試験が担当。初期接続済みの状態から実行処理を検証する。
 context.TestJeffConnection.capabilities=state();
 vm.runInContext(source(page+'.js'),context,{filename:page+'.js'});
 for(let i=0;i<100&&!get('progress').textContent.startsWith('同じ');i++)await tick();
 assert.equal(get('error').textContent,'','ページの初期化');assert.match(get('progress').textContent,/^同じ/);
 let done=false,failure;const running=Promise.resolve(get('start').onclick()).then(()=>{done=true;},error=>{failure=error;done=true;});
 for(let i=0;i<1000&&!done;i++){
  await tick();const gate=gates.shift();if(!gate)continue;
  const before=events.length;await tick();assert.equal(events.length,before,'準備応答を保留している間は後続のAPIを送らない');gate.resolve();
 }
 assert(done,'模擬実行が終了する');await running;if(failure)throw failure;
 assert.equal(get('error').textContent,'');assert.equal(records.length,page==='battle'?1:2);
 const succeeded=failFirst?[ids[1]]:cancel?[ids[0]]:ids;
 for(const record of records){
  const run=record.run;assert.equal(run.status,cancel?'中止':'完了');assert.deepEqual(Object.keys(run.results),succeeded);
  for(const id of succeeded){assert.equal(run.results[id].length,count);assert.equal(run.query_totals[id].complete,true);assert.equal(run.execution[id].management.load_ms,5);}
  if(failFirst)assert.equal(run.skipped[ids[0]],'模擬ロード拒否');
  if(cancel)assert.match(run.skipped[ids[1]],/取り消/);
  assert.equal(record.connection.auto_unload,true);assert(!JSON.stringify(record).includes(token),'承認トークンを保存しない');
 }
 assert.equal(approvalCount,failFirst?0:1);
 assert.deepEqual(events.filter(event=>event[0]==='ready').map(event=>event[1]),succeeded);
 for(const id of succeeded){
  const measured=events.filter(event=>['single','batch'].includes(event[0])&&event[1]===id).map(event=>event[0]);
  const single=Array(count+1).fill('single'),batched=['single','batch'];
  assert.deepEqual(measured,page==='battle'?(batch?batched:single):reverse?[...batched,...single]:[...single,...batched]);
 }
 // 完了後のFDS復元も含め、想定の準備要求以外が追加されないことを確認する。
 assert.deepEqual(events.filter(event=>event[0]==='prepare'),[
  ['prepare',ids[0],false],['prepare',ids[1],false],...(!failFirst&&!cancel?[['prepare',ids[1],true]]:[])]);
 const firstFinished=Math.max(...events.map((event,i)=>['single','batch'].includes(event[0])&&event[1]===ids[0]?i:-1));
 const secondPrepare=events.findIndex(event=>event[0]==='prepare'&&event[1]===ids[1]);assert(firstFinished<secondPrepare,'前モデルの全計測が終わってから次モデルを準備する');
 return {records,events};
}

(async()=>{
 for(const batch of [false,true]){await scenario({page:'battle',batch});await scenario({page:'battle',batch,failFirst:true});}
 for(const reverse of [false,true]){await scenario({page:'query-comparison',reverse});await scenario({page:'query-comparison',reverse,failFirst:true});}
 await scenario({page:'battle',cancel:true});await scenario({page:'query-comparison',cancel:true});
 console.log('FDS順次実行: 2モデルの準備完了待ち、予備判定、個別／一括、方式順反転、解放承認、準備失敗後の継続、取消停止、復元ロードなしを確認');
})().catch(error=>{console.error(error);process.exitCode=1;});
