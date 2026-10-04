'use strict';
const $=id=>document.getElementById(id), allModels=BattleCore.models, connectionKey=window.TestJeffConnection?.key,storageBase='testjeff-battle-v2'+(connectionKey&&connectionKey!=='local'?':'+connectionKey:'');
let words=[],targets=[],busy=false,stop=false,run=null,stats=null;
let targetCombo=null,completedRecord=null,recordSaved=false,recordSaving=false;
const clone=value=>JSON.parse(JSON.stringify(value));
const inputsKey='testjeff-battle-inputs-v1';
const candidateCounts=[1,10,30,100];let candidateCount=10,savedInputs=null;
try{const saved=JSON.parse(localStorage.getItem(inputsKey)),count=saved?.count??10;if(saved&&candidateCounts.includes(count)&&typeof saved.target==='string'&&saved.target.length<=80&&Array.isArray(saved.candidates)&&saved.candidates.length===count&&saved.candidates.every(value=>typeof value==='string'&&value.length<=80)){savedInputs=saved;candidateCount=count;}}catch{}
$('candidate-count').value=String(candidateCount);
let battleTimer=null;
function showBattleWait(){
  hideBattleWait();const started=performance.now();
  const update=()=>{$('battle-elapsed').textContent=`${Math.floor((performance.now()-started)/1000)}秒`;$('battle-wait-progress').textContent=$('progress').textContent;};
  $('battle-elapsed').textContent='0秒';$('battle-wait-progress').textContent='準備中';$('battle-wait').classList.remove('hidden');
  battleTimer=setInterval(update,200);
}
function hideBattleWait(){if(battleTimer!==null)clearInterval(battleTimer);battleTimer=null;$('battle-wait').classList.add('hidden');}
const defaultSlots=allModels.map(m=>m.id);
let slots=[...defaultSlots];try{const saved=JSON.parse(localStorage.getItem('testjeff-battle-slots'));if(Array.isArray(saved)&&saved.length===4&&saved.every(id=>id===''||defaultSlots.includes(id))&&new Set(saved.filter(Boolean)).size===saved.filter(Boolean).length)slots=saved;}catch{}
let models=slots.map(id=>allModels.find(m=>m.id===id)||{id:'',name:'未選択',inactive:true});
function statsKey(){return storageBase+(batchMode?':batch':'')+(JSON.stringify(slots)===JSON.stringify(defaultSlots)?'':':columns:'+slots.join('|'))+(candidateCount===10?'':':count:'+candidateCount);}

const rows=[];
let batchMode=localStorage.getItem('testjeff-battle-batch')==='true';
function renderQueryMode(){$('batch-mode').setAttribute('aria-pressed',String(batchMode));$('single-mode').setAttribute('aria-pressed',String(!batchMode));}
renderQueryMode();
let storageKey=statsKey();
let pendingKnowledge=null,knowledgeSaved=false;
function loadStats(){stats=null;try{
  const saved=JSON.parse(localStorage.getItem(storageKey)||'null');
  const comparisonItems=saved?.comparison_items??(saved?.comparisons??saved?.runs??0)*10;
  if(saved&&Number.isInteger(saved.runs)&&saved.runs>=0&&Number.isFinite(saved.agreement)&&saved.agreement>=0&&Number.isInteger(comparisonItems)&&comparisonItems>=0&&comparisonItems<=saved.runs*candidateCount&&saved.agreement<=comparisonItems&&allModels.every(m=>{
    const v=saved.models?.[m.id];return !v||Number.isInteger(v.count)&&v.count>0&&v.count<=saved.runs*candidateCount&&v.count%candidateCount===0&&['totalMs','yes','probabilitySum','wins'].every(k=>Number.isFinite(v[k])&&v[k]>=0)&&v.yes<=v.count&&v.probabilitySum<=v.count&&v.wins<=v.count;
  }))stats=saved;
}catch{}}
loadStats();
function selectQueryMode(value){if(busy||batchMode===value)return;batchMode=value;renderQueryMode();localStorage.setItem('testjeff-battle-batch',String(batchMode));storageKey=statsKey();loadStats();resetResults();}
$('batch-mode').onclick=()=>selectQueryMode(true);
$('single-mode').onclick=()=>selectQueryMode(false);
function error(text=''){$('error').textContent=text;}
function save(){try{localStorage.setItem(storageKey,JSON.stringify(stats));}catch{error('累積値を保存できませんでした。画面を閉じるまでは保持します。');}}
function setBusy(value){window.TestJeffBusy=value;window.dispatchEvent(new Event('testjeff-busy'));busy=value;for(const id of ['target','candidate-count','random','start','reset','key','batch-mode','single-mode','show-history'])$(id).disabled=value;targetCombo?.setDisabled(value);rows.forEach(r=>r.combo.setDisabled(value));renderSelectors();updateReviewControls();updateRecordControls();$('stop').classList.toggle('hidden',!value);$('stop').disabled=false;}
function element(tag,text,cls){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;}
function renderSelectors(){
 document.querySelectorAll('.battle-model').forEach((select,i)=>{
  select.replaceChildren();for(const m of [{id:'',name:'未選択'},...allModels]){const option=element('option',m.name);option.value=m.id;
   const capability=window.TestJeffConnection?.capabilities?.capabilities?.find(c=>c.local_id===m.id);
   if(m.id&&!m.cloud&&window.TestJeffConnection?.config.mode==='fds'&&window.TestJeffConnection.capabilities&&(!capability?.available||!capability.devices.includes(window.TestJeffConnection.config.device))){option.disabled=true;option.textContent+='（計測不能）';}
   select.append(option);
  }select.value=slots[i];select.disabled=busy;
 });
}
function setupSelectors(){
 [...document.querySelectorAll('thead th')].slice(1,5).forEach((th,i)=>{const select=element('select');select.className='battle-model';select.setAttribute('aria-label',`比較モデル${i+1}`);th.replaceChildren(select);
  select.onchange=()=>{if(busy)return;const old=slots[i],next=select.value,other=next?slots.findIndex((id,j)=>id===next&&j!==i):-1;if(other>=0)slots[other]=old;slots[i]=next;
   models=slots.map(id=>allModels.find(m=>m.id===id)||{id:'',name:'未選択',inactive:true});localStorage.setItem('testjeff-battle-slots',JSON.stringify(slots));storageKey=statsKey();loadStats();resetResults();renderSelectors();
  };
 });renderSelectors();
}
window.addEventListener('fds-capabilities',renderSelectors);
function resetResults(){run=null;completedRecord=null;recordSaved=false;$('run-save-status').textContent='';clearReviews();render();}
function persistInputs(){try{localStorage.setItem(inputsKey,JSON.stringify({target:$('target').value,count:candidateCount,candidates:rows.map(r=>r.input.value)}));}catch{}}
function inputChanged(){persistInputs();resetResults();}
function resizeCandidates(count){
  const values=rows.slice(0,count).map(row=>row.input.value),used=new Set(values.map(value=>value.trim()));
  if(values.length<count)values.push(...NounCore.draw(words.filter(word=>!used.has(word)),[$('target').value],count-values.length).candidates);
  candidateCount=count;storageKey=statsKey();loadStats();createRows(values);$('progress').textContent=`同じ${count}件で対戦`;
}
$('candidate-count').onchange=()=>{const count=Number($('candidate-count').value);if(!busy&&candidateCounts.includes(count))resizeCandidates(count);};
function createRows(values){
  rows.forEach(row=>row.combo.destroy());
  rows.length=0;$('rows').replaceChildren();
  values.forEach((word,i)=>{
    const tr=element('tr'),td=element('td'),editor=element('div',undefined,'noun-editor candidate-editor'),input=element('input');
    input.value=word;input.maxLength=80;input.setAttribute('aria-label',`候補${i+1}`);input.oninput=inputChanged;
    editor.append(input);td.append(editor);tr.append(td);const combo=NounCombo.attach(input,words);
    const cells=models.map(()=>{const cell=element('td','未評価');tr.append(cell);return cell;});
    const review=element('td',undefined,'review'),fields=element('div',undefined,'review-fields'),expected=element('select'),comment=element('textarea');
    expected.setAttribute('aria-label',`ユーザー判定${i+1}`);for(const value of ['未評価','です','ではありません','判断困難']){const option=element('option',value);option.value=value;expected.append(option);}
    comment.maxLength=1000;comment.rows=1;comment.placeholder='理由・補足';comment.setAttribute('aria-label',`評価コメント${i+1}`);expected.onchange=reviewChanged;comment.oninput=reviewChanged;
    fields.append(expected,comment);review.append(fields);tr.append(review);rows.push({tr,input,combo,cells,expected,comment,index:i});$('rows').append(tr);
  });persistInputs();resetResults();
}
function render(){
  const finished=run?.status==='完了'&&BattleCore.complete(run),comparison=finished?BattleCore.compare(run):null,count=run?BattleCore.candidateCount(run):candidateCount,batch=run?.batch??batchMode;
  const ranks=Object.fromEntries((finished?BattleCore.rankings(run):[]).map(item=>[item.id,item]));
  document.querySelectorAll('.battle-model').forEach((select,index)=>{const fastest=!!(batch&&ranks[models[index].id]?.rank===1);select.classList.toggle('batch-fastest',fastest);select.title=fastest?'合計時間が最速のモデル':'';});
  $('summary').replaceChildren();
  for(const m of models){
    const items=run?.results[m.id]||[],s=items.length?BattleCore.summarize(items):null;
    const card=element('section',undefined,'model-card');card.dataset.modelId=m.id;card.append(element('h2',m.name));
    if(m.inactive){card.append(element('div','処理しません','model-status'));$('summary').append(card);continue;}
    const metrics=element('div',undefined,'metrics');
    const total=run?.query_totals?.[m.id],warmup=run?.warmup?.[m.id],remote=run?.execution?.[m.id]?.backend==='fds'||warmup?.execution?.backend==='fds'||warmup?.reproduction?.execution?.backend==='fds',load=remote?(warmup?.execution?.load_ms??warmup?.reproduction?.execution?.load_ms):run?.loads?.[m.id],memory=run?.memory?.[m.id],rank=ranks[m.id]?.rank;
    const fields=[['合計時間',total?`${total.total_ms.toFixed(1)} ms`:'—','total_ms'],['順位',rank?`${rank}位`:'—','rank'],['モデルロード時間',m.cloud?'—':Number.isFinite(load)?`${load.toFixed(1)} ms`:remote?'取得不可':'—','load_ms'],['GPU確保容量',!m.cloud&&Number.isFinite(memory)?`${memory.toFixed(2)} GiB`:'—','gpu_gib']];
    if(!batch)fields.push(['平均応答',s?`${s.mean.toFixed(1)} ms`:'—','mean_ms'],['最速件数',comparison&&s&&comparison.agreement!==null?`${comparison.wins[m.id]} / ${count}`:'—','wins']);
    for(const [label,value,key] of fields){
      const part=element('div',label),strong=element('strong',value);part.dataset.metric=key;
      if(key==='rank'&&rank<=3){strong.replaceChildren();strong.className='rank-badge';strong.setAttribute('aria-label',`${rank}位`);const medal=element('span',['🥇','🥈','🥉'][rank-1],'rank-medal');medal.setAttribute('aria-hidden','true');strong.append(medal,document.createTextNode(`${rank}位`));}
      part.append(strong);
      if(key==='total_ms')part.title=total?`最初の問い合わせ開始から最後の応答まで（モデル読込・予備判定を除外）。成功した各件のAPI時間合計 ${total.response_sum_ms.toFixed(1)} ms・${total.count}件${total.complete?'':'・未完了'}`:'モデル読込・予備判定を除く、問い合わせ開始から最後の応答まで';
      if(key==='load_ms')part.title=m.cloud?'クラウドモデルは対象外':remote?'予備判定でFDSが返したモデルロード時間。準備確認APIの通信時間は含みません。':'モデル切り替えAPIの送信から応答まで。既に読み込まれたモデルの確認時間も含みます。';
      if(key==='gpu_gib')part.title=m.cloud?'クラウドモデルは対象外':'サーバーから取得できたモデル用GPU確保容量';
      metrics.append(part);
    }
    card.append(metrics);
    if(run?.skipped?.[m.id])card.append(element('div','計測不能：'+run.skipped[m.id],'model-status unavailable'));
    $('summary').append(card);
  }
  $('agreement').textContent=`判定一致 ${comparison&&comparison.agreement!==null?comparison.agreement+` / ${count}件`:'—'}`;
  $('cumulative').textContent=`累積 ${stats?.runs||0}回・一致 ${stats?.agreement||0} / ${stats?.comparison_items??(stats?.comparisons??stats?.runs??0)*10}件`;
  updateRecordControls();
  for(const row of rows){
    const values=models.map(m=>run?.results[m.id]?.[row.index]);
    const comparable=values.filter(Boolean);const full=finished&&comparable.length>=2,fastest=full?Math.min(...comparable.map(x=>x.ms)):null;
    values.forEach((item,j)=>{const cell=row.cells[j];cell.replaceChildren();if(!item){cell.textContent=models[j].inactive?'未選択':run?.skipped?.[models[j].id]?'計測不能':'未評価';cell.title=run?.skipped?.[models[j].id]||'';return;}
      const isFastest=!batch&&full&&item.ms===fastest;
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
      if(!batch)detail.append(element('span',`${item.ms.toFixed(1)} ms`,'response-time'));
      if(detail.childElementCount)box.append(detail);cell.append(box);
    });
  }
  updateDifferences();sortRows();filterRows();
  renderQuality();updateReviewControls();
}
function updateDifferences(){for(const row of rows){row.difference=BattleCore.hasMismatch(models.map(model=>run?.results[model.id]?.[row.index]),row.expected.value);row.tr.classList.toggle('mismatch',row.difference);}}
function filterRows(){const mismatches=$('filter').value==='mismatch';rows.forEach(row=>{row.tr.hidden=mismatches&&!row.difference;});}
$('filter').onchange=filterRows;
function sortRows(){
  // 編集中に行をDOMから移動するとフォーカスと日本語変換が失われるため、入力中は並べ替えない。
  if(rows.some(row=>row.input===document.activeElement))return;
  const mode=$('sort').value;[...rows].sort((a,b)=>(mode==='name'?a.input.value.localeCompare(b.input.value,'ja'):mode==='difference'?Number(b.difference)-Number(a.difference):0)||a.index-b.index).forEach((row,i)=>{if($('rows').children[i]!==row.tr)$('rows').insertBefore(row.tr,$('rows').children[i]||null);});
}
$('sort').onchange=sortRows;
function reviewable(){return !!run&&run.status==='完了'&&BattleCore.complete(run);}
function annotations(){return rows.map(row=>({expected:row.expected.value,comment:row.comment.value.trim()}));}
function updateReviewControls(){const disabled=busy||!reviewable();rows.forEach(r=>{r.expected.disabled=disabled;r.comment.disabled=disabled;});$('save-knowledge').disabled=disabled||knowledgeSaved||!annotations().some(a=>a.expected!=='未評価'||a.comment);}
function clearReviews(){pendingKnowledge=null;knowledgeSaved=false;rows.forEach(r=>{r.expected.value='未評価';r.comment.value='';});$('knowledge-status').textContent='';}
function reviewChanged(){pendingKnowledge=null;knowledgeSaved=false;$('knowledge-status').textContent='未保存';updateDifferences();sortRows();filterRows();renderQuality();updateReviewControls();}
function renderQuality(){
  document.querySelectorAll('.quality-score').forEach(node=>node.remove());
  if(!reviewable())return;
  const notes=annotations();if(!notes.some(note=>note.expected!=='未評価'))return;
  models.forEach((m,j)=>{if(!run.results[m.id]?.length)return;let correct=0,total=0;notes.forEach((a,i)=>{if(a.expected==='です'||a.expected==='ではありません'){total++;if(BattleCore.positive(run.results[m.id][i])===(a.expected==='です'))correct++;}});$('summary').children[j].append(element('div',`ユーザー判定と一致 ${total?`${correct} / ${total}件（${(correct/total*100).toFixed(1)}%）`:'—'}`,'quality-score'));});
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

function publicConnection(){
  const source=window.TestJeffConnection?.config||{mode:'local'},result={};
  for(const key of ['mode','host','port','device','local_device'])if(source[key]!==undefined)result[key]=source[key];
  result.key=window.TestJeffConnection?.key||'local';return clone(result);
}
function updateRecordControls(){
  $('export').disabled=busy||!completedRecord;$('save-run').disabled=busy||recordSaving||!completedRecord||recordSaved;
  $('show-history').disabled=busy||recordSaving;
}
function downloadRecord(value,filename){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json;charset=utf-8'}));const link=element('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function saveRun(snapshot){
  if(!snapshot||recordSaving)return;recordSaving=true;updateRecordControls();$('run-save-status').textContent='結果を保存中';
  try{
    const stored=await api('/testjeff/battle-runs',snapshot);
    if(stored.run_id!==snapshot.run.id)throw Error('保存結果の対戦IDが一致しません。');
    if(completedRecord===snapshot){recordSaved=true;$('run-save-status').textContent='結果を保存済み';}
  }catch(e){if(completedRecord===snapshot){recordSaved=false;$('run-save-status').textContent='結果の保存失敗：'+e.message;}}
  finally{recordSaving=false;updateRecordControls();}
}
$('save-run').onclick=async()=>{if(busy||recordSaving||!completedRecord||recordSaved)return;const snapshot=completedRecord;setBusy(true);$('stop').classList.add('hidden');try{await saveRun(snapshot);}finally{setBusy(false);}};
let historyRows=[],historyNext=null,historySelection=null,historyLoading=false,historyGeneration=0,historyListGeneration=0;
function historyControls(){for(const id of ['refresh-history','more-history'])$(id).disabled=historyLoading||busy||id==='more-history'&&historyNext===null;}
function renderHistoryList(){
  $('history-list').replaceChildren();
  for(const row of historyRows){
    const button=element('button',undefined,'history-entry');button.type='button';button.dataset.recordId=row.id;button.setAttribute('aria-pressed',String(historySelection===row.id));
    button.append(element('strong',`「${row.target}」 ${row.status}`),element('div',`${new Date(row.recorded_at).toLocaleString('ja-JP')}・${row.batch?'一括':'個別'}`,'sub'),element('div',(row.selected_models||[]).map(id=>allModels.find(m=>m.id===id)?.name||id).join(' / '),'sub'));
    button.onclick=()=>showHistoryRecord(row.id);$('history-list').append(button);
  }
}
async function loadHistory(more=false){
  if(busy||historyLoading)return;historyLoading=true;historyControls();$('history-status').textContent='履歴を取得中';const generation=++historyListGeneration;if(!more)historyGeneration++;
  try{
    const data=await api(`/testjeff/battle-runs?before=${more?historyNext||0:0}&limit=50`);
    if(generation!==historyListGeneration)return;
    if(!Array.isArray(data.rows))throw Error('保存履歴の応答が不正です。');
    historyRows=more?historyRows.concat(data.rows):data.rows;historyNext=data.next_before??null;renderHistoryList();$('history-status').textContent=`${historyRows.length}件`;
    if(!more){historySelection=null;$('history-detail').replaceChildren(element('p',historyRows.length?'保存結果を選択してください。':'保存結果はありません。'));}
  }catch(e){if(generation===historyListGeneration)$('history-status').textContent='履歴の取得失敗：'+e.message;}
  finally{if(generation===historyListGeneration)historyLoading=false;historyControls();}
}
function renderHistoryRecord(record){
  const box=$('history-detail'),saved=record.run;box.replaceChildren();
  box.append(element('h3',`「${saved.target}」の対戦結果`),element('div',`${saved.status}・${saved.candidates?.length??10}件・${saved.batch?'一括問い合わせ':'個別問い合わせ'}・${new Date(saved.at).toLocaleString('ja-JP')}`,'sub'));
  const download=element('button','この結果をダウンロード');download.id='history-download';download.onclick=()=>downloadRecord(record,`モデル対戦-${saved.id}.json`);box.append(download);
  const active=saved.selected_models||Object.keys(saved.results||{}),table=element('table'),head=element('thead'),heading=element('tr');heading.append(element('th','候補'));
  for(const id of active)heading.append(element('th',allModels.find(m=>m.id===id)?.name||id));head.append(heading);table.append(head);
  const body=element('tbody');
  (saved.candidates||[]).forEach((word,i)=>{
    const row=element('tr');row.append(element('td',word));
    for(const id of active){
      const cell=element('td'),item=saved.results?.[id]?.[i]||saved.partial_results?.[id]?.[i];
      if(item){
        const positive=BattleCore.positive(item),details=[];cell.append(element('div',`「${word}」は「${saved.target}」${positive?'です':'ではありません'}`,positive?'yes':'no'));
        if(!saved.batch)details.push(`${Number(item.ms).toFixed(1)} ms`);
        if(Number.isFinite(item.probability))details.push(`${(item.probability*100).toFixed(1)}%`);
        if(saved.partial_results?.[id])details.push('集計対象外');
        if(details.length)cell.append(element('div',details.join('・'),'sub'));
      }else cell.textContent=saved.skipped?.[id]?'計測不能：'+saved.skipped[id]:'未計測';
      row.append(cell);
    }body.append(row);
  });table.append(body);const wrap=element('div',undefined,'tablewrap');wrap.append(table);box.append(wrap);
  box.append(element('h3','モデル別の計測値'));
  for(const id of active){const items=saved.results?.[id]||[],summary=items.length?BattleCore.summarize(items):null,total=saved.query_totals?.[id];box.append(element('p',`${allModels.find(m=>m.id===id)?.name||id}：合計時間 ${total?total.total_ms.toFixed(1)+' ms':'未記録'}${total&&!total.complete?'（未完了）':''}${saved.batch?'':`・${summary?`${summary.count}件・平均 ${summary.mean.toFixed(1)} ms・API時間合計 ${summary.totalMs.toFixed(1)} ms`:'計測不能'}`}`));}
  box.append(element('h3','実行設定'),element('pre',JSON.stringify({connection:record.connection,execution:saved.execution,parameters:saved.parameters,query_totals:saved.query_totals,started_at:saved.at,ended_at:saved.ended_at,run_id:saved.id},null,2)),element('h3','保存時の累積値'),element('pre',JSON.stringify(record.statistics,null,2)));
}
async function showHistoryRecord(id){
  if(busy)return;const generation=++historyGeneration;historySelection=id;renderHistoryList();$('history-detail').replaceChildren(element('p','結果を取得中'));
  try{const record=await api('/testjeff/battle-runs/'+id);if(generation===historyGeneration&&$('battle-history').open)renderHistoryRecord(record);}
  catch(e){if(generation===historyGeneration)$('history-detail').replaceChildren(element('p','結果の取得失敗：'+e.message));}
}
$('show-history').onclick=()=>{if(busy)return;$('battle-history').showModal();loadHistory();};
$('close-history').onclick=()=>$('battle-history').close();
$('battle-history').onclose=()=>{historyGeneration++;historyListGeneration++;historyLoading=false;historyControls();};
$('refresh-history').onclick=()=>loadHistory();$('more-history').onclick=()=>loadHistory(true);

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
    return {verdict:data.verdict,ms:performance.now()-start,source:data.source,reasoning:data.reasoning,cli_ms:data.duration_ms,usage:data.usage,reproduction:data.reproduction||null};
  }
  const start=performance.now(),data=await api('/v1/systemone',{...request,model:model.api}),ms=performance.now()-start,p=data.answers?.判定?.noul;
  if(data.model!==model.api)throw Error('別の画面でモデルが変更されました。対戦をやり直してください。');
  if(typeof p!=='number'||!Number.isFinite(p)||p<0||p>1)throw Error('判定の応答が不正です。');
  return {probability:p,ms,execution:data.execution||null,reproduction:data.reproduction||null};
}
function requestTimeout(path,payload){return window.TestJeffConnection?.timeoutMs?.(path,payload)??(path==='/testjeff/battle-batch'&&payload.model!=='gpt-5.6-luna'?15000+Math.ceil(payload.candidates.length/8)*120000:135000);}
function recordQueryTotal(id,started,ended,complete){
  if(started===null||ended===null)return;
  const items=run.results[id]||run.partial_results[id]||[];
  run.query_totals[id]={total_ms:ended-started,response_sum_ms:items.reduce((sum,item)=>sum+item.ms,0),count:items.length,complete,start_ms:started,end_ms:ended};
}
async function battle(inputMethod='manual'){
  if(busy)return;error();let requests;
  const target=$('target').value.trim(),candidates=rows.map(r=>r.input.value.trim());
  try{requests=candidates.map(word=>NounCore.makeRequest(target,word));}catch(e){error(e.message);return;}
  if(!models.some(m=>!m.inactive)){error('比較するモデルを選択してください。');return;}
  clearReviews();completedRecord=null;recordSaved=false;$('run-save-status').textContent='';setBusy(true);stop=false;let original=null;
  const local=models.filter(m=>!m.cloud&&!m.inactive),offset=(stats?.runs||0)%(local.length||1),order=[...local.slice(offset),...local.slice(0,offset),...models.filter(m=>m.cloud)];
  const connection=publicConnection(),selectedModels=models.filter(m=>!m.inactive);
  run={schema_version:2,selected_models:selectedModels.map(m=>m.id),columns:[...slots],batch:batchMode,id:crypto.randomUUID(),at:new Date().toISOString(),target,candidates,order:order.map(m=>m.id),results:{},partial_results:{},query_totals:{},skipped:{},loads:{},memory:{},revisions:{},execution:{},warmup:{},status:'実行中'};
  run.parameters={requests:clone(requests),candidate_count:candidates.length,input_method:inputMethod==='random'?'random':'manual',sort_mode:$('sort').value,filter_mode:$('filter').value,warmup_per_model:1,warmup_candidate_index:0,positive_threshold:.5,columns:[...slots],selected_models:[...run.selected_models],order:[...run.order],batch:batchMode,statistics_key:storageKey,
    timing:{unit:'ms',clock:'performance.now()',single:'各API送信開始から応答JSON受信・検証まで',batch:`${candidates.length}件全体のAPI応答時間÷${candidates.length}（各件の実時間ではない平均換算）`,query_total:'最初の本判定問い合わせ開始から最後の応答まで。問い合わせ間の画面処理を含み、モデル読込・予備判定・最終応答後の描画・状態取得・保存を除外',response_sum:'成功した各件のAPI応答時間の合計。一括は各行の平均換算値の合計',load:'run.loadsはモデル切り替え・準備確認APIの送信から応答まで。ローカル表示はこの値（既ロード確認を含む）、FDS表示は予備判定が返したexecution.load_ms。いずれも速度集計から除外',warmup:'各モデルの最初の1件（速度集計から除外）'},
    client:{schema_version:2,origin:location.origin,language:navigator.language,user_agent:navigator.userAgent,performance_time_origin_ms:performance.timeOrigin},model_requests:{}};
  for(const m of selectedModels){const single=requests.map((request,i)=>m.cloud?{target,candidate:candidates[i]}:{...clone(request),model:m.api}),singlePath=m.cloud?'/testjeff/luna':'/v1/systemone',path=batchMode?'/testjeff/battle-batch':singlePath,payloads=batchMode?[{model:m.id,target,candidates:[...candidates]}]:single;run.parameters.model_requests[m.id]={model:m.api,single_path:singlePath,warmup:single[0],warmup_client_timeout_ms:requestTimeout(singlePath,single[0]),requests:payloads,path,client_timeout_ms:requestTimeout(path,payloads[0])};}
  try{
    showBattleWait();render();
    try{if(local.length)original=(await api('/testjeff/status')).selected;}catch(e){run.connection_error=e.message;}
    for(const m of order){
      if(stop)break;
      let queryStarted=null,queryEnded=null,queryInFlight=false;
      try{
      const capability=window.TestJeffConnection?.capabilities?.capabilities?.find(item=>item.local_id===m.id);
      if(!m.cloud&&window.TestJeffConnection?.config.mode==='fds'&&capability&&!capability.available)throw Error(capability.unavailable_reason||'サーバーで利用できません');
      $('progress').textContent=`${m.name} 読み込み中`;
      if(!m.cloud){
      const start=performance.now(),state=await api('/testjeff/model',{model:m.id});
      run.loads[m.id]=performance.now()-start;run.revisions[m.id]=state.revision;
      run.execution[m.id]={backend:state.backend||connection.mode,model:state.remote_model||m.api,device:state.device??null,revision:state.revision??null,endpoint:state.endpoint??null};
      if(!state.ready||state.selected!==m.id)throw Error('モデルを読み込めませんでした。');
      }else run.execution[m.id]={backend:'cloud',model:m.api,source:'Codex CLI',reasoning:'low'};
      if(stop)break;$('progress').textContent=`${m.name} 予備判定`;
      run.warmup[m.id]=await predict(m,requests[0]);run.results[m.id]=[];
      if(run.warmup[m.id].execution)run.execution[m.id]={...run.execution[m.id],...clone(run.warmup[m.id].execution)};
      if(stop)break;
      if(run.batch){
        $('progress').textContent=`${m.name} ${candidates.length}件を一括判定中`;
        queryStarted=performance.now();queryInFlight=true;
        const data=await api('/testjeff/battle-batch',{model:m.id,target:run.target,candidates:run.candidates});queryEnded=performance.now();queryInFlight=false;const elapsed=queryEnded-queryStarted;
        if(!Array.isArray(data.results)||data.results.length!==candidates.length||!data.results.every(x=>m.cloud?typeof x.verdict==='boolean':Number.isFinite(x.probability)&&x.probability>=0&&x.probability<=1))throw Error('一括応答が不正です。');
        (run.parameters.batch_execution??={})[m.id]=data.reproduction||null;
        run.results[m.id]=data.results.map(x=>({...x,ms:elapsed/candidates.length,batch_total_ms:elapsed,timing_basis:'batch_average'}));recordQueryTotal(m.id,queryStarted,queryEnded,!stop);render();
      }else for(let i=0;i<candidates.length&&!stop;i++){
        $('progress').textContent=`${m.name} ${i+1} / ${candidates.length}件`;
        if(queryStarted===null)queryStarted=performance.now();queryInFlight=true;
        const result=await predict(m,requests[i]);queryEnded=performance.now();queryInFlight=false;
        run.results[m.id].push(result);recordQueryTotal(m.id,queryStarted,queryEnded,i+1===candidates.length&&!stop);render();
      }
      if(!m.cloud){
      const measured=await api('/testjeff/status');
      if(measured.selected!==m.id)throw Error('別の画面でモデルが変更されました。');
      run.memory[m.id]=measured.reserved_gib;
      }
      const evidence=run.results[m.id]?.find(item=>item.execution)?.execution||run.warmup[m.id]?.execution;
      if(evidence)run.execution[m.id]={...run.execution[m.id],...clone(evidence)};
      if(m.cloud){const evidence=run.results[m.id]?.[0]||run.warmup[m.id];run.execution[m.id]={...run.execution[m.id],source:evidence?.source||'Codex CLI',reasoning:evidence?.reasoning||'low'};}
      }catch(e){recordQueryTotal(m.id,queryStarted,queryInFlight?performance.now():queryEnded,false);if(run.results[m.id]?.length)run.partial_results[m.id]=clone(run.results[m.id]);delete run.results[m.id];run.skipped[m.id]=e.message;}
      render();
    }
    if(stop){run.status='中止';}
    else if(BattleCore.complete(run)){run.status='完了';stats=BattleCore.accumulate(stats,run);save();}else run.status='計測不能';
  }catch(e){run.status='失敗';run.error=e.message;error(e.message);}
  finally{
    if(original){$('progress').textContent='元のモデルに戻しています';try{await api('/testjeff/model',{model:original});}catch(e){run.restore_error=e.message;error(`元のモデルに戻せませんでした。${e.message}`);}}
    run.ended_at=new Date().toISOString();completedRecord=clone({run,statistics:stats,connection});
    $('progress').textContent=run.status==='完了'?(Object.keys(run.skipped).length?`${BattleCore.measured(run).length}モデル計測完了・${Object.keys(run.skipped).length}モデル計測不能`:`${run.selected_models.length*candidates.length} / ${run.selected_models.length*candidates.length}件完了`):`${run.status}・累積には加算していません`;
    hideBattleWait();$('stop').classList.add('hidden');render();await saveRun(completedRecord);setBusy(false);render();
  }
}
$('start').onclick=()=>battle('manual');
$('random').onclick=()=>{if(busy)return;const chosen=NounCore.draw(words,targets,candidateCount);$('target').value=chosen.target;createRows(chosen.candidates);battle('random');};
$('target').oninput=inputChanged;
$('stop').onclick=()=>{stop=true;$('stop').disabled=true;$('progress').textContent='処理中の1件が終了したら中止します';};
$('reset').onclick=()=>{stats=null;save();render();};
$('export').onclick=()=>{if(completedRecord)downloadRecord(completedRecord,'モデル対戦.json');};
(async()=>{try{
  words=(await api('/testjeff/nouns')).flatMap(g=>g.words);targets=await api('/testjeff/abstract-nouns');
  targetCombo=NounCombo.attach($('target'),targets);
  const health=await api('/health');$('auth').classList.toggle('hidden',!health.authentication);
  let candidates=['犬','猫','馬','象','イルカ','りんご','椅子','自転車','鉛筆','雨'];
  if(savedInputs){$('target').value=savedInputs.target;candidates=savedInputs.candidates;}
  setupSelectors();createRows(candidates);setBusy(false);$('progress').textContent=`同じ${candidateCount}件で対戦`;
}catch(e){error(e.message);}})();
