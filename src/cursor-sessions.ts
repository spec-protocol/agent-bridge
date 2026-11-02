import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { stripAnsi } from "./opencode.js";

const require = createRequire(import.meta.url);

export const CURSOR_SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_JSONL_BYTES = 2 * 1024 * 1024;
const LIST_TIMEOUT_MS = 5000;

export interface CursorSessionSummary {
  session_id: string;
  name: string;
  mode: string;
  created_at: string;
  updated_at: string;
  has_conversation: boolean;
}

export interface ListCursorSessionsResult {
  sessions: CursorSessionSummary[];
  note?: string;
}

export interface ReadCursorSessionResult {
  ok: true;
  session_id: string;
  repo_dir: string;
  lines: string[];
  truncated: boolean;
  total_messages: number;
  offset: number;
  returned: number;
}

export interface ReadCursorSessionMissingTranscript {
  ok: false;
  missing_transcript: true;
  session_id: string;
  message: string;
}

export type ReadCursorSessionOutput = ReadCursorSessionResult | ReadCursorSessionMissingTranscript;

export function validateCursorSessionId(sessionId: string | undefined): string | null {
  if (sessionId === undefined || sessionId === "") return null;
  if (!CURSOR_SESSION_ID_RE.test(sessionId)) {
    return `invalid session_id (expected Cursor chat UUID): "${sessionId}"`;
  }
  return null;
}

export function cursorDataRoot(override?: string): string {
  if (override?.trim()) return override.trim();
  const fromEnv = process.env.CURSOR_DATA_DIR?.trim();
  if (fromEnv) return fromEnv;
  return path.join(os.homedir(), ".cursor");
}

export interface CursorStorageRoots {
  cursorRoot?: string;
  cursorChatsRoot?: string;
  cursorProjectsRoot?: string;
}

function resolveChatsRoot(opts?: CursorStorageRoots): string {
  if (opts?.cursorChatsRoot?.trim()) return opts.cursorChatsRoot.trim();
  if (opts?.cursorRoot?.trim()) return opts.cursorRoot.trim();
  const fromEnv = process.env.CURSOR_CONFIG_DIR?.trim();
  if (fromEnv) return fromEnv;
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return path.join(xdg, "cursor");
  return path.join(os.homedir(), ".cursor");
}

function resolveProjectsRoot(opts?: CursorStorageRoots): string {
  if (opts?.cursorProjectsRoot?.trim()) return opts.cursorProjectsRoot.trim();
  if (opts?.cursorRoot?.trim()) return opts.cursorRoot.trim();
  return cursorDataRoot();
}

export function chatWorkspaceHash(repoDir: string): string {
  const resolved = path.resolve(repoDir);
  return crypto.createHash("md5").update(resolved).digest("hex");
}

export function projectSlug(repoDir: string): string {
  return path
    .resolve(repoDir)
    .replace(/[^a-zA-Z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function pathsEqual(a: string, b: string): boolean {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

function decodeIndexValue(raw: string): Record<string, unknown> | null {
  try {
    let text = raw;
    if (/^[0-9a-f]+$/i.test(raw) && raw.length >= 2 && raw.length % 2 === 0) {
      text = Buffer.from(raw, "hex").toString("utf8");
    }
    const obj = JSON.parse(text) as Record<string, unknown>;
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

type SqliteDb = {
  prepare: (sql: string) => { get: (...args: unknown[]) => unknown };
  close: () => void;
};

function openSqliteReadonly(dbPath: string): SqliteDb | null {
  try {
    const mod = require("node:sqlite") as { DatabaseSync: new (p: string, o?: { readOnly?: boolean }) => SqliteDb };
    return new mod.DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return null;
  }
}

function readSessionIndex(sessionDir: string): { index: Record<string, unknown> | null; sqlite: boolean } {
  const dbPath = path.join(sessionDir, "store.db");
  if (!fs.existsSync(dbPath)) return { index: null, sqlite: false };
  const db = openSqliteReadonly(dbPath);
  if (!db) return { index: null, sqlite: false };
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = '0'").get() as { value?: string } | undefined;
    const index = row?.value ? decodeIndexValue(String(row.value)) : null;
    return { index, sqlite: true };
  } catch {
    return { index: null, sqlite: true };
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}

function readMetaJson(sessionDir: string): {
  cwd?: string;
  createdAtMs?: number;
  updatedAtMs?: number;
  hasConversation?: boolean;
} {
  const metaPath = path.join(sessionDir, "meta.json");
  if (!fs.existsSync(metaPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf8")) as {
      cwd?: string;
      createdAtMs?: number;
      updatedAtMs?: number;
      hasConversation?: boolean;
    };
  } catch {
    return {};
  }
}

function isoFromMs(ms: number | undefined, fallback: string): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return fallback;
  return new Date(ms).toISOString();
}

function isSubagent(index: Record<string, unknown> | null): boolean {
  return Boolean(index?.subagentInfo);
}

export function listCursorSessions(
  repoDir: string,
  opts?: { limit?: number; listTimeoutMs?: number } & CursorStorageRoots
): ListCursorSessionsResult {
  const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 100);
  const timeoutMs = opts?.listTimeoutMs ?? LIST_TIMEOUT_MS;
  const root = resolveChatsRoot(opts);
  const chatRoot = path.join(root, "chats", chatWorkspaceHash(repoDir));
  if (!fs.existsSync(chatRoot)) return { sessions: [] };

  const started = Date.now();
  const entries: CursorSessionSummary[] = [];
  let sawSqlite = false;
  let usedFallback = false;
  let timedOut = false;

  for (const name of fs.readdirSync(chatRoot)) {
    if (Date.now() - started >= timeoutMs) {
      timedOut = true;
      break;
    }
    const sessionDir = path.join(chatRoot, name);
    if (!fs.statSync(sessionDir).isDirectory()) continue;
    if (!CURSOR_SESSION_ID_RE.test(name)) continue;

    const meta = readMetaJson(sessionDir);
    if (meta.cwd && !pathsEqual(meta.cwd, repoDir)) continue;

    const { index, sqlite } = readSessionIndex(sessionDir);
    if (sqlite) sawSqlite = true;
    else usedFallback = true;
    if (index && isSubagent(index)) continue;

    const createdMs =
      typeof meta.createdAtMs === "number"
        ? meta.createdAtMs
        : typeof index?.createdAt === "number"
          ? (index.createdAt as number)
          : undefined;
    const updatedMs = typeof meta.updatedAtMs === "number" ? meta.updatedAtMs : createdMs;
    const createdIso = isoFromMs(createdMs, "1970-01-01T00:00:00.000Z");
    const updatedIso = isoFromMs(updatedMs, createdIso);

    entries.push({
      session_id: name,
      name: typeof index?.name === "string" ? index.name : "(unknown)",
      mode: typeof index?.mode === "string" ? index.mode : "unknown",
      created_at: createdIso,
      updated_at: updatedIso,
      has_conversation: meta.hasConversation === true,
    });
  }

  entries.sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
  const sessions = entries.slice(0, limit);
  const notes: string[] = [];
  if (timedOut) {
    notes.push("Listing stopped after the time limit; the list may be incomplete.");
  }
  if (usedFallback && !sawSqlite) {
    notes.push("SQLite index unavailable: name, mode, and subagent filtering may be incomplete.");
  }
  const note = notes.length ? notes.join(" ") : undefined;
  return { sessions, note };
}

function transcriptPath(cursorRoot: string, repoDir: string, sessionId: string): string {
  const slug = projectSlug(repoDir);
  return path.join(cursorRoot, "projects", slug, "agent-transcripts", sessionId, `${sessionId}.jsonl`);
}

export function sessionDirForRepo(
  repoDir: string,
  sessionId: string,
  opts?: CursorStorageRoots
): string | null {
  const err = validateCursorSessionId(sessionId);
  if (err) return null;
  const root = resolveChatsRoot(opts);
  const dir = path.join(root, "chats", chatWorkspaceHash(repoDir), sessionId);
  if (!fs.existsSync(dir)) return null;
  const meta = readMetaJson(dir);
  if (meta.cwd && !pathsEqual(meta.cwd, repoDir)) return null;
  const { index } = readSessionIndex(dir);
  if (index && isSubagent(index)) return null;
  return dir;
}

function formatJsonlMessage(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const role = (obj as { role?: string }).role;
  if (role !== "user" && role !== "assistant") return null;
  const message = (obj as { message?: { content?: unknown } }).message;
  const content = message?.content;
  const parts: string[] = [];
  if (typeof content === "string") {
    parts.push(stripAnsi(content).trim());
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const p = part as { type?: string; text?: string; name?: string };
      if (p.type === "text" && typeof p.text === "string") {
        parts.push(stripAnsi(p.text).trim());
      } else if (p.type === "tool_use" && typeof p.name === "string") {
        parts.push(`[tool: ${p.name}]`);
      }
    }
  }
  const body = parts.filter(Boolean).join("\n").trim();
  if (!body) return null;
  return `[${role}] ${body}`;
}

export function readCursorSession(
  repoDir: string,
  sessionId: string,
  opts?: { offset?: number; limit?: number; maxChars?: number } & CursorStorageRoots
): ReadCursorSessionOutput | { ok: false; error: string } {
  const err = validateCursorSessionId(sessionId);
  if (err) return { ok: false, error: err };

  const sessionDir = sessionDirForRepo(repoDir, sessionId, opts);
  if (!sessionDir) {
    return { ok: false, error: `Session "${sessionId}" was not found for this repository.` };
  }

  const root = resolveProjectsRoot(opts);
  const jsonlPath = transcriptPath(root, repoDir, sessionId);
  if (!fs.existsSync(jsonlPath)) {
    return {
      ok: false,
      missing_transcript: true,
      session_id: sessionId,
      message:
        "No text transcript is available for this session (JSONL missing). You can still resume it with ask_cursor or start_ask_cursor using this session_id.",
    };
  }

  const stat = fs.statSync(jsonlPath);
  if (stat.size > MAX_JSONL_BYTES) {
    return { ok: false, error: `Transcript file is too large (${stat.size} bytes).` };
  }

  const raw = fs.readFileSync(jsonlPath, "utf8");
  const messages: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const formatted = formatJsonlMessage(JSON.parse(line));
      if (formatted) messages.push(formatted);
    } catch {
      /* skip bad lines */
    }
  }

  const offset = Math.max(opts?.offset ?? 0, 0);
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const maxChars = Math.min(Math.max(opts?.maxChars ?? 32_000, 256), 200_000);
  const slice = messages.slice(offset, offset + limit);

  let truncated = false;
  const lines: string[] = [];
  let used = 0;
  for (let i = 0; i < slice.length; i++) {
    const numbered = `${offset + i + 1}. ${slice[i]}`;
    if (used + numbered.length + 1 > maxChars) {
      truncated = true;
      break;
    }
    lines.push(numbered);
    used += numbered.length + 1;
  }

  if (offset + limit < messages.length && lines.length === slice.length) {
    truncated = true;
  }

  return {
    ok: true,
    session_id: sessionId,
    repo_dir: repoDir,
    lines,
    truncated,
    total_messages: messages.length,
    offset,
    returned: lines.length,
  };
}
