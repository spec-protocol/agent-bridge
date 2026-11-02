# Contributing

Maintainer notes for `@spec-protocol/agent-bridge`.

## Before you ship

1. Run the tests:

   ```bash
   npm test
   ```

2. Run the public-surface check (git and npm are public):

   ```bash
   node scripts/check-public.mjs
   ```

Do not stage `.cursor/`, `.agents/`, non-public `docs/`, `.env`, keys, real tunnel URLs, tokens, or machine paths. Do not create `.npmignore` or `.cursorignore`.

## unpkg guide link

The guide URL shaped like:

`https://unpkg.com/@spec-protocol/agent-bridge@<version>/docs/public/grok.md`

only resolves after an `npm publish` of that version. Do not run `npm publish` unless release is intentional. For local work, point people at [docs/public/grok.md](docs/public/grok.md) in the repo.

## Package contents

`package.json` `files` includes `README.md` and `README.pt-BR.md`. This `CONTRIBUTING.md` is not published with the npm package.
