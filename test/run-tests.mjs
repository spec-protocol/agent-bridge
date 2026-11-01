// Teste local: sobe o bridge com um `agent` falso no PATH e um repo git temporário.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

function reportedCwdIs(text, dir) {
  const m = text.match(/^(?:FAKE_AGENT|FAKE_OPENCODE) cwd=(.+)$/m);
  if (!m) return false;
  try {
    return fs.realpathSync(m[1].trim()) === fs.realpathSync(dir);
  } catch {
    return m[1].trim() === dir;
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-bridge-test-"));
const bin = path.join(tmp, "bin");
const repo = path.join(tmp, "demo-repo");
fs.mkdirSync(bin); fs.mkdirSync(repo);
fs.copyFileSync(path.join(here, "fake-agent.sh"), path.join(bin, "agent"));
fs.chmodSync(path.join(bin, "agent"), 0o755);
const g = (...a) => execFileSync("git", a, { cwd: repo, encoding: "utf8" });
g("init", "-q", "-b", "main");
g("config", "user.email", "t@example.com"); g("config", "user.name", "Teste");
fs.writeFileSync(path.join(repo, "README.md"), "hello\n");
g("add", "."); g("commit", "-q", "-m", "primeiro commit");
fs.writeFileSync(path.join(repo, "README.md"), "hello\nworld\n");
g("commit", "-qam", "segundo commit");
// arquivos não versionados / gitignored para read_file/list_files
fs.writeFileSync(path.join(repo, ".gitignore"), ".agents/\n");
const mk = (rel, data) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), data); };
mk(".agents/docs/convencoes-e-diretrizes/diffs.md", "# Diretrizes\nlinha 2\nlinha 3\nlinha 4\nlinha 5\n");
mk(".agents/skills/review/SKILL.md", "---\nname: review\n---\n");
mk(".agents/rules/php.mdc", "regra\n");
mk(".agents/docs/legado-1252.md", Buffer.from([0x41, 0xe7, 0xe3, 0x6f, 0x20, 0x80, 0x0a])); // "Ação €" em cp1252
mk("credentials.env", "PASS=x\n");
mk(".env", "TOKEN=x\n");
mk("config/.env.local", "x\n");
mk("secrets/db.txt", "x\n");
mk("keys/server.pem", "x\n");
mk("dump.sql", "x\n");
mk("logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x01]));
mk("big.txt", "a".repeat(6000));
mk("node_modules/pkg/index.js", "x\n");
const outside = path.join(tmp, "fora.txt"); fs.writeFileSync(outside, "segredo de fora\n");
fs.symlinkSync(outside, path.join(repo, "link-fora.txt"));
fs.symlinkSync("/etc", path.join(repo, "link-etc"));
fs.symlinkSync(".env", path.join(repo, "link-env.txt"));
fs.symlinkSync(".agents/rules/php.mdc", path.join(repo, "link-ok.mdc"));

const PORT = 18787 + Math.floor(Math.random() * 1000);
const TOKEN = execFileSync("openssl", ["rand", "-hex", "32"], { encoding: "utf8" }).trim();
const URL_ = `http://127.0.0.1:${PORT}/mcp`;

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
};

const { addRepo, formatRepos, parseRepos, suggestRepoName, upsertEnvKey } = await import(path.join(root, "dist/env-file.js"));
{
  const added = addRepo([], "app", "/tmp/agent-bridge-app");
  check("addRepo inclui caminho absoluto", added.status === "added" && added.entries.length === 1);
  check("addRepo mesmo caminho não reescreve", addRepo(added.entries, "outro", "/tmp/agent-bridge-app").status === "same-path");
  check("addRepo mesmo nome não reescreve", addRepo(added.entries, "app", "/tmp/agent-bridge-outro").status === "same-name");
  let invalid = false;
  try { addRepo([], "nome ruim", "/tmp/agent-bridge-app"); } catch { invalid = true; }
  check("addRepo recusa nome inválido", invalid);
  check("suggestRepoName sanitiza", suggestRepoName("/tmp/Meu Repo!") === "Meu-Repo");
  const envIn = "# nota\nPORT=1\nREPOS=demo=/tmp/demo\n";
  const envOut = upsertEnvKey(envIn, "REPOS", formatRepos(added.entries));
  check("upsert preserva comentário", envOut.startsWith("# nota\n") && envOut.includes("PORT=1"));
  check("upsert troca REPOS", parseRepos(envOut.match(/^REPOS=(.*)$/m)[1])[0].name === "app");
}

const { machOAcceptable, resolveCursorAgent, resolveOpencodeBin } = await import(path.join(root, "dist/prereqs.js"));
const { bootstrapEnvContent, homePointerExists, prepareMachine, skillDest } = await import(path.join(root, "dist/machine-setup.js"));
const { envBackupPath, restoreEnvBackup, writeEnvFile } = await import(path.join(root, "dist/install-home.js"));
{
  check("machO aceita script", machOAcceptable("Bourne-Again shell script text executable", "arm64"));
  check("machO aceita universal", machOAcceptable("Mach-O universal binary", "x86_64"));
  check("machO aceita arm64 na máquina arm64", machOAcceptable("Mach-O 64-bit executable arm64", "arm64"));
  check("machO recusa arm64 na máquina x86_64", !machOAcceptable("Mach-O 64-bit executable arm64", "x86_64"));

  const missing = {
    which: () => null,
    isExecutable: () => false,
    fileInfo: () => "",
    machine: () => "arm64",
    platform: () => "darwin",
  };
  const noAgent = resolveCursorAgent(missing);
  check("Cursor ausente falha", noAgent.ok === false && noAgent.reason.includes("agent"));

  const scriptBin = "/tmp/agent-bridge-fake-agent";
  const darwinScript = {
    which: (name) => (name === "agent" ? scriptBin : null),
    isExecutable: (file) => file === scriptBin,
    fileInfo: () => "POSIX shell script text executable",
    machine: () => "arm64",
    platform: () => "darwin",
  };
  const found = resolveCursorAgent(darwinScript);
  check("Cursor script no macOS passa", found.ok === true && found.bin === scriptBin);

  const foreign = {
    ...darwinScript,
    fileInfo: () => "Mach-O 64-bit executable x86_64",
    machine: () => "arm64",
  };
  const wrongArch = resolveCursorAgent(foreign);
  check("Cursor de outra arquitetura falha", wrongArch.ok === false && wrongArch.reason.includes("is not native"));

  const linux = { ...darwinScript, platform: () => "linux", fileInfo: () => "Mach-O 64-bit executable x86_64" };
  check("Linux não aplica a checagem Mach-O", resolveCursorAgent(linux).ok === true);

  const home = path.join(tmp, "opencode-home");
  const oc = path.join(home, ".opencode", "bin", "opencode");
  check(
    "OpenCode no fallback da home",
    resolveOpencodeBin({ ...missing, isExecutable: (file) => file === oc }, undefined, home) === oc
  );
  check("OpenCode ausente não bloqueia", resolveOpencodeBin(missing, undefined, home) === null);

  const example = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  const token = "a".repeat(64);
  const envBody = bootstrapEnvContent(example, "/usr/local/bin/agent", token);
  check("bootstrap grava o token sem o placeholder", envBody.includes(`BRIDGE_TOKEN=${token}`) && !envBody.includes("REPLACE_WITH_GENERATED_TOKEN") && !envBody.includes("COLE_AQUI"));
  check("bootstrap grava AGENT_BIN", envBody.includes("AGENT_BIN=/usr/local/bin/agent"));

  const fakeHome = path.join(tmp, "home");
  const fakePkg = path.join(tmp, "pkg");
  fs.mkdirSync(path.join(fakePkg, "skills", "agent-bridge"), { recursive: true });
  fs.writeFileSync(path.join(fakePkg, ".env.example"), example);
  fs.copyFileSync(path.join(root, "skills", "agent-bridge", "SKILL.md"), path.join(fakePkg, "skills", "agent-bridge", "SKILL.md"));
  let spawned = "";
  prepareMachine({
    homeDir: fakeHome,
    packageRoot: fakePkg,
    agentBin: "/usr/local/bin/agent",
    token,
    platform: "darwin",
    spawnSetup: (script) => { spawned = script; },
  });
  const written = fs.readFileSync(path.join(fakePkg, ".env"), "utf8");
  check("prepare cria .env com token", written.includes(`BRIDGE_TOKEN=${token}`) && !written.includes("REPLACE_WITH_GENERATED_TOKEN") && !written.includes("COLE_AQUI"));
  check("prepare não imprime o token no ponteiro", fs.readFileSync(path.join(fakeHome, ".agent-bridge", "home"), "utf8").trim() === fakePkg);
  check("prepare copia a skill global", fs.existsSync(skillDest(fakeHome)));
  check("prepare chama o launchd", spawned.endsWith(`${path.sep}scripts${path.sep}darwin${path.sep}setup-launchd.sh`));
  check("home pointer passa a existir", homePointerExists(fakeHome));
  check(".env fica 600", (fs.statSync(path.join(fakePkg, ".env")).mode & 0o777) === 0o600);
  check("skill copiada não contém o token", !fs.readFileSync(skillDest(fakeHome), "utf8").includes(token));
  check("prepare copia o .env para fora do pacote", fs.readFileSync(path.join(fakeHome, ".agent-bridge", "env"), "utf8").includes(`BRIDGE_TOKEN=${token}`));

  const kept = "b".repeat(64);
  fs.writeFileSync(path.join(fakePkg, ".env"), `BRIDGE_TOKEN=${kept}\n`, { mode: 0o600 });
  prepareMachine({
    homeDir: fakeHome,
    packageRoot: fakePkg,
    agentBin: "/usr/local/bin/agent",
    token: "c".repeat(64),
    platform: "darwin",
    spawnSetup: () => {},
  });
  check("prepare preserva .env existente", fs.readFileSync(path.join(fakePkg, ".env"), "utf8").includes(`BRIDGE_TOKEN=${kept}`));
  check("prepare atualiza a cópia sem trocar o token", fs.readFileSync(path.join(fakeHome, ".agent-bridge", "env"), "utf8").includes(`BRIDGE_TOKEN=${kept}`));

  const linuxHome = path.join(tmp, "home-linux");
  const linuxPkg = path.join(tmp, "pkg-linux");
  fs.mkdirSync(path.join(linuxPkg, "skills", "agent-bridge"), { recursive: true });
  fs.writeFileSync(path.join(linuxPkg, ".env.example"), example);
  fs.copyFileSync(path.join(root, "skills", "agent-bridge", "SKILL.md"), path.join(linuxPkg, "skills", "agent-bridge", "SKILL.md"));
  let linuxSpawned = "";
  prepareMachine({
    homeDir: linuxHome,
    packageRoot: linuxPkg,
    agentBin: "/usr/bin/agent",
    token,
    platform: "linux",
    spawnSetup: (script) => { linuxSpawned = script; },
  });
  check("prepare no Linux chama systemd", linuxSpawned.endsWith(`${path.sep}scripts${path.sep}setup-systemd.sh`));

  const winHome = path.join(tmp, "home-win");
  let winSpawned = false;
  let winThrew = false;
  try {
    prepareMachine({
      homeDir: winHome,
      packageRoot: fakePkg,
      agentBin: "/usr/local/bin/agent",
      token,
      platform: "win32",
      spawnSetup: () => { winSpawned = true; },
    });
  } catch {
    winThrew = true;
  }
  check("prepare em outra plataforma falha sem subir serviço", winThrew && !winSpawned && !homePointerExists(winHome));

  const failHome = path.join(tmp, "home-fail");
  const failPkg = path.join(tmp, "pkg-fail");
  fs.mkdirSync(path.join(failPkg, "skills", "agent-bridge"), { recursive: true });
  fs.writeFileSync(path.join(failPkg, ".env.example"), example);
  fs.copyFileSync(path.join(root, "skills", "agent-bridge", "SKILL.md"), path.join(failPkg, "skills", "agent-bridge", "SKILL.md"));
  let failThrew = false;
  try {
    prepareMachine({
      homeDir: failHome,
      packageRoot: failPkg,
      agentBin: "/usr/local/bin/agent",
      token,
      platform: "darwin",
      spawnSetup: () => { throw new Error("setup falhou"); },
    });
  } catch {
    failThrew = true;
  }
  check("falha do serviço não grava o ponteiro", failThrew && !homePointerExists(failHome));

  const skillText = fs.readFileSync(path.join(root, "skills", "agent-bridge", "SKILL.md"), "utf8");
  check(
    "skill pede a URL e o guia",
    skillText.includes("unpkg.com/@spec-protocol/agent-bridge@") &&
      skillText.includes("docs/public/grok.md") &&
      skillText.includes("Do not open `.env`")
  );
  check("skill não traz URL real", !/https:\/\/[a-z0-9-]+\.trycloudflare\.com/.test(skillText));

  const guide = fs.readFileSync(path.join(root, "docs", "public", "grok.md"), "utf8");
  const tools = ["list_repos", "ask_cursor", "start_ask_cursor", "ask_opencode", "start_ask_opencode", "get_job", "cancel_job", "list_opencode_sessions", "git_readonly", "read_file", "list_files", "list_bridge_audit"];
  check("guia tem as 12 tools e o campo protegido", tools.every((name) => guide.includes(name)) && guide.includes("campo protegido") && guide.includes("protected field") && guide.includes("~/.agent-bridge/home") && guide.includes("nunca no chat") && guide.includes("never in chat"));
  check("guia não traz host real", !/https:\/\/[a-z0-9-]+\.trycloudflare\.com/.test(guide));

  for (const readme of ["README.md", path.join("docs", "public", "README.md")]) {
    const text = fs.readFileSync(path.join(root, readme), "utf8");
    check(
      `${readme} descreve os três passos`,
      text.includes("npm install -g @spec-protocol/agent-bridge") &&
        text.includes("agent-bridge init") &&
        text.includes("/agent-bridge") &&
        text.includes("cole só esse output") &&
        text.includes("paste only that output") &&
        text.includes("npm publish") &&
        !text.includes("cole a URL deste repositório")
    );
  }

  const reconnect = fs.readFileSync(path.join(root, "scripts", "grok-reconnect.sh"), "utf8");
  check("reconnect não interpola o caminho", reconnect.includes("process.env.INSTALL_DIR") && !reconnect.includes("require('${INSTALL_DIR}"));
  check("reconnect não cita 6 tools", !reconnect.includes("6 tools"));
  check(
    "reconnect cita o guia sem a lista de tools",
    reconnect.includes("unpkg.com/@spec-protocol/agent-bridge@") &&
      reconnect.includes("docs/public/grok.md") &&
      reconnect.includes("did not change") &&
      !reconnect.includes("recarregue as 12 tools")
  );

  const backupHome = path.join(tmp, "backup-home");
  const backupPkg = path.join(tmp, "backup-pkg");
  fs.mkdirSync(backupPkg);
  const tokenLine = `BRIDGE_TOKEN=${"d".repeat(64)}\n`;
  writeEnvFile(backupPkg, tokenLine, backupHome);
  const backupFile = envBackupPath(backupHome);
  check("writeEnvFile copia o .env", fs.readFileSync(backupFile, "utf8") === tokenLine);
  check("cópia do .env fica 600", (fs.statSync(backupFile).mode & 0o777) === 0o600);
  fs.rmSync(path.join(backupPkg, ".env"));
  check(
    "restore devolve a cópia",
    restoreEnvBackup(backupPkg, backupHome) === true &&
      fs.readFileSync(path.join(backupPkg, ".env"), "utf8") === tokenLine
  );
  fs.writeFileSync(path.join(backupPkg, ".env"), "BRIDGE_TOKEN=mantido\n");
  check(
    "restore não sobrescreve .env existente",
    restoreEnvBackup(backupPkg, backupHome) === false &&
      fs.readFileSync(path.join(backupPkg, ".env"), "utf8").includes("mantido")
  );
}

const { buildOpencodeArgs, opencodeAgentListIncludes, parseOpencodeJsonOutput } = await import(path.join(root, "dist/opencode.js"));
check(
  "buildOpencodeArgs inclui --agent plan (json default)",
  JSON.stringify(buildOpencodeArgs("p", repo, "opencode/x", false, "plan")) ===
    JSON.stringify(["run", "--format", "json", "--dir", repo, "-m", "opencode/x", "--agent", "plan", "p"])
);
check(
  "buildOpencodeArgs --session e --continue",
  JSON.stringify(
    buildOpencodeArgs("p", repo, "m", true, "plan", { sessionId: "ses_abc123", continueSession: true, jsonFormat: false })
  ) === JSON.stringify(["run", "--format", "default", "--dir", repo, "-m", "m", "--agent", "plan", "--continue", "--session", "ses_abc123", "--auto", "p"])
);
const parsed = parseOpencodeJsonOutput('{"sessionID":"ses_x","type":"text","text":"ola"}\n');
check("parseOpencodeJsonOutput NDJSON", parsed.text === "ola" && parsed.sessionId === "ses_x");
check("opencodeAgentListIncludes plan", opencodeAgentListIncludes("build (primary)\nplan (primary)\n", "plan"));

// 0) sem token não sobe
{
  const r = spawn(process.execPath, [path.join(root, "dist/index.js")], { env: { ...process.env, BRIDGE_TOKEN: "" } });
  const code = await new Promise((res) => r.on("close", res));
  check("recusa iniciar sem BRIDGE_TOKEN (exit!=0)", code !== 0, `code=${code}`);
}

const fakeAgent = path.join(bin, "agent");
const testBridgeEnv = (extra) => {
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, AGENT_BIN: fakeAgent, ...extra };
  delete env.CURSOR_MODEL;
  delete env.CURSOR_SANDBOX;
  return env;
};
const srv = spawn(process.execPath, [path.join(root, "dist/index.js")], {
  env: testBridgeEnv({
    BRIDGE_TOKEN: TOKEN,
    PORT: String(PORT),
    REPOS: `demo=${repo}`,
    MAX_OUTPUT_BYTES: "100000",
    MAX_READ_BYTES: "5000",
    READ_DENY_GLOBS: "*.sql,private/**",
    OPENCODE_DISABLE: "1",
    BRIDGE_AUDIT_DIR: path.join(tmp, "audit"),
  }),
});
let logs = "";
srv.stdout.on("data", (d) => { logs += d; });
srv.stderr.on("data", (d) => { logs += d; });
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error("timeout start: " + logs)), 20000);
  const iv = setInterval(() => { if (logs.includes('"started"')) { clearInterval(iv); clearTimeout(t); res(); } }, 100);
});

let ocSrv;
try {
  const initBody = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "curl", version: "0" } } });
  const hdr = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  let r = await fetch(URL_, { method: "POST", headers: hdr, body: initBody });
  check("sem token -> 401", r.status === 401, `status=${r.status}`);
  r = await fetch(URL_, { method: "POST", headers: { ...hdr, Authorization: "Bearer errado" }, body: initBody });
  check("token errado -> 401", r.status === 401, `status=${r.status}`);
  r = await fetch(URL_, { method: "POST", headers: { ...hdr, Authorization: `Bearer ${TOKEN}` }, body: initBody });
  const initJson = await r.json();
  check("token correto -> initialize 200", r.status === 200 && initJson.result?.serverInfo?.name === "agent-bridge", JSON.stringify(initJson));
  r = await fetch(URL_, { method: "POST", headers: { ...hdr, Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) });
  const tl = await r.json();
  check("tools/list via HTTP cru", tl.result?.tools?.length === 12, JSON.stringify(tl).slice(0, 300));

  // Cliente oficial do SDK
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(URL_), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }));
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  const expectedTools =
    "ask_cursor,ask_opencode,cancel_job,get_job,git_readonly,list_bridge_audit,list_files,list_opencode_sessions,list_repos,read_file,start_ask_cursor,start_ask_opencode";
  check("tools/list (SDK) = 12 tools", tools.join(",") === expectedTools, tools.join(","));

  const lr = await client.callTool({ name: "list_repos", arguments: {} });
  check("list_repos retorna demo", lr.content[0].text.includes('"demo"') && lr.content[0].text.includes(repo));
  const lrData = JSON.parse(lr.content[0].text);
  check("list_repos primary_llm cursor", lrData.primary_llm === "cursor");
  check("list_repos opencode.available false", lrData.opencode?.available === false);
  check("list_repos opencode.auto_approve false", lrData.opencode?.auto_approve === false);
  check("list_repos jobs.async_enabled", lrData.jobs?.async_enabled === true);
  check("list_repos sem opencode.bin no MCP", lrData.opencode?.bin === undefined);

  const auditOff = await client.callTool({ name: "list_bridge_audit", arguments: {} });
  check("list_bridge_audit ok (default audit on)", !auditOff.isError && auditOff.content[0].text.includes('"entries"'));

  const startJob = await client.callTool({ name: "start_ask_cursor", arguments: { prompt: "SLEEP_JOB_10 ok" } });
  const startData = JSON.parse(startJob.content[0].text);
  check("start_ask_cursor retorna job_id", startData.job_id?.startsWith("job_") && startData.status);
  let jobDone = false;
  for (let i = 0; i < 40 && !jobDone; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const gj = await client.callTool({ name: "get_job", arguments: { job_id: startData.job_id } });
    const gd = JSON.parse(gj.content[0].text);
    if (gd.status === "done") {
      jobDone = true;
      check("get_job done com texto", gd.result?.includes("FAKE_AGENT") || gd.result?.includes("ARG"));
    }
  }
  check("job lifecycle SLEEP_JOB_10", jobDone);
  const unknownJob = await client.callTool({ name: "get_job", arguments: { job_id: "job_deadbeefcafe" } });
  check("get_job id desconhecido", unknownJob.isError === true);

  const ocOff = await client.callTool({ name: "ask_opencode", arguments: { prompt: "resuma em uma linha" } });
  check("ask_opencode indisponível sem OpenCode", ocOff.isError === true && /OpenCode is not available/.test(ocOff.content[0].text));

  const ask = await client.callTool({ name: "ask_cursor", arguments: { prompt: "O que este repo faz? $(rm -rf /) `id`; echo pwned" } });
  const out = ask.content[0].text;
  console.log("----- saída do agent falso -----\n" + out + "\n--------------------------------");
  const argv = [...out.matchAll(/^ARG\[\d+\]=(.*)$/gm)].map((m) => m[1]);
  const expected = ["-p", "--output-format", "text", "--workspace", repo, "--trust", "--mode", "ask", "O que este repo faz? $(rm -rf /) `id`; echo pwned"];
  check("ask_cursor: argv exato (ask, sem --force, prompt literal)", JSON.stringify(argv) === JSON.stringify(expected), JSON.stringify(argv));
  check("ask_cursor: cwd = repo", reportedCwdIs(out, repo));
  check("ask_cursor: sem --force", !argv.includes("--force") && !argv.includes("--yolo"));
  check("ask_cursor: BRIDGE_TOKEN não vaza para o filho", out.includes("BRIDGE_TOKEN_VISIBLE=<unset>"));

  const w = await client.callTool({ name: "ask_cursor", arguments: { prompt: "edite", mode: "agent" } });
  check("ask_cursor mode=agent rejeitado sem ALLOW_WRITE", w.isError === true && /disabled/.test(w.content[0].text));

  const bad = await client.callTool({ name: "ask_cursor", arguments: { prompt: "x", repo: "../etc" } });
  check("ask_cursor repo fora da allowlist rejeitado", bad.isError === true);

  const f = await client.callTool({ name: "ask_cursor", arguments: { prompt: "FAIL_PLEASE" } });
  check("ask_cursor falha -> isError + stderr tail", f.isError === true && f.content[0].text.includes("erro simulado") && f.content[0].text.includes("exited with code 3"));

  const to = await client.callTool({ name: "ask_cursor", arguments: { prompt: "SLEEP_FOREVER", timeout_sec: 2 } });
  check("ask_cursor timeout (2s)", to.isError === true && to.content[0].text.includes("TIMEOUT"));

  // concorrência: dispara 2 ao mesmo tempo
  const c2 = new Client({ name: "test2", version: "0" });
  await c2.connect(new StreamableHTTPClientTransport(new URL(URL_), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }));
  const p1 = client.callTool({ name: "ask_cursor", arguments: { prompt: "SLEEP_FOREVER", timeout_sec: 3 } });
  await new Promise((r) => setTimeout(r, 300));
  const p2 = await c2.callTool({ name: "ask_cursor", arguments: { prompt: "segunda" } });
  check("ask_cursor concorrente -> 'Busy'", p2.isError === true && p2.content[0].text.startsWith("Busy"), p2.content[0].text);
  await p1;

  const gl = await client.callTool({ name: "git_readonly", arguments: { args: ["log", "--oneline"] } });
  check("git_readonly log permitido", !gl.isError && gl.content[0].text.includes("segundo commit") && gl.content[0].text.includes("primeiro commit"), gl.content[0].text);
  const gd = await client.callTool({ name: "git_readonly", arguments: { args: ["diff", "HEAD~1", "--stat"] } });
  check("git_readonly diff permitido", !gd.isError && gd.content[0].text.includes("README.md"));

  for (const args of [["push"], ["push", "origin", "main"], ["checkout", "HEAD~1"], ["reset", "--hard"], ["commit", "-m", "x"],
                      ["-c", "core.pager=sh", "log"], ["branch", "novo"], ["branch", "-D", "main"], ["diff", "--output=/tmp/x"],
                      ["diff", "--no-index", "/etc/passwd", "/dev/null"], ["fetch", "--upload-pack=touch /tmp/pwn"], ["fetch", "origin", "+main:main"],
                      ["grep", "-Ovim", "x"], ["blame", "--contents", "/etc/passwd", "README.md"]]) {
    const res = await client.callTool({ name: "git_readonly", arguments: { args } });
    check(`git_readonly rejeita ${JSON.stringify(args)}`, res.isError === true && res.content[0].text.startsWith("Rejected"), res.content[0].text);
  }
  const gb = await client.callTool({ name: "git_readonly", arguments: { args: ["branch", "-a"] } });
  check("git_readonly branch -a permitido", !gb.isError && gb.content[0].text.includes("main"));
  check("branch 'novo' não foi criado", !g("branch", "--list").includes("novo"));

  // ---- read_file ----
  const rf = (args) => client.callTool({ name: "read_file", arguments: args });
  let x = await rf({ path: ".agents/docs/convencoes-e-diretrizes/diffs.md" });
  check("read_file gitignored .md (utf-8, total 5 linhas)", !x.isError && x.content[0].text.startsWith("# .agents/docs/convencoes-e-diretrizes/diffs.md | total lines: 5 | showing: full | encoding: utf-8\n# Diretrizes"), x.content[0].text);
  x = await rf({ path: ".agents/docs/convencoes-e-diretrizes/diffs.md", start_line: 2, end_line: 3 });
  check("read_file intervalo 2-3", !x.isError && x.content[0].text.endsWith("showing: lines 2-3 | encoding: utf-8\nlinha 2\nlinha 3"), x.content[0].text);
  x = await rf({ path: ".agents/docs/convencoes-e-diretrizes/diffs.md", start_line: 4, end_line: 99 });
  check("read_file end_line além do fim é limitado", !x.isError && x.content[0].text.endsWith("lines 4-5 | encoding: utf-8\nlinha 4\nlinha 5"), x.content[0].text);
  x = await rf({ path: ".agents/docs/convencoes-e-diretrizes/diffs.md", start_line: 9 });
  check("read_file start_line além do fim rejeitado", x.isError === true);
  x = await rf({ path: ".agents/docs/legado-1252.md" });
  check("read_file windows-1252 decodificado e sinalizado", !x.isError && x.content[0].text.includes("encoding: windows-1252") && x.content[0].text.endsWith("Ação €"), x.content[0].text);
  x = await rf({ path: ".agents/skills/review/SKILL.md" });
  check("read_file SKILL.md", !x.isError && x.content[0].text.includes("name: review"));
  x = await rf({ path: "link-ok.mdc" });
  check("read_file symlink interno permitido", !x.isError && x.content[0].text.includes("regra"));
  for (const [p, why] of [["credentials.env", "blocked"], [".env", "blocked"], ["config/.env.local", "blocked"], ["secrets/db.txt", "blocked"],
      ["keys/server.pem", "blocked"], ["dump.sql", "READ_DENY_GLOBS"], [".git/config", "blocked"], ["link-env.txt", "via link"],
      ["link-fora.txt", "leaves the repository"], ["link-etc/passwd", "leaves the repository"], ["../fora.txt", "'..'"], ["a/../../fora.txt", "'..'"],
      [outside, "absolute"], ["/etc/passwd", "absolute"], ["logo.png", "binary"], ["big.txt", "too large"], ["nao-existe.md", "not found"], [".agents", "not a file"]]) {
    const r = await rf({ path: p });
    check(`read_file rejeita ${p} (${why})`, r.isError === true && r.content[0].text.includes(why) && !r.content[0].text.includes("segredo de fora") && !r.content[0].text.includes("TOKEN=x"), r.content[0].text);
  }
  // ---- list_files ----
  const lf = (args) => client.callTool({ name: "list_files", arguments: args });
  x = await lf({});
  let t = x.content[0].text;
  check("list_files raiz: inclui .agents/ e .gitignore, omite .git/node_modules", !x.isError && t.includes("\n.agents/") && t.includes("\n.gitignore") && !/^\.git\//m.test(t) && !/^node_modules/m.test(t), t);
  check("list_files marca .env/credentials.env/secrets/dump.sql como [blocked]", t.includes(".env [blocked]") && t.includes("credentials.env [blocked]") && t.includes("secrets/ [blocked]") && t.includes("dump.sql [blocked]"), t);
  check("list_files marca link para fora", t.includes("link-fora.txt -> (link) [outside the repo]") && t.includes("link-etc -> (link) [outside the repo]") && t.includes("link-env.txt -> (link) [blocked]"), t);
  check("list_files não recursivo por padrão", !t.includes("diffs.md"));
  x = await lf({ dir: ".agents", recursive: true });
  t = x.content[0].text;
  check("list_files recursivo .agents", !x.isError && t.includes(".agents/docs/convencoes-e-diretrizes/diffs.md (") && t.includes(".agents/skills/review/SKILL.md") && t.includes(".agents/rules/php.mdc"), t);
  x = await lf({ recursive: true, max_entries: 3 });
  check("list_files max_entries trunca", !x.isError && x.content[0].text.includes("TRUNCATED") && x.content[0].text.split("\n").length === 4, x.content[0].text);
  for (const d of ["..", "/etc", "link-etc", "secrets", ".git"]) {
    const r = await lf({ dir: d });
    check(`list_files rejeita dir ${d}`, r.isError === true, r.content[0].text);
  }

  // ---- ask_opencode (fake bin) ----
  const OC_PORT = PORT + 1;
  const fakeOc = path.join(bin, "opencode-fake");
  fs.copyFileSync(path.join(here, "fake-opencode.sh"), fakeOc);
  fs.chmodSync(fakeOc, 0o755);
  const ocUrl = `http://127.0.0.1:${OC_PORT}/mcp`;
  const ocEnv = testBridgeEnv({
    BRIDGE_TOKEN: TOKEN,
    PORT: String(OC_PORT),
    REPOS: `demo=${repo}`,
    OPENCODE_BIN: fakeOc,
    OPENCODE_MODEL: "opencode/test-free",
    BRIDGE_AUDIT_DIR: path.join(tmp, "audit-oc"),
    BRIDGE_OPENCODE_JSON: "0",
  });
  delete ocEnv.OPENCODE_DISABLE;
  ocSrv = spawn(process.execPath, [path.join(root, "dist/index.js")], { env: ocEnv });
  let ocLogs = "";
  ocSrv.stdout.on("data", (d) => { ocLogs += d; });
  ocSrv.stderr.on("data", (d) => { ocLogs += d; });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("timeout oc start: " + ocLogs)), 20000);
    const iv = setInterval(() => { if (ocLogs.includes('"started"')) { clearInterval(iv); clearTimeout(t); res(); } }, 100);
  });
  const ocClient = new Client({ name: "test-oc", version: "0" });
  await ocClient.connect(new StreamableHTTPClientTransport(new URL(ocUrl), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }));
  const lrOc = await ocClient.callTool({ name: "list_repos", arguments: {} });
  const lrOcData = JSON.parse(lrOc.content[0].text);
  check("list_repos opencode.available true (fake)", lrOcData.opencode?.available === true);
  check("list_repos opencode.auto_approve false (fake)", lrOcData.opencode?.auto_approve === false);
  check("list_repos headless_hint quando auto off", typeof lrOcData.opencode?.headless_hint === "string" && lrOcData.opencode.headless_hint.includes("OPENCODE_AUTO=1"));
  const askOc = await ocClient.callTool({ name: "ask_opencode", arguments: { prompt: "tarefa básica" } });
  const ocOut = askOc.content[0].text;
  const ocArgv = [...ocOut.matchAll(/^ARG\[\d+\]=(.*)$/gm)].map((m) => m[1]);
  check(
    "ask_opencode: argv opencode run",
    JSON.stringify(ocArgv) ===
      JSON.stringify([
        "run",
        "--format",
        "default",
        "--dir",
        repo,
        "-m",
        "opencode/test-free",
        "--agent",
        "plan",
        "tarefa básica",
      ]),
    JSON.stringify(ocArgv)
  );
  check("list_repos opencode.agent plan (fake)", lrOcData.opencode?.agent === "plan");
  check("ask_opencode: cwd = repo", reportedCwdIs(ocOut, repo));
  check("ask_opencode: BRIDGE_TOKEN não vaza", ocOut.includes("BRIDGE_TOKEN_VISIBLE=<unset>"));
  check("ask_opencode: resposta simulada", !askOc.isError && ocOut.includes("resposta simulada opencode"));
  const sessList = await ocClient.callTool({ name: "list_opencode_sessions", arguments: {} });
  check("list_opencode_sessions", !sessList.isError && sessList.content[0].text.includes("ses_fake001"));
  const ocFail = await ocClient.callTool({ name: "ask_opencode", arguments: { prompt: "FAIL_PLEASE" } });
  check("ask_opencode falha -> isError", ocFail.isError === true && ocFail.content[0].text.includes("erro simulado opencode"));
  const ocTo = await ocClient.callTool({ name: "ask_opencode", arguments: { prompt: "SLEEP_FOREVER", timeout_sec: 2 } });
  check("ask_opencode timeout (2s)", ocTo.isError === true && ocTo.content[0].text.includes("TIMEOUT") && ocTo.content[0].text.includes("OPENCODE_AUTO=1"));
  const oc2 = new Client({ name: "test-oc2", version: "0" });
  await oc2.connect(new StreamableHTTPClientTransport(new URL(ocUrl), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }));
  const ocP1 = ocClient.callTool({ name: "ask_opencode", arguments: { prompt: "SLEEP_FOREVER", timeout_sec: 3 } });
  await new Promise((r) => setTimeout(r, 300));
  const ocP2 = await oc2.callTool({ name: "ask_opencode", arguments: { prompt: "segunda" } });
  check("ask_opencode concorrente -> Busy", ocP2.isError === true && ocP2.content[0].text.startsWith("Busy"), ocP2.content[0].text);
  await ocP1;
  await ocClient.close();
  await oc2.close();
  ocSrv.kill("SIGTERM");

  await client.close(); await c2.close();

  check("logs não contêm o token", !logs.includes(TOKEN));
  check("logs têm tool/repo/duration/exit_code", /"tool":"git_readonly","repo":"demo","subcommand":"log","duration_ms":\d+,"exit_code":0/.test(logs));
  console.log("----- amostra de logs do servidor -----\n" + logs.split("\n").slice(0, 8).join("\n"));
} finally {
  srv.kill("SIGTERM");
  ocSrv?.kill("SIGTERM");
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
      break;
    } catch (err) {
      if (attempt === 4) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}
console.log(`\nResultado: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
