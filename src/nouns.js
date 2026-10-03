'use strict';
const $ = id => document.getElementById(id);
let words = [], targets = [], running = false, controller = null, selectedModel = null, ready = false;
const MODEL_NAMES = {'qwen-0.8b':'jeff-qwen3.5-0.8b','qwen-2b':'jeff-qwen3.5-2b','gemma-e2b':'jeff-gemma-4-e2b-it'};
const STORAGE_KEY = 'testjeff-nouns-stats-v1';
let statistics = loadStatistics();
const rows = [];

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
  }
  $('progress').textContent = '10件'; $('total').textContent = '';
}
function setBusy(value) {
  running = value;
  for (const id of ['random', 'evaluate', 'target']) $(id).disabled = value || !ready;
  for (const id of ['model-select', 'key', 'reset']) $(id).disabled = value;
  rows.forEach(row => {row.input.disabled = value;});
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
    tr.append(number, noun, probability, answer, timing); $('rows').append(tr);
    rows.push({input, percent, fill, answer, timing});
  });
  clearResults();
}
async function evaluate(accumulate = false) {
  if (running || !ready) return;
  showError();
  let requests;
  const runModel = selectedModel, timings = [], probabilities = [];
  try {
    if (!targets.includes($('target').value)) throw new Error('質問は分類名から選んでください。');
    requests = rows.map(row => ({...NounCore.makeRequest($('target').value, row.input.value), model:MODEL_NAMES[runModel]}));
  }
  catch (error) {showError(error.message); return;}
  clearResults(); setBusy(true); controller = new AbortController();
  const started = performance.now(); let completed = 0, failed = 0;
  try {
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
        row.answer.textContent = probability >= .5 ? 'はい' : 'いいえ';
        row.answer.className = probability >= .5 ? 'answer yes' : 'answer no';
        row.timing.textContent = `${elapsed.toFixed(1)} ms`; timings.push(elapsed); probabilities.push(probability);
        $('model').textContent = data.model || 'Jeff'; completed++;
      } catch (error) {
        if (controller.signal.aborted) {row.answer.textContent = '中止'; break;}
        row.answer.textContent = '失敗'; failed++; showError(error instanceof TypeError ? 'サーバーへ接続できません。' : error.message);
        // 認証・接続等の障害時に残りの候補への無駄な送信をしない。
        break;
      }
    }
    $('progress').textContent = controller.signal.aborted ? `${completed} / 10件で中止` : failed ? `${completed} / 10件完了・エラー` : `${completed} / 10件完了`;
    $('total').textContent = `今回 ${((performance.now() - started) / 1000).toFixed(2)}秒${timings.length ? `・平均 ${(timings.reduce((a,b)=>a+b,0)/timings.length).toFixed(1)} ms/件` : ''}`;
    if (accumulate && completed === 10 && !failed && !controller.signal.aborted) {
      statistics = {...statistics, ...loadStatistics()};
      statistics[runModel] = NounCore.accumulate(statistics[runModel], timings, probabilities);
      saveStatistics(); renderStatistics();
    }
  } finally {setBusy(false); controller = null;}
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
    if (!response.ok) throw new Error(response.status === 409 ? '別の評価が実行中です。終了後に選び直してください。' : 'モデルを読み込めません。小さいモデルを選んでください。');
    const status = await response.json(); selectedModel = status.selected; ready = status.ready;
    $('model').textContent = MODEL_NAMES[selectedModel]; $('progress').textContent = 'モデル切り替え完了';
  } catch (error) {
    showError(error.message); $('progress').textContent = '切り替え失敗';
    try {const state = await (await fetch('/testjeff/status')).json(); selectedModel = state.selected; ready = state.ready;} catch {ready = false;}
    $('model').textContent = ready ? MODEL_NAMES[selectedModel] : 'モデル未読込';
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
    $('target').replaceChildren();
    for (const word of targets) {const option = document.createElement('option'); option.value = word; option.textContent = word; $('target').append(option);}
    $('target').value = '動物';
    const options = document.createDocumentFragment();
    for (const word of words) {const option = document.createElement('option'); option.value = word; options.append(option);}
    $('noun-list').append(options); $('word-count').textContent = `${words.length.toLocaleString('ja-JP')}語`;
    const statusResponse = await fetch('/testjeff/status');
    if (!statusResponse.ok) throw new Error('モデルの状態を確認できませんでした。');
    const status = await statusResponse.json(); selectedModel = status.selected; ready = status.ready;
    $('model-select').value = selectedModel || '';
    createRows(['犬','猫','馬','象','イルカ','りんご','椅子','自転車','鉛筆','雨']); renderStatistics(); setBusy(false);
  } catch (error) {showError(error.message); $('progress').textContent = '読み込み失敗';}
  try {
    const response = await fetch('/health'), health = await response.json();
    $('model').textContent = health.model || 'Jeff'; $('auth').classList.toggle('hidden', !health.authentication);
  } catch {$('model').textContent = '未接続';}
})();
