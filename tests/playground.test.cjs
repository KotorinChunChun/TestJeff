// 日本語画面のサンプル選択・送信内容を、外部ライブラリなしで検証する。
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = join(__dirname, '..');
const html = readFileSync(join(root, 'src/playground.html'), 'utf8');
const samples = JSON.parse(readFileSync(join(root, 'tests/requests.json'), 'utf8'));
class Element {
  constructor() { this.value = ''; this.children = []; this.dataset = {}; this.style = {}; this.textContent = ''; this.classList = {add(){}, remove(){}, toggle(){}}; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute() {}
  addEventListener() {}
}
const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(m => [m[1], new Element()]));
const sent = [];
const context = vm.createContext({
  document: {getElementById: id => elements.get(id), createElement: () => new Element(), querySelectorAll: () => elements.get('samples').children},
  performance, setTimeout,
  fetch: async (url, options) => {
    if (url === '/testjeff/examples') return {json: async () => samples};
    if (url === '/health') return {json: async () => ({status:'ready'})};
    const body = JSON.parse(options.body); sent.push(body);
    return {ok:true, text:async () => JSON.stringify({answers:{}, usage:{input_tokens:1}})};
  }
});
(async () => {
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.get('samples').children.length, samples.length);
  for (let i=0; i<samples.length; i++) {
    const button = elements.get('samples').children[i];
    assert.equal(button.textContent, samples[i].name);
    button.onclick();
    await elements.get('form').onsubmit({preventDefault(){}});
    const actual = sent.at(-1), expected = samples[i].request;
    assert.equal(actual.state, expected.state);
    assert.deepEqual(actual.questions, expected.questions);
    assert.equal(actual.orders, expected.orders || 1);
  }
  assert.equal(elements.get('status').textContent, '準備完了');
  assert.equal(elements.get('run').textContent, '判定する');
  assert(!html.includes('Support ticket'));
  console.log(`日本語サンプル${samples.length}件の選択・質問・順序反転の送信を確認しました。`);
})().catch(error => { console.error(error); process.exitCode = 1; });
