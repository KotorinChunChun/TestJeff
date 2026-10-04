'use strict';
const $=id=>document.getElementById(id), models=BattleCore.models, storageBase='testjeff-battle-v2'+(window.TestJeffConnection?.config.mode==='fds'?':'+window.TestJeffConnection.key:'');
let words=[],targets=[],busy=false,stop=false,run=null,stats=null;
const rows=[];
$('batch-mode').checked=localStorage.getItem('testjeff-battle-batch')==='true';
let storageKey=storageBase+($('batch-mode').checked?':batch':'');
let pendingKnowledge=null,knowledgeSaved=false;
function loadStats(){stats=null;try{
  const saved=JSON.parse(localStorage.getItem(storageKey)||'null');
  if(saved&&Number.isInteger(saved.runs)&&saved.runs>=0&&Number.isFinite(saved.agreement)&&saved.agreement>=0&&saved.agreement<=saved.runs*10&&models.every(m=>{
    const v=saved.models?.[m.id];return !v||v.count>0&&v.count<=saved.runs*10&&v.count%10===0&&['totalMs','yes','probabilitySum','wins'].every(k=>Number.isFinite(v[k])&&v[k]>=0)&&v.yes<=v.count&&v.probabilitySum<=v.count&&v.wins<=v.count;
  }))stats=saved;
}catch{}}
loadStats();
$('batch-mode').onchange=()=>{localStorage.setItem('testjeff-battle-batch',String($('batch-mode').checked));storageKey=storageBase+($('batch-mode').checked?':batch':'');loadStats();resetResults();};
function error(text=''){$('error').textContent=text;}
function save(){try{localStorage.setItem(storageKey,JSON.stringify(stats));}catch{error('累積値を保存できませんでした。画面を閉じるまでは保持します。');}}
function setBusy(value){window.TestJeffBusy=value;window.dispatchEvent(new Event('testjeff-busy'));busy=value;for(const id of ['target','random','start','reset','key','batch-mode'])$(id).disabled=value;rows.forEach(r=>r.input.disabled=value);updateReviewControls();$('stop').classList.toggle('hidden',!value);$('stop').disabled=false;}
function element(tag,text,cls){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;}
function resetResults(){run=null;clearReviews();render();}
function createRows(values){
  rows.length=0;$('rows').replaceChildren();
  values.forEach((word,i)=>{const tr=element('tr'),td=element('td'),input=element('input');input.value=word;input.maxLength=80;input.setAttribute('list','nouns');input.setAttribute('aria-label',`候補${i+1}`);input.oninput=resetResults;td.append(input);tr.append(td);const cells=models.map(()=>{const cell=element('td','未評価');tr.append(cell);return cell;});const review=element('td',undefined,'review'),expected=element('select'),comment=element('textarea');expected.setAttribute('aria-label',`ユーザー判定${i+1}`);for(const value of ['未評価','です','ではありません','判断困難']){const option=element('option',value);option.value=value;expected.append(option);}comment.maxLength=1000;comment.placeholder='理由・補足';comment.setAttribute('aria-label',`評価コメント${i+1}`);expected.onchange=reviewChanged;comment.oninput=reviewChanged;review.append(expected,comment);tr.append(review);rows.push({tr,input,cells,expected,comment,index:i});$('rows').append(tr);});resetResults();
}
function render(){
  const finished=run&&BattleCore.complete(run),comparison=finished?BattleCore.compare(run):null;
  const averages=models.filter(m=>run?.results[m.id]?.length===10).map(m=>({id:m.id,mean:BattleCore.summarize(run.results[m.id]).mean}));
  const ordered=[...averages].sort((a,b)=>a.mean-b.mean);
  $('summary').replaceChildren();
  for(const m of models){
    const items=run?.results[m.id]||[],s=items.length?BattleCore.summarize(items):null,old=stats?.models[m.id];
    const card=element('section',undefined,'model-card');card.append(element('h2',m.name));
    const metrics=element('div',undefined,'metrics');
    for(const [label,value] of [[run?.batch?'平均換算/件':'平均応答',s?`${s.mean.toFixed(1)} ms`:'—'],['速度順位',finished&&s?`${ordered.findIndex(x=>x.mean===s.mean)+1}位`:'—'],[run?.batch?'10件全体':'中央値',s?`${(run?.batch?s.totalMs:s.median).toFixed(1)} ms`:'—'],['最速件数',comparison&&s&&comparison.agreement!==null?`${comparison.wins[m.id]} / 10`:'—']]){
      const part=element('div',label);part.append(element('strong',value));metrics.append(part);
    }
    if(run?.skipped?.[m.id])card.append(element('div','計測不能：'+run.skipped[m.id],'sub'));
    card.append(metrics,element('div',`判定 ${items.length}/10件・肯定 ${s?.yes||0}件・平均確率 ${m.cloud?'対象外':s?(s.probabilitySum/s.count*100).toFixed(1)+'%':'—'}`, 'sub'));
    if(m.cloud)card.append(element('div','Codex CLI・クラウド通信／起動込み・確率なし','sub'));
    const load=run?.loads[m.id];if(!m.cloud)card.append(element('div',`切り替え ${load===undefined?'—':(load/1000).toFixed(2)+'秒'}・GPU確保 ${Number.isFinite(run?.memory[m.id])?run.memory[m.id].toFixed(2)+' GiB':'—'}`,'sub'));
    card.append(element('div',`累積 ${old?.count||0}件・平均 ${old?.count?(old.totalMs/old.count).toFixed(1)+' ms':'—'}・最速 ${old?.wins||0}件`,'sub'));
    $('summary').append(card);
  }
  $('agreement').textContent=`判定一致 ${comparison&&comparison.agreement!==null?comparison.agreement+' / 10件':'—'}`;
  $('cumulative').textContent=`累積 ${stats?.runs||0}回・一致 ${stats?.agreement||0} / ${(stats?.comparisons??stats?.runs??0)*10}件`;
  $('export').disabled=!run;
  for(const row of rows){
    const values=models.map(m=>run?.results[m.id]?.[row.index]);
    const comparable=values.filter(Boolean);const full=finished&&comparable.length>=2,fastest=full?Math.min(...comparable.map(x=>x.ms)):null;
    row.difference=full&&!comparable.every(x=>BattleCore.positive(x)===BattleCore.positive(comparable[0]));
    row.tr.classList.toggle('mismatch',row.difference);
    values.forEach((item,j)=>{const cell=row.cells[j];cell.replaceChildren();if(!item){cell.textContent=run?.skipped?.[models[j].id]?'計測不能':'未評価';cell.title=run?.skipped?.[models[j].id]||'';return;}
      const isFastest=full&&item.ms===fastest;
      const box=element('div',undefined,isFastest?'answer-box fastest':'answer-box');
      if(isFastest)box.title='この候補で最速';
      const tone=BattleCore.positive(item)?'yes':'no';
      box.append(element('div',`「${run.candidates[row.index]}」は「${run.target}」${BattleCore.positive(item)?'です':'ではありません'}`,`result ${tone}`));
      const detail=element('div',undefined,'answer-detail');
      if(typeof item.probability==='number'){
        const probability=element('div',undefined,`probability ${tone}`);
        const track=element('span',undefined,'probability-track'),fill=element('span',undefined,'probability-fill');
        fill.style.width=`${item.probability*100}%`;track.append(fill);track.setAttribute('aria-hidden','true');
        probability.append(element('span',`${(item.probability*100).toFixed(1)}%`,'probability-value'),track);detail.append(probability);
      }
      detail.append(element('span',`${item.ms.toFixed(1)} ms${run.batch?"（平均換算）":""}`,'response-time'));
      box.append(detail);cell.append(box);
    });
  }
  sortRows();
  renderQuality();updateReviewControls();
}
function sortRows(){const mode=$('sort').value;[...rows].sort((a,b)=>(mode==='name'?a.input.value.localeCompare(b.input.value,'ja'):mode==='difference'?Number(b.difference)-Number(a.difference):0)||a.index-b.index).forEach(r=>$('rows').append(r.tr));}
$('sort').onchange=sortRows;
function reviewable(){return !!run&&run.status==='完了'&&BattleCore.complete(run);}
function annotations(){return rows.map(row=>({expected:row.expected.value,comment:row.comment.value.trim()}));}
function updateReviewControls(){const disabled=busy||!reviewable();rows.forEach(r=>{r.expected.disabled=disabled;r.comment.disabled=disabled;});$('save-knowledge').disabled=disabled||knowledgeSaved||!annotations().some(a=>a.expected!=='未評価'||a.comment);}
function clearReviews(){pendingKnowledge=null;knowledgeSaved=false;rows.forEach(r=>{r.expected.value='未評価';r.comment.value='';});$('knowledge-status').textContent='';}
function reviewChanged(){pendingKnowledge=null;knowledgeSaved=false;$('knowledge-status').textContent='未保存';renderQuality();updateReviewControls();}
function renderQuality(){
  document.querySelectorAll('.quality-score').forEach(node=>node.remove());
  if(!reviewable())return;
  const notes=annotations();models.forEach((m,j)=>{if(!run.results[m.id]?.length)return;let correct=0,total=0;notes.forEach((a,i)=>{if(a.expected==='です'||a.expected==='ではありません'){total++;if(BattleCore.positive(run.results[m.id][i])===(a.expected==='です'))correct++;}});$('summary').children[j].append(element('div',`ユーザー判定と一致 ${correct} / ${total}件${total?'（'+(correct/total*100).toFixed(1)+'%）':''}`,'sub quality-score'));});
}
$('save-knowledge').onclick=async()=>{
  if(busy||!reviewable())return;
  if(!pendingKnowledge)pendingKnowledge={event_id:crypto.randomUUID(),run:JSON.parse(JSON.stringify(run)),annotations:annotations()};
  const payload=pendingKnowledge;setBusy(true);$('stop').classList.add('hidden');$('knowledge-status').textContent='保存中';
  try{const saved=await api('/testjeff/knowledge',payload);if(saved.event_id!==payload.event_id)throw Error('保存内容を確認できませんでした。');knowledgeSaved=true;pendingKnowledge=null;$('knowledge-status').textContent='保存済み';}
  catch(e){$('knowledge-status').textContent=`保存失敗：${e.message}`;}
  finally{setBusy(false);}
};
$('download-knowledge').onclick=async()=>{
  const button=$('download-knowledge');button.disabled=true;
  try{const data=await api('/testjeff/knowledge');const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}));const a=element('a');a.href=url;a.download='品質評価ナレッジ.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){error(e.message);}finally{button.disabled=false;}
};

async function api(path,body){
  const headers={};if($('key').value)headers.Authorization=`Bearer ${$('key').value}`;if(body)headers['Content-Type']='application/json';
  const response=await fetch(path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});
  if(!response.ok){const detail=await response.json().catch(()=>({}));if(response.status===401)$('auth').classList.remove('hidden');throw Error(typeof detail.detail==='string'?detail.detail:response.status===401?'APIキーを入力してください。':`処理に失敗しました（${response.status}）。他の画面での評価・モデル切り替えが終わってから再実行してください。`);}
  return response.json();
}
async function predict(model,request){
  if(model.cloud){
    const start=performance.now(),data=await api('/testjeff/luna',{target:run.target,candidate:request.state.対象});
    if(data.model!==model.api||typeof data.verdict!=='boolean')throw Error('Lunaの応答が不正です。');
    return {verdict:data.verdict,ms:performance.now()-start,source:data.source,reasoning:data.reasoning,cli_ms:data.duration_ms,usage:data.usage};
  }
  const start=performance.now(),data=await api('/v1/systemone',{...request,model:model.api}),ms=performance.now()-start,p=data.answers?.判定?.noul;
  if(data.model!==model.api)throw Error('別の画面でモデルが変更されました。対戦をやり直してください。');
  if(typeof p!=='number'||!Number.isFinite(p)||p<0||p>1)throw Error('判定の応答が不正です。');
  return {probability:p,ms,execution:data.execution||null};
}
async function battle(){
  if(busy)return;error();let requests;
  const target=$('target').value.trim(),candidates=rows.map(r=>r.input.value.trim());
  try{requests=candidates.map(word=>NounCore.makeRequest(target,word));}catch(e){error(e.message);return;}
  clearReviews();setBusy(true);stop=false;let original=null;
  const local=models.filter(m=>!m.cloud),offset=(stats?.runs||0)%local.length,order=[...local.slice(offset),...local.slice(0,offset),...models.filter(m=>m.cloud)];
  run={batch:$('batch-mode').checked,id:crypto.randomUUID(),at:new Date().toISOString(),target,candidates,order:order.map(m=>m.id),results:{},skipped:{},loads:{},memory:{},revisions:{},status:'実行中'};render();
  try{
    try{original=(await api('/testjeff/status')).selected;}catch(e){run.connection_error=e.message;}
    for(const m of order){
      if(stop)break;
      try{
      const capability=window.TestJeffConnection?.capabilities?.capabilities?.find(item=>item.local_id===m.id);
      if(!m.cloud&&window.TestJeffConnection?.config.mode==='fds'&&capability&&!capability.available)throw Error(capability.unavailable_reason||'サーバーで利用できません');
      $('progress').textContent=`${m.name} 読み込み中`;
      if(!m.cloud){
      const start=performance.now(),state=await api('/testjeff/model',{model:m.id});
      run.loads[m.id]=performance.now()-start;run.revisions[m.id]=state.revision;
      if(!state.ready||state.selected!==m.id)throw Error('モデルを読み込めませんでした。');
      }
      if(stop)break;$('progress').textContent=`${m.name} 予備判定`;
      await predict(m,requests[0]);run.results[m.id]=[];
      if(run.batch){
        $('progress').textContent=`${m.name} 10件を一括判定中`;
        const started=performance.now(),data=await api('/testjeff/battle-batch',{model:m.id,target:run.target,candidates:run.candidates}),elapsed=performance.now()-started;
        if(!Array.isArray(data.results)||data.results.length!==10||!data.results.every(x=>m.cloud?typeof x.verdict==='boolean':Number.isFinite(x.probability)&&x.probability>=0&&x.probability<=1))throw Error('一括応答が不正です。');
        run.results[m.id]=data.results.map(x=>({...x,ms:elapsed/10,batch_total_ms:elapsed,timing_basis:'batch_average'}));render();
      }else for(let i=0;i<10&&!stop;i++){
        $('progress').textContent=`${m.name} ${i+1} / 10件`;
        run.results[m.id].push(await predict(m,requests[i]));render();
      }
      if(!m.cloud){
      const measured=await api('/testjeff/status');
      if(measured.selected!==m.id)throw Error('別の画面でモデルが変更されました。');
      run.memory[m.id]=measured.reserved_gib;
      }
      }catch(e){delete run.results[m.id];run.skipped[m.id]=e.message;}
      render();
    }
    if(stop){run.status='中止';}
    else if(BattleCore.complete(run)){run.status='完了';stats=BattleCore.accumulate(stats,run);save();}else run.status='計測不能';
  }catch(e){run.status='失敗';error(e.message);}
  finally{
    if(original){$('progress').textContent='元のモデルに戻しています';try{await api('/testjeff/model',{model:original});}catch(e){error(`元のモデルに戻せませんでした。${e.message}`);}}
    $('progress').textContent=run.status==='完了'?(Object.keys(run.skipped).length?`${BattleCore.measured(run).length}モデル計測完了・${Object.keys(run.skipped).length}モデル計測不能`:'40 / 40件完了'):`${run.status}・累積には加算していません`;
    setBusy(false);render();
  }
}
$('start').onclick=battle;
$('random').onclick=()=>{if(busy)return;const chosen=NounCore.draw(words,targets);$('target').value=chosen.target;createRows(chosen.candidates);battle();};
$('target').oninput=resetResults;
$('stop').onclick=()=>{stop=true;$('stop').disabled=true;$('progress').textContent='処理中の1件が終了したら中止します';};
$('reset').onclick=()=>{stats=null;save();render();};
$('export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({run,statistics:stats},null,2)],{type:'application/json'}));const a=element('a');a.href=url;a.download='モデル対戦.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
(async()=>{try{
  words=(await api('/testjeff/nouns')).flatMap(g=>g.words);targets=await api('/testjeff/abstract-nouns');
  for(const [id,values] of [['targets',targets],['nouns',words]])for(const word of values){const option=element('option');option.value=word;$(id).append(option);}
  const health=await api('/health');$('auth').classList.toggle('hidden',!health.authentication);
  createRows(['犬','猫','馬','象','イルカ','りんご','椅子','自転車','鉛筆','雨']);setBusy(false);$('progress').textContent='同じ10件で対戦';
}catch(e){error(e.message);}})();
