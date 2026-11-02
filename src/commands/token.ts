import { spawn } from "node:child_process";
import { readEnvKey } from "../env-file.js";
import { envFilePath, readEnvFile, resolveInstallDir } from "../install-home.js";

export interface ClipboardTool {
  command: string;
  args: string[];
}

export interface ClipboardProcess {
  stdin: { write(data: string): void; end(): void } | null;
  on(event: "error", listener: (err: NodeJS.ErrnoException) => void): void;
  on(event: "exit", listener: (code: number | null) => void): void;
}

export type ClipboardSpawn = (
  command: string,
  args: string[],
  options: { stdio: ["pipe", "ignore", "ignore"] },
) => ClipboardProcess;

export const COPIED_MESSAGE =
  "Copied. Paste it in the protected field of Grok Bot. Do not paste it in the chat.";

export function clipboardTools(platform: NodeJS.Platform): ClipboardTool[] {
  if (platform === "darwin") return [{ command: "pbcopy", args: [] }];
  if (platform === "win32") return [{ command: "clip", args: [] }];
  if (platform === "linux") {
    return [
      { command: "wl-copy", args: [] },
      { command: "xclip", args: ["-selection", "clipboard"] },
      { command: "xsel", args: ["--clipboard", "--input"] },
    ];
  }
  return [];
}

export function tokenUsable(token: string | undefined): token is string {
  if (!token || token.length < 32) return false;
  if (token.includes("COLE_AQUI") || token.includes("REPLACE_WITH_GENERATED_TOKEN")) return false;
  return true;
}

export function missingClipboardMessage(envPath: string): string {
  return `No clipboard tool found. Open ${envPath} and copy the BRIDGE_TOKEN line by hand.`;
}

export interface CopyTokenInput {
  platform: NodeJS.Platform;
  token: string;
  envPath: string;
  spawn?: ClipboardSpawn;
  log?: (message: string) => void;
  error?: (message: string) => void;
}

function writeClipboard(spawnFn: ClipboardSpawn, tool: ClipboardTool, token: string): Promise<boolean> {
  return new Promise((resolve) => {
    let child: ClipboardProcess;
    try {
      child = spawnFn(tool.command, tool.args, { stdio: ["pipe", "ignore", "ignore"] });
    } catch {
      resolve(false);
      return;
    }
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    child.on("error", () => finish(false));
    child.on("exit", (code) => finish(code === 0));
    if (!child.stdin) {
      finish(false);
      return;
    }
    try {
      child.stdin.write(token);
      child.stdin.end();
    } catch {
      finish(false);
    }
  });
}

/** Copies the token to the clipboard. Returns 0 on success. Never prints the token. */
export async function copyTokenToClipboard(input: CopyTokenInput): Promise<number> {
  const log = input.log ?? ((message) => console.log(message));
  const error = input.error ?? ((message) => console.error(message));
  if (!tokenUsable(input.token)) {
    error("BRIDGE_TOKEN is missing or still a placeholder.");
    return 1;
  }
  const spawnFn = input.spawn ?? ((command, args, options) => spawn(command, args, options));
  for (const tool of clipboardTools(input.platform)) {
    if (await writeClipboard(spawnFn, tool, input.token)) {
      log(COPIED_MESSAGE);
      return 0;
    }
  }
  error(missingClipboardMessage(input.envPath));
  return 1;
}

export async function runCopyToken(): Promise<void> {
  const installDir = resolveInstallDir();
  const envPath = envFilePath(installDir);
  const token = readEnvKey(readEnvFile(installDir), "BRIDGE_TOKEN") ?? "";
  const code = await copyTokenToClipboard({ platform: process.platform, token, envPath });
  if (code !== 0) process.exit(code);
}
