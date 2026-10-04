"""実モデルをロードせず、ローカルデバイス切替と推論競合をAPIから検証する。"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
import json
from pathlib import Path
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
import testjeff


class LocalDeviceTest(unittest.TestCase):
    def make_server(self, gpu=True, initial='cpu'):
        self.stack = self.enterContext(ExitStack())
        output = ROOT / 'dev/testing/output'
        output.mkdir(parents=True, exist_ok=True)
        folder = Path(self.stack.enter_context(tempfile.TemporaryDirectory(dir=output)))
        (folder / 'decision_config.json').write_text(json.dumps({'max_options':26}), encoding='utf-8')
        cuda = Mock()
        cuda.is_available.return_value = gpu
        cuda.mem_get_info.return_value = (16 * 2**30, 16 * 2**30)
        for method in ('memory_allocated', 'max_memory_allocated', 'memory_reserved'):
            getattr(cuda, method).return_value = 0
        self.torch = SimpleNamespace(cuda=cuda, OutOfMemoryError=type('FakeOutOfMemory', (RuntimeError,), {}))
        self.service = SimpleNamespace(model=object(), name='jeff-qwen3.5-0.8b', lock=threading.Lock())
        self.original = self.service.model
        self.predict = Mock(return_value={'answers':{}})
        self.loader = Mock(side_effect=lambda **kw: SimpleNamespace(base_model='Qwen/Qwen3.5-0.8B'))
        self.server = SimpleNamespace(app=FastAPI(), service=self.service,
                                      distributions=Mock(), predict=self.predict,
                                      authenticate=lambda authorization=None: None, max_options=Mock(return_value=26))
        self.before_predict = None

        @self.server.app.post('/v1/systemone')
        def systemone(body: dict):
            if self.before_predict:
                self.before_predict()
            if not self.service.lock.acquire(blocking=False):
                raise HTTPException(409, '使用中')
            try:
                return self.server.predict(self.service.model, body)
            finally:
                self.service.lock.release()

        modules = {'torch':self.torch, 'jeff':SimpleNamespace(server=self.server),
                   'jeff.models':SimpleNamespace(load_decision_model=self.loader)}
        self.stack.enter_context(patch.dict(sys.modules, modules))
        self.stack.enter_context(patch.dict(testjeff.os.environ))
        self.stack.enter_context(patch.object(testjeff, 'free_port'))
        self.stack.enter_context(patch.object(testjeff, 'checkpoint', return_value=folder))
        for store in ('FeedbackStore', 'KnowledgeStore', 'ImageStore'):
            self.stack.enter_context(patch.object(testjeff, store))
        self.stack.enter_context(patch('uvicorn.run'))
        testjeff.serve('qwen-0.8b', 8765, initial)
        # lifespanを起動せず、既にモデルが読み込まれた状態を再現する。
        self.client = TestClient(self.server.app)
        self.addCleanup(self.client.close)
        return self.client

    def test_cpu_only_rejects_gpu_without_unloading(self):
        client = self.make_server(gpu=False)
        self.assertEqual(client.get('/testjeff/status').json()['devices'], ['cpu'])
        response = client.post('/testjeff/model', json={'model':'qwen-2b', 'device':'cuda'})
        self.assertEqual(response.status_code, 422)
        self.assertIn('CUDA', response.json()['detail'])
        self.assertIs(self.service.model, self.original)
        self.loader.assert_not_called()
        self.assertFalse(self.service.lock.locked())

    def test_invalid_device_and_unknown_fields_keep_model(self):
        client = self.make_server()
        for payload in ({'model':'qwen-2b','device':'auto'}, {'model':'qwen-2b','device':None},
                        {'model':'qwen-2b','device':[]}, {'device':'cpu'},
                        {'model':'qwen-2b','extra':True}):
            with self.subTest(payload=payload):
                self.assertEqual(client.post('/testjeff/model', json=payload).status_code, 422)
                self.assertIs(self.service.model, self.original)
        self.loader.assert_not_called()

    def test_device_switch_and_model_only_preserve_device(self):
        client = self.make_server()
        self.assertEqual(client.get('/testjeff/status').json()['devices'], ['cpu','cuda'])
        response = client.post('/testjeff/model', json={'model':'qwen-0.8b','device':'cuda'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['device'], 'cuda')
        self.torch.cuda.set_per_process_memory_fraction.assert_called_once_with(.85)
        self.assertEqual(self.loader.call_args.kwargs['device'], 'cuda')
        self.assertFalse(self.service.lock.locked())
        response = client.post('/testjeff/model', json={'model':'qwen-2b'})
        self.assertEqual(response.json()['device'], 'cuda')
        response = client.post('/testjeff/model', json={'model':'qwen-2b','device':'cpu'})
        self.assertEqual(response.json()['device'], 'cpu')
        self.assertEqual(self.loader.call_args.kwargs['device'], 'cpu')
        self.assertEqual(testjeff.os.environ['JEFF_DEVICE'], 'cpu')
        self.torch.cuda.empty_cache.assert_called()

    def test_unchanged_selection_does_not_reload(self):
        client = self.make_server(initial='cuda')
        response = client.post('/testjeff/model', json={'model':'qwen-0.8b'})
        self.assertEqual(response.json()['device'], 'cuda')
        self.assertTrue(response.json()['ready'])
        self.loader.assert_not_called()

    def test_low_memory_failure_is_not_ready_and_can_retry(self):
        client = self.make_server()
        self.torch.cuda.mem_get_info.return_value = (0, 16 * 2**30)
        response = client.post('/testjeff/model', json={'model':'qwen-2b','device':'cuda'})
        self.assertEqual(response.status_code, 503)
        self.assertIn('GPU空き容量', response.json()['detail'])
        self.loader.assert_not_called()
        status = client.get('/testjeff/status').json()
        self.assertFalse(status['ready'])
        self.assertIsNone(status['selected'])
        self.assertFalse(self.service.lock.locked())
        response = client.post('/testjeff/model', json={'model':'qwen-0.8b','device':'cpu'})
        self.assertTrue(response.json()['ready'])

    def test_load_failure_has_reason_and_releases_lock(self):
        client = self.make_server()
        self.loader.side_effect = RuntimeError('読込検証の失敗理由')
        response = client.post('/testjeff/model', json={'model':'qwen-2b'})
        self.assertEqual(response.status_code, 503)
        self.assertIn('読込検証の失敗理由', response.json()['detail'])
        self.assertFalse(client.get('/testjeff/status').json()['ready'])
        self.assertFalse(self.service.lock.locked())

    def test_missing_checkpoint_keeps_old_model(self):
        client = self.make_server()
        with patch.object(testjeff, 'checkpoint', side_effect=RuntimeError('モデル未取得です')):
            response = client.post('/testjeff/model', json={'model':'qwen-2b','device':'cuda'})
        self.assertEqual(response.status_code, 503)
        self.assertIn('モデル未取得', response.json()['detail'])
        self.assertIs(self.service.model, self.original)
        self.assertTrue(client.get('/testjeff/status').json()['ready'])
        self.assertFalse(self.service.lock.locked())

    def test_busy_switch_keeps_existing_model(self):
        client = self.make_server()
        with self.service.lock:
            response = client.post('/testjeff/model', json={'model':'qwen-2b','device':'cuda'})
        self.assertEqual(response.status_code, 409)
        self.assertIs(self.service.model, self.original)
        self.loader.assert_not_called()

    def test_inference_header_mismatch_and_invalid_values(self):
        client = self.make_server()
        for route in ('/v1/systemone','/testjeff/photos','/testjeff/battle-batch'):
            for value, expected in (('cuda',409), ('auto',422)):
                with self.subTest(route=route, device=value):
                    response = client.post(route, json={}, headers={'X-TestJeff-Local-Device':value})
                    self.assertEqual(response.status_code, expected)
        self.predict.assert_not_called()
        self.assertEqual(client.post('/v1/systemone',json={}).status_code, 200)
        self.assertEqual(client.post('/v1/systemone',json={},headers={'X-TestJeff-Local-Device':'cpu'}).status_code, 200)

    def test_luna_does_not_require_local_device(self):
        client = self.make_server()
        with patch.object(testjeff, 'classify', return_value={'verdicts':[True] * 10, 'source':'テスト','reasoning':'low','duration_ms':10}):
            response = client.post('/testjeff/battle-batch', json={'model':'gpt-5.6-luna','target':'生物','candidates':['猫'] * 10},
                                   headers={'X-TestJeff-Local-Device':'auto'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()['results']), 10)

    def test_fds_does_not_use_local_device_header(self):
        client = self.make_server()
        remote = Mock()
        remote.predict.return_value = {'answers':{}}
        with patch.object(testjeff.FDS, 'from_request', return_value=remote):
            response = client.post('/v1/systemone', json={'model':'jeff-qwen3.5-2b'},
                                   headers={'X-TestJeff-Local-Device':'invalid'})
        self.assertEqual(response.status_code, 200)
        remote.predict.assert_called_once()
        self.predict.assert_not_called()

    def test_switch_between_receipt_and_inference_is_rejected(self):
        client = self.make_server()
        arrived, proceed = threading.Event(), threading.Event()
        def pause():
            arrived.set()
            if not proceed.wait(10):
                raise RuntimeError('試験の同期がタイムアウトしました。')
        self.before_predict = pause
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(client.post, '/v1/systemone', json={}, headers={'X-TestJeff-Local-Device':'cpu'})
            try:
                self.assertTrue(arrived.wait(10))
                response = client.post('/testjeff/model', json={'model':'qwen-0.8b','device':'cuda'})
                self.assertEqual(response.status_code, 200)
            finally:
                proceed.set()
            self.assertEqual(future.result(timeout=10).status_code, 409)
        self.predict.assert_not_called()
        self.assertFalse(self.service.lock.locked())


if __name__ == '__main__':
    unittest.main()
