// 抽選の境界・一意性と日本語リクエストの構築を確認する。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {draw, makeRequest} = require('../src/nouns-core.js');
const root = path.join(__dirname, '..');
const groups = JSON.parse(fs.readFileSync(path.join(root, 'src/data/nouns.json'), 'utf8'));
const words = groups.flatMap(group => group.words);
assert.equal(words.length, 1000); assert.equal(new Set(words).size, 1000);
assert(words.every(word => word && word === word.trim()));
const source = fs.readFileSync(path.join(root, 'src/data/nouns-source.txt'), 'utf8');
assert.deepEqual(source.trim().split(/\r?\n/).map(line => {const [category, text] = line.split('|'); return {category, words:text.split(' ')};}), groups);
let seed = 13579;
const random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2**32;};
const draws = new Set();
for (let n=0; n<100; n++) {
  const result = draw(words, 10, random);
  assert(words.includes(result.target)); assert.equal(new Set(result.candidates).size, 10);
  assert(result.candidates.every(word => words.includes(word))); draws.add(JSON.stringify(result));
}
assert.equal(draws.size, 100);
assert.equal(draw(words, 10, () => 0).target, words[0]);
assert.equal(draw(words, 10, () => .999999).target, words.at(-1));
assert.throws(() => draw(['犬'], 10));
assert.throws(() => makeRequest(' ', '犬'));
assert.throws(() => makeRequest('動物', 'あ'.repeat(81)));
const request = makeRequest(' 動物 ', ' 猫 ');
assert.equal(request.questions.判定.type, 'noul');
assert.equal(request.state.対象, '猫');
assert(request.questions.判定.instructions.startsWith('これは動物ですか？'));
console.log('名詞1,000語、100回の抽選、重複防止、入力検証、日本語リクエストを確認しました。');
