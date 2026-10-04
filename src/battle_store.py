"""対戦終了時の結果・入力・実行条件を変更不可のSQLite履歴として保存する。"""
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import sqlite3
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator

from knowledge import MODELS, Prediction, Snapshot

MAX_RECORD_BYTES = 8 * 1024 * 1024


class BattleSnapshot(BaseModel):
    model_config = ConfigDict(extra='allow', allow_inf_nan=False)
    id: UUID
    target: str = Field(min_length=1, max_length=80)
    candidates: list[str] = Field(min_length=1, max_length=100)
    results: dict[str, list[Prediction]]
    skipped: dict[str, str] = Field(default_factory=dict)
    selected_models: list[str] = Field(default_factory=lambda:list(MODELS), min_length=1, max_length=4)
    columns: list[str] | None = Field(default=None, min_length=4, max_length=4)
    status: Literal['完了', '中止', '失敗', '計測不能']
    batch: StrictBool = False

    @model_validator(mode='after')
    def consistent_results(self):
        if not self.target.strip() or any(not word.strip() or len(word) > 80 for word in self.candidates):
            raise ValueError('質問する名詞または候補が不正です。')
        selected = set(self.selected_models)
        if len(selected) != len(self.selected_models) or not selected <= set(MODELS):
            raise ValueError('選択モデルが不正です。')
        if self.columns is not None and [model for model in self.columns if model] != self.selected_models:
            raise ValueError('列のモデルと選択モデルの並び順が一致しません。')
        if not (set(self.results) | set(self.skipped)) <= selected or set(self.results) & set(self.skipped):
            raise ValueError('結果または計測不能のモデルが選択と一致しません。')
        if any(not reason.strip() or len(reason) > 4000 for reason in self.skipped.values()):
            raise ValueError('計測不能の理由が不正です。')
        for model, items in self.results.items():
            if len(items) > len(self.candidates) or any((item.verdict is None if model == 'gpt-5.6-luna' else item.probability is None) for item in items):
                raise ValueError('モデルごとの判定件数は候補数を超えず、適切な判定を含む必要があります。')
        parameters = (self.model_extra or {}).get('parameters')
        if isinstance(parameters, dict):
            candidate_count = parameters.get('candidate_count')
            if candidate_count is not None and (type(candidate_count) is not int or candidate_count != len(self.candidates)):
                raise ValueError('記録した問い合わせ件数が候補数と一致しません。')
            if 'comparison_id' in parameters:
                try:
                    UUID(parameters['comparison_id'])
                except (ValueError, TypeError, AttributeError) as error:
                    raise ValueError('比較IDをUUIDで指定してください。') from error
                if parameters.get('comparison_mode') not in ('single', 'batch'):
                    raise ValueError('比較方式はsingleまたはbatchで指定してください。')
                if (parameters['comparison_mode'] == 'batch') != self.batch:
                    raise ValueError('比較方式と一括問い合わせ設定が一致しません。')
                if parameters.get('method_order') not in (['single','batch'], ['batch','single']):
                    raise ValueError('比較順序にはsingleとbatchを1回ずつ指定してください。')
                if candidate_count is None:
                    raise ValueError('比較には問い合わせ件数の記録が必要です。')
        if self.status == '完了':
            Snapshot.model_validate(self.model_dump())
        return self


class PublicConnection(BaseModel):
    """接続先とデバイスだけを許可し、認証情報を保存対象にしない。"""
    model_config = ConfigDict(extra='forbid')
    mode: Literal['local', 'fds']
    local_device: Literal['cpu', 'cuda'] | None = None
    device: Literal['auto', 'cpu', 'cuda'] | None = None
    auto_unload: StrictBool | None = None
    host: str | None = Field(default=None, max_length=255)
    port: int | None = Field(default=None, ge=1, le=65535)
    # クライアントの集計領域識別子。認証用APIキーではない。
    key: str | None = Field(default=None, max_length=512)

    @model_validator(mode='after')
    def public_key(self):
        if self.key is not None:
            allowed = {'local', 'local:cpu', 'local:cuda'} if self.mode == 'local' else {f'fds:{self.host}:{self.port}:{self.device}'}
            if self.key not in allowed:
                raise ValueError('keyには公開の接続先識別子だけを指定してください。認証キーは保存できません。')
        return self


class BattleRecord(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    run: BattleSnapshot
    statistics: dict | None = None
    connection: PublicConnection | None = None

    @model_validator(mode='after')
    def finite_json_within_limit(self):
        def check_finite(value):
            if isinstance(value, float) and not math.isfinite(value):
                raise ValueError('保存データには有限値だけを指定してください。')
            if isinstance(value, dict):
                for item in value.values():
                    check_finite(item)
            elif isinstance(value, (list, tuple)):
                for item in value:
                    check_finite(item)
        # PydanticのJSON変換がNaNをnullに変える前にextraも含めて確認する。
        check_finite(self.model_dump())
        try:
            raw = json.dumps(self.model_dump(mode='json', exclude_unset=True), ensure_ascii=False,
                             allow_nan=False, separators=(',', ':'))
        except (ValueError, TypeError, OverflowError) as error:
            raise ValueError('保存データには有限値のJSONだけを指定してください。') from error
        if len(raw.encode('utf-8')) > MAX_RECORD_BYTES:
            raise ValueError('対戦記録は8MiB以内にしてください。')
        return self


class BattleConflict(ValueError):
    pass


class BattleStore:
    def __init__(self, path: Path):
        self.path = Path(path)

    @contextmanager
    def connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=10)
        try:
            connection.execute('''CREATE TABLE IF NOT EXISTS battle_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT UNIQUE NOT NULL,
                recorded_at TEXT NOT NULL,
                payload TEXT NOT NULL
            )''')
            with connection:
                # 比較とINSERTを同じ排他トランザクションにする。
                connection.execute('BEGIN IMMEDIATE')
                yield connection
        finally:
            connection.close()

    @staticmethod
    def record(row):
        return {'id':row[0], 'run_id':row[1], 'recorded_at':row[2], **json.loads(row[3])}

    def save(self, record: BattleRecord):
        payload = record.model_dump(mode='json', exclude_unset=True)
        # 両方の任意欄は詳細APIで常に返す。run内の未指定値は増やさない。
        payload.setdefault('statistics', None)
        payload.setdefault('connection', None)
        # criteriaの挿入順は推論条件の一部。キーを並べ替えず保存・再送比較する。
        encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
        with self.connect() as connection:
            existing = connection.execute('SELECT id,run_id,recorded_at,payload FROM battle_runs WHERE run_id=?',
                                          (str(record.run.id),)).fetchone()
            if existing:
                if existing[3] != encoded:
                    raise BattleConflict('同じ対戦IDで内容が変わっています。元の記録は変更しませんでした。')
                return self.record(existing)
            recorded_at = datetime.now(timezone.utc).isoformat()
            cursor = connection.execute('INSERT INTO battle_runs(run_id,recorded_at,payload) VALUES(?,?,?)',
                                        (str(record.run.id), recorded_at, encoded))
            return self.record((cursor.lastrowid, str(record.run.id), recorded_at, encoded))

    def get(self, record_id: int):
        with self.connect() as connection:
            row = connection.execute('SELECT id,run_id,recorded_at,payload FROM battle_runs WHERE id=?',
                                     (record_id,)).fetchone()
        return self.record(row) if row else None

    def history(self, before: int = 0, limit: int = 50, comparison_only: bool = False):
        if before < 0 or not 1 <= limit <= 100:
            raise ValueError('履歴の取得範囲が不正です。')
        with self.connect() as connection:
            rows = connection.execute('''SELECT id,run_id,recorded_at,payload FROM battle_runs
                WHERE (?=0 OR id<?) AND (?=0 OR json_type(payload,'$.run.parameters.comparison_id')='text')
                ORDER BY id DESC LIMIT ?''', (before, before, comparison_only, limit + 1)).fetchall()
        summaries = []
        for row in rows[:limit]:
            record = self.record(row)
            run = record['run']
            parameters = run.get('parameters') if isinstance(run.get('parameters'), dict) else {}
            summaries.append({key:record[key] for key in ('id','run_id','recorded_at','connection')} |
                             {'target':run['target'], 'status':run['status'],
                              'selected_models':run.get('selected_models', list(MODELS)), 'batch':run.get('batch', False),
                              'comparison_id':parameters.get('comparison_id'), 'comparison_mode':parameters.get('comparison_mode')})
        return {'rows':summaries, 'next_before':summaries[-1]['id'] if len(rows) > limit else None}
