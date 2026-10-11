# Master 12:25 donor chrome audit

Instruction: Porting `messages/20261011T1225Z-master-crm-room-label.md`, 2026-10-11. The pinned donor chat components and sidebar have no ambient House sync strip or storage Room selector. Removed the added sync text/shared-storage hint from the footer, while leaving the license link. Normal offline/online observations add no status UI; returned-draft attention, errors, loading and actual write-halt notices remain.

The chat picker continues to display chat document titles, never Room names/paths. Separate per-chat Rooms are the existing privacy boundary. The call-recording destination selector is deliberately retained: that is an explicit recording/transmission workflow with a required user destination choice, not ambient storage instrumentation. No media activation or Agent calls were made. No schema/manifest/persistence changes.

Verification: typecheck, lint, full 436 tests in 24 files, build and release:check pass. New DOM tests verify real chat labels without storage names or sync status, and preserved draft/write-halt notices. Existing send-failure tests keep the composer. Hosted browser/call acceptance remains separate.

Final selected-chat audit also removed the header storage-name suffix. The no-storage-name DOM regression now opens a chat before asserting, in addition to checking the sidebar.
