import fs from "node:fs";
import type { Config } from "./config.js";
import { runProcess } from "./run.js";
import {
  buildOpencodeArgs,
  stripAnsi,
  opencodeTimeoutExtra,
  parseOpencodeJsonOutput,
  type OpencodeStatus,
} from "./opencode.js";
import { sessionDirForRepo, validateCursorSessionId } from "./cursor-sessions.js";

export { validateCursorSessionId } from "./cursor-sessions.js";

export type BusySlot = { since: number; repo: string } | null;

export interface AskCursorParams {
  prompt: string;
  repoName: string;
  repoDir: string;
  mode: "ask" | "agent";
  timeoutSec: number;
  model?: string;
  sessionId?: string;
}

export interface AskOpencodeParams {
  prompt: string;
  repoName: string;
  repoDir: string;
  timeoutSec: number;
  model: string;
  sessionId?: string;
  continueSession?: boolean;
}

export interface ExecutorResult {
  text: string;
  isError: boolean;
  truncated: boolean;
  logFields: Record<string, unknown>;
  sessionId?: string;
  promptChars: number;
}

export function buildAgentArgs(
  cfg: Config,
  prompt: string,
  dir: string,
  mode: "ask" | "agent",
  model?: string,
  sessionId?: string
): string[] {
  const args = ["-p", "--output-format", "text", "--workspace", dir];
  if (sessionId) args.push("--resume", sessionId);
  if (cfg.cursorTrust) args.push("--trust");
  if (mode === "ask") {
    args.push("--mode", "ask");
  } else {
    if (!cfg.allowWrite) throw new Error("agent mode blocked (ALLOW_WRITE!=1)");
    args.push("--force");
  }
  if (cfg.cursorSandbox) args.push("--sandbox", cfg.cursorSandbox);
  const m = model ?? cfg.cursorModel;
  if (m) args.push("--model", m);
  const safePrompt = prompt.startsWith("-") ? " " + prompt : prompt;
  args.push(safePrompt);
  return args;
}

const SESSION_ID_RE = /^ses_[A-Za-z0-9]+$/;

export function validateSessionId(sessionId: string | undefined): string | null {
  if (sessionId === undefined || sessionId === "") return null;
  if (!SESSION_ID_RE.test(sessionId)) return `invalid session_id (expected ses_…): "${sessionId}"`;
  return null;
}

export async function executeAskCursor(
  cfg: Config,
  params: AskCursorParams,
  hooks?: { onCancel?: (cancel: () => void) => void }
): Promise<ExecutorResult> {
  const { prompt, repoName, repoDir, mode, timeoutSec, model, sessionId } = params;
  const sessErr = validateCursorSessionId(sessionId);
  if (sessErr) {
    return {
      text: sessErr,
      isError: true,
      truncated: false,
      logFields: { tool: "ask_cursor", repo: repoName, error: "session_id" },
      promptChars: prompt.length,
    };
  }
  if (sessionId && !sessionDirForRepo(repoDir, sessionId)) {
    return {
      text: `Session "${sessionId}" was not found for this repository.`,
      isError: true,
      truncated: false,
      logFields: { tool: "ask_cursor", repo: repoName, error: "session_not_in_repo" },
      promptChars: prompt.length,
    };
  }
  const args = buildAgentArgs(cfg, prompt, repoDir, mode, model, sessionId);
  const res = await runProcess(cfg.agentBin, args, {
    cwd: repoDir,
    timeoutMs: timeoutSec * 1000,
    maxBytes: cfg.maxOutputBytes,
    env: { ...process.env, BRIDGE_TOKEN: undefined, NO_COLOR: "1", CI: "1" },
    onSpawn: (_child, killTree) => {
      hooks?.onCancel?.(() => killTree("SIGTERM"));
    },
  });
  const logFields: Record<string, unknown> = {
    tool: "ask_cursor",
    repo: repoName,
    mode,
    duration_ms: res.durationMs,
    exit_code: res.code,
    signal: res.signal,
    timed_out: res.timedOut,
    truncated: res.stdoutTruncated,
  };
  if (sessionId) logFields.cursor_session_id = sessionId;
  if (res.spawnError) {
    return {
      text: `Failed to run "${cfg.agentBin}": ${res.spawnError}. Is the Cursor CLI installed and on PATH (or set AGENT_BIN)?`,
      isError: true,
      truncated: false,
      logFields,
      promptChars: prompt.length,
    };
  }
  let out = res.stdout;
  const truncated = res.stdoutTruncated;
  if (truncated) out += `\n\n[output truncated at ${cfg.maxOutputBytes} bytes]`;
  if (res.timedOut) {
    return {
      text: `${out}\n\n[TIMEOUT after ${timeoutSec}s — process stopped]\n--- stderr (tail) ---\n${res.stderr.slice(-4000)}`,
      isError: true,
      truncated,
      logFields,
      promptChars: prompt.length,
    };
  }
  if (res.code !== 0) {
    return {
      text: `${out}\n\n[agent exited with code ${res.code}${res.signal ? `, signal ${res.signal}` : ""}]\n--- stderr (tail) ---\n${res.stderr.slice(-4000)}`,
      isError: true,
      truncated,
      logFields,
      promptChars: prompt.length,
    };
  }
  return {
    text: out || "(no output)",
    isError: false,
    truncated,
    logFields,
    promptChars: prompt.length,
  };
}

export async function executeAskOpencode(
  cfg: Config,
  opencodeStatus: OpencodeStatus,
  params: AskOpencodeParams,
  hooks?: { onCancel?: (cancel: () => void) => void }
): Promise<ExecutorResult> {
  const { prompt, repoName, repoDir, timeoutSec, model, sessionId, continueSession } = params;
  if (!opencodeStatus.available || !opencodeStatus.bin) {
    return {
      text:
        `OpenCode is not available on this bridge (${opencodeStatus.reason ?? "not configured"}). ` +
        "Use ask_cursor (default), git_readonly, read_file, or list_files.",
      isError: true,
      truncated: false,
      logFields: { tool: "ask_opencode", repo: repoName, error: "unavailable" },
      promptChars: prompt.length,
    };
  }
  const sessErr = validateSessionId(sessionId);
  if (sessErr) {
    return {
      text: sessErr,
      isError: true,
      truncated: false,
      logFields: { tool: "ask_opencode", repo: repoName, error: "session_id" },
      promptChars: prompt.length,
    };
  }
  const args = buildOpencodeArgs(prompt, repoDir, model, cfg.opencodeAuto, cfg.opencodeAgent, {
    sessionId,
    continueSession,
    jsonFormat: cfg.opencodeJsonFormat,
  });
  const res = await runProcess(opencodeStatus.bin, args, {
    cwd: repoDir,
    timeoutMs: timeoutSec * 1000,
    maxBytes: cfg.maxOutputBytes,
    env: { ...process.env, BRIDGE_TOKEN: undefined, NO_COLOR: "1", CI: "1" },
    onSpawn: (_child, killTree) => {
      hooks?.onCancel?.(() => killTree("SIGTERM"));
    },
  });
  const logFields: Record<string, unknown> = {
    tool: "ask_opencode",
    repo: repoName,
    model,
    opencode_agent: cfg.opencodeAgent,
    duration_ms: res.durationMs,
    exit_code: res.code,
    signal: res.signal,
    timed_out: res.timedOut,
    truncated: res.stdoutTruncated,
  };
  if (res.spawnError) {
    return {
      text: `Failed to run "${opencodeStatus.bin}": ${res.spawnError}. Check OPENCODE_BIN.`,
      isError: true,
      truncated: false,
      logFields,
      promptChars: prompt.length,
    };
  }
  let parsed = cfg.opencodeJsonFormat
    ? parseOpencodeJsonOutput(res.stdout)
    : { text: stripAnsi(res.stdout).trim(), sessionId: undefined as string | undefined };
  let out = parsed.text;
  const truncated = res.stdoutTruncated;
  if (truncated) out += `\n\n[output truncated at ${cfg.maxOutputBytes} bytes]`;
  const sessionFooter =
    parsed.sessionId && cfg.opencodeJsonFormat
      ? `\n\n---\nsession_id: ${parsed.sessionId}\n(continue: session_id + continue_session=true ou opencode session list)`
      : "";
  if (res.timedOut) {
    const errTail = stripAnsi(res.stderr).slice(-4000);
    const extra = opencodeTimeoutExtra(errTail, cfg.opencodeAuto);
    return {
      text: `${out}\n\n[TIMEOUT after ${timeoutSec}s — process stopped]${extra}\n--- stderr (tail) ---\n${errTail}${sessionFooter}`,
      isError: true,
      truncated,
      logFields,
      sessionId: parsed.sessionId,
      promptChars: prompt.length,
    };
  }
  if (res.code !== 0) {
    return {
      text: `${out}\n\n[opencode exited with code ${res.code}${res.signal ? `, signal ${res.signal}` : ""}]\n--- stderr (tail) ---\n${stripAnsi(res.stderr).slice(-4000)}${sessionFooter}`,
      isError: true,
      truncated,
      logFields,
      sessionId: parsed.sessionId,
      promptChars: prompt.length,
    };
  }
  const finalText = (out.trim() || "(no output)") + sessionFooter;
  return {
    text: finalText,
    isError: false,
    truncated,
    logFields,
    sessionId: parsed.sessionId,
    promptChars: prompt.length,
  };
}

export function repoExists(cfg: Config, name: string, dir: string): void {
  if (!cfg.repos.has(name)) return;
  if (!fs.existsSync(dir)) throw new Error(`repo directory "${name}" does not exist: ${dir}`);
}
