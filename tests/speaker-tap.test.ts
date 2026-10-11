import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpeakerTap } from '../src/call/speakerTap';

class SyntheticStream {
  constructor(public tracks: MediaStreamTrack[] = []) {}
  getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
  getTracks() { return [...this.tracks]; }
}
function track(id: string, kind = 'audio') {
  return { id, kind, readyState: 'live', stop: vi.fn() } as unknown as MediaStreamTrack;
}
const stream = (...tracks: MediaStreamTrack[]) => new SyntheticStream(tracks) as unknown as MediaStream;
function audioContext() {
  const ownedStop = vi.fn();
  const destination = { stream: { getTracks: () => [{ stop: ownedStop }] }, disconnect: vi.fn() };
  const sources: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
  const context = {
    createMediaStreamDestination: () => destination,
    createMediaStreamSource: vi.fn((_stream: MediaStream) => {
      void _stream;
      const source = { connect: vi.fn(), disconnect: vi.fn() };
      sources.push(source);
      return source;
    }),
    resume: vi.fn(async () => {}), state: 'running', close: vi.fn(async () => {}),
  };
  return { context, destination, sources, ownedStop, tap: new SpeakerTap(context as unknown as AudioContext) };
}

beforeEach(() => vi.stubGlobal('MediaStream', SyntheticStream));
afterEach(() => vi.unstubAllGlobals());

describe('stable isolated per-speaker recording input', () => {
  it('rewires selected device without mixing speakers or stopping caller-owned tracks', async () => {
    const f = audioContext(), first = track('first'), second = track('second');
    const output = f.tap.stream;
    await f.tap.resume();
    f.tap.setInput(stream(first));
    f.tap.setInput(stream(second));
    expect(f.sources[0].disconnect).toHaveBeenCalledOnce();
    expect(f.sources[1].connect).toHaveBeenCalledWith(f.destination);
    expect(f.context.createMediaStreamSource.mock.calls.map(([input]) => input.getAudioTracks())).toEqual([[first], [second]]);
    expect(f.tap.stream).toBe(output);
    f.tap.close(); f.tap.close();
    expect(f.ownedStop).toHaveBeenCalledOnce();
    expect(f.context.close).toHaveBeenCalledOnce();
    expect(first.stop).not.toHaveBeenCalled();
    expect(second.stop).not.toHaveBeenCalled();
  });

  it('connects audio added later to the same video-first remote stream', () => {
    const f = audioContext(), remote = new SyntheticStream([track('camera', 'video')]);
    f.tap.setInput(remote as unknown as MediaStream);
    expect(f.context.createMediaStreamSource).not.toHaveBeenCalled();
    const microphone = track('remote-audio');
    remote.tracks.push(microphone);
    f.tap.setInput(remote as unknown as MediaStream);
    expect(f.context.createMediaStreamSource).toHaveBeenCalledOnce();
    expect(f.context.createMediaStreamSource.mock.calls[0][0].getTracks()).toEqual([microphone]);
    f.tap.close();
    expect(microphone.stop).not.toHaveBeenCalled();
  });

  it('reconnects replaced live audio inside one stream and disconnects when it ends', () => {
    const f = audioContext(), old = track('old'), replacement = track('replacement');
    const remote = new SyntheticStream([old]);
    const output = f.tap.stream;
    f.tap.setInput(remote as unknown as MediaStream);
    Object.assign(old, { readyState: 'ended' });
    remote.tracks.push(replacement);
    f.tap.setInput(remote as unknown as MediaStream);
    expect(f.sources[0].disconnect).toHaveBeenCalledOnce();
    expect(f.context.createMediaStreamSource.mock.calls[1][0].getTracks()).toEqual([replacement]);
    Object.assign(replacement, { readyState: 'ended' });
    f.tap.setInput(remote as unknown as MediaStream);
    expect(f.sources[1].disconnect).toHaveBeenCalledOnce();
    expect(f.context.createMediaStreamSource).toHaveBeenCalledTimes(2);
    expect(f.tap.stream).toBe(output);
    f.tap.close();
    expect(old.stop).not.toHaveBeenCalled();
    expect(replacement.stop).not.toHaveBeenCalled();
  });

  it('does not recreate the graph when the live audio tracks are unchanged', () => {
    const f = audioContext(), remote = stream(track('audio'));
    f.tap.setInput(remote); f.tap.setInput(remote);
    expect(f.context.createMediaStreamSource).toHaveBeenCalledOnce();
    expect(f.sources[0].disconnect).not.toHaveBeenCalled();
    f.tap.setInput(null);
    expect(f.sources[0].disconnect).toHaveBeenCalledOnce();
    f.tap.close();
  });

  it('fails honestly when autoplay prevents recording context resume', async () => {
    const f = audioContext(); f.context.state = 'suspended';
    await expect(f.tap.resume()).rejects.toThrow('paused');
    f.tap.close();
  });
});
