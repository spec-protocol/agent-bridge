# agent-bridge

## Idiomas / Languages

- [Português](#português)
- [English](#english)

---

## Português

A pessoa colou a URL pública do MCP. Use essa URL. Não invente outra.

### Conector

- Transporte: Streamable HTTP.
- URL: a que veio na mensagem, no formato `https://…/mcp`.
- O Bearer fica só no campo protegido. Não peça o `BRIDGE_TOKEN` no chat e não leia o `.env`.
- A pessoa roda `agent-bridge token copy` no terminal da máquina e cola só no campo protegido, nunca no chat. O comando lê o `.env` indicado por `~/.agent-bridge/home`.

### Tools

Recarregue as 12 tools: `list_repos`, `ask_cursor`, `start_ask_cursor`, `ask_opencode`, `start_ask_opencode`, `get_job`, `cancel_job`, `list_opencode_sessions`, `git_readonly`, `read_file`, `list_files`, `list_bridge_audit`.

### Primeira prova

Chame `list_repos` e um `git_readonly`. `ask_cursor` depois. `ask_opencode` só se `opencode.available` for verdadeiro.

### Túnel novo

Se a URL do túnel mudar, peça outro bloco. O token não muda.

---

## English

The person pasted the public MCP URL. Use that URL. Do not invent another one.

### Connector

- Transport: Streamable HTTP.
- URL: the one in the message, in the form `https://…/mcp`.
- The Bearer token belongs only in the protected field. Do not ask for `BRIDGE_TOKEN` in chat and do not read `.env`.
- The person runs `agent-bridge token copy` on the machine and pastes it only in the protected field, never in chat. The command reads the `.env` indicated by `~/.agent-bridge/home`.

### Tools

Reload the 12 tools: `list_repos`, `ask_cursor`, `start_ask_cursor`, `ask_opencode`, `start_ask_opencode`, `get_job`, `cancel_job`, `list_opencode_sessions`, `git_readonly`, `read_file`, `list_files`, `list_bridge_audit`.

### First proof

Call `list_repos` and one `git_readonly`. `ask_cursor` later. `ask_opencode` only if `opencode.available` is true.

### New tunnel

If the tunnel URL changes, ask for another block. The token does not change.
