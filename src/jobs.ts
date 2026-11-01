import crypto from "node:crypto";
import type { Config } from "./config.js";

export type JobKind = "ask_cursor" | "ask_opencode";
export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface JobRecord {
  id: string;
  kind: JobKind;
  status: JobStatus;
  repo: string;
  params: Record<string, unknown>;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  result?: string;
  isError?: boolean;
  errorMessage?: string;
  truncated?: boolean;
  duration_ms?: number;
  cancel?: () => void;
}

export type JobRunner = (job: JobRecord) => Promise<{ text: string; isError: boolean; truncated?: boolean }>;

export class JobStore {
  private jobs = new Map<string, JobRecord>();
  private cursorQueue: string[] = [];
  private opencodeQueue: string[] = [];
  private cursorRunning = false;
  private opencodeRunning = false;

  constructor(
    private cfg: Config,
    private runners: { ask_cursor: JobRunner; ask_opencode: JobRunner }
  ) {
    setInterval(() => this.purgeOld(), 3600_000).unref();
  }

  private purgeOld(): void {
    const maxAge = this.cfg.jobRetentionHours * 3600_000;
    const now = Date.now();
    for (const [id, j] of this.jobs) {
      if (j.status === "queued" || j.status === "running") continue;
      const t = j.finishedAt ?? j.createdAt;
      if (now - t > maxAge) this.jobs.delete(id);
    }
  }

  start(kind: JobKind, repo: string, params: Record<string, unknown>): { job_id: string; status: JobStatus } {
    const id = `job_${crypto.randomBytes(6).toString("hex")}`;
    const job: JobRecord = {
      id,
      kind,
      status: "queued",
      repo,
      params,
      createdAt: Date.now(),
    };
    this.jobs.set(id, job);
    const q = kind === "ask_cursor" ? this.cursorQueue : this.opencodeQueue;
    q.push(id);
    this.pump(kind);
    return { job_id: id, status: job.status };
  }

  get(id: string): JobRecord | undefined {
    return this.jobs.get(id);
  }

  cancel(id: string): boolean {
    const j = this.jobs.get(id);
    if (!j) return false;
    if (j.status === "done" || j.status === "error" || j.status === "cancelled") return false;
    if (j.status === "running" && j.cancel) {
      j.cancel();
      j.status = "cancelled";
      j.finishedAt = Date.now();
      return true;
    }
    if (j.status === "queued") {
      j.status = "cancelled";
      j.finishedAt = Date.now();
      const q = j.kind === "ask_cursor" ? this.cursorQueue : this.opencodeQueue;
      const idx = q.indexOf(id);
      if (idx >= 0) q.splice(idx, 1);
      return true;
    }
    return false;
  }

  private pump(kind: JobKind): void {
    const running = kind === "ask_cursor" ? this.cursorRunning : this.opencodeRunning;
    if (running) return;
    const q = kind === "ask_cursor" ? this.cursorQueue : this.opencodeQueue;
    while (q.length > 0) {
      const id = q.shift()!;
      const job = this.jobs.get(id);
      if (!job || job.status === "cancelled") continue;
      if (kind === "ask_cursor") this.cursorRunning = true;
      else this.opencodeRunning = true;
      job.status = "running";
      job.startedAt = Date.now();
      void this.runJob(job).finally(() => {
        if (kind === "ask_cursor") this.cursorRunning = false;
        else this.opencodeRunning = false;
        this.pump(kind);
      });
      return;
    }
  }

  private async runJob(job: JobRecord): Promise<void> {
    const runner = this.runners[job.kind];
    try {
      const res = await runner(job);
      if (job.status === "cancelled") return;
      job.result = res.text;
      job.isError = res.isError;
      job.truncated = res.truncated;
      job.status = res.isError ? "error" : "done";
      if (res.isError && !job.errorMessage) job.errorMessage = "execution failed";
    } catch (e) {
      job.status = "error";
      job.errorMessage = (e as Error).message;
      job.result = job.errorMessage;
      job.isError = true;
    } finally {
      job.finishedAt = Date.now();
      job.duration_ms = job.finishedAt - (job.startedAt ?? job.createdAt);
      job.cancel = undefined;
    }
  }

  formatGetJob(job: JobRecord): string {
    const base: Record<string, unknown> = {
      job_id: job.id,
      kind: job.kind,
      status: job.status,
      repo: job.repo,
      created_at: new Date(job.createdAt).toISOString(),
    };
    if (job.status === "queued") {
      return JSON.stringify({ ...base, poll_hint: "Call get_job again in 10–30s." }, null, 2);
    }
    if (job.status === "running") {
      return JSON.stringify(
        {
          ...base,
          elapsed_ms: Date.now() - (job.startedAt ?? job.createdAt),
          poll_hint: "Still running; poll again.",
        },
        null,
        2
      );
    }
    if (job.status === "cancelled") {
      return JSON.stringify({ ...base, message: "Job cancelled." }, null, 2);
    }
    if (job.status === "error" || job.isError) {
      return JSON.stringify(
        {
          ...base,
          duration_ms: job.duration_ms,
          error: job.errorMessage ?? "error",
          result: job.result,
          truncated: job.truncated ?? false,
        },
        null,
        2
      );
    }
    return JSON.stringify(
      {
        ...base,
        status: "done",
        duration_ms: job.duration_ms,
        result: job.result,
        truncated: job.truncated ?? false,
      },
      null,
      2
    );
  }
}
