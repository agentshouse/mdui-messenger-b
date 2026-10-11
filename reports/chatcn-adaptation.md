# messenger-b: chatcn adaptation

## Source and design evidence

Pinned donor: leonickson1/chatcn `a7be5c3aedebed3441594ce8f532acc168c1628c`, MIT, Copyright (c) 2025 chatcn contributors. The exact pinned source was supplied in the verified research package (package SHA-256 in `chatcn-source-pins.json`). Originals in `research/chatcn-original` are not served. The provenance gate checks their hashes against the package manifest before comparing derived files.

Inspected the actual `messaging_auora.png` and `thread_midnight.png` pixels and source before design. The official demo was paused. Repository screenshots support visual design only, not live functionality claims.

- `src/chatcn/layouts.tsx`: extracted donor ChatHeader and ConversationItem JSX/styles; replaces fake presence/unread numbers with actual Room titles/message previews; adds labels and selected-state semantics.
- `src/chatcn/chat.tsx`: donor bubble radius/structure, author/avatar slot, quoted reply, date separators, message grouping/scroll layout, file preview strip and rounded controlled composer JSX/styles, adapted to real Room data. Removes demo timers, fake own identity, read receipts, reactions/votes/pins without schema contracts, data-URL previews and unsupported decorative controls. Preserves native text escaping; attachments go through existing House Attachment component.
- `src/chatcn/chat.css`: actual donor theme tokens, content-card/drop styling and reduced-motion rules. Next/font is omitted; typography is self-contained system font. Main surfaces expose Aurora light and Midnight dark; inherited original tokens remain for fallback call/dialog controls. Contrast and keyboard/touch visibility are improved in index.css.
- `src/App.tsx`: adapts the donor FullMessenger rail/main composition to existing observed chats and Room boundaries. Search/filter/navigation are local and eager; no route fetch or external service. Call/media handling remains the original guarded implementation.

The original Mesailor source/licenses and licensed 17-message dataset are retained. Its dialog/button primitives fill missing auxiliary controls. Chatcn itself requires no new runtime dependency; Base UI/date-fns examples are not imported, and no dependency is installed solely to mimic unused examples. Existing full production dependency notices remain.

## Room authority and preservation

Same schema, same message paths, same two Rooms and same 36 documents as messenger-a. No Room creation, seeding, rewrite, deletion or permission change is part of this Template. Native message creation drafts retain text, reply, attachments and sections. Existing-message edits stage the actual text field with its first base and preserve all other parts. Typing remains raw, including locally invalid unfinished input; validation occurs on explicit Send/Save.

Send queues locally; queue waiting/submitted/retry/accepted states and returned rejected/conflicted/expired/withdrawn drafts are displayed as actual House outcomes, never as recipient delivery or read receipts. Confirmation requires observed Provider acceptance and reached Room version, not a timer. No current user is guessed from author metadata: author labels mean Provider head writer, and all bubbles use neutral direction.

Binary file selections/voice captures are held locally until explicit Send. Acknowledged attachment references are persisted after each successful upload. If another tab saved the original message while uploading, they remain as attachment field edits on that same message path. If the original was discarded/unavailable, the App exposes the exact receipt references and uncertainty; it does not create a recovery document or promise reload recovery for those receipt-only failures. No automatic upload, real call, media activation, Agent send or workflow installation is exercised by tests. Existing honest unavailable call boundaries remain.

## Verification scope

Run the normal exact-source typecheck/lint/test/schema/provenance/notices/build/static-release gates. The strict test query contract requires JSON Pointer field references; all actual Messenger queries use fields: all with intrinsic path ordering, already valid. App source remains eager in one JavaScript bundle.

Hosted first-page acceptance must be recorded separately after actual dev opening. Desktop/360 px fidelity, two-device sync, actual media and Trigger/Kit transcription are not established by source or fixture tests.

## Local validation checkpoint

Before the release commit: both source/test typechecks, full ESLint, 516 tests across 27 files, schema/reference validation, pinned provenance, all 104 installed production dependency notices, production build and complete static release audit passed. Artifact: 8 files, 1,013,337 bytes; one eager JavaScript asset. No new runtime dependency was installed. Nonfatal Vite large-chunk and third-party annotation warnings remain. The available Node 24.19.0 is below the installed House package's declared >=24.21.0 engine floor; these successful checks do not waive that declared toolchain requirement. Exact committed-source preflight is recorded separately at publication.
