/** Voice messages stay in memory until the user presses Send. Never uploads. */
const MAX_VOICE_BYTES = 20 * 1024 * 1024;
const MAX_VOICE_MS = 60_000;
const FINALIZE_MS = 5000;
type Session = {
  generation: number; stream: MediaStream; recorder: MediaRecorder;
  chunks: Blob[]; bytes: number; settled: boolean; released: boolean;
  resolve: (file: File) => void; reject: (error: Error) => void; completion: Promise<File>;
  timer?: ReturnType<typeof setTimeout>; finalizer?: ReturnType<typeof setTimeout>;
};

export class VoiceCapture {
  private generation = 0;
  private starting: number | null = null;
  private session: Session | null = null;

  constructor(
    private readonly media: Pick<MediaDevices, 'getUserMedia'> | undefined = globalThis.navigator?.mediaDevices,
    private readonly Recorder: typeof MediaRecorder | undefined = globalThis.MediaRecorder,
  ) {}

  async start(): Promise<void> {
    if (this.starting !== null || this.session) throw new Error('A voice recording is already active.');
    if (!this.media || !this.Recorder) throw new Error('Audio recording is not available in this browser.');
    const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => this.Recorder!.isTypeSupported(type));
    if (!mime) throw new Error('This browser cannot record a supported audio format.');
    const generation = ++this.generation;
    this.starting = generation;
    let stream: MediaStream | null = null;
    let session: Session | null = null;
    try {
      stream = await this.media.getUserMedia({ audio: true, video: false });
      if (generation !== this.generation) { this.stopTracks(stream); stream = null; throw new Error('Recording canceled.'); }
      const recorder = new this.Recorder(stream, { mimeType: mime });
      let resolve!: Session['resolve']; let reject!: Session['reject'];
      const completion = new Promise<File>((yes, no) => { resolve = yes; reject = no; });
      // Errors may occur before the user asks to stop; retain them for stop(), without an unhandled rejection.
      void completion.catch(() => undefined);
      session = { generation, stream, recorder, chunks: [], bytes: 0, settled: false, released: false, resolve, reject, completion };
      this.session = session;
      const current = session;
      recorder.ondataavailable = event => {
        if (!this.isCurrent(current) || current.settled || !event.data.size) return;
        if (current.bytes + event.data.size > MAX_VOICE_BYTES) { this.fail(current, new Error('Voice recording exceeded 20 MiB. Nothing was uploaded.')); return; }
        current.chunks.push(event.data); current.bytes += event.data.size;
      };
      recorder.onerror = () => this.fail(current, new Error('Voice recording failed. Nothing was uploaded.'));
      recorder.onstop = () => {
        if (!this.isCurrent(current) || current.settled) return;
        current.settled = true;
        try {
          const blob = new Blob(current.chunks, { type: mime });
          if (!blob.size) throw new Error('The voice recording was empty.');
          current.resolve(new File([blob], `voice-${crypto.randomUUID()}.${mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm'}`, { type: mime }));
        } catch (error) { current.reject(error instanceof Error ? error : new Error('Voice recording could not be finalized.')); }
        this.release(current);
      };
      // Timeslices bound byte accounting; the returned File includes the complete recording.
      recorder.start(1000);
      if (!current.settled) current.timer = setTimeout(() => this.requestStop(current), MAX_VOICE_MS);
    } catch (error) {
      if (session) {
        this.fail(session, error instanceof Error ? error : new Error('Could not start voice recording.'));
        if (this.session === session) this.session = null;
      } else if (stream) this.stopTracks(stream);
      throw error;
    } finally {
      // A canceled request may finish after a newer permission request started.
      if (this.starting === generation) this.starting = null;
    }
  }

  async stop(): Promise<File> {
    if (this.starting !== null) { this.cancel(); throw new Error('Recording canceled while requesting microphone access.'); }
    const session = this.session;
    if (!session) throw new Error('No voice recording is active.');
    this.requestStop(session);
    try { return await session.completion; }
    finally { if (this.session === session) this.session = null; }
  }

  cancel(): void {
    this.generation++;
    this.starting = null;
    const session = this.session;
    this.session = null;
    if (session) this.fail(session, new Error('Recording canceled. Nothing was uploaded.'));
  }

  private requestStop(session: Session): void {
    if (session.settled || session.finalizer) return;
    clearTimeout(session.timer);
    session.finalizer = setTimeout(() => this.fail(session, new Error('Voice recording did not finish safely. Nothing was uploaded.')), FINALIZE_MS);
    try {
      if (session.recorder.state === 'recording' || session.recorder.state === 'paused') session.recorder.stop();
      else if (session.recorder.state !== 'inactive') this.fail(session, new Error('Voice recording state is unavailable.'));
      // An inactive recorder may still have its last data/stop events queued; await them.
    } catch (error) { this.fail(session, error instanceof Error ? error : new Error('Voice recording could not stop.')); }
  }

  private isCurrent(session: Session): boolean { return this.session === session && this.generation === session.generation; }
  private fail(session: Session, error: Error): void {
    if (!session.settled) { session.settled = true; session.reject(error); }
    this.release(session);
  }
  private release(session: Session): void {
    if (session.released) return;
    session.released = true;
    clearTimeout(session.timer); clearTimeout(session.finalizer);
    session.recorder.ondataavailable = session.recorder.onerror = session.recorder.onstop = null;
    if (session.recorder.state === 'recording' || session.recorder.state === 'paused') { try { session.recorder.stop(); } catch { /* Still release every owned track. */ } }
    this.stopTracks(session.stream);
    session.chunks.length = 0;
  }
  private stopTracks(stream: MediaStream): void {
    for (const track of stream.getTracks()) { try { track.stop(); } catch { /* Stop the remaining owned tracks. */ } }
  }
}
