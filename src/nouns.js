'use strict';
const $ = id => document.getElementById(id);
let words = [], running = false, controller = null;
const rows = [];

function showError(message = '') {
  $('error').textContent = message;
  $('error').classList.toggle('hidden', !message);
}
function clearResults() {
  for (const row of rows) {
    row.percent.textContent = '—'; row.fill.style.width = '0%';
    row.answer.textContent = '未評価'; row.answer.className = 'answer';
  }
  $('progress').textContent = '10件'; $('total').textContent = '';
}
function setBusy(value) {
  running = value;
  for (const id of ['random', 'evaluate', 'target', 'key']) $(id).disabled = value;
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
    tr.append(number, noun, probability, answer); $('rows').append(tr);
    rows.push({input, percent, fill, answer});
  });
  clearResults();
}
async function evaluate() {
  if (running) return;
  showError();
  let requests;
  try { requests = rows.map(row => NounCore.makeRequest($('target').value, row.input.value)); }
  catch (error) {showError(error.message); return;}
  clearResults(); setBusy(true); controller = new AbortController();
  const started = performance.now(); let completed = 0, failed = 0;
  try {
    for (const [index, request] of requests.entries()) {
      if (controller.signal.aborted) break;
      const row = rows[index]; row.answer.textContent = '評価中'; $('progress').textContent = `${index + 1} / 10件を評価中`;
      try {
        const headers = {'Content-Type':'application/json'};
        if ($('key').value) headers.Authorization = `Bearer ${$('key').value}`;
        const response = await fetch('/v1/systemone', {method:'POST', headers, body:JSON.stringify(request), signal:controller.signal});
        if (response.status === 401) {$('auth').classList.remove('hidden'); throw new Error('APIキーを入力してください。');}
        if (!response.ok) throw new Error(response.status === 529 ? '別の判定を実行中です。少し待って再実行してください。' : `評価に失敗しました（${response.status}）。`);
        const data = await response.json(), probability = data.answers?.判定?.noul;
        if (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error('確率の応答が不正です。');
        row.percent.textContent = `${(probability * 100).toFixed(1)}%`;
        row.fill.style.width = `${probability * 100}%`;
        row.answer.textContent = probability >= .5 ? 'はい' : 'いいえ';
        row.answer.className = probability >= .5 ? 'answer yes' : 'answer no';
        $('model').textContent = data.model || 'Jeff'; completed++;
      } catch (error) {
        if (controller.signal.aborted) {row.answer.textContent = '中止'; break;}
        row.answer.textContent = '失敗'; failed++; showError(error instanceof TypeError ? 'サーバーへ接続できません。' : error.message);
        // 認証・接続等の障害時に残りの候補への無駄な送信をしない。
        break;
      }
    }
    $('progress').textContent = controller.signal.aborted ? `${completed} / 10件で中止` : failed ? `${completed} / 10件完了・エラー` : `${completed} / 10件完了`;
    $('total').textContent = `${((performance.now() - started) / 1000).toFixed(2)}秒`;
  } finally {setBusy(false); controller = null;}
}
$('random').onclick = async () => {
  if (running || !words.length) return;
  const chosen = NounCore.draw(words);
  $('target').value = chosen.target; createRows(chosen.candidates);
  await evaluate();
};
$('evaluate').onclick = evaluate;
$('cancel').onclick = () => {controller?.abort(); $('cancel').disabled = true;};
$('target').addEventListener('input', clearResults);

(async () => {
  try {
    const response = await fetch('/testjeff/nouns');
    if (!response.ok) throw new Error('名詞を読み込めませんでした。');
    const groups = await response.json(); words = groups.flatMap(group => group.words);
    if (words.length < 10 || new Set(words).size !== words.length) throw new Error('名詞辞書の形式が不正です。');
    const options = document.createDocumentFragment();
    for (const word of words) {const option = document.createElement('option'); option.value = word; options.append(option);}
    $('noun-list').append(options); $('word-count').textContent = `${words.length.toLocaleString('ja-JP')}語`;
    createRows(['犬','猫','馬','象','イルカ','りんご','椅子','自転車','鉛筆','雨']); setBusy(false);
  } catch (error) {showError(error.message); $('progress').textContent = '読み込み失敗';}
  try {
    const response = await fetch('/health'), health = await response.json();
    $('model').textContent = health.model || 'Jeff'; $('auth').classList.toggle('hidden', !health.authentication);
  } catch {$('model').textContent = '未接続';}
})();
