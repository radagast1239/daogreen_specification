#!/usr/bin/env python3
"""Разрешить app-profile.js без сессии (нужен для /salad/ и /finmodel/)."""
from pathlib import Path

p = Path("/var/www/daogreen-calc/_tools/protect-assets.js")
text = p.read_text(encoding="utf-8")
needle = "  '/js/calc-script-manifest.js'"
insert = "  '/js/app-profile.js',\n  '/js/calc-script-manifest.js'"
if "/js/app-profile.js" in text:
    print("app-profile.js already public")
    raise SystemExit(0)
if needle not in text:
    raise SystemExit("PUBLIC_SHELL pattern not found")
p.write_text(text.replace(needle, insert, 1), encoding="utf-8")
print("patched protect-assets.js")
