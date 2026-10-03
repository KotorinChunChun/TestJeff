// 抽選とJevリクエストの構築。ブラウザーと検証で共有する。
(function (root) {
  'use strict';
  function draw(words, count = 10, random = Math.random) {
    const pool = [...new Set(words)];
    if (pool.length < count) throw new Error('名詞が不足しています。');
    const target = pool[Math.floor(random() * pool.length)];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return {target, candidates: pool.slice(0, count)};
  }
  function makeRequest(target, candidate) {
    const a = target.trim(), b = candidate.trim();
    if (!a || !b) throw new Error('名詞を入力してください。');
    if (a.length > 80 || b.length > 80) throw new Error('名詞は80文字以内で入力してください。');
    return {model: 'jeff-latest', state: {対象: b}, questions: {
      判定: {type: 'noul', instructions: `これは${a}ですか？ 対象の名詞の一般的な意味に基づいて判定してください。`,
        criteria: {true: `${a}に当てはまる`, false: `${a}ではない`}}
    }};
  }
  const api = {draw, makeRequest};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NounCore = api;
})(globalThis);
