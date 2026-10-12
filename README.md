# Messenger

A Room-backed messenger with native message drafts, attachments and optional calls. Separate Rooms define conversation access. Calls and device capture require explicit user interaction.

## Build and publish

Use Node.js 24.21 or later and npm. Run `npm ci --no-audit --no-fund`, then `npm run verify` to run typechecks, lint, tests, schema, provenance, license and release checks. `npm run build` creates the static App in `dist/`.

Commit your changes, configure `origin` to your signed-in House App Git repository, and run `npm run publish`. Publishing verifies the clean committed source and atomically updates House `main` and `release`. It never seeds Room data.

`starter/` contains an existing licensed sample conversation at its original Room paths. `schema.yaml` validates the documents. License grants and mandatory dependency notices are preserved in `LICENSE`, `licenses/`, and `public/THIRD_PARTY_NOTICES.txt`. Regression inputs and upstream provenance are in `tests/support/`.

## Portable publisher safety

The publisher accepts credential-free HTTPS House App remotes on any host, including
`https://<host>/app/new.git` for creation. Choose only a host and App you are authorized
to publish to. Host portability does not authorize publication to another environment.
For initial creation, use `npm run publish -- --name "<display name>"`; `--name` is
optional and no default display name is invented. The helper reports only complete,
explicitly returned App/Git receipt URLs and never changes `origin`. After creation,
inspect the returned canonical App in House and set its actual Git URL as `origin`
before another publication. Never retry an uncertain creation blindly.

`npm run test:publisher` runs offline local-Git regression fixtures with mocked
push/remote transport; it installs no packages and does not contact House. These
checks are included in `npm run verify` before the existing App-specific gates.
Publication requires clean committed `main`, runs exactly that full verify gate,
pins the source SHA, and atomically pushes source `main` plus a parentless dist-only
`release`. It preserves the normal index and source branch, rejects unsafe origin
rewrites, index flags, metadata mismatches, and conflicting publisher/worktree locks.
It never commits source, resets work, or substitutes a build-only verification.

Failure diagnostics suppress arbitrary subprocess output to avoid leaking credentials.
Run `npm run verify` locally for full compiler/test output; never share credential
values or verbose HTTP traces. A reported creation receipt or advertised source SHA
does not prove release admission: inspect the known App's published revision in House.
After a failed or uncertain push, inspect that state before deciding whether to retry.

## House navigation

Conversation selection is shared through the House address: `/chats` for the
list and `/chats?room=<observed-Room-locator>` for its chat. The same bridge
connection serves navigation and the Room runtime. Initial deep links wait
for their data; unknown/inaccessible Rooms do not fall back to another chat.
Browser Back/Forward and reloading preserve the selected conversation. Composer
contents, replies, attachments and call state are never serialized into URLs.
Navigation does not send, save or start a call; leaving a chat cancels its pending
voice capture and preserves its native composer draft.

Regression checks include the official bridge test host, null/delayed startup,
Back/Forward, rapid clicks, refusal/cleanup, native composer remount, pending
voice/send races and keeping the call panel mounted without media requests.
