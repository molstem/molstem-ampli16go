#!/usr/bin/env python3
"""Build and run the host unit test for the shared SCPI parser (needs a host gcc/cc).

Usage: python firmware/tools/test_scpi.py [--cc gcc]
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

FIRMWARE = Path(__file__).resolve().parent.parent


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cc", default=os.environ.get("CC") or shutil.which("gcc") or shutil.which("cc") or "gcc")
    args = ap.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        exe = Path(tmp) / ("test_scpi.exe" if os.name == "nt" else "test_scpi")
        cmd = [args.cc, "-std=c99", "-Wall", "-Wextra", "-Werror",
               "-I", str(FIRMWARE / "common" / "scpi"),
               str(FIRMWARE / "tools" / "test_scpi_line.c"),
               str(FIRMWARE / "common" / "scpi" / "scpi_line.c"),
               "-o", str(exe)]
        print("+", " ".join(cmd), flush=True)
        rc = subprocess.call(cmd)
        if rc:
            return rc
        return subprocess.call([str(exe)])


if __name__ == "__main__":
    sys.exit(main())
