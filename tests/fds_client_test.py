"""FDS互換変換・接続先検証をモデルなしで確認。"""
import copy
import sys
import unittest
from pathlib import Path
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

    def test_failure_no_retry(self):
        client=FDS('127.0.0.1',8767);calls=[]
        def call(*args):
            calls.append(args);raise HTTPException(504,'期限超過')
        client.call=call
        with self.assertRaises(HTTPException):client.predict({'state':'猫','questions':{'質問':{'type':'noul'}}},'qwen-2b')
        self.assertEqual(len(calls),1)

if __name__=='__main__':unittest.main()
