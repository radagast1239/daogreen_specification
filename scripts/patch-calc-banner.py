#!/usr/bin/env python3
from pathlib import Path

p = Path("/var/www/daogreen-calc/calculator-110x55_12.html")
text = p.read_text(encoding="utf-8")
needle = "#app-auth-preview-banner { display: none !important; visibility: hidden !important; }\n"
if needle in text:
    text = text.replace(needle, "", 1)
    p.write_text(text, encoding="utf-8")
    print("removed hidden preview-banner CSS")
else:
    print("needle not found (maybe already removed)")
