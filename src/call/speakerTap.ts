/** One stable, isolated recording stream per speaker across device/track replacement. */
export class SpeakerTap {
  readonly stream: MediaStream;
  private source: MediaStreamAudioSourceNode | null = null;
  private input: MediaStream | null = null;
  private inputTracks: MediaStreamTrack[] = [];
  private destination: MediaStreamAudioDestinationNode;
  private closed = false;
  constructor(private context: AudioContext = new AudioContext()) {
    this.destination = context.createMediaStreamDestination();
    this.stream = this.destination.stream;
  }
  async resume() {
    if (this.closed) throw new Error("Recording audio graph is closed.");
    await this.context.resume();
    if (this.context.state !== "running")
      throw new Error("The browser has paused recording audio.");
  }
  setInput(stream: MediaStream | null) {
    if (this.closed) throw new Error("Recording audio graph is closed.");
    const tracks =
      stream?.getAudioTracks().filter((track) => track.readyState !== "ended") ??
      [];
    if (
      this.input === stream &&
      tracks.length === this.inputTracks.length &&
      tracks.every((track, index) => track === this.inputTracks[index])
    )
      return;
    this.source?.disconnect();
    this.source = null;
    this.input = stream;
    this.inputTracks = tracks;
    if (!tracks.length) return;
    // Remote streams can gain or replace audio tracks without changing identity.
    // Restrict the source to current live audio; never stop caller-owned tracks.
    this.source = this.context.createMediaStreamSource(new MediaStream(tracks));
    this.source.connect(this.destination);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.source?.disconnect();
    this.source = null;
    this.input = null;
    this.inputTracks = [];
    this.destination.disconnect();
    this.stream.getTracks().forEach((track) => track.stop());
    void this.context.close();
  }
}
