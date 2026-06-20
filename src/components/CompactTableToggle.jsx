import React, { useState } from "react";
import { getCompactMode, setCompactMode } from "../lib/compactMode.js";

export default function CompactTableToggle() {
  const [compact, setCompact] = useState(getCompactMode());

  const toggle = () => {
    const next = !compact;
    setCompactMode(next);
    setCompact(next);
  };

  return (
    <button type="button" className={`btn btn-sm ${compact ? "btn-primary" : ""}`} onClick={toggle} title="Плотнее строки в таблицах">
      {compact ? "Компактно ✓" : "Компактные таблицы"}
    </button>
  );
}
