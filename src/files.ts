/** Read and list files inside the repo, with containment and a denylist. */
import fs from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set([".git", "node_modules"]);

// Patterns applied to the basename (case-insensitive)
const DENY_BASENAME: RegExp[] = [
  /^\.env$/i, /\.env$/i, /^\.env\..*/i,
  /^credentials/i, /secret/i,
  /\.pem$/i, /\.key$/i, /^id_rsa/i, /\.p12$/i, /\.pfx$/i,
  /^\.npmrc$/i, /^\.pypirc$/i,
];

/** Turns a simple glob (*, **, ?) into a RegExp. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") { i++; re += "(?:.*/)?"; } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}

export class FileAccess {
  private extra: { re: RegExp; baseOnly: boolean }[];
  constructor(extraGlobs: string[], private maxReadBytes: number) {
    this.extra = extraGlobs.map((g) => ({ re: globToRegExp(g.replace(/^\.\//, "")), baseOnly: !g.includes("/") }));
  }

  /** rel is a posix path relative to the repo root. Returns a reason when blocked. */
  denyReason(rel: string): string | null {
    const segs = rel.split("/").filter((s) => s && s !== ".");
    if (segs.length === 0) return null;
    if (segs.includes(".git")) return ".git internals";
    if (segs.slice(0, -1).some((s) => s.toLowerCase() === "secrets") || segs[segs.length - 1].toLowerCase() === "secrets") return "secrets directory";
    const base = segs[segs.length - 1];
    if (DENY_BASENAME.some((re) => re.test(base))) return "sensitive file";
    const full = segs.join("/");
    for (const { re, baseOnly } of this.extra) {
      if (re.test(full) || (baseOnly && segs.some((s) => re.test(s)))) return "READ_DENY_GLOBS";
    }
    return null;
  }

  /** Resolves a relative path with containment (realpath). Throws Error when invalid. */
  resolve(rootDir: string, relInput: string): { abs: string; rel: string } {
    if (typeof relInput !== "string" || relInput.includes("\0")) throw new Error("invalid path");
    const input = relInput.trim() === "" ? "." : relInput.trim();
    if (path.isAbsolute(input) || /^[A-Za-z]:[\\/]/.test(input) || input.startsWith("~")) throw new Error("use a path relative to the repo root (absolute paths are not allowed)");
    const segs = input.split(/[\\/]+/);
    if (segs.includes("..")) throw new Error("'..' is not allowed in the path");
    const rootReal = fs.realpathSync(rootDir);
    const joined = path.resolve(rootReal, ...segs);
    const relReq = path.relative(rootReal, joined).split(path.sep).join("/");
    const why = this.denyReason(relReq);
    if (why) throw new BlockedError(`blocked (${why}): ${relReq}`);
    let real: string;
    try { real = fs.realpathSync(joined); } catch { throw new Error(`not found: ${relReq || "."}`); }
    if (real !== rootReal && !real.startsWith(rootReal + path.sep)) throw new Error(`path leaves the repository (symlink?): ${relReq}`);
    const relReal = path.relative(rootReal, real).split(path.sep).join("/");
    const why2 = this.denyReason(relReal);
    if (why2) throw new BlockedError(`blocked (${why2}, via link): ${relReq}`);
    return { abs: real, rel: relReq || "." };
  }

  readFile(rootDir: string, relInput: string, startLine?: number, endLine?: number): string {
    const { abs, rel } = this.resolve(rootDir, relInput);
    const st = fs.statSync(abs);
    if (!st.isFile()) throw new Error(`not a file: ${rel}`);
    if (st.size > this.maxReadBytes) throw new Error(`file too large (${st.size} bytes > MAX_READ_BYTES=${this.maxReadBytes}): ${rel}`);
    const buf = fs.readFileSync(abs);
    if (buf.subarray(0, 8192).includes(0)) throw new Error(`binary file (NUL byte in the first 8KB): ${rel}`);
    let encoding = "utf-8";
    let textAll: string;
    try {
      textAll = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
      encoding = "windows-1252 (bytes were not valid UTF-8)";
      textAll = decode1252(buf);
    }
    if (textAll.charCodeAt(0) === 0xfeff) textAll = textAll.slice(1);
    const lines = textAll.split(/\r?\n/);
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    const total = textAll === "" ? 0 : lines.length;
    const s = startLine ?? 1;
    const e = Math.min(endLine ?? total, total);
    if (s < 1) throw new Error("start_line must be >= 1");
    if (endLine !== undefined && endLine < s) throw new Error("end_line must be >= start_line");
    if (total > 0 && s > total) throw new Error(`start_line ${s} is past the end of the file (${total} lines)`);
    const body = total === 0 ? "" : lines.slice(s - 1, e).join("\n");
    const range = total === 0 ? "empty" : (s === 1 && e === total ? "full" : `lines ${s}-${e}`);
    return `# ${rel} | total lines: ${total} | showing: ${range} | encoding: ${encoding}\n${body}`;
  }

  listFiles(rootDir: string, dirInput: string, recursive: boolean, maxEntries: number): string {
    const { abs, rel } = this.resolve(rootDir, dirInput || ".");
    if (!fs.statSync(abs).isDirectory()) throw new Error(`not a directory: ${rel}`);
    const rootReal = fs.realpathSync(rootDir);
    const out: string[] = [];
    let truncated = false;
    const walk = (dirAbs: string) => {
      let ents: fs.Dirent[];
      try { ents = fs.readdirSync(dirAbs, { withFileTypes: true }); } catch (e) { out.push(`${path.relative(rootReal, dirAbs)}/ [error: ${(e as Error).message}]`); return; }
      ents.sort((a, b) => a.name.localeCompare(b.name));
      for (const ent of ents) {
        if (out.length >= maxEntries) { truncated = true; return; }
        if (SKIP_DIRS.has(ent.name)) continue;
        const entAbs = path.join(dirAbs, ent.name);
        const entRel = path.relative(rootReal, entAbs).split(path.sep).join("/");
        let blocked = this.denyReason(entRel) !== null;
        if (ent.isSymbolicLink()) {
          let note = "";
          try {
            const real = fs.realpathSync(entAbs);
            const inside = real === rootReal || real.startsWith(rootReal + path.sep);
            note = inside ? "" : " [outside the repo]";
            if (inside && this.denyReason(path.relative(rootReal, real).split(path.sep).join("/"))) blocked = true;
          } catch { note = " [broken]"; }
          out.push(`${entRel} -> (link)${note}${blocked ? " [blocked]" : ""}`);
          continue; // listing does not follow links
        }
        if (ent.isDirectory()) {
          out.push(`${entRel}/${blocked ? " [blocked]" : ""}`);
          if (recursive && !blocked) walk(entAbs);
        } else {
          if (blocked) { out.push(`${entRel} [blocked]`); continue; }
          let size = "";
          try { size = ` (${fs.statSync(entAbs).size} B)`; } catch { /* ignore */ }
          out.push(`${entRel}${size}`);
        }
        if (truncated) return;
      }
    };
    walk(abs);
    const head = `# ${rel}/ | ${out.length} entries${recursive ? " (recursive)" : ""}${truncated ? ` | TRUNCATED at max_entries=${maxEntries}` : ""} | .git and node_modules omitted`;
    return `${head}\n${out.join("\n")}`;
  }
}

export class BlockedError extends Error {}

// Fallback when Node has no ICU windows-1252.
const CP1252_80_9F = [0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178];
function decode1252(buf: Buffer): string {
  try { return new TextDecoder("windows-1252").decode(buf); } catch { /* no ICU */ }
  let s = "";
  for (const b of buf) s += String.fromCharCode(b >= 0x80 && b <= 0x9f ? CP1252_80_9F[b - 0x80] : b);
  return s;
}
