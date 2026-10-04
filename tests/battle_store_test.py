"""対戦履歴の不変保存・入力検証・ページ送り・API境界を実モデルなしで確認する。"""
from concurrent.futures import ThreadPoolExecutor
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
from uuid import uuid4

from fastapi import Header, HTTPException
from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from battle_store import BattleConflict, BattleRecord, BattleStore, MAX_RECORD_BYTES
from knowledge import Evaluation, KnowledgeStore, MODELS
import testjeff
import local_device_test


def sample_record(status='完了'):
    run = {'id':str(uuid4()), 'target':'道具', 'candidates':['一年'] * 10,
           'selected_models':['qwen-2b'], 'columns':['qwen-2b','','',''],
           'results':{'qwen-2b':[{'ms':12.5,'probability':.2} for _ in range(10)]},
           'skipped':{}, 'status':status, 'batch':False, 'schema_version':2,
           'parameters':{'requests':[{'state':{'対象':'一年'},'orders':1}], 'threshold':.5,
                         'timing':{'warmup_count':1,'basis':'ブラウザー往復時間'}},
           'execution':{'qwen-2b':{'device':'cpu','revision':'固定版','status':{'max_options':26}}}}
    return {'run':run, 'statistics':{'runs':1,'models':{'qwen-2b':{'count':10,'totalMs':125}}},
            'connection':{'mode':'local','local_device':'cpu','device':'auto','host':'127.0.0.1','port':8767,'key':'local:cpu'}}


class BattleStoreTest(unittest.TestCase):
    def setUp(self):
        output = ROOT / 'dev/testing/output'
        output.mkdir(parents=True, exist_ok=True)
        directory = self.enterContext(tempfile.TemporaryDirectory(dir=output))
        self.store = BattleStore(Path(directory) / 'battles.sqlite3')

    def test_reconnect_preserves_parameters_and_input_shape(self):
        payload = sample_record()
        saved = self.store.save(BattleRecord.model_validate(payload))
        self.assertEqual({key:saved[key] for key in payload}, payload)
        self.assertEqual(saved['run_id'], payload['run']['id'])
        self.assertEqual(saved['id'], 1)
        self.assertIsInstance(saved['recorded_at'], str)
        self.assertEqual(BattleStore(self.store.path).get(saved['id']), saved)
        self.assertNotIn('verdict', saved['run']['results']['qwen-2b'][0])

    def test_repeated_and_simultaneous_saves_are_idempotent(self):
        payload = BattleRecord.model_validate(sample_record())
        with ThreadPoolExecutor(max_workers=6) as executor:
            results = list(executor.map(lambda _:BattleStore(self.store.path).save(payload), range(12)))
        self.assertTrue(all(result == results[0] for result in results))
        self.assertEqual(self.store.save(payload), results[0])
        self.assertEqual(len(self.store.history()['rows']), 1)

    def test_changed_content_never_replaces_original(self):
        payload = sample_record()
        original = self.store.save(BattleRecord.model_validate(payload))
        payload['run']['parameters']['threshold'] = .7
        with self.assertRaises(BattleConflict):
            self.store.save(BattleRecord.model_validate(payload))
        self.assertEqual(self.store.get(original['id']), original)

    def test_criteria_order_is_preserved_and_order_only_changes_conflict(self):
        payload = sample_record()
        questions = {
            '該当':{'type':'noul','criteria':{'true':'該当する','false':'該当しない'}},
            '面積':{'type':'choice','criteria':{str(value):f'{value}%' for value in range(0,101,10)}},
        }
        payload['run']['parameters']['requests'][0]['questions'] = questions
        original = self.store.save(BattleRecord.model_validate(payload))
        restored = BattleStore(self.store.path).get(original['id'])
        restored_questions = restored['run']['parameters']['requests'][0]['questions']
        self.assertEqual(list(restored_questions['該当']['criteria']), ['true','false'])
        self.assertEqual(list(restored_questions['面積']['criteria']), [str(value) for value in range(0,101,10)])
        self.assertEqual(self.store.save(BattleRecord.model_validate(payload)), original)
        for question in ('該当','面積'):
            changed = copy.deepcopy(payload)
            criteria = changed['run']['parameters']['requests'][0]['questions'][question]['criteria']
            changed['run']['parameters']['requests'][0]['questions'][question]['criteria'] = dict(reversed(list(criteria.items())))
            with self.subTest(question=question), self.assertRaises(BattleConflict):
                self.store.save(BattleRecord.model_validate(changed))
        self.assertEqual(self.store.get(original['id']), original)

    def test_interrupted_and_all_failed_runs(self):
        for status in ('中止','失敗','計測不能'):
            payload = sample_record(status)
            payload['run']['results'] = {'qwen-2b':payload['run']['results']['qwen-2b'][:3]} if status == '中止' else {}
            payload['run']['skipped'] = {'qwen-2b':'サーバーに未導入です。'} if status == '計測不能' else {}
            record = self.store.save(BattleRecord.model_validate(payload))
            self.assertEqual(record['run'], payload['run'])
        self.assertEqual(len(self.store.history()['rows']), 3)

    def test_luna_and_partly_unavailable_completed_runs(self):
        payload = sample_record()
        payload['run'].update(selected_models=['gpt-5.6-luna','qwen-2b'], columns=['gpt-5.6-luna','qwen-2b','',''],
                              results={'gpt-5.6-luna':[{'ms':50,'verdict':False} for _ in range(10)]},
                              skipped={'qwen-2b':'モデル未取得'})
        self.store.save(BattleRecord.model_validate(payload))
        payload['run'].update(id=str(uuid4()), selected_models=['gpt-5.6-luna'], columns=['gpt-5.6-luna','','',''], skipped={})
        saved = self.store.save(BattleRecord.model_validate(payload))
        self.assertEqual(list(saved['run']['results']), ['gpt-5.6-luna'])

    def test_page_boundaries_and_unknown_record(self):
        self.assertEqual(self.store.history(), {'rows':[],'next_before':None})
        for _ in range(5):
            self.store.save(BattleRecord.model_validate(sample_record()))
        page1 = self.store.history(limit=2)
        self.assertEqual([row['id'] for row in page1['rows']], [5,4])
        self.assertEqual(page1['next_before'], 4)
        page2 = self.store.history(before=page1['next_before'], limit=2)
        self.assertEqual([row['id'] for row in page2['rows']], [3,2])
        page3 = self.store.history(before=page2['next_before'], limit=2)
        self.assertEqual([row['id'] for row in page3['rows']], [1])
        self.assertIsNone(page3['next_before'])
        self.assertEqual(self.store.history(before=1), {'rows':[],'next_before':None})
        self.assertIsNone(self.store.get(99))
        self.assertEqual(set(page1['rows'][0]), {'id','run_id','recorded_at','target','status','selected_models','batch','connection','comparison_id','comparison_mode'})
        for before, limit in ((-1,50),(0,0),(0,101)):
            with self.assertRaises(ValueError):
                self.store.history(before,limit)

    def test_variable_counts_and_rich_hundred_record(self):
        for count in (1,30,100):
            payload=sample_record()
            payload['run']['candidates']=['犬']*count
            payload['run']['results']={'qwen-2b':[{'ms':1,'probability':.9} for _ in range(count)]}
            payload['run']['parameters']['candidate_count']=count
            saved=self.store.save(BattleRecord.model_validate(payload))
            self.assertEqual(len(self.store.get(saved['id'])['run']['results']['qwen-2b']),count)
            for wrong in (count-1,count+1):
                invalid=copy.deepcopy(payload)
                invalid['run']['results']['qwen-2b']=[{'ms':1,'probability':.9}]*wrong
                with self.assertRaises(ValidationError):
                    BattleRecord.model_validate(invalid)
            interrupted=copy.deepcopy(payload)
            interrupted['run']['status']='中止'
            interrupted['run']['results']['qwen-2b']=interrupted['run']['results']['qwen-2b'][:count-1]
            BattleRecord.model_validate(interrupted)
        payload['run']['selected_models']=list(MODELS)
        payload['run']['columns']=list(MODELS)
        payload['run']['id']=str(uuid4())
        payload['run']['results']={model:[{'ms':1, **({'verdict':True} if model==MODELS[-1] else {'probability':.9}),
                    'reproduction':{'request':{'state':'犬','details':'再現情報'*600}}} for _ in range(100)] for model in MODELS}
        payload['run']['query_totals']={model:{'total_ms':120,'response_sum_ms':100,'count':100,'complete':True} for model in MODELS}
        size=len(json.dumps(payload,ensure_ascii=False).encode('utf-8'))
        self.assertGreater(size,512*1024)
        self.assertLess(size,MAX_RECORD_BYTES)
        saved=self.store.save(BattleRecord.model_validate(payload))
        self.assertEqual(BattleStore(self.store.path).get(saved['id'])['run'],payload['run'])
        evaluation=Evaluation(event_id=uuid4(),run=payload['run'],annotations=[{'expected':'です','comment':''}]*100)
        knowledge=KnowledgeStore(self.store.path.with_name('knowledge.sqlite3'))
        knowledge.save_evaluation(evaluation)
        self.assertEqual(knowledge.export()['latest'][0]['run']['query_totals'],payload['run']['query_totals'])

    def test_comparison_filter_and_metadata_validation(self):
        self.store.save(BattleRecord.model_validate(sample_record()))
        comparison_id=str(uuid4())
        for mode in ('single','batch'):
            payload=sample_record()
            payload['run']['batch']=mode=='batch'
            payload['run']['parameters'].update(comparison_id=comparison_id,comparison_mode=mode,
                                                 method_order=['single','batch'],candidate_count=10)
            self.store.save(BattleRecord.model_validate(payload))
            self.store.save(BattleRecord.model_validate(sample_record()))
        first=self.store.history(comparison_only=True,limit=1)
        self.assertEqual(first['rows'][0]['comparison_id'],comparison_id)
        self.assertEqual(first['rows'][0]['comparison_mode'],'batch')
        second=self.store.history(comparison_only=True,before=first['next_before'],limit=1)
        self.assertEqual(second['rows'][0]['comparison_mode'],'single')
        self.assertIsNone(second['next_before'])
        self.assertEqual(len(self.store.history()['rows']),5)
        for changed in ({'comparison_id':'invalid'}, {'comparison_mode':'unknown'},
                        {'candidate_count':30}, {'method_order':['batch','batch']}):
            invalid=copy.deepcopy(payload)
            invalid['run']['parameters'].update(changed)
            with self.assertRaises(ValidationError):
                BattleRecord.model_validate(invalid)

    def test_malformed_snapshots_are_rejected(self):
        invalid = [
            {'id':'not-uuid'}, {'target':'  '}, {'candidates':['一年'] * 9},
            {'candidates':[''] * 10}, {'selected_models':[]},
            {'selected_models':['qwen-2b','qwen-2b']}, {'columns':['','','','qwen-0.8b']},
            {'status':'実行中'}, {'batch':'true'}, {'results':{}}, {'skipped':{'qwen-2b':'失敗'}},
            {'results':{'qwen-2b':[{'ms':1,'verdict':True}] * 10}},
            {'results':{'qwen-2b':[{'ms':1,'probability':.5}] * 11}},
            {'results':{'qwen-2b':[{'ms':-1,'probability':.5}] * 10}},
        ]
        for changes in invalid:
            with self.subTest(changes=changes):
                payload = sample_record()
                payload['run'].update(changes)
                with self.assertRaises(ValidationError):
                    BattleRecord.model_validate(payload)
        payload = sample_record('中止')
        payload['run']['results']['unknown'] = []
        with self.assertRaises(ValidationError):
            BattleRecord.model_validate(payload)

    def test_no_secrets_nonfinite_values_or_oversized_payload(self):
        for credential in ('api_key','Authorization','token'):
            payload = sample_record()
            payload['connection'][credential] = '秘密のダミー'
            with self.assertRaises(ValidationError):
                BattleRecord.model_validate(payload)
        payload = sample_record()
        payload['connection']['key'] = '認証キーを誤指定'
        with self.assertRaises(ValidationError):
            BattleRecord.model_validate(payload)
        for value in (float('nan'), float('inf'), -float('inf')):
            for part in ('run','statistics'):
                payload = sample_record()
                payload[part]['追加情報'] = {'深い階層':[value]}
                with self.assertRaises(ValidationError):
                    BattleRecord.model_validate(payload)
        payload = sample_record()
        payload['run']['parameters']['large'] = 'あ' * (MAX_RECORD_BYTES // 3)
        with self.assertRaises(ValidationError):
            BattleRecord.model_validate(payload)


class BattleAPI(unittest.TestCase):
    def setUp(self):
        output = ROOT / 'dev/testing/output'
        output.mkdir(parents=True, exist_ok=True)
        folder = Path(self.enterContext(tempfile.TemporaryDirectory(dir=output)))
        self.database = folder / 'battles.sqlite3'
        self.enterContext(patch.dict(testjeff.os.environ, {'TESTJEFF_BATTLE_PATH':str(self.database)}))
        local_device_test.LocalDeviceTest.make_server(self)
        def authenticate(authorization: str | None = Header(default=None)):
            if authorization != 'Bearer test-only':
                raise HTTPException(401, '認証が必要です。')
        self.server.app.dependency_overrides[self.server.authenticate] = authenticate
        self.headers = {'Authorization':'Bearer test-only'}

    def test_api_save_list_detail_and_conflict(self):
        payload = sample_record()
        response = self.client.post('/testjeff/battle-runs', json=payload, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        saved = response.json()
        self.assertTrue(self.database.exists())
        self.assertEqual(self.client.post('/testjeff/battle-runs',json=payload,headers=self.headers).json(), saved)
        self.assertEqual(self.client.get('/testjeff/battle-runs/1',headers=self.headers).json(), saved)
        self.assertEqual(self.client.get('/testjeff/battle-runs?limit=1',headers=self.headers).json()['rows'][0]['run_id'], payload['run']['id'])
        changed = copy.deepcopy(payload)
        changed['run']['target'] = '時間'
        self.assertEqual(self.client.post('/testjeff/battle-runs',json=changed,headers=self.headers).status_code, 409)
        self.assertEqual(self.client.get('/testjeff/battle-runs/1',headers=self.headers).json(), saved)

    def test_api_comparison_filter_and_larger_saved_payload(self):
        self.client.post('/testjeff/battle-runs',json=sample_record(),headers=self.headers)
        payload=sample_record()
        payload['run']['parameters'].update(comparison_id=str(uuid4()),comparison_mode='single',
                                             method_order=['batch','single'],candidate_count=10,
                                             metadata='保存した実行条件'*40000)
        self.assertGreater(len(json.dumps(payload,ensure_ascii=False).encode('utf-8')),512*1024)
        response=self.client.post('/testjeff/battle-runs',json=payload,headers=self.headers)
        self.assertEqual(response.status_code,200)
        listing=self.client.get('/testjeff/battle-runs?comparison_only=true',headers=self.headers).json()
        self.assertEqual(len(listing['rows']),1)
        self.assertEqual(listing['rows'][0]['run_id'],payload['run']['id'])
        self.assertEqual(listing['rows'][0]['comparison_mode'],'single')
        self.assertEqual(len(self.client.get('/testjeff/battle-runs',headers=self.headers).json()['rows']),2)
        annotations=[{'expected':'です','comment':''}]*10
        testjeff.KnowledgeStore.return_value.save_evaluation.return_value={'saved':True}
        self.assertEqual(self.client.post('/testjeff/knowledge',json={'event_id':str(uuid4()),'run':payload['run'],
                         'annotations':annotations},headers=self.headers).status_code,200)

    def test_api_auth_invalid_and_oversized(self):
        self.assertEqual(self.client.post('/testjeff/battle-runs',json=sample_record()).status_code, 401)
        self.assertEqual(self.client.get('/testjeff/battle-runs').status_code, 401)
        self.assertEqual(self.client.get('/testjeff/battle-runs/1').status_code, 401)
        for query in ('before=-1','limit=0','limit=101','before=invalid'):
            self.assertEqual(self.client.get('/testjeff/battle-runs?'+query,headers=self.headers).status_code, 422)
        self.assertEqual(self.client.get('/testjeff/battle-runs/999',headers=self.headers).status_code, 404)
        headers = {**self.headers, 'Content-Type':'application/json'}
        for raw in ('{', '[]', '{"run": NaN}', '{"run": {"extra":1e500}}'):
            self.assertEqual(self.client.post('/testjeff/battle-runs', content=raw, headers=headers).status_code, 422)
        self.assertEqual(self.client.post('/testjeff/battle-runs',content=' ' * (MAX_RECORD_BYTES+1),headers=headers).status_code, 413)

    def test_fds_headers_do_not_forward_history(self):
        remote = Mock()
        with patch.object(testjeff.FDS, 'from_request', return_value=remote):
            response = self.client.post('/testjeff/battle-runs',json=sample_record(),headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(self.database.exists())
        remote.predict.assert_not_called()
        remote.status.assert_not_called()


if __name__ == '__main__':
    unittest.main()
