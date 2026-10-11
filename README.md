# Messenger

A Room-backed messenger with native message drafts, attachments and optional calls. Separate Rooms define conversation access. Calls and device capture require explicit user interaction.

## Build and publish

Use Node.js 24.21 or later and npm. Run `npm ci --no-audit --no-fund`, then `npm run verify` to run typechecks, lint, tests, schema, provenance, license and release checks. `npm run build` creates the static App in `dist/`.

Commit your changes, configure `origin` to your signed-in House App Git repository, and run `npm run publish`. Publishing verifies the clean committed source and atomically updates House `main` and `release`. It never seeds Room data.

`starter/` contains an existing licensed sample conversation at its original Room paths. `schema.yaml` validates the documents. License grants and mandatory dependency notices are preserved in `LICENSE`, `licenses/`, and `public/THIRD_PARTY_NOTICES.txt`. Regression inputs and upstream provenance are in `tests/support/`.
