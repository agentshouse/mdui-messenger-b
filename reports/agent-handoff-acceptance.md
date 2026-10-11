# Pending real Agent audio acceptance

This is a verification plan, not configured automation or evidence that transcription works. Updated 2026-10-11 11:20 UTC for Master `/rooms/porting/messages/20261011T1118Z-master-no-agent-draft.md`, alongside the call-part design in `messages/20261011T0110Z-master-messenger-call-parts.md` and the supported contracts in `house-capabilities.md`.

The Messenger path is exclusively saved call-part document → Room Trigger → Routine → Agent. Messenger never writes an Agent conversation’s draft. The separate Send to agent action and its gate are removed from the required design; no conditional-draft API or fix is a prerequisite. Master specifies last-write-wins draft semantics and says no conditional draft write will be added.

## Required evidence after the root's release gates open

1. In the authorized Messenger Room, verify the deployed typed call-part schema and bind an authorized Agent Routine. Use House's actual invokable Routine access identity, never a guessed Agent/service ID.
2. Configure the authorized documents Trigger for **new documents of type messenger_call_part** to invoke that Routine once per created part. Confirm the deployed Trigger payload/reference semantics with Master; do not substitute fixed document references for the newly triggering part.
3. Use only an explicitly authorized small synthetic two-speaker audio fixture first. Persist actual audio through House upload/get and one call-part document. Confirm both original byte streams are available before the triggering save is declared successful.
4. Inspect the actual Routine/Agent input and run: does it receive both linked original audio files, correct part/call/participant metadata, and no unsent tail? Metadata-only references are not enough.
5. Verify that the chosen environment actually offers Kit transcription and that it transcribes the two real files. Record media types, sizes/durations, speaker association, timestamps and actual returned evidence. Do not fabricate a transcript or silently enable transcription/reconfigure the environment.
6. Check duplicate/uncertain document-save and Trigger delivery behavior. Establish one actionable Agent result per part and a documented recovery path for actual failures.
7. Verify that Messenger’s UI has no separate Send to agent action or conditional-draft gate and that its handoff never invokes Agent conversation draft writes/sends. The observed Agent run must originate from the Room’s call-part Trigger. There is no direct-send fallback to enable.

## Superseded historical expectation

An earlier version of this plan required an Agent shared-draft CAS fix and a gated Send to agent action. Master’s explicit 11:18 instruction supersedes that Messenger-only requirement. It is not an open acceptance item. This correction changes no Notebook source, issue, or direction.

## Proposed issue if real audio propagation fails

Title: Messenger call-part Trigger/Routine context does not deliver linked speaker audio originals

Include the verified Room/App/part and Routine run references, triggering document type and exact attachment refs, successful original-byte get evidence, actual Agent input showing which bytes are missing, and the precise expected context. Request a supported dynamic triggering-document/reference expansion contract plus actual binary audio inputs and dedup/retry semantics. Do not file this as an observed failure until a live authorized test reproduces it.

Screen capture is separately known unsupported by the authoritative call brief. Report that concrete scope gap; never replace it with a hidden desktop service or claim the feature works.


This revision changes documentation only. No real Trigger, Routine, Agent run, audio upload or conversation-draft write was performed. Both linked-audio propagation and actual Kit transcription remain unverified until the authorized acceptance above is run.
