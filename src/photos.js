'use strict';
const $=id=>document.getElementById(id);
const modelNames={'qwen-0.8b':'jeff-qwen3.5-0.8b','qwen-2b':'jeff-qwen3.5-2b'};
let image=null,busy=false,previewUrl=null,defaults=null,samples=[],folderImages=[],stopFolder=false;
function setBusy(value){busy=value;for(const id of ['file','folder','choose-folder','model','key','run-samples','reset-prompts','prompt-text','prompt-landscape','prompt-coverage'])$(id).disabled=value;$('evaluate').disabled=value||!image;$('run-folder').disabled=value||!folderImages.length;$('export-folder').disabled=value||!folderImages.length;}
function clear(){ $('error').textContent='';$('summary').textContent='未判定';$('timing').textContent='';$('coverage').textContent='—';for(const id of ['text-result','landscape-result']){const node=$(id);node.className='result';node.querySelector('.answer').textContent='—';node.querySelector('.percent').textContent='—';node.querySelector('.fill').style.width='0%';}}
async function api(path,body){const headers={};if($('key').value)headers.Authorization=`Bearer ${$('key').value}`;if(body)headers['Content-Type']='application/json';const response=await fetch(path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok){if(response.status===401)$('auth').classList.remove('hidden');throw Error(response.status===401?'APIキーを入力してください。':typeof data.detail==='string'?data.detail:'画像またはプロンプトを確認してください。');}return data;}
function prompts(){const result={};for(const key of ['text','landscape','coverage']){result[key]=$('prompt-'+key).value.trim();if(!result[key])throw Error('プロンプトを入力してください。');}return result;}
function validate(data,selected){if(data.model!==modelNames[selected])throw Error('モデルが変更されました。再判定してください。');if(!['文字情報','風景'].every(k=>Number.isFinite(data.answers?.[k]?.noul)&&data.answers[k].noul>=0&&data.answers[k].noul<=1)||!Number.isFinite(data.coverage_percent)||data.coverage_percent<0||data.coverage_percent>100)throw Error('判定の応答が不正です。');}
function showResult(data){const values=['文字情報','風景'].map(key=>data.answers[key].noul);values.forEach((p,i)=>{const node=$(i===0?'text-result':'landscape-result');node.className=`result ${p>=.5?'yes':'no'}`;node.querySelector('.answer').textContent=p>=.5?'当てはまります':'当てはまりません';node.querySelector('.percent').textContent=`${(p*100).toFixed(1)}%`;node.querySelector('.fill').style.width=`${p*100}%`;});const [text,landscape]=values.map(p=>p>=.5);$('summary').textContent=text&&landscape?'文字情報を含む風景の写真':text?'文字情報を含む写真':landscape?'風景の写真':'どちらにも当てはまりません';$('coverage').textContent=`約 ${data.coverage_percent}%`;$('timing').textContent=`処理 ${data.total_ms.toFixed(1)} ms ／ 推論 ${data.response_ms.toFixed(1)} ms・判定画像 ${data.input_size.join(' × ')} px`;}
async function prepareModel(selected){$('status').textContent='モデルを準備中';const state=await api('/testjeff/model',{model:selected});if(!state.ready||state.selected!==selected)throw Error('モデルを読み込めませんでした。');}
async function evaluate(started=performance.now()){if(busy||!image)return;clear();setBusy(true);const selected=$('model').value;if(typeof started!=='number')started=performance.now();try{const instructions=prompts();await prepareModel(selected);$('status').textContent='画像を判定中';const data=await api('/testjeff/photos',{model:selected,image,prompts:instructions});data.total_ms=performance.now()-started;validate(data,selected);showResult(data);$('status').textContent='判定完了';}catch(e){$('error').textContent=e.message;$('status').textContent='判定失敗';}finally{setBusy(false);}}
async function acceptFile(file){if(busy)return;const started=performance.now();clear();image=null;$('preview').classList.add('hidden');$('placeholder').classList.remove('hidden');if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}setBusy(false);if(!file)return;try{if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('JPEG・PNG・WebPを選んでください。');if(file.size>8000000)throw Error('画像は8MB以内にしてください。');setBusy(true);await preflightImage(file);image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('画像を読み込めませんでした。'));reader.readAsDataURL(file);});previewUrl=URL.createObjectURL(file);$('preview').src=previewUrl;$('preview').classList.remove('hidden');$('placeholder').classList.add('hidden');setBusy(false);await evaluate(started);}catch(e){image=null;$('error').textContent=e.message;$('status').textContent='画像を選び直してください';setBusy(false);}}
$('file').onchange=()=>acceptFile($('file').files[0]);
$('dropzone').onclick=()=>{if(!busy)$('file').click();};$('dropzone').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(!busy)$('file').click();}};
for(const type of ['dragover','drop'])document.addEventListener(type,e=>e.preventDefault());
$('dropzone').ondragover=e=>{e.preventDefault();if(!busy)$('dropzone').classList.add('drag');};$('dropzone').ondragleave=()=>$('dropzone').classList.remove('drag');
$('dropzone').ondrop=e=>{e.preventDefault();$('dropzone').classList.remove('drag');if(busy)return;if(e.dataTransfer.files.length!==1){$('error').textContent='写真を1枚ずつドロップしてください。';return;}acceptFile(e.dataTransfer.files[0]);};
$('model').onchange=()=>{clear();if(image)evaluate();};$('evaluate').onclick=evaluate;
for(const key of ['text','landscape','coverage'])$('prompt-'+key).oninput=()=>{clear();$('status').textContent='プロンプト変更後は再判定してください';};
$('reset-prompts').onclick=()=>{if(!defaults)return;for(const key of Object.keys(defaults))$('prompt-'+key).value=defaults[key];clear();};
function sampleRow(sample){const tr=document.createElement('tr');tr.dataset.id=sample.id;const cells=Array.from({length:7},()=>tr.appendChild(document.createElement('td')));const thumbnail=document.createElement('img');thumbnail.alt=sample.name;thumbnail.loading='lazy';if(sample.image)thumbnail.src=sample.image;thumbnail.tabIndex=0;thumbnail.style.cursor='zoom-in';thumbnail.onclick=()=>openPreview(sample.image,sample.name);thumbnail.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openPreview(sample.image,sample.name);}};cells[0].append(thumbnail);cells[1].textContent=sample.name;const r=sample.result;if(r){['文字情報','風景'].forEach((key,i)=>{const p=r.answers[key].noul;cells[i+2].textContent=`${p>=.5?'該当':'非該当'} ${(p*100).toFixed(1)}%`;cells[i+2].className=p>=.5?'yes':'no';});cells[4].textContent=`約 ${r.coverage_percent}%`;cells[5].textContent=Number.isFinite(r.total_ms)?`処理 ${r.total_ms.toFixed(1)} ms ／ 推論 ${r.response_ms.toFixed(1)} ms`:`推論 ${r.response_ms.toFixed(1)} ms`;const details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent=r.model.replace('jeff-qwen3.5-','Qwen ');pre.textContent=JSON.stringify({日時:r.created_at,プロンプト:r.prompts,モデル版:r.revision},null,2);pre.style.whiteSpace='pre-wrap';details.append(summary,pre);cells[6].append(details);}else cells[6].textContent=sample.error||'未判定';return tr;}
function renderSamples(items=samples,target='samples'){const fragment=document.createDocumentFragment();for(const sample of items)fragment.append(sampleRow(sample));$(target).replaceChildren(fragment);}
function updateSample(sample,target){const row=Array.from($(target).children).find(row=>row.dataset.id===sample.id);if(row)row.replaceWith(sampleRow(sample));}

async function loadSamples(){try{const data=await api('/testjeff/photo-samples');defaults=data.prompts;for(const key of Object.keys(defaults))if(!$('prompt-'+key).value)$('prompt-'+key).value=defaults[key];samples=data.samples;for(const sample of samples){try{sample.image=(await api('/testjeff/photo-samples/'+sample.id)).image;}catch(e){sample.error=e.message;}}renderSamples();$('sample-status').textContent=`${samples.length}枚`;}catch(e){$('error').textContent=e.message;}}
$('key').onchange=loadSamples;
$('run-samples').onclick=async()=>{if(busy)return;setBusy(true);$('error').textContent='';let completed=0,failed=0;try{const selected=$('model').value,instructions=prompts();await prepareModel(selected);for(const sample of samples){$('sample-status').textContent=`${completed+failed+1} / ${samples.length}枚を判定中`;try{const started=performance.now();const data=await api('/testjeff/photos',{model:selected,sample_id:sample.id,prompts:instructions});data.total_ms=performance.now()-started;validate(data,selected);sample.result=data;sample.error=null;completed++;}catch(e){sample.result=null;sample.error=e.message;failed++;}updateSample(sample,'samples');}$('sample-status').textContent=`${completed}枚完了${failed?`・${failed}枚失敗`:''}`;$('status').textContent='サンプル判定完了';}catch(e){$('error').textContent=e.message;}finally{setBusy(false);}};
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
  let completed=0,failed=0;const batchStarted=performance.now();
  try{
    const selected=$('model').value,instructions=prompts();
    for(const entry of folderImages){entry.result=null;entry.error=null;}
    renderSamples(folderImages,'folder-results');let modelReady=false;
    for(const entry of folderImages){
      if(stopFolder)break;
      $('folder-status').textContent=`${completed+failed+1} / ${folderImages.length}枚を判定中`;
      const started=performance.now();
      try{
        await preflightImage(entry.file);
        if(!modelReady){await prepareModel(selected);modelReady=true;}
        const picture=await readFolderFile(entry.file);
        const result=await api('/testjeff/photos',{model:selected,image:picture,prompts:instructions});
        validate(result,selected);result.total_ms=performance.now()-started;entry.result=result;completed++;
      }catch(e){entry.error=e.message;failed++;}
      updateSample(entry,'folder-results');
    }
    $('folder-status').textContent=`${completed}枚完了・${failed}枚失敗・${folderImages.length-completed-failed}枚未判定`;
    $('folder-elapsed').textContent=`全体 ${((performance.now()-batchStarted)/1000).toFixed(2)} 秒（準備・転送・画面更新を含む）`;
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

// 画像を展開せずヘッダーのみを読む。最終的な形式検証はサーバーでも行う。
async function imageDimensions(file){
  async function bytes(offset,length){return new Uint8Array(await file.slice(offset,offset+length).arrayBuffer());}
  const head=await bytes(0,32),view=new DataView(head.buffer);
  if(head.length>=24&&head[0]===137&&String.fromCharCode(...head.slice(1,4))==='PNG')return [view.getUint32(16),view.getUint32(20)];
  if(head[0]===255&&head[1]===216){
    let pos=2;
    while(pos+4<=file.size){
      const block=await bytes(pos,4);
      if(block[0]!==255)break;
      const marker=block[1];
      if(marker===255){pos++;continue;}
      if(marker===217||marker===218)break;
      if(marker===1||marker>=208&&marker<=215){pos+=2;continue;}
      const length=block[2]*256+block[3];if(length<2||pos+2+length>file.size)break;
      if(marker>=192&&marker<=207&&![196,200,204].includes(marker)){
        const size=await bytes(pos+5,4);if(size.length===4)return [size[2]*256+size[3],size[0]*256+size[1]];
      }
      pos+=2+length;
    }
  }
  if(head.length>=30&&String.fromCharCode(...head.slice(0,4))==='RIFF'&&String.fromCharCode(...head.slice(8,12))==='WEBP'){
    const tag=String.fromCharCode(...head.slice(12,16));
    if(tag==='VP8X')return [1+head[24]+head[25]*256+head[26]*65536,1+head[27]+head[28]*256+head[29]*65536];
    if(tag==='VP8 ')return [view.getUint16(26,true)&16383,view.getUint16(28,true)&16383];
    if(tag==='VP8L'){const bits=view.getUint32(21,true);return [(bits&16383)+1,((bits>>>14)&16383)+1];}
  }
  return null;
}
async function preflightImage(file){
  if(file.size>8000000)throw Error('画像は8MB以内にしてください。');
  const size=await imageDimensions(file);
  if(size&&size[0]*size[1]>16000000)throw Error(`対象外：${size[0]} × ${size[1]} px（1600万画素超）`);
  return size;
}
function openPreview(src,name){if(!src)return;$('large-image').src=src;$('large-image').alt=name;$('preview-name').textContent=name;$('image-dialog').showModal();}
$('close-preview').onclick=()=>$('image-dialog').close();
$('image-dialog').onclick=e=>{if(e.target===$('image-dialog'))$('image-dialog').close();};
$('image-dialog').onclose=()=>$('large-image').removeAttribute('src');
$('preview').onclick=e=>{e.stopPropagation();openPreview($('preview').src,'判定する画像');};
