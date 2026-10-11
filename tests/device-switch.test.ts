import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaEngine } from '../vendor/serenada-core/src/media/MediaEngine';
import { SerenadaSession } from '../vendor/serenada-core/src/SerenadaSession';
import type { SignalingProvider } from '../vendor/serenada-core/src/SignalingProvider';

// These tests never construct a real peer connection or request real devices.
class FixtureStream {
  private tracks: MediaStreamTrack[];
  constructor(tracks: MediaStreamTrack[] = []) { this.tracks = [...tracks]; }
  getTracks() { return [...this.tracks]; }
  getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
  addTrack(track: MediaStreamTrack) { this.tracks.push(track); }
  removeTrack(track: MediaStreamTrack) { this.tracks = this.tracks.filter(candidate => candidate !== track); }
}
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function input(kind: 'audio' | 'video', deviceId: string, enabled = true) {
  const track = {
    kind, id: `${kind}-${deviceId}`, enabled, muted: false, contentHint: '',
    readyState: 'live' as MediaStreamTrackState,
    getSettings: vi.fn(() => ({ deviceId, groupId: `group-${deviceId}` })),
    stop: vi.fn(() => { track.readyState = 'ended'; }),
  };
  return track as unknown as MediaStreamTrack;
}
function device(deviceId: string, kind: MediaDeviceKind = 'audioinput', groupId = `group-${deviceId}`): MediaDeviceInfo {
  return { deviceId, kind, groupId, label: deviceId, toJSON: () => ({}) };
}
function sender(track: MediaStreamTrack | null) {
  const result = { track, replaceTrack: vi.fn(async (next: MediaStreamTrack | null) => { result.track = next; }) };
  return result;
}
function attachPeer(engine: MediaEngine, tracks: MediaStreamTrack[], id = 'fixture-peer', independent = false) {
  const senders = tracks.map(sender);
  const transceivers = senders.map((entry, index) => ({
    sender: entry, receiver: { track: tracks[index] }, mid: String(index),
    direction: 'sendrecv', currentDirection: 'sendrecv',
  }));
  const pc = {
    getSenders: () => [...senders], getTransceivers: () => [...transceivers],
    addTrack: vi.fn((track: MediaStreamTrack) => { const added = sender(track); senders.push(added); return added; }),
    removeTrack: vi.fn((entry: typeof senders[number]) => { entry.track = null; }), close: vi.fn(),
  };
  const peer = {
    pc, supportsIndependentContentVideo: independent, pendingRemoteIceByOfferId: new Map(),
    mediaRoles: independent ? { audio: transceivers[0], camera: transceivers[1], content: transceivers[2] } : {},
  };
  (engine as unknown as { peers: Map<string, unknown> }).peers.set(id, peer);
  return { pc, senders, transceivers };
}
let getUserMedia: ReturnType<typeof vi.fn>;
let enumerateDevices: ReturnType<typeof vi.fn>;
let mediaDevices: EventTarget;
let engines: MediaEngine[];
function engine(...tracks: MediaStreamTrack[]) {
  const result = new MediaEngine({}, vi.fn());
  engines.push(result);
  result.localStream = new MediaStream(tracks);
  return result;
}
async function flush() { for (let index = 0; index < 12; index++) await Promise.resolve(); }
async function refreshDevices(value: MediaEngine) {
  await (value as unknown as { refreshDevicesAfterChange(reason: string): Promise<void> }).refreshDevicesAfterChange('fixture-devicechange');
}
beforeEach(() => {
  vi.useFakeTimers();
  engines = [];
  getUserMedia = vi.fn();
  enumerateDevices = vi.fn(async () => [] as MediaDeviceInfo[]);
  mediaDevices = Object.assign(new EventTarget(), { getUserMedia, enumerateDevices });
  vi.stubGlobal('navigator', { mediaDevices });
  vi.stubGlobal('MediaStream', FixtureStream);
  vi.stubGlobal('RTCPeerConnection', vi.fn(() => { throw new Error('Real peer connections are forbidden in this fixture'); }));
});
afterEach(() => {
  for (const item of engines) item.destroy();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('real call input selection with synthetic media', () => {
  it('replaces outgoing microphone senders, preserves mute, releases old input, and notifies with the new stream', async () => {
    const original = input('audio', 'old', false), camera = input('video', 'camera'), next = input('audio', 'chosen');
    const call = engine(original, camera), peer = attachPeer(call, [original, camera]);
    const seen: (MediaStream | null)[] = [];
    call.setOnChange(() => seen.push(call.localStream));
    getUserMedia.mockResolvedValueOnce(new MediaStream([next]));
    await call.setInputDevice('audio', 'chosen');
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: expect.objectContaining({ deviceId: { exact: 'chosen' } }), video: false });
    expect(peer.senders[0].replaceTrack).toHaveBeenCalledExactlyOnceWith(next);
    expect(peer.senders[1].replaceTrack).not.toHaveBeenCalled();
    expect(next.enabled).toBe(false);
    expect(original.stop).toHaveBeenCalledOnce();
    expect(camera.stop).not.toHaveBeenCalled();
    expect(call.localStream?.getTracks()).toEqual([camera, next]);
    expect(seen.at(-1)).toBe(call.localStream);
  });

  it('replaces the camera role without touching independent content or audio', async () => {
    const audio = input('audio', 'mic'), camera = input('video', 'old'), content = input('video', 'content'), next = input('video', 'chosen');
    const call = engine(audio, camera), peer = attachPeer(call, [audio, camera, content], 'independent', true);
    getUserMedia.mockResolvedValueOnce(new MediaStream([next]));
    await call.setInputDevice('video', 'chosen');
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: false, video: { deviceId: { exact: 'chosen' } } });
    expect(peer.senders[1].track).toBe(next);
    expect(peer.senders[0].replaceTrack).not.toHaveBeenCalled();
    expect(peer.senders[2].replaceTrack).not.toHaveBeenCalled();
    expect(camera.stop).toHaveBeenCalledOnce();
  });

  it('selects an off camera without acquiring it and uses that exact device on next enable', async () => {
    const audio = input('audio', 'mic'), next = input('video', 'chosen');
    const call = engine(audio);
    await call.setInputDevice('video', 'chosen');
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(call.localStream?.getVideoTracks()).toEqual([]);
    getUserMedia.mockResolvedValueOnce(new MediaStream([next]));
    await call.reacquireVideoTrack();
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: false, video: { deviceId: { exact: 'chosen' } } });
    expect(call.localStream?.getVideoTracks()).toEqual([next]);
    await call.releaseVideoTrack();
    expect(next.stop).toHaveBeenCalledOnce();
    expect(call.localStream?.getVideoTracks()).toEqual([]);
  });

  it('also preserves a disabled camera track', async () => {
    const old = input('video', 'old', false), next = input('video', 'chosen');
    const call = engine(input('audio', 'mic'), old);
    getUserMedia.mockResolvedValueOnce(new MediaStream([next]));
    await call.setInputDevice('video', 'chosen');
    expect(next.enabled).toBe(false);
  });

  it.each(['audio', 'video'] as const)('propagates exact %s capture failures without default-device fallback', async kind => {
    const old = input(kind, 'old'), call = engine(old), failure = new DOMException('Unavailable', 'NotFoundError');
    getUserMedia.mockRejectedValueOnce(failure);
    await expect(call.setInputDevice(kind, 'missing')).rejects.toBe(failure);
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(call.localStream?.getTracks()).toEqual([old]);
    expect(old.stop).not.toHaveBeenCalled();
  });

  it('keeps only the latest choice when permission grants resolve in reverse order', async () => {
    const old = input('audio', 'old'), first = input('audio', 'first'), latest = input('audio', 'latest');
    const call = engine(old), peer = attachPeer(call, [old]);
    const earlier = deferred<MediaStream>(), later = deferred<MediaStream>();
    getUserMedia.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(later.promise);
    const stale = call.setInputDevice('audio', 'first').catch(error => error);
    const current = call.setInputDevice('audio', 'latest');
    later.resolve(new MediaStream([latest]));
    await current;
    earlier.resolve(new MediaStream([first]));
    expect(await stale).toMatchObject({ name: 'AbortError' });
    expect(first.stop).toHaveBeenCalledOnce();
    expect(latest.stop).not.toHaveBeenCalled();
    expect(call.localStream?.getAudioTracks()).toEqual([latest]);
    expect(peer.senders[0].track).toBe(latest);
  });

  it('serializes replacement commits so a superseded sender completion cannot win', async () => {
    const old = input('audio', 'old'), first = input('audio', 'first'), latest = input('audio', 'latest');
    const call = engine(old), peer = attachPeer(call, [old]), replacing = deferred<void>();
    peer.senders[0].replaceTrack.mockImplementationOnce(async track => { await replacing.promise; peer.senders[0].track = track; });
    getUserMedia.mockResolvedValueOnce(new MediaStream([first])).mockResolvedValueOnce(new MediaStream([latest]));
    const stale = call.setInputDevice('audio', 'first').catch(error => error);
    await flush();
    const current = call.setInputDevice('audio', 'latest');
    replacing.resolve();
    expect(await stale).toMatchObject({ name: 'AbortError' });
    await current;
    expect(peer.senders[0].track).toBe(latest);
    expect(first.readyState).toBe('ended');
    expect(call.localStream?.getAudioTracks()).toEqual([latest]);
  });

  it.each(['audio', 'video'] as const)('stops a late %s permission grant after destroy', async kind => {
    const old = input(kind, 'old'), next = input(kind, 'chosen'), call = engine(old), permission = deferred<MediaStream>();
    getUserMedia.mockReturnValueOnce(permission.promise);
    const result = call.setInputDevice(kind, 'chosen').catch(error => error);
    call.destroy();
    permission.resolve(new MediaStream([next]));
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(next.stop).toHaveBeenCalledOnce();
    expect(call.localStream).toBeNull();
  });

  it('does not reactivate video when the camera is toggled off during permission', async () => {
    const old = input('video', 'old'), next = input('video', 'chosen'), call = engine(input('audio', 'mic'), old);
    const peer = attachPeer(call, [old]), permission = deferred<MediaStream>();
    getUserMedia.mockReturnValueOnce(permission.promise);
    const result = call.setInputDevice('video', 'chosen').catch(error => error);
    await call.releaseVideoTrack();
    permission.resolve(new MediaStream([next]));
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(call.localStream?.getVideoTracks()).toEqual([]);
    expect(next.stop).toHaveBeenCalledOnce();
    expect(peer.senders[0].track).toBeNull();
  });

  it('keeps the camera off when disabled during an in-flight sender replacement', async () => {
    const old = input('video', 'old'), next = input('video', 'chosen'), call = engine(input('audio', 'mic'), old);
    const peer = attachPeer(call, [old]), replacing = deferred<void>();
    peer.senders[0].replaceTrack.mockImplementationOnce(async track => { await replacing.promise; peer.senders[0].track = track; });
    getUserMedia.mockResolvedValueOnce(new MediaStream([next]));
    const selection = call.setInputDevice('video', 'chosen').catch(error => error);
    await flush();
    const releasing = call.releaseVideoTrack();
    expect(old.readyState).toBe('ended');
    expect(next.readyState).toBe('ended');
    expect(call.localStream?.getVideoTracks()).toEqual([]);
    replacing.resolve();
    expect(await selection).toMatchObject({ name: 'AbortError' });
    await releasing;
    expect(peer.senders[0].track).toBeNull();
  });

  it('cancels camera re-enable capture on a newer toggle-off and permits a later enable', async () => {
    const stale = input('video', 'stale'), latest = input('video', 'latest'), call = engine(input('audio', 'mic'));
    const permission = deferred<MediaStream>();
    getUserMedia.mockReturnValueOnce(permission.promise).mockResolvedValueOnce(new MediaStream([latest]));
    const reenable = call.reacquireVideoTrack();
    await call.releaseVideoTrack();
    await call.reacquireVideoTrack();
    permission.resolve(new MediaStream([stale]));
    await reenable;
    expect(stale.readyState).toBe('ended');
    expect(call.localStream?.getVideoTracks()).toEqual([latest]);
  });

  it('rejects failed independent camera replacement without touching content', async () => {
    const audio = input('audio', 'mic'), old = input('video', 'old'), content = input('video', 'content'), next = input('video', 'chosen');
    const call = engine(audio, old), peer = attachPeer(call, [audio, old, content], 'roles', true);
    peer.senders[1].replaceTrack.mockRejectedValueOnce(new Error('camera sender failed'));
    getUserMedia.mockResolvedValueOnce(new MediaStream([next]));
    await expect(call.setInputDevice('video', 'chosen')).rejects.toThrow('Could not replace call input');
    expect(peer.senders[1].track).toBe(old);
    expect(peer.senders[2].replaceTrack).not.toHaveBeenCalled();
    expect(next.readyState).toBe('ended');
    expect(old.readyState).toBe('live');
  });

  it('rolls back newly added senders when another peer rejects replacement', async () => {
    const old = input('audio', 'old'), next = input('audio', 'chosen'), call = engine(old);
    const added = attachPeer(call, [], 'new-peer'), failing = attachPeer(call, [old], 'failed-peer');
    failing.senders[0].replaceTrack.mockRejectedValueOnce(new Error('failed'));
    getUserMedia.mockResolvedValueOnce(new MediaStream([next]));
    await expect(call.setInputDevice('audio', 'chosen')).rejects.toThrow('Could not replace call input');
    expect(added.pc.addTrack).toHaveBeenCalledOnce();
    expect(added.pc.removeTrack).toHaveBeenCalledExactlyOnceWith(added.senders[0]);
    expect(added.senders[0].track).toBeNull();
    expect(call.localStream?.getAudioTracks()).toEqual([old]);
  });

  it('honors microphone mute changes made while sender replacement is pending', async () => {
    const old = input('audio', 'old'), next = input('audio', 'chosen'), call = engine(old), peer = attachPeer(call, [old]);
    const replacing = deferred<void>();
    peer.senders[0].replaceTrack.mockImplementationOnce(async track => { await replacing.promise; peer.senders[0].track = track; });
    getUserMedia.mockResolvedValueOnce(new MediaStream([next]));
    const result = call.setInputDevice('audio', 'chosen');
    await flush();
    old.enabled = false;
    replacing.resolve();
    await result;
    expect(next.enabled).toBe(false);
  });

  it.each(['audio', 'video'] as const)('rolls back every peer and rejects a failed %s replacement', async kind => {
    const old = input(kind, 'old'), next = input(kind, 'chosen'), call = engine(old);
    const first = attachPeer(call, [old], 'one'), second = attachPeer(call, [old], 'two');
    second.senders[0].replaceTrack.mockRejectedValueOnce(new Error('synthetic replaceTrack failure'));
    getUserMedia.mockResolvedValueOnce(new MediaStream([next]));
    await expect(call.setInputDevice(kind, 'chosen')).rejects.toThrow('Could not replace call input');
    expect(first.senders[0].replaceTrack.mock.calls).toEqual([[next], [old]]);
    expect(first.senders[0].track).toBe(old);
    expect(second.senders[0].track).toBe(old);
    expect(call.localStream?.getTracks()).toEqual([old]);
    expect(old.stop).not.toHaveBeenCalled();
    expect(next.stop).toHaveBeenCalledOnce();
  });

  it('waits for delayed peers before rollback on an earlier failure', async () => {
    const old = input('audio', 'old'), next = input('audio', 'chosen'), call = engine(old);
    const first = attachPeer(call, [old], 'one'), second = attachPeer(call, [old], 'two'), delayed = deferred<void>();
    first.senders[0].replaceTrack.mockRejectedValueOnce(new Error('failed'));
    second.senders[0].replaceTrack.mockImplementationOnce(async track => { await delayed.promise; second.senders[0].track = track; });
    getUserMedia.mockResolvedValueOnce(new MediaStream([next]));
    const result = call.setInputDevice('audio', 'chosen').catch(error => error);
    await flush();
    expect(next.stop).not.toHaveBeenCalled();
    delayed.resolve();
    expect(await result).toBeInstanceOf(AggregateError);
    expect(second.senders[0].track).toBe(old);
    expect(next.stop).toHaveBeenCalledOnce();
  });

  it('reports rollback failure rather than claiming success and stops the rejected new input', async () => {
    const old = input('audio', 'old'), next = input('audio', 'chosen'), call = engine(old);
    const first = attachPeer(call, [old], 'one'), second = attachPeer(call, [old], 'two');
    first.senders[0].replaceTrack.mockImplementationOnce(async track => { first.senders[0].track = track; }).mockRejectedValueOnce(new Error('rollback failed'));
    second.senders[0].replaceTrack.mockRejectedValueOnce(new Error('replace failed'));
    getUserMedia.mockResolvedValueOnce(new MediaStream([next]));
    await expect(call.setInputDevice('audio', 'chosen')).rejects.toThrow('some peers could not restore');
    expect(next.readyState).toBe('ended');
    expect(call.localStream?.getAudioTracks()).toEqual([old]);
  });

  it('does not let devicechange route correction replace a healthy explicit microphone', async () => {
    const old = input('audio', 'old'), chosen = input('audio', 'chosen'), call = engine(old);
    getUserMedia.mockResolvedValueOnce(new MediaStream([chosen]));
    await call.setInputDevice('audio', 'chosen');
    enumerateDevices.mockResolvedValue([device('default', 'audioinput', 'group-other'), device('other'), device('chosen')]);
    mediaDevices.dispatchEvent(new Event('devicechange'));
    await flush();
    await vi.advanceTimersByTimeAsync(2000);
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(call.localStream?.getAudioTracks()).toEqual([chosen]);
  });

  it('discards an automatic route acquisition overtaken by an explicit choice', async () => {
    const old = input('audio', 'old'), auto = input('audio', 'auto'), chosen = input('audio', 'chosen'), call = engine(old);
    enumerateDevices.mockResolvedValue([device('default', 'audioinput', 'group-auto'), device('auto')]);
    const pending = deferred<MediaStream>();
    getUserMedia.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(new MediaStream([chosen]));
    const automatic = refreshDevices(call);
    await flush();
    await call.setInputDevice('audio', 'chosen');
    pending.resolve(new MediaStream([auto]));
    await automatic;
    expect(auto.stop).toHaveBeenCalledOnce();
    expect(call.localStream?.getAudioTracks()).toEqual([chosen]);
  });

  it('does not stop a committed input if a subscriber immediately starts another selection', async () => {
    const old = input('audio', 'old'), first = input('audio', 'first'), call = engine(old), pending = deferred<MediaStream>();
    getUserMedia.mockResolvedValueOnce(new MediaStream([first])).mockReturnValueOnce(pending.promise);
    let second: Promise<unknown> | undefined;
    call.setOnChange(() => { if (!second) second = call.setInputDevice('audio', 'second').catch(error => error); });
    await call.setInputDevice('audio', 'first');
    expect(first.readyState).toBe('live');
    pending.reject(new Error('denied'));
    expect(await second).toMatchObject({ message: 'denied' });
    expect(call.localStream?.getAudioTracks()).toEqual([first]);
  });

  it('releases unexpected extra acquired tracks and rejects missing selected tracks', async () => {
    const old = input('audio', 'old'), next = input('audio', 'chosen'), extra = input('video', 'unexpected'), call = engine(old);
    getUserMedia.mockResolvedValueOnce(new MediaStream([next, extra]));
    await call.setInputDevice('audio', 'chosen');
    expect(extra.stop).toHaveBeenCalledOnce();
    const wrong = input('video', 'wrong');
    getUserMedia.mockResolvedValueOnce(new MediaStream([wrong]));
    await expect(call.setInputDevice('audio', 'missing')).rejects.toThrow('No audio track');
    expect(wrong.stop).toHaveBeenCalledOnce();
    expect(call.localStream?.getAudioTracks()).toEqual([next]);
  });

  it('rejects inactive inputs and video-unsupported engines without capture', async () => {
    const call = engine(input('audio', 'old'));
    await expect(call.setInputDevice('audio', '')).rejects.toThrow('device ID');
    call.stopLocalMedia();
    await expect(call.setInputDevice('audio', 'chosen')).rejects.toMatchObject({ name: 'InvalidStateError' });
    const audioOnly = new MediaEngine({ videoCaptureSupported: false }, vi.fn());
    engines.push(audioOnly);
    audioOnly.localStream = new MediaStream([input('audio', 'mic')]);
    await expect(audioOnly.setInputDevice('video', 'chosen')).rejects.toMatchObject({ name: 'NotSupportedError' });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('public session mute immediately silences an input already replacing outgoing senders', async () => {
    const old = input('audio', 'old'), next = input('audio', 'chosen'), call = engine(old), peer = attachPeer(call, [old]);
    const replacing = deferred<void>();
    peer.senders[0].replaceTrack.mockImplementationOnce(async track => { peer.senders[0].track = track; await replacing.promise; });
    const signaling = { on: vi.fn(), off: vi.fn(), disconnect: vi.fn(), broadcast: vi.fn() };
    const session = new SerenadaSession({}, 'fixture-room', null, signaling as unknown as SignalingProvider, { media: call, autoStart: false });
    getUserMedia.mockResolvedValueOnce(new MediaStream([next]));
    const selection = session.setInputDevice('audio', 'chosen');
    await flush();
    session.setAudioEnabled(false);
    expect(old.enabled).toBe(false);
    expect(next.enabled).toBe(false);
    expect(peer.senders[0].track?.enabled).toBe(false);
    replacing.resolve();
    await selection;
    expect(next.enabled).toBe(false);
    session.destroy();
  });

  it('public session delegates actual input replacement and notifies subscribers before resolving', async () => {
    const old = input('audio', 'old'), next = input('audio', 'chosen'), call = engine(old);
    const signaling = { on: vi.fn(), off: vi.fn(), disconnect: vi.fn(), broadcast: vi.fn() };
    const session = new SerenadaSession({}, 'fixture-room', null, signaling as unknown as SignalingProvider, { media: call, autoStart: false });
    Object.assign(session, { clientId: 'fixture-self' });
    const streams: (MediaStream | null)[] = [];
    session.subscribe(() => streams.push(session.localStream));
    getUserMedia.mockResolvedValueOnce(new MediaStream([next]));
    await session.setInputDevice('audio', 'chosen');
    expect(session.localStream?.getAudioTracks()).toEqual([next]);
    expect(streams.at(-1)).toBe(session.localStream);
    expect(session.state.localParticipant?.audioEnabled).toBe(true);
    session.destroy();
    await expect(session.setInputDevice('audio', 'other')).rejects.toMatchObject({ name: 'InvalidStateError' });
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(signaling.broadcast).not.toHaveBeenCalled();
  });
});
