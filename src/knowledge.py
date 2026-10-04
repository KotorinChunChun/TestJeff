"""ユーザー評価と対戦時点の結果を品質評価資料として保存する。"""
import json
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator
from feedback import FeedbackStore

MODELS = ('qwen-0.8b', 'qwen-2b', 'gemma-e2b', 'gpt-5.6-luna')


class Prediction(BaseModel):
    model_config = ConfigDict(extra='allow', allow_inf_nan=False)
    ms: float = Field(ge=0)
    probability: float | None = Field(default=None, ge=0, le=1)
    verdict: StrictBool | None = None


class Snapshot(BaseModel):
    model_config = ConfigDict(extra='allow')
    id: UUID
    target: str = Field(min_length=1, max_length=80)
    candidates: list[str] = Field(min_length=10, max_length=10)
    results: dict[str, list[Prediction]]
    status: Literal['完了']
    skipped: dict[str,str] = Field(default_factory=dict)
    selected_models: list[str] = Field(default_factory=lambda:list(MODELS), min_length=1, max_length=4)

    @model_validator(mode='after')
    def complete(self):
        if any(not word.strip() or len(word) > 80 for word in self.candidates):
            raise ValueError('候補が不正です。')
        if len(set(self.selected_models)) != len(self.selected_models) or not set(self.selected_models) <= set(MODELS):
            raise ValueError('選択モデルが不正です。')
        if not self.results or set(self.results) & set(self.skipped) or set(self.results) | set(self.skipped) != set(self.selected_models):
            raise ValueError('選択モデルの結果または計測不能の理由が必要です。')
        for model, items in self.results.items():
            if len(items) != 10 or any((item.verdict is None if model == 'gpt-5.6-luna' else item.probability is None) for item in items):
                raise ValueError('計測したモデルごとに10件の判定が必要です。')
        return self


class Annotation(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    expected: Literal['未評価', 'です', 'ではありません', '判断困難']
    comment: str = Field(default='', max_length=1000)


class Evaluation(BaseModel):
    model_config = ConfigDict(extra='forbid')
    event_id: UUID
    run: Snapshot
    annotations: list[Annotation] = Field(min_length=10, max_length=10)

    @model_validator(mode='after')
    def reviewed(self):
        if not any(a.expected != '未評価' or a.comment for a in self.annotations):
            raise ValueError('ユーザー判定またはコメントを入力してください。')
        return self


class KnowledgeStore(FeedbackStore):
    def save_evaluation(self, evaluation):
        payload = evaluation.model_dump(mode='json', exclude_none=True)
        payload['schema_version'] = 1
        payload['scores'] = {}
        for model, items in evaluation.run.results.items():
            correct = total = 0
            for item, annotation in zip(items, evaluation.annotations):
                if annotation.expected not in ('です', 'ではありません'):
                    continue
                total += 1
                verdict = item.verdict if model == 'gpt-5.6-luna' else item.probability >= .5
                correct += verdict == (annotation.expected == 'です')
            payload['scores'][model] = {'correct':correct, 'total':total, 'agreement_rate':correct / total if total else None}
        with self.connect() as connection:
            existing = connection.execute('SELECT payload FROM feedback WHERE event_id=?', (str(evaluation.event_id),)).fetchone()
            if existing:
                stored = json.loads(existing[0])
                if any(stored[key] != value for key, value in payload.items()):
                    raise ValueError('同じ保存IDで内容が変わっています。')
                return stored
            payload['recorded_at'] = datetime.now(timezone.utc).isoformat()
            connection.execute('INSERT INTO feedback(event_id,payload) VALUES(?,?)', (str(evaluation.event_id), json.dumps(payload, ensure_ascii=False)))
        return payload

    def export(self):
        history = self.records()
        latest = {}
        for record in history:
            latest[record['run']['id']] = record
        return {'schema_version':1, 'latest':list(latest.values()), 'history':history}
