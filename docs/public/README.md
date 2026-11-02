# agent-bridge

## Idiomas / Languages

- [Português](#português)
- [English](#english)

---

## Português

Ponte MCP na máquina do desenvolvedor. O Grok Bot chega nela por um túnel HTTPS e, daí, fala com o Cursor CLI (`agent`), com o OpenCode (opcional) e com git e arquivos locais. O tráfego da tarefa não passa por uma API no meio do caminho.

Copyright 2026 ARJOS Tech. Licença Apache 2.0 ([LICENSE](../../LICENSE)).

O servidor escuta só em `127.0.0.1` (porta padrão `8787`). Toda chamada MCP exige `Authorization: Bearer <BRIDGE_TOKEN>`.

### Conectar o Grok

1. Na máquina: `npm install -g @spec-protocol/agent-bridge`.
2. No projeto, `agent-bridge init`. No chat do Cursor, `/agent-bridge`. Copie o output.
3. Crie o Grok Bot e cole só esse output.

O output traz a URL do MCP e o link do guia. O Grok abre o guia e conclui a conexão. O token não vem no texto: vai só no campo protegido. Na máquina, `agent-bridge token copy` copia o token.

O Cursor CLI (`agent`) é obrigatório. O OpenCode é opcional.

O guia que o Grok executa: [grok.md](grok.md). O link `https://unpkg.com/@spec-protocol/agent-bridge@<versão>/docs/public/grok.md` só responde depois de um `npm publish`.

### Pré-requisitos

- Node.js 18+, `git`, `openssl`
- [Cursor CLI](https://cursor.com/docs/cli/overview) instalado e com `agent login`
- OpenCode só se quiser a tool `ask_opencode`. A ponte funciona sem ele
- `cloudflared` para o túnel público. No macOS o `install.sh --launchd` instala o binário nativo da máquina (Apple Silicon ou Intel)

### Instalar

Na raiz deste repositório:

```bash
chmod +x scripts/*.sh scripts/darwin/*.sh
```

Linux (systemd do usuário, igual ao fluxo já usado: unit, `EnvironmentFile`, linger, `journalctl`):

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

O `install.sh` cria `.env` se ele não existir, gera o `BRIDGE_TOKEN` e, se `agent` estiver no PATH, grava o caminho absoluto em `AGENT_BIN`. No macOS esse binário precisa ser nativo da arquitetura (`arm64` ou `x86_64`); um binário só da outra arquitetura é recusado. O script grava o caminho da instalação em `~/.agent-bridge/home`. O `.env` não vai para o git.

No macOS o Homebrew nativo vem primeiro no `PATH` do LaunchAgent: `/opt/homebrew` no Apple Silicon e `/usr/local` no Intel. O LaunchAgent sobe no login e para no logout. Esta versão não instala LaunchDaemon e não tem o equivalente ao `loginctl enable-linger` do Linux.

### CLI

O comando `agent-bridge` abre o banner. Sem argumentos, mostra a ajuda.

Na pasta de um repositório, `agent-bridge init` acrescenta esse diretório à allowlist do Grok. O `.env` alterado é o da instalação da ponte, não um arquivo novo dentro do projeto. O `init` exige o Cursor CLI (`agent`) no PATH, nativo da arquitetura no macOS. Sem ele, para e não sobe o serviço. OpenCode ausente só gera aviso, e `ask_opencode` continua indisponível. Na primeira vez, se `~/.agent-bridge/home` ainda não existir, o `init` cria o `.env`, sobe o serviço (`--launchd` no macOS, `--systemd` no Linux) e copia a skill global para `~/.cursor/skills/agent-bridge/`. As vezes seguintes só incluem o diretório. `agent-bridge config` edita diretórios, Cursor, OpenCode, porta, túnel, token e auditoria. O token não aparece na tela. `agent-bridge serve` sobe o servidor MCP na mão. O systemd e o LaunchAgent continuam chamando `node dist/index.js`.

A unit no Linux se chama `agent-bridge.service`. Um `cursor-bridge.service` antigo na mesma máquina não é substituído. O túnel continua `cloudflared-bridge.service`.

### Túnel

Com o serviço do cloudflared ativo:

```bash
./scripts/mcp-public-url.sh
```

Use a URL impressa no conector MCP do Grok Bot (Streamable HTTP), com o sufixo `/mcp`, e o token no campo protegido. A URL de quick tunnel muda quando o cloudflared reinicia. No Linux ela sai do `journalctl`. No macOS, de `~/Library/Logs/agent-bridge/`.

Depois de reiniciar a máquina:

```bash
./scripts/grok-reconnect.sh
```

Cole no Grok o bloco entre `--- PASTE INTO GROK ---` e `--- END ---`.

### Tools

| Tool | Função |
| --- | --- |
| `list_repos` | Allowlist de repositórios e se o OpenCode está disponível |
| `ask_cursor` | Cursor CLI no repo. Padrão `ask` (leitura). `agent` só com `ALLOW_WRITE=1` |
| `start_ask_cursor`, `get_job`, `cancel_job` | A mesma execução em job, para tarefas longas |
| `ask_opencode`, `start_ask_opencode`, `list_opencode_sessions` | OpenCode opcional, agente `plan` |
| `git_readonly` | Subcomandos de leitura do git |
| `read_file`, `list_files` | Arquivos do repo, com bloqueio de segredos |
| `list_bridge_audit` | Metadados da auditoria local |

`list_repos` informa `primary_llm: "cursor"`.

### Segurança

Trate o `BRIDGE_TOKEN` como senha. O padrão é somente leitura. `read_file` recusa `.env`, chaves, `.git` e `secrets/`. A auditoria local fica em `~/.local/share/agent-bridge/` e, por padrão, não grava o corpo do prompt.

---

## English

MCP bridge on the developer machine. Grok Bot reaches it through an HTTPS tunnel and, from there, talks to the Cursor CLI (`agent`), optional OpenCode, git, and local files. Task traffic does not pass through an API in the middle.

Copyright 2026 ARJOS Tech. Apache 2.0 license ([LICENSE](../../LICENSE)).

The server listens only on `127.0.0.1` (default port `8787`). Every MCP call requires `Authorization: Bearer <BRIDGE_TOKEN>`.

### Connect Grok

1. On the machine: `npm install -g @spec-protocol/agent-bridge`.
2. In the project, `agent-bridge init`. In the Cursor chat, `/agent-bridge`. Copy the output.
3. Create the Grok Bot and paste only that output.

The output carries the MCP URL and the guide link. Grok opens the guide and finishes the connection. The token is not in the text: it goes only in the protected field. On the machine, `agent-bridge token copy` copies the token.

The Cursor CLI (`agent`) is required. OpenCode is optional.

The guide Grok runs: [grok.md](grok.md). The link `https://unpkg.com/@spec-protocol/agent-bridge@<version>/docs/public/grok.md` answers only after an `npm publish`.

### Prerequisites

- Node.js 18+, `git`, `openssl`
- [Cursor CLI](https://cursor.com/docs/cli/overview) installed, with `agent login`
- OpenCode only if you want the `ask_opencode` tool. The bridge works without it
- `cloudflared` for the public tunnel. On macOS, `install.sh --launchd` installs the binary native to the machine (Apple Silicon or Intel)

### Install

From the root of this repository:

```bash
chmod +x scripts/*.sh scripts/darwin/*.sh
```

Linux (user systemd, the same flow already used: unit, `EnvironmentFile`, linger, `journalctl`):

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

`install.sh` creates `.env` when it is missing, generates `BRIDGE_TOKEN`, and, if `agent` is on PATH, writes the absolute path to `AGENT_BIN`. On macOS that binary must be native to the architecture (`arm64` or `x86_64`); a binary built only for the other architecture is refused. The script writes the install path to `~/.agent-bridge/home`. `.env` does not go to git.

On macOS the native Homebrew prefix comes first on the LaunchAgent `PATH`: `/opt/homebrew` on Apple Silicon and `/usr/local` on Intel. The LaunchAgent starts at login and stops at logout. This version does not install a LaunchDaemon and has no equivalent of Linux `loginctl enable-linger`.

### CLI

The `agent-bridge` command opens the banner. With no arguments, it shows help.

In a repository folder, `agent-bridge init` adds that directory to the Grok allowlist. The `.env` that changes is the bridge installation's, not a new file inside the project. `init` requires the Cursor CLI (`agent`) on PATH, native to the architecture on macOS. Without it, it stops and does not start the service. A missing OpenCode is only a warning, and `ask_opencode` stays unavailable. The first time, if `~/.agent-bridge/home` does not exist yet, `init` creates `.env`, starts the service (`--launchd` on macOS, `--systemd` on Linux), and copies the global skill to `~/.cursor/skills/agent-bridge/`. Later runs only add the directory. `agent-bridge config` edits directories, Cursor, OpenCode, port, tunnel, token, and audit. The token is not shown on screen. `agent-bridge serve` starts the MCP server by hand. systemd and the LaunchAgent still call `node dist/index.js`.

The Linux unit is named `agent-bridge.service`. An old `cursor-bridge.service` on the same machine is not replaced. The tunnel stays `cloudflared-bridge.service`.

### Tunnel

With the cloudflared service running:

```bash
./scripts/mcp-public-url.sh
```

Use the printed URL in the Grok Bot MCP connector (Streamable HTTP), with the `/mcp` suffix, and the token in the protected field. A quick-tunnel URL changes when cloudflared restarts. On Linux it comes from `journalctl`. On macOS, from `~/Library/Logs/agent-bridge/`.

After rebooting the machine:

```bash
./scripts/grok-reconnect.sh
```

Paste into Grok the block between `--- PASTE INTO GROK ---` and `--- END ---`.

### Tools

| Tool | Role |
| --- | --- |
| `list_repos` | Repository allowlist and whether OpenCode is available |
| `ask_cursor` | Cursor CLI in the repo. Default `ask` (read). `agent` only with `ALLOW_WRITE=1` |
| `start_ask_cursor`, `get_job`, `cancel_job` | The same run as a job, for long tasks |
| `ask_opencode`, `start_ask_opencode`, `list_opencode_sessions` | Optional OpenCode, `plan` agent |
| `git_readonly` | Read-only git subcommands |
| `read_file`, `list_files` | Repo files, with secret blocking |
| `list_bridge_audit` | Local audit metadata |

`list_repos` reports `primary_llm: "cursor"`.

### Security

Treat `BRIDGE_TOKEN` as a password. The default is read-only. `read_file` refuses `.env`, keys, `.git`, and `secrets/`. The local audit lives in `~/.local/share/agent-bridge/` and, by default, does not store the prompt body.
