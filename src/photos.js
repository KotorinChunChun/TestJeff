'use strict';
const $=id=>document.getElementById(id);
const modelNames={'qwen-0.8b':'jeff-qwen3.5-0.8b','qwen-2b':'jeff-qwen3.5-2b'};
let image=null,busy=false,previewUrl=null;
function setBusy(value){busy=value;for(const id of ['file','model','key'])$(id).disabled=value;$('evaluate').disabled=value||!image;}
function clear(){ $('error').textContent='';$('summary').textContent='未判定';$('timing').textContent='';for(const id of ['text-result','landscape-result']){const node=$(id);node.className='result';node.querySelector('.answer').textContent='—';node.querySelector('.percent').textContent='—';node.querySelector('.fill').style.width='0%';}}
async function api(path,body){const headers={};if($('key').value)headers.Authorization=`Bearer ${$('key').value}`;if(body)headers['Content-Type']='application/json';const response=await fetch(path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok){if(response.status===401)$('auth').classList.remove('hidden');throw Error(response.status===401?'APIキーを入力してください。':typeof data.detail==='string'?data.detail:'画像の判定に失敗しました。画像とモデルを確認してください。');}return data;}
async function evaluate(){
  if(busy||!image)return;clear();setBusy(true);const selected=$('model').value;
  try{
    $('status').textContent='モデルを準備中';const state=await api('/testjeff/model',{model:selected});
    if(!state.ready||state.selected!==selected)throw Error('モデルを読み込めませんでした。');
    $('status').textContent='画像を判定中';const start=performance.now(),data=await api('/testjeff/photos',{model:selected,image}),elapsed=performance.now()-start;
    if(data.model!==modelNames[selected])throw Error('モデルが変更されました。再判定してください。');
    const values=['文字情報','風景'].map(key=>data.answers?.[key]?.noul);
    if(!values.every(p=>typeof p==='number'&&Number.isFinite(p)&&p>=0&&p<=1))throw Error('判定の応答が不正です。');
    values.forEach((p,i)=>{const node=$(i===0?'text-result':'landscape-result');node.className=`result ${p>=.5?'yes':'no'}`;node.querySelector('.answer').textContent=p>=.5?'当てはまります':'当てはまりません';node.querySelector('.percent').textContent=`${(p*100).toFixed(1)}%`;node.querySelector('.fill').style.width=`${p*100}%`;});
    const [text,landscape]=values.map(p=>p>=.5);$('summary').textContent=text&&landscape?'文字情報を含む風景の写真':text?'文字情報を含む写真':landscape?'風景の写真':'どちらにも当てはまりません';
    $('timing').textContent=`応答時間 ${elapsed.toFixed(1)} ms・判定画像 ${data.input_size.join(' × ')} px`;$('status').textContent='判定完了';
  }catch(e){$('error').textContent=e.message;$('status').textContent='判定失敗';}finally{setBusy(false);}
}
$('file').onchange=async()=>{
  if(busy)return;clear();image=null;$('preview').classList.add('hidden');$('placeholder').classList.remove('hidden');if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}const file=$('file').files[0];setBusy(false);if(!file)return;
  try{if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('JPEG・PNG・WebPを選んでください。');if(file.size>8000000)throw Error('画像は8MB以内にしてください。');setBusy(true);image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('画像を読み込めませんでした。'));reader.readAsDataURL(file);});previewUrl=URL.createObjectURL(file);$('preview').src=previewUrl;$('preview').classList.remove('hidden');$('placeholder').classList.add('hidden');setBusy(false);await evaluate();}catch(e){image=null;$('error').textContent=e.message;$('status').textContent='画像を選び直してください';setBusy(false);}
};
$('model').onchange=()=>{clear();if(image)evaluate();};$('evaluate').onclick=evaluate;
api('/health').then(h=>$('auth').classList.toggle('hidden',!h.authentication)).catch(()=>{});
