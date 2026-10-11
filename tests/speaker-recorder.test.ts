import {afterEach, describe, expect, it, vi} from 'vitest';
import {IndependentSpeakerRecorder, type RecorderPort} from '../src/call/speakerRecorder';
import {DEFAULT_RECORDING_LIMITS} from '../src/call/callParts';

class FakeRecorder implements RecorderPort {
  state='inactive'; mimeType='audio/webm;codecs=opus';
  ondataavailable: RecorderPort['ondataavailable']=null; onstop: RecorderPort['onstop']=null; onerror: RecorderPort['onerror']=null;
  autoStop=true;
  constructor(readonly index:number, readonly log:string[]) {}
  start=vi.fn(()=>{this.log.push(`start-${this.index}`);this.state='recording';this.chunk(`HEADER-${this.index};`);});
  chunk(text:string) {this.ondataavailable?.({data:new Blob([text],{type:this.mimeType})});}
  stop=vi.fn(()=>{this.log.push(`stop-${this.index}`);this.state='inactive';if(this.autoStop){this.chunk(`FOOTER-${this.index};`);this.onstop?.();}});
}
function setup() {
  const log:string[]=[];const ports:FakeRecorder[]=[];const releases= [vi.fn(),vi.fn(),vi.fn(),vi.fn(),vi.fn(),vi.fn()];let clones=0;
  const onFailure=vi.fn();
  const recorder=new IndependentSpeakerRecorder([{speakerId:'alice',stream:{} as MediaStream},{speakerId:'bob',stream:{} as MediaStream}],{
    create:()=>{const port=new FakeRecorder(ports.length,log);ports.push(port);return port;},
    cloneAudio:()=>({stream:{} as MediaStream,release:releases[clones++]}),supportsType:()=>true,onFailure,finalizationTimeoutMs:100,
  });
  return {recorder,ports,releases,log,onFailure};
}
const readBlob=(blob:Blob):Promise<string>=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsText(blob);});
afterEach(()=>vi.useRealTimers());

describe('independent bounded per-speaker recorder',()=>{
  it('constructs without touching media and rotates using new complete containers',async()=>{
    const {recorder,ports,log,releases}=setup();expect(ports).toHaveLength(0);recorder.start(DEFAULT_RECORDING_LIMITS);ports[0].chunk('alice');ports[1].chunk('bob');
    const first=await recorder.rotate();expect(log).toEqual(['start-0','start-1','start-2','start-3','stop-0','stop-1']);
    expect(await readBlob(first[0].blob)).toBe('HEADER-0;aliceFOOTER-0;');expect(await readBlob(first[1].blob)).toBe('HEADER-1;bobFOOTER-1;');
    expect(first.map(f=>f.speakerId)).toEqual(['alice','bob']);expect(first.every(f=>f.container==='complete')).toBe(true);
    const second=await recorder.finish();expect(await readBlob(second[0].blob)).toBe('HEADER-2;FOOTER-2;');expect(releases.slice(0,4).every(fn=>fn.mock.calls.length===1)).toBe(true);
  });
  it('does not expose partial timeslice chunks and awaits both stop events',async()=>{
    const {recorder,ports}=setup();recorder.start(DEFAULT_RECORDING_LIMITS);ports.forEach(port=>{port.autoStop=false;});const done=vi.fn();const result=recorder.finish().then(done);await Promise.resolve();expect(done).not.toHaveBeenCalled();
    ports[0].chunk('footer0');ports[0].onstop?.();await Promise.resolve();expect(done).not.toHaveBeenCalled();ports[1].chunk('footer1');ports[1].onstop?.();await result;expect(done).toHaveBeenCalledOnce();
  });
  it('cleans owned streams on discard and never restarts or uploads',()=>{
    const {recorder,ports,releases}=setup();recorder.start(DEFAULT_RECORDING_LIMITS);recorder.discard();recorder.discard();expect(ports.every(p=>p.stop.mock.calls.length===1)).toBe(true);expect(releases.slice(0,2).every(fn=>fn.mock.calls.length===1)).toBe(true);expect(()=>recorder.rotate()).toThrow('No active');
  });
  it('stops all capture at byte bound without retaining the oversized chunk',()=>{
    const {recorder,ports,releases,onFailure}=setup();recorder.start({...DEFAULT_RECORDING_LIMITS,maxSpeakerBytes:50,maxPartBytes:80});ports[0].chunk('x'.repeat(51));expect(onFailure).toHaveBeenCalledOnce();expect(onFailure.mock.calls[0][0].message).toContain('byte limit');expect(releases.slice(0,2).every(fn=>fn.mock.calls.length===1)).toBe(true);expect(()=>recorder.finish()).toThrow('byte limit');
  });
  it('stops at duration bound without implicitly finalizing a send',()=>{
    vi.useFakeTimers();const {recorder,onFailure,ports}=setup();recorder.start({...DEFAULT_RECORDING_LIMITS,maxStretchMs:50});vi.advanceTimersByTime(50);expect(onFailure).toHaveBeenCalledOnce();expect(ports.every(p=>p.stop.mock.calls.length===1)).toBe(true);expect(()=>recorder.finish()).toThrow('duration limit');
  });
  it('bounds finalization when a browser never delivers stop',async()=>{
    vi.useFakeTimers();const {recorder,ports,onFailure,releases}=setup();recorder.start(DEFAULT_RECORDING_LIMITS);ports[0].autoStop=false;const finished=recorder.finish();const rejection=expect(finished).rejects.toThrow('finish safely');vi.advanceTimersByTime(100);await rejection;expect(onFailure).toHaveBeenCalledOnce();expect(releases[0]).toHaveBeenCalledOnce();
  });
  it('fails a pending old segment and the current one on recording error',async()=>{
    const {recorder,ports,releases,onFailure}=setup();recorder.start(DEFAULT_RECORDING_LIMITS);ports[0].autoStop=false;const result=recorder.rotate();const rejection=expect(result).rejects.toThrow('recording failed');ports[0].onerror?.({});await rejection;expect(onFailure).toHaveBeenCalledOnce();expect(releases.slice(0,4).every(fn=>fn.mock.calls.length===1)).toBe(true);
  });
  it('fails closed when no supported codec exists before cloning streams',()=>{
    const clone=vi.fn();const recorder=new IndependentSpeakerRecorder([{speakerId:'a',stream:{} as MediaStream},{speakerId:'b',stream:{} as MediaStream}],{supportsType:()=>false,cloneAudio:clone});expect(()=>recorder.start(DEFAULT_RECORDING_LIMITS)).toThrow('format');expect(clone).not.toHaveBeenCalled();
  });
  it('releases previous clones if constructing the next recorder fails',()=>{
    const released=vi.fn();let count=0;const recorder=new IndependentSpeakerRecorder([{speakerId:'a',stream:{} as MediaStream},{speakerId:'b',stream:{} as MediaStream}],{supportsType:()=>true,cloneAudio:()=>({stream:{} as MediaStream,release:released}),create:()=>{if(count++)throw new Error('create failed');return new FakeRecorder(0,[]);}});expect(()=>recorder.start(DEFAULT_RECORDING_LIMITS)).toThrow('create failed');expect(released).toHaveBeenCalledTimes(2);
  });
  it('treats unexpected recorder stop as a capture error',()=>{
    const {recorder,ports,onFailure}=setup();recorder.start(DEFAULT_RECORDING_LIMITS);ports[0].onstop?.();expect(onFailure.mock.calls[0][0].message).toContain('unexpectedly');expect(()=>recorder.rotate()).toThrow('unexpectedly');
  });
  it('clones audio tracks and only stops those owned clones',async()=>{
    const originalStop=vi.fn();const ownedStop=vi.fn();const cloned={stop:ownedStop};const source={getAudioTracks:()=>[{readyState:'live',stop:originalStop,clone:()=>cloned}]} as unknown as MediaStream;
    const previous=globalThis.MediaStream;class Stream {constructor(readonly tracks:unknown[]) {}}
    vi.stubGlobal('MediaStream',Stream);try {const recorder=new IndependentSpeakerRecorder([{speakerId:'a',stream:source},{speakerId:'b',stream:source}],{supportsType:()=>true,create:()=>new FakeRecorder(0,[])});recorder.start(DEFAULT_RECORDING_LIMITS);await recorder.finish();expect(ownedStop).toHaveBeenCalledTimes(2);expect(originalStop).not.toHaveBeenCalled();}finally {vi.stubGlobal('MediaStream',previous);}
  });
});
