# Local-first message composers — 2026-10-11

Master references: `20261011T1415Z-master-spa-and-drafts.md`, `20261011T1420Z-master-local-first-apps.md`, `20261011T1420Z-master-draft-overlap.md`, and `20261011T1425Z-master-no-buffer-drafts.md`.

Text and reply business fields stage into an ordinary `messages/<uuid>.md` creation Room Draft of type `messenger_message`. There is no buffer document, new schema, storage backend, guessed user identity, or server Save on typing. UUID allocation is stable for the draft and Send. Raw invalid text remains staged until Send validation. A new store discovers these drafts from the native `room-drafts` observation and hydrates them. Multiple real creation drafts are retained and selectable rather than overwritten.

The serialized DraftSession uses the actual revision-guarded Runtime API. On stale results it rereads and reapplies the latest local input, preserving unrelated parts and first bases. Other tabs redraw from native draft observations; text-only input does not replace another tab's reply selection. Direct and group Rooms stay separate. Explicit Send waits for local staging, validates, uploads only explicitly selected files, and queues the same actual document draft. Ambiguous uploads/saves still require review and preserve the composer rather than being silently retried.

Navigation stays client-side and all JavaScript is in the initial bundle; the release audit now requires one initial JavaScript asset. Explicit file downloads and user-controlled media behavior remain separate. No call, microphone, camera, Agent request or workflow installation was performed during this work.

Tests cover native draft staging without Save, unfinished invalid input, fast typing, separate Room drafts, tab redraw with disjoint reply preservation, same-path explicit Send, and full App/store remount hydration. These are deterministic adapter/DOM tests, not a claim of hosted browser reload or media acceptance. All previous readiness, security, call, recording, and packaging gates remain required for publication.

Runtime service-mode correction: Provider write-halted still permits local draft edits and explicit document Save/queue. The UI keeps these available, while attachment Actions remain separately gated. Regression coverage asserts this documented distinction.
