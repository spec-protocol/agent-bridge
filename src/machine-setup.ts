import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { upsertEnvKey } from "./env-file.js";
import { saveEnvBackup, writeEnvFile } from "./install-home.js";

export function thisPackageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function homePointerPath(homeDir = os.homedir()): string {
  return path.join(homeDir, ".agent-bridge", "home");
}

export function homePointerExists(homeDir = os.homedir()): boolean {
  return fs.existsSync(homePointerPath(homeDir));
}

export function skillDest(homeDir = os.homedir()): string {
  return path.join(homeDir, ".cursor", "skills", "agent-bridge", "SKILL.md");
}

export function copyInstalledSkill(packageRoot: string, homeDir = os.homedir()): void {
  const source = path.join(packageRoot, "skills", "agent-bridge", "SKILL.md");
  const dest = skillDest(homeDir);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest);
}

export function bootstrapEnvContent(example: string, agentBin: string, token: string): string {
  return upsertEnvKey(upsertEnvKey(example, "BRIDGE_TOKEN", token), "AGENT_BIN", agentBin);
}

export interface PrepareMachineOptions {
  homeDir: string;
  packageRoot: string;
  agentBin: string;
  token: string;
  platform: NodeJS.Platform;
  spawnSetup: (script: string, installDir: string) => void;
}

export function prepareMachine(options: PrepareMachineOptions): string {
  const installDir = options.packageRoot;
  const envPath = path.join(installDir, ".env");
  if (!fs.existsSync(envPath)) {
    const example = fs.readFileSync(path.join(installDir, ".env.example"), "utf8");
    const content = bootstrapEnvContent(example, options.agentBin, options.token);
    writeEnvFile(installDir, content, options.homeDir);
  } else {
    saveEnvBackup(installDir, options.homeDir);
  }

  copyInstalledSkill(installDir, options.homeDir);

  const script =
    options.platform === "darwin"
      ? path.join(installDir, "scripts", "darwin", "setup-launchd.sh")
      : options.platform === "linux"
        ? path.join(installDir, "scripts", "setup-systemd.sh")
        : null;
  if (!script) {
    throw new Error("Automatic service setup exists only on macOS (--launchd) and Linux (--systemd).");
  }
  options.spawnSetup(script, installDir);

  const pointerDir = path.join(options.homeDir, ".agent-bridge");
  fs.mkdirSync(pointerDir, { recursive: true });
  fs.chmodSync(pointerDir, 0o700);
  fs.writeFileSync(homePointerPath(options.homeDir), `${installDir}\n`, { mode: 0o600 });
  fs.chmodSync(homePointerPath(options.homeDir), 0o600);
  return installDir;
}

export function spawnSetupScript(script: string, installDir: string): void {
  const result = spawnSync("bash", [script], {
    cwd: installDir,
    env: { ...process.env, INSTALL_DIR: installDir },
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`Failed to start the service (${path.basename(script)}).`);
  }
}
