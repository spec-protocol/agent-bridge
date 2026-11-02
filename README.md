# agent-bridge

[![npm version](https://img.shields.io/npm/v/%40spec-protocol%2Fagent-bridge?logo=npm&color=brightgreen)](https://www.npmjs.com/package/@spec-protocol/agent-bridge)
[![license](https://img.shields.io/npm/l/%40spec-protocol%2Fagent-bridge?color=blue)](https://github.com/spec-protocol/agent-bridge/blob/main/LICENSE)
[![node version](https://img.shields.io/node/v/%40spec-protocol%2Fagent-bridge?color=yellow)](https://nodejs.org)

Local MCP bridge between Grok Bot and the IDEs on the developer machine. The bot reaches the machine through an HTTPS tunnel and talks to the Cursor CLI, optional OpenCode, git, and local files. The task traffic does not go through a third-party API.

Copyright 2026 ARJOS Tech. License [Apache 2.0](LICENSE).

Source: [github.com/spec-protocol/agent-bridge](https://github.com/spec-protocol/agent-bridge).

## Idiomas / Languages

- [Português](#português)
- [English](#english)

---

## Português

Ponte MCP na máquina do desenvolvedor. O Grok Bot chega por um túnel HTTPS e fala com o Cursor CLI (`agent`), com o OpenCode (opcional) e com git e arquivos locais.

### Três passos

1. Na máquina: `npm install -g @spec-protocol/agent-bridge`.
2. No projeto, `agent-bridge init`. No chat do Cursor, `/agent-bridge`. Copie o output.
3. Crie o Grok Bot e cole só esse output.

O output traz a URL do MCP e o link do guia. O Grok abre o guia e conclui a conexão. O Cursor CLI (`agent`) é obrigatório. O OpenCode é opcional.

O guia que o Grok executa: [docs/public/grok.md](docs/public/grok.md). O link `https://unpkg.com/@spec-protocol/agent-bridge@<versão>/docs/public/grok.md` só responde depois de um `npm publish`.

Instalação no Linux (`--systemd`) e no macOS (`--launchd`), CLI, túnel e as 12 tools: [docs/public/README.md](docs/public/README.md).

O Bearer fica só no campo protegido. Na máquina, `agent-bridge token copy` copia o token.

---

## English

MCP bridge on the developer machine. Grok Bot arrives over an HTTPS tunnel and talks to the Cursor CLI (`agent`), optional OpenCode, git, and local files.

### Three steps

1. On the machine: `npm install -g @spec-protocol/agent-bridge`.
2. In the project, `agent-bridge init`. In the Cursor chat, `/agent-bridge`. Copy the output.
3. Create the Grok Bot and paste only that output.

The output carries the MCP URL and the guide link. Grok opens the guide and finishes the connection. The Cursor CLI (`agent`) is required. OpenCode is optional.

The guide Grok runs: [docs/public/grok.md](docs/public/grok.md). The link `https://unpkg.com/@spec-protocol/agent-bridge@<version>/docs/public/grok.md` answers only after an `npm publish`.

Linux (`--systemd`) and macOS (`--launchd`) install, CLI, tunnel, and the 12 tools: [docs/public/README.md](docs/public/README.md).

The Bearer token belongs only in the protected field. On the machine, `agent-bridge token copy` copies the token.
