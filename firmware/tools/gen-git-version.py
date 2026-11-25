#!/usr/bin/env python3
import subprocess
from pathlib import Path

# Adjust paths as needed
header_path_app = Path("App/Core/git-version.h")
header_path_bootloader = Path("Bootloader/Core/git-version.h")

try:
    version = subprocess.check_output(
        ["git", "describe", "--always", "--tags", "--dirty"],
        stderr=subprocess.DEVNULL
    ).decode("utf-8").strip()
except Exception:
    version = "unknown"

try:
    # Get version without commit hash (just tag-count or tag-count-dirty)
    full_version = subprocess.check_output(
        ["git", "describe", "--always", "--tags", "--dirty"],
        stderr=subprocess.DEVNULL
    ).decode("utf-8").strip()

    # Remove the -gXXXXXXX part (commit hash)
    # Format: v1.0.0-pre-42-gb62346f-dirty -> v1.0.0-pre-42-dirty
    import re
    version_short = re.sub(r'-g(....)[0-9a-f]+', "-\\1", full_version)
    version_short = re.sub(r'-dirty', '', version_short)
except Exception:
    version_short = "unknown"

content = f"""#pragma once
#define GIT_VERSION "{version}"
#define GIT_VERSION_SHORT "{version_short}"
"""

# Only update file if content changes (avoids rebuild loops)
if not header_path_app.exists() or header_path_app.read_text() != content:
    header_path_app.parent.mkdir(parents=True, exist_ok=True)
    header_path_app.write_text(content)

if not header_path_bootloader.exists() or header_path_bootloader.read_text() != content:
    header_path_bootloader.parent.mkdir(parents=True, exist_ok=True)
    header_path_bootloader.write_text(content)
