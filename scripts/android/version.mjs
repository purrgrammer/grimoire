#!/usr/bin/env node
/**
 * The Android versionCode/versionName for the commit that is checked out.
 *
 *   versionCode = number of commits reachable from HEAD
 *   versionName = "<package.json version>+<versionCode>"
 *
 * Monotonic as long as releases come from a branch whose history only grows
 * (main: merges, never force-pushes). Reproducible from source alone, so a
 * rebuild of the same commit yields the same numbers and Zapstore refuses it
 * as a duplicate instead of shipping it twice.
 *
 * Usage: node scripts/android/version.mjs [--json | --gradle]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

if (git("rev-parse", "--is-shallow-repository") === "true") {
  console.error(
    "version.mjs: shallow clone — the commit count would be wrong. " +
      "Fetch full history (actions/checkout fetch-depth: 0).",
  );
  process.exit(1);
}

const versionCode = Number(git("rev-list", "--count", "HEAD"));
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url)));
const versionName = `${pkg.version}+${versionCode}`;
const sha = git("rev-parse", "HEAD");

if (process.argv.includes("--gradle")) {
  console.log(`-PgrimoireVersionCode=${versionCode} -PgrimoireVersionName=${versionName}`);
} else {
  console.log(JSON.stringify({ versionCode, versionName, sha }));
}
