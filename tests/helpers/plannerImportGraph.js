/**
 * PHASE 0A — детерминированный статический анализ относительных import
 * внутри планировщика (src/planner). Без сторонних зависимостей и без AST:
 * простой разбор `import ... from "..."` и `export ... from "..."`.
 *
 * Цель: зафиксировать текущий граф зависимостей и, в частности, нарушения
 * границы CAD Core (core -> legacy/UI). Используется и тестом границы,
 * и read-only отчётом scripts/plannerDepGraph.mjs.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g;
const SIDE_EFFECT_IMPORT_RE = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;

export function listSourceFiles(rootDir) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/\.(js|jsx)$/.test(entry)) out.push(full);
    }
  };
  walk(rootDir);
  return out.sort();
}

function extractSpecifiers(code) {
  const specs = [];
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(code))) specs.push(m[1]);
  SIDE_EFFECT_IMPORT_RE.lastIndex = 0;
  while ((m = SIDE_EFFECT_IMPORT_RE.exec(code))) specs.push(m[1]);
  return specs;
}

function resolveRelative(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.js`,
    `${base}.jsx`,
    join(base, "index.js"),
    join(base, "index.jsx"),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null; // не резолвится в файл (например, .css) — игнорируем
}

/**
 * Построить граф зависимостей планировщика.
 * @param {string} plannerRoot абсолютный путь к src/planner
 * @param {string} coreRoot    абсолютный путь к src/planner/core
 */
export function buildPlannerGraph(plannerRoot, coreRoot) {
  const files = listSourceFiles(plannerRoot);
  const edges = []; // { from, to, spec, external }
  const bareEdges = []; // { from, spec } — npm/builtin/react

  for (const file of files) {
    const code = readFileSync(file, "utf8");
    for (const spec of extractSpecifiers(code)) {
      if (spec.startsWith(".")) {
        const target = resolveRelative(file, spec);
        if (target && /\.(js|jsx)$/.test(target)) {
          edges.push({ from: file, to: target, spec });
        }
      } else {
        bareEdges.push({ from: file, spec });
      }
    }
  }

  const inCore = (p) => p.startsWith(coreRoot);
  const rel = (p) => relative(plannerRoot, p).replace(/\\/g, "/");

  // Нарушение границы: файл ИЗ core импортирует модуль ВНЕ core.
  const coreOutViolations = edges
    .filter((e) => inCore(e.from) && !inCore(e.to))
    .map((e) => ({ from: rel(e.from), to: rel(e.to), spec: e.spec }))
    .sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to));

  // Нарушение границы: core импортирует react/react-dom.
  const coreReactViolations = bareEdges
    .filter((e) => inCore(e.from) && /^react(-dom)?$/.test(e.spec))
    .map((e) => ({ from: rel(e.from), spec: e.spec }));

  return {
    plannerRoot,
    coreRoot,
    fileCount: files.length,
    edgeCount: edges.length,
    edges: edges.map((e) => ({ from: rel(e.from), to: rel(e.to), spec: e.spec })),
    coreOutViolations,
    coreReactViolations,
    rel,
  };
}

/** Каноничный ключ нарушения границы для allowlist-сравнения. */
export function violationKey(v) {
  return `${v.from} -> ${v.to}`;
}

/**
 * Компоненты сильной связности (Tarjan) по графу файлов.
 * Возвращает только нетривиальные циклы (size > 1).
 */
export function findCycles(edges, relFn) {
  const adj = new Map();
  const nodes = new Set();
  for (const e of edges) {
    nodes.add(e.from);
    nodes.add(e.to);
    if (!adj.has(e.from)) adj.set(e.from, new Set());
    adj.get(e.from).add(e.to);
  }
  let index = 0;
  const stack = [];
  const onStack = new Set();
  const idx = new Map();
  const low = new Map();
  const sccs = [];

  const strongconnect = (v) => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v) || []) {
      if (!idx.has(w)) {
        strongconnect(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v), idx.get(w)));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) sccs.push(comp.sort());
    }
  };

  // Итеративный запуск (рекурсия ограничена размером графа планировщика ~сотни файлов).
  for (const v of [...nodes].sort()) {
    if (!idx.has(v)) strongconnect(v);
  }
  const toRel = relFn || ((x) => x);
  return sccs
    .map((c) => c.map(toRel))
    .sort((a, b) => b.length - a.length);
}
