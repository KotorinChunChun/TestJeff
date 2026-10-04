"""JavaScriptとPythonの名詞入力、個別と一括の文面を実コード間で照合する。"""
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from noun_requests import PROTOCOL, make_request, make_batch_request


class NounRequestsTest(unittest.TestCase):
    @staticmethod
    def javascript(cases):
        script = """
const fs=require('node:fs'),core=require('./src/nouns-core.js');
const cases=JSON.parse(fs.readFileSync(0,'utf8'));
process.stdout.write(JSON.stringify({protocol:core.protocol,results:cases.map(([a,b])=>{
  try{return {request:core.makeRequest(a,b)};}catch(error){return {error:error.message};}
})}));
"""
        result = subprocess.run(['node', '-e', script], input=json.dumps(cases, ensure_ascii=False),
                                text=True, encoding='utf-8', capture_output=True, check=True,
                                cwd=ROOT, timeout=20)
        return json.loads(result.stdout)

    def test_cross_language_requests_and_validation(self):
        cases = [
            ('動物', '猫'), ('  道具\u3000', '\t 傘\r\n'),
            ('「日常」の物', '"机"の上'), ('朝\nご飯', 'おにぎり\n弁当'),
            ('\ufeff生き物\ufeff', '\u00a0犬\u2003'),
            ('\u0085時間\u0085', '\u0085一年\u0085'),
            ('対象', 'あ' * 80), ('動物', '🐱' * 40),
            (' ', '猫'), ('動物', '\ufeff\t'), ('対象', 'あ' * 81),
            ('動物', '🐱' * 41), ('あ' * 81, '猫'), ('あ' * 81, ' '),
        ]
        actual = self.javascript(cases)
        expected = []
        for target, candidate in cases:
            try:
                expected.append({'request': make_request(target, candidate)})
            except ValueError as error:
                expected.append({'error': str(error)})
        self.assertEqual(actual, {'protocol': PROTOCOL, 'results': expected})
        self.assertEqual(PROTOCOL, 'noun-v2')

    def test_batch_flatten_matches_each_single_request(self):
        for count in (1, 10, 30, 100):
            target = ' 「日常」\nの物 '
            words = [f' 「候補{i}」\n"名詞" ' for i in range(count)]
            singles = self.javascript([(target, word) for word in words])['results']
            flattened = []
            for offset in range(0, count, 8):
                batch = make_batch_request(target, words[offset:offset + 8], '検証モデル', offset)
                self.assertEqual(batch['model'], '検証モデル')
                self.assertLessEqual(len(batch['questions']), 8)
                for key, question in batch['questions'].items():
                    index = len(flattened)
                    self.assertEqual(key, f'item_{index}')
                    self.assertEqual(batch['state'], singles[index]['request']['state'])
                    self.assertEqual(question, singles[index]['request']['questions']['判定'])
                    flattened.append(key)
            self.assertEqual(flattened, [f'item_{i}' for i in range(count)])

    def test_model_override_keeps_question_and_state(self):
        default = make_request('動物', '猫')
        selected = make_request('動物', '猫', '別モデル')
        self.assertEqual(selected, {**default, 'model': '別モデル'})


if __name__ == '__main__':
    unittest.main()
