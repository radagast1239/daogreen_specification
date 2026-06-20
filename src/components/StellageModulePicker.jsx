import React, { useMemo } from "react";
import {
  STELLAGE_GROUPS,
  defaultStellageGroups,
  groupsForModule,
  materialsByGroup,
  groupLabel,
  materialCompositionGroup,
  normalizeModuleSelection,
} from "../../shared/stellageComposition.js";

export default function StellageModulePicker({ mod, materials, value, onChange }) {
  const sel = normalizeModuleSelection(value);
  const moduleGroups = useMemo(() => groupsForModule(materials, mod.name), [materials, mod.name]);
  const byGroup = useMemo(() => materialsByGroup(materials, mod.name), [materials, mod.name]);

  const set = (patch) => onChange({ ...sel, ...patch });

  const toggleGroup = (gid) => {
    const groups = sel.groups.includes(gid)
      ? sel.groups.filter((g) => g !== gid)
      : [...sel.groups, gid];
    const inGroup = (byGroup.get(gid) || []).map((m) => m.id);
    const excludedMaterialIds = sel.excludedMaterialIds.filter((id) => !inGroup.includes(id));
    set({ groups, excludedMaterialIds });
  };

  const toggleMaterial = (mat) => {
    const gid = materialCompositionGroup(mat);
    const included =
      sel.groups.includes(gid) && !sel.excludedMaterialIds.includes(mat.id);
    if (included) {
      set({ excludedMaterialIds: [...sel.excludedMaterialIds, mat.id] });
    } else {
      const groups = sel.groups.includes(gid) ? sel.groups : [...sel.groups, gid];
      set({
        groups,
        excludedMaterialIds: sel.excludedMaterialIds.filter((id) => id !== mat.id),
      });
    }
  };

  const selectedCount = useMemo(() => {
    let n = 0;
    for (const [, mats] of byGroup) {
      for (const m of mats) {
        if (sel.groups.includes(materialCompositionGroup(m)) && !sel.excludedMaterialIds.includes(m.id)) {
          n++;
        }
      }
    }
    return n;
  }, [byGroup, sel]);

  return (
    <div style={{ marginTop: 12 }} onClick={(e) => e.stopPropagation()}>
      <div className="row" style={{ marginBottom: 10, gap: 12 }}>
        <span className="muted" style={{ fontSize: 12 }}>Кол-во стеллажей</span>
        <input
          type="number"
          min={1}
          value={sel.count}
          onChange={(e) => set({ count: Math.max(1, Number(e.target.value) || 1) })}
          style={{ width: 72 }}
        />
        <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>
          в спецификацию: <b className="num">{selectedCount}</b> деталей
        </span>
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Состав стеллажа</div>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {moduleGroups.map((g) => {
          const cnt = (byGroup.get(g.id) || []).length;
          const on = sel.groups.includes(g.id);
          return (
            <label
              key={g.id}
              className="panel"
              style={{
                padding: "8px 10px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
                borderColor: on ? "var(--brand)" : "var(--line)",
                background: on ? "var(--brand-tint)" : "var(--paper)",
              }}
            >
              <input type="checkbox" checked={on} onChange={() => toggleGroup(g.id)} />
              <span style={{ fontSize: 12 }}>{g.label}</span>
              <span className="muted num" style={{ marginLeft: "auto", fontSize: 11 }}>
                {cnt}
              </span>
            </label>
          );
        })}
      </div>

      <details style={{ marginTop: 10 }}>
        <summary style={{ fontSize: 12, cursor: "pointer", color: "var(--brand)" }}>
          Детальный выбор позиций
        </summary>
        <div style={{ marginTop: 8, maxHeight: 280, overflowY: "auto" }}>
          {STELLAGE_GROUPS.filter((g) => moduleGroups.some((mg) => mg.id === g.id)).map((g) => {
            const mats = byGroup.get(g.id) || [];
            if (!mats.length) return null;
            return (
              <div key={g.id} style={{ marginBottom: 10 }}>
                <div className="muted" style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
                  {g.label}
                </div>
                {mats.map((m) => {
                  const on =
                    sel.groups.includes(g.id) && !sel.excludedMaterialIds.includes(m.id);
                  return (
                    <label
                      key={m.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 12,
                        padding: "3px 0",
                        opacity: on ? 1 : 0.55,
                      }}
                    >
                      <input type="checkbox" checked={on} onChange={() => toggleMaterial(m)} />
                      <span style={{ flex: 1 }}>{m.name}</span>
                      <span className="muted num">{m.defaultQty || 0}</span>
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}

export { defaultStellageGroups, normalizeModuleSelection, groupLabel };
