#!/usr/bin/env python3
"""Открытие вкладки «Экономика» по hash #economics в калькуляторе салатов."""
from pathlib import Path

p = Path("/var/www/daogreen-calc/calculator-110x55_12.html")
text = p.read_text(encoding="utf-8")
marker = "/* dg-deeplink-economics */"
if marker in text:
    print("already patched deeplink economics")
    raise SystemExit(0)

snippet = """<script>/* dg-deeplink-economics */
(function () {
  function dgOpenEconomicsTab() {
    if ((location.hash || "").replace(/^#/, "") !== "economics") return;
    var btn = document.querySelector('.app-tab[data-app-view="economics"]');
    if (btn) btn.click();
  }
  window.addEventListener("hashchange", dgOpenEconomicsTab);
  window.addEventListener(
    "daogreen-calc-bundle-ready",
    function () {
      setTimeout(dgOpenEconomicsTab, 100);
    },
    { once: true }
  );
  setTimeout(dgOpenEconomicsTab, 800);
  setTimeout(dgOpenEconomicsTab, 2000);
})();
</script>
"""

if "</body>" not in text:
    raise SystemExit("no </body> in calculator HTML")
p.write_text(text.replace("</body>", snippet + "\n</body>", 1), encoding="utf-8")
print("patched deeplink economics")
