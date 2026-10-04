"""入力と実行条件をJSONへ残す。認証値や元画像のバイナリは記録しない。"""
import base64
import copy
from functools import lru_cache
import hashlib
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
import platform

ROOT = Path(__file__).resolve().parents[1]


@lru_cache(maxsize=1)
def application():
    digest = hashlib.sha256()
    # このアプリの処理・画面・質問定義と固定された上流コードを識別する。
    files = [ROOT / 'models.json']
    for folder in (ROOT / 'src', ROOT / 'vendor/jeff/src/jeff'):
        files.extend(path for path in folder.rglob('*') if path.is_file() and path.suffix in ('.py', '.js', '.html', '.json', '.css'))
    for path in sorted(files):
        digest.update(path.relative_to(ROOT).as_posix().encode('utf-8'))
        digest.update(b'\0')
        digest.update(path.read_bytes())
    packages = {}
    for package in ('torch', 'transformers', 'Pillow', 'fastapi'):
        try:
            packages[package] = version(package)
        except PackageNotFoundError:
            packages[package] = None
    return {'name':'TestJeff', 'version':'0.18.0', 'source_sha256':digest.hexdigest(),
            'python':platform.python_version(), 'platform':platform.platform(), 'packages':packages}


def image_reference(value):
    header, _, encoded = value.partition(',')
    raw = base64.b64decode(encoded, validate=True)
    return {'sha256':hashlib.sha256(raw).hexdigest(), 'size_bytes':len(raw),
            'mime':header.removeprefix('data:').removesuffix(';base64'), 'embedded':False}


def safe_request(payload, *, jev_defaults=True):
    data = payload.model_dump(mode='json', exclude_none=True) if hasattr(payload, 'model_dump') else copy.deepcopy(payload)
    if jev_defaults:
        data.setdefault('orders', 1)
    data['images'] = [image_reference(value) for value in data.get('images', [])]
    return data


def reproduction(payload, execution):
    return {'schema_version':1, 'application':application(), 'request':safe_request(payload),
            'execution':copy.deepcopy(execution)}


IMAGE_PREPROCESSING = {
    'max_file_bytes':8_000_000, 'max_source_pixels':16_000_000,
    'exif_transpose':True, 'max_input_side':1024, 'resampling':'LANCZOS',
    'intermediate_mode':'RGBA', 'output_mode':'RGB', 'alpha_background':'white',
    'output_format':'JPEG', 'jpeg_quality':90,
    'original_image_embedded':False, 'replay_requires_original_image':True,
}
