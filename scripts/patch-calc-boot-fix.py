#!/usr/bin/env python3
"""
Исправление зависания «Загрузка калькулятора…»:
- последовательная загрузка скриптов (параллельная ломала порядок)
- снять оверлей при ошибке bundle
- убрать блокирующий оверлей (оставить только ранний профиль)
"""
import re
from pathlib import Path

HTML = Path("/var/www/daogreen-calc/calculator-110x55_12.html")
LOADER = Path("/var/www/daogreen-calc/js/calc-bundle-loader.js")

LOADER_SEQ = """  function loadSeq(list, index) {
    if (index >= list.length) {
      loaded = true;
      loading = false;
      global.dispatchEvent(new CustomEvent('daogreen-calc-bundle-ready'));
      return Promise.resolve();
    }
    return loadOne(list[index]).then(function () {
      return loadSeq(list, index + 1);
    });
  }

  function clearBooting() {
    try {
      document.documentElement.classList.remove('calc-booting');
    } catch (_) {}
  }"""

LOADER_BATCH = """  function loadSeq(list, index) {
    if (index >= list.length) {
      loaded = true;
      loading = false;
      global.dispatchEvent(new CustomEvent('daogreen-calc-bundle-ready'));
      return Promise.resolve();
    }
    var batch = list.slice(index, index + 6);
    return Promise.all(batch.map(loadOne)).then(function () {
      return loadSeq(list, index + batch.length);
    });
  }"""

BOOT_STYLE_OLD = """<style id="dg-calc-boot-style">
  html.calc-booting .page { visibility: hidden !important; pointer-events: none !important; }
  html.calc-booting body::after {
    content: "Загрузка калькулятора…";
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #062920;
    color: #9ecdb8;
    font: 16px/1.45 system-ui, "Segoe UI", sans-serif;
    z-index: 99999;
  }
</style>"""

BOOT_STYLE_NEW = """<style id="dg-calc-boot-style">
  html.calc-booting body::before {
    content: "Загрузка…";
    position: fixed;
    top: 12px;
    right: 16px;
    padding: 8px 14px;
    border-radius: 8px;
    background: rgba(6, 41, 32, 0.92);
    color: #9ecdb8;
    font: 13px/1.3 system-ui, "Segoe UI", sans-serif;
    z-index: 99999;
    pointer-events: none;
  }
</style>"""

BOOT_SCRIPT_OLD = """  document.documentElement.classList.add("calc-booting");
  window.addEventListener(
    "daogreen-calc-bundle-ready",
    function () {
      document.documentElement.classList.remove("calc-booting");
    },
    { once: true }
  );"""

BOOT_SCRIPT_NEW = """  document.documentElement.classList.add("calc-booting");
  function endBoot() {
    document.documentElement.classList.remove("calc-booting");
  }
  window.addEventListener("daogreen-calc-bundle-ready", endBoot, { once: true });
  window.addEventListener("daogreen-calc-bundle-error", endBoot, { once: true });
  window.setTimeout(endBoot, 120000);"""


def patch_loader():
    text = LOADER.read_text(encoding="utf-8")
    if "daogreen-calc-bundle-error" in text and "index + 6" not in text:
        print("loader already fixed")
        return
    if "index + 6" in text:
        text = text.replace(LOADER_BATCH, LOADER_SEQ, 1)
    if "function clearBooting" not in text:
        text = text.replace(
            "    loadSeq(list, 0).catch(function (err) {",
            "    loadSeq(list, 0).catch(function (err) {\n      clearBooting();\n      try { global.dispatchEvent(new CustomEvent('daogreen-calc-bundle-error', { detail: err })); } catch (_) {}",
        )
    if "function clearBooting" not in text:
        text = text.replace(
            "  function startLoad() {",
            "  function clearBooting() {\n    try { document.documentElement.classList.remove('calc-booting'); } catch (_) {}\n  }\n\n  function startLoad() {",
        )
    LOADER.write_text(text, encoding="utf-8")
    print("patched calc-bundle-loader sequential + error event")


def patch_html():
    text = HTML.read_text(encoding="utf-8")
    if BOOT_STYLE_OLD in text:
        text = text.replace(BOOT_STYLE_OLD, BOOT_STYLE_NEW, 1)
        print("replaced boot overlay style")
    elif BOOT_STYLE_NEW not in text:
        print("boot style not found")
    if BOOT_SCRIPT_OLD in text:
        text = text.replace(BOOT_SCRIPT_OLD, BOOT_SCRIPT_NEW, 1)
        print("updated boot script")
    HTML.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    patch_loader()
    patch_html()
    print("patch-calc-boot-fix done")
