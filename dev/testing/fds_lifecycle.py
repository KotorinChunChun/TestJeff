"""FDS専用venvで実行する独立ASGI実モデル試験。稼働サーバー・利用者DBを変更しない。"""
import argparse
import json
import os
from pathlib import Path
import sys
import time

parser = argparse.ArgumentParser()
parser.add_argument('--fds-root', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
sys.path.insert(0, str(args.fds_root / 'src'))
from fastapi.testclient import TestClient
from fds.backend import JeffBackend, free_memory_mb
from fds.server import create_app

config = json.loads((args.fds_root / 'config.json').read_text(encoding='utf-8-sig'))
config['default_device'] = 'cpu'
config['model_management']['max_loaded_models'] = 1
backend = JeffBackend(args.fds_root, config)
records = []


def record(name, **values):
    records.append({'test': name, **values})
    print(name, json.dumps(values, ensure_ascii=False), flush=True)


def operation(action, device='cpu', **values):
    return client.post('/models/' + action, json={
        'model': 'jeff-qwen-2b', 'device': device, 'timeout_seconds': 300, **values})


with TestClient(create_app(config, backend)) as client:
    deadline = time.monotonic() + 300
    while True:
        state = client.get('/health').json()
        if state['ready']:
            break
        if state.get('error') or time.monotonic() >= deadline:
            raise AssertionError(state)
        time.sleep(.25)
    record('実モデルCPU起動', loaded=state['loaded_models'])
    response = operation('load')
    assert response.status_code == 200, response.text
    assert response.json()['unloaded'] == []
    record('常駐再利用は無確認', load_ms=response.json()['load_ms'])

    original = client.get('/health').json()['generation']
    response = operation('unload')
    assert response.status_code == 409, response.text
    approval = response.json()['detail']['approval']
    assert client.get('/health').json()['generation'] == original
    record('アンロード未承認で常駐保持', targets=approval['unload'])
    response = operation('unload', approval_token=approval['token'])
    assert response.status_code == 200, response.text
    assert client.get('/health').json()['ready'] is False
    assert client.get('/health').json()['loaded_models'] == []
    record('承認したアンロードと空の状態')
    response = operation('unload', approval_token=approval['token'])
    assert response.status_code == 409, response.text
    record('使用済み承認を拒否', code=response.json()['detail']['code'])
    response = operation('load')
    assert response.status_code == 200, response.text
    record('空きロードは無確認', load_ms=response.json()['load_ms'])
    response = client.post('/models/load', json={'model': 'jeff-qwen-0.8b', 'device': 'cpu'})
    assert response.status_code == 422, response.text
    record('未導入モデルを拒否', code=response.json()['detail']['code'])

    caps = client.get('/models').json()
    gpu_need = config['models']['jeff-qwen-2b']['memory_mb']['cuda']['vram'] + config['model_management']['vram_reserve_mb']
    if 'cuda' in caps['devices'] and free_memory_mb('cuda')['vram'] >= gpu_need:
        response = operation('load', 'cuda', auto_unload=False)
        assert response.status_code == 409, response.text
        record('自動解放禁止のCPU/GPU切替を拒否', code=response.json()['detail']['code'])
        response = operation('load', 'cuda')
        assert response.status_code == 409, response.text
        approval = response.json()['detail']['approval']
        assert client.get('/health').json()['loaded'] == ['jeff-qwen-2b', 'cpu']
        record('CPU/GPU切替の承認前にCPU保持', targets=approval['unload'])
        response = operation('load', 'cuda', approval_token=approval['token'])
        assert response.status_code == 200, response.text
        assert client.get('/health').json()['loaded'] == ['jeff-qwen-2b', 'cuda']
        record('承認したCPU/GPU切替', load_ms=response.json()['load_ms'])
        device = 'cuda'
    else:
        record('実GPU切替は空きVRAM不足のため省略', required_mb=gpu_need)
        device = 'cpu'
    response = client.post('/v1/decisions', json={
        'model': 'jeff-qwen-2b', 'device': device, 'state': '猫',
        'questions': {'animal': {'type': 'noul', 'instructions': 'これは動物ですか？'}}})
    assert response.status_code == 200, response.text
    record('切替後の日本語推論', device=response.json()['device'], answers=response.json()['answers'])
    response = operation('unload', device)
    assert response.status_code == 409, response.text
    response = operation('unload', device, approval_token=response.json()['detail']['approval']['token'])
    assert response.status_code == 200, response.text
    assert not client.get('/health').json()['loaded_models']
    record('試験専用モデルを解放して終了')

args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
