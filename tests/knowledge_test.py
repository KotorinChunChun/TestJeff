"""品質評価の紐付け・履歴・採点・再送・永続化を確認する。"""
import sys
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4
from pydantic import ValidationError
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from knowledge import Evaluation, KnowledgeStore, MODELS


class KnowledgeTest(unittest.TestCase):
    def test_variable_counts_require_matching_results_and_annotations(self):
        for count in (1,10,30,100):
            run = {'id':str(uuid4()), 'target':'動物', 'candidates':['犬'] * count, 'status':'完了',
                   'selected_models':[MODELS[0]], 'results':{MODELS[0]:[{'ms':1,'probability':.9} for _ in range(count)]}}
            annotations = [{'expected':'です','comment':''} for _ in range(count)]
            event = Evaluation(event_id=uuid4(),run=run,annotations=annotations)
            self.assertEqual(len(event.annotations),count)
            for wrong in (count-1,count+1):
                with self.subTest(count=count,annotations=wrong), self.assertRaises(ValidationError):
                    Evaluation(event_id=uuid4(),run=run,annotations=[annotations[0]] * wrong)
                with self.subTest(count=count,results=wrong), self.assertRaises(ValidationError):
                    Evaluation(event_id=uuid4(),run={**run,'results':{MODELS[0]:[{'ms':1,'probability':.9}]*wrong}},annotations=annotations)
        for count in (0,101):
            with self.assertRaises(ValidationError):
                Evaluation(event_id=uuid4(),run={**run,'candidates':['犬'] * count},annotations=annotations)

    def test_records(self):
        root = Path(__file__).resolve().parents[1] / 'dev/testing/output'
        root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=root) as directory:
            store = KnowledgeStore(Path(directory) / 'test.sqlite3')
            run = {'id':str(uuid4()), 'target':'道具', 'candidates':['一年'] * 10, 'status':'完了',
                   'results':{m:[{'ms':30, **({'verdict':True} if m == MODELS[-1] else {'probability':.1})} for _ in range(10)] for m in MODELS}}
            annotations = [{'expected':'未評価','comment':''} for _ in range(10)]
            with self.assertRaises(ValidationError):
                Evaluation(event_id=uuid4(), run=run, annotations=annotations)
            annotations[0] = {'expected':'ではありません','comment':'期間を表す名詞のため'}
            annotations[1] = {'expected':'判断困難','comment':'文脈が必要'}
            event = Evaluation(event_id=uuid4(), run=run, annotations=annotations)
            first = store.save_evaluation(event)
            self.assertEqual(store.save_evaluation(event), first)
            self.assertEqual(first['scores'][MODELS[0]], {'correct':1,'total':1,'agreement_rate':1})
            self.assertEqual(first['scores'][MODELS[-1]]['correct'], 0)
            annotations[0]['expected'] = 'です'
            changed = Evaluation(event_id=event.event_id, run=run, annotations=annotations)
            with self.assertRaises(ValueError):
                store.save_evaluation(changed)
            changed.event_id = uuid4()
            store.save_evaluation(changed)
            restored = KnowledgeStore(store.path).export()
            self.assertEqual(len(restored['history']), 2)
            self.assertEqual(len(restored['latest']), 1)
            self.assertEqual(restored['latest'][0]['annotations'][0]['expected'], 'です')
            partial = {**run, 'id':str(uuid4()), 'results':{MODELS[0]:run['results'][MODELS[0]]}, 'skipped':{m:'未導入' for m in MODELS[1:]}}
            saved = store.save_evaluation(Evaluation(event_id=uuid4(), run=partial, annotations=annotations))
            self.assertEqual(set(saved['scores']), {MODELS[0]})
            self.assertEqual(len(saved['run']['skipped']), 3)
            selected_run = {**partial, 'id':str(uuid4()), 'skipped':{}, 'selected_models':[MODELS[0]], 'columns':[MODELS[0],'','','']}
            selected_saved = store.save_evaluation(Evaluation(event_id=uuid4(), run=selected_run, annotations=annotations))
            self.assertEqual(selected_saved['run']['selected_models'], [MODELS[0]])
            with self.assertRaises(ValidationError):
                Evaluation(event_id=uuid4(), run={**selected_run,'selected_models':[]}, annotations=annotations)
            run['results'][MODELS[0]].pop()
            with self.assertRaises(ValidationError):
                Evaluation(event_id=uuid4(), run=run, annotations=annotations)


if __name__ == '__main__':
    unittest.main()
