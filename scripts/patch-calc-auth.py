#!/usr/bin/env python3
from pathlib import Path

p = Path("/var/www/daogreen-calc/js/app-auth.js")
text = p.read_text(encoding="utf-8")
old = "    return clientReady() || !hostUsesServerAuth();"
new = "    if (hostUsesServerAuth()) return false;\n    return clientReady();"
if old not in text:
    raise SystemExit("pattern not found in app-auth.js")
p.write_text(text.replace(old, new, 1), encoding="utf-8")
print("patched app-auth.js")
