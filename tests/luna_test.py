"""CLIのモデル固定・失敗・排他・真偽型を、外部通信なしで確認する。"""
import json
import hashlib
import tempfile
import sys
import subprocess
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from pydantic import ValidationError
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
import luna


class LunaTest(unittest.TestCase):
    def test_input(self):
        for value in (' ', 'あ' * 81):
            with self.assertRaises(ValidationError):
                luna.LunaInput(target=value, candidate='犬')

    def test_cli(self):
        body = luna.LunaInput(target='動物', candidate='犬')
        process = Mock(returncode=0)
        output = '\n'.join(json.dumps(x) for x in [
            {'type':'item.completed','item':{'type':'agent_message','text':'{"verdict":false}'}},
            {'type':'turn.completed','usage':{'output_tokens':10}}])
        process.communicate.return_value = (output, '')
        with patch('luna.executable', return_value='codex.exe'), patch('luna.subprocess.Popen', return_value=process) as start:
            result = luna.classify(body)
            self.assertIs(result['verdict'], False)
            self.assertEqual(result['model'], 'gpt-5.6-luna')
            args = start.call_args.args[0]
            self.assertEqual(args[args.index('-m')+1], 'gpt-5.6-luna')
            self.assertIn('read-only', args)
            self.assertIn('--output-schema', args)
            metadata=result['reproduction']
            self.assertEqual(metadata['request']['prompt'],process.communicate.call_args.args[0])
            self.assertEqual(metadata['request']['input'],body.model_dump())
            self.assertEqual(metadata['request']['output_schema'],json.loads(Path(args[args.index('--output-schema')+1]).read_text(encoding='utf-8')))
            self.assertFalse(metadata['request']['batch'])
            self.assertEqual(metadata['execution']['timeout_seconds'],process.communicate.call_args.kwargs['timeout'])
            self.assertEqual(metadata['execution']['options']['approval'],args[args.index('-a')+1])
            self.assertEqual(metadata['execution']['options']['sandbox'],args[args.index('--sandbox')+1])
            self.assertIn('--ignore-user-config',args)
            self.assertFalse(metadata['execution']['options']['shell_tool'])
            self.assertEqual(metadata['execution']['options']['web_search'],'disabled')
            process.returncode = 1
            with self.assertRaises(RuntimeError):
                luna.classify(body)
            self.assertFalse(luna.LOCK.locked())
            process.returncode = 0
            process.communicate.return_value = (output.replace('false', '"はい"'), '')
            with self.assertRaises((ValidationError, ValueError)):
                luna.classify(body)
        with luna.LOCK:
            with self.assertRaises(BlockingIOError):
                luna.classify(body)

    def test_batch_cli(self):
        process=Mock(returncode=0)
        payload=json.dumps({'verdicts':[True,False]*5})
        process.communicate.return_value=('\n'.join(json.dumps(x) for x in [
            {'type':'item.completed','item':{'type':'agent_message','text':payload}},
            {'type':'turn.completed','usage':{}}]),'')
        with patch('luna.executable',return_value='codex.exe'), patch('luna.subprocess.Popen',return_value=process) as start:
            result=luna.classify(luna.LunaBatchInput(target='動物',candidates=['犬']*10))
            self.assertEqual(result['verdicts'],[True,False]*5)
            self.assertEqual(start.call_count,1)
            self.assertTrue(any('luna-batch-schema.json' in arg for arg in start.call_args.args[0]))
            self.assertTrue(result['reproduction']['request']['batch'])
            self.assertEqual(result['reproduction']['request']['prompt'],process.communicate.call_args.args[0])
            self.assertIn('verdicts',result['reproduction']['request']['output_schema']['properties'])
        with self.assertRaises(ValidationError):
            luna.BatchVerdict(verdicts=[True]*101)

    def test_variable_batch_counts_and_exact_response_length(self):
        def response(values):
            return ('\n'.join(json.dumps(event) for event in [
                {'type':'item.completed','item':{'type':'agent_message','text':json.dumps({'verdicts':values})}},
                {'type':'turn.completed','usage':{}}]), '')
        process=Mock(returncode=0)
        with patch('luna.executable',return_value='codex.exe'), patch('luna.subprocess.Popen',return_value=process):
            for count in (1,10,30,100):
                body=luna.LunaBatchInput(target='動物',candidates=['犬']*count)
                process.communicate.return_value=response([True]*count)
                result=luna.classify(body)
                self.assertEqual(len(result['verdicts']),count)
                self.assertIn(f'入力順に{count}個',result['reproduction']['request']['prompt'])
                for returned in (count-1,count+1):
                    process.communicate.return_value=response([True]*returned)
                    with self.subTest(requested=count,returned=returned), self.assertRaises((ValidationError,ValueError)):
                        luna.classify(body)
                    self.assertFalse(luna.LOCK.locked())
        for candidates in ([], ['犬']*101, [' '], ['あ'*81]):
            with self.assertRaises(ValidationError):
                luna.LunaBatchInput(target='動物',candidates=candidates)

    def test_timeout(self):
        process = Mock(pid=123)
        process.communicate.side_effect = [subprocess.TimeoutExpired('codex', 90), ('', '')]
        with patch('luna.executable', return_value='codex.exe'), \
             patch('luna.subprocess.Popen', return_value=process), \
             patch('luna.subprocess.run') as terminate:
            with self.assertRaises(TimeoutError):
                luna.classify(luna.LunaInput(target='動物', candidate='犬'))
            if sys.platform == 'win32':
                self.assertEqual(terminate.call_args.args[0], ['taskkill', '/PID', '123', '/T', '/F'])
            self.assertFalse(luna.LOCK.locked())

    def test_executable_identity_without_path(self):
        with tempfile.TemporaryDirectory() as directory:
            binary=Path(directory)/'codex.exe'
            binary.write_bytes(b'CLI identification test')
            before=luna._executable_sha256.cache_info().hits
            first=luna.executable_identity(str(binary))
            self.assertEqual(first,luna.executable_identity(str(binary)))
            self.assertEqual(luna._executable_sha256.cache_info().hits,before+1)
            self.assertEqual(first['sha256'],hashlib.sha256(binary.read_bytes()).hexdigest())
            self.assertNotIn(directory,json.dumps(first))
            binary.write_bytes(b'updated CLI')
            self.assertNotEqual(first,luna.executable_identity(str(binary)))


if __name__ == '__main__':
    unittest.main()
