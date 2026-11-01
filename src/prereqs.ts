import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface BinLookup {
  which(name: string): string | null;
  isExecutable(file: string): boolean;
  fileInfo(file: string): string;
  machine(): string;
  platform(): NodeJS.Platform;
}

export type CursorResolution = { ok: true; bin: string } | { ok: false; reason: string };

/** Accepts a script, a universal binary, or a Mach-O built for this machine. Same rule as scripts/lib/darwin-arch.sh. */
export function machOAcceptable(fileInfo: string, machine: string): boolean {
  if (/text|script|ASCII|JSON/i.test(fileInfo)) return true;
  if (/universal/i.test(fileInfo)) return true;
  if (machine === "arm64" && fileInfo.includes("arm64")) return true;
  if (machine === "x86_64" && fileInfo.includes("x86_64")) return true;
  return false;
}

export function resolveCursorAgent(lookup: BinLookup, agentBinEnv?: string): CursorResolution {
  const explicit = agentBinEnv?.trim();
  const candidate = explicit || lookup.which("agent");
  if (!candidate || !lookup.isExecutable(candidate)) {
    return {
      ok: false,
      reason: "Cursor CLI (agent) not found. Install Cursor and put the agent command on PATH.",
    };
  }
  if (lookup.platform() === "darwin") {
    const info = lookup.fileInfo(candidate);
    if (!machOAcceptable(info, lookup.machine())) {
      return {
        ok: false,
        reason: `agent at ${candidate} is not native to ${lookup.machine()}.`,
      };
    }
  }
  return { ok: true, bin: candidate };
}

export function resolveOpencodeBin(lookup: BinLookup, opencodeBinEnv?: string, home = os.homedir()): string | null {
  const explicit = opencodeBinEnv?.trim();
  if (explicit && lookup.isExecutable(explicit)) return explicit;
  const fromPath = lookup.which("opencode");
  if (fromPath && lookup.isExecutable(fromPath)) return fromPath;
  const fallback = path.join(home, ".opencode", "bin", "opencode");
  if (lookup.isExecutable(fallback)) return fallback;
  return null;
}

export function defaultBinLookup(): BinLookup {
  return {
    which(name: string): string | null {
      try {
        const out = execFileSync("which", [name], { encoding: "utf8" }).trim();
        return out || null;
      } catch {
        return null;
      }
    },
    isExecutable(file: string): boolean {
      try {
        fs.accessSync(file, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    },
    fileInfo(file: string): string {
      try {
        return execFileSync("file", ["-b", file], { encoding: "utf8" });
      } catch {
        return "";
      }
    },
    machine(): string {
      try {
        return execFileSync("uname", ["-m"], { encoding: "utf8" }).trim();
      } catch {
        return os.machine();
      }
    },
    platform(): NodeJS.Platform {
      return process.platform;
    },
  };
}
