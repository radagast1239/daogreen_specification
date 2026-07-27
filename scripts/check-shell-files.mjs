#!/usr/bin/env node
/**
 * Reject CRLF (\r\n) in tracked shell scripts.
 * Usage: node scripts/check-shell-files.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function listTrackedShellFiles() {
  const out = execFileSync("git", ["ls-files", "*.sh"], { encoding: "utf8" });
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function hasCrlf(buf) {
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) return true;
  }
  return false;
}

const files = listTrackedShellFiles();
if (files.length === 0) {
  console.log("No tracked *.sh files found.");
  process.exit(0);
}

const bad = [];
for (const file of files) {
  const buf = readFileSync(file);
  if (hasCrlf(buf)) bad.push(file);
}

if (bad.length > 0) {
  console.error("CRLF line endings found in tracked shell files:");
  for (const file of bad) console.error(`  ${file}`);
  console.error("Convert to LF (Unix) line endings. See .gitattributes: *.sh text eol=lf");
  process.exit(1);
}

console.log(`OK: ${files.length} tracked shell file(s) use LF line endings.`);
