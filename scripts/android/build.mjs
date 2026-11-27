#!/usr/bin/env node
/**
 * Build the Android APK from a clean web build.
 *
 *   node scripts/android/build.mjs debug              # debug-signed, for devices/emulators
 *   node scripts/android/build.mjs release            # unsigned unless ANDROID_KEYSTORE_* are set
 *   node scripts/android/build.mjs release --require-signing   # fail without a release key
 *
 * Needs JDK 21 (JAVA_HOME) and the Android SDK (ANDROID_HOME) with
 * platforms;android-36 and build-tools;36.0.0. Writes the APK and its
 * SHA-256 to android-dist/ (gitignored).
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const variant = process.argv[2];
if (variant !== "debug" && variant !== "release") {
  console.error("usage: build.mjs debug|release [--require-signing] [--skip-web]");
  process.exit(2);
}
const requireSigning = process.argv.includes("--require-signing");
const root = new URL("../..", import.meta.url).pathname;
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: "inherit", cwd: root, ...opts });

if (!process.env.JAVA_HOME) console.warn("JAVA_HOME is not set; Gradle needs JDK 21.");
if (!process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT) {
  console.error("ANDROID_HOME is not set.");
  process.exit(1);
}

const version = JSON.parse(
  execFileSync("node", ["scripts/android/version.mjs", "--json"], { cwd: root, encoding: "utf8" }),
);

if (!process.argv.includes("--skip-web")) run("npm", ["run", "build"]);
run("npx", ["cap", "sync", "android"]);

const task = variant === "debug" ? "assembleDebug" : "assembleRelease";
run(
  "./gradlew",
  [
    "--no-daemon",
    task,
    `-PgrimoireVersionCode=${version.versionCode}`,
    `-PgrimoireVersionName=${version.versionName}`,
    ...(requireSigning ? ["-PrequireReleaseSigning=true"] : []),
  ],
  { cwd: join(root, "android") },
);

const outDir = join(root, "android/app/build/outputs/apk", variant);
const signed = join(outDir, `app-${variant}.apk`);
const unsigned = join(outDir, `app-${variant}-unsigned.apk`);
const built = existsSync(signed) ? signed : unsigned;
if (!existsSync(built)) {
  console.error(`No APK found in ${outDir}`);
  process.exit(1);
}

const suffix = built === unsigned ? "-unsigned" : "";
const name = `grimoire-${version.versionName.replace("+", "-")}-${variant}${suffix}.apk`;
mkdirSync(join(root, "android-dist"), { recursive: true });
const dest = join(root, "android-dist", name);
copyFileSync(built, dest);

const hash = createHash("sha256");
for await (const chunk of createReadStream(dest)) hash.update(chunk);
const sha256 = hash.digest("hex");
writeFileSync(`${dest}.sha256`, `${sha256}  ${name}\n`);
writeFileSync(
  join(root, "android-dist", "build.json"),
  JSON.stringify({ ...version, variant, apk: name, sha256, signed: !suffix }, null, 2),
);
console.log(`\n${dest}\nsha256 ${sha256}\nversionCode ${version.versionCode}  versionName ${version.versionName}`);
