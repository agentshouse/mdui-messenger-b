import { useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Video } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { SerenadaCallFlow } from "../../vendor/serenada-react-ui/src/SerenadaCallFlow";
import { MediaButton } from "../../vendor/peerix-picker/media-button";
import { houseRuntime, type Runtime } from "../data/house";
import { HouseCallAPI, type Holder } from "../call/houseCalls";
import {
  HouseCallController,
  type CallControllerState,
} from "../call/callController";
import { CallPartMachine, type PartSnapshot } from "../call/callParts";
import { IndependentSpeakerRecorder } from "../call/speakerRecorder";
import { HouseCallPartWriter } from "../call/partWriter";
import { SpeakerTap } from "../call/speakerTap";
import type { Chat } from "../data/model";
type Recording = {
  callId: string;
  roomId: string;
  machine: CallPartMachine;
  writer: HouseCallPartWriter;
  pendingPart: import("../call/callParts").CallPart | null;
  local: SpeakerTap;
  remote: SpeakerTap;
  off: () => void;
  ended: boolean;
};
const initial: CallControllerState = {
  phase: "idle",
  participants: [],
  session: null,
  sessionState: null,
  lastRemotePartSent: 0,
};
/** Mounted with the App so incoming calls reach this copy even while its dialog is closed. */
export function CallWorkspace({
  rooms,
  preferredRoom,
  open,
  onOpenChange,
}: {
  rooms: Chat[];
  preferredRoom: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, setState] = useState(initial),
    [holders, setHolders] = useState<Holder[]>([]),
    [error, setError] = useState(""),
    [target, setTarget] = useState(""),
    [recordRoom, setRecordRoom] = useState(""),
    [part, setPart] = useState<PartSnapshot | null>(null),
    [saving, setSaving] = useState(false),
    [recordError, setRecordError] = useState("");
  const controller = useRef<HouseCallController | null>(null),
    runtime = useRef<Runtime | null>(null),
    recording = useRef<Recording | null>(null),
    startingRecording = useRef<string | null>(null),
    failedRecording = useRef<string | null>(null),
    endedLock = useRef(false),
    generation = useRef(0);
  const latestOpen = useRef(onOpenChange);
  latestOpen.current = onOpenChange;
  const releaseRecording = () => {
    const current = recording.current;
    if (current) {
      current.off();
      current.writer.dispose();
      current.machine.discard();
      current.local.close();
      current.remote.close();
      recording.current = null;
    }
    startingRecording.current = null;
  };
  useEffect(() => {
    let stopped = false;
    let off: (() => void) | undefined;
    void (async () => {
      try {
        const md = await houseRuntime();
        if (stopped) return;
        runtime.current = md;
        const api = new HouseCallAPI(md);
        const call = new HouseCallController({ api });
        controller.current = call;
        off = call.subscribe((next) => {
          setState(next);
          if (next.phase === "incoming") latestOpen.current(true);
        });
        const people = await api.holders();
        if (!stopped) setHolders(people);
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      stopped = true;
      off?.();
      releaseRecording();
      controller.current?.dispose();
    };
  }, []);
  const active = [
    "outgoing",
    "incoming",
    "accepting",
    "connecting",
    "active",
  ].includes(state.phase);
  const recordingName =
    rooms.find(
      (r) => r.room === (recording.current?.roomId ?? state.recordingRoom),
    )?.title ?? "your Room";
  const showError = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));
  const endRecording = async () => {
    const current = recording.current;
    if (!current || current.ended) return;
    current.ended = true;
    try {
      await current.machine.hangup();
    } catch (e) {
      showError(e);
    } finally {
      current.local.close();
      current.remote.close();
    }
  };
  useEffect(() => {
    const current = recording.current;
    if (
      current &&
      !current.ended &&
      current.callId === state.callId &&
      state.session
    ) {
      try {
        current.local.setInput(state.session.localStream);
        current.remote.setInput(
          state.remotePeerId
            ? (state.session.remoteStreams.get(state.remotePeerId) ?? null)
            : null,
        );
      } catch (e) {
        const failure = e instanceof Error ? e : new Error(String(e));
        failedRecording.current = current.callId;
        current.machine.captureFailed(failure);
        current.ended = true;
        current.local.close();
        current.remote.close();
        setRecordError(failure.message);
      }
    }
    if (
      current &&
      !current.ended &&
      (state.phase === "ended" ||
        state.phase === "error" ||
        state.callId !== current.callId)
    )
      void endRecording();
    if (
      state.phase !== "active" ||
      !state.recordingRoom ||
      !state.callId ||
      !state.session ||
      !state.localPeerId ||
      !state.remotePeerId ||
      !runtime.current ||
      current?.callId === state.callId ||
      startingRecording.current === state.callId ||
      failedRecording.current === state.callId
    )
      return;
    const session = state.session,
      localInput = session.localStream,
      remoteInput = session.remoteStreams.get(state.remotePeerId);
    if (!localInput || !remoteInput) return;
    const captured = state;
    startingRecording.current = state.callId;
    const token = ++generation.current;
    void (async () => {
      let local: SpeakerTap | undefined, remote: SpeakerTap | undefined;
      let owned: Recording | undefined;
      let machine: CallPartMachine | undefined;
      const callController = controller.current;
      try {
        releaseRecording();
        startingRecording.current = captured.callId!;
        setPart(null);
        setRecordError("");
        local = new SpeakerTap();
        remote = new SpeakerTap();
        local.setInput(localInput);
        remote.setInput(remoteInput);
        await Promise.all([local.resume(), remote.resume()]);
        if (
          token !== generation.current ||
          controller.current?.current.callId !== captured.callId ||
          controller.current?.current.phase !== "active"
        ) {
          local.close();
          remote.close();
          return;
        }
        const recordingSessionId = crypto.randomUUID(),
          startedAt = new Date().toISOString();
        const writer = new HouseCallPartWriter({
          runtime: runtime.current!,
          roomId: captured.recordingRoom!,
          callId: recordingSessionId,
          wireCallId: captured.callId!,
          callStartedAt: startedAt,
          participants: captured.participants.map((p) => ({
            id: p.id,
            name: p.name,
          })),
        });

        const recorder = new IndependentSpeakerRecorder(
          [
            { speakerId: captured.localPeerId!, stream: local.stream },
            { speakerId: captured.remotePeerId!, stream: remote.stream },
          ],
          {
            onFailure: (e) => {
              failedRecording.current = captured.callId!;
              machine?.captureFailed(e);
              if (owned) {
                owned.ended = true;
                owned.local.close();
                owned.remote.close();
              }
              if (recording.current === owned) setRecordError(e.message);
            },
          },
        );
        machine = new CallPartMachine({
          callId: recordingSessionId,
          roomId: captured.recordingRoom,
          participants: [captured.localPeerId!, captured.remotePeerId!],
          recorder,
          now: () => performance.now(),
          startedAt,
          commit: async (value) => {
            if (owned) owned.pendingPart = value;
            const result = await writer.commit(value);
            if (result.outcome === "committed") {
              if (owned) owned.pendingPart = null;
              // A late acknowledgement belongs only to this negotiated call.
              if (
                callController &&
                callController.current.callId === captured.callId
              )
                void callController.sendPartSent(value.number).catch(() => {
                  if (callController.current.callId === captured.callId)
                    setError(
                      "Part saved. The other side could not be notified.",
                    );
                });
            }
            return result;
          },
        });
        const off = machine.subscribe((snapshot) => {
          if (recording.current === owned) setPart(snapshot);
          if (snapshot.phase === "ended" && owned) {
            owned.ended = true;
            owned.local.close();
            owned.remote.close();
          }
          if (snapshot.pending?.status === "capture-failed") {
            failedRecording.current = captured.callId!;
            setRecordError(snapshot.pending.reason ?? "Recording failed.");
          }
        });
        owned = {
          callId: captured.callId!,
          roomId: captured.recordingRoom!,
          machine,
          writer,
          pendingPart: null,
          local,
          remote,
          off,
          ended: false,
        };
        recording.current = owned;
        machine.start();
        setPart(machine.snapshot());
      } catch (e) {
        failedRecording.current = captured.callId!;
        if (owned) {
          owned.off();
          owned.writer.dispose();
          owned.machine.discard();
          if (recording.current === owned) recording.current = null;
        }
        local?.close();
        remote?.close();
        if (
          token === generation.current &&
          controller.current?.current.callId === captured.callId
        ) {
          setPart(null);
          setRecordError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (startingRecording.current === captured.callId)
          startingRecording.current = null;
      }
    })();
    // Controller state is the authority for stream replacement and lifecycle. Helpers read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const hangup = async () => {
    if (endedLock.current) return;
    endedLock.current = true;
    setError("");
    const owner = controller.current;
    const callId = owner?.current.callId;
    // finish() requests recorder stop synchronously; do not keep live call media
    // open while its final data events settle, nor target a later incoming call.
    const finalized = endRecording();
    if (owner && owner.current.callId === callId)
      void owner.hangup().catch((e) => {
        if (owner.current.callId === callId) showError(e);
      });
    try {
      await finalized;
    } finally {
      endedLock.current = false;
    }
  };
  const unresolvedRecording = () => {
    const snapshot = recording.current?.machine.snapshot();
    return Boolean(
      snapshot &&
      (!["disposed", "ended"].includes(snapshot.phase) ||
        snapshot.decision === "offer-send" ||
        snapshot.pending),
    );
  };
  const incomingBlocked = Boolean(
    part &&
    (!["disposed", "ended"].includes(part.phase) ||
      part.decision === "offer-send" ||
      part.pending),
  );
  const accept = async () => {
    setError("");
    if (unresolvedRecording()) {
      setError(
        "Send or discard the previous local recording before answering.",
      );
      return;
    }
    releaseRecording();
    setPart(null);
    try {
      await controller.current?.accept(recordRoom || undefined);
    } catch (e) {
      showError(e);
    }
  };
  const start = async (mode: "audio" | "video") => {
    setError("");
    if (!controller.current) return;
    if (unresolvedRecording()) {
      setError("Send or discard the previous local recording first.");
      return;
    }
    releaseRecording();
    setPart(null);
    try {
      await controller.current.startOutgoing(
        target,
        mode,
        recordRoom || undefined,
      );
    } catch (e) {
      showError(e);
    }
  };
  const send = async () => {
    const current = recording.current;
    if (!current || saving) return;
    setSaving(true);
    setError("");
    try {
      if (current.machine.snapshot().pending?.status === "rejected")
        await current.machine.retryPending();
      else await current.machine.send();
    } catch (e) {
      showError(e);
    } finally {
      setSaving(false);
    }
  };
  const discard = () => {
    generation.current++;
    releaseRecording();
    setPart(null);
  };
  const recheck = async () => {
    const current = recording.current;
    if (!current?.pendingPart || saving) return;
    setSaving(true);
    try {
      const pending = current.pendingPart;
      const result = await current.writer.reconcile(pending);
      if (result.outcome === "committed") {
        current.pendingPart = null;
        current.machine.reconcilePending("committed");
        const owner = controller.current;
        if (owner && owner.current.callId === current.callId)
          void owner.sendPartSent(pending.number).catch(() => {
            if (owner.current.callId === current.callId)
              setError("Part saved. The other side could not be notified.");
          });
      } else if (result.outcome === "rejected")
        current.machine.reconcilePending("not-committed");
      else setError(result.reason);
    } catch (e) {
      showError(e);
    } finally {
      setSaving(false);
    }
  };
  const selectDevice = async (kind: "audio" | "video", device: string) => {
    try {
      await state.session?.setInputDevice(kind, device);
    } catch (e) {
      showError(e);
      throw e;
    }
  };
  return (
    <>
      {active && !open && (
        <Button
          className="fixed right-4 bottom-4 z-50"
          onClick={() => onOpenChange(true)}
        >
          <Phone />
          Return to call
        </Button>
      )}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-4xl max-h-[95dvh] overflow-y-auto p-0">
          <DialogHeader className="px-5 pt-5">
            <DialogTitle>
              {state.phase === "incoming"
                ? `${state.remoteName ?? "A House holder"} is calling`
                : active
                  ? `Call with ${state.remoteName ?? "a House holder"}`
                  : "Call"}
            </DialogTitle>
            <DialogDescription>
              Calls use House signaling and relay. Each person chooses their own
              Room for explicit recording sends.
            </DialogDescription>
          </DialogHeader>
          {["idle", "ended", "error"].includes(state.phase) && (
            <div className="px-5 pb-3 space-y-3">
              <label className="block text-sm">
                Call a holder
                <select
                  className="mt-1 block border rounded-md p-2 w-full bg-background"
                  aria-label="Call a holder"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">Choose a person</option>
                  {holders.map((h) => (
                    <option value={h.user} key={h.user}>
                      {h.name || "House holder"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Recording
                <select
                  className="mt-1 block border rounded-md p-2 w-full bg-background"
                  aria-label="Recording destination"
                  value={recordRoom}
                  onChange={(e) => setRecordRoom(e.target.value)}
                >
                  <option value="">Not recorded</option>
                  {rooms.map((r) => (
                    <option key={r.room} value={r.room}>
                      Record locally · Send to {r.title}
                    </option>
                  ))}
                </select>
              </label>
              {preferredRoom && recordRoom === "" && (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => setRecordRoom(preferredRoom)}
                >
                  Use this chat’s Room for recording
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                The roster includes this account because House doesn’t expose
                your own identity yet. Your local call label is “This device.”
                No recording uploads by itself.
              </p>
              <div className="flex gap-2">
                <Button
                  disabled={
                    !controller.current ||
                    !target ||
                    !!part?.pending ||
                    part?.decision === "offer-send"
                  }
                  onClick={() => void start("audio")}
                >
                  <Phone />
                  Audio call
                </Button>
                <Button
                  variant="outline"
                  disabled={
                    !controller.current ||
                    !target ||
                    !!part?.pending ||
                    part?.decision === "offer-send"
                  }
                  onClick={() => void start("video")}
                >
                  <Video />
                  Video call
                </Button>
              </div>
            </div>
          )}
          {state.phase === "incoming" && (
            <div className="p-5 space-y-3">
              <p>
                Answer to join. Either person can save an explicitly sent call
                part to their own Room.
              </p>
              <label className="block text-sm">
                Your recording destination
                <select
                  className="block border rounded p-2 w-full bg-background"
                  aria-label="Incoming recording destination"
                  value={recordRoom}
                  onChange={(e) => setRecordRoom(e.target.value)}
                >
                  <option value="">Not recorded on this device</option>
                  {rooms.map((r) => (
                    <option key={r.room} value={r.room}>
                      {r.title}
                    </option>
                  ))}
                </select>
              </label>
              {incomingBlocked && (
                <p role="status">
                  Send or discard the previous local recording before answering.
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  disabled={incomingBlocked}
                  onClick={() => void accept()}
                >
                  Answer
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    void controller.current?.decline().catch(showError)
                  }
                >
                  Decline
                </Button>
              </div>
            </div>
          )}
          {(state.phase === "outgoing" ||
            state.phase === "accepting" ||
            (state.phase === "connecting" && !state.session)) && (
            <div className="p-8 text-center">
              <p>
                {state.phase === "outgoing"
                  ? "Ringing…"
                  : state.phase === "accepting"
                    ? "Waiting for the calling copy…"
                    : "Connecting media…"}
              </p>
              <Button
                variant="destructive"
                className="mt-4"
                onClick={() => void hangup()}
              >
                <PhoneOff />
                Cancel
              </Button>
            </div>
          )}
          {state.session && (
            <div className="call-stage">
              <SerenadaCallFlow
                session={state.session}
                onEndCall={() => void hangup()}
                onDismiss={() => void hangup()}
                config={{
                  screenSharingEnabled: false,
                  inviteControlsEnabled: false,
                  videoEnabled: state.mode === "video",
                  videoMediaEnabled: state.mode === "video",
                  autoHideControls: false,
                }}
              />
            </div>
          )}
          {state.session && (
            <div className="flex gap-3 px-5 py-3 items-center flex-wrap">
              <MediaButton
                kind="audio"
                enabled={
                  state.sessionState?.localParticipant?.audioEnabled !== false
                }
                onToggle={() => state.session?.toggleAudio()}
                onDeviceChange={(id) => selectDevice("audio", id)}
              />
              {state.mode === "video" && (
                <MediaButton
                  kind="video"
                  enabled={
                    state.sessionState?.localParticipant?.videoEnabled !== false
                  }
                  onToggle={() => state.session?.toggleVideo()}
                  onDeviceChange={(id) => selectDevice("video", id)}
                />
              )}
              <span className="text-xs text-muted-foreground">
                Screen sharing is unavailable in House.
              </span>
            </div>
          )}
          {state.recordingRoom && active && (
            <div className="border-t p-4 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm">
                  {part?.phase === "recording"
                    ? "Recording locally"
                    : "Waiting for recordable audio"}{" "}
                  · {recordingName}
                </p>
                <p className="text-xs text-muted-foreground">
                  Nothing uploads until Send to Room.
                </p>
              </div>
              <Button
                disabled={
                  !part ||
                  part.phase !== "recording" ||
                  !!part.pending ||
                  saving
                }
                onClick={() => void send()}
              >
                {saving ? "Sending…" : "Send to Room"}
              </Button>
            </div>
          )}
          {part?.decision === "offer-send" && (
            <div className="border-t p-4">
              <p>Send this call to {recordingName}?</p>
              <div className="flex gap-2 mt-2">
                <Button disabled={saving} onClick={() => void send()}>
                  Send
                </Button>
                <Button variant="outline" disabled={saving} onClick={discard}>
                  Don’t send
                </Button>
              </div>
            </div>
          )}
          {part?.pending && (
            <div role="status" className="border-t p-4 text-sm">
              <p>
                Part {part.pending.number}: {part.pending.status}
              </p>
              {part.pending.reason && <p>{part.pending.reason}</p>}
              {part.pending.status === "capture-failed" && (
                <Button
                  className="mt-2"
                  variant="outline"
                  disabled={saving}
                  onClick={discard}
                >
                  Discard failed local capture
                </Button>
              )}
              {part.pending.status === "rejected" && (
                <Button
                  className="mt-2"
                  onClick={() => void send()}
                  disabled={saving}
                >
                  Retry this part
                </Button>
              )}
              {part.pending.status === "uncertain" && (
                <>
                  <p>
                    Check this Room’s drafts and saved documents. Do not send
                    another copy while the outcome is unknown.
                  </p>
                  <Button
                    className="mt-2"
                    variant="outline"
                    disabled={saving}
                    onClick={() => void recheck()}
                  >
                    Recheck saved part
                  </Button>
                </>
              )}
            </div>
          )}
          {state.lastRemotePartSent > 0 && (
            <p role="status" className="px-5 pb-3 text-sm">
              Part sent · {state.remoteName} sent part{" "}
              {state.lastRemotePartSent}
            </p>
          )}
          {recordError && active && state.recordingRoom && (
            <Button
              variant="outline"
              className="mx-5 mb-2"
              disabled={!!part?.pending || saving}
              onClick={() => {
                if (recording.current?.machine.snapshot().pending || saving)
                  return;
                generation.current++;
                releaseRecording();
                setPart(null);
                failedRecording.current = null;
                setRecordError("");
                setState({ ...state });
              }}
            >
              Retry local recording
            </Button>
          )}
          {(error || state.error || state.warning || recordError) && (
            <div role="alert" className="px-5 pb-4 text-sm text-destructive">
              {error || state.error || state.warning || recordError}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
