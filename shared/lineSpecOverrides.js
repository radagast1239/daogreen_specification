import { normalizePipeCuts, pipeCutsClientNote, draftPipeCuts } from "./profilePipeCuts.js";
import { normalizeBreakerSpecs, breakerSpecsClientNote, draftBreakerSpecs } from "./breakerSpecs.js";
import {
  normalizeFlowSpecs,
  flowSpecsClientNote,
  aggregateFlowM3,
  primaryFlowLink,
  draftFlowSpecs,
} from "./flowSpecs.js";
import { normalizeSplitSpecs, splitSpecsClientNote, draftSplitSpecs } from "./splitSpecs.js";

/** Поля состава строки — задаются в шаблоне/проекте, не дублируют базу материалов */
export function pickLineSpecOverrides(ln) {
  if (!ln || typeof ln !== "object") return {};
  const out = {};

  if (Array.isArray(ln.pipeCuts) && ln.pipeCuts.length) {
    out.pipeCuts = draftPipeCuts(ln.pipeCuts);
    const note = pipeCutsClientNote(normalizePipeCuts(ln.pipeCuts));
    if (note) out.clientNote = note;
  }

  if (Array.isArray(ln.breakerSpecs) && ln.breakerSpecs.length) {
    out.breakerSpecs = draftBreakerSpecs(ln.breakerSpecs);
    const note = breakerSpecsClientNote(normalizeBreakerSpecs(ln.breakerSpecs), ln.name);
    if (note) out.clientNote = note;
  }

  if (Array.isArray(ln.flowSpecs) && ln.flowSpecs.length) {
    out.flowSpecs = draftFlowSpecs(ln.flowSpecs);
    const normalized = normalizeFlowSpecs(ln.flowSpecs);
    if (normalized.length) {
      const note = flowSpecsClientNote(ln.flowSpecs, ln.name);
      if (note) out.clientNote = note;
      out.exhaustM3 = aggregateFlowM3(ln.flowSpecs);
      const link = primaryFlowLink(ln.flowSpecs, ln.link);
      if (link) out.link = link;
    }
  }

  if (Array.isArray(ln.splitSpecs) && ln.splitSpecs.length) {
    out.splitSpecs = draftSplitSpecs(ln.splitSpecs);
    const note = splitSpecsClientNote(normalizeSplitSpecs(ln.splitSpecs));
    if (note) out.clientNote = note;
  }

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
