import path from "node:path";
import fs from "node:fs";

export interface Config {
  port: number;
  host: string;
  token: string;
  repos: Map<string, string>;
  defaultRepo: string;
  allowWrite: boolean;
  agentBin: string;
  gitBin: string;
  cursorModel?: string;
  cursorTrust: boolean;
  cursorSandbox?: "enabled" | "disabled";
  maxOutputBytes: number;
  maxTimeoutSec: number;
  gitTimeoutSec: number;
  maxReadBytes: number;
  readDenyGlobs: string[];
  mcpPath: string;
  opencodeDisabled: boolean;
  opencodeBin?: string;
  opencodeModel?: string;
  opencodeAuto: boolean;
  opencodeAgent: string;
  opencodeJsonFormat: boolean;
  jobRetentionHours: number;
  auditEnabled: boolean;
  auditBody: boolean;
  auditDir?: string;
}

const OPENCODE_AGENT_ALLOWED = new Set(["plan"]);
export const DEFAULT_OPENCODE_AGENT = "plan";

function parseRepos(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const eq = part.indexOf("=");
    if (eq <= 0) throw new Error(`Invalid REPOS (expected name=/absolute/path): "${part}"`);
    const name = part.slice(0, eq).trim();
    const dir = part.slice(eq + 1).trim();
    if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error(`Invalid repo name: "${name}"`);
    if (!path.isAbsolute(dir)) throw new Error(`Repo "${name}" path must be absolute: "${dir}"`);
    map.set(name, path.resolve(dir));
  }
  if (map.size === 0) throw new Error("REPOS is empty");
  return map;
}

function parseOpencodeAgent(raw: string | undefined): string {
  const agent = raw?.trim() || DEFAULT_OPENCODE_AGENT;
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(agent)) {
    throw new Error(`Invalid OPENCODE_AGENT: "${agent}"`);
  }
  if (!OPENCODE_AGENT_ALLOWED.has(agent)) {
    throw new Error(`OPENCODE_AGENT="${agent}" is not allowed; use only: plan`);
  }
  return agent;
}

function intEnv(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid ${name}: ${v}`);
  return Math.floor(n);
}

export function loadConfig(): Config {
  const token = process.env.BRIDGE_TOKEN ?? "";
  if (token.length < 32) {
    throw new Error(
      "BRIDGE_TOKEN is missing or too short (minimum 32 characters). Generate one with: openssl rand -hex 32"
    );
  }
  const reposRaw = process.env.REPOS?.trim();
  if (!reposRaw) {
    throw new Error(
      "REPOS is missing. Set it in .env, e.g. REPOS=main=/absolute/path/to/your/repository"
    );
  }
  const repos = parseRepos(reposRaw);
  for (const [name, dir] of repos) {
    if (!fs.existsSync(dir)) console.warn(`[warning] repo "${name}" does not exist: ${dir}`);
  }
  const sandbox = process.env.CURSOR_SANDBOX;
  if (sandbox && sandbox !== "enabled" && sandbox !== "disabled") {
    throw new Error("CURSOR_SANDBOX must be 'enabled' or 'disabled'");
  }
  let mcpPath = process.env.MCP_PATH || "/mcp";
  if (!mcpPath.startsWith("/")) mcpPath = "/" + mcpPath;
  return {
    port: intEnv("PORT", 8787),
    host: "127.0.0.1",
    token,
    repos,
    defaultRepo: repos.keys().next().value as string,
    allowWrite: process.env.ALLOW_WRITE === "1",
    agentBin: process.env.AGENT_BIN || "agent",
    gitBin: process.env.GIT_BIN || "git",
    cursorModel: process.env.CURSOR_MODEL || undefined,
    cursorTrust: process.env.CURSOR_TRUST !== "0",
    cursorSandbox: (sandbox as "enabled" | "disabled" | undefined) || undefined,
    maxOutputBytes: intEnv("MAX_OUTPUT_BYTES", 200_000),
    maxTimeoutSec: intEnv("MAX_TIMEOUT_SEC", 1800),
    gitTimeoutSec: intEnv("GIT_TIMEOUT_SEC", 120),
    maxReadBytes: intEnv("MAX_READ_BYTES", 300_000),
    readDenyGlobs: (process.env.READ_DENY_GLOBS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    mcpPath,
    opencodeDisabled: process.env.OPENCODE_DISABLE === "1",
    opencodeBin: process.env.OPENCODE_BIN?.trim() || undefined,
    opencodeModel: process.env.OPENCODE_MODEL?.trim() || undefined,
    opencodeAuto: process.env.OPENCODE_AUTO === "1",
    opencodeAgent: parseOpencodeAgent(process.env.OPENCODE_AGENT),
    opencodeJsonFormat: process.env.BRIDGE_OPENCODE_JSON !== "0",
    jobRetentionHours: intEnv("JOB_RETENTION_HOURS", 24),
    auditEnabled: process.env.BRIDGE_AUDIT !== "0",
    auditBody: process.env.BRIDGE_AUDIT_BODY === "1",
    auditDir: process.env.BRIDGE_AUDIT_DIR?.trim() || undefined,
  };
}
