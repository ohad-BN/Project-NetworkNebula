#!/usr/bin/env python3
"""
Convenience entry point forwarding to worker/nebula_worker.py.
For worker documentation and standalone usage, see worker/README.md.
"""
import sys
if sys.platform == "win32":
    try:
        import ctypes
        ctypes.windll.kernel32.SetErrorMode(0x0001 | 0x0002)
    except Exception:
        pass
import runpy
from pathlib import Path

if __name__ == "__main__":
    target = Path(__file__).resolve().parent / "worker" / "nebula_worker.py"
    runpy.run_path(str(target), run_name="__main__")
