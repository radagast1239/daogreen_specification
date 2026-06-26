#!/usr/bin/env python3
"""Открытие вкладки «Экономика» (#economics или /finmodel/ в URL)."""
import re
from pathlib import Path

p = Path("/var/www/daogreen-calc/calculator-110x55_12.html")
text = p.read_text(encoding="utf-8")
marker = "/* dg-deeplink-economics */"

snippet = """<script>/* dg-deeplink-economics */
(function () {
  function dgOpenEconomics() {
    var h = (location.hash || "").replace(/^#/, "");
    var finmodel = /\\/finmodel(?:\\/|$)/i.test(location.pathname || "");
    if (h !== "economics" && !finmodel) return;
    if (finmodel) {
      window.DG_APP_PROFILE = "economics";
      if (typeof window.DG_applyAppProfileChrome === "function") {
        window.DG_applyAppProfileChrome();
      }
    }
    var go = document.getElementById("btn-go-economics");
    if (go) go.click();
    var tab = document.querySelector('.app-tab[data-app-view="economics"]');
    if (tab && !tab.hidden) tab.click();
    if (typeof window.DG_appProfileClampView === "function") {
      var v = window.DG_appProfileClampView("economics");
      if (window.setAppView) window.setAppView(v);
    }
  }
  window.addEventListener("hashchange", dgOpenEconomics);
  window.addEventListener(
    "daogreen-calc-bundle-ready",
    function () {
      setTimeout(dgOpenEconomics, 100);
      setTimeout(dgOpenEconomics, 1500);
    },
    { once: true }
  );
  setTimeout(dgOpenEconomics, 500);
})();
</script>
"""

if marker in text:
    text, n = re.subn(
        r"<script>/\* dg-deeplink-economics \*/.*?</script>\s*",
        snippet + "\n",
        text,
        count=1,
        flags=re.DOTALL,
    )
    if n:
        p.write_text(text, encoding="utf-8")
        print("updated deeplink economics")
        raise SystemExit(0)
    print("marker found but block not replaced")
    raise SystemExit(1)

if "</body>" not in text:
    raise SystemExit("no </body> in calculator HTML")
p.write_text(text.replace("</body>", snippet + "\n</body>", 1), encoding="utf-8")
print("patched deeplink economics")
