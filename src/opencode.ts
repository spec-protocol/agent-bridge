import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { Config } from "./config.js";
import { DEFAULT_OPENCODE_AGENT } from "./config.js";

export interface OpencodeStatus {
  available: boolean;
  bin?: string;
  defaultModel?: string;
  agent?: string;
  reason?: string;
}

const DEFAULT_MODEL = "opencode/glm-5.3-flash-free";
const AGENT_LIST_TIMEOUT_MS = 5000;

function resolveBinFromEnv(cfg: Config): string | undefined {
  if (cfg.opencodeBin) return path.resolve(cfg.opencodeBin);
  try {
    const fromPath = execFileSync("which", ["opencode"], { encoding: "utf8" }).trim();
    if (fromPath) return fromPath;
  } catch {
    /* ignore */
  }
  const homeDefault = path.join(os.homedir(), ".opencode", "bin", "opencode");
  return homeDefault;
}

/** Checks that the agent exists (`opencode agent list` output). */
export function opencodeAgentListIncludes(agentListOutput: string, agentId: string): boolean {
  const re = new RegExp(`^${agentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s`, "m");
  return re.test(agentListOutput);
}

function probeAgentExists(bin: string, agentId: string): boolean {
  try {
    const out = execFileSync(bin, ["agent", "list"], {
      encoding: "utf8",
      timeout: AGENT_LIST_TIMEOUT_MS,
    });
    return opencodeAgentListIncludes(out, agentId);
  } catch {
    return false;
  }
}

/** Detects whether the OpenCode CLI is available (never throws). */
export function resolveOpencode(cfg: Config): OpencodeStatus {
  const agentId = cfg.opencodeAgent || DEFAULT_OPENCODE_AGENT;
  if (cfg.opencodeDisabled) {
    return { available: false, agent: agentId, reason: "disabled via OPENCODE_DISABLE" };
  }
  const candidate = resolveBinFromEnv(cfg);
  if (!candidate) {
    return {
      available: false,
      agent: agentId,
      reason: "OpenCode binary not found (install OpenCode or set OPENCODE_BIN)",
    };
  }
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
  } catch {
    return {
      available: false,
      agent: agentId,
      reason: `OpenCode binary is not executable: ${candidate}`,
    };
  }
  if (!probeAgentExists(candidate, agentId)) {
    return {
      available: false,
      bin: candidate,
      agent: agentId,
      reason: `OpenCode agent "${agentId}" not found (check: opencode agent list)`,
    };
  }
  return {
    available: true,
    bin: candidate,
    defaultModel: cfg.opencodeModel ?? DEFAULT_MODEL,
    agent: agentId,
  };
}

/** Help text when a headless MCP call may time out waiting on CLI permissions. */
export const OPENCODE_HEADLESS_HINT =
  "For MCP/Grok use, if a run times out with no answer, set OPENCODE_AUTO=1 in .env and restart the bridge (see docs/OPENCODE.md).";

/** Light heuristic: stderr looks like an OpenCode permission prompt. */
export function opencodeStderrLooksLikePermissionPrompt(stderr: string): boolean {
  const s = stderr.toLowerCase();
  return /permission|approve|denied|allow/.test(s);
}

/** Builds the error suffix for an ask_opencode timeout. */
export function opencodeTimeoutExtra(stderr: string, autoApprove: boolean): string {
  let extra = "";
  if (!autoApprove) extra += `\n\n${OPENCODE_HEADLESS_HINT}`;
  if (opencodeStderrLooksLikePermissionPrompt(stderr)) {
    extra = `\n\n[Possible OpenCode permission prompt.]${extra}`;
  }
  return extra;
}

export interface OpencodeRunOptions {
  sessionId?: string;
  continueSession?: boolean;
  jsonFormat?: boolean;
}

/** Builds the `opencode run` argv. Exported for tests. */
export function buildOpencodeArgs(
  prompt: string,
  dir: string,
  model: string,
  autoApprove: boolean,
  agentId: string,
  opts?: OpencodeRunOptions
): string[] {
  const useJson = opts?.jsonFormat !== false;
  const args = ["run", "--format", useJson ? "json" : "default", "--dir", dir, "-m", model, "--agent", agentId];
  if (opts?.continueSession) args.push("--continue");
  if (opts?.sessionId) args.push("--session", opts.sessionId);
  if (autoApprove) args.push("--auto");
  const safePrompt = prompt.startsWith("-") ? " " + prompt : prompt;
  args.push(safePrompt);
  return args;
}

/** Extracts text and sessionID from `opencode run --format json` NDJSON. */
export function parseOpencodeJsonOutput(stdout: string): { text: string; sessionId?: string } {
  const chunks: string[] = [];
  let sessionId: string | undefined;
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const o = JSON.parse(t) as Record<string, unknown>;
      if (typeof o.sessionID === "string") sessionId = o.sessionID;
      if (o.type === "text" && typeof o.text === "string") chunks.push(o.text);
      else if (typeof o.part === "string") chunks.push(o.part);
    } catch {
      /* ignore */
    }
  }
  const text = chunks.join("").trim();
  if (text) return { text, sessionId };
  return { text: stripAnsi(stdout).trim(), sessionId };
}

/** Lists OpenCode sessions in the repo directory (`opencode session list`). */
export function listOpencodeSessions(bin: string, dir: string, timeoutMs = 15_000): { ok: true; text: string } | { ok: false; error: string } {
  try {
    const out = execFileSync(bin, ["session", "list"], { cwd: dir, encoding: "utf8", timeout: timeoutMs });
    return { ok: true, text: stripAnsi(out).trim() || "(no sessions listed)" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Strips ANSI codes from CLI output. */
export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "").replace(/\u001b\][^\u0007]*(\u0007|\u001b\\)/g, "");
}
