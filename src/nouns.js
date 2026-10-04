'use strict';
const $ = id => document.getElementById(id);
let words = [], targets = [], running = false, controller = null, selectedModel = null, ready = false;
const MODEL_NAMES = {'qwen-0.8b':'jeff-qwen3.5-0.8b','qwen-2b':'jeff-qwen3.5-2b','gemma-e2b':'jeff-gemma-4-e2b-it'};
const STORAGE_KEY = 'testjeff-nouns-stats-v1'+(window.TestJeffConnection?.key&&window.TestJeffConnection.key!=='local'?':'+window.TestJeffConnection.key:'');
let statistics = loadStatistics();
const rows = [];
function connectionSnapshot() {
  const c=window.TestJeffConnection?.config||{};
  return {mode:c.mode||'local',host:c.host??null,port:c.port??null,device:c.device??null,local_device:c.local_device??null,auto_unload:c.auto_unload!==false};
}

function renderResources(data) {
  const size = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `${(value / 2**30).toFixed(2)} GiB` : '取得不可';
  $('resource-memory').textContent = size(data?.memory_bytes);
  $('resource-gpu').textContent = data?.device === 'cpu' ? '未使用' : size(data?.gpu_allocated_bytes);
  $('resource-reserved').textContent = data?.device === 'cpu' ? '未使用' : size(data?.gpu_reserved_bytes);
  $('resource-cpu').textContent = typeof data?.cpu_percent === 'number' && Number.isFinite(data.cpu_percent) ? `${data.cpu_percent.toFixed(1)}%` : data ? '計測中' : '取得不可';
}
async function pollResources() {
  try {
    if (!document.hidden) {
      const headers = {};
      if ($('key').value) headers.Authorization = `Bearer ${$('key').value}`;
      const response = await fetch('/testjeff/resources', {headers, cache:'no-store', signal:AbortSignal.timeout(5000)});
      if (!response.ok) throw new Error('取得失敗');
      renderResources(await response.json());
    }
  } catch {renderResources(null);}
  finally {setTimeout(pollResources, 2000);}
}
pollResources();

function loadStatistics() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'), valid = {};
    for (const [key, item] of Object.entries(value || {})) {
      if (MODEL_NAMES[key] && item && Number.isInteger(item.runs) && item.runs >= 0 && item.count === item.runs * 10 &&
          Number.isFinite(item.totalMs) && item.totalMs >= 0 && Number.isFinite(item.probabilitySum) && item.probabilitySum >= 0 && item.probabilitySum <= item.count) valid[key] = item;
    }
    return valid;
  } catch {return {};}
}
function saveStatistics() {
  try {localStorage.setItem(STORAGE_KEY, JSON.stringify(statistics));}
  catch {showError('集計をブラウザーに保存できませんでした。この画面を閉じるまでは保持します。');}
}
function renderStatistics() {
  const item = statistics[selectedModel] || {runs:0,count:0};
  $('runs').textContent = `${item.runs}回`; $('count').textContent = `${item.count}件`;
  $('average-time').textContent = item.count ? `${(item.totalMs/item.count).toFixed(1)} ms` : '—';
  $('average-probability').textContent = item.count ? `${(item.probabilitySum/item.count*100).toFixed(1)}%` : '—';
}

function showError(message = '') {
  $('error').textContent = message;
  $('error').classList.toggle('hidden', !message);
}
function clearResults() {
  for (const row of rows) {
    row.percent.textContent = '—'; row.fill.style.width = '0%';
    row.answer.textContent = '未評価'; row.answer.className = 'answer';
    row.timing.textContent = '—';
    row.elapsed = null; row.result = null; row.pendingFeedback = null; row.rating = null;
    row.feedbackStatus.textContent = '';
    row.feedbackButtons.forEach(button => {button.disabled = true; button.setAttribute('aria-pressed', 'false');});
  }
  $('progress').textContent = '10件';
}
function setBusy(value) {window.TestJeffBusy=value;window.dispatchEvent(new Event('testjeff-busy'));
  running = value;
  for (const id of ['random', 'evaluate', 'target']) $(id).disabled = value || (!ready&&window.TestJeffConnection?.config.mode!=='fds');
  for (const id of ['model-select', 'key', 'reset', 'sort-order']) $(id).disabled = value;
  rows.forEach(row => {
    row.input.disabled = value;
    row.feedbackButtons.forEach(button => {button.disabled = value || !row.result || row.saving;});
  });
  $('cancel').classList.toggle('hidden', !value);
  $('cancel').disabled = false;
}
function createRows(candidates) {
  $('rows').replaceChildren(); rows.length = 0;
  candidates.forEach((word, index) => {
    const tr = document.createElement('tr');
    const number = document.createElement('td'); number.textContent = index + 1;
    const noun = document.createElement('td'), input = document.createElement('input');
    input.value = word; input.maxLength = 80; input.setAttribute('list', 'noun-list');
    input.setAttribute('aria-label', `候補${index + 1}`); input.addEventListener('input', clearResults); noun.append(input);
    const probability = document.createElement('td'), box = document.createElement('div'); box.className = 'probability';
    const track = document.createElement('div'); track.className = 'track';
    const fill = document.createElement('div'); fill.className = 'fill'; track.append(fill);
    const percent = document.createElement('span'); percent.className = 'percent'; box.append(track, percent); probability.append(box);
    const answer = document.createElement('td'); answer.className = 'answer';
    const timing = document.createElement('td'); timing.className = 'timing';
    const feedback = document.createElement('td'); feedback.className = 'feedback';
    const buttons = document.createElement('div'); buttons.className = 'feedback-buttons';
    const feedbackStatus = document.createElement('span'); feedbackStatus.className = 'feedback-status'; feedbackStatus.setAttribute('role', 'status');
    const row = {tr, number, input, percent, fill, answer, timing, feedbackStatus, feedbackButtons:[], originalIndex:index, elapsed:null, result:null, saving:false};
    for (const rating of ['良かった','悪かった']) {
      const button = document.createElement('button'); button.textContent = rating; button.disabled = true; button.setAttribute('aria-pressed', 'false');
      button.onclick = () => saveFeedback(row, rating); buttons.append(button); row.feedbackButtons.push(button);
    }
    feedback.append(buttons, feedbackStatus);
    tr.append(number, noun, probability, answer, timing, feedback); $('rows').append(tr);
    rows.push(row);
  });
  clearResults();
  sortResults();
}
function sortResults() {
  const mode = $('sort-order').value;
  const nameOrder = new Intl.Collator('ja', {numeric:true});
  const resultRank = row => row.result ? (row.result.probability >= .5 ? 0 : 1) : 2;
  const sorted = [...rows].sort((a,b) => {
    const difference = mode === 'name' ? nameOrder.compare(a.input.value.trim(), b.input.value.trim()) :
      mode === 'result' ? resultRank(a) - resultRank(b) : (a.elapsed ?? Infinity) - (b.elapsed ?? Infinity);
    return difference || a.originalIndex - b.originalIndex;
  });
  sorted.forEach((row,index) => {row.number.textContent = index+1; row.input.setAttribute('aria-label', `候補${index+1}`); $('rows').append(row.tr);});
}
$('sort-order').onchange = sortResults;
async function saveFeedback(row, rating) {
  if (running || row.saving || !row.result || row.rating === rating) return;
  const snapshot = row.result;
  if (!row.pendingFeedback || row.pendingFeedback.rating !== rating) row.pendingFeedback = {...snapshot, rating, event_id:crypto.randomUUID()};
  const payload = row.pendingFeedback;
  row.saving = true; row.feedbackButtons.forEach(button => {button.disabled = true;}); row.feedbackStatus.textContent = '保存中';
  try {
    const headers = {'Content-Type':'application/json'};
    if ($('key').value) headers.Authorization = `Bearer ${$('key').value}`;
    const response = await fetch('/testjeff/feedback', {method:'POST',headers,body:JSON.stringify(payload)});
    if (!response.ok) {
      if (response.status === 401) $('auth').classList.remove('hidden');
      throw new Error('保存できませんでした。再試行してください。');
    }
    const stored = await response.json();
    if (stored.event_id !== payload.event_id || stored.rating !== rating) throw new Error('保存内容を確認できませんでした。再試行してください。');
    if (row.result === snapshot) {
      row.rating = rating; row.pendingFeedback = null; row.feedbackStatus.textContent = `${rating}・記録済み`;
      row.feedbackButtons.forEach(button => button.setAttribute('aria-pressed', String(button.textContent === rating)));
    }
  } catch (error) {if (row.result === snapshot) row.feedbackStatus.textContent = error.message;}
  finally {
    row.saving = false;
    row.feedbackButtons.forEach(button => {button.disabled = running || !row.result;});
  }
}
async function evaluate(accumulate = false) {
  if (running || (!ready && window.TestJeffConnection?.config.mode!=='fds')) return;
  showError();
  let requests;
  const runModel = $('model-select').value || selectedModel, runTarget = $('target').value.trim(), runId = crypto.randomUUID(), timings = [], probabilities = [], runCandidates = rows.map(row => row.input.value.trim());
  try {
    requests = runCandidates.map(candidate => ({...NounCore.makeRequest(runTarget, candidate), model:MODEL_NAMES[runModel]}));
  }
  catch (error) {showError(error.message); return;}
  const parameters={schema_version:1,connection:connectionSnapshot(),statistics_key:STORAGE_KEY,sort_mode:$('sort-order').value,
    accumulate,input_method:accumulate?'random':'manual',threshold:0.5,started_at:new Date().toISOString()};
  clearResults(); setBusy(true); controller = new AbortController();
  let completed = 0, failed = 0;
  try {
    if(window.TestJeffConnection?.config.mode==='fds'){
      try{const state=await window.TestJeffConnection.prepare(runModel);selectedModel=runModel;ready=true;parameters.management=state.management||null;}
      catch(e){showError(e.message);$('progress').textContent=window.TestJeffConnection.isCancelled(e)?'中止':'準備失敗';return;}
    }
    for (const [index, request] of requests.entries()) {
      if (controller.signal.aborted) break;
      const row = rows[index]; row.answer.textContent = '評価中'; $('progress').textContent = `${index + 1} / 10件を評価中`;
      try {
        const sentAt = performance.now();
        const headers = {'Content-Type':'application/json'};
        if ($('key').value) headers.Authorization = `Bearer ${$('key').value}`;
        const response = await fetch('/v1/systemone', {method:'POST', headers, body:JSON.stringify(request), signal:controller.signal});
        if (response.status === 401) {$('auth').classList.remove('hidden'); throw new Error('APIキーを入力してください。');}
        if (!response.ok) throw new Error(response.status === 529 ? '別の判定を実行中です。少し待って再実行してください。' : `評価に失敗しました（${response.status}）。`);
        const data = await response.json(), probability = data.answers?.判定?.noul;
        const elapsed = performance.now() - sentAt;
        if (data.model !== MODEL_NAMES[runModel]) throw new Error('別の画面でモデルが変更されました。モデルを選び直してください。');
        if (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error('確率の応答が不正です。');
        row.percent.textContent = `${(probability * 100).toFixed(1)}%`;
        row.fill.style.width = `${probability * 100}%`;
        row.answer.textContent = `「${runCandidates[index]}」は「${runTarget}」${probability >= .5 ? 'です' : 'ではありません'}`;
        row.answer.className = probability >= .5 ? 'answer yes' : 'answer no';
        row.elapsed = elapsed;
        row.result = {result_id:crypto.randomUUID(), run_id:runId, target:runTarget, candidate:runCandidates[index],
          execution:data.execution||null, reproduction:data.reproduction||null,
          parameters:{...parameters,request:JSON.parse(JSON.stringify({orders:1,...request})),input_index:index},
          model:runModel, probability, response_ms:elapsed, evaluated_at:new Date().toISOString()};
        row.timing.textContent = `${elapsed.toFixed(1)} ms`; timings.push(elapsed); probabilities.push(probability);
        completed++;
      } catch (error) {
        if (controller.signal.aborted) {row.answer.textContent = '中止'; break;}
        row.answer.textContent = '失敗'; failed++; showError(error instanceof TypeError ? 'サーバーへ接続できません。' : error.message);
        // 認証・接続等の障害時に残りの候補への無駄な送信をしない。
        break;
      }
    }
    $('progress').textContent = controller.signal.aborted ? `${completed} / 10件で中止` : failed ? `${completed} / 10件完了・エラー` : `${completed} / 10件完了`;
    if (accumulate && completed === 10 && !failed && !controller.signal.aborted) {
      statistics = {...statistics, ...loadStatistics()};
      statistics[runModel] = NounCore.accumulate(statistics[runModel], timings, probabilities);
      saveStatistics(); renderStatistics();
    }
  } finally {sortResults(); setBusy(false); controller = null;}
}
$('random').onclick = async () => {
  if (running || !words.length) return;
  const chosen = NounCore.draw(words, targets);
  $('target').value = chosen.target; createRows(chosen.candidates);
  await evaluate(true);
};
$('evaluate').onclick = () => evaluate(false);
$('cancel').onclick = () => {controller?.abort(); $('cancel').disabled = true;};
$('target').addEventListener('input', clearResults);
$('reset').onclick = () => {delete statistics[selectedModel]; saveStatistics(); renderStatistics();};
$('download-feedback').onclick = async () => {
  const button = $('download-feedback'); button.disabled = true;
  try {
    const headers = {};
    if ($('key').value) headers.Authorization = `Bearer ${$('key').value}`;
    const response = await fetch('/testjeff/feedback', {headers});
    if (!response.ok) {if(response.status === 401) $('auth').classList.remove('hidden'); throw new Error('記録を取得できませんでした。');}
    const data = await response.json();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)], {type:'application/json;charset=utf-8'}));
    const link = document.createElement('a'); link.href = url; link.download = '名詞判定フィードバック.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  } catch(error) {showError(error.message);}
  finally {button.disabled = false;}
};
$('model-select').onchange = async () => {
  if (running) return;
  const wanted = $('model-select').value;
  setBusy(true); $('cancel').classList.add('hidden'); showError(); clearResults();
  $('progress').textContent = 'モデルを読み込み中';
  try {
    const headers = {'Content-Type':'application/json'};
    if ($('key').value) headers.Authorization = `Bearer ${$('key').value}`;
    const response = await fetch('/testjeff/model', {method:'POST', headers, body:JSON.stringify({model:wanted})});
    if (response.status === 401) {$('auth').classList.remove('hidden'); throw new Error('APIキーを入力してください。');}
    if (!response.ok) {const data=await response.json().catch(()=>({}));throw new Error(data.detail?.message||(typeof data.detail==='string'?data.detail:'モデルを読み込めません。'));}
    const status = await response.json(); selectedModel = status.selected; ready = status.ready;
    $('progress').textContent = 'モデル切り替え完了';
  } catch (error) {
    showError(error.message); $('progress').textContent = window.TestJeffConnection?.isCancelled?.(error)?'切り替えを中止しました':'切り替え失敗';
    if(!window.TestJeffConnection?.isCancelled?.(error))try {const state = await (await fetch('/testjeff/status')).json(); selectedModel = state.selected; ready = state.ready;} catch {ready = false;}
  } finally {
    $('model-select').value = selectedModel || ''; renderStatistics(); setBusy(false);
  }
};

(async () => {
  try {
    const response = await fetch('/testjeff/nouns');
    if (!response.ok) throw new Error('名詞を読み込めませんでした。');
    const groups = await response.json(); words = groups.flatMap(group => group.words);
    if (words.length < 10 || new Set(words).size !== words.length) throw new Error('名詞辞書の形式が不正です。');
    const targetResponse = await fetch('/testjeff/abstract-nouns');
    if (!targetResponse.ok) throw new Error('分類名を読み込めませんでした。');
    targets = await targetResponse.json();
    if (!Array.isArray(targets) || !targets.length || !targets.every(x => typeof x === 'string' && x)) throw new Error('分類名の形式が不正です。');
    $('target-list').replaceChildren();
    for (const word of targets) {const option = document.createElement('option'); option.value = word; $('target-list').append(option);}
    $('target').value = '動物';
    const options = document.createDocumentFragment();
    for (const word of words) {const option = document.createElement('option'); option.value = word; options.append(option);}
    $('noun-list').append(options);
    const statusResponse = await fetch('/testjeff/status');
    if (!statusResponse.ok) throw new Error('モデルの状態を確認できませんでした。');
    const status = await statusResponse.json(); selectedModel = status.selected; ready = status.ready;
    $('model-select').value = selectedModel || '';
    createRows(['犬','猫','馬','象','イルカ','りんご','椅子','自転車','鉛筆','雨']); renderStatistics(); setBusy(false);
  } catch (error) {showError(error.message); $('progress').textContent = '読み込み失敗';}
  try {
    const response = await fetch('/health'), health = await response.json();
    $('auth').classList.toggle('hidden', !health.authentication);
  } catch {}
})();
