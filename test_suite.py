#!/usr/bin/env python3
"""
Convenience entry point forwarding to tests/test_suite.py.
For modular test runs, see tests/README.md.
"""
import runpy
from pathlib import Path

if __name__ == "__main__":
    target = Path(__file__).resolve().parent / "tests" / "test_suite.py"
    runpy.run_path(str(target), run_name="__main__")
