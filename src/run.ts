import { spawn, type ChildProcess } from "node:child_process";

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  timedOut: boolean;
  spawnError?: string;
  durationMs: number;
}

/** Runs a binary without a shell (raw argv), with a timeout and an output cap. */
export function runProcess(
  bin: string,
  args: string[],
  opts: {
    cwd: string;
    timeoutMs: number;
    maxBytes: number;
    env?: NodeJS.ProcessEnv;
    onSpawn?: (child: ChildProcess, killTree: (sig: NodeJS.Signals) => void) => void;
  }
): Promise<RunResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let stdoutTruncated = false;
    let timedOut = false;
    let settled = false;
    const errTail = 16_000;

    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      shell: false,
      detached: true, // own process group, so children die on timeout
      stdio: ["ignore", "pipe", "pipe"],
    });

    const killTree = (sig: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, sig);
      } catch {
        try { child.kill(sig); } catch { /* ignore */ }
      }
    };

    opts.onSpawn?.(child, killTree);

    child.stdout.on("data", (d: Buffer) => {
      if (stdout.length >= opts.maxBytes) { stdoutTruncated = true; return; }
      const room = opts.maxBytes - stdout.length;
      if (d.length > room) { stdoutTruncated = true; d = d.subarray(0, room); }
      stdout = Buffer.concat([stdout, d]);
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr = Buffer.concat([stderr, d]);
      if (stderr.length > errTail * 2) stderr = stderr.subarray(stderr.length - errTail);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      killTree("SIGTERM");
      setTimeout(() => killTree("SIGKILL"), 5000).unref();
    }, opts.timeoutMs);

    const finish = (code: number | null, signal: NodeJS.Signals | null, spawnError?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code, signal, spawnError, timedOut, stdoutTruncated,
        stdout: stdout.toString("utf8"),
        stderr: stderr.subarray(Math.max(0, stderr.length - errTail)).toString("utf8"),
        durationMs: Date.now() - start,
      });
    };
    child.on("error", (e) => finish(null, null, e.message));
    child.on("close", (code, signal) => finish(code, signal));
  });
}
