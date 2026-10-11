import { CallPartError, type RecordingLimits, type SpeakerFile, type SpeakerRecorder } from './callParts';

export type SpeakerInput = Readonly<{ speakerId: string; stream: MediaStream }>;
/** Narrow browser boundary so lifecycle tests do not capture real media. */
export interface RecorderPort {
  readonly state: string;
  readonly mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  start(timeslice?: number): void;
  stop(): void;
}
export type RecorderFactory = (stream: MediaStream, options: MediaRecorderOptions) => RecorderPort;
export type OwnedStream = { stream: MediaStream; release: () => void };
export type SpeakerRecorderOptions = {
  create?: RecorderFactory;
  cloneAudio?: (source: MediaStream) => OwnedStream;
  supportsType?: (type: string) => boolean;
  /** Capture stops on a bound/error. Display this; it never initiates a send. */
  onFailure?: (error: Error) => void;
  finalizationTimeoutMs?: number;
};

type Captured = { speakerId: string; owned: OwnedStream; recorder: RecorderPort; chunks: Blob[]; bytes: number; stopped: boolean; released: boolean };
type Segment = {
  captured: Captured[]; total: number; settled: boolean; closing: boolean;
  timer?: ReturnType<typeof setTimeout>; finishTimer?: ReturnType<typeof setTimeout>;
  promise: Promise<readonly SpeakerFile[]>;
  resolve: (files: readonly SpeakerFile[]) => void;
  reject: (error: Error) => void;
};

function cloneAudio(source: MediaStream): OwnedStream {
  const originals = source.getAudioTracks();
  if (!originals.length || originals.some(track => track.readyState === 'ended')) throw new CallPartError('A live audio track is required for each speaker.');
  const tracks: MediaStreamTrack[] = [];
  try {
    for (const track of originals) tracks.push(track.clone());
    const stream = new MediaStream(tracks);
    return { stream, release: () => { for (const track of tracks) track.stop(); } };
  } catch (error) {
    for (const track of tracks) track.stop();
    throw error;
  }
}

function browserRecorder(stream: MediaStream, config: MediaRecorderOptions): RecorderPort {
  const native = new MediaRecorder(stream, config);
  const port: RecorderPort = {
    get state() { return native.state; },
    get mimeType() { return native.mimeType; },
    ondataavailable: null, onstop: null, onerror: null,
    start: timeslice => native.start(timeslice), stop: () => native.stop(),
  };
  native.ondataavailable = event => port.ondataavailable?.({ data: event.data });
  native.onstop = () => port.onstop?.();
  native.onerror = event => port.onerror?.(event);
  return port;
}

/**
 * Records supplied (already consented) local/remote streams. It never requests access,
 * sends a signal, uploads, or stops caller-owned tracks. Every stretch uses a NEW
 * MediaRecorder per speaker and includes ALL its chunks through stop, so requestData
 * fragments are never mislabeled as separate playable files. Rotation starts the new
 * instances before stopping the old ones. This avoids a stop/start capture gap, but
 * does not claim sample-exact browser scheduling or zero overlap at the boundary.
 */
export class IndependentSpeakerRecorder implements SpeakerRecorder {
  private readonly create: RecorderFactory;
  private readonly clone: (source: MediaStream) => OwnedStream;
  private readonly supports: (type: string) => boolean;
  private limits: RecordingLimits | null = null;
  private active: Segment | null = null;
  private readonly segments = new Set<Segment>();
  private started = false;
  private disposed = false;
  private failure: Error | null = null;
  private readonly finishTimeout: number;

  constructor(private readonly inputs: readonly SpeakerInput[], private readonly options: SpeakerRecorderOptions = {}) {
    if (inputs.length !== 2 || new Set(inputs.map(x => x.speakerId)).size !== 2 || inputs.some(x => !x.speakerId)) throw new CallPartError('Two distinct speakers are required.');
    this.inputs = Object.freeze(inputs.map(input => Object.freeze({ ...input })));
    this.options = Object.freeze({ ...options });
    this.create = options.create ?? browserRecorder;
    this.clone = options.cloneAudio ?? cloneAudio;
    this.supports = options.supportsType ?? (type => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type));
    this.finishTimeout = options.finalizationTimeoutMs ?? 5000;
    if (!Number.isSafeInteger(this.finishTimeout) || this.finishTimeout <= 0) throw new CallPartError('Invalid recording finalization timeout.');
  }

  start(limits: RecordingLimits): void {
    if (this.started || this.disposed) throw new CallPartError('Recorder already started or released.');
    if (Object.values(limits).some(x => !Number.isSafeInteger(x) || x <= 0)) throw new CallPartError('Invalid recording limits.');
    this.started = true;
    this.limits = { ...limits };
    this.active = this.openSegment();
  }

  rotate(): Promise<readonly SpeakerFile[]> {
    const previous = this.current();
    // Establish complete new containers before closing the old containers.
    this.active = this.openSegment();
    return this.finalize(previous);
  }

  finish(): Promise<readonly SpeakerFile[]> {
    const segment = this.current();
    this.active = null;
    return this.finalize(segment);
  }

  discard(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active = null;
    for (const segment of [...this.segments]) this.rejectSegment(segment, new CallPartError('Local recording released.'));
  }

  private current(): Segment {
    if (this.failure) throw this.failure;
    if (this.disposed || !this.active) throw new CallPartError('No active speaker recording.');
    return this.active;
  }

  private openSegment(): Segment {
    if (this.failure) throw this.failure;
    const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(this.supports);
    if (!mimeType) {
      const error = new CallPartError('This browser has no supported audio recording format.');
      this.fail(error); throw error;
    }
    let resolve!: Segment['resolve']; let reject!: Segment['reject'];
    const promise = new Promise<readonly SpeakerFile[]>((yes, no) => { resolve = yes; reject = no; });
    // A byte/time limit can reject before any explicit Send is waiting for the result.
    void promise.catch(() => undefined);
    const segment: Segment = { captured: [], total: 0, settled: false, closing: false, promise, resolve, reject };
    this.segments.add(segment);
    try {
      for (const input of this.inputs) {
        const owned = this.clone(input.stream);
        let recorder: RecorderPort;
        try { recorder = this.create(owned.stream, { mimeType }); }
        catch (error) { owned.release(); throw error; }
        const capture: Captured = { speakerId: input.speakerId, owned, recorder, chunks: [], bytes: 0, stopped: false, released: false };
        segment.captured.push(capture);
        recorder.ondataavailable = event => this.chunk(segment, capture, event.data);
        recorder.onerror = () => this.fail(new CallPartError('Speaker recording failed. No audio was sent.'));
        recorder.onstop = () => this.stopped(segment, capture);
      }
      // Timeslices bound accounting latency, not file boundaries. Never publish them.
      for (const capture of segment.captured) {
        capture.recorder.start(1000);
        if (this.failure) throw this.failure;
      }
      segment.timer = setTimeout(() => this.fail(new CallPartError('Unsent recording reached its duration limit. Capture stopped; nothing was uploaded.')), this.limits!.maxStretchMs);
      return segment;
    } catch (error) {
      const failure = error instanceof Error ? error : new CallPartError('Could not start speaker recording.');
      this.fail(failure);
      throw failure;
    }
  }

  private finalize(segment: Segment): Promise<readonly SpeakerFile[]> {
    if (segment.settled) return segment.promise;
    segment.closing = true;
    clearTimeout(segment.timer);
    segment.finishTimer = setTimeout(() => this.fail(new CallPartError('Speaker recording did not finish safely.')), this.finishTimeout);
    try {
      for (const capture of segment.captured) {
        if (capture.recorder.state === 'inactive') throw new CallPartError('Speaker recording stopped unexpectedly.');
        capture.recorder.stop();
      }
    } catch (error) { this.fail(error instanceof Error ? error : new CallPartError('Speaker finalization failed.')); }
    return segment.promise;
  }

  private chunk(segment: Segment, capture: Captured, blob: Blob): void {
    if (segment.settled || !blob.size) return;
    if (capture.bytes + blob.size > this.limits!.maxSpeakerBytes || segment.total + blob.size > this.limits!.maxPartBytes) {
      this.fail(new CallPartError('Unsent recording reached its byte limit. Capture stopped; nothing was uploaded.'));
      return;
    }
    capture.chunks.push(blob);
    capture.bytes += blob.size;
    segment.total += blob.size;
  }

  private stopped(segment: Segment, capture: Captured): void {
    if (segment.settled || capture.stopped) return;
    capture.stopped = true;
    this.release(capture);
    if (!segment.closing) { this.fail(new CallPartError('Speaker recording ended unexpectedly.')); return; }
    if (!segment.captured.every(item => item.stopped)) return;
    if (segment.captured.some(item => !item.bytes || !/^audio\//.test(item.recorder.mimeType))) {
      this.fail(new CallPartError('A speaker recording is empty or has an unsupported format.')); return;
    }
    const files = segment.captured.map(item => Object.freeze({
      speakerId: item.speakerId,
      blob: new Blob(item.chunks, {type:item.recorder.mimeType}),
      container: 'complete' as const,
    }));
    this.clearSegment(segment);
    segment.resolve(Object.freeze(files));
  }

  private release(capture: Captured): void {
    if (capture.released) return;
    capture.released = true;
    try { capture.owned.release(); } catch { /* Best effort for a caller-supplied release. */ }
  }

  private clearSegment(segment: Segment): void {
    segment.settled = true;
    clearTimeout(segment.timer); clearTimeout(segment.finishTimer);
    this.segments.delete(segment);
    for (const capture of segment.captured) {
      capture.chunks.length = 0;
      capture.recorder.ondataavailable = capture.recorder.onerror = capture.recorder.onstop = null;
      this.release(capture);
    }
  }

  private rejectSegment(segment: Segment, error: Error): void {
    if (segment.settled) return;
    // Remove handlers before stop, which may dispatch synchronously in a test adapter.
    this.clearSegment(segment);
    for (const capture of segment.captured) {
      if (capture.recorder.state !== 'inactive') { try { capture.recorder.stop(); } catch { /* Released above. */ } }
    }
    segment.reject(error);
  }

  private fail(error: Error): void {
    if (this.failure || this.disposed) return;
    this.failure = error;
    this.active = null;
    for (const segment of [...this.segments]) this.rejectSegment(segment, error);
    try { this.options.onFailure?.(error); } catch { /* A view cannot prevent cleanup. */ }
  }
}
