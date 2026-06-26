#!/usr/bin/env python3
"""
Ускорение UX калькулятора на VPS:
- экран «Загрузка…» до daogreen-calc-bundle-ready (без «старого» UI)
- ранний профиль /salad/ | /finmodel/ до отрисовки
- убрать dg-deeplink (профиль уже в URL)
- SW: network-first для HTML и ?v= скриптов, новый ключ кэша
"""
import re
from pathlib import Path

HTML = Path("/var/www/daogreen-calc/calculator-110x55_12.html")
SW = Path("/var/www/daogreen-calc/sw.js")

BOOT_MARKER = "/* dg-calc-boot */"
BOOT_SNIPPET = """<script>/* dg-calc-boot */
(function () {
  var p = location.pathname || "";
  if (/\\/finmodel(?:\\/|$)/i.test(p)) {
    window.DG_APP_PROFILE = "economics";
    document.documentElement.classList.add("app-profile--economics");
  } else if (/\\/salad(?:\\/|$)/i.test(p)) {
    window.DG_APP_PROFILE = "planting";
    document.documentElement.classList.add("app-profile--planting");
  }
  document.documentElement.classList.add("calc-booting");
  window.addEventListener(
    "daogreen-calc-bundle-ready",
    function () {
      document.documentElement.classList.remove("calc-booting");
    },
    { once: true }
  );
})();
</script>
<style id="dg-calc-boot-style">
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
</style>
"""

LOADER_OLD = """  function loadSeq(list, index) {
    if (index >= list.length) {
      loaded = true;
      loading = false;
      global.dispatchEvent(new CustomEvent('daogreen-calc-bundle-ready'));
      return Promise.resolve();
    }
    return loadOne(list[index]).then(function () {
      return loadSeq(list, index + 1);
    });
  }"""

LOADER_NEW = """  function loadSeq(list, index) {
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

LOADER = Path("/var/www/daogreen-calc/js/calc-bundle-loader.js")


def patch_html():
    text = HTML.read_text(encoding="utf-8")
    text = re.sub(
        r"<script>/\* dg-deeplink-economics \*/.*?</script>\s*",
        "",
        text,
        count=1,
        flags=re.DOTALL,
    )
    if BOOT_MARKER not in text:
        if "<head>" not in text:
            raise SystemExit("no <head> in calculator HTML")
        text = text.replace("<head>", "<head>\n" + BOOT_SNIPPET + "\n", 1)
        print("inserted dg-calc-boot in HTML")
    else:
        text, n = re.subn(
            r"<script>/\* dg-calc-boot \*/.*?</style>\s*",
            BOOT_SNIPPET + "\n",
            text,
            count=1,
            flags=re.DOTALL,
        )
        print("updated dg-calc-boot" if n else "dg-calc-boot unchanged")
    HTML.write_text(text, encoding="utf-8")


def patch_loader():
    text = LOADER.read_text(encoding="utf-8")
    if "index + 6" in text:
        print("calc-bundle-loader already batched")
        return
    if LOADER_OLD not in text:
        raise SystemExit("calc-bundle-loader pattern not found")
    LOADER.write_text(text.replace(LOADER_OLD, LOADER_NEW, 1), encoding="utf-8")
    print("patched calc-bundle-loader batch size 6")


def patch_sw():
    text = SW.read_text(encoding="utf-8")
    text = re.sub(
        r"var CACHE = 'daogreen-[^']+'",
        "var CACHE = 'daogreen-vps-2026-06-26'",
        text,
        count=1,
    )
    old_tail = "  event.respondWith(cacheFirst(event.request));\n});"
    new_tail = """  if (preferNetworkFirst(url)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(cacheFirst(event.request));
});"""
    if old_tail in text and "preferNetworkFirst(url)" not in text.split("event.respondWith(cacheFirst")[-1][:200]:
        text = text.replace(old_tail, new_tail, 1)
        print("patched SW fetch handler")
    elif "preferNetworkFirst(url)" in text:
        print("SW fetch handler already patched")
    SW.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    patch_html()
    patch_loader()
    patch_sw()
    print("patch-calc-boot done")
