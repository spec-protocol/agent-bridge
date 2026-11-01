---
name: agent-bridge
description: >-
  Prints the block to paste into Grok Bot to connect the agent-bridge MCP.
  Use when the person asks for /agent-bridge, to connect Grok, the MCP URL,
  or the initial bridge instructions.
disable-model-invocation: true
---

# Connecting agent-bridge to Grok

## Steps

1. Read `~/.agent-bridge/home`. The only line is the installation directory.
2. In that directory, run `./scripts/mcp-public-url.sh`.
3. If the script fails, run `./scripts/grok-reconnect.sh` and use the URL it prints.
4. Do not open `.env`. Do not show `BRIDGE_TOKEN`. Do not invent the URL.
5. Read the `version` field from that installation's `package.json`.

If `~/.agent-bridge/home` does not exist, tell the person to run `agent-bridge init` in the project terminal and stop.

## Reply

Return only these two lines, for the person to copy and paste into Grok Bot:

```text
Connect the Streamable HTTP MCP at this URL: <url the script printed>
Follow this guide and finish the connection: https://unpkg.com/@spec-protocol/agent-bridge@<version>/docs/public/grok.md
```

Replace `<version>` with the value read from `package.json`. Do not add the tools or the token.
