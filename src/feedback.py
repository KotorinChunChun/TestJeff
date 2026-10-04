"""名詞判定のフィードバックを、判定時の値とともに追記保存する。"""
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field


class Feedback(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True, allow_inf_nan=False)
    event_id: UUID
    result_id: UUID
    run_id: UUID
    target: str = Field(min_length=1, max_length=80)
    candidate: str = Field(min_length=1, max_length=80)
    model: Literal['qwen-0.8b', 'qwen-2b', 'gemma-e2b']
    probability: float = Field(ge=0, le=1)
    response_ms: float = Field(ge=0)
    evaluated_at: AwareDatetime
    execution: dict | None = None
    rating: Literal['良かった', '悪かった']


class FeedbackStore:
    def __init__(self, path: Path):
        self.path = path

    @contextmanager
    def connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=10)
        try:
            connection.execute('CREATE TABLE IF NOT EXISTS feedback (sequence INTEGER PRIMARY KEY, event_id TEXT UNIQUE NOT NULL, payload TEXT NOT NULL)')
            with connection:
                connection.execute('BEGIN IMMEDIATE')
                yield connection
        finally:
            connection.close()

    def save(self, feedback: Feedback, revision: str):
        payload = feedback.model_dump(mode='json')
        payload['revision'] = revision
        payload['sentence'] = f'「{feedback.candidate}」は「{feedback.target}」' + ('です' if feedback.probability >= .5 else 'ではありません')
        with self.connect() as connection:
            existing = connection.execute('SELECT payload FROM feedback WHERE event_id=?', (str(feedback.event_id),)).fetchone()
            if existing:
                stored = json.loads(existing[0])
                if any(stored[key] != value for key, value in payload.items()):
                    raise ValueError('同じ記録IDで内容が変わっています。')
                return stored
            payload['recorded_at'] = datetime.now(timezone(timedelta(hours=9))).isoformat()
            connection.execute('INSERT INTO feedback(event_id,payload) VALUES(?,?)',
                               (str(feedback.event_id), json.dumps(payload, ensure_ascii=False)))
        return payload

    def records(self):
        with self.connect() as connection:
            return [json.loads(row[0]) for row in connection.execute('SELECT payload FROM feedback ORDER BY sequence')]
