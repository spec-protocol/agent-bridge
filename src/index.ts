#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import express, { type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig, type Config } from "./config.js";
import { runProcess } from "./run.js";
import { validateGitArgs, GIT_ALLOWED } from "./git.js";
import { FileAccess, BlockedError } from "./files.js";
import {
  resolveOpencode,
  stripAnsi,
  listOpencodeSessions,
  OPENCODE_HEADLESS_HINT,
  type OpencodeStatus,
} from "./opencode.js";
import { initAudit, auditRecord, readAuditTail } from "./audit.js";
import { JobStore } from "./jobs.js";
import {
  buildAgentArgs as buildAgentArgsWithCfg,
  executeAskCursor,
  executeAskOpencode,
  validateSessionId,
  type BusySlot,
} from "./executors.js";

const MCP_VERSION = "0.1.1";

let cfg: Config;
try {
  cfg = loadConfig();
} catch (e) {
  console.error(`[agent-bridge] configuration error: ${(e as Error).message}`);
  process.exit(1);
}

initAudit(cfg);

const files: FileAccess = new FileAccess(cfg.readDenyGlobs, cfg.maxReadBytes);

const opencodeStatus: OpencodeStatus = resolveOpencode(cfg);
if (!opencodeStatus.available) {
  console.warn(`[warning] ask_opencode unavailable: ${opencodeStatus.reason ?? "OpenCode not found"}`);
}

const tokenHash = crypto.createHash("sha256").update(cfg.token).digest();
function tokenOk(header: string | undefined): boolean {
  if (!header) return false;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return false;
  const got = crypto.createHash("sha256").update(m[1].trim()).digest();
  return crypto.timingSafeEqual(got, tokenHash);
}

function log(entry: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}

function resolveRepo(name?: string): { name: string; dir: string } {
  const key = name ?? cfg.defaultRepo;
  const dir = cfg.repos.get(key);
  if (!dir) throw new Error(`repo "${key}" is not on the allowlist. Use list_repos. Available: ${[...cfg.repos.keys()].join(", ")}`);
  if (!fs.existsSync(dir)) throw new Error(`repo directory "${key}" does not exist: ${dir}`);
  return { name: key, dir };
}

/** Builds the Cursor CLI argv. Exported for tests and documentation. */
export function buildAgentArgs(prompt: string, dir: string, mode: "ask" | "agent", model?: string): string[] {
  return buildAgentArgsWithCfg(cfg, prompt, dir, mode, model);
}

let cursorBusy: BusySlot = null;
let opencodeBusy: BusySlot = null;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string, isError = false): ToolResult => ({ content: [{ type: "text", text: t }], ...(isError ? { isError } : {}) });

const askCursorSchema = {
  prompt: z.string().min(1).max(100_000).describe("Question or instruction for Cursor"),
  repo: z.string().optional().describe("Repo name on the allowlist (see list_repos). Default: the first one."),
  mode: z.enum(["ask", "agent"]).optional().describe("'ask' (default, read-only) or 'agent' (writes, requires ALLOW_WRITE=1)"),
  timeout_sec: z.number().int().positive().optional().describe("Timeout in seconds (default 600)"),
  model: z.string().regex(/^[A-Za-z0-9._:\/-]+$/).max(100).optional().describe("Cursor model (optional; see `agent models`)"),
};

const askOpencodeSchema = {
  prompt: z.string().min(1).max(100_000).describe("Question or instruction (basic task)"),
  repo: z.string().optional().describe("Repo name on the allowlist (see list_repos). Default: the first one."),
  timeout_sec: z.number().int().positive().optional().describe("Timeout in seconds (default 600)"),
  model: z
    .string()
    .regex(/^[A-Za-z0-9._:\/-]+$/)
    .max(100)
    .optional()
    .describe("OpenCode provider/model (optional; default in list_repos → opencode.default_model)"),
  session_id: z
    .string()
    .regex(/^ses_[A-Za-z0-9]+$/)
    .optional()
    .describe("Existing OpenCode session (ses_…) to continue"),
  continue_session: z.boolean().optional().describe("Passes --continue to opencode run (with session_id)"),
};

function auditToolDone(
  tool: string,
  repo: string | null,
  res: { isError: boolean; promptChars?: number; text: string; logFields: Record<string, unknown>; sessionId?: string },
  bodies?: { prompt?: string }
): void {
  const duration = typeof res.logFields.duration_ms === "number" ? res.logFields.duration_ms : 0;
  auditRecord(
    cfg,
    {
      ts: new Date().toISOString(),
      tool,
      repo,
      duration_ms: duration,
      status: res.isError ? "error" : "ok",
      exit_code: res.logFields.exit_code as number | null | undefined,
      prompt_chars: res.promptChars,
      response_chars: res.text.length,
      allow_write: cfg.allowWrite,
      opencode_session_id: res.sessionId,
    },
    bodies
  );
}

async function runAskCursorSync(args: z.infer<z.ZodObject<typeof askCursorSchema>>): Promise<ToolResult> {
  const m = args.mode ?? "ask";
  let r: { name: string; dir: string };
  try {
    r = resolveRepo(args.repo);
  } catch (e) {
    log({ tool: "ask_cursor", repo: args.repo ?? null, duration_ms: 0, exit_code: null, error: "repo" });
    return text((e as Error).message, true);
  }
  if (m === "agent" && !cfg.allowWrite) {
    log({ tool: "ask_cursor", repo: r.name, mode: m, duration_ms: 0, exit_code: null, error: "write_disabled" });
    return text("Mode 'agent' (with writes) is disabled on this bridge. Use mode='ask' or restart the bridge with ALLOW_WRITE=1.", true);
  }
  if (cursorBusy) {
    const secs = Math.round((Date.now() - cursorBusy.since) / 1000);
    log({ tool: "ask_cursor", repo: r.name, mode: m, duration_ms: 0, exit_code: null, error: "busy" });
    return text(`Busy: a Cursor run is already in progress (repo ${cursorBusy.repo}, for ${secs}s). Try again when it finishes.`, true);
  }
  const timeoutSec = Math.min(args.timeout_sec ?? 600, cfg.maxTimeoutSec);
  cursorBusy = { since: Date.now(), repo: r.name };
  try {
    const res = await executeAskCursor(cfg, {
      prompt: args.prompt,
      repoName: r.name,
      repoDir: r.dir,
      mode: m,
      timeoutSec,
      model: args.model,
    });
    log(res.logFields);
    auditToolDone("ask_cursor", r.name, res, { prompt: args.prompt });
    return text(res.text, res.isError);
  } finally {
    cursorBusy = null;
  }
}

async function runAskOpencodeSync(args: z.infer<z.ZodObject<typeof askOpencodeSchema>>): Promise<ToolResult> {
  if (!opencodeStatus.available || !opencodeStatus.bin) {
    log({ tool: "ask_opencode", repo: args.repo ?? null, duration_ms: 0, exit_code: null, error: "unavailable" });
    return text(
      `OpenCode is not available on this bridge (${opencodeStatus.reason ?? "not configured"}). ` +
        "Use ask_cursor (default), git_readonly, read_file, or list_files.",
      true
    );
  }
  let r: { name: string; dir: string };
  try {
    r = resolveRepo(args.repo);
  } catch (e) {
    log({ tool: "ask_opencode", repo: args.repo ?? null, duration_ms: 0, exit_code: null, error: "repo" });
    return text((e as Error).message, true);
  }
  const sessErr = validateSessionId(args.session_id);
  if (sessErr) {
    return text(sessErr, true);
  }
  if (opencodeBusy) {
    const secs = Math.round((Date.now() - opencodeBusy.since) / 1000);
    log({ tool: "ask_opencode", repo: r.name, duration_ms: 0, exit_code: null, error: "busy" });
    return text(
      `Busy: an OpenCode run is already in progress (repo ${opencodeBusy.repo}, for ${secs}s). Try again when it finishes.`,
      true
    );
  }
  const timeoutSec = Math.min(args.timeout_sec ?? 600, cfg.maxTimeoutSec);
  const modelId = args.model ?? opencodeStatus.defaultModel ?? "opencode/glm-5.3-flash-free";
  opencodeBusy = { since: Date.now(), repo: r.name };
  try {
    const res = await executeAskOpencode(cfg, opencodeStatus, {
      prompt: args.prompt,
      repoName: r.name,
      repoDir: r.dir,
      timeoutSec,
      model: modelId,
      sessionId: args.session_id,
      continueSession: args.continue_session,
    });
    log(res.logFields);
    auditToolDone("ask_opencode", r.name, res, { prompt: args.prompt });
    return text(res.text, res.isError);
  } finally {
    opencodeBusy = null;
  }
}

const jobStore = new JobStore(cfg, {
  ask_cursor: async (job) => {
    const p = job.params as z.infer<z.ZodObject<typeof askCursorSchema>>;
    const m = p.mode ?? "ask";
    let r: { name: string; dir: string };
    try {
      r = resolveRepo(p.repo);
    } catch (e) {
      return { text: (e as Error).message, isError: true };
    }
    if (m === "agent" && !cfg.allowWrite) {
      return { text: "Agent mode disabled (ALLOW_WRITE!=1)", isError: true };
    }
    const timeoutSec = Math.min(p.timeout_sec ?? 600, cfg.maxTimeoutSec);
    cursorBusy = { since: Date.now(), repo: r.name };
    try {
      const res = await executeAskCursor(cfg, {
        prompt: p.prompt,
        repoName: r.name,
        repoDir: r.dir,
        mode: m,
        timeoutSec,
        model: p.model,
      }, {
        onCancel: (fn) => { job.cancel = fn; },
      });
      log({ ...res.logFields, job_id: job.id });
      auditToolDone("start_ask_cursor", r.name, res, { prompt: p.prompt });
      return { text: res.text, isError: res.isError, truncated: res.truncated };
    } finally {
      cursorBusy = null;
    }
  },
  ask_opencode: async (job) => {
    const p = job.params as z.infer<z.ZodObject<typeof askOpencodeSchema>>;
    let r: { name: string; dir: string };
    try {
      r = resolveRepo(p.repo);
    } catch (e) {
      return { text: (e as Error).message, isError: true };
    }
    const timeoutSec = Math.min(p.timeout_sec ?? 600, cfg.maxTimeoutSec);
    const modelId = p.model ?? opencodeStatus.defaultModel ?? "opencode/glm-5.3-flash-free";
    opencodeBusy = { since: Date.now(), repo: r.name };
    try {
      const res = await executeAskOpencode(cfg, opencodeStatus, {
        prompt: p.prompt,
        repoName: r.name,
        repoDir: r.dir,
        timeoutSec,
        model: modelId,
        sessionId: p.session_id,
        continueSession: p.continue_session,
      }, {
        onCancel: (fn) => { job.cancel = fn; },
      });
      log({ ...res.logFields, job_id: job.id });
      auditToolDone("start_ask_opencode", r.name, res, { prompt: p.prompt });
      return { text: res.text, isError: res.isError, truncated: res.truncated };
    } finally {
      opencodeBusy = null;
    }
  },
});

function buildServer(): McpServer {
  const server = new McpServer({ name: "agent-bridge", version: MCP_VERSION });

  server.registerTool(
    "list_repos",
    {
      title: "List repositories",
      description: "Lists the allowed local repositories (allowlist) and the bridge configuration.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const t0 = Date.now();
      const out = {
        primary_llm: "cursor",
        default_repo: cfg.defaultRepo,
        repos: [...cfg.repos].map(([name, dir]) => ({ name, path: dir, exists: fs.existsSync(dir) })),
        allow_write: cfg.allowWrite,
        git_subcommands: GIT_ALLOWED,
        cursor_busy: cursorBusy !== null,
        opencode_busy: opencodeBusy !== null,
        jobs: {
          async_enabled: true,
          retention_hours: cfg.jobRetentionHours,
          queue: true,
        },
        audit: {
          enabled: cfg.auditEnabled,
          body: cfg.auditBody,
        },
        opencode: {
          available: opencodeStatus.available,
          agent: opencodeStatus.agent ?? cfg.opencodeAgent,
          auto_approve: cfg.opencodeAuto,
          json_format: cfg.opencodeJsonFormat,
          ...(opencodeStatus.defaultModel ? { default_model: opencodeStatus.defaultModel } : {}),
          ...(opencodeStatus.reason ? { reason: opencodeStatus.reason } : {}),
          ...(opencodeStatus.available && !cfg.opencodeAuto ? { headless_hint: OPENCODE_HEADLESS_HINT } : {}),
        },
      };
      log({ tool: "list_repos", repo: null, duration_ms: Date.now() - t0, exit_code: 0 });
      return text(JSON.stringify(out, null, 2));
    }
  );

  server.registerTool(
    "ask_cursor",
    {
      title: "Ask the Cursor CLI",
      description:
        "Runs the Cursor CLI (agent -p) headless in the chosen local repository and returns the answer as text. " +
        "Mode 'ask' (default) is read-only. Mode 'agent' (may edit files) works only if the bridge was started with ALLOW_WRITE=1. " +
        "For long tasks (>~2 min on Grok), use start_ask_cursor + get_job. Only one run at a time.",
      inputSchema: askCursorSchema,
      annotations: { readOnlyHint: !cfg.allowWrite, openWorldHint: true },
    },
    async (args) => runAskCursorSync(args)
  );

  server.registerTool(
    "start_ask_cursor",
    {
      title: "Start a Cursor job (async)",
      description:
        "Queues the same ask_cursor run and returns job_id immediately. Poll with get_job every 10–30s. " +
        "Use for long prompts when the Grok MCP connection times out (~120s).",
      inputSchema: askCursorSchema,
      annotations: { readOnlyHint: !cfg.allowWrite, openWorldHint: true },
    },
    async (args) => {
      const m = args.mode ?? "ask";
      let r: { name: string; dir: string };
      try {
        r = resolveRepo(args.repo);
      } catch (e) {
        return text((e as Error).message, true);
      }
      if (m === "agent" && !cfg.allowWrite) {
        return text("Mode 'agent' disabled (ALLOW_WRITE!=1).", true);
      }
      const { job_id, status } = jobStore.start("ask_cursor", r.name, args);
      return text(
        JSON.stringify(
          {
            job_id,
            status,
            kind: "ask_cursor",
            repo: r.name,
            poll_hint: "Call get_job with job_id every 10–30s until status is done or error.",
          },
          null,
          2
        )
      );
    }
  );

  server.registerTool(
    "ask_opencode",
    {
      title: "Ask OpenCode (optional, basic tasks)",
      description:
        "Optional. Runs `opencode run --agent plan` in the local repository. For long tasks use start_ask_opencode + get_job. " +
        "session_id / continue_session resume sessions (list_opencode_sessions).",
      inputSchema: askOpencodeSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => runAskOpencodeSync(args)
  );

  server.registerTool(
    "start_ask_opencode",
    {
      title: "Start an OpenCode job (async)",
      description: "Queues ask_opencode and returns job_id. Poll with get_job.",
      inputSchema: askOpencodeSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      if (!opencodeStatus.available) {
        return text(`OpenCode unavailable: ${opencodeStatus.reason ?? "not configured"}`, true);
      }
      let r: { name: string; dir: string };
      try {
        r = resolveRepo(args.repo);
      } catch (e) {
        return text((e as Error).message, true);
      }
      const sessErr = validateSessionId(args.session_id);
      if (sessErr) return text(sessErr, true);
      const { job_id, status } = jobStore.start("ask_opencode", r.name, args);
      return text(
        JSON.stringify(
          {
            job_id,
            status,
            kind: "ask_opencode",
            repo: r.name,
            poll_hint: "Call get_job with job_id every 10–30s.",
          },
          null,
          2
        )
      );
    }
  );

  server.registerTool(
    "get_job",
    {
      title: "Get an async job",
      description: "Returns the status and result (when done) of start_ask_cursor or start_ask_opencode.",
      inputSchema: {
        job_id: z.string().min(1).max(64).describe("job_id returned by start_ask_*"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ job_id }) => {
      const job = jobStore.get(job_id);
      if (!job) return text(JSON.stringify({ error: "unknown job_id", job_id }, null, 2), true);
      return text(jobStore.formatGetJob(job), job.status === "error" || job.isError);
    }
  );

  server.registerTool(
    "cancel_job",
    {
      title: "Cancel an async job",
      description: "Cancels a queued job or sends SIGTERM if it is running.",
      inputSchema: {
        job_id: z.string().min(1).max(64),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ job_id }) => {
      const ok = jobStore.cancel(job_id);
      if (!ok) return text(JSON.stringify({ job_id, cancelled: false, message: "Job does not exist or already finished." }, null, 2), true);
      return text(JSON.stringify({ job_id, cancelled: true }, null, 2));
    }
  );

  server.registerTool(
    "list_opencode_sessions",
    {
      title: "List OpenCode sessions",
      description: "Runs `opencode session list` in the chosen repository.",
      inputSchema: {
        repo: z.string().optional().describe("Repo on the allowlist (default: the first one)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ repo }) => {
      if (!opencodeStatus.available || !opencodeStatus.bin) {
        return text(`OpenCode unavailable: ${opencodeStatus.reason ?? "not configured"}`, true);
      }
      let r: { name: string; dir: string };
      try {
        r = resolveRepo(repo);
      } catch (e) {
        return text((e as Error).message, true);
      }
      const listed = listOpencodeSessions(opencodeStatus.bin, r.dir);
      if (!listed.ok) return text(`Failed to list sessions: ${listed.error}`, true);
      return text(`repo: ${r.name}\n${listed.text}`);
    }
  );

  server.registerTool(
    "list_bridge_audit",
    {
      title: "Local audit (metadata)",
      description:
        "Reads the latest lines of the local audit JSONL (no prompt or response body by default). Do not enable BRIDGE_AUDIT_BODY if logs leave the machine.",
      inputSchema: {
        limit: z.number().int().positive().max(50).optional().describe("Maximum entries (default 20)"),
        since_hours: z.number().int().positive().max(720).optional().describe("Keep entries newer than N hours"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ limit, since_hours }) => {
      if (!cfg.auditEnabled) return text("Audit disabled (BRIDGE_AUDIT=0).", true);
      const rows = readAuditTail(cfg, limit ?? 20, since_hours);
      return text(JSON.stringify({ count: rows.length, entries: rows }, null, 2));
    }
  );

  server.registerTool(
    "git_readonly",
    {
      title: "Read-only git",
      description:
        `Runs git in the chosen repository with read-only subcommands only: ${GIT_ALLOWED.join(", ")}. ` +
        "args[0] is the subcommand, e.g. [\"log\",\"--oneline\",\"-20\"], [\"diff\",\"origin/main...HEAD\",\"--stat\"]. Does not spend Cursor credits.",
      inputSchema: {
        repo: z.string().optional().describe("Repo name on the allowlist (default: the first one)"),
        args: z.array(z.string().max(4096)).min(1).max(200).describe("Git arguments; the first is the subcommand"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ repo, args }) => {
      const t0 = Date.now();
      let r: { name: string; dir: string };
      try {
        r = resolveRepo(repo);
      } catch (e) {
        log({ tool: "git_readonly", repo: repo ?? null, duration_ms: 0, exit_code: null, error: "repo" });
        return text((e as Error).message, true);
      }
      const err = validateGitArgs(args);
      if (err) {
        log({ tool: "git_readonly", repo: r.name, subcommand: args[0], duration_ms: Date.now() - t0, exit_code: null, error: "rejected" });
        return text(`Rejected: ${err}`, true);
      }
      const fullArgs = ["--no-pager", "-c", "color.ui=false", "-c", "core.pager=cat", "-c", "protocol.ext.allow=never", ...args];
      const res = await runProcess(cfg.gitBin, fullArgs, {
        cwd: r.dir,
        timeoutMs: cfg.gitTimeoutSec * 1000,
        maxBytes: cfg.maxOutputBytes,
        env: { ...process.env, BRIDGE_TOKEN: undefined, GIT_PAGER: "cat", PAGER: "cat", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
      });
      log({ tool: "git_readonly", repo: r.name, subcommand: args[0], duration_ms: res.durationMs, exit_code: res.code, timed_out: res.timedOut, truncated: res.stdoutTruncated });
      auditRecord(cfg, {
        ts: new Date().toISOString(),
        tool: "git_readonly",
        repo: r.name,
        duration_ms: res.durationMs,
        status: res.code === 0 && !res.timedOut ? "ok" : "error",
        exit_code: res.code,
      });
      if (res.spawnError) return text(`Failed to run git: ${res.spawnError}`, true);
      let out = res.stdout;
      if (res.stdoutTruncated) out += `\n\n[output truncated at ${cfg.maxOutputBytes} bytes — use filters such as --stat, -n, or paths]`;
      if (res.timedOut) return text(`${out}\n[TIMEOUT after ${cfg.gitTimeoutSec}s]\n${res.stderr.slice(-4000)}`, true);
      if (res.code !== 0) return text(`${out}\n[git exited with code ${res.code}]\n--- stderr ---\n${res.stderr.slice(-4000)}`, true);
      return text(out + (res.stderr ? `\n--- stderr ---\n${res.stderr.slice(-2000)}` : "") || "(no output)");
    }
  );

  server.registerTool(
    "read_file",
    {
      title: "Read a repo file",
      description:
        "Reads a text file from the repository (including untracked or gitignored files, e.g. .agents/docs/*.md). " +
        "path is relative to the repo root. Returns a header line (line count, range, encoding) and the raw text. " +
        "Sensitive files (.env, credentials, keys, .git, secrets/) are blocked. Invalid UTF-8 is decoded as windows-1252.",
      inputSchema: {
        repo: z.string().optional().describe("Repo name on the allowlist (default: the first one)"),
        path: z.string().min(1).max(4096).describe("Path relative to the repo root"),
        start_line: z.number().int().positive().optional().describe("First line (1-based, inclusive)"),
        end_line: z.number().int().positive().optional().describe("Last line (inclusive)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ repo, path: rel, start_line, end_line }) => {
      const t0 = Date.now();
      let repoName: string | null = repo ?? null;
      try {
        const r = resolveRepo(repo);
        repoName = r.name;
        const out = files.readFile(r.dir, rel, start_line, end_line);
        log({ tool: "read_file", repo: r.name, path: rel, duration_ms: Date.now() - t0, exit_code: 0 });
        auditRecord(cfg, {
          ts: new Date().toISOString(),
          tool: "read_file",
          repo: r.name,
          duration_ms: Date.now() - t0,
          status: "ok",
        });
        return text(out);
      } catch (e) {
        log({ tool: "read_file", repo: repoName, path: rel, duration_ms: Date.now() - t0, exit_code: null, error: e instanceof BlockedError ? "blocked" : "rejected" });
        return text(`Rejected: ${(e as Error).message}`, true);
      }
    }
  );

  server.registerTool(
    "list_files",
    {
      title: "List repo files",
      description:
        "Lists files and directories (including untracked or gitignored ones) under a repo directory. " +
        "Omits .git and node_modules; does not follow symlinks; sensitive files appear as [blocked] (not read).",
      inputSchema: {
        repo: z.string().optional().describe("Repo name on the allowlist (default: the first one)"),
        dir: z.string().max(4096).optional().describe("Directory relative to the root (default '.')"),
        recursive: z.boolean().optional().describe("List recursively (default false)"),
        max_entries: z.number().int().positive().max(10000).optional().describe("Maximum entries (default 500)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ repo, dir, recursive, max_entries }) => {
      const t0 = Date.now();
      let repoName: string | null = repo ?? null;
      try {
        const r = resolveRepo(repo);
        repoName = r.name;
        const out = files.listFiles(r.dir, dir ?? ".", recursive ?? false, max_entries ?? 500);
        log({ tool: "list_files", repo: r.name, path: dir ?? ".", duration_ms: Date.now() - t0, exit_code: 0 });
        auditRecord(cfg, {
          ts: new Date().toISOString(),
          tool: "list_files",
          repo: r.name,
          duration_ms: Date.now() - t0,
          status: "ok",
        });
        return text(out);
      } catch (e) {
        log({ tool: "list_files", repo: repoName, path: dir ?? ".", duration_ms: Date.now() - t0, exit_code: null, error: "rejected" });
        return text(`Rejected: ${(e as Error).message}`, true);
      }
    }
  );

  return server;
}

const app = express();
app.disable("x-powered-by");

app.get("/healthz", (_req, res) => { res.json({ ok: true }); });

app.use((req: Request, res: Response, next: NextFunction) => {
  if (!tokenOk(req.headers.authorization)) {
    log({ event: "auth_rejected", method: req.method, path: req.path, ip: req.ip });
    res.status(401).set("WWW-Authenticate", 'Bearer realm="agent-bridge"').json({
      jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null,
    });
    return;
  }
  next();
});

app.use(express.json({ limit: "1mb" }));

app.post(cfg.mcpPath, async (req: Request, res: Response) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("[agent-bridge] error handling MCP request:", (e as Error).message);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
  }
});
const methodNotAllowed = (_req: Request, res: Response) => {
  res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server; use POST)" }, id: null });
};
app.get(cfg.mcpPath, methodNotAllowed);
app.delete(cfg.mcpPath, methodNotAllowed);

app.listen(cfg.port, cfg.host, () => {
  log({
    event: "started",
    url: `http://${cfg.host}:${cfg.port}${cfg.mcpPath}`,
    version: MCP_VERSION,
    repos: Object.fromEntries(cfg.repos),
    allow_write: cfg.allowWrite,
    agent_bin: cfg.agentBin,
    opencode_available: opencodeStatus.available,
    audit: cfg.auditEnabled,
    ...(opencodeStatus.bin ? { opencode_bin: opencodeStatus.bin } : {}),
  });
}).on("error", (e) => {
  console.error(`[agent-bridge] could not listen on ${cfg.host}:${cfg.port}: ${e.message}`);
  process.exit(1);
});
