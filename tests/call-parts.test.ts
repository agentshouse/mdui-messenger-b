import { describe, expect, it, vi } from 'vitest';
import { CallPartMachine, type CallPart, type CommitResult, type SpeakerFile, type SpeakerRecorder } from '../src/call/callParts';

const files = (text = 'audio'): readonly SpeakerFile[] => ['alice', 'bob'].map(speakerId => ({
  speakerId, blob: new Blob([text], {type:'audio/webm'}), container:'complete',
}));
const deferred = <T>() => { let resolve!: (value:T) => void; let reject!: (error:unknown) => void;
  const promise = new Promise<T>((yes,no) => { resolve = yes; reject = no; }); return {promise,resolve,reject}; };
function setup(commit: (part:CallPart) => Promise<CommitResult> = async () => ({outcome:'committed'}), recorded = true) {
  let time = 100;
  const recorder = {start:vi.fn(), rotate:vi.fn(async () => files()), finish:vi.fn(async () => files('tail')), discard:vi.fn()} satisfies SpeakerRecorder;
  const writer = vi.fn(commit);
  const machine = new CallPartMachine({callId:'call-1', ...(recorded ? {roomId:'r_1',recorder} : {}), participants:['alice','bob'], now:()=>time,
    startedAt:'2026-10-11T10:00:00.000Z',commit:writer});
  return {machine,recorder,writer,at:(value:number)=>{time=value;}};
}

describe('explicit call-part recording lifecycle', () => {
  it('does nothing on construction and never sends simply by starting or ending capture', async () => {
    const {machine,recorder,writer,at} = setup();
    expect(recorder.start).not.toHaveBeenCalled(); machine.start(); at(200);
    expect(await machine.hangup()).toBe('offer-send'); expect(writer).not.toHaveBeenCalled();
    expect(machine.snapshot().hasLocalTail).toBe(true); machine.discard();
    expect(writer).not.toHaveBeenCalled(); expect(recorder.discard).toHaveBeenCalledOnce();
  });
  it('sends both whole speaker files with stable identity and monotonic part timestamps', async () => {
    const {machine,writer,at,recorder} = setup(); machine.start(); at(1100); await machine.send();
    const first = writer.mock.calls[0][0];
    expect(first).toMatchObject({id:'call-1-part-1',number:1,callId:'call-1',roomId:'r_1',participants:['alice','bob'],startOffsetMs:0,durationMs:1000,startedAt:'2026-10-11T10:00:00.000Z'});
    expect(first.files.map(f=>f.speakerId)).toEqual(['alice','bob']); expect(recorder.finish).not.toHaveBeenCalled();
    at(2100); await machine.send(); expect(writer.mock.calls[1][0]).toMatchObject({number:2,startOffsetMs:1000,durationMs:1000,startedAt:'2026-10-11T10:00:01.000Z'});
    at(2300); expect(await machine.hangup()).toBe('discarded-tail'); expect(writer).toHaveBeenCalledTimes(2); expect(machine.snapshot().hasLocalTail).toBe(false);
  });
  it('locks duplicate Send synchronously during finalization, then keeps capture running during upload', async () => {
    const sealed = deferred<readonly SpeakerFile[]>(); const sent = deferred<CommitResult>();
    const {machine,recorder,writer,at} = setup(()=>sent.promise); recorder.rotate.mockImplementationOnce(()=>sealed.promise);
    machine.start(); at(200); const pending = machine.send();
    await expect(machine.send()).rejects.toThrow('Resolve'); expect(recorder.rotate).toHaveBeenCalledOnce();
    expect(writer).not.toHaveBeenCalled(); sealed.resolve(files()); await Promise.resolve();
    expect(machine.snapshot().phase).toBe('recording'); expect(machine.snapshot().pending?.status).toBe('sending');
    expect(recorder.finish).not.toHaveBeenCalled(); await expect(machine.send()).rejects.toThrow('Resolve');
    sent.resolve({outcome:'committed'}); await pending; expect(machine.snapshot().committedParts).toBe(1);
  });
  it('retains a rejected exact part and retries only on an explicit action', async () => {
    const {machine,writer,at} = setup(async()=>({outcome:'rejected',reason:'read-only'})); machine.start(); at(200); await machine.send();
    expect(machine.snapshot().pending).toMatchObject({id:'call-1-part-1',status:'rejected'}); expect(writer).toHaveBeenCalledOnce();
    at(500); await expect(machine.send()).rejects.toThrow('Resolve');
    writer.mockResolvedValueOnce({outcome:'committed'}); await machine.retryPending();
    expect(writer.mock.calls[1][0]).toBe(writer.mock.calls[0][0]);
    await machine.send(); expect(writer.mock.calls[2][0]).toMatchObject({number:2,startOffsetMs:100,durationMs:300});
  });
  it('never retries thrown/uncertain external writes without explicit reconciliation', async () => {
    const {machine,writer,at} = setup(async()=>{throw new Error('connection lost');}); machine.start(); at(200); await machine.send();
    expect(machine.snapshot().pending?.status).toBe('uncertain'); await expect(machine.retryPending()).rejects.toThrow('outcome'); expect(writer).toHaveBeenCalledOnce();
    machine.reconcilePending('not-committed'); writer.mockResolvedValueOnce({outcome:'committed'}); await machine.retryPending();
    expect(writer.mock.calls[1][0]).toBe(writer.mock.calls[0][0]);
  });
  it('accepts an explicitly reconciled commit without another upload', async () => {
    const {machine,writer,at} = setup(async()=>({outcome:'uncertain',reason:'lost ack'})); machine.start(); at(200); await machine.send();
    machine.reconcilePending('committed'); expect(machine.snapshot().committedParts).toBe(1); expect(writer).toHaveBeenCalledOnce();
  });
  it('offers a never-sent ended call and sends only on the later explicit click', async () => {
    const {machine,writer,at,recorder} = setup(); machine.start(); at(500); await machine.hangup(); expect(writer).not.toHaveBeenCalled();
    await machine.send(); expect(writer).toHaveBeenCalledOnce(); expect(writer.mock.calls[0][0].durationMs).toBe(400); expect(recorder.rotate).not.toHaveBeenCalled();
    await expect(machine.send()).rejects.toThrow('No recording');
  });
  it('hangup retains a failed explicit pending part and its tail, even after an earlier successful part', async () => {
    const {machine,writer,at} = setup(); machine.start(); at(200); await machine.send();
    writer.mockResolvedValueOnce({outcome:'uncertain',reason:'unknown'}); at(300); await machine.send(); at(400);
    expect(await machine.hangup()).toBe('pending-warning'); expect(machine.snapshot()).toMatchObject({committedParts:1,hasLocalTail:true,pending:{number:2,status:'uncertain'}});
    expect(writer).toHaveBeenCalledTimes(2); await expect(machine.retryPending()).rejects.toThrow('outcome');
  });
  it('does not upload the unsent tail while an in-flight send settles after hangup', async () => {
    const sent = deferred<CommitResult>(); const {machine,writer,at} = setup(()=>sent.promise); machine.start(); at(200); const send = machine.send(); await Promise.resolve(); at(300);
    expect(await machine.hangup()).toBe('pending-warning'); sent.resolve({outcome:'committed'}); await send;
    expect(writer).toHaveBeenCalledOnce(); expect(machine.snapshot()).toMatchObject({decision:'discarded-tail',hasLocalTail:false,committedParts:1});
  });
  it('unrecorded calls cannot upload or start a recorder', async () => {
    const {machine,writer,at,recorder} = setup(undefined,false); machine.start(); at(200);
    await expect(machine.send()).rejects.toThrow('not recorded'); expect(await machine.hangup()).toBe('unrecorded'); expect(writer).not.toHaveBeenCalled(); expect(recorder.start).not.toHaveBeenCalled();
  });
  it('unexpected shutdown cancels pre-upload finalization and clears local memory', async () => {
    const sealed = deferred<readonly SpeakerFile[]>(); const {machine,recorder,writer,at} = setup(); recorder.rotate.mockImplementationOnce(()=>sealed.promise);
    machine.start(); at(200); const send = machine.send(); machine.discard(); sealed.resolve(files()); await send;
    expect(writer).not.toHaveBeenCalled(); expect(machine.snapshot()).toMatchObject({phase:'disposed',pending:null,hasLocalTail:false});
  });
  it('shutdown never starts more writes or revives state after an already-started write settles', async () => {
    const sent = deferred<CommitResult>(); const {machine,writer,at} = setup(()=>sent.promise); machine.start(); at(200); const send = machine.send(); await Promise.resolve();
    machine.discard(); sent.resolve({outcome:'committed'}); await send; expect(writer).toHaveBeenCalledOnce(); expect(machine.snapshot().phase).toBe('disposed');
  });
  it('rejects missing/duplicate speaker files without upload', async () => {
    const {machine,recorder,writer,at} = setup(); recorder.rotate.mockResolvedValueOnce([files()[0],files()[0]]); machine.start(); at(200); await machine.send();
    expect(machine.snapshot().pending?.status).toBe('capture-failed'); expect(writer).not.toHaveBeenCalled();
  });
  it('rejects partial container chunks instead of pretending they are playable recordings', async () => {
    const {machine,recorder,writer,at} = setup(); recorder.rotate.mockResolvedValueOnce(files().map(f=>({...f,container:'fragment'})) as unknown as readonly SpeakerFile[]);
    machine.start(); at(200); await machine.send(); expect(writer).not.toHaveBeenCalled(); expect(machine.snapshot().pending?.reason).toContain('fragment');
  });
  it('enforces duration before rotation and rejects backward monotonic clocks', async () => {
    const {machine,recorder,writer,at} = setup(); machine.start(); at(99); await expect(machine.send()).rejects.toThrow('backwards');
    at(100+30*60*1000+1); await expect(machine.send()).rejects.toThrow('duration'); expect(recorder.rotate).not.toHaveBeenCalled(); expect(writer).not.toHaveBeenCalled();
  });
  it('enforces individual and combined byte budgets before writing', async () => {
    const writer = vi.fn(async():Promise<CommitResult>=>({outcome:'committed'})); let time = 0;
    const recorder:SpeakerRecorder = {start:vi.fn(),rotate:async()=>files('12345'),finish:async()=>files(),discard:vi.fn()};
    const machine = new CallPartMachine({callId:'c',roomId:'r',participants:['alice','bob'],recorder,now:()=>time,startedAt:'2026-10-11T00:00:00Z',commit:writer,limits:{maxStretchMs:100,maxSpeakerBytes:10,maxPartBytes:9}});
    machine.start(); time=1; await machine.send(); expect(writer).not.toHaveBeenCalled(); expect(machine.snapshot().pending?.reason).toContain('byte limit');
  });
  it('treats malformed commit acknowledgements as uncertain', async () => {
    const {machine,at} = setup(async()=>undefined as unknown as CommitResult); machine.start(); at(200); await machine.send(); expect(machine.snapshot().pending?.status).toBe('uncertain');
  });
  it('a throwing UI listener cannot alter send/capture state', async () => {
    const {machine,writer,at} = setup(); machine.subscribe(()=>{throw new Error('view failed');}); machine.start(); at(200); await machine.send(); expect(writer).toHaveBeenCalledOnce(); expect(machine.snapshot().committedParts).toBe(1);
  });
  it('does not warn about an intentionally discarded tail after a committed part', async () => {
    const {machine,recorder,at} = setup(); machine.start(); at(200); await machine.send();
    recorder.finish.mockRejectedValueOnce(new Error('tail encoder failed')); at(300);
    expect(await machine.hangup()).toBe('discarded-tail');
  });
  it('captures a recording bound/error as a visible stop without uploading', () => {
    const {machine,writer,recorder} = setup(); machine.start(); machine.captureFailed(new Error('limit reached'));
    expect(machine.snapshot()).toMatchObject({phase:'ended',decision:'capture-warning',pending:null});
    expect(recorder.discard).toHaveBeenCalledOnce(); expect(writer).not.toHaveBeenCalled();
  });
  it('preserves the frozen pending write when the continuing capture fails', async () => {
    const sent = deferred<CommitResult>(); const {machine,writer,at} = setup(()=>sent.promise); machine.start(); at(200);
    const send = machine.send(); await Promise.resolve(); machine.captureFailed(new Error('tail failed'));
    expect(machine.snapshot().decision).toBe('pending-warning'); sent.resolve({outcome:'uncertain',reason:'lost ack'}); await send;
    expect(machine.snapshot().pending).toMatchObject({id:'call-1-part-1',status:'uncertain'}); expect(writer).toHaveBeenCalledOnce();
  });
  it('cleans state even if an injected cleanup adapter throws', () => {
    const {machine,recorder} = setup(); machine.start(); recorder.discard.mockImplementationOnce(()=>{throw new Error('cleanup error');});
    expect(()=>machine.discard()).not.toThrow(); expect(machine.snapshot()).toMatchObject({phase:'disposed',pending:null,hasLocalTail:false});
  });

});
