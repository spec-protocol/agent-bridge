#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const errors = [];

if (fs.existsSync(path.join(root, ".npmignore"))) {
  errors.push("A .npmignore exists. Remove it: npm then ignores .gitignore when packing.");
}

const pkgPath = path.join(root, "package.json");
let files = null;
try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  files = pkg.files;
} catch (e) {
  errors.push(`package.json is unreadable: ${e.message}`);
}

if (!Array.isArray(files) || files.length === 0) {
  errors.push('package.json needs a non-empty "files" allowlist.');
} else {
  for (const entry of files) {
    const why = forbiddenFilesEntry(String(entry));
    if (why) errors.push(`package.json files: "${entry}" — ${why}`);
  }
}

if (insideGitRepo(root)) {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  const bad = tracked.filter((file) => forbiddenTracked(file));
  if (bad.length > 0) {
    errors.push(
      "git ls-files contains paths that cannot go into the public repository:\n" +
        bad.map((file) => `  ${file}`).join("\n")
    );
  }
}

if (errors.length > 0) {
  console.error("check-public: failed\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("check-public: ok");

function forbiddenFilesEntry(entry) {
  const norm = entry.replace(/\\/g, "/").replace(/^\.\//, "");
  if (norm === "" || norm === "." || norm === "*" || norm === "**") {
    return "entry is too broad for an allowlist";
  }
  if (isCursorOrAgents(norm) || norm.split("/").some((seg) => seg === ".cursor" || seg === ".agents")) {
    return "local agent directory";
  }
  if (isIdea(norm)) {
    return "local IDE directory";
  }
  if (norm === "docs/reference" || norm.startsWith("docs/reference/")) {
    return "local reference documentation";
  }
  if (norm === "docs" || norm === "docs/") {
    return "use docs/public, not the whole docs tree";
  }
  if (isEnvPath(norm) || norm.endsWith(".zip") || norm.endsWith(".tgz")) {
    return "secret or local artifact";
  }
  return null;
}

function forbiddenTracked(file) {
  const norm = file.replace(/\\/g, "/");
  if (norm === ".env.example" || norm.endsWith("/.env.example")) return false;
  if (isCursorOrAgents(norm)) return true;
  if (isIdea(norm)) return true;
  if (norm.split("/").some((seg) => seg === ".cursor" || seg === ".agents" || seg === ".idea")) return true;
  if (norm === "docs/reference" || norm.startsWith("docs/reference/")) return true;
  if (norm.startsWith("docs/") && !norm.startsWith("docs/public/")) return true;
  if (isEnvPath(norm)) return true;
  if (norm.endsWith(".zip") || norm.endsWith(".tgz")) return true;
  if (/\.(pem|key|p12|pfx)$/i.test(norm)) return true;
  return false;
}

function isIdea(norm) {
  return norm === ".idea" || norm.startsWith(".idea/");
}

function isCursorOrAgents(norm) {
  return (
    norm === ".cursor" ||
    norm.startsWith(".cursor/") ||
    norm === ".agents" ||
    norm.startsWith(".agents/")
  );
}

function isEnvPath(norm) {
  const base = norm.split("/").pop() ?? norm;
  return base === ".env" || (base.startsWith(".env.") && base !== ".env.example");
}

function insideGitRepo(cwd) {
  try {
    const out = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim() === "true";
  } catch {
    return false;
  }
}
