"""サーバープロセスの使用量を、追加依存なしで取得する。"""
import ctypes
from ctypes import wintypes
import os
import threading
import time


def working_set_bytes():
    if os.name != 'nt':
        return None

    class Counters(ctypes.Structure):
        _fields_ = [('cb', wintypes.DWORD), ('PageFaultCount', wintypes.DWORD)] + [
            (name, ctypes.c_size_t) for name in ('PeakWorkingSetSize', 'WorkingSetSize',
            'QuotaPeakPagedPoolUsage', 'QuotaPagedPoolUsage', 'QuotaPeakNonPagedPoolUsage',
            'QuotaNonPagedPoolUsage', 'PagefileUsage', 'PeakPagefileUsage')]

    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    psapi = ctypes.WinDLL('psapi', use_last_error=True)
    psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
    psapi.GetProcessMemoryInfo.restype = wintypes.BOOL
    counters = Counters()
    counters.cb = ctypes.sizeof(counters)
    if not psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
        raise ctypes.WinError(ctypes.get_last_error())
    return counters.WorkingSetSize


class ResourceMeter:
    def __init__(self):
        self.lock = threading.Lock()
        self.previous = None
        self.cpu_percent = None

    def sample(self, torch, device):
        with self.lock:
            now, cpu = time.perf_counter(), time.process_time()
            if self.previous is None:
                self.previous = (now, cpu)
            elif now - self.previous[0] >= 1:
                self.cpu_percent = max(0, min(100, 100 * (cpu - self.previous[1]) /
                                       (now - self.previous[0]) / (os.cpu_count() or 1)))
                self.previous = (now, cpu)
            result = {'pid': os.getpid(), 'cpu_percent': self.cpu_percent,
                      'memory_bytes': None, 'gpu_allocated_bytes': None, 'gpu_reserved_bytes': None,
                      'device': device}
            try:
                result['memory_bytes'] = working_set_bytes()
            except (OSError, AttributeError):
                pass
            if device == 'cuda':
                try:
                    result['gpu_allocated_bytes'] = torch.cuda.memory_allocated()
                    result['gpu_reserved_bytes'] = torch.cuda.memory_reserved()
                except (RuntimeError, AssertionError):
                    pass
            return result
