import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Config } from "./config.js";

export interface AuditEntry {
  ts: string;
  tool: string;
  repo: string | null;
  job_id?: string;
  duration_ms: number;
  status: string;
  exit_code?: number | null;
  prompt_chars?: number;
  response_chars?: number;
  allow_write?: boolean;
  opencode_session_id?: string;
  error?: string;
}

let auditFilePath: string | null = null;

function resolveAuditPath(cfg: Config): string {
  if (cfg.auditDir) return path.join(cfg.auditDir, "audit.jsonl");
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(base, "agent-bridge", "audit.jsonl");
}

let auditDisabled = false;

export function initAudit(cfg: Config): void {
  if (!cfg.auditEnabled) {
    auditFilePath = null;
    return;
  }
  try {
    auditFilePath = resolveAuditPath(cfg);
    fs.mkdirSync(path.dirname(auditFilePath), { recursive: true, mode: 0o700 });
    if (!fs.existsSync(auditFilePath)) {
      fs.writeFileSync(auditFilePath, "", { mode: 0o600 });
    } else {
      try {
        fs.chmodSync(auditFilePath, 0o600);
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    auditDisabled = true;
    auditFilePath = null;
    console.warn(`[warning] audit disabled: ${(e as Error).message}`);
  }
}

const REDACT = /BRIDGE_TOKEN|password\s*=|\.env/i;

function redactBody(s: string, max: number): string {
  let t = s.slice(0, max);
  if (s.length > max) t += "\n[truncado]";
  return t
    .split("\n")
    .map((line) => (REDACT.test(line) ? "[redacted line]" : line))
    .join("\n");
}

export function auditRecord(
  cfg: Config,
  entry: AuditEntry,
  bodies?: { prompt?: string; response?: string }
): void {
  if (!cfg.auditEnabled || auditDisabled || !auditFilePath) return;
  const row: Record<string, unknown> = { ...entry };
  if (cfg.auditBody && bodies?.prompt) row.prompt = redactBody(bodies.prompt, 4096);
  if (cfg.auditBody && bodies?.response) row.response = redactBody(bodies.response, 4096);
  try {
    fs.appendFileSync(auditFilePath, JSON.stringify(row) + "\n", { mode: 0o600 });
  } catch (e) {
    console.error("[agent-bridge] audit append failed:", (e as Error).message);
  }
}

export function readAuditTail(cfg: Config, limit: number, sinceHours?: number): AuditEntry[] {
  if (!cfg.auditEnabled || auditDisabled) return [];
  const file = auditFilePath ?? resolveAuditPath(cfg);
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8");
  const lines = raw.split("\n").filter(Boolean);
  const sinceMs = sinceHours ? Date.now() - sinceHours * 3600_000 : 0;
  const out: AuditEntry[] = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try {
      const e = JSON.parse(lines[i]!) as AuditEntry;
      if (sinceMs && new Date(e.ts).getTime() < sinceMs) continue;
      out.push(e);
    } catch {
      /* skip bad line */
    }
  }
  return out;
}
