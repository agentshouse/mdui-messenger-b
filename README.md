# messenger-b — chatcn House Template

A separate Messenger Template using actual chatcn rail/header, message thread, reply, composer and Aurora/Midnight theme source pinned at `a7be5c3aedebed3441594ce8f532acc168c1628c` (MIT). Original messenger-a (`a_m.1`) stays unchanged. Both Templates use the same distinct direct/group Rooms, `r_1e.e` and `r_1f.6`, with existing licensed text data.

The supplied chatcn repository screenshots were inspected before implementation; its official demo was paused, so no donor live-UX pass is claimed. Native Room Drafts own composer/edit content, and Room queue/Provider evidence replaces simulated delivery/read timers. See `reports/chatcn-adaptation.md` for source seams, omissions and acceptance boundaries.

## Run and verify

```sh
npm ci --cache /tmp/messenger-npm-cache --no-audit --no-fund
npm run typecheck
npm run lint
npm test
node scripts/check-schema.mjs
node scripts/check-provenance.mjs
npm run notices
npm run build
npm run release:check
```

Use a Node version satisfying the installed House mdmodel/runtime packages' `>=24.21.0` engine declaration for a supported toolchain. This preparation environment is Node 24.19.0: all listed local gates pass here, but that does not waive the package engine floor. `package-lock.json` pins the dependency graph; no npm audit/dependency-graph upload was used. The provenance script expects the three sibling donor checkouts named in its mapping.

`dist/` is the deployable static closure; the audit enforces ≤2,000 files and ≤20 MiB, local HTML/CSS references, no inline entry code, no external runtime URLs, fetch, donor WebSockets, analytics, auth/storage backend or browser storage. Dependency license URLs are notices, not runtime requests. The host supplies Runtime through `connectHouseBridge().runtime` from MIT bridge `0.1.0-ce524f6608238`. The App never constructs a host Runtime or Adapter.

## Donor fidelity and modifications

| Source | Immutable donor | Retained behavior |
|---|---|---|
| chatcn | `a7be5c3aedebed3441594ce8f532acc168c1628c` | Rail/header, bubbles/grouping/date separators, replies, controlled composer, theme CSS; donor transient state/status replaced by Room Drafts/outcomes |
| Mesailor/shadcn-chat | `25daf263eaea42d125c942a80e2ed03cc72b3fe2` | Fallback Radix dialog/control primitives and licensed ordinary-chat samples; old chat UI is not the main messenger-b surface |
| agatx/serenada | `8ce3de95d8fc7db81322381270fd251efd4c9134` | Actual SerenadaSession, MediaEngine, peer connection/media lifecycle, participant/video layout, call controls, quality/reconnect logic, donor React call flow |
| meefik/peerix-talk | `f2592faee6ecf33916767c386c27af9aafba2dac` | Actual device-picker/menu/preview and media-device/audio-analysis hooks, adapted to the real Serenada input-switch API |

See `reports/source-provenance.json` for every retained file's donor and port SHA-256. The Peerix library and its signaling are not used. Donor demo content/branding, URL room lobby, servers, SDK diagnostics/recovery storage, external avatars, analytics and network transports were removed from the served closure. House holder messaging replaces signaling, while genuine donor session/media/UI code remains. Storage-only UI preferences are in memory. Picker icons use already-bundled Lucide; its labels are local English. Exact capture constraints and transactional sender replacement extend the donor's media layer, with cancellation and rollback regressions.

Retained donor license grants are in `licenses/` and `LICENSE`. Serenada's root BSD-3-Clause grant is preserved even though its package metadata says MIT. `public/THIRD_PARTY_NOTICES.txt` includes the full installed production dependency closure; `reports/license-audit.json` records the check and supplemental upstream grant provenance. Hosted donor-versus-port desktop/360px visual comparison is pending; retained-source counts are not visual acceptance.

## House data and privacy

`app.json` declares one writable `messenger` slot accepting multiple ordered bound Rooms. Each Room has one `chats/main.md` and its own message/call documents. A separate Room is the actual access boundary for each direct/group audience. A folder, participant list or UI filter is never represented as private DM authorization.

`schema.yaml` uses the current top-level JSON Schema type format, verified with the real `@agentshouse/mdmodel`. Chat, message, call and call-part are individual documents. References are relative within their Room; attachments use actual `at_…` references, with original bytes obtained only via House. `samples/direct` and `samples/group` are independent licensed donor ordinary-chat sample sets; the App never auto-seeds. Calls and media fixtures are local-only tests, not uploaded samples.

Messages use Provider head revision attribution, labelled as the confirmed writer rather than guessed current identity. Core#3329 is the known missing authenticated current-holder observation. The local call label is explicitly “This device.” Generated per-call peer/copy IDs are separate from authenticated House User IDs and are never stored as document author identity. No identity probe writes or roster-based membership inference exist.

Text, voice and file messages require explicit Send. Failed or uncertain writes preserve the composer and do not silently retry. Files/playback load on explicit interaction, scoped to the bound Room. A voice recording starts only through the user's button and browser permission; discard/navigation/unmount releases local resources. Message text and reply selection are actual `messenger_message` creation Room Drafts, hydrated after reload and shared across tabs. The creation path remains stable through explicit Send. Raw incomplete input is staged without schema validation or server Save; Send validates and queues it. Local binary file selections and unsent recorded media remain in memory until explicit Send.

## Calls and exact authoritative contracts

The authoritative sources are Porting `research/2026-10-10-oss-call-app-brief.md`, `messages/20261011T1040Z-master-call-contracts.md`, **`messages/20261011T1050Z-master-recording-authority.md`**, and `messages/20261011T0110Z-master-messenger-call-parts.md`. The 10:50 reply supersedes the brief's mutual-Room/recording ownership ambiguity. See `reports/house-capabilities.md` for exact request/result structures and references.

- `apps/holders {}` supplies authenticated holder targets; it includes this account. No invented self filtering.
- `apps/messages/send {to,body}` and bridge `messages({from,body})` provide live-only 32 KiB signaling. Authenticated sender, call/copy/peer match, TTL, size and role checks reject spoofed/stale envelopes. Invitations repeat while unanswered; Ring happens once per call after five seconds. A selected-copy handshake precedes media capture.
- `apps/relay {}` supplies House TURN only; credentials are ephemeral and never logged/stored. No donor/public TURN or hidden service. The 12-hour relay lifetime is checked at call setup; long-running expiry/reconnect behavior requires live acceptance.
- `apps/ring {to}` has no withdrawal; each invocation is a new notification, so Ring is never blindly retried.
- Microphone/camera activation happens only after explicit Call/Answer and browser permission. Merely opening the dialog or receiving an invitation does not capture. Picker previews require an explicit picker interaction and stop when dismissed. Input selection replaces actual outgoing tracks; it does not just relabel a dropdown.
- House explicitly does **not** support screen capture. The feature is unavailable and called out in the UI. This is a concrete capability/scope gap requiring platform support before screen-share acceptance, not an implemented screen-sharing feature.

## Recording authority and lifecycle

Each side independently chooses its own bound Room before joining, or chooses no local recording. The person pressing **Send to Room uploads both their local and received speaker audio and saves one call-part document to their own Room**. Peer membership is irrelevant. The other side is told that either person may explicitly save a part to their own Room. No mutual membership check, probe write, automatic upload or background server exists.

Each Send captures only the stretch since the previous Send/start. Two independently finalized audio containers are made, one per speaker, not mixed audio and not concatenated arbitrary MediaRecorder fragments. Per-speaker stable audio taps follow actual input replacement and late tracks. A new recording window starts while the prior containers finalize. Browser encoder handoff timing and playable alignment still require live acceptance; zero-gap/zero-overlap perfection is not claimed.

The call document identifies a **local recording session UUID**. The negotiated shared call UUID is `wire_call_id`; each presser's independent session prevents same-Room part-number collisions. Part metadata includes both negotiated speaker IDs/names, part number, wall start, monotonic offset/duration and both attachment references. These IDs are not asserted to be House authors.

Duplicate Send is locked. Confirmed uploads/RoomDraft revisions are retained for an explicit retry; ambiguous upload/save outcomes are not retried. Read-only recheck can reconcile a pending part. `save: saved` alone means local queue admission, not confirmed persistence: the writer checks attachment bytes and Provider/queue/draft evidence. Only confirmed bytes and documents emit **Part sent**, and only to that recording's negotiated call. Confirmed Blob references are released promptly.

Hangup never sends. With nothing ever successfully sent, it asks **Send / Don’t send**. If any part was successfully sent, the unsent tail is silently discarded unless explicitly sent before hanging up. A failed/uncertain explicit Send remains visible and is not dropped during hangup, recorder failure, incoming Answer or new Call. Capture has bounded memory/time; failures release resources and show a warning rather than fabricating audio. Retry recording cannot discard an unresolved explicitly sent part. Local-only unsent media is lost on page close by design; there is no persistence substitute.

## Room automation handoff

The intended automation remains **new `messenger_call_part` → Trigger → Routine → Agent**. No Trigger/Routine/environment was auto-created or reconfigured. The real Kit transcription capability and actual propagation of both audio originals into Agent input must be verified after platform publication/schema gates open. See `reports/agent-handoff-acceptance.md`; no fake transcription/summary/output is supplied.

Master `messages/20261011T1118Z-master-no-agent-draft.md` defines the complete Messenger path: **Send saves a call-part document → the Room Trigger starts a Routine → its Agent receives the part**. Messenger has no Send to agent button, Agent-draft gate, direct Agent conversation write/send or alternate handoff. Master clarified that App draft writes are last-write-wins and no conditional draft API is planned; Messenger does not depend on that API. This scope correction does not change Notebook's separately owned design. The Room save and independent speaker attachments remain unchanged.

## Remaining release acceptance

1. Hosted acceptance on the existing App, including the House installed-release activation issue. Publication and static checks do not prove which release an already-open browser is running.
2. Hosted desktop and 360px visual comparison, denied/cancelled permission behavior, Room access-loss and cross-device synchronization/reload. Network capture must confirm the static audit in the opaque House frame.
3. Explicitly authorized two-party live call test: duplicate running copies, stale/spoofed signaling, ring-once, TURN, device selection, camera-off/mute, remote disconnect and peer cleanup. No actual call/capture occurred in this preparation.
4. Live independently playable per-speaker audio, multiple Sends, exact unsent-tail semantics, persistence/refusal/recheck races, no uploads until explicit Send.
5. Actual Room Trigger→Routine→Agent/Kit audio handoff/transcription. No Messenger Agent-draft capability dependency. Screen sharing awaits platform support.

## Reused donor demo (Master1150)

The operator payload in `scripts/donor-seed-rooms.json` contains two separate Room allocations, each with one chat and all17 messages from Mesailor/shadcn-chat commit `25daf263eaea42d125c942a80e2ed03cc72b3fe2`, `src/data/messages.ts` (MIT). All message text, original timestamps and both fictional speaker names are retained. Each message has an explicit licensed-demo prefix; the Provider head author remains the importing account. Direct and group modes never share a Room or document reference. These are independent copies of the same complete donor conversation, not invented group history.

`samples/PROVENANCE.json` records source/license hashes, all transformations and36 total documents. Original donor source and MIT notice live in `samples/donor/`; `node scripts/adapt-donor-data.mjs` regenerates sample documents without network access. External CDN avatars and delivery claims are omitted. No call, recording, transcript, attachment, Agent result or actual participant identity is seeded. Synthetic call/part unit-test fixtures remain tests only and are absent from both operator payloads. Runtime never imports this sample or auto-seeds it. Publisher owns the separate Room creations and bindings.
