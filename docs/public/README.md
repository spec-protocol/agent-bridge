# agent-bridge

## Idiomas / Languages

- [Português](#português)
- [English](#english)

---

## Português

Ponte MCP na máquina do desenvolvedor. O Grok Bot chega nela por um túnel HTTPS e, daí, fala com o Cursor CLI (`agent`), com o OpenCode (opcional) e com git e arquivos locais. O tráfego da tarefa não passa por uma API no meio do caminho.

Copyright 2026 ARJOS Tech. Licença Apache 2.0 ([LICENSE](../../LICENSE)).

O servidor escuta só em `127.0.0.1` (porta padrão `8787`). Toda chamada MCP exige `Authorization: Bearer <BRIDGE_TOKEN>`.

### Requirements

- Node.js 18+ (`engines` em `package.json`), `git`, `openssl`
- [Cursor CLI](https://cursor.com/docs/cli/overview) instalado e com `agent login`
- OpenCode só se quiser a tool `ask_opencode`. A ponte funciona sem ele
- `cloudflared` para o túnel público. No macOS o `install.sh --launchd` instala o binário nativo da máquina (Apple Silicon ou Intel)

### Conectar o Grok

1. Na máquina: `npm install -g @spec-protocol/agent-bridge`.
2. Duas partes distintas:
   - **Terminal:** no projeto, `agent-bridge init` (allowlist, `.env` da instalação, sobe o serviço na primeira vez, instala a skill).
   - **Chat do Cursor:** `/agent-bridge` imprime **duas linhas** (URL do MCP + link do guia). Copie **esse bloco**, não o token.
3. Crie o Grok Bot e cole só esse output. Na máquina, `agent-bridge token copy` e cole o token só no campo protegido.

O Cursor CLI (`agent`) é obrigatório. O OpenCode é opcional.

O guia que o Grok executa: [grok.md](grok.md). Notas de mantenedor (unpkg após publish): [CONTRIBUTING.md](../../CONTRIBUTING.md).

### Instalar (repo local)

Na raiz deste repositório:

```bash
chmod +x scripts/*.sh scripts/darwin/*.sh
```

Linux (systemd do usuário):

```bash
./scripts/install.sh --systemd
./scripts/enable-persistence.sh
./scripts/doctor.sh
```

macOS (LaunchAgent no login):

```bash
./scripts/install.sh --launchd
./scripts/doctor.sh
```

`--systemd` no macOS recusa e pede `--launchd`. `--launchd` no Linux recusa e pede `--systemd`.

O `install.sh` cria `.env` se ele não existir, gera o `BRIDGE_TOKEN` e, se `agent` estiver no PATH, grava o caminho absoluto em `AGENT_BIN`. No macOS esse binário precisa ser nativo da arquitetura. O script grava o caminho da instalação em `~/.agent-bridge/home`. O `.env` não vai para o git.

### CLI

O comando `agent-bridge` abre o banner. Sem argumentos, mostra a ajuda.

`agent-bridge init` acrescenta o diretório atual à allowlist. O `.env` alterado é o da instalação da ponte. O `init` exige o Cursor CLI (`agent`) no PATH. Sem ele, para e não sobe o serviço. OpenCode ausente só gera aviso. Na primeira vez, se `~/.agent-bridge/home` ainda não existir, o `init` cria o `.env`, sobe o serviço e copia a skill global. `agent-bridge config` edita diretórios, Cursor, OpenCode, porta, túnel, token e auditoria. O token não aparece na tela. `agent-bridge serve` sobe o servidor MCP na mão. `agent-bridge token` lista subcomandos; `agent-bridge token copy` copia o token sem imprimi-lo.

### Túnel

Com o serviço do cloudflared ativo:

```bash
./scripts/mcp-public-url.sh
```

Use a URL impressa no conector MCP do Grok Bot (Streamable HTTP), com o sufixo `/mcp`, e o token no campo protegido. A URL de quick tunnel muda quando o cloudflared reinicia.

Depois de reiniciar a máquina:

```bash
./scripts/grok-reconnect.sh
```

Cole no Grok o bloco entre `--- PASTE INTO GROK ---` e `--- END ---`.

### Tools

| Tool | Função | Acesso |
| --- | --- | --- |
| `list_repos` | Allowlist de repositórios e se o OpenCode está disponível | read |
| `list_cursor_sessions` | Sessões locais do Cursor CLI nos repos permitidos | read |
| `read_cursor_session` | Transcrição em texto de uma sessão Cursor (JSONL quando existir) | read |
| `ask_cursor` | Cursor CLI no repo. Padrão `ask`. `session_id` opcional retoma com `--resume` | read por padrão; write com `mode=agent` e `ALLOW_WRITE=1` |
| `start_ask_cursor` | A mesma execução em job; `session_id` opcional | igual a `ask_cursor` |
| `ask_opencode` | OpenCode opcional, agente `plan` | read |
| `start_ask_opencode` | `ask_opencode` em job | read |
| `get_job` | Status/resultado de um job | read |
| `cancel_job` | Cancela job na fila ou envia `SIGTERM` se estiver rodando | write / efeito colateral |
| `list_opencode_sessions` | Sessões OpenCode no repo | read |
| `git_readonly` | Subcomandos de leitura do git | read |
| `read_file` | Arquivos do repo, com bloqueio de segredos | read |
| `list_files` | Lista arquivos do repo | read |
| `list_bridge_audit` | Metadados da auditoria local | read |

`list_repos` informa `primary_llm: "cursor"`.

### Security

- Allowlist de repositórios (`REPOS`).
- Git somente leitura (subcomandos fixos; opções perigosas rejeitadas).
- `ALLOW_WRITE` desligado por padrão; `mode=agent` exige `ALLOW_WRITE=1`.
- `read_file` / `list_files` recusam `.env`, chaves, `.git`, `secrets/` e `READ_DENY_GLOBS`.
- Auditoria em `~/.local/share/agent-bridge/` (ou `BRIDGE_AUDIT_DIR`); corpo do prompt só com `BRIDGE_AUDIT_BODY=1`.
- Bearer só no campo protegido; `agent-bridge token copy` nunca imprime o token — limpe a área de transferência depois de colar.
- Escuta em `127.0.0.1`.

### Troubleshooting

| Problema | O que fazer |
| --- | --- |
| URL do túnel mudou | Peça outro bloco de duas linhas ao Grok. O token não muda. |
| Repo `my-repo` | Placeholder do `.env.example` — defina o caminho real ou passe `repo`. |
| OpenCode “binary is not executable” | `chmod +x` ou reinstale / corrija `OPENCODE_BIN`. |
| Sem clipboard no `token copy` | Instale `wl-copy`/`xclip`/`xsel`, ou copie `BRIDGE_TOKEN` do `.env` indicado. |

---

## English

MCP bridge on the developer machine. Grok Bot reaches it through an HTTPS tunnel and, from there, talks to the Cursor CLI (`agent`), optional OpenCode, git, and local files. Task traffic does not pass through an API in the middle.

Copyright 2026 ARJOS Tech. Apache 2.0 license ([LICENSE](../../LICENSE)).

The server listens only on `127.0.0.1` (default port `8787`). Every MCP call requires `Authorization: Bearer <BRIDGE_TOKEN>`.

### Requirements

- Node.js 18+ (`engines` in `package.json`), `git`, `openssl`
- [Cursor CLI](https://cursor.com/docs/cli/overview) installed, with `agent login`
- OpenCode only if you want the `ask_opencode` tool. The bridge works without it
- `cloudflared` for the public tunnel. On macOS, `install.sh --launchd` installs the binary native to the machine (Apple Silicon or Intel)

### Connect Grok

1. On the machine: `npm install -g @spec-protocol/agent-bridge`.
2. Two distinct parts:
   - **Terminal:** in the project, `agent-bridge init` (allowlist, installation `.env`, starts the service on first run, installs the skill).
   - **Cursor chat:** `/agent-bridge` prints **two lines** (MCP URL + guide link). Copy **that block**, not the token.
3. Create the Grok Bot and paste only that output. On the machine, `agent-bridge token copy` and paste the token only in the protected field.

The Cursor CLI (`agent`) is required. OpenCode is optional.

The guide Grok runs: [grok.md](grok.md). Maintainer notes (unpkg after publish): [CONTRIBUTING.md](../../CONTRIBUTING.md).

### Install (local repo)

From the root of this repository:

```bash
chmod +x scripts/*.sh scripts/darwin/*.sh
```

Linux (user systemd):

```bash
./scripts/install.sh --systemd
./scripts/enable-persistence.sh
./scripts/doctor.sh
```

macOS (LaunchAgent at login):

```bash
./scripts/install.sh --launchd
./scripts/doctor.sh
```

`--systemd` on macOS refuses and asks for `--launchd`. `--launchd` on Linux refuses and asks for `--systemd`.

`install.sh` creates `.env` when it is missing, generates `BRIDGE_TOKEN`, and, if `agent` is on PATH, writes the absolute path to `AGENT_BIN`. On macOS that binary must be native to the architecture. The script writes the install path to `~/.agent-bridge/home`. `.env` does not go to git.

### CLI

The `agent-bridge` command opens the banner. With no arguments, it shows help.

`agent-bridge init` adds the current directory to the allowlist. The `.env` that changes is the bridge installation's. `init` requires the Cursor CLI (`agent`) on PATH. Without it, it stops and does not start the service. A missing OpenCode is only a warning. The first time, if `~/.agent-bridge/home` does not exist yet, `init` creates `.env`, starts the service, and copies the global skill. `agent-bridge config` edits directories, Cursor, OpenCode, port, tunnel, token, and audit. The token is not shown on screen. `agent-bridge serve` starts the MCP server by hand. `agent-bridge token` lists subcommands; `agent-bridge token copy` copies the token without printing it.

### Tunnel

With the cloudflared service running:

```bash
./scripts/mcp-public-url.sh
```

Use the printed URL in the Grok Bot MCP connector (Streamable HTTP), with the `/mcp` suffix, and the token in the protected field. A quick-tunnel URL changes when cloudflared restarts.

After rebooting the machine:

```bash
./scripts/grok-reconnect.sh
```

Paste into Grok the block between `--- PASTE INTO GROK ---` and `--- END ---`.

### Tools

| Tool | Role | Access |
| --- | --- | --- |
| `list_repos` | Repository allowlist and whether OpenCode is available | read |
| `list_cursor_sessions` | Local Cursor CLI chat sessions for allowed repos | read |
| `read_cursor_session` | Text transcript of a Cursor session (JSONL when present) | read |
| `ask_cursor` | Cursor CLI in the repo. Default `ask`. Optional `session_id` resumes with `--resume` | read by default; write with `mode=agent` and `ALLOW_WRITE=1` |
| `start_ask_cursor` | The same run as a job; optional `session_id` | same as `ask_cursor` |
| `ask_opencode` | Optional OpenCode, `plan` agent | read |
| `start_ask_opencode` | `ask_opencode` as a job | read |
| `get_job` | Job status/result | read |
| `cancel_job` | Cancel a queued job or send `SIGTERM` if running | write / side-effect |
| `list_opencode_sessions` | OpenCode sessions in the repo | read |
| `git_readonly` | Read-only git subcommands | read |
| `read_file` | Repo files, with secret blocking | read |
| `list_files` | List repo files | read |
| `list_bridge_audit` | Local audit metadata | read |

`list_repos` reports `primary_llm: "cursor"`.

### Security

- Repository allowlist (`REPOS`).
- Read-only git (fixed subcommands; dangerous options rejected).
- `ALLOW_WRITE` off by default; `mode=agent` requires `ALLOW_WRITE=1`.
- `read_file` / `list_files` refuse `.env`, keys, `.git`, `secrets/`, and `READ_DENY_GLOBS`.
- Audit under `~/.local/share/agent-bridge/` (or `BRIDGE_AUDIT_DIR`); prompt body only with `BRIDGE_AUDIT_BODY=1`.
- Bearer only in the protected field; `agent-bridge token copy` never prints the token — clear the clipboard after pasting.
- Listens on `127.0.0.1`.

### Troubleshooting

| Problem | What to do |
| --- | --- |
| Tunnel URL changed | Ask Grok for another two-line block. The token does not change. |
| Repo `my-repo` | Placeholder from `.env.example` — set a real path or always pass `repo`. |
| OpenCode “binary is not executable” | `chmod +x` or reinstall / fix `OPENCODE_BIN`. |
| No clipboard tool for `token copy` | Install `wl-copy`/`xclip`/`xsel`, or copy `BRIDGE_TOKEN` from the shown `.env` path. |
