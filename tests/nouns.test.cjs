// 抽選の境界・一意性と日本語リクエストの構築を確認する。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {protocol, draw, makeRequest, accumulate} = require('../src/nouns-core.js');
const root = path.join(__dirname, '..');
const groups = JSON.parse(fs.readFileSync(path.join(root, 'src/data/nouns.json'), 'utf8'));
const words = groups.flatMap(group => group.words);
const targets = JSON.parse(fs.readFileSync(path.join(root, 'src/data/abstract-nouns.json'),'utf8'));
assert.equal(new Set(targets).size, targets.length);
assert(targets.includes('動物') && !targets.includes('犬'));
assert.equal(words.length, 1000); assert.equal(new Set(words).size, 1000);
assert(words.every(word => word && word === word.trim()));
const source = fs.readFileSync(path.join(root, 'src/data/nouns-source.txt'), 'utf8');
assert.deepEqual(source.trim().split(/\r?\n/).map(line => {const [category, text] = line.split('|'); return {category, words:text.split(' ')};}), groups);
let seed = 13579;
const random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2**32;};
const draws = new Set();
for (let n=0; n<100; n++) {
  const result = draw(words, targets, 10, random);
  assert(targets.includes(result.target)); assert.equal(new Set(result.candidates).size, 10);
  assert(result.candidates.every(word => words.includes(word))); draws.add(JSON.stringify(result));
}
assert.equal(draws.size, 100);
assert.equal(draw(words, targets, 10, () => 0).target, targets[0]);
assert.equal(draw(words, targets, 10, () => .999999).target, targets.at(-1));
assert.throws(() => draw(['犬'], targets, 10));
assert.throws(() => makeRequest(' ', '犬'));
assert.throws(() => makeRequest('動物', 'あ'.repeat(81)));
const request = makeRequest(' 動物 ', ' 猫 ');
assert.equal(request.questions.判定.type, 'noul');
assert.equal(protocol, 'noun-v2');
assert.equal(request.state, '名詞の一般的な意味に基づいて判定してください。');
assert.equal(request.questions.判定.instructions, '「猫」は「動物」ですか？');
assert.deepEqual(request.questions.判定.criteria, {true:'動物に当てはまる',false:'動物ではない'});
assert.equal(makeRequest(' 「日常」\nの物 ', ' "机"\nの上 ').questions.判定.instructions, '「"机"\nの上」は「「日常」\nの物」ですか？');
assert.equal(makeRequest('\ufeff動物\u3000','\t猫\r\n').questions.判定.instructions, '「猫」は「動物」ですか？');
assert.doesNotThrow(()=>makeRequest('動物','🐱'.repeat(40)));
assert.throws(()=>makeRequest('動物','🐱'.repeat(41)));
console.log('名詞1,000語、100回の抽選、重複防止、入力検証、日本語リクエストを確認しました。');

const first = accumulate(null, Array(10).fill(20), Array(10).fill(.2));
const second = accumulate(first, Array(10).fill(40), Array(10).fill(.8));
assert.equal(second.runs,2); assert.equal(second.count,20); assert.equal(second.totalMs/second.count,30); assert(Math.abs(second.probabilitySum/second.count-.5)<1e-10);
assert.throws(() => accumulate(null, [10], [.5]));
