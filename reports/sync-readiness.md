# Initial synchronization and binding recovery

Master instruction: Porting `messages/20261011T1400Z-master-rooms-wait-for-sync.md`, read 2026-10-11.

The runtime's `rooms()` reads local state and may initially be empty. Readiness now follows ongoing Rooms and Sync Status observations. Before `lastCompleted` is non-null the App displays Loading rather than diagnosing a missing binding. After completion, binding diagnostics follow the latest Rooms value and clear on recovery.

Messenger intentionally supports multiple separately bound Rooms, including the published direct and group chat Rooms. Each Room remains an audience boundary. It no longer latches the first rooms() result. Room/query observers retain disposal and stale-generation guards, and temporary reach/refusal loss disables sending while preserving the existing composer. An uncertain write remains a distinct blocking condition.

Regression coverage includes initial empty/cached bindings before sync, completed invalid state, later valid binding, transient reach/refusal loss, and retention of an unfinished canvas/editor/composer. These are synthetic DOM/store checks, not a claim of live browser, media, Agent, or two-device acceptance.

## Follow-on local-first review

The later Master SPA/drafts instruction (20261011T1415Z) is being audited separately. This readiness revision preserves in-memory edit buffers during transient loss; it does not claim that every edit buffer already persists across a full reload. Existing client-side navigation remains. No unsaved-work prompt is removed without an actual persistent replacement.
