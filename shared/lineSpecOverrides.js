import { normalizePipeCuts, pipeCutsClientNote } from "./profilePipeCuts.js";
import { normalizeBreakerSpecs } from "./breakerSpecs.js";
import { normalizeFlowSpecs } from "./flowSpecs.js";
import { normalizeSplitSpecs } from "./splitSpecs.js";

/** Поля состава строки — задаются в шаблоне/проекте, не дублируют базу материалов */
export function pickLineSpecOverrides(ln) {
  if (!ln || typeof ln !== "object") return {};
  const out = {};

  const pipeCuts = normalizePipeCuts(ln.pipeCuts);
  if (pipeCuts.length) {
    out.pipeCuts = pipeCuts;
    const note = pipeCutsClientNote(pipeCuts);
    if (note) out.clientNote = note;
  }

  const breakerSpecs = normalizeBreakerSpecs(ln.breakerSpecs);
  if (breakerSpecs.length) out.breakerSpecs = breakerSpecs;

  const flowSpecs = normalizeFlowSpecs(ln.flowSpecs);
  if (flowSpecs.length) out.flowSpecs = flowSpecs;

  const splitSpecs = normalizeSplitSpecs(ln.splitSpecs);
  if (splitSpecs.length) out.splitSpecs = splitSpecs;

  return out;
}

export function mergeLineSpecOverrides(base, ln) {
  const overrides = pickLineSpecOverrides(ln);
  if (!Object.keys(overrides).length) return base;
  return { ...base, ...overrides };
}

export function attachLineSpecOverrides(out, ln) {
  return { ...out, ...pickLineSpecOverrides(ln) };
}

export function hasLineSpecOverrides(ln) {
  return Object.keys(pickLineSpecOverrides(ln)).length > 0;
}
