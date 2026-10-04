// 抽選とJevリクエストの構築。ブラウザーと検証で共有する。
(function (root) {
  'use strict';
  function draw(words, targets, count = 10, random = Math.random) {
    const pool = [...new Set(words)];
    if (pool.length < count) throw new Error('名詞が不足しています。');
    if (!targets.length) throw new Error('質問の名詞が不足しています。');
    const target = targets[Math.floor(random() * targets.length)];
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
    return {model: 'jeff-latest', state: '名詞の一般的な意味に基づいて判定してください。', questions: {
      判定: {type: 'noul', instructions: `「${b}」は「${a}」ですか？`,
        criteria: {true: `${a}に当てはまる`, false: `${a}ではない`}}
    }};
  }
  function accumulate(previous, timings, probabilities) {
    if (timings.length !== 10 || probabilities.length !== 10 ||
        !timings.every(x => Number.isFinite(x) && x >= 0) ||
        !probabilities.every(x => Number.isFinite(x) && x >= 0 && x <= 1)) throw new Error('集計データが不正です。');
    const old = previous || {runs:0, count:0, totalMs:0, probabilitySum:0};
    return {runs:old.runs+1, count:old.count+10,
      totalMs:old.totalMs+timings.reduce((a,b)=>a+b,0),
      probabilitySum:old.probabilitySum+probabilities.reduce((a,b)=>a+b,0)};
  }
  const api = {protocol:'noun-v2', draw, makeRequest, accumulate};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NounCore = api;
})(globalThis);
