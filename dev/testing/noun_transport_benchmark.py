"""常駐CPUモデルで個別/一括の総時間を交互に測定。解放・ロード要求はしない。"""
import argparse
import datetime
import json
from pathlib import Path
import statistics
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'src'))
from fds_client import API_IDS, MODEL_IDS

WORDS = ['衛星', '長葱', '商店街', 'キンカチョウ', 'トンボ', 'ピーマン', '雷', 'チンパンジー', 'ご飯', 'マットレス']
TARGET = '菓子'


def old_request(target, word, model):
    return {'model': model, 'state': {'対象': word}, 'questions': {'判定': {
        'type': 'noul', 'instructions': f'これは{target}ですか？ 対象の名詞の一般的な意味に基づいて判定してください。',
        'criteria': {'true': f'{target}に当てはまる', 'false': f'{target}ではない'}}}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--phase', choices=['before', 'after'], required=True)
    parser.add_argument('--repeats', type=int, default=3)
    parser.add_argument('--models', nargs='+', choices=list(API_IDS), default=list(API_IDS))
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    headers = {'Content-Type': 'application/json', 'X-TestJeff-Backend': 'fds', 'X-TestJeff-Host': '127.0.0.1',
               'X-TestJeff-Port': '8767', 'X-TestJeff-Device': 'cpu', 'X-TestJeff-Auto-Unload': 'false'}
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def call(path, body=None, fds=False):
        raw = None if body is None else json.dumps(body, ensure_ascii=False).encode('utf-8')
        request = urllib.request.Request(f'http://127.0.0.1:{8767 if fds else args.port}{path}', data=raw, headers=headers)
        with opener.open(request, timeout=130) as response:
            return json.load(response)

    health = call('/health', fds=True)
    resident = {(m['model'], m['device']) for m in health['loaded_models']}
    assert health['active'] == 0 and health['queued'] == 0, '他の要求を処理中です。'
    assert all((MODEL_IDS[m], 'cpu') in resident for m in args.models), 'CPU常駐モデルのみ測定できます。'
    if args.phase == 'after':
        from noun_requests import make_request
    else:
        make_request = old_request
    report = {'phase': args.phase, 'at': datetime.datetime.now().astimezone().isoformat(),
              'boundary': 'Pythonクライアント→TestJeff→FDS、応答JSON読込まで。予備判定と記録処理を除外。',
              'target': TARGET, 'candidates': WORDS, 'health_before': health, 'samples': []}
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    output = ROOT / f'dev/testing/output/v0203-transport-{args.phase}-{stamp}.json'
    output.parent.mkdir(parents=True, exist_ok=True)

    def save():
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')

    for repeat in range(args.repeats):
        for model in args.models:
            requests = [make_request(TARGET, word, API_IDS[model]) for word in WORDS]
            for mode in (['single', 'batch'] if repeat % 2 == 0 else ['batch', 'single']):
                warmup = call('/v1/systemone', requests[0])
                version = warmup.get('reproduction', {}).get('application', {}).get('version')
                if args.phase == 'before' and version != '0.20.2':
                    raise RuntimeError('beforeは旧版v0.20.2サーバー専用です。新版で旧測定を上書きしないでください。')
                responses = []
                started = time.perf_counter()
                if mode == 'single':
                    for body in requests:
                        responses.append(call('/v1/systemone', body))
                else:
                    responses.append(call('/testjeff/battle-batch', {'model': model, 'target': TARGET, 'candidates': WORDS}))
                elapsed = (time.perf_counter() - started) * 1000
                if mode == 'single':
                    executions = [r['execution'] for r in responses]
                    probabilities = [r['answers']['判定']['noul'] for r in responses]
                else:
                    if args.phase == 'after' and responses[0].get('reproduction', {}).get('noun_protocol') != 'noun-v2':
                        raise RuntimeError('afterはnoun-v2の一括APIが必要です。TestJeffを再起動してください。')
                    executions = [b['reproduction']['execution'] for b in responses[0]['reproduction']['batches']]
                    probabilities = [r['probability'] for r in responses[0]['results']]
                assert len(probabilities) == len(WORDS)
                assert all(e['device'] == 'cpu' and e['model'] == MODEL_IDS[model] for e in executions)
                inference = sum(e['inference_ms'] for e in executions)
                sample = {'repeat': repeat, 'model': model, 'mode': mode, 'total_ms': elapsed,
                          'inference_ms': inference, 'outside_inference_ms': elapsed - inference,
                          'input_tokens': sum(e['input_tokens'] for e in executions) if all(type(e.get('input_tokens')) is int for e in executions) else None,
                          'fds_requests': len(executions), 'probabilities': probabilities,
                          'warmup': warmup, 'responses': responses}
                report['samples'].append(sample)
                save()
                print(json.dumps({k: sample[k] for k in ('repeat', 'model', 'mode', 'total_ms', 'inference_ms', 'fds_requests')}, ensure_ascii=False), flush=True)
    report['health_after'] = call('/health', fds=True)
    assert report['health_after']['generation'] == health['generation'], 'モデル常駐構成が変わりました。'
    report['summary'] = {}
    for model in args.models:
        summary = {}
        for mode in ('single', 'batch'):
            rows = [r for r in report['samples'] if r['model'] == model and r['mode'] == mode]
            summary[mode] = {metric: {'median': statistics.median(r[metric] for r in rows),
                                    'min': min(r[metric] for r in rows), 'max': max(r[metric] for r in rows)}
                             for metric in ('total_ms', 'inference_ms', 'outside_inference_ms')}
        summary['reduction_percent'] = (1 - summary['batch']['total_ms']['median'] / summary['single']['total_ms']['median']) * 100
        summary['max_probability_difference'] = max(abs(s - b) for repeat in range(args.repeats)
            for s, b in zip(next(r['probabilities'] for r in report['samples'] if r['model'] == model and r['mode'] == 'single' and r['repeat'] == repeat),
                            next(r['probabilities'] for r in report['samples'] if r['model'] == model and r['mode'] == 'batch' and r['repeat'] == repeat)))
        report['summary'][model] = summary
    save()
    print(str(output), flush=True)
    print(json.dumps(report['summary'], ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
