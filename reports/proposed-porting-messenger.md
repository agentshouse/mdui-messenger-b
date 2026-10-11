# Messenger local source candidate — not published

Prepared at `ports/messenger` under the existing dot cloud workspace. Root owns status coordination. The initial preparation was recorded in Porting; this local summary incorporates the subsequent Master1118 Messenger scope correction. No new Room/App, release branch, remote push, Trigger/Routine, Agent turn, actual media capture or external call was performed.

## Source and scope

Pinned donors: Mesailor/shadcn-chat `25daf263eaea42d125c942a80e2ed03cc72b3fe2` (MIT), agatx/serenada `8ce3de95d8fc7db81322381270fd251efd4c9134` (root BSD-3-Clause grant preserved), meefik/peerix-talk picker only `f2592faee6ecf33916767c386c27af9aafba2dac` (MIT). Actual donor primitives/media/session/call UI/picker are retained: 76 mapped files, 64 byte-identical; 12 documented adaptations. License closure includes 104 installed production dependency entries, zero missing grants.

House injected Runtime uses MIT bridge `0.1.0-ce524f6608238`. Current JSON Schema is validated by actual mdmodel; one Room per audience, one entity per document. House holder roster, authenticated ephemeral App-message signaling, TURN and Ring use Master's exact 10:40 contracts. No external service, browser storage, donor server/auth/analytics/CDN or invented API was substituted.

## Recording authority

Implemented Master `messages/20261011T1050Z-master-recording-authority.md` and `20261011T0110Z-master-messenger-call-parts.md`: the explicit sender writes both separate speaker tracks and one part to their own bound Room; the peer need not be a member. Call/copy IDs are never asserted to be authenticated House identity. Per-presser recording UUID prevents same-Room collision; shared wire_call_id links the conversation.

No implicit media upload exists. Multiple Sends retain only each new stretch and capture continues. Never-sent hangup offers Send/Don't send; earlier successful Send drops the unsent tail silently. Explicit pending sends survive failure/hangup/incoming calls. Independently finalized speaker containers, acknowledged upload/draft reuse, read-only uncertainty reconciliation and persistence-confirmed Part-sent hints are covered by fixtures. Current-user identity gates names only, not recording.

## Evidence

`reports/local-validation.log` records typecheck (production plus strict owned tests), full ESLint, synthetic Vitest suite, provenance, production build and release closure. `reports/release-audit.json` records exact output hashes/file count/bytes. Schema validation covers independent direct/group samples plus call/part relative references. All tests use synthetic media/Runtime boundaries, not actual devices or House writes. Node 24.19.0 is below mdmodel/mdruntime's declared >=24.21 engine; gates pass locally but supported-environment verification remains appropriate.

Final local gate: **433 tests across 23 files passed**, production and strict-test typechecks passed, full ESLint passed, current schema/reference validation and donor provenance passed. Production closure is **8 files, 964,567 bytes (0.920 MiB)** with no missing local references or license texts. Build has a nonfatal >500kB chunk warning and third-party Zod annotation warnings; no live/browser result is claimed.

## Open release/acceptance gates

1. Root-owned Tasks-first acceptance and current pilot schema/binding/sync defects before Messenger Room/App allocation or publication.
2. Hosted desktop/360px donor comparison, cross-client/reload/offline edits and actual network/frame acceptance.
3. Authorized real two-party TURN/media/device/permission/call tests and independently playable aligned per-speaker parts. Static/fixture success is not live acceptance.
4. Screen capture is explicitly unsupported by House, a concrete capability gap. No hidden alternative was added.
5. Master `messages/20261011T1118Z-master-no-agent-draft.md` removes Send to agent and the Agent-draft gate. Messenger only saves call-part documents for Room Trigger→Routine→Agent processing; no CAS dependency or direct conversation draft write remains. Existing core#3329 only gates authenticated current-name attribution.
6. Actual new-call-part Trigger→Routine→Agent audio propagation and real Kit transcription are unverified. No fake output or automatic environment configuration. `reports/agent-handoff-acceptance.md` gives the exact verification scope and proposed failure issue if reproduced.
