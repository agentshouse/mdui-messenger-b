# Messenger port guardrails

Read README.md and reports/house-capabilities.md before modifying integration behavior. Preserve genuine pinned donor source, provenance hashes and license grants. Do not add external runtime services/assets, own signaling/auth/storage, current-identity probes, fake media/transcripts, automatic uploads, or fake success acknowledgements.

Use only the injected House runtime from connectHouseBridge().runtime. Current-user identity and negotiated per-call peer IDs are different. Separate Rooms are the privacy boundary. The 20261011T1050Z Master clarification owns recording: the explicit sender writes both speaker tracks and one part to their own Room; no mutual membership requirement.

Media/call verification in this source-preparation task is synthetic only. Actual device activation, calls, House writes, new Rooms/Apps, Trigger/Routine setup and publication remain outside this local gate. Ask root/Master for scope changes rather than silently introducing alternate services.

Install with --no-audit --no-fund and a writable cache. Run source/test typechecks, lint, all tests, schema/provenance checks, license closure, production build and release closure before handing off. Browser/live acceptance cannot be inferred from these local checks.

Master messages/20261011T1118Z-master-no-agent-draft.md supersedes direct Agent-send scope. Messenger never writes an Agent conversation draft and has no Send to agent control/gate. Its only Agent handoff is persisted call-part document → Room Trigger → Routine → Agent. Do not apply this Messenger correction to another port without separately scoped direction.


## messenger-b Template scope (2026-10-11)

This repository is the separate chatcn messenger-b Template. Original messenger-a (`a_m.1`) remains unchanged. Master1735/1748 and the user's explicit authorization allow this new App's dev publication and binding to the same two existing Rooms, `r_1e.e` and `r_1f.6`; do not create or seed new Rooms. Keep schema and privacy boundaries identical. Each new UI is a separate Template; future fixes to this Template may update it. The new first-page dev check is required and cannot be inferred from local gates. No media/call/Agent test is authorized by ordinary publication.

Chatcn is pinned at `a7be5c3aedebed3441594ce8f532acc168c1628c` (MIT). Preserve source pin hashes and notices. Composer and message edits use actual native business Room Drafts; no recovery paths, UI-buffer types, fake identities or delivery/read timers. Native attachment receipts remain on their same business message path where possible; if it was discarded, surface uncertainty rather than recreate it.
