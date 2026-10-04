"""実モデル・利用者DBを使わず、FDS管理要求の中継と承認境界を確認する。"""
import copy
import unittest
from unittest.mock import patch

from fastapi import HTTPException
import local_device_test
from fds_client import FDS


class ManagementProxyTest(unittest.TestCase):
    make_server = local_device_test.LocalDeviceTest.make_server

    def setUp(self):
        self.enterContext(patch.object(local_device_test.testjeff, 'BattleStore'))
        self.client = self.make_server()
        self.headers = {'X-TestJeff-Backend':'fds', 'X-TestJeff-Host':'127.0.0.1',
                        'X-TestJeff-Port':'8767', 'X-TestJeff-Device':'cpu',
                        'X-TestJeff-Auto-Unload':'false'}
        self.calls = []
        self.loaded = []
        self.needs_approval = False
        self.detail = {'code':'approval_required', 'message':'旧モデルの解放が必要です。',
                       'approval':{'token':'one-use-test', 'action':'load', 'model':'jeff-qwen-2b',
                                   'device':'cpu', 'unload':[{'model':'jeff-qwen-0.8b','device':'cpu'}],
                                   'expires_at':'2099-01-01T00:00:00Z', 'generation':1}}
        self.enterContext(patch.object(FDS, 'call', side_effect=self.remote_call))

    def remote_call(self, path, body=None):
        self.calls.append((path, copy.deepcopy(body)))
        if path == '/health':
            return {'service':'FastDecisionServer', 'accepting':True, 'ready':bool(self.loaded), 'default_device':'cpu'}
        if path == '/v1/models':
            return {'capabilities_version':2, 'devices':['auto','cpu'], 'default_device':'cpu',
                    'model_management':{'enabled':True}, 'loaded_models':[{'model':'jeff-qwen-2b','device':d} for d in self.loaded],
                    'models':[{'id':'jeff-qwen-2b','revision':'fixed','available':True,'loadable':True,
                               'devices':['auto','cpu'],'loaded_devices':list(self.loaded)}]}
        if path in ('/models/load','/models/unload'):
            if self.needs_approval and body.get('approval_token') != 'one-use-test':
                raise HTTPException(409, copy.deepcopy(self.detail))
            self.loaded = ['cpu'] if path.endswith('/load') else []
            return {'success':True,'model':body['model'],'device':'cpu','load_ms':23,'unloaded':[],'generation':2}
        if path == '/v1/decisions':
            raise HTTPException(409, copy.deepcopy(self.detail))
        raise AssertionError(path)

    def test_check_and_listing_do_not_load(self):
        for path in ('/testjeff/status','/testjeff/fds-check','/testjeff/fds-models'):
            response=self.client.get(path,headers=self.headers)
            self.assertEqual(response.status_code,200,response.text)
        self.assertFalse(any(path.startswith('/models/') for path,_ in self.calls))
        self.assertFalse(self.client.get('/testjeff/status',headers=self.headers).json()['ready'])
        self.assertIs(self.service.model,self.original)

    def test_model_selection_requests_load_and_returns_actual_state(self):
        response=self.client.post('/testjeff/model',headers=self.headers,json={'model':'qwen-2b'})
        self.assertEqual(response.status_code,200,response.text)
        self.assertTrue(response.json()['ready']);self.assertEqual(response.json()['management']['load_ms'],23)
        self.assertEqual(self.calls[0],('/models/load',{'model':'jeff-qwen-2b','device':'cpu','auto_unload':False,'timeout_seconds':120}))
        self.assertIs(self.service.model,self.original,'FDS申請でローカルモデルを解放しない')

    def test_approval_is_returned_and_only_explicit_resubmission_executes(self):
        self.needs_approval=True
        response=self.client.post('/testjeff/model',headers=self.headers,json={'model':'qwen-2b'})
        self.assertEqual(response.status_code,409);self.assertEqual(response.json()['detail'],self.detail)
        self.assertEqual(len(self.calls),1);self.assertEqual(self.loaded,[])
        response=self.client.post('/testjeff/model',headers=self.headers,json={'model':'qwen-2b','approval_token':'one-use-test'})
        self.assertEqual(response.status_code,200,response.text)
        self.assertNotIn('one-use-test',response.text)

    def test_explicit_unload_is_forwarded_once(self):
        response=self.client.post('/testjeff/fds-models/unload',headers=self.headers,json={'model':'jeff-qwen-2b','device':'cpu','approval_token':'one-use-test'})
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(len(self.calls),1);self.assertEqual(self.calls[0][0],'/models/unload')
        self.assertEqual(self.calls[0][1]['approval_token'],'one-use-test')
        self.assertNotIn('one-use-test',response.text)

    def test_inference_approval_failure_is_never_retried(self):
        response=self.client.post('/v1/systemone',headers=self.headers,json={
            'model':'jeff-qwen3.5-2b','state':'猫','questions':{'判定':{'type':'noul','instructions':'動物ですか？'}}})
        self.assertEqual(response.status_code,409);self.assertEqual(response.json()['detail'],self.detail)
        self.assertEqual(len(self.calls),1);self.assertEqual(self.calls[0][0],'/v1/decisions')
        self.assertFalse(self.calls[0][1]['auto_unload'])

    def test_invalid_management_body_and_method_have_no_effect(self):
        for method,path,body in [('GET','/testjeff/fds-models/load',None),('POST','/testjeff/fds-models',{}),
                                 ('POST','/testjeff/model',[]),('POST','/testjeff/fds-models/load',{'model':'qwen-2b','download':True})]:
            response=self.client.request(method,path,headers=self.headers,json=body)
            self.assertIn(response.status_code,(405,422),response.text)
        self.assertEqual(self.calls,[])


if __name__=='__main__':
    unittest.main()
