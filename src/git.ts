/** Strict validation of read-only git commands. */

export const GIT_ALLOWED = [
  "log", "diff", "show", "status", "branch", "fetch",
  "rev-parse", "merge-base", "ls-files", "blame", "grep",
] as const;

// Dangerous options on any subcommand (they write files, run external
// programs, or read outside the repository).
const GLOBAL_DENY: RegExp[] = [
  /^--output(=|$)/,          // diff/log/show --output=<file> writes a file
  /^--ext-diff$/,            // runs an external diff
  /^--no-index$/,            // diffs arbitrary files outside the repo
  /^--upload-pack(=|$)/,     // fetch: runs an arbitrary program
  /^--exec(=|$)/,
  /^-O/, /^--open-files-in-pager/, // grep: executa pager
  /^--contents(=|$)/,        // blame: reads an arbitrary file
  /^--config-env/,
];

const BRANCH_WRITE_FLAGS = new Set([
  "-d", "-D", "--delete", "-m", "-M", "--move", "-c", "-C", "--copy", "-f", "--force",
  "-u", "--set-upstream-to", "--unset-upstream", "--edit-description", "--track",
  "--no-track", "--create-reflog", "--recurse-submodules",
]);
const BRANCH_LIST_FLAGS = ["--list", "-l", "--contains", "--no-contains", "--merged", "--no-merged", "--points-at"];

export function validateGitArgs(args: string[]): string | null {
  if (!Array.isArray(args) || args.length === 0) return "empty args: pass the subcommand (e.g. [\"log\", \"-5\"])";
  if (args.length > 200) return "too many args (max 200)";
  for (const a of args) {
    if (typeof a !== "string") return "every arg must be a string";
    if (a.includes("\0")) return "args cannot contain NUL";
  }
  const sub = args[0];
  if (!(GIT_ALLOWED as readonly string[]).includes(sub)) {
    return `git subcommand "${sub}" is not allowed. Allowed: ${GIT_ALLOWED.join(", ")}`;
  }
  const rest = args.slice(1);
  for (const a of rest) {
    if (GLOBAL_DENY.some((re) => re.test(a))) return `option "${a}" is not allowed (it can write, execute, or read outside the repo)`;
  }
  if (sub === "branch") {
    for (const a of rest) {
      const flag = a.split("=")[0];
      if (BRANCH_WRITE_FLAGS.has(flag)) return `git branch ${a} changes branches; not allowed`;
      // combined short flags, e.g. -dr
      if (/^-[A-Za-z]{2,}$/.test(a) && /[dDmMcCfu]/.test(a.slice(1))) return `git branch ${a} is not allowed`;
    }
    const listMode = rest.some((a) => BRANCH_LIST_FLAGS.includes(a.split("=")[0]));
    const positional = rest.filter((a) => !a.startsWith("-"));
    if (positional.length > 0 && !listMode) {
      return "git branch with a positional name would create a branch; use --list <pattern> or --contains <commit>";
    }
  }
  if (sub === "fetch") {
    for (const a of rest) {
      if (!a.startsWith("-") && a.includes(":")) return `refspec "${a}" with ":" is not allowed in fetch (it could overwrite local refs)`;
      if (/^--(refmap|prune-tags|recurse-submodules-default)/.test(a)) return `option "${a}" is not allowed in fetch`;
    }
  }
  return null;
}
