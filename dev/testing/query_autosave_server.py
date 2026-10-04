"""自動保存の実画面試験。推論だけを模擬し、専用SQLiteで実保存層を使う。"""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
import tempfile
import time
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'src'))
from battle_store import BattleRecord, BattleStore

MODELS = {'qwen-0.8b':'jeff-qwen3.5-0.8b', 'qwen-2b':'jeff-qwen3.5-2b', 'gemma-e2b':'jeff-gemma4-e2b'}
selected = 'qwen-0.8b'
outage_until = None
attempts = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, value, status=200, mime='application/json'):
        raw = json.dumps(value, ensure_ascii=False).encode() if mime == 'application/json' else value.encode()
        self.send_response(status)
        self.send_header('Content-Type', mime + '; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        parsed = urlparse(self.path)
        route = parsed.path
        if route == '/query-comparison':
            html = (ROOT / 'src/query-comparison.html').read_text(encoding='utf-8-sig')
            html = html.replace('<head>', '<head><script>window.TestJeffConnection={config:{mode:"local",local_device:"cpu",auto_unload:true},key:"local:cpu"};</script>')
            return self.reply(html, mime='text/html')
        files = {'/testjeff/nouns':'data/nouns.json', '/testjeff/abstract-nouns':'data/abstract-nouns.json'}
        for name in ('query-autosave.js', 'query-comparison.js', 'query-comparison-core.js', 'noun-combo.js', 'nouns-core.js', 'battle-core.js'):
            files['/assets/' + name] = name
        if route in files:
            raw = (ROOT / 'src' / files[route]).read_text(encoding='utf-8-sig')
            return self.reply(raw, mime='text/javascript' if route.endswith('.js') else 'text/plain')
        if route == '/health':
            return self.reply({'authentication':False})
        if route == '/testjeff/status':
            return self.reply({'ready':True, 'selected':selected, 'revision':'試験固定版', 'device':'cpu'})
        if route == '/testjeff/battle-runs':
            query = parse_qs(parsed.query)
            return self.reply(store.history(before=int(query.get('before', ['0'])[0]), comparison_only=True))
        if route.startswith('/testjeff/battle-runs/'):
            return self.reply(store.get(int(route.rsplit('/', 1)[-1])))
        if route == '/test-evidence':
            return self.reply({'attempts':attempts, 'rows':store.history(comparison_only=True)['rows']})
        self.reply({'detail':'存在しません'}, 404)

    def do_POST(self):
        global selected, outage_until
        data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        try:
            if self.path == '/testjeff/model':
                selected = data['model']
                return self.reply({'ready':True, 'selected':selected, 'revision':'試験固定版', 'device':'cpu'})
            execution = {'backend':'local', 'model':MODELS[selected], 'device':'cpu', 'revision':'試験固定版'}
            if self.path == '/v1/systemone':
                return self.reply({'model':MODELS[selected], 'answers':{'判定':{'noul':.8}}, 'execution':execution})
            if self.path == '/testjeff/battle-batch':
                return self.reply({'results':[{'probability':.8, 'execution':execution} for _ in data['candidates']]})
            if self.path == '/testjeff/battle-runs':
                record = BattleRecord.model_validate(data)
                if outage_until is None:
                    outage_until = time.monotonic() + 20
                failed = time.monotonic() < outage_until
                attempts.append({'run_id':str(record.run.id), 'failed':failed, 'auto_unload':record.connection.auto_unload})
                if failed:
                    return self.reply({'detail':'試験用の一時的な保存停止'}, 503)
                return self.reply(store.save(record))
            self.reply({'detail':'存在しません'}, 404)
        except Exception as error:
            self.reply({'detail':str(error)}, 422)


if __name__ == '__main__':
    output = ROOT / 'dev/testing/output'
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='autosave-', dir=output) as folder:
        store = BattleStore(Path(folder) / 'battles.sqlite3')
        server = ThreadingHTTPServer(('127.0.0.1', 18768), Handler)
        print('自動保存の専用試験: http://127.0.0.1:18768/query-comparison', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
            (output / 'query-autosave-browser.json').write_text(json.dumps({'attempts':attempts, 'rows':store.history(comparison_only=True)['rows']}, ensure_ascii=False, indent=2), encoding='utf-8')
