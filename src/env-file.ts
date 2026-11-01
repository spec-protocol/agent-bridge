import path from "node:path";

export const REPO_NAME_RE = /^[A-Za-z0-9._-]+$/;

export interface RepoEntry {
  name: string;
  dir: string;
}

export type AddRepoStatus = "added" | "same-path" | "same-name";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseRepos(raw: string | undefined): RepoEntry[] {
  if (!raw?.trim()) return [];
  const entries: RepoEntry[] = [];
  for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const eq = part.indexOf("=");
    if (eq <= 0) throw new Error(`Invalid REPOS (expected name=/absolute/path): "${part}"`);
    const name = part.slice(0, eq).trim();
    const dir = part.slice(eq + 1).trim();
    if (!REPO_NAME_RE.test(name)) throw new Error(`Invalid repo name: "${name}"`);
    if (!path.isAbsolute(dir)) throw new Error(`Repo "${name}" path must be absolute: "${dir}"`);
    entries.push({ name, dir: path.resolve(dir) });
  }
  return entries;
}

export function formatRepos(entries: RepoEntry[]): string {
  return entries.map((entry) => `${entry.name}=${entry.dir}`).join(",");
}

export function suggestRepoName(dir: string): string {
  const base = path.basename(dir).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (base || "repo").slice(0, 64);
}

export function addRepo(entries: RepoEntry[], name: string, dir: string): { entries: RepoEntry[]; status: AddRepoStatus } {
  if (!REPO_NAME_RE.test(name)) throw new Error(`Invalid repo name: "${name}"`);
  if (!path.isAbsolute(dir)) throw new Error(`Repo "${name}" path must be absolute: "${dir}"`);
  if (dir.includes(",") || dir.includes("\n")) throw new Error("Path cannot contain a comma.");
  const resolved = path.resolve(dir);
  if (entries.some((entry) => entry.dir === resolved)) return { entries, status: "same-path" };
  if (entries.some((entry) => entry.name === name)) return { entries, status: "same-name" };
  return { entries: [...entries, { name, dir: resolved }], status: "added" };
}

export function removeRepo(entries: RepoEntry[], name: string): RepoEntry[] {
  return entries.filter((entry) => entry.name !== name);
}

export function moveRepoFirst(entries: RepoEntry[], name: string): RepoEntry[] {
  const index = entries.findIndex((entry) => entry.name === name);
  if (index <= 0) return entries;
  const next = entries.slice();
  const [picked] = next.splice(index, 1);
  next.unshift(picked);
  return next;
}

export function readEnvKey(content: string, key: string): string | undefined {
  const match = content.match(new RegExp(`^${escapeRegExp(key)}=(.*)$`, "m"));
  return match?.[1];
}

export function upsertEnvKey(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, "m");
  if (pattern.test(content)) return content.replace(pattern, line);
  const base = content.length === 0 || content.endsWith("\n") ? content : `${content}\n`;
  return `${base}${line}\n`;
}
