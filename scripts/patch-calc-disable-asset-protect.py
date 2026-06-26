#!/usr/bin/env python3
"""VPS: отключить AUTH_PROTECT_ASSETS — иначе 403 на скрипты без cookie сессии."""
from pathlib import Path

p = Path("/var/www/daogreen-calc/.env")
text = p.read_text(encoding="utf-8")
if "AUTH_PROTECT_ASSETS=0" in text:
    print("AUTH_PROTECT_ASSETS already 0")
else:
    text = text.replace("AUTH_PROTECT_ASSETS=1", "AUTH_PROTECT_ASSETS=0")
    if "AUTH_PROTECT_ASSETS=0" not in text:
        text = text.rstrip() + "\nAUTH_PROTECT_ASSETS=0\n"
    p.write_text(text, encoding="utf-8")
    print("set AUTH_PROTECT_ASSETS=0")
