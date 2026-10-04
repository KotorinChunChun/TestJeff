"""保存・再送・修正履歴・再起動後の保持を確認する。"""
import sys
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from feedback import Feedback, FeedbackStore


class FeedbackTest(unittest.TestCase):
    def test_history_and_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'ratings.sqlite3'
            store = FeedbackStore(path)
            item = Feedback(event_id=uuid4(), result_id=uuid4(), run_id=uuid4(),
                            target='道具', candidate='一年', model='qwen-0.8b', probability=.1,
                            response_ms=123.4, evaluated_at='2026-10-03T12:00:00+09:00', rating='良かった')
            with ThreadPoolExecutor(max_workers=4) as pool:
                records = list(pool.map(lambda _: store.save(item, '固定版'), range(4)))
            self.assertTrue(all(record == records[0] for record in records))
            self.assertEqual(len(store.records()), 1)
            self.assertEqual(records[0]['sentence'], '「一年」は「道具」ではありません')
            with self.assertRaises(ValueError):
                store.save(item.model_copy(update={'rating':'悪かった'}), '固定版')
            store.save(item.model_copy(update={'event_id':uuid4(), 'rating':'悪かった'}), '固定版')
            restored = FeedbackStore(path).records()
            self.assertEqual([record['rating'] for record in restored], ['良かった', '悪かった'])
            for field, value in [('probability', float('nan')), ('response_ms', -1), ('target', ''), ('rating', '不明')]:
                with self.assertRaises(ValidationError):
                    Feedback.model_validate({**item.model_dump(), field:value})

    def test_parameters_and_legacy_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            store=FeedbackStore(Path(directory)/'ratings.sqlite3')
            item=Feedback(event_id=uuid4(),result_id=uuid4(),run_id=uuid4(),target='道具',candidate='鉛筆',model='qwen-2b',
                          probability=.9,response_ms=10,evaluated_at='2026-10-04T12:00:00+09:00',rating='良かった')
            legacy=store.save(item,'旧版')
            self.assertNotIn('parameters',legacy)
            self.assertEqual(store.save(item,'旧版'),legacy)
            params={'schema_version':1,'connection':{'mode':'fds','device':'cpu'},'threshold':.5,'request':{'state':{'対象':'鉛筆'}}}
            reproduction={'execution':{'backend':'fds','device':'cpu','revision':'サーバー版'}}
            newer=item.model_copy(update={'event_id':uuid4(),'parameters':params,'reproduction':reproduction})
            saved=store.save(newer,'サーバー版')
            params['connection']['device']='cuda'
            restored=store.records()[-1]
            self.assertEqual(restored['parameters']['connection']['device'],'cpu')
            self.assertEqual(restored['reproduction'],reproduction)
            self.assertEqual(store.records()[0],legacy)


if __name__ == '__main__':
    unittest.main()
