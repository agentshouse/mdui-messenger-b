/** Explicit-send call parts. This module never captures media or uploads by itself. */
export type SpeakerFile = Readonly<{
  speakerId: string;
  blob: Blob;
  /** The adapter must finalize a whole container, not expose a requestData fragment. */
  container: 'complete';
}>;

export type RecordingLimits = Readonly<{
  maxStretchMs: number;
  maxSpeakerBytes: number;
  maxPartBytes: number;
}>;

export const DEFAULT_RECORDING_LIMITS: RecordingLimits = Object.freeze({
  maxStretchMs: 30 * 60 * 1000,
  maxSpeakerBytes: 20 * 1024 * 1024,
  maxPartBytes: 40 * 1024 * 1024,
});

/**
 * Injectable media boundary. Never calls getUserMedia itself.
 * start begins only after explicit call/recording consent. rotate must open the next
 * independent recording before finalizing the old one, without stopping input tracks.
 * finish ends capture and returns the remaining whole files. discard releases only
 * recorder-owned resources. Enforce limits while buffering, without network writes.
 */
export interface SpeakerRecorder {
  start(limits: RecordingLimits): void;
  rotate(): Promise<readonly SpeakerFile[]>;
  finish(): Promise<readonly SpeakerFile[]>;
  discard(): void;
}

export type CallPart = Readonly<{
  id: string;
  callId: string;
  roomId: string;
  number: number;
  participants: readonly string[];
  startedAt: string;
  /** Offsets and duration use one monotonic clock; wall-clock changes are irrelevant. */
  startOffsetMs: number;
  durationMs: number;
  files: readonly SpeakerFile[];
}>;

export type CommitResult =
  | Readonly<{ outcome: 'committed' }>
  | Readonly<{ outcome: 'rejected'; reason: string }>
  | Readonly<{ outcome: 'uncertain'; reason: string }>;

export type PendingStatus = 'finalizing' | 'sending' | 'rejected' | 'uncertain' | 'capture-failed';
export type Phase = 'idle' | 'recording' | 'stopping' | 'ended' | 'disposed';
export type HangupDecision = 'none' | 'offer-send' | 'pending-warning' | 'discarded-tail' | 'unrecorded' | 'capture-warning';
export type PartSnapshot = Readonly<{
  phase: Phase;
  committedParts: number;
  decision: HangupDecision;
  pending: Readonly<{ id: string; number: number; status: PendingStatus; reason?: string }> | null;
  hasLocalTail: boolean;
}>;

type Pending = { id: string; number: number; status: PendingStatus; reason?: string; part?: CallPart };
type Tail = { start: number; end: number; files: readonly SpeakerFile[] };

export type CallPartOptions = {
  callId: string;
  /** Absence denotes an unrecorded call; a recorder must then not be supplied. */
  roomId?: string;
  participants: readonly string[];
  recorder?: SpeakerRecorder;
  /** Injectable monotonic milliseconds, normally performance.now. */
  now: () => number;
  startedAt: string;
  limits?: RecordingLimits;
  /** Must resolve committed only after bytes AND the call-part document are confirmed. */
  commit: (part: CallPart) => Promise<CommitResult>;
};

export class CallPartError extends Error {}

/**
 * Holds at most one explicitly sent pending part plus the next local recording stretch.
 * Repeated sends never overlap. A rejected/uncertain part keeps its identity and bytes;
 * it is never silently retried. The writer must reuse acknowledged upload receipts on
 * explicit retry and reconcile an uncertain document write before permitting retry.
 */
export class CallPartMachine {
  private phase: Phase = 'idle';
  private decision: HangupDecision = 'none';
  private pending: Pending | null = null;
  private tail: Tail | null = null;
  private committedParts = 0;
  private origin = 0;
  private boundary = 0;
  private lastClock = 0;
  private generation = 0;
  private readonly limits: RecordingLimits;
  private readonly participants: readonly string[];
  private readonly wallStart: number;
  private readonly listeners = new Set<(snapshot: PartSnapshot) => void>();

  constructor(private readonly options: CallPartOptions) {
    this.limits = Object.freeze({ ...(options.limits ?? DEFAULT_RECORDING_LIMITS) });
    this.participants = Object.freeze([...options.participants]);
    this.wallStart = Date.parse(options.startedAt);
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(options.callId) || !Number.isFinite(this.wallStart)) throw new CallPartError('Invalid call identity or start time.');
    if (this.participants.length !== 2 || new Set(this.participants).size !== 2 || this.participants.some(x => !x)) {
      throw new CallPartError('A recorded two-person call requires two distinct participant identities.');
    }
    if (Boolean(options.roomId) !== Boolean(options.recorder)) throw new CallPartError('A recorded call requires its Room and recorder.');
    if (Object.values(this.limits).some(x => !Number.isSafeInteger(x) || x <= 0)) throw new CallPartError('Recording limits must be positive integers.');
    this.options = Object.freeze({ ...options, participants: this.participants, limits: this.limits });
  }

  snapshot(): PartSnapshot {
    return Object.freeze({
      phase: this.phase, committedParts: this.committedParts, decision: this.decision,
      pending: this.pending ? Object.freeze({ id: this.pending.id, number: this.pending.number, status: this.pending.status,
        ...(this.pending.reason ? { reason: this.pending.reason } : {}) }) : null,
      hasLocalTail: this.tail !== null,
    });
  }

  subscribe(listener: (snapshot: PartSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    this.require(this.phase === 'idle', 'Call already started.');
    const now = this.options.now();
    this.require(Number.isFinite(now), 'Monotonic clock unavailable.');
    this.origin = this.boundary = this.lastClock = now;
    this.options.recorder?.start(this.limits);
    this.phase = 'recording';
    this.emit();
  }

  /** Only an explicit Send to Room action may call this method. */
  async send(): Promise<void> {
    this.require(Boolean(this.options.roomId), 'This call was not recorded.');
    this.require(this.phase === 'recording' || (this.phase === 'ended' && this.decision === 'offer-send'), 'No recording is available to send.');
    this.require(!this.pending, 'Resolve the existing sent part before sending another.');
    if (this.phase === 'ended') {
      this.require(Boolean(this.tail), 'No local call recording remains.');
      const tail = this.tail!;
      this.tail = null;
      await this.prepareAndSend(tail.start, tail.end, () => Promise.resolve(tail.files));
      return;
    }
    const end = this.time();
    this.require(end > this.boundary, 'No new recording stretch is available.');
    this.require(end - this.boundary <= this.limits.maxStretchMs, 'Recording stretch exceeded its duration limit. End the call and review the recording warning.');
    const start = this.boundary;
    // Reserve the part synchronously before rotating, so double-clicks cannot split it twice.
    this.boundary = end;
    await this.prepareAndSend(start, end, () => this.options.recorder!.rotate());
  }

  /** Only definite refusal can retry. Uncertainty first requires explicit reconciliation. */
  async retryPending(): Promise<void> {
    this.require(this.phase !== 'disposed', 'Recording was released.');
    this.require(this.pending?.status === 'rejected' && Boolean(this.pending.part), 'This part cannot be retried until its previous outcome is known.');
    await this.commitPending(this.pending!, this.generation);
  }

  /** Caller supplies confirmed reconciliation evidence; elapsed time is never evidence. */
  reconcilePending(outcome: 'committed' | 'not-committed'): void {
    this.require(this.pending?.status === 'uncertain', 'Only an uncertain part requires reconciliation.');
    if (outcome === 'committed') this.accept(this.pending!);
    else {
      this.pending!.status = 'rejected';
      this.pending!.reason = 'Confirmed not committed. Retry only with an explicit Send action.';
      this.emit();
    }
  }

  /** Hangup never sends. A prior explicit send may still settle while capture stops. */
  async hangup(): Promise<HangupDecision> {
    this.require(this.phase === 'recording', 'Call is not recording.');
    if (!this.options.recorder) {
      this.phase = 'ended'; this.decision = 'unrecorded'; this.emit(); return this.decision;
    }
    const end = this.time();
    const start = this.boundary;
    const generation = this.generation;
    this.phase = 'stopping';
    this.decision = this.pending ? 'pending-warning' : 'none';
    this.emit();
    try {
      const files = await this.options.recorder.finish();
      if (generation !== this.generation) return this.decision;
      this.phase = 'ended';
      if (this.committedParts > 0 && !this.pending) {
        this.tail = null; this.decision = 'discarded-tail';
      } else if (end === start) {
        this.tail = null; this.decision = this.pending ? 'pending-warning' : 'capture-warning';
      } else {
        this.validateFiles(files, end - start);
        this.tail = { start, end, files: Object.freeze([...files]) };
        this.decision = this.pending ? 'pending-warning' : 'offer-send';
      }
    } catch (error) {
      if (generation !== this.generation) return this.decision;
      this.phase = 'ended';
      this.decision = this.pending ? 'pending-warning' : this.committedParts > 0 ? 'discarded-tail' : 'capture-warning';
      this.tail = null;
      // Keep an already frozen explicit send. A capture error must not send or clear it.
      if (this.pending) this.pending.reason ??= this.reason(error);
    } finally {
      if (generation === this.generation) this.emit();
    }
    return this.decision;
  }

  /** Wire the recorder's bound/error callback here; never convert a capture failure to Send. */
  captureFailed(error: Error): void {
    if (this.phase === 'disposed' || this.phase === 'ended') return;
    try { this.options.recorder?.discard(); } catch { /* Still release retained buffers below. */ }
    this.phase = 'ended';
    this.tail = null;
    this.decision = this.pending ? 'pending-warning' : 'capture-warning';
    if (this.pending) this.pending.reason ??= error.message;
    this.emit();
  }

  /** Explicit Don't send / leave-page cleanup. Never initiates a network action. */
  discard(): void {
    if (this.phase === 'disposed') return;
    this.generation++;
    try { this.options.recorder?.discard(); } catch { /* Cleanup must still clear retained bytes. */ }
    this.pending = null;
    this.tail = null;
    this.phase = 'disposed';
    this.decision = 'none';
    this.emit();
    this.listeners.clear();
  }

  private async prepareAndSend(start: number, end: number, files: () => Promise<readonly SpeakerFile[]>): Promise<void> {
    const number = this.committedParts + 1;
    const pending: Pending = { id: `${this.options.callId}-part-${number}`, number, status: 'finalizing' };
    this.pending = pending;
    const generation = this.generation;
    this.emit();
    try {
      const result = await files();
      if (generation !== this.generation) return;
      this.validateFiles(result, end - start);
      pending.part = Object.freeze({
        id: pending.id, callId: this.options.callId, roomId: this.options.roomId!, number,
        participants: this.participants, startedAt: new Date(this.wallStart + start - this.origin).toISOString(),
        startOffsetMs: start - this.origin, durationMs: end - start,
        files: Object.freeze(result.map(file => Object.freeze({ ...file }))),
      });
      await this.commitPending(pending, generation);
    } catch (error) {
      if (generation !== this.generation) return;
      pending.status = 'capture-failed';
      pending.reason = this.reason(error);
      try { this.options.recorder?.discard(); } catch { /* Keep capture failure visible. */ }
      this.phase = 'ended';
      this.tail = null;
      this.decision = 'pending-warning';
      this.emit();
    }
  }

  private async commitPending(pending: Pending, generation: number): Promise<void> {
    pending.status = 'sending'; delete pending.reason;
    this.emit();
    let result: CommitResult;
    try { result = await this.options.commit(pending.part!); }
    catch (error) { result = { outcome: 'uncertain', reason: this.reason(error) }; }
    if (generation !== this.generation) return;
    if (result?.outcome === 'committed') { this.accept(pending); return; }
    // Malformed acknowledgements are uncertain, never evidence of a rejected write.
    pending.status = result?.outcome === 'rejected' ? 'rejected' : 'uncertain';
    pending.reason = typeof result?.reason === 'string' && result.reason ? result.reason : 'The send outcome is unknown. Reconcile it before retrying.';
    if (this.phase === 'ended' || this.phase === 'stopping') this.decision = 'pending-warning';
    this.emit();
  }

  private accept(pending: Pending): void {
    if (this.pending !== pending) return;
    this.committedParts++;
    this.pending = null;
    if (this.phase === 'ended') { this.tail = null; this.decision = 'discarded-tail'; }
    this.emit();
  }

  private validateFiles(files: readonly SpeakerFile[], duration: number): void {
    this.require(duration > 0 && duration <= this.limits.maxStretchMs, 'Recording stretch is empty or exceeds its duration limit.');
    this.require(files.length === this.participants.length, 'A complete file for each speaker is required.');
    const seen = new Set<string>();
    let total = 0;
    for (const file of files) {
      this.require(this.participants.includes(file.speakerId) && !seen.has(file.speakerId), 'Unexpected or duplicate speaker.');
      seen.add(file.speakerId);
      this.require(file.container === 'complete', 'A MediaRecorder fragment is not an independently playable speaker file.');
      this.require(file.blob instanceof Blob && /^audio\//.test(file.blob.type), 'Each speaker requires a finalized audio file.');
      this.require(file.blob.size > 0 && file.blob.size <= this.limits.maxSpeakerBytes, 'Speaker file is empty or exceeds its byte limit.');
      total += file.blob.size;
    }
    this.require(total <= this.limits.maxPartBytes, 'Call part exceeds its byte limit.');
  }

  private time(): number {
    const now = this.options.now();
    this.require(Number.isFinite(now) && now >= this.lastClock, 'Monotonic clock moved backwards.');
    this.lastClock = now;
    return now;
  }
  private require(condition: unknown, message: string): asserts condition { if (!condition) throw new CallPartError(message); }
  private reason(error: unknown): string { return error instanceof Error ? error.message : 'Recording or send failed.'; }
  private emit(): void { for (const listener of this.listeners) { try { listener(this.snapshot()); } catch { /* A view cannot alter capture/send control flow. */ } } }
}
