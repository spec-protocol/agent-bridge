import crypto from "node:crypto";
import fs from "node:fs";
import chalk from "chalk";
import { confirm, input, select } from "@inquirer/prompts";
import { printBanner } from "../banner.js";
import {
  addRepo,
  formatRepos,
  moveRepoFirst,
  parseRepos,
  readEnvKey,
  removeRepo,
  suggestRepoName,
  upsertEnvKey,
  type RepoEntry,
} from "../env-file.js";
import { readEnvFile, resolveInstallDir, writeEnvFile } from "../install-home.js";
import { restartBridge } from "../service-restart.js";

function requireTty(): void {
  if (!process.stdin.isTTY) throw new Error("config needs an interactive terminal.");
}

function tokenSummary(content: string): string {
  const token = readEnvKey(content, "BRIDGE_TOKEN") ?? "";
  if (token.length < 32 || token.includes("COLE_AQUI") || token.includes("REPLACE_WITH_GENERATED_TOKEN")) return "missing or placeholder";
  return `set (${token.length} characters)`;
}

async function editRepos(content: string): Promise<string> {
  let repos = parseRepos(readEnvKey(content, "REPOS"));
  for (;;) {
    if (repos.length === 0) console.log(chalk.gray("  No directories on the allowlist."));
    else repos.forEach((repo, index) => console.log(chalk.gray(`  ${index === 0 ? "*" : " "} ${repo.name}  ${repo.dir}`)));
    const action = await select({
      message: "Directories",
      choices: [
        { name: "Add", value: "add" },
        { name: "Remove", value: "remove" },
        { name: "Set default (first on the list)", value: "default" },
        { name: "Back", value: "back" },
      ],
    });
    if (action === "back") break;
    if (action === "add") {
      const dir = (await input({ message: "Absolute path:", default: process.cwd() })).trim();
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        console.log(chalk.yellow(`⚠ Directory does not exist: ${dir}`));
        continue;
      }
      const resolved = fs.realpathSync(dir);
      const name = (await input({ message: "Name:", default: suggestRepoName(resolved) })).trim();
      const result = addRepo(repos, name, resolved);
      if (result.status === "same-path") console.log(chalk.yellow("⚠ That path is already on the list."));
      else if (result.status === "same-name") console.log(chalk.yellow("⚠ That name is already on the list."));
      else {
        repos = result.entries;
        console.log(chalk.green(`✓ ${name} added`));
      }
    } else if (repos.length === 0) {
      console.log(chalk.yellow("⚠ The list is empty."));
    } else if (action === "remove") {
      const name = await select({ message: "Remove", choices: repos.map((repo) => ({ name: repo.name, value: repo.name })) });
      repos = removeRepo(repos, name);
      console.log(chalk.green(`✓ ${name} removed`));
    } else {
      const name = await select({ message: "Default", choices: repos.map((repo) => ({ name: repo.name, value: repo.name })) });
      repos = moveRepoFirst(repos, name);
      console.log(chalk.green(`✓ ${name} is the default`));
    }
  }
  if (repos.length === 0) throw new Error("The allowlist cannot be empty.");
  return upsertEnvKey(content, "REPOS", formatRepos(repos));
}

async function editCursor(content: string): Promise<string> {
  const bin = await input({ message: "Path to agent:", default: readEnvKey(content, "AGENT_BIN") ?? "" });
  const model = await input({ message: "CURSOR_MODEL (empty keeps the CLI default):", default: readEnvKey(content, "CURSOR_MODEL") ?? "" });
  const trust = await select({
    message: "CURSOR_TRUST",
    choices: [
      { name: "On (--trust)", value: "1" },
      { name: "Off", value: "0" },
    ],
    default: readEnvKey(content, "CURSOR_TRUST") === "0" ? "0" : "1",
  });
  const sandbox = await select({
    message: "CURSOR_SANDBOX",
    choices: [
      { name: "Leave unset", value: "" },
      { name: "enabled", value: "enabled" },
      { name: "disabled", value: "disabled" },
    ],
    default: readEnvKey(content, "CURSOR_SANDBOX") ?? "",
  });
  const write = await select({
    message: "Writes on the directories in the list",
    choices: [
      { name: "Read only (ALLOW_WRITE=0)", value: "0" },
      { name: "May change all of them (ALLOW_WRITE=1)", value: "1" },
    ],
    default: readEnvKey(content, "ALLOW_WRITE") === "1" ? "1" : "0",
  });
  if (write === "1") console.log(chalk.yellow("⚠ ALLOW_WRITE=1 applies to the whole list."));
  let next = upsertEnvKey(content, "AGENT_BIN", bin.trim());
  next = upsertEnvKey(next, "CURSOR_TRUST", trust);
  next = upsertEnvKey(next, "ALLOW_WRITE", write);
  if (model.trim()) next = upsertEnvKey(next, "CURSOR_MODEL", model.trim());
  if (sandbox) next = upsertEnvKey(next, "CURSOR_SANDBOX", sandbox);
  return next;
}

async function editOpencode(content: string): Promise<string> {
  const disabled = await select({
    message: "OpenCode",
    choices: [
      { name: "Available if the binary exists", value: "0" },
      { name: "Off (OPENCODE_DISABLE=1)", value: "1" },
    ],
    default: readEnvKey(content, "OPENCODE_DISABLE") === "1" ? "1" : "0",
  });
  const bin = await input({ message: "OPENCODE_BIN (empty = search PATH):", default: readEnvKey(content, "OPENCODE_BIN") ?? "" });
  const model = await input({ message: "OPENCODE_MODEL:", default: readEnvKey(content, "OPENCODE_MODEL") ?? "" });
  let next = upsertEnvKey(content, "OPENCODE_DISABLE", disabled);
  if (bin.trim()) next = upsertEnvKey(next, "OPENCODE_BIN", bin.trim());
  if (model.trim()) next = upsertEnvKey(next, "OPENCODE_MODEL", model.trim());
  return next;
}

async function editNet(content: string): Promise<string> {
  const port = await input({
    message: "PORT",
    default: readEnvKey(content, "PORT") ?? "8787",
    validate: (value) => (/^[1-9][0-9]{0,4}$/.test(value.trim()) ? true : "Invalid port."),
  });
  const url = await input({
    message: "BRIDGE_MCP_URL (empty = quick tunnel):",
    default: readEnvKey(content, "BRIDGE_MCP_URL") ?? "",
  });
  let next = upsertEnvKey(content, "PORT", port.trim());
  if (url.trim()) next = upsertEnvKey(next, "BRIDGE_MCP_URL", url.trim());
  return next;
}

async function editToken(content: string): Promise<string> {
  console.log(chalk.gray(`  Current token: ${tokenSummary(content)}. The value is not shown.`));
  const generate = await confirm({ message: "Generate a new token?", default: false });
  if (!generate) return content;
  const token = crypto.randomBytes(32).toString("hex");
  console.log(chalk.green(`✓ Token generated (${token.length} characters). It will not be shown.`));
  console.log(chalk.yellow("⚠ Update the protected field in Grok Bot."));
  return upsertEnvKey(content, "BRIDGE_TOKEN", token);
}

async function editAudit(content: string): Promise<string> {
  const enabled = await select({
    message: "Local audit",
    choices: [
      { name: "On", value: "1" },
      { name: "Off", value: "0" },
    ],
    default: readEnvKey(content, "BRIDGE_AUDIT") === "0" ? "0" : "1",
  });
  const body = await select({
    message: "Store the prompt body",
    choices: [
      { name: "No (metadata only)", value: "0" },
      { name: "Yes (BRIDGE_AUDIT_BODY=1)", value: "1" },
    ],
    default: readEnvKey(content, "BRIDGE_AUDIT_BODY") === "1" ? "1" : "0",
  });
  if (body === "1") console.log(chalk.yellow("⚠ The body stays on this machine. Do not use this if logs leave the machine."));
  let next = upsertEnvKey(content, "BRIDGE_AUDIT", enabled);
  next = upsertEnvKey(next, "BRIDGE_AUDIT_BODY", body);
  return next;
}

export async function runConfig(): Promise<void> {
  requireTty();
  printBanner({ hint: false });
  const installDir = resolveInstallDir();
  let content = readEnvFile(installDir);
  console.log(chalk.gray(`  ${installDir}`));
  console.log("");

  let dirty = false;
  for (;;) {
    const section = await select({
      message: "What to change?",
      choices: [
        { name: "Directories", value: "repos" },
        { name: "Cursor and writes", value: "cursor" },
        { name: "OpenCode", value: "opencode" },
        { name: "Port and tunnel", value: "net" },
        { name: "Token", value: "token" },
        { name: "Audit", value: "audit" },
        { name: "Save and exit", value: "save" },
      ],
    });
    if (section === "save") break;
    const before = content;
    if (section === "repos") content = await editRepos(content);
    else if (section === "cursor") content = await editCursor(content);
    else if (section === "opencode") content = await editOpencode(content);
    else if (section === "net") content = await editNet(content);
    else if (section === "token") content = await editToken(content);
    else content = await editAudit(content);
    if (content !== before) dirty = true;
  }

  if (!dirty) {
    console.log(chalk.gray("  Nothing was changed."));
    console.log("");
    return;
  }
  const repos: RepoEntry[] = parseRepos(readEnvKey(content, "REPOS"));
  if (repos.length === 0) throw new Error("The allowlist cannot be empty.");
  writeEnvFile(installDir, content);
  console.log(chalk.green("✓ .env saved"));
  const restart = await confirm({ message: "Restart the service to apply?", default: true });
  if (restart) restartBridge();
  console.log("");
}
