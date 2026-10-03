"""CPUの差分・正規化・短時間の再取得とWindows実測を検証する。"""
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from resources import ResourceMeter, working_set_bytes


class ResourceTest(unittest.TestCase):
    def test_cpu_and_unavailable(self):
        meter = ResourceMeter()
        torch = Mock()
        torch.cuda.memory_allocated.return_value = 1024
        torch.cuda.memory_reserved.return_value = 2048
        with patch('resources.time.perf_counter', side_effect=[10, 12, 12.1, 14]), \
             patch('resources.time.process_time', side_effect=[1, 3, 3.1, 4]), \
             patch('resources.os.cpu_count', return_value=4), \
             patch('resources.working_set_bytes', return_value=4096):
            self.assertIsNone(meter.sample(torch, 'cuda')['cpu_percent'])
            sample = meter.sample(torch, 'cuda')
            self.assertEqual(sample['cpu_percent'], 25)
            self.assertEqual(sample['gpu_reserved_bytes'], 2048)
            self.assertEqual(meter.sample(torch, 'cuda')['cpu_percent'], 25)
            self.assertIsNone(meter.sample(torch, 'cpu')['gpu_allocated_bytes'])
        with patch('resources.working_set_bytes', side_effect=OSError), \
             patch.object(torch.cuda, 'memory_allocated', side_effect=RuntimeError):
            sample = meter.sample(torch, 'cuda')
            self.assertIsNone(sample['memory_bytes'])
            self.assertIsNone(sample['gpu_allocated_bytes'])

    @unittest.skipUnless(sys.platform == 'win32', 'Windows実測')
    def test_working_set(self):
        self.assertGreater(working_set_bytes(), 0)


if __name__ == '__main__':
    unittest.main()
