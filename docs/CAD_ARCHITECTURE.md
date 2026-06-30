# CAD Architecture

## Wall data model

### Canonical wall model

The source of truth for walls is:

```
plan.nodes       — map of nodeId → { x, y }
plan.walls[].a   — nodeId of wall start
plan.walls[].b   — nodeId of wall end
```

### wall.pts status

`wall.pts` is **legacy / derived only**.

It exists on older plans (before the node-graph model) and is recomputed by
`resolvePlanWalls(plan)` from `a/b + nodes` in new plans.

**Do not treat `wall.pts` as authoritative.** It may be absent, stale, or
missing on network walls.

### Rules for new code

| Rule | Detail |
|---|---|
| Read walls through `resolvePlanWalls(plan)` | Returns walls with `pts` populated from nodes, or falls back to legacy `pts` when no nodes are present. |
| Do not mutate `wall.pts` directly | `pts` on a network wall is derived; writing to it has no effect on the stored model. |
| All wall mutations go through `wallNetwork` / `wallOps` commands | `commitWallEdge`, `deleteWallEdge`, `movePlanNode`, `breakWallEdgeAt`, etc. |

### Migration path

Legacy plans (pts-only, no nodes) are migrated with:

```js
import { ensureWallNetwork } from "../planner/wallNetwork.js";
const plan = ensureWallNetwork(rawPlan, makeId);
```

After migration `plan.nodes` is populated and `wall.pts` should be considered
derived.

### resolvePlanWalls behaviour

```
resolvePlanWalls(plan)
  if plan has nodes → derive pts from nodes[wall.a] and nodes[wall.b]
  if plan has no nodes → return legacy walls that already have pts
```

This means `resolvePlanWalls` is safe to call on both old and new plans.
