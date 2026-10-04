'use strict';
const $=id=>document.getElementById(id);
const modelNames={'qwen-0.8b':'jeff-qwen3.5-0.8b','qwen-2b':'jeff-qwen3.5-2b'};
let image=null,busy=false,previewUrl=null,defaults=null,samples=[],folderImages=[],stopFolder=false;
function setBusy(value){busy=value;for(const id of ['file','folder','choose-folder','model','key','run-samples','reset-prompts','prompt-text','prompt-landscape','prompt-coverage'])$(id).disabled=value;$('evaluate').disabled=value||!image;$('run-folder').disabled=value||!folderImages.length;$('export-folder').disabled=value||!folderImages.length;}
function clear(){ $('error').textContent='';$('summary').textContent='未判定';$('timing').textContent='';$('coverage').textContent='—';for(const id of ['text-result','landscape-result']){const node=$(id);node.className='result';node.querySelector('.answer').textContent='—';node.querySelector('.percent').textContent='—';node.querySelector('.fill').style.width='0%';}}
async function api(path,body){const headers={};if($('key').value)headers.Authorization=`Bearer ${$('key').value}`;if(body)headers['Content-Type']='application/json';const response=await fetch(path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok){if(response.status===401)$('auth').classList.remove('hidden');throw Error(response.status===401?'APIキーを入力してください。':typeof data.detail==='string'?data.detail:'画像またはプロンプトを確認してください。');}return data;}
function prompts(){const result={};for(const key of ['text','landscape','coverage']){result[key]=$('prompt-'+key).value.trim();if(!result[key])throw Error('プロンプトを入力してください。');}return result;}
function validate(data,selected){if(data.model!==modelNames[selected])throw Error('モデルが変更されました。再判定してください。');if(!['文字情報','風景'].every(k=>Number.isFinite(data.answers?.[k]?.noul)&&data.answers[k].noul>=0&&data.answers[k].noul<=1)||!Number.isFinite(data.coverage_percent)||data.coverage_percent<0||data.coverage_percent>100)throw Error('判定の応答が不正です。');}
function showResult(data){const values=['文字情報','風景'].map(key=>data.answers[key].noul);values.forEach((p,i)=>{const node=$(i===0?'text-result':'landscape-result');node.className=`result ${p>=.5?'yes':'no'}`;node.querySelector('.answer').textContent=p>=.5?'当てはまります':'当てはまりません';node.querySelector('.percent').textContent=`${(p*100).toFixed(1)}%`;node.querySelector('.fill').style.width=`${p*100}%`;});const [text,landscape]=values.map(p=>p>=.5);$('summary').textContent=text&&landscape?'文字情報を含む風景の写真':text?'文字情報を含む写真':landscape?'風景の写真':'どちらにも当てはまりません';$('coverage').textContent=`約 ${data.coverage_percent}%`;$('timing').textContent=`推論時間 ${data.response_ms.toFixed(1)} ms・判定画像 ${data.input_size.join(' × ')} px`;}
async function prepareModel(selected){$('status').textContent='モデルを準備中';const state=await api('/testjeff/model',{model:selected});if(!state.ready||state.selected!==selected)throw Error('モデルを読み込めませんでした。');}
async function evaluate(){if(busy||!image)return;clear();setBusy(true);const selected=$('model').value;try{const instructions=prompts();await prepareModel(selected);$('status').textContent='画像を判定中';const data=await api('/testjeff/photos',{model:selected,image,prompts:instructions});validate(data,selected);showResult(data);$('status').textContent='判定完了';}catch(e){$('error').textContent=e.message;$('status').textContent='判定失敗';}finally{setBusy(false);}}
async function acceptFile(file){if(busy)return;clear();image=null;$('preview').classList.add('hidden');$('placeholder').classList.remove('hidden');if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}setBusy(false);if(!file)return;try{if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('JPEG・PNG・WebPを選んでください。');if(file.size>8000000)throw Error('画像は8MB以内にしてください。');setBusy(true);image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('画像を読み込めませんでした。'));reader.readAsDataURL(file);});previewUrl=URL.createObjectURL(file);$('preview').src=previewUrl;$('preview').classList.remove('hidden');$('placeholder').classList.add('hidden');setBusy(false);await evaluate();}catch(e){image=null;$('error').textContent=e.message;$('status').textContent='画像を選び直してください';setBusy(false);}}
$('file').onchange=()=>acceptFile($('file').files[0]);
$('dropzone').onclick=()=>{if(!busy)$('file').click();};$('dropzone').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(!busy)$('file').click();}};
for(const type of ['dragover','drop'])document.addEventListener(type,e=>e.preventDefault());
$('dropzone').ondragover=e=>{e.preventDefault();if(!busy)$('dropzone').classList.add('drag');};$('dropzone').ondragleave=()=>$('dropzone').classList.remove('drag');
$('dropzone').ondrop=e=>{e.preventDefault();$('dropzone').classList.remove('drag');if(busy)return;if(e.dataTransfer.files.length!==1){$('error').textContent='写真を1枚ずつドロップしてください。';return;}acceptFile(e.dataTransfer.files[0]);};
$('model').onchange=()=>{clear();if(image)evaluate();};$('evaluate').onclick=evaluate;
for(const key of ['text','landscape','coverage'])$('prompt-'+key).oninput=()=>{clear();$('status').textContent='プロンプト変更後は再判定してください';};
$('reset-prompts').onclick=()=>{if(!defaults)return;for(const key of Object.keys(defaults))$('prompt-'+key).value=defaults[key];clear();};
function renderSamples(items=samples,target='samples'){const body=$(target);body.replaceChildren();for(const sample of items){const tr=document.createElement('tr');tr.dataset.id=sample.id;const cells=Array.from({length:7},()=>tr.appendChild(document.createElement('td')));const thumbnail=document.createElement('img');thumbnail.alt=sample.name;thumbnail.loading='lazy';if(sample.image)thumbnail.src=sample.image;cells[0].append(thumbnail);cells[1].textContent=sample.name;const r=sample.result;if(r){['文字情報','風景'].forEach((key,i)=>{const p=r.answers[key].noul;cells[i+2].textContent=`${p>=.5?'該当':'非該当'} ${(p*100).toFixed(1)}%`;cells[i+2].className=p>=.5?'yes':'no';});cells[4].textContent=`約 ${r.coverage_percent}%`;cells[5].textContent=`${r.response_ms.toFixed(1)} ms`;const details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent=r.model.replace('jeff-qwen3.5-','Qwen ');pre.textContent=JSON.stringify({日時:r.created_at,プロンプト:r.prompts,モデル版:r.revision},null,2);pre.style.whiteSpace='pre-wrap';details.append(summary,pre);cells[6].append(details);}else cells[6].textContent=sample.error||'未判定';body.append(tr);}}
async function loadSamples(){try{const data=await api('/testjeff/photo-samples');defaults=data.prompts;for(const key of Object.keys(defaults))if(!$('prompt-'+key).value)$('prompt-'+key).value=defaults[key];samples=data.samples;for(const sample of samples){try{sample.image=(await api('/testjeff/photo-samples/'+sample.id)).image;}catch(e){sample.error=e.message;}}renderSamples();$('sample-status').textContent=`${samples.length}枚`;}catch(e){$('error').textContent=e.message;}}
$('key').onchange=loadSamples;
$('run-samples').onclick=async()=>{if(busy)return;setBusy(true);$('error').textContent='';let completed=0,failed=0;try{const selected=$('model').value,instructions=prompts();await prepareModel(selected);for(const sample of samples){$('sample-status').textContent=`${completed+failed+1} / ${samples.length}枚を判定中`;try{const data=await api('/testjeff/photos',{model:selected,sample_id:sample.id,prompts:instructions});validate(data,selected);sample.result=data;sample.error=null;completed++;}catch(e){sample.result=null;sample.error=e.message;failed++;}renderSamples();}$('sample-status').textContent=`${completed}枚完了${failed?`・${failed}枚失敗`:''}`;$('status').textContent='サンプル判定完了';}catch(e){$('error').textContent=e.message;}finally{setBusy(false);}};
api('/health').then(h=>$('auth').classList.toggle('hidden',!h.authentication)).catch(()=>{});
loadSamples();

function readFolderFile(file){
  if(file.size>8000000)throw Error('画像は8MB以内にしてください。');
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>{
    const mime=/\.png$/i.test(file.name)?'png':/\.webp$/i.test(file.name)?'webp':'jpeg';
    resolve(`data:image/${mime};base64,${reader.result.split(',')[1]}`);
  };reader.onerror=()=>reject(Error('画像を読み込めませんでした。'));reader.readAsDataURL(file);});
}
$('choose-folder').onclick=()=>{if(!busy){$('folder').value='';$('folder').click();}};
$('folder').onchange=async()=>{
  if(busy||!$('folder').files.length)return;
  for(const entry of folderImages)URL.revokeObjectURL(entry.image);
  const files=Array.from($('folder').files),images=files.filter(f=>/\.(jpe?g|png|webp)$/i.test(f.name));
  folderImages=images.sort((a,b)=>a.webkitRelativePath.localeCompare(b.webkitRelativePath,'ja')).map((file,i)=>({id:String(i),name:file.webkitRelativePath||file.name,file,image:URL.createObjectURL(file),result:null}));
  renderSamples(folderImages,'folder-results');setBusy(false);
  $('folder-status').textContent=`${folderImages.length}枚・対象外 ${files.length-images.length}件`;
  if(folderImages.length)await runFolder();
};
async function runFolder(){
  if(busy||!folderImages.length)return;
  setBusy(true);stopFolder=false;$('stop-folder').disabled=false;$('error').textContent='';
  let completed=0,failed=0;
  try{
    const selected=$('model').value,instructions=prompts();
    for(const entry of folderImages){entry.result=null;entry.error=null;}
    renderSamples(folderImages,'folder-results');await prepareModel(selected);
    for(const entry of folderImages){
      if(stopFolder)break;
      $('folder-status').textContent=`${completed+failed+1} / ${folderImages.length}枚を判定中`;
      try{
        const picture=await readFolderFile(entry.file);
        const result=await api('/testjeff/photos',{model:selected,image:picture,prompts:instructions});
        validate(result,selected);entry.result=result;completed++;
      }catch(e){entry.error=e.message;failed++;}
      renderSamples(folderImages,'folder-results');
    }
    $('folder-status').textContent=`${completed}枚完了・${failed}枚失敗・${folderImages.length-completed-failed}枚未判定`;
    $('status').textContent=stopFolder?'フォルダ判定を停止しました':'フォルダ判定完了';
  }catch(e){$('error').textContent=e.message;$('folder-status').textContent='フォルダ判定失敗';}
  finally{$('stop-folder').disabled=true;setBusy(false);}
}
$('run-folder').onclick=runFolder;
$('stop-folder').onclick=()=>{stopFolder=true;$('stop-folder').disabled=true;$('folder-status').textContent='現在の画像の判定後に停止します';};
$('export-folder').onclick=()=>{
  const rows=folderImages.map(({name,file,result,error})=>({name,size:file.size,last_modified:file.lastModified,result,error:error||null}));
  const url=URL.createObjectURL(new Blob([JSON.stringify(rows,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='画像判定結果.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
