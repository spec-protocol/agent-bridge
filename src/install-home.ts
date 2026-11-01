import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function looksLikeInstall(dir: string): boolean {
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { name?: string };
    return pkg.name === "@spec-protocol/agent-bridge";
  } catch {
    return false;
  }
}

export function resolveInstallDir(cwd = process.cwd()): string {
  const fromEnv = process.env.AGENT_BRIDGE_HOME?.trim();
  if (fromEnv && looksLikeInstall(fromEnv)) return path.resolve(fromEnv);
  const pointer = path.join(os.homedir(), ".agent-bridge", "home");
  if (fs.existsSync(pointer)) {
    const dir = fs.readFileSync(pointer, "utf8").trim();
    if (looksLikeInstall(dir)) return path.resolve(dir);
  }
  if (looksLikeInstall(cwd)) return path.resolve(cwd);
  throw new Error("agent-bridge installation not found. Run ./scripts/install.sh or set AGENT_BRIDGE_HOME.");
}

export function envFilePath(installDir: string): string {
  return path.join(installDir, ".env");
}

export function envBackupPath(homeDir = os.homedir()): string {
  return path.join(homeDir, ".agent-bridge", "env");
}

export function saveEnvBackup(installDir: string, homeDir = os.homedir()): void {
  const src = envFilePath(installDir);
  if (!fs.existsSync(src)) return;
  const dest = envBackupPath(homeDir);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.chmodSync(path.dirname(dest), 0o700);
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, 0o600);
}

/** Restores the copy only when the installation .env is missing. */
export function restoreEnvBackup(installDir: string, homeDir = os.homedir()): boolean {
  const dest = envFilePath(installDir);
  if (fs.existsSync(dest)) return false;
  const src = envBackupPath(homeDir);
  if (!fs.existsSync(src)) return false;
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, 0o600);
  return true;
}

export function readEnvFile(installDir: string): string {
  const file = envFilePath(installDir);
  if (!fs.existsSync(file)) {
    throw new Error(`Missing file: ${file}. Run ./scripts/install.sh in that installation.`);
  }
  return fs.readFileSync(file, "utf8");
}

export function writeEnvFile(installDir: string, content: string, homeDir = os.homedir()): void {
  const file = envFilePath(installDir);
  const body = content.endsWith("\n") ? content : `${content}\n`;
  fs.writeFileSync(file, body, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  saveEnvBackup(installDir, homeDir);
}
