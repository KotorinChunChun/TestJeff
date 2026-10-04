"""1〜100件の一括API、8件分割と回答件数・確率の検証を実モデルなしで確認する。"""
import copy
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'src'))
import testjeff
import local_device_test


class BattleBatchAPI(unittest.TestCase):
    def setUp(self):
        local_device_test.LocalDeviceTest.make_server(self)
        self.server.EvaluationRequest=lambda **payload:payload

    @staticmethod
    def answer(payload):
        return {'answers':{key:{'type':'noul','noul':.75} for key in payload['questions']},
                'reproduction':{'request':copy.deepcopy(payload)}}

    def test_local_chunk_counts_and_reproduction(self):
        for count in (1,10,30,100):
            self.predict.reset_mock()
            self.predict.side_effect=lambda model,payload:self.answer(payload)
            response=self.client.post('/testjeff/battle-batch',json={'model':'qwen-0.8b','target':'動物','candidates':['犬']*count})
            self.assertEqual(response.status_code,200)
            data=response.json()
            self.assertEqual(len(data['results']),count)
            chunks=data['reproduction']['batches']
            self.assertEqual([chunk['count'] for chunk in chunks],[min(8,count-offset) for offset in range(0,count,8)])
            self.assertEqual(self.predict.call_count,(count+7)//8)
            self.assertEqual([chunk['offset'] for chunk in chunks],list(range(0,count,8)))
            self.assertEqual([key for chunk in chunks for key in chunk['reproduction']['request']['questions']],
                             [f'item_{i}' for i in range(count)])
            self.assertFalse(self.service.lock.locked())

    def test_fds_chunk_counts(self):
        remote=Mock()
        remote.predict.side_effect=lambda payload,model:self.answer(payload)
        for count in (1,30,100):
            remote.reset_mock()
            with patch.object(testjeff.FDS,'from_request',return_value=remote):
                response=self.client.post('/testjeff/battle-batch',json={'model':'qwen-2b','target':'動物','candidates':['犬']*count})
            self.assertEqual(response.status_code,200)
            self.assertEqual(len(response.json()['results']),count)
            self.assertEqual([len(call.args[0]['questions']) for call in remote.predict.call_args_list],
                             [min(8,count-offset) for offset in range(0,count,8)])

    def test_incorrect_backend_answers_fail_without_partial_response(self):
        body={'model':'qwen-0.8b','target':'動物','candidates':['犬']*30}
        mutations=[lambda answers:answers.pop(next(iter(answers))),
                   lambda answers:answers.update(extra={'type':'noul','noul':.5})]
        for invalid in (None,True,'0.5',float('nan'),float('inf'),-.1,1.1):
            mutations.append(lambda answers,value=invalid:answers[next(iter(answers))].update(noul=value))
        for mutation in mutations:
            def answer(model,payload):
                data=self.answer(payload)
                mutation(data['answers'])
                return data
            self.predict.side_effect=answer
            response=self.client.post('/testjeff/battle-batch',json=body)
            self.assertEqual(response.status_code,502)
            self.assertNotIn('results',response.json())
            self.assertFalse(self.service.lock.locked())

    def test_invalid_inputs_and_luna_count(self):
        for candidates in ([],['犬']*101,[''],['あ'*81]):
            response=self.client.post('/testjeff/battle-batch',json={'model':'qwen-0.8b','target':'動物','candidates':candidates})
            self.assertEqual(response.status_code,422)
        for count in (1,30,100):
            result={'verdicts':[True]*count,'source':'試験用','reasoning':'low','duration_ms':100,
                    'reproduction':{'request':{'candidates':['犬']*count}}}
            body={'model':'gpt-5.6-luna','target':'動物','candidates':['犬']*count}
            with patch.object(testjeff,'classify',return_value=result) as classify:
                response=self.client.post('/testjeff/battle-batch',json=body)
                self.assertEqual(response.status_code,200)
                self.assertEqual(len(response.json()['results']),count)
                self.assertEqual(len(classify.call_args.args[0].candidates),count)
                result['verdicts']=result['verdicts'][:-1]
                self.assertEqual(self.client.post('/testjeff/battle-batch',json=body).status_code,502)


if __name__=='__main__':unittest.main()
