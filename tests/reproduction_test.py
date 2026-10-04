"""再現情報で実際の要求・選択肢順序・画像識別を失わないことを確認する。"""
import base64
import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from reproduction import reproduction, safe_request
from fds_client import FDS


class ReproductionTest(unittest.TestCase):
    def test_request_keeps_inputs_without_embedding_image(self):
        raw = b'original-image-content'
        image = 'data:image/jpeg;base64,' + base64.b64encode(raw).decode()
        payload = {'model':'test', 'state':{'対象':'猫'}, 'images':[image],
                   'questions':{'判定':{'type':'noul','instructions':'動物ですか','criteria':{'true':'該当','false':'非該当'}}}}
        original = copy.deepcopy(payload)
        stored = reproduction(payload, {'backend':'local','device':'cpu'})
        self.assertEqual(payload, original)
        self.assertEqual(stored['request']['questions'], payload['questions'])
        self.assertEqual(stored['request']['state'], payload['state'])
        self.assertEqual(stored['request']['orders'], 1)
        self.assertEqual(stored['request']['images'][0]['sha256'], hashlib.sha256(raw).hexdigest())
        self.assertNotIn(image, json.dumps(stored))
        self.assertEqual(len(stored['application']['source_sha256']), 64)

    def test_fds_records_requested_and_resolved_device_and_actual_order(self):
        client = FDS('127.0.0.1', 8767, 'auto')
        sent = []
        def respond(path, body):
            sent.append(copy.deepcopy(body))
            return {'model':'jeff-qwen-2b','device':'cuda','revision':'実際のFDS版',
                    'answers':{'判定':{'type':'choice','choice':'option_1','probabilities':{'option_0':.2,'option_1':.8}}}}
        client.call = respond
        payload = {'state':'猫','orders':2,'questions':{'判定':{'type':'noul','instructions':'動物ですか'}}}
        record = client.predict(payload, 'qwen-2b')
        self.assertEqual(record['execution']['requested_device'], 'auto')
        self.assertEqual(record['execution']['device'], 'cuda')
        self.assertEqual(record['execution']['revision'], '実際のFDS版')
        self.assertEqual(record['reproduction']['submitted_requests'], [safe_request(value) for value in sent])
        self.assertEqual(record['reproduction']['request']['questions'], payload['questions'])
        self.assertEqual(list(sent[1]['questions']['判定']['criteria']), ['option_1','option_0'])
        self.assertEqual(sent[0]['timeout_seconds'], 120)
        self.assertEqual(sent[0]['priority'], 'normal')


if __name__ == '__main__':
    unittest.main()
