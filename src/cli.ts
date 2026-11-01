#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command } from "commander";
import chalk from "chalk";
import { printBanner } from "./banner.js";
import { runConfig } from "./commands/config.js";
import { runInit } from "./commands/init.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const program = new Command();

program
  .name("agent-bridge")
  .description("Local MCP bridge between Grok Bot and the IDEs on this machine.")
  .version(version);

program
  .command("init")
  .description("Adds the current directory to the allowlist Grok can see")
  .action(async () => {
    try {
      await runInit();
    } catch (err) {
      exitWithError(err);
    }
  });

program
  .command("config")
  .description("Edits the installation .env")
  .action(async () => {
    try {
      await runConfig();
    } catch (err) {
      exitWithError(err);
    }
  });

program
  .command("serve")
  .description("Starts the MCP server")
  .action(async () => {
    await import("./index.js");
  });

function exitWithError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  console.error(chalk.red(`✗ ${message}`));
  process.exit(1);
}

const ALL_COMMANDS = ["init", "config", "serve"];
const args = process.argv.slice(2);
const hasSubcommand = args.length > 0 && !args[0].startsWith("-") && ALL_COMMANDS.includes(args[0]);

if (!hasSubcommand && args.length === 0) {
  printBanner();
  program.help();
} else {
  program.parse(process.argv);
}
