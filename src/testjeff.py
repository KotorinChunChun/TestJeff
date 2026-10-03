"""専用環境で公式Jeffを取得・起動・実測する。"""
from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
MODELS = json.loads((ROOT / 'models.json').read_text(encoding='utf-8'))
os.environ['HF_HOME'] = str(ROOT / '.cache/huggingface')
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['PYTHONUTF8'] = '1'
OUTPUT = ROOT / 'dev/testing/output'


def download(name: str) -> Path:
    from huggingface_hub import snapshot_download
    item = MODELS[name]
    folder = ROOT / 'models' / name
    snapshot_download(item['repo'], revision=item['revision'], local_dir=folder,
                      allow_patterns=['*.json', '*.safetensors', '*.jinja', '*.txt', '*.model', 'README.md', 'LICENSE*'],
                      max_workers=3)
    (folder / '.testjeff-revision').write_text(item['revision'], encoding='utf-8')
    return folder


def checkpoint(name: str) -> Path:
    folder = ROOT / 'models' / name
    marker = folder / '.testjeff-revision'
    if not marker.exists() or marker.read_text(encoding='utf-8') != MODELS[name]['revision']:
        raise RuntimeError(f'モデル未取得です: jeff.ps1 download --model {name}')
    return folder


def free_port(port: int) -> None:
    with socket.socket() as sock:
        if sock.connect_ex(('127.0.0.1', port)) == 0:
            raise RuntimeError(f'ポート{port}は使用中です。起動中のサーバーをCtrl+Cで停止するか--portを変更してください。')


def serve(name: str, port: int, device: str) -> None:
    free_port(port)
    folder = checkpoint(name)
    import torch
    if device == 'cuda':
        if not torch.cuda.is_available():
            raise RuntimeError('CUDAが利用できません。setup.ps1を実行してください。')
        free, total = torch.cuda.mem_get_info()
        needed = MODELS[name]['minimum_free_gib']
        if free / 2**30 < needed:
            raise RuntimeError(f'GPU空き容量{free / 2**30:.1f}GiB、必要目安{needed}GiB。小さいモデルを選ぶか--device cpuを指定してください。')
        torch.cuda.set_per_process_memory_fraction(0.85)
    os.environ.update(JEFF_CHECKPOINT=str(folder), JEFF_DEVICE=device, JEFF_BACKEND='pytorch')
    # 他用途のシェル設定に左右されず、単一のベースモデルを起動する。
    for key in ('JEFF_ADAPTERS', 'JEFF_ADAPTER_MODE', 'JEFF_LORA_PRECISION'):
        os.environ.pop(key, None)
    from jeff import server
    from fastapi import Request
    from fastapi.responses import JSONResponse
    import uvicorn

    original = server.distributions

    def limited_distributions(model, rows):
        # 上流の8質問バッチを1質問ずつにしてGPU一時領域を抑える。
        values, tokens = [], 0
        for row in rows:
            result, count = original(model, [row])
            values.extend(result)
            tokens += count
        return values, tokens

    server.distributions = limited_distributions

    @server.app.middleware('http')
    async def bound_request(request: Request, call_next):
        if request.url.path == '/v1/systemone' and request.method == 'POST':
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 32768:
                    return JSONResponse({'detail': '実験用上限は32KiBです。'}, status_code=413)
            # Starletteで後続のJSON検証へ同一本文を渡す。
            request._body = bytes(body)
            try:
                data = json.loads(body)
            except (ValueError, UnicodeDecodeError):
                return JSONResponse({'detail': 'JSONが不正です。'}, status_code=422)
            if isinstance(data, dict):
                questions = data.get('questions', {})
                if data.get('images') or (isinstance(questions, dict) and len(questions) > 4):
                    return JSONResponse({'detail': '本実験はテキストのみ・最大4質問です。'}, status_code=422)
        try:
            return await call_next(request)
        except torch.OutOfMemoryError:
            if device == 'cuda':
                torch.cuda.empty_cache()
            return JSONResponse({'detail': 'GPUメモリ不足です。入力を短くするか小さいモデルへ切り替えてください。'}, status_code=503)

    @server.app.get('/testjeff/status')
    def status():
        return {'selected': name, 'device': device, 'revision': MODELS[name]['revision'],
                'allocated_gib': torch.cuda.memory_allocated() / 2**30 if device == 'cuda' else None,
                'peak_allocated_gib': torch.cuda.max_memory_allocated() / 2**30 if device == 'cuda' else None,
                'reserved_gib': torch.cuda.memory_reserved() / 2**30 if device == 'cuda' else None}

    print(f'{name} / {device}: http://127.0.0.1:{port} （切り替えはCtrl+C後に別モデルで起動）', flush=True)
    uvicorn.run(server.app, host='127.0.0.1', port=port)


def request_api(port: int, path: str, payload=None):
    raw = None if payload is None else json.dumps(payload, ensure_ascii=False).encode('utf-8')
    headers = {'Content-Type': 'application/json'}
    if os.environ.get('JEFF_API_KEY'):
        headers['Authorization'] = f"Bearer {os.environ['JEFF_API_KEY']}"
    request = urllib.request.Request(f'http://127.0.0.1:{port}{path}', data=raw, headers=headers)
    with urllib.request.urlopen(request, timeout=180) as response:
        return json.load(response)


def smoke(port: int) -> dict:
    fixtures = json.loads((ROOT / 'tests/requests.json').read_text(encoding='utf-8'))
    records = []
    for case in fixtures:
        start = time.perf_counter()
        result = request_api(port, '/v1/systemone', case['request'])
        elapsed = time.perf_counter() - start
        answers = result['answers']
        assert set(answers) == set(case['request']['questions'])
        for key, answer in answers.items():
            assert answer['type'] == case['request']['questions'][key]['type']
            if 'probabilities' in answer:
                probabilities = answer['probabilities']
                assert all(math.isfinite(v) and 0 <= v <= 1 for v in probabilities.values())
                assert math.isclose(sum(probabilities.values()), 1.0, abs_tol=1e-5)
                assert 0 <= answer['confidence'] <= 1
            if answer['type'] == 'choice':
                assert set(answer['probabilities']) == set(case['request']['questions'][key]['criteria'])
                assert answer['choice'] in answer['probabilities']
            if answer['type'] == 'noul':
                assert 0 <= answer['noul'] <= 1
            if answer['type'] == 'score':
                assert 0 <= answer['score'] <= len(case['request']['questions'][key]['criteria']) - 1
        records.append({'case': case['name'], 'seconds': elapsed, 'result': result,
                        'expected_choice': case.get('expected_choice'),
                        'matches_expected': answers.get('intent', {}).get('choice') == case['expected_choice']
                        if 'expected_choice' in case else None})
    for payload, expected in [({'model': 'unknown', 'state': '', 'questions': {}}, 422),
                              ({'state': 'x' * 33000}, 413),
                              ({'model': 'jeff-latest', 'state': '', 'questions': {}, 'images': ['x']}, 422)]:
        try:
            request_api(port, '/v1/systemone', payload)
        except urllib.error.HTTPError as error:
            assert error.code == expected, (error.code, expected)
        else:
            raise AssertionError('不正入力が拒否されませんでした。')
    return {'health': request_api(port, '/health'), 'models': request_api(port, '/v1/models'),
            'records': records, 'memory': request_api(port, '/testjeff/status'), 'negative_checks': 3}


def verify(names: list[str], port: int, device: str) -> bool:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    results = []
    for name in names:
        free_port(port)
        started = time.perf_counter()
        log_path = OUTPUT / f'{name}.log'
        with log_path.open('w', encoding='utf-8') as log:
            process = subprocess.Popen([sys.executable, str(Path(__file__)), 'serve', '--model', name,
                                        '--port', str(port), '--device', device], cwd=ROOT,
                                       stdout=log, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic() + 600
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        raise RuntimeError(f'サーバー終了: {log_path}')
                    try:
                        health = request_api(port, '/health')
                        if health['status'] == 'ready':
                            break
                    except (urllib.error.URLError, TimeoutError):
                        pass
                    time.sleep(1)
                else:
                    raise TimeoutError('起動待ち600秒を超過しました。')
                loaded_seconds = time.perf_counter() - started
                result = smoke(port)
                result.update(name=name, passed=True, load_seconds=loaded_seconds)
            except Exception as error:
                result = {'name': name, 'passed': False, 'error': str(error)}
            finally:
                if process.poll() is None:
                    if os.name == 'nt':
                        # Windowsのvenvランチャーの子Pythonも終了してGPUを解放する。
                        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                                       check=True, capture_output=True)
                    else:
                        process.terminate()
                    try:
                        process.wait(timeout=30)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
                # taskkill完了直後はWindowsのソケット解放が遅れることがある。
                for _ in range(100):
                    try:
                        free_port(port)
                        break
                    except RuntimeError:
                        time.sleep(0.1)
                else:
                    raise RuntimeError('終了後もポートが解放されませんでした。')
            results.append(result)
            (OUTPUT / f'{name}.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps(result, ensure_ascii=False), flush=True)
    return all(result['passed'] for result in results)


def main():
    if Path(sys.prefix).resolve() != (ROOT / '.venv').resolve():
        raise RuntimeError('TestJeff/.venv/Scripts/python.exeで実行してください。')
    parser = argparse.ArgumentParser(description='Jeffの取得・起動・API実測')
    parser.add_argument('command', choices=['download', 'serve', 'smoke', 'verify'])
    parser.add_argument('--model', choices=MODELS, default='qwen-0.8b')
    parser.add_argument('--all', action='store_true', help='download/verifyで3モデルを順次処理')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--device', choices=['cuda', 'cpu'], default='cuda')
    args = parser.parse_args()
    if args.all and args.command not in ('download', 'verify'):
        parser.error('--allはdownload/verify専用です。')
    if not 1 <= args.port <= 65535:
        parser.error('ポートは1〜65535です。')
    names = list(MODELS) if args.all else [args.model]
    if args.command == 'download':
        for name in names:
            print(download(name), flush=True)
    elif args.command == 'serve':
        serve(args.model, args.port, args.device)
    elif args.command == 'smoke':
        print(json.dumps(smoke(args.port), ensure_ascii=False, indent=2))
    elif not verify(names, args.port, args.device):
        sys.exit(1)


if __name__ == '__main__':
    main()
