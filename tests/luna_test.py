"""CLIのモデル固定・失敗・排他・真偽型を、外部通信なしで確認する。"""
import json
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
        with self.assertRaises(ValidationError):
            luna.BatchVerdict(verdicts=[True]*9)

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


if __name__ == '__main__':
    unittest.main()
