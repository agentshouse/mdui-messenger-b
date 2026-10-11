# Messenger: House capability review

Capability inspection checked 2026-10-11 10:50 UTC. Messenger Agent-handoff scope corrected 2026-10-11 11:20 UTC using Master’s explicit 11:18 instruction. Read-only package and House discovery/document inspection. No Runtime request, capture, call, Trigger/Routine execution, upload, Room/App creation, or external mutation was performed. These are public-contract findings, not observed live failures.

## Result

House's authoritative call brief says holders, App-message signaling, short-lived TURN credentials, ringing, microphone/camera/device enumeration, files, and documents are **built and live**. House has no call/media server or call state: the App owns P2P and per-speaker MediaRecorder capture. Screen sharing is explicitly unavailable. Initial package-only uncertainty below has been resolved by this newly supplied source.

The intended Messenger permission model is Room membership: use one bound Room per direct/group audience, never participant-filtered documents in a common Room as private DMs. A slot binds an ordered list of Rooms. Plain authorized Room message creation does not require current-user identity; show Provider head attribution honestly. Core#3329 gates self-aware author/ownership features, not all message creation.

Master supplied exact holders/relay/ring contracts in `messages/20261011T1040Z-master-call-contracts.md`, listed below. There is no check of another User’s Room access; only that party’s authorized write is the check. The 10:50 recording-authority reply resolves ownership: the person pressing Send uploads both local and received tracks and saves one part to their own bound Room; peer membership is irrelevant. The Messenger Agent path is exclusively call-part document → Room Trigger → Routine → Agent, as directed by `/rooms/porting/messages/20261011T1118Z-master-no-agent-draft.md`. Live Trigger-to-Agent audio propagation and Kit transcription remain unverified. Messenger does not write an Agent conversation draft and has no direct Send to agent action or conditional-draft dependency. No live failure was observed.

## Sources and shorthand

- `B` = `ports/tasks/node_modules/@agentshouse/app-bridge`, version `0.1.0-ce524f6608238` (`package.json:2–3`).
- `M` = `B/node_modules/@agentshouse/mdruntime`, version `0.1.0-cff8ba8fa2542` (`package.json:2–3`).
- Package citations below use file and line numbers from this exact installed pair.
- House documents are paths under `/rooms/porting/`, read through the dev House read-only shell.
- Authoritative call/media/audience design: `/rooms/porting/research/2026-10-10-oss-call-app-brief.md`, supplied by Master in `messages/20261011T1030Z-master-call-sources.md` after initial discovery; its step 6 is superseded by `messages/20261011T0110Z-master-messenger-call-parts.md`.
- Messenger-only Agent-handoff correction: `/rooms/porting/messages/20261011T1118Z-master-no-agent-draft.md`, supplied verbatim by the coordinating agent from its successful read. This supersedes the earlier instruction to keep Send to agent and the earlier Messenger conditional-draft gate.
- Command documentation was returned by dev House `find_command`; only discovery was invoked. Operator command names below are **not** declared App Runtime names.
- Some discovery requests returned `McpServerError: Connection failed`; successful narrower requests supplied the contracts quoted below. An unavailable discovery response is not evidence a feature is absent.

## 1. Host, Room data, and current identity

Supported App entry:

```ts
const bridge = connectHouseBridge();
const runtime = await bridge.runtime;
```

`B/README.md:10–12,40–41` says House builds and supplies the Runtime. `M/AGENTS.md:208–216` forbids a served App constructing/importing the host/Adapter. `M/AGENTS.md:189–195` requires Provider access through Runtime and restricts other network origins by the App manifest.

Current API:

- `rooms(): Promise<readonly AppRoom[]>` (`M/dist/client.d.ts:12`).
- AppRoom holds `name`, `locator`, operations, replica/model/selection, owned paths, roomVersion, attachment metadata, synchronization availability and refusal. No members/current user field (`M/dist/connection.d.ts:18–30`).
- `observe('deployment-facts'): Promise<Observation<unknown>>` (`M/dist/client.d.ts:51`); its opaque value must be interpreted using the host contract (`M/AGENTS.md:65–66`). No current-user shape was found.
- `HouseStatus` includes app/runtime, credentials/sync/refusal/loss/GA/service mode/offline, not a current User (`B/dist/client/src/wire.d.ts:23–35`).
- Query `select.change` supplies Provider head-revision attribution `{author,time}`; author is `{kind:'user'|'site',id,name}` or null. This is last confirmed writer, not current viewer or immutable original creator (`M/AGENTS.md:100–106`; `M/dist/adapter.d.ts:235–247`).

Existing blocker: `/rooms/porting/issues/runtime-current-member-identity.md` is still open. Master explicitly confirms the missing signed-in User observation as **core#3329**, says it will return id/name like change.author, and forbids identity-probe writes. Do not duplicate the issue or infer identity from the bridge sender, historical author, hardcoded member, or app-authored field.

## 2. Membership, human chat, and privacy

Inspected exact operator discovery contracts:

```text
list_members({room_ref, history?, limit?, cursor?})
get_room_access({room_ref})
set_member_access({room_ref, member, entries?, namespace?, operations?})
get_user({cursor?, user?})
list_app_holders({app_ref})
```

`find_command('members')` and `find_command('runtime room members')` explain Room members/roles and `member_document: true`: a typed document's `member` identifies a User from list_members. Neither result documents a Room-member enumeration App Runtime equivalent or viewer identity. Master later explicitly supplied the App-holder roster API below and confirmed there is no other-User Room-access check.

Important distinction:

- Runtime `conversation` is **Agent conversation** functionality: each entry has one `agent: {identity,name}` (`M/dist/conversation.d.ts:10–22`). It is not a documented human direct/group messaging service.
- App-supplied `participants` on a Room document are ordinary fields. A query filter, separate folder, or UI-hidden card is not a server-side authorization boundary.
- AppRoom and Runtime observations do not declare create/join/leave/list human chats, enumerate Room members, or set/enforce per-chat participant ACLs (`M/dist/client.d.ts:11–66`; `B/dist/client/src/bridge.d.ts:23–44`).
- The host can narrow a port's Room/document reach (`M/AGENTS.md:15–21`; `M/dist/reach.d.ts:4–12`). The published App client cannot itself grant or construct that authorization. This does not establish participant-level DM privacy.
- Room membership/access operations exist at operator level. Do not silently create Rooms/shares or translate them into guessed Runtime calls as a workaround.

Authoritative resolution: the supplied brief says durable messages are Room documents and Room membership replaces donor accounts/workspaces/permissions. One bound Room per audience is the supported design; ordinary saves to an authorized Room do not need app-authored identity. Show the Provider head writer, not fabricated own-message/read-receipt state. No need for a new per-document chat ACL feature.

`find_command('set_app_bindings')` explicitly returns `{app_ref, slot, room_refs: string[]}`: **one named room slot accepts multiple ordered Rooms**; empty array clears it. Static slot-per-chat declarations are unnecessary. The App can render each bound Room as a separate chat. Master’s 10:40 answer says there is no other-User Room-access check and roster comparison must not be used. The 10:50 reply explicitly resolves the flow: each side selects its own bound Room; a Send by that side uploads both tracks and saves a single part there. The peer does not need membership of that Room. Do not impose mutual Room selection or a probe write. The presser’s actual authorized write is the access check.

## 3. Call signaling and media: authoritative supported contracts

Explicit supported API (`B/docs/families.md:66–72`):

```ts
bridge.messages((message) => { /* message.from, message.body */ });
await runtime.call('apps/messages/send', { to: recipientUserId, body: json });
```

- Sender is authenticated `from: string` User id; `body: unknown` (`B/dist/client/src/wire.d.ts:83–86`).
- `to` is one recipient User id; JSON body maximum is 32 KiB.
- House fills App identity, relays only to that User's copies of the same App running now, and stores nothing.
- `messages(listener)` returns unsubscribe (`B/dist/client/src/bridge.d.ts:42`).
- This is sufficient as an explicit **ephemeral message transport primitive**. It is not a documented call object or durable chat history.

The authoritative brief adds: House stores/retries nothing and sends **no receipt**. Invitations are App messages repeated while ringing; if no answer after about five seconds, ring once. The call roster is all holders with user id/display name/email. A closed App holder receives a House notification via web/push/email; an unanswered ring remains missed call. Short-lived relay credentials arrive as standard RTCIceServer entries. Media uses RTCPeerConnection owned by the App.

`getUserMedia` (audio/video/both) and device enumeration work in the sandboxed App and return real MediaStreams. `getDisplayMedia` does not work and must not appear as an available screen-share control. The App has opaque origin, no persistent browser storage/service/background worker, and owns the call only while its page remains open.

Master supplied the exact App contract in `messages/20261011T1040Z-master-call-contracts.md`, resolving the earlier discovery/name uncertainty:

```ts
runtime.call('apps/holders', {});
// -> {user, name, email}[], name-ordered; caller and owner included
// caller losing App use: app_not_found
runtime.call('apps/relay', {});
// -> {ice_servers:[{urls, username, credential}], expires_at}
// valid 12 hours; own RTCPeerConnection({iceServers: result.ice_servers})
runtime.call('apps/ring', {to});
// one new notification every call, no withdrawal; no App use: operation_denied
runtime.call('apps/messages/send', {to,body});
// bridge.messages -> {from,body}; live only, <=32KiB
```

House fills `app_ref`, so do not supply or spoof it. House panel calls are refused. Relay has no count/limit beyond overload. Never persist/log short-lived relay credentials. Ring each call once after the specified unanswered interval, since retries create duplicate notifications. No current-holder identity call exists yet, explicitly core#3329. The full source message, rather than inferred package names, establishes these exact operations.

Do not invent names, reuse donor signaling or external TURN, or infer `callExternal` is needed. App messages have all-running-copies delivery, so call/session IDs and duplicate/glare handling remain App responsibilities.

## 4. Durable attachment upload/get: exact provided contract

Source: `/rooms/porting/issues/crm-runtime-assets.md`, Master's 01:05 response, plus `/rooms/porting/messages/20261011T0110Z-master-attachment-results.md` and `20261011T0115Z-master-attachment-link.md`.

```ts
runtime.call('attachments/upload', {
  room_ref,          // omit only for Private Room; use selected Room for call parts
  version,           // fresh UUID
  name,
  bytes,             // blob.size
  sha256,            // lowercase hex of exact bytes
  media_type,
  blob               // Blob or File, not encoded replacement
});
runtime.call('attachments/get', { room_ref, attachment_ref });
```

Upload answers one of:

```ts
{ attachment: 'at_…', upload_failure?: string }
// or
{
  original, version, attachment, name, bytes, sha256,
  media_type: string | null,
  save: { status: 'pending' | 'saved' | 'failed', failure: string | null },
  storage: { provider: 'house' | 'connected', scope: '<room ref>' }
}
```

A present `upload_failure` or `save.status === 'failed'` is failure. `attachment` is the output key; a bare string is not a supported answer. Get returns the full record with optional `read: {status:'available'|'not_saved'|'unavailable'}` and `blob?: Blob`; a bare Blob is not an answer. Unavailable bytes should show file metadata honestly rather than pretend playback/download works.

House tracks a bare `at_…` token anywhere in the document's saved text, frontmatter included. There is no special Markdown link requirement. These definitions exist despite their omission from the package's named client methods; do not reopen binary upload itself as missing.

`runtime.rooms()` attachment entries are metadata only (`M/AGENTS.md:45–49`; `M/dist/adapter.d.ts:248–254`). `bridge.readAttachment` is for a Site's published image copy, not the original Room bytes (`B/docs/families.md:44–46`).

There is no documented atomic transaction spanning upload bytes and save call-part Markdown. Preserve acknowledged uploads for retry; do not mislabel a queued or refused document save as a sent part. A upload result with `save.status:'pending'` also cannot be treated as proof the Agent can read the bytes. This is an acceptance requirement to clarify/test, not evidence a production failure occurred.

## 5. Call-part state semantics and per-speaker recordings

Authoritative replacement: `/rooms/porting/messages/20261011T0110Z-master-messenger-call-parts.md`.

Required behavior:

1. Each side chooses its own bound Room for its recording. No mutual-membership requirement or probe. Capture alone never uploads or saves anything to a Room.
2. Explicit Send to Room sends the stretch since previous send/start, a file for each speaker, and one typed call-part document with both participants, call identifier, part number, start, duration and references to those files.
3. Capture continues after Send; parts are individually actionable while the call continues.
4. A stretch never explicitly sent must never be uploaded, including periodic intervals, visibility change, unload or hangup.
5. At hangup with zero successful sent parts, ask “Send this call to <Room>?” with Send/Don't send. With any prior sent part, discard the unsent tail silently unless user sends before hangup.
6. After confirmed Send, tell the peer “Part sent” through App messages. Do not signal success merely for a queued local save. The Room Trigger starts the Routine whose Agent consumes the saved part; no separate Send to agent control or gate belongs in Messenger (Master 11:18).
7. Current User identity gates showing the local authenticated name, not recording. Use “This device” as the explicit display fallback; negotiated call/copy identifiers are not authenticated User identities. Master’s 10:50 instruction removes the blanket call/recording gate.

The persistence half can use the supported upload/get contract and revision-based RoomDraft/save (`M/dist/client.d.ts:19–25`; `M/AGENTS.md:139–179`). Runtime save queues document work and reports refusal/transport uncertainty; use queue/reached evidence rather than claim confirmation when only queued.

The authoritative brief explicitly assigns per-speaker MediaRecorder capture to App code over local and remote MediaStreams. House does not provide a separate speaker-stream server. File names or participant fields do not prove separation, speaker identity, aligned stretch timestamps, or valid independently playable segment containers. These require later two-party live acceptance. Retain only ephemeral unsent media in the intended recording buffer and discard according to explicit semantics; do not persist it via attachments or a browser-storage substitute.

## 6. Trigger → Routine → Agent audio: the Messenger handoff

Master’s `/rooms/porting/messages/20261011T1118Z-master-no-agent-draft.md` confirms this is the whole Messenger Agent path. Saving the call-part document is the App action; the Room Trigger invokes the Routine. Do not add Agent conversation draft writes, a direct-send fallback, or a conditional-draft prerequisite. The live evidence gaps below concern this Trigger/Kit path only.

Successful operator discovery `find_command('Trigger Routine audio attachment transcription')` returned:

```ts
create_trigger({
  room_ref,
  description,
  condition: {
    on: 'documents',
    scope: { type: string } | { folder: string } | { document: string },
    mode: 'starts_matching',
    new_documents: boolean,
    match: Match,
    by?: Match
  },
  actions: [{
    kind: 'routine', access: string,
    payload?: string,
    references?: {room_ref?: string, ref: string}[],
    enabled?: boolean
  }],
  enabled?: boolean
});
```

Other modes are field changes, arriving items, or clocks. These are discovered operator commands, not an established App Runtime API. `list_triggers({room_ref})` is documented.

`find_command('Routine references payload')` documents:

```ts
send_routine_request({
  room_ref: string | null,
  access, payload,
  references?: {room_ref?: string, ref: string}[], // up to 20
  dedup_key?: string
});
list_invokable_routines({room_ref: string | null});
```

A Routine document lives in `/rooms/private/collaboration/routines/<name>.md`; `description` and `input` are textual and its body is the instruction. House does not validate an input shape. `find_command('transcription')` documents an environment/Node `transcribe?: boolean` setting via `set_environment_clis` and `create_node`.

What remains **unverified**:

- Whether Trigger automatic event context includes the triggering call-part document and expands its linked audio attachments into actual Agent audio inputs.
- Whether `references` attach binary originals or only document/context references; whether references dynamically address each newly created document, rather than fixed configured refs.
- Whether both speaker files reach Kit, which media types and size/duration limits apply, and whether the selected Agent environment has transcription enabled.
- The timing guarantee when attachment persistence is pending while the call-part save triggers.
- Retry/dedup behavior needed to avoid duplicate Agent turns for one part or a missing turn after uncertain send.

Master explicitly instructs checking this handoff and filing the key feature issue if it does not occur. No Trigger/run was performed here, so report this as “audio handoff contract/acceptance unverified,” not “Trigger drops attachments.” Do not claim PRD-0116 live transcription success based solely on its mention in Master's requirement.

## 7. Messenger does not use Agent conversation drafts

Current authority: `/rooms/porting/messages/20261011T1118Z-master-no-agent-draft.md`.

- Remove the separate Send to agent action and its gate from Messenger.
- Messenger never writes an Agent conversation’s draft. Its Agent handoff is only saved call-part document → Room Trigger → Routine → Agent.
- No conditional shared-draft contract is required or expected for Messenger. Master explicitly says one will not be added; if an App writes a draft, last write wins is the supported contract.
- Do not wait on a CAS fix, offer a disabled direct-send control, or substitute a conversation/Runtime send for the Room Trigger path.

Historical note, explicitly superseded: this report previously treated the published unconditional `chatDraft.write` / `conversation.send` signatures as a Messenger blocker and proposed reusing the Notebook issue. Master’s 11:18 direction supersedes that Messenger interpretation and the earlier request to retain Send to agent. This documentation correction is confined to Messenger; it changes no Notebook source, issue, or direction.

## Proposed issue text (not filed)

### A. Recording authority resolved; no issue needed

Exact App call contracts are now supplied; do not file the old proposed holders/relay/ring documentation gap as an absent capability. Separate Room-per-audience mapping is confirmed and ordinary Room message saves can proceed.

Master’s `/rooms/porting/messages/20261011T1050Z-master-recording-authority.md` resolves all of this: one part per explicit Send from the presser, containing both tracks, into that presser’s own bound Room. No mutual Room membership or extra prompt. App messages inform the other side when persistence succeeds. Identity is needed only for names, not recording.

To avoid two senders both writing `<shared-call>-part-1` into the same Room, the implementation uses a fresh local recording-session UUID for persisted `call_id`/call document id and a separate `wire_call_id` UUID for the shared protocol call. Part numbering is per presser’s local session. Both genuine ids are stored without pretending either is a current User id. No global counter, roster inference or probe write is required.

### B. messenger-trigger-audio-handoff

**Title:** Verify Trigger-fired Routine materializes call-part speaker files as transcribable Agent inputs.

**Evidence:** `create_trigger` Routine action exposes payload and references; `send_routine_request` references have no inspected binary-expansion guarantee. Environment `transcribe` exists. These facts alone do not prove dynamic triggering-document attachment propagation or PRD-0116 transcription.

**Request:** Provide or run the synthetic-Room acceptance: explicit Send creates one call-part with two speaker attachments; exactly one Routine starts for that part; both files appear in its Agent input and are transcribed with participant/part context; a second explicit part can be consumed while recording continues; an unsent tail never appears. Clarify pending-upload ordering, retries/dedup, and dynamic references. Report observed missing files precisely if the acceptance fails.

**Impact:** This is the Messenger Agent-loop readiness gap. No live failure or successful transcription is asserted. Current-holder identity remains relevant to names/ownership features under core#3329, not to recording or this Trigger handoff. There is no Messenger Agent-draft/CAS dependency.

## Verification boundaries

The 11:20 scope correction changed only this report and `agent-handoff-acceptance.md`. It did not run a Trigger/Routine, upload audio, write any Agent draft, change Notebook, or alter source code. Real Trigger/Kit acceptance remains pending.

Initial review wrote only this report. The later authorized local implementation also adds `src/call/callParts.ts` and focused fixture tests; see the implementation note below. It did not mutate House, call any runtime method, capture audio/video, contact another User, create an Agent turn or simulate live results. The full call-flow brief was absent initially, then supplied and read. Master pinned meefik/peerix-talk at `f2592faee6ecf33916767c386c27af9aafba2dac` and Peerix 0.7.0 at `3b73f0a93edc281b382d1cf4d912a518ad8776e1`; take only the picker, with signaling on House. No alternative donor/design is assumed.


## Local implementation and fixture verification (subsequently authorized)

- `src/call/callParts.ts`: explicit-send state machine; no runtime/global media access. `CallPart` has path-safe stable `{localRecordingSessionId}-part-{number}` id, Room, two negotiated participants, ISO start, monotonic start/duration and two complete speaker Blob files. The generic machine permits path-safe fixture call ids; the production writer/model requires UUIDs. Duplicate sends lock; rejected/uncertain pending bytes and identity remain stable; uncertain writes require read-only reconciliation before retry. Hangup never uploads: never-sent offers, prior success drops tail, pending failures warn/retain. Recorder failures are visible via `captureFailed`. Limits are 30 minutes per stretch, 20 MiB per speaker, 40 MiB per part, matching the House attachment adapter’s per-file bound.
- `src/call/speakerRecorder.ts`: injectable independent MediaRecorder lifecycle. Takes existing consented audio streams and clones only owned audio tracks; originals are not stopped. Each part uses a fresh MediaRecorder and all its chunks through stop. New recorders open before old close. Byte/time/finalization limits stop capture with a warning and no network action. Caller wires `onFailure` to the machine/UI. Incomplete failed containers are never presented as playable files.
- `src/call/voiceCapture.ts`: permission-start lock, session/generation-specific completion and cleanup, canceled late-stream disposal, 60-second/20 MiB bound, 5-second finalization bound, complete local File output. No upload. Canceling an old session cannot clear a newer session or stop its tracks.
- `vendor/peerix-picker/media-button.tsx`: canceled enumeration/animation-frame work cannot begin a later capture; late grants are stopped; disabling/unmounting closes preview; newest selection wins. The picker awaits the actual session’s asynchronous `onDeviceChange` before updating its chosen device; rejection keeps the old choice and surfaces the failure. Exact device constraints avoid falsely showing a preferred-but-not-used device as selected.
- `src/call/partWriter.ts`: explicit `HouseCallPartWriter.commit(part)` with immutable Room/local session/wire-call mapping. Uploads both files through the existing attachment adapter only after explicit Send, checks bytes are readable, retains each acknowledged speaker receipt across failures, and refuses blind retries of unknown upload/save outcomes. Creates call and first part in one Room save batch. Local queued saves do not count as sent: it waits for queue/draft/Provider-metadata confirmation. `reconcile(part)` only reads. Room access/bindings/scopes are rechecked; foreign drafts and existing mismatched paths are not overwritten. Parent handles the peer’s Part sent message only after committed. Committed receipts release strong recording Blob references, retaining only receipt metadata and a weak identity check; foreign draft parts are compared in full.
- Tests: `call-parts.test.ts`, `speaker-recorder.test.ts`, `voice-capture.test.ts`, `device-picker.test.tsx`, and `part-writer.test.ts`: **84 fixture tests passed** at 10:49 UTC. Focused ESLint and `npm run typecheck` (both source and strict owned-test configurations) passed. Fixture regressions cover repeated Send, uncertain and partially acknowledged upload, save refusal/lost acknowledgement, changed bindings, explicit reconciliation, hangup/save races and exact unsent-tail nonupload, byte/time/finalization bounds, permission cancellation, stale stream cleanup and async device-selection failure.
- No live Runtime/House call, real microphone/camera, peer call, external upload, Trigger/Routine, or Agent turn was executed. Fixtures validate lifecycle and integration boundaries, not live media or transcription parity. Browser codec playback still needs a live acceptance check. New-before-old recorder rotation avoids a deliberate stop/start gap but does not prove sample-exact synchronized boundaries or zero overlap. A browser’s internal encoder allocation before data emission is outside the JavaScript byte accounting bound.
