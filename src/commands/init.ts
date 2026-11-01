import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import chalk from "chalk";
import { confirm, input, select } from "@inquirer/prompts";
import { printBanner } from "../banner.js";
import { addRepo, formatRepos, parseRepos, readEnvKey, suggestRepoName, upsertEnvKey } from "../env-file.js";
import { readEnvFile, resolveInstallDir, writeEnvFile } from "../install-home.js";
import { copyInstalledSkill, homePointerExists, prepareMachine, spawnSetupScript, thisPackageRoot } from "../machine-setup.js";
import { defaultBinLookup, resolveCursorAgent, resolveOpencodeBin } from "../prereqs.js";
import { restartBridge } from "../service-restart.js";

function requireTty(): void {
  if (!process.stdin.isTTY) {
    throw new Error("init needs an interactive terminal.");
  }
}

export async function runInit(cwd = process.cwd()): Promise<void> {
  requireTty();
  printBanner({ hint: false });

  const target = fs.realpathSync(cwd);
  if (!fs.statSync(target).isDirectory()) {
    throw new Error(`Not a directory: ${target}`);
  }

  const lookup = defaultBinLookup();
  let cursor = resolveCursorAgent(lookup, process.env.AGENT_BIN);
  if (!cursor.ok && homePointerExists()) {
    try {
      const fromFile = readEnvKey(readEnvFile(resolveInstallDir(cwd)), "AGENT_BIN");
      if (fromFile) cursor = resolveCursorAgent(lookup, fromFile);
    } catch {
      /* the installation does not exist yet; the agent command on PATH is what counts */
    }
  }
  if (!cursor.ok) throw new Error(cursor.reason);
  console.log(chalk.green(`✓ Cursor CLI ${cursor.bin}`));

  const opencode = resolveOpencodeBin(lookup, process.env.OPENCODE_BIN);
  if (opencode) console.log(chalk.green(`✓ OpenCode ${opencode}`));
  else console.log(chalk.yellow("⚠ OpenCode not found. ask_opencode stays unavailable."));

  copyInstalledSkill(thisPackageRoot());

  const firstRun = !homePointerExists() && !process.env.AGENT_BRIDGE_HOME?.trim();
  if (firstRun) console.log(chalk.gray("First run: preparing .env, the service, and the skill."));
  const installDir = firstRun
    ? prepareMachine({
        homeDir: os.homedir(),
        packageRoot: thisPackageRoot(),
        agentBin: cursor.bin,
        token: crypto.randomBytes(32).toString("hex"),
        platform: process.platform,
        spawnSetup: spawnSetupScript,
      })
    : resolveInstallDir(cwd);
  let content = readEnvFile(installDir);
  let repos = parseRepos(readEnvKey(content, "REPOS"));

  let name = suggestRepoName(target);
  for (;;) {
    name = (await input({
      message: "Name of this directory on the allowlist:",
      default: name,
    })).trim();
    let result: ReturnType<typeof addRepo>;
    try {
      result = addRepo(repos, name, target);
    } catch (err) {
      console.log(chalk.yellow(`⚠ ${err instanceof Error ? err.message : String(err)}`));
      continue;
    }
    if (result.status === "same-path") {
      console.log(chalk.yellow(`⚠ ${target} is already on the allowlist. Nothing was rewritten.`));
      console.log("");
      return;
    }
    if (result.status === "same-name") {
      console.log(chalk.yellow(`⚠ The name "${name}" already points at another directory.`));
      continue;
    }
    repos = result.entries;
    break;
  }

  const access = await select({
    message: "What may Grok do in this directory?",
    choices: [
      { name: "Read only", value: "read" as const },
      { name: "May change files", value: "write" as const },
    ],
  });

  content = upsertEnvKey(content, "REPOS", formatRepos(repos));
  if (access === "write") {
    content = upsertEnvKey(content, "ALLOW_WRITE", "1");
    console.log(chalk.yellow("⚠ ALLOW_WRITE=1 applies to the whole list, not only this folder."));
  } else if (readEnvKey(content, "ALLOW_WRITE") === "1") {
    console.log(chalk.yellow("⚠ The bridge already allows writes on the whole list. This directory joins that list."));
  }

  writeEnvFile(installDir, content);
  console.log("");
  console.log(chalk.green(`✓ ${chalk.bold(name)} added`));
  console.log(chalk.green(`✓ ${target}`));
  console.log(chalk.gray(`  .env at ${installDir}`));

  const restart = await confirm({
    message: "Restart the service so Grok can see the directory?",
    default: true,
  });
  if (restart) restartBridge();
  console.log("");
}
