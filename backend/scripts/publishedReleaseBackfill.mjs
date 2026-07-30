#!/usr/bin/env node
/**
 * Published release backfill — local/staging only.
 *
 * Usage:
 *   DATABASE_PATH=./server-debug/backend/data/daogreen.db node backend/scripts/publishedReleaseBackfill.mjs --dry-run
 *   DATABASE_PATH=... node backend/scripts/publishedReleaseBackfill.mjs --apply --all-client-projects
 *   DATABASE_PATH=... node backend/scripts/publishedReleaseBackfill.mjs --verify
 *   DATABASE_PATH=... node backend/scripts/publishedReleaseBackfill.mjs --apply --project=p_abc
 */
import path from "path";
import { fileURLToPath } from "url";
import {
  runPublishedReleaseBackfill,
  verifyAllClientProjects,
} from "../src/services/publishedReleaseBackfillService.js";
import { getDbPath } from "../src/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run") || (!args.includes("--apply") && !args.includes("--verify"));
const apply = args.includes("--apply");
const verifyOnly = args.includes("--verify");
const allClient = args.includes("--all-client-projects");
const projectArg = args.find((a) => a.startsWith("--project="));
const projectIds = projectArg ? [projectArg.split("=")[1]] : [];

if (verifyOnly) {
  const result = verifyAllClientProjects();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

const result = runPublishedReleaseBackfill({
  projectIds,
  allClientProjects: allClient || (!projectIds.length && (apply || dryRun)),
  dryRun: !apply,
});

console.log(JSON.stringify({ dbPath: getDbPath(), ...result }, null, 2));
process.exit(result.ok ? 0 : 1);
