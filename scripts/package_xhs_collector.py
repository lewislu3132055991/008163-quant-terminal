#!/usr/bin/env python3
"""Build the local-only Xiaohongshu research collector package."""

from __future__ import annotations

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tools" / "xhs-research-collector"
TARGETS = [
    ROOT / "outputs" / "xhs-research-collector.zip",
    ROOT / "public" / "tools" / "xhs-research-collector.zip",
]


def main() -> None:
    files = sorted(path for path in SOURCE.iterdir() if path.is_file())
    for target in TARGETS:
        target.parent.mkdir(parents=True, exist_ok=True)
        with ZipFile(target, "w", ZIP_DEFLATED) as archive:
            for path in files:
                archive.write(path, f"xhs-research-collector/{path.name}")
        print(f"wrote {target} ({target.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
