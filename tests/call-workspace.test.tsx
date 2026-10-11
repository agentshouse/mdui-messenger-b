import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { SerenadaSessionHandle } from '../vendor/serenada-core/src/types';
import type { CallControllerState } from '../src/call/callController';
import type { CallPart, CommitResult, SpeakerFile } from '../src/call/callParts';
import type { PartWriterOptions } from '../src/call/partWriter';
import type { SpeakerInput, SpeakerRecorderOptions } from '../src/call/speakerRecorder';
import type { Chat } from '../src/data/model';
import { CallWorkspace } from '../src/components/CallWorkspace';

type FixtureController = {
  current: CallControllerState;
  publish: (next: CallControllerState) => void;
  accept: ReturnType<typeof vi.fn>;
  decline: ReturnType<typeof vi.fn>;
  hangup: ReturnType<typeof vi.fn>;
  sendPartSent: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};
type FixtureTap = {
  closed: boolean; stream: MediaStream;
  close: ReturnType<typeof vi.fn>; setInput: ReturnType<typeof vi.fn>;
};
type FixtureRecorder = {
  inputs: readonly SpeakerInput[]; options: SpeakerRecorderOptions;
  start: ReturnType<typeof vi.fn>; rotate: ReturnType<typeof vi.fn<() => Promise<readonly SpeakerFile[]>>>;
  finish: ReturnType<typeof vi.fn<() => Promise<readonly SpeakerFile[]>>>; discard: ReturnType<typeof vi.fn>;
};
type FixtureWriter = {
  options: PartWriterOptions; dispose: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn<(part: CallPart) => Promise<CommitResult>>>;
  reconcile: ReturnType<typeof vi.fn<(part: CallPart) => Promise<CommitResult>>>;
};
const fixture = vi.hoisted(() => ({
  controllers: [] as FixtureController[], taps: [] as FixtureTap[],
  recorders: [] as FixtureRecorder[], writers: [] as FixtureWriter[],
  startFailures: [] as Error[], results: [] as (CommitResult | Promise<CommitResult>)[],
  reconciliations: [] as (CommitResult | Promise<CommitResult>)[],
  time: 100,
  runtime: {},
}));
vi.mock('../src/data/house', () => ({ houseRuntime: vi.fn(async () => fixture.runtime) }));
vi.mock('../src/call/houseCalls', () => ({
  HouseCallAPI: class {
    holders = vi.fn(async () => [{ user: 'u_remote', name: 'Remote person' }]);
  },
}));
vi.mock('../src/call/callController', () => ({
  HouseCallController: class {
    current: CallControllerState = { phase: 'idle', participants: [], session: null, sessionState: null, lastRemotePartSent: 0 };
    private listeners = new Set<(state: CallControllerState) => void>();
    constructor() { fixture.controllers.push(this); }
    subscribe = (callback: (state: CallControllerState) => void) => {
      this.listeners.add(callback); return () => { this.listeners.delete(callback); };
    };
    publish = (next: CallControllerState) => { this.current = next; for (const callback of this.listeners) callback(next); };
    startOutgoing = vi.fn(async () => {});
    accept = vi.fn(async () => {});
    decline = vi.fn(async () => {});
    sendPartSent = vi.fn(async () => {});
    hangup = vi.fn(async () => { this.publish({ ...this.current, phase: 'ended', session: null, sessionState: null }); });
    dispose = vi.fn();
  },
}));
vi.mock('../src/call/speakerTap', () => ({
  SpeakerTap: class {
    closed = false;
    stream = { fixtureTap: fixture.taps.length } as unknown as MediaStream;
    constructor() { fixture.taps.push(this); }
    resume = vi.fn(async () => { if (this.closed) throw new Error('Closed tap was resumed'); });
    setInput = vi.fn(() => { if (this.closed) throw new Error('Closed tap was reused'); });
    close = vi.fn(() => { this.closed = true; });
  },
}));
vi.mock('../src/call/speakerRecorder', () => ({
  IndependentSpeakerRecorder: class {
    constructor(readonly inputs: readonly SpeakerInput[], readonly options: SpeakerRecorderOptions) { fixture.recorders.push(this); }
    private files(): readonly SpeakerFile[] {
      return this.inputs.map(input => ({ speakerId: input.speakerId, blob: new Blob(['synthetic complete container'], { type: 'audio/webm' }), container: 'complete' }));
    }
    start = vi.fn(() => { const failure = fixture.startFailures.shift(); if (failure) throw failure; });
    rotate = vi.fn(async () => this.files());
    finish = vi.fn(async () => this.files());
    discard = vi.fn();
  },
}));
vi.mock('../src/call/partWriter', () => ({
  HouseCallPartWriter: class {
    constructor(readonly options: PartWriterOptions) { fixture.writers.push(this); }
    commit = vi.fn(async (_part: CallPart): Promise<CommitResult> => {
      void _part;
      return await (fixture.results.shift() ?? { outcome: 'committed' });
    });
    reconcile = vi.fn(async (_part: CallPart): Promise<CommitResult> => {
      void _part;
      return await (fixture.reconciliations.shift() ?? { outcome: 'committed' });
    });
    dispose = vi.fn();
  },
}));
vi.mock('../vendor/serenada-react-ui/src/SerenadaCallFlow', () => ({
  SerenadaCallFlow: ({ onEndCall }: { onEndCall: () => void }) => <button onClick={onEndCall}>End fixture call</button>,
}));
vi.mock('../vendor/peerix-picker/media-button', () => ({
  MediaButton: ({ kind, onToggle }: { kind: string; onToggle: () => void }) => <button onClick={onToggle}>Toggle fixture {kind}</button>,
}));
vi.mock('../src/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <section>{children}</section> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
};
const room: Chat = {
  room: 'r_recording', roomName: 'Fixture room', path: 'chats/main.md', id: 'fixture-chat', title: 'Original recording Room', mode: 'direct', created_at: '2026-10-11T10:00:00Z',
};
function activeState(callId = 'wire-call-one'): CallControllerState {
  const session = {
    localStream: { fixture: 'local' } as unknown as MediaStream,
    remoteStreams: new Map([['remote-peer', { fixture: 'remote' } as unknown as MediaStream]]),
    toggleAudio: vi.fn(), toggleVideo: vi.fn(), setInputDevice: vi.fn(async () => {}),
  } as unknown as SerenadaSessionHandle;
  return {
    phase: 'active', callId, mode: 'audio', recordingRoom: room.room, remoteName: 'Remote person', localPeerId: 'local-peer', remotePeerId: 'remote-peer',
    participants: [{ id: 'local-peer', name: 'This device', isLocal: true }, { id: 'remote-peer', name: 'Remote person', isLocal: false }],
    session, sessionState: null, lastRemotePartSent: 0,
  };
}
async function publish(controller: FixtureController, state: CallControllerState) {
  await act(async () => { controller.publish(state); });
}
async function mountActive() {
  const onOpenChange = vi.fn();
  const view = render(<CallWorkspace rooms={[room]} preferredRoom={room.room} open onOpenChange={onOpenChange} />);
  await waitFor(() => expect(fixture.controllers).toHaveLength(1));
  const controller = fixture.controllers[0], active = activeState();
  await publish(controller, active);
  await waitFor(() => expect(fixture.recorders[0]?.start).toHaveBeenCalledOnce());
  return { ...view, controller, active, onOpenChange };
}
function incoming(controller: FixtureController) {
  return publish(controller, { ...activeState('wire-call-two'), phase: 'incoming', recordingRoom: undefined, session: null });
}
function advance() { fixture.time += 1000; }
async function hangup() {
  advance();
  fireEvent.click(screen.getByRole('button', { name: 'End fixture call' }));
  await waitFor(() => expect(fixture.controllers[0].hangup).toHaveBeenCalledOnce());
}
function blockedAnswer() {
  expect((screen.getByRole('button', { name: 'Answer' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('Send or discard the previous local recording before answering.')).toBeTruthy();
}
beforeEach(() => {
  fixture.controllers.length = fixture.taps.length = fixture.recorders.length = fixture.writers.length = 0;
  fixture.startFailures.length = fixture.results.length = fixture.reconciliations.length = 0;
  fixture.time = 100;
  vi.spyOn(performance, 'now').mockImplementation(() => fixture.time);
  vi.stubGlobal('AudioContext', vi.fn(() => { throw new Error('Real audio graphs are forbidden in these integration fixtures'); }));
  vi.stubGlobal('MediaRecorder', vi.fn(() => { throw new Error('Real capture is forbidden in these integration fixtures'); }));
  vi.stubGlobal('RTCPeerConnection', vi.fn(() => { throw new Error('Real calls are forbidden in these integration fixtures'); }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('CallWorkspace capture and explicit-send integration', () => {
  it('releases a startup recorder failure, never reuses closed taps, and retries only on request', async () => {
    fixture.startFailures.push(new Error('Synthetic startup recorder failure'));
    const { controller, active } = await mountActive();
    expect(screen.getByRole('alert').textContent).toContain('Synthetic startup recorder failure');
    expect(fixture.taps.slice(0, 2).every(tap => tap.closed)).toBe(true);
    expect(fixture.writers[0].dispose).toHaveBeenCalledOnce();
    expect(fixture.recorders[0].discard).toHaveBeenCalledOnce();
    await publish(controller, { ...active });
    expect(fixture.recorders).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry local recording' }));
    await waitFor(() => expect(fixture.recorders).toHaveLength(2));
    expect(fixture.recorders[1].start).toHaveBeenCalledOnce();
    expect(fixture.taps).toHaveLength(4);
    expect(fixture.taps.slice(2).every(tap => !tap.closed)).toBe(true);
    expect(screen.getByText(/Recording locally/)).toBeTruthy();
    expect(fixture.writers.every(writer => writer.commit.mock.calls.length === 0)).toBe(true);
  });

  it('restarts a failed mid-call recording with fresh taps when no explicit part is pending', async () => {
    const { controller, active } = await mountActive();
    act(() => fixture.recorders[0].options.onFailure?.(new Error('Synthetic live encoder failure')));
    expect(fixture.taps.slice(0, 2).every(tap => tap.closed)).toBe(true);
    expect(fixture.recorders[0].discard).toHaveBeenCalledOnce();
    await publish(controller, { ...active });
    const retry = screen.getByRole('button', { name: 'Retry local recording' }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    fireEvent.click(retry);
    await waitFor(() => expect(fixture.recorders).toHaveLength(2));
    expect(fixture.recorders[1].start).toHaveBeenCalledOnce();
    expect(fixture.writers[0].dispose).toHaveBeenCalledOnce();
    expect(fixture.writers.every(writer => writer.commit.mock.calls.length === 0)).toBe(true);
  });

  it('retains a frozen pending explicit send after capture failure and blocks local retry until resolved', async () => {
    const pending = deferred<CommitResult>(); fixture.results.push(pending.promise);
    const { controller, active } = await mountActive();
    advance(); fireEvent.click(screen.getByRole('button', { name: 'Send to Room' }));
    await waitFor(() => expect(fixture.writers[0].commit).toHaveBeenCalledOnce());
    const originalPart = fixture.writers[0].commit.mock.calls[0][0];
    act(() => fixture.recorders[0].options.onFailure?.(new Error('Encoder stopped after Send')));
    expect((screen.getByRole('button', { name: 'Retry local recording' }) as HTMLButtonElement).disabled).toBe(true);
    await publish(controller, { ...active });
    expect(fixture.writers[0].dispose).not.toHaveBeenCalled();
    expect(fixture.recorders).toHaveLength(1);
    await act(async () => pending.resolve({ outcome: 'uncertain', reason: 'No provider acknowledgement' }));
    expect(screen.getByText('Part 1: uncertain')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry local recording' }));
    expect(fixture.recorders).toHaveLength(1);
    fixture.reconciliations.push({ outcome: 'rejected', reason: 'Verified not committed' });
    fireEvent.click(screen.getByRole('button', { name: 'Recheck saved part' }));
    await waitFor(() => expect(screen.getByText('Part 1: rejected')).toBeTruthy());
    expect(fixture.writers[0].reconcile).toHaveBeenCalledExactlyOnceWith(originalPart);
    expect((screen.getByRole('button', { name: 'Retry local recording' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry this part' }));
    await waitFor(() => expect(fixture.writers[0].commit).toHaveBeenCalledTimes(2));
    expect(fixture.writers[0].commit.mock.calls[1][0]).toBe(originalPart);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Retry local recording' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Retry local recording' }));
    await waitFor(() => expect(fixture.recorders).toHaveLength(2));
    expect(fixture.writers[1].commit).not.toHaveBeenCalled();
  });

  it('requires explicit discard after failed finalization before local capture can be retried', async () => {
    await mountActive();
    fixture.recorders[0].rotate.mockRejectedValueOnce(new Error('Synthetic finalization failed'));
    advance(); fireEvent.click(screen.getByRole('button', { name: 'Send to Room' }));
    await waitFor(() => expect(screen.getByText('Part 1: capture-failed')).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Retry local recording' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fixture.writers[0].commit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard failed local capture' }));
    expect((screen.getByRole('button', { name: 'Retry local recording' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Retry local recording' }));
    await waitFor(() => expect(fixture.recorders).toHaveLength(2));
    expect(fixture.writers.every(writer => writer.commit.mock.calls.length === 0)).toBe(true);
  });

  it('rewires changed call streams into stable speaker taps without restarting or saving the recording', async () => {
    const { controller, active } = await mountActive();
    const nextLocal = { fixture: 'replacement microphone' } as unknown as MediaStream;
    const nextRemote = { fixture: 'replacement remote track' } as unknown as MediaStream;
    const replacement = { ...active.session!, localStream: nextLocal, remoteStreams: new Map([['remote-peer', nextRemote]]) };
    await publish(controller, { ...active, session: replacement as SerenadaSessionHandle });
    expect(fixture.taps[0].setInput).toHaveBeenLastCalledWith(nextLocal);
    expect(fixture.taps[1].setInput).toHaveBeenLastCalledWith(nextRemote);
    expect(fixture.taps).toHaveLength(2);
    expect(fixture.recorders).toHaveLength(1);
    expect(fixture.recorders[0].inputs.map(input => input.stream)).toEqual(fixture.taps.map(tap => tap.stream));
    expect(fixture.recorders[0].discard).not.toHaveBeenCalled();
    expect(fixture.writers[0].commit).not.toHaveBeenCalled();
  });

  it('blocks incoming Answer while an ended never-sent recording remains, then permits explicit discard', async () => {
    const { controller, onOpenChange } = await mountActive();
    await hangup();
    expect(screen.getByText('Send this call to Original recording Room?')).toBeTruthy();
    expect(fixture.writers[0].commit).not.toHaveBeenCalled();
    await incoming(controller);
    blockedAnswer();
    expect(onOpenChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    expect(controller.accept).not.toHaveBeenCalled();
    expect(screen.getByText('Send this call to Original recording Room?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Don’t send' }));
    expect((screen.getByRole('button', { name: 'Answer' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    await waitFor(() => expect(controller.accept).toHaveBeenCalledExactlyOnceWith(undefined));
    expect(fixture.writers[0].commit).not.toHaveBeenCalled();
  });

  it('blocks incoming Answer while a prior send is uncertain and never notifies the new call on late reconciliation', async () => {
    fixture.results.push({ outcome: 'uncertain', reason: 'Lost acknowledgement' });
    const { controller } = await mountActive();
    advance(); fireEvent.click(screen.getByRole('button', { name: 'Send to Room' }));
    await waitFor(() => expect(screen.getByText('Part 1: uncertain')).toBeTruthy());
    await hangup();
    await incoming(controller);
    blockedAnswer();
    expect(fixture.writers[0].dispose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Recheck saved part' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Answer' }) as HTMLButtonElement).disabled).toBe(false));
    expect(fixture.writers[0].commit).toHaveBeenCalledOnce();
    expect(fixture.writers[0].reconcile).toHaveBeenCalledOnce();
    expect(controller.sendPartSent).not.toHaveBeenCalled();
  });

  it.each([false, true])('delivers a confirmed send notice only to its captured wire call (new call: %s)', async newCall => {
    const pending = deferred<CommitResult>(); fixture.results.push(pending.promise);
    const { controller } = await mountActive();
    advance(); fireEvent.click(screen.getByRole('button', { name: 'Send to Room' }));
    await waitFor(() => expect(fixture.writers[0].commit).toHaveBeenCalledOnce());
    expect(fixture.writers[0].options.wireCallId).toBe('wire-call-one');
    expect(controller.sendPartSent).not.toHaveBeenCalled();
    if (newCall) { await hangup(); await incoming(controller); blockedAnswer(); }
    await act(async () => pending.resolve({ outcome: 'committed' }));
    if (newCall) expect(controller.sendPartSent).not.toHaveBeenCalled();
    else expect(controller.sendPartSent).toHaveBeenCalledExactlyOnceWith(1);
    expect(fixture.writers[0].commit).toHaveBeenCalledOnce();
  });

  it('locks duplicate Send, never writes on hangup, and discards the unsent tail after confirmation', async () => {
    const sealed = deferred<readonly SpeakerFile[]>(), pending = deferred<CommitResult>();
    fixture.results.push(pending.promise);
    await mountActive();
    expect(fixture.writers[0].commit).not.toHaveBeenCalled();
    fixture.recorders[0].rotate.mockImplementationOnce(() => sealed.promise);
    advance();
    const send = screen.getByRole('button', { name: 'Send to Room' });
    fireEvent.click(send); fireEvent.click(send);
    expect(fixture.recorders[0].rotate).toHaveBeenCalledOnce();
    expect(fixture.writers[0].commit).not.toHaveBeenCalled();
    await act(async () => sealed.resolve(['local-peer', 'remote-peer'].map(speakerId => ({ speakerId, blob: new Blob(['audio'], { type: 'audio/webm' }), container: 'complete' }))));
    await waitFor(() => expect(fixture.writers[0].commit).toHaveBeenCalledOnce());
    await hangup();
    expect(fixture.recorders[0].finish).toHaveBeenCalledOnce();
    expect(fixture.writers[0].commit).toHaveBeenCalledOnce();
    await act(async () => pending.resolve({ outcome: 'committed' }));
    expect(screen.queryByText(/Send this call to/)).toBeNull();
    expect(fixture.writers[0].commit).toHaveBeenCalledOnce();
  });

  it('offers ended call saving without writing and uploads only after an explicit Send click', async () => {
    await mountActive();
    await hangup();
    expect(fixture.writers[0].commit).not.toHaveBeenCalled();
    expect(fixture.recorders[0].rotate).not.toHaveBeenCalled();
    const pending = deferred<CommitResult>(); fixture.results.push(pending.promise);
    const send = screen.getByRole('button', { name: /^Send$/ });
    fireEvent.click(send); fireEvent.click(send);
    await waitFor(() => expect(fixture.writers[0].commit).toHaveBeenCalledOnce());
    expect(fixture.recorders[0].finish).toHaveBeenCalledOnce();
    await act(async () => pending.resolve({ outcome: 'committed' }));
    expect(screen.queryByRole('button', { name: /^Send$/ })).toBeNull();
    expect(fixture.writers[0].commit).toHaveBeenCalledOnce();
  });

  it('finalizes the previous recording when ended and new incoming states are batched together', async () => {
    const { controller, active } = await mountActive();
    advance();
    await act(async () => {
      controller.publish({ ...active, phase: 'ended', session: null, sessionState: null });
      controller.publish({ ...activeState('wire-call-two'), phase: 'incoming', recordingRoom: undefined, session: null });
    });
    await waitFor(() => expect(fixture.recorders[0].finish).toHaveBeenCalledOnce());
    expect(screen.getByText('Send this call to Original recording Room?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Don’t send' })).toBeTruthy();
    blockedAnswer();
    expect(fixture.taps.slice(0, 2).every(tap => tap.closed)).toBe(true);
    expect(fixture.writers[0].commit).not.toHaveBeenCalled();
    expect(controller.current.callId).toBe('wire-call-two');
    expect(controller.hangup).not.toHaveBeenCalled();
  });

  it('does not hold a confirmed commit or the next Send behind a delayed peer notification', async () => {
    const notification = deferred<void>();
    const { controller } = await mountActive();
    controller.sendPartSent.mockReturnValueOnce(notification.promise);
    advance(); fireEvent.click(screen.getByRole('button', { name: 'Send to Room' }));
    await waitFor(() => expect(controller.sendPartSent).toHaveBeenCalledExactlyOnceWith(1));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Send to Room' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText('Part 1: sending')).toBeNull();
    advance(); fireEvent.click(screen.getByRole('button', { name: 'Send to Room' }));
    await waitFor(() => expect(fixture.writers[0].commit).toHaveBeenCalledTimes(2));
    expect(fixture.writers[0].commit.mock.calls.map(([part]) => part.number)).toEqual([1, 2]);
    await act(async () => notification.resolve());
    expect(fixture.writers[0].commit).toHaveBeenCalledTimes(2);
  });

  it('hangs up the original call immediately while finalizing and never hangs up a subsequent incoming call', async () => {
    const finalization = deferred<readonly SpeakerFile[]>();
    const { controller } = await mountActive();
    fixture.recorders[0].finish.mockReturnValueOnce(finalization.promise);
    advance(); fireEvent.click(screen.getByRole('button', { name: 'End fixture call' }));
    expect(fixture.recorders[0].finish).toHaveBeenCalledOnce();
    await waitFor(() => expect(controller.hangup).toHaveBeenCalledOnce());
    expect(controller.current.phase).toBe('ended');
    await incoming(controller);
    blockedAnswer();
    await act(async () => finalization.resolve(['local-peer', 'remote-peer'].map(speakerId => ({
      speakerId, blob: new Blob(['synthetic final tail'], { type: 'audio/webm' }), container: 'complete',
    }))));
    expect(controller.hangup).toHaveBeenCalledOnce();
    expect(controller.current).toMatchObject({ callId: 'wire-call-two', phase: 'incoming' });
    expect(screen.getByText('Send this call to Original recording Room?')).toBeTruthy();
    expect(fixture.writers[0].commit).not.toHaveBeenCalled();
  });

  it('unmount releases local capture and never creates an automatic recording send', async () => {
    const view = await mountActive();
    view.unmount();
    expect(fixture.taps.every(tap => tap.closed)).toBe(true);
    expect(fixture.recorders[0].discard).toHaveBeenCalledOnce();
    expect(fixture.writers[0].dispose).toHaveBeenCalledOnce();
    expect(fixture.writers[0].commit).not.toHaveBeenCalled();
    expect(fixture.controllers[0].dispose).toHaveBeenCalledOnce();
  });
});
