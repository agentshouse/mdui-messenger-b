# Messenger acceptance contract

## Scope and source history

Local source preparation only, following the original ten-App Library brief and Master whole-queue, current JSON Schema and Messenger call-part instructions. Publication and browser/live acceptance belong to root after Tasks and `tasks-schema-replacement`. Source main is a clean port root; donor checkouts remain immutable sibling audit inputs rather than distributing removed branding/demo/server history.

The port retains the actual chat primitives/CSS, Serenada media/session/call components and Peerix picker. See README for exact commits, licenses and specific adaptations; `reports/source-provenance.json` maps all retained donor files. Branding removal does not remove copyright/license attribution. Actual visual acceptance is pending.

## Persistent surfaces

| Surface | Entity | Write trigger | Identity/access |
|---|---|---|---|
| Bound chat | `messenger_chat`, `chats/main.md` | Authorized setup only; no automatic seed | A separately bound Room is the audience boundary |
| Chat message | `messenger_message`, UUID path | Explicit text/voice/file Send | Provider head writer displayed; no guessed author |
| Local recording session | `messenger_call`, per-presser UUID | First explicit part Send with part in one save | Shared negotiated UUID kept separately as `wire_call_id` |
| Speaker stretch | `messenger_call_part`, session UUID plus ordinal | Explicit Send to Room only | Presser's bound Room, both speaker files and negotiated peer identities |
| Raw bytes | House attachment | Explicit Send only | Same fixed Room; available original bytes confirmed through House |

No current identity probe, ACL emulation, fake own-message labels/read receipts, donor account backend, outside signaling/storage/auth/CDN, browser persistence or automatic transcript is provided. The current identity issue affects own-name attribution only.

## State and concurrency guarantees

- House Runtime observes queries, binding/refusal/storage/synchronization/service state. Draft writes name revisions; uncertainty preserves evidence and blocks automatic duplicates.
- Composer text/replies and message edits are native Room Drafts shared across tabs and hydrated on reload; only unsent binary selections remain memory-only. Invalid message/files are rejected before uploads; all busy paths finalize so corrected input can retry.
- Invitation/copy selection uses authenticated bridge sender plus independent call/copy/peer identities. Sender/peer mismatch is rejected. Ring occurs once, not on each resend.
- Real donor media starts only after explicit Call/Answer and the selected-copy handshake. Merely receiving/opening the call view does not capture.
- Device changes apply to actual senders, preserve mute/camera-off, cancel stale grants, rollback failed replacements, and notify session observers before selection resolves.
- Per-speaker audio taps follow same-stream track additions and replacements. Every explicitly sent stretch contains complete independent containers, bounded in time/bytes; capture continues after Send.
- Explicitly sent parts retain acknowledged attachment/draft evidence across refusal or uncertainty. Confirmation requires original audio plus Provider/queue/draft evidence, not local save admission alone. Part-sent hint is bound to its original wire call and only follows confirmed persistence.
- Hangup with no sent parts offers Send/Don't send. A prior successful send causes the unsent tail to be discarded silently. An unresolved explicit Send is retained and prevents a new outgoing/accepted incoming call from discarding its bytes/receipts.
- Capture/start failures release owned resources, preserve pending explicit sends, and permit a fresh recording only after unresolved sends are handled. Leaving the page releases local bytes without uploading them.

## Independent review corrections

The review found and regression tests now cover fractional monotonic start offsets rejected by integer ISO validation; new incoming Answer discarding old pending audio; late old acknowledgements notifying a new call; failed recorder ownership breaking Retry; same-stream remote audio additions staying disconnected; and oversized message validation locking the sender. Asynchronous Room-observation ownership was also hardened: late observers close without subscribing after disposal. These were source bugs fixed locally, not observed production failures. The final synthetic suite has 433 passing tests across 23 files.

## Explicit remaining gates

- Current holder name: existing core#3329; no blocked basic call/recording.
- Screen sharing: unsupported House capability, visible unavailable. Do not claim implemented parity.
- Master `messages/20261011T1118Z-master-no-agent-draft.md`: no direct Send to agent UI or Agent conversation draft/send path. Messenger hands off solely through saved call-part documents and Room automation; no conditional Agent-draft contract is required. Notebook scope is unchanged by this Messenger correction.
- Trigger→Routine→Agent linked-audio propagation and actual Kit transcription: contract/live verification pending, no fabricated outputs/configuration.
- Hosted donor comparison, desktop/360px, frame/network closure, two-client/reload/offline synchronization, real permission/device/call/playable-media acceptance remain pending.
- No Room/App, Trigger/Routine, external call, real media capture, new release branch, push or publication was performed during this task.

Master1150 sample handoff: `scripts/donor-seed-rooms.json` holds two independently allocated Room payloads, each18documents (one chat,17licensed donor ordinary messages). Source/notice/transforms: `samples/PROVENANCE.json`. No live call, media or Agent fixture belongs in either Room.
