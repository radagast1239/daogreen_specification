import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  PROJECT_SORT_OPTIONS,
  projectAttentionRank,
  projectsFilterEmptyTitle,
  projectsHaveActiveFilters,
  projectsSourceEmptyCopy,
  sortProjects,
} from "../src/lib/projectsListView.js";
import { buildBuilderContinuePath, PROJECT_STATUS_ACTIVE } from "../shared/projectLifecycle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectsPage = fs.readFileSync(
  path.join(__dirname, "../src/pages/admin/ProjectsPage.jsx"),
  "utf8"
);
const inProgressPage = fs.readFileSync(
  path.join(__dirname, "../src/pages/admin/ProjectsInProgressPage.jsx"),
  "utf8"
);
const modulesUi = fs.readFileSync(
  path.join(__dirname, "../src/components/modulesUi.jsx"),
  "utf8"
);

const sample = [
  {
    id: "a",
    name: "Бета",
    updatedAt: "2026-01-01T10:00:00.000Z",
    totals: { budget: 100 },
    itemCount: 2,
  },
  {
    id: "b",
    name: "Альфа",
    updatedAt: "2026-06-01T10:00:00.000Z",
    totals: { budget: 500 },
    itemCount: 0,
  },
  {
    id: "c",
    name: "Гамма",
    updatedAt: "2026-03-01T10:00:00.000Z",
    totals: { budget: 250 },
    itemCount: 5,
  },
];

describe("projectsListView", () => {
  it("exposes expected sort options including attention", () => {
    const ids = PROJECT_SORT_OPTIONS.map((o) => o.id);
    expect(ids).toEqual(["default", "updated", "sum", "name", "attention"]);
  });

  it("sorts by name, sum, updated without mutating", () => {
    const orig = sample.map((p) => p.id);
    const byName = sortProjects(sample, "name");
    expect(byName.map((p) => p.name)).toEqual(["Альфа", "Бета", "Гамма"]);
    const bySum = sortProjects(sample, "sum");
    expect(bySum.map((p) => p.id)).toEqual(["b", "c", "a"]);
    const byUpdated = sortProjects(sample, "updated");
    expect(byUpdated.map((p) => p.id)).toEqual(["b", "c", "a"]);
    expect(sample.map((p) => p.id)).toEqual(orig);
  });

  it("keeps pinned first and ranks attention by existing problem flags", () => {
    const problems = new Set(["c"]);
    expect(projectAttentionRank(sample[2], problems)).toBe(0);
    expect(projectAttentionRank(sample[1], problems)).toBe(1);
    const sorted = sortProjects(sample, "attention", {
      pinned: ["a"],
      problemIds: problems,
    });
    expect(sorted.map((p) => p.id)[0]).toBe("a");
    expect(sorted.map((p) => p.id).slice(1)).toEqual(["c", "b"]);
  });

  it("detects active filters and empty copy", () => {
    expect(projectsHaveActiveFilters({ q: "x" })).toBe(true);
    expect(projectsHaveActiveFilters({ projectStatusF: "all" })).toBe(false);
    expect(projectsFilterEmptyTitle("active")).toBe("Проекты не найдены");
    expect(projectsFilterEmptyTitle("in-progress")).toBe("Ничего не найдено");
    expect(projectsSourceEmptyCopy("in-progress").title).toBe("Нет проектов в процессе");
    expect(projectsSourceEmptyCopy("in-progress").cta).toBe("Создать проект");
  });
});

describe("ProjectsPage UI cleanup 1d", () => {
  it("uses shared in-progress wrapper and new titles", () => {
    expect(inProgressPage).toContain('variant="in-progress"');
    expect(projectsPage).toContain('"В процессе"');
    expect(projectsPage).toContain("Черновики и незавершённые проекты");
    expect(projectsPage).not.toContain("Проекты в настройке");
  });

  it("keeps primary actions and moves secondary into RowActionsMenu", () => {
    expect(projectsPage).toContain("RowActionsMenu");
    expect(modulesUi).toContain("children");
    expect(modulesUi).toContain("separator");
    expect(projectsPage).toContain('label: "Создать копию"');
    expect(projectsPage).toContain('label: "Быстрая копия"');
    expect(projectsPage).toContain('label: "На основе этого проекта"');
    expect(projectsPage).toContain('label: "Архивировать"');
    expect(projectsPage).toContain('label: "Удалить"');
    expect(projectsPage).toContain("Ссылка");
    expect(projectsPage).toContain("projectOpenLabel(p)");
    expect(projectsPage).toContain("actions.projectDuplicate");
    expect(projectsPage).toContain("actions.regenerateToken");
    expect(projectsPage).toContain("actions.archiveProject");
    expect(projectsPage).toContain("actions.projectDelete");
  });

  it("shows filter reset empty state and hides duplicate create CTA on empty in-progress", () => {
    expect(projectsPage).toContain("Сбросить фильтры");
    expect(projectsPage).toContain("projectsFilterEmptyTitle");
    expect(projectsPage).toContain("projectsSourceEmptyCopy");
    expect(projectsPage).toContain("showHeaderCreate");
    expect(projectsPage).toContain("Закупка завершена");
    expect(projectsPage).toContain("projects-card__progress--zero");
    expect(projectsSourceEmptyCopy("in-progress").title).toBe("Нет проектов в процессе");
  });

  it("keeps materials count only on active projects subtitle branch", () => {
    expect(projectsPage).toContain("база:");
    expect(projectsPage).toContain("Черновики и незавершённые проекты");
    expect(projectsPage).toMatch(
      /isInProgress\s*\?\s*"Черновики и незавершённые проекты"/
    );
  });

  it("preserves edit wizard URL contract", () => {
    const p = {
      id: "proj_abc",
      status: PROJECT_STATUS_ACTIVE,
      manualParams: { builderWizard: { lastStep: "general" } },
    };
    const url = buildBuilderContinuePath(p);
    expect(url).toBe("/new?projectId=proj_abc&mode=edit&step=general");
    expect(projectsPage).toContain("buildBuilderContinuePath");
  });
});
