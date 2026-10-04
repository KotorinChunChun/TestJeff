"""FDS互換変換・接続先検証をモデルなしで確認。"""
import copy
import io
import json
import sys
import unittest
import urllib.error
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from fastapi import HTTPException
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from fds_client import FDS

class FDSTest(unittest.TestCase):
    def test_target(self):
        for host,port in [('http://127.0.0.1',8767),('0.0.0.0',8767),('127.0.0.1',0),('224.0.0.1',80)]:
            with self.assertRaises(HTTPException):FDS(host,port)
        self.assertEqual(FDS('::1',8767).url,'http://[::1]:8767')

    def test_numeric_choices_and_source(self):
        client=FDS('127.0.0.1',8767);requests=[]
        def call(path,body):
            requests.append(copy.deepcopy(body))
            return {'model':'jeff-qwen-2b','answers':{'面積':{'type':'choice','choice':'option_1','probabilities':{'option_0':.1,'option_1':.9}}},'inference_ms':10}
        client.call=call
        result=client.predict({'state':{'対象':'猫'},'questions':{'面積':{'type':'choice','instructions':'割合','criteria':{'0':'0%','10':'10%'}}}},'qwen-2b')
        self.assertEqual(result['answers']['面積']['choice'],'10')
        self.assertEqual(result['execution']['model'],'jeff-qwen-2b')
        self.assertIsInstance(requests[0]['state'],str)
        self.assertEqual(len(requests),1)

    def test_noul_reverse(self):
        client=FDS('127.0.0.1',8767);requests=[]
        def call(path,body):
            requests.append(body)
            return {'model':'jeff-qwen-2b','answers':{'質問':{'type':'choice','choice':'option_1','probabilities':{'option_0':.2,'option_1':.8}}}}
        client.call=call
        result=client.predict({'state':'猫','orders':2,'questions':{'質問':{'type':'noul','instructions':'動物か'}}},'qwen-2b')
        self.assertEqual(result['answers']['質問']['noul'],.8)
        self.assertEqual(list(requests[1]['questions']['質問']['criteria']),['option_1','option_0'])

    def test_three_models(self):
        from fds_client import MODEL_IDS
        for selected,remote_id in MODEL_IDS.items():
            client=FDS('127.0.0.1',8767)
            def call(path,body):
                self.assertEqual(body['model'],remote_id)
                return {'model':remote_id,'answers':{'質問':{'type':'noul','noul':.9}}}
            client.call=call
            self.assertEqual(client.predict({'questions':{'質問':{'type':'noul'}}},selected)['execution']['model'],remote_id)

    def test_failure_no_retry(self):
        client=FDS('127.0.0.1',8767);calls=[]
        def call(*args):
            calls.append(args);raise HTTPException(504,'期限超過')
        client.call=call
        with self.assertRaises(HTTPException):client.predict({'state':'猫','questions':{'質問':{'type':'noul'}}},'qwen-2b')
        self.assertEqual(len(calls),1)

    def test_management_uses_registered_id_and_explicit_policy(self):
        client=FDS('127.0.0.1',8767,'cuda',False)
        client.call=Mock(return_value={'success':True,'model':'jeff-qwen-2b','device':'cuda'})
        client.manage('load',{'model':'qwen-2b'})
        client.call.assert_called_once_with('/models/load',{'model':'jeff-qwen-2b','device':'cuda','auto_unload':False,'timeout_seconds':120})
        client.call.reset_mock()
        client.manage('unload',{'model':'jeff-qwen-2b','device':'cpu','approval_token':'one-use'})
        self.assertEqual(client.call.call_args.args[0],'/models/unload')
        self.assertEqual(client.call.call_args.args[1]['approval_token'],'one-use')
        self.assertEqual(client.call.call_args.args[1]['device'],'cpu')
        for action,body in [('download',{'model':'qwen-2b'}),('load',{'model':'qwen-2b','url':'http://invalid'}),('load',[]),('load',{'model':None})]:
            with self.assertRaises(HTTPException):client.manage(action,body)

    def test_unloaded_is_loadable_but_not_ready(self):
        client=FDS('127.0.0.1',8767,'auto');loaded=[]
        def call(path,body=None):
            if path=='/health':return {'service':'FastDecisionServer','accepting':True,'default_device':'cpu'}
            if path=='/models/load':loaded.append('cpu');return {'success':True,'load_ms':42,'unloaded':[]}
            return {'capabilities_version':2,'default_device':'cpu','devices':['auto','cpu'],
                    'models':[{'id':'jeff-qwen-2b','revision':'fixed','available':True,'loadable':True,'devices':['auto','cpu'],'loaded_devices':list(loaded)}],
                    'model_management':{'enabled':True},'generation':len(loaded),'loaded_models':[{'model':'jeff-qwen-2b','device':d} for d in loaded]}
        client.call=Mock(side_effect=call)
        initial=client.status('qwen-2b')
        self.assertFalse(initial['ready']);self.assertTrue(initial['loadable'])
        self.assertEqual(initial['capabilities'][0]['local_id'],'qwen-2b')
        self.assertFalse(any(c.args[0]=='/models/load' for c in client.call.call_args_list),'statusだけではロードしない')
        result=client.load('qwen-2b')
        self.assertTrue(result['ready']);self.assertEqual(result['management']['load_ms'],42)
        self.assertEqual(result['loaded_models'],[{'model':'jeff-qwen-2b','device':'cpu'}])

    def test_structured_approval_is_preserved_without_retry(self):
        detail={'code':'approval_required','message':'解放が必要です','approval':{'token':'private-test-token','action':'load','model':'jeff-qwen-2b','device':'cuda','unload':[{'model':'jeff-qwen-0.8b','device':'cuda'}]}}
        failure=urllib.error.HTTPError('http://127.0.0.1:8767/models/load',409,'Conflict',{},io.BytesIO(json.dumps({'detail':detail}).encode()))
        opener=Mock();opener.open.side_effect=failure
        with patch('fds_client.urllib.request.build_opener',return_value=opener):
            with self.assertRaises(HTTPException) as raised:FDS('127.0.0.1',8767).manage('load',{'model':'qwen-2b'})
        self.assertEqual(raised.exception.status_code,409);self.assertEqual(raised.exception.detail,detail)
        self.assertEqual(opener.open.call_count,1);self.assertEqual(opener.open.call_args.kwargs['timeout'],305)

    def test_auto_unload_header_and_inference_policy(self):
        headers={'x-testjeff-backend':'fds','x-testjeff-host':'127.0.0.1','x-testjeff-port':'8767','x-testjeff-auto-unload':'false'}
        client=FDS.from_request(SimpleNamespace(headers=headers));self.assertFalse(client.auto_unload)
        client.call=Mock(return_value={'model':'jeff-qwen-2b','answers':{'質問':{'type':'noul','noul':.9}}})
        result=client.predict({'questions':{'質問':{'type':'noul'}}},'qwen-2b')
        self.assertFalse(client.call.call_args.args[1]['auto_unload'])
        self.assertFalse(result['reproduction']['execution']['auto_unload'])
        self.assertFalse(result['reproduction']['submitted_requests'][0]['auto_unload'])
        headers['x-testjeff-auto-unload']='yes'
        with self.assertRaises(HTTPException):FDS.from_request(SimpleNamespace(headers=headers))

    def test_reproduction_does_not_store_approval_token(self):
        from reproduction import safe_request
        value={'model':'jeff-qwen-2b','device':'cpu','auto_unload':False,'approval_token':'never-store-this'}
        stored=safe_request(value,jev_defaults=False)
        self.assertNotIn('approval_token',stored)
        self.assertNotIn('never-store-this',json.dumps(stored))
        self.assertFalse(stored['auto_unload']);self.assertEqual(value['approval_token'],'never-store-this')

if __name__=='__main__':unittest.main()
