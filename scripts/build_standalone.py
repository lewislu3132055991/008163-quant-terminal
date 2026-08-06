#!/usr/bin/env python3
"""Inline the production assets and latest public data into a file://-safe HTML."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
OUTPUT = ROOT / "outputs" / "008163-quant-terminal.html"


def main() -> None:
    html = (DIST / "index.html").read_text(encoding="utf-8")
    script_match = re.search(r'<script type="module"[^>]+src="\.\/([^\"]+)"[^>]*></script>', html)
    style_match = re.search(r'<link rel="stylesheet"[^>]+href="\.\/([^\"]+)"[^>]*>', html)
    if not script_match or not style_match:
        raise RuntimeError("无法识别Vite构建资产")
    javascript = (DIST / script_match.group(1)).read_text(encoding="utf-8")
    css = (DIST / style_match.group(1)).read_text(encoding="utf-8")
    bundle = json.loads((ROOT / "public" / "data" / "research-bundle.json").read_text(encoding="utf-8"))
    inline_data = json.dumps(bundle, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    html = html.replace(style_match.group(0), f"<style>{css}</style>")
    cache_reset = """<script>
if ("serviceWorker" in navigator) navigator.serviceWorker.getRegistrations().then((items) => items.forEach((item) => item.unregister()));
if ("caches" in window) caches.keys().then((keys) => keys.filter((key) => key.startsWith("fund-008163-shell-")).forEach((key) => caches.delete(key)));
</script>"""
    html = html.replace(script_match.group(0), f"<script>window.__RESEARCH_BUNDLE__={inline_data};</script>{cache_reset}<script type=\"module\">{javascript}</script>")
    html = re.sub(r'<link rel="manifest"[^>]*>', "", html)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(html, encoding="utf-8")
    print(f"wrote {OUTPUT} ({OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
