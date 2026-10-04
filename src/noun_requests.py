"""個別・一括で同じ文面を使う名詞判定リクエスト。nouns-core.js と契約を共有する。"""
from __future__ import annotations

PROTOCOL = 'noun-v2'
STATE = '名詞の一般的な意味に基づいて判定してください。'
# Python strip() と ECMAScript trim() の空白集合は異なるため、後者に合わせる。
_JS_WHITESPACE = '\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'


def make_request(target: str, candidate: str, model: str = 'jeff-latest') -> dict:
    target, candidate = target.strip(_JS_WHITESPACE), candidate.strip(_JS_WHITESPACE)
    if not target or not candidate:
        raise ValueError('名詞を入力してください。')
    # JavaScript String.length は UTF-16 コード単位数。絵文字も同じ境界にする。
    if any(len(value.encode('utf-16-le', errors='surrogatepass')) // 2 > 80 for value in (target, candidate)):
        raise ValueError('名詞は80文字以内で入力してください。')
    return {'model': model, 'state': STATE, 'questions': {
        '判定': {'type': 'noul', 'instructions': f'「{candidate}」は「{target}」ですか？',
               'criteria': {'true': f'{target}に当てはまる', 'false': f'{target}ではない'}}}}


def make_batch_request(target: str, candidates: list[str], model: str, offset: int = 0) -> dict:
    questions = {f'item_{offset + index}': make_request(target, candidate, model)['questions']['判定']
                 for index, candidate in enumerate(candidates)}
    return {'model': model, 'state': STATE, 'questions': questions}
