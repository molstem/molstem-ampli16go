#!/usr/bin/env python3
"""Copy the canonical SCPI parser (firmware/common/scpi) into the projects that compile it.

Run after editing firmware/common/scpi/scpi_line.*:  python firmware/tools/sync_scpi.py
CI uses `--check` to fail when a copy has drifted from the canonical file.
"""
import filecmp
import shutil
import sys
from pathlib import Path

FIRMWARE = Path(__file__).resolve().parent.parent
SRC = FIRMWARE / "common" / "scpi"
DESTS = ["App/molstem/helpers", "Bootloader/molstem/helpers", "Wifi/main"]
FILES = ("scpi_line.h", "scpi_line.c")


def main() -> int:
    check = "--check" in sys.argv[1:]
    stale = []
    for dest in DESTS:
        for name in FILES:
            src, dst = SRC / name, FIRMWARE / dest / name
            if check:
                if not dst.exists() or not filecmp.cmp(src, dst, shallow=False):
                    stale.append(dst)
            else:
                shutil.copyfile(src, dst)
        if not check:
            print(f"synced -> {dest}")
    if stale:
        for p in stale:
            print(f"out of date: {p.relative_to(FIRMWARE.parent)}")
        print("run: python firmware/tools/sync_scpi.py")
        return 1
    if check:
        print("scpi_line copies are in sync")
    return 0


if __name__ == "__main__":
    sys.exit(main())
