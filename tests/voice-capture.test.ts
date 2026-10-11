import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {VoiceCapture} from '../src/call/voiceCapture';
const deferred=<T>()=>{let resolve!:(value:T)=>void;let reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const stream=()=>{const stop=vi.fn();return {value:{getTracks:()=>[{stop}]} as unknown as MediaStream,stop};};
class Recorder {
 static instances:Recorder[]=[];static isTypeSupported=vi.fn(()=>true);static failStart=false;
 state='inactive';ondataavailable:((event:{data:Blob})=>void)|null=null;onstop:(()=>void)|null=null;onerror:(()=>void)|null=null;autoStop=true;
 constructor(readonly stream:MediaStream,readonly options:MediaRecorderOptions){Recorder.instances.push(this);}
 start=vi.fn(()=>{if(Recorder.failStart)throw new Error('cannot start');this.state='recording';});
 stop=vi.fn(()=>{this.state='inactive';if(this.autoStop){this.ondataavailable?.({data:new Blob(['voice'],{type:'audio/webm'})});this.onstop?.();}});
 chunk(blob:Blob){this.ondataavailable?.({data:blob});}
}
const Native=Recorder as unknown as typeof MediaRecorder;
beforeEach(()=>{Recorder.instances=[];Recorder.isTypeSupported.mockReset().mockReturnValue(true);Recorder.failStart=false;});
afterEach(()=>vi.useRealTimers());
describe('voice recording permission and cancellation',()=>{
 it('requests only microphone on explicit start and returns a local file on stop',async()=>{
  const input=stream();const media={getUserMedia:vi.fn(async()=>input.value)};const capture=new VoiceCapture(media,Native);expect(media.getUserMedia).not.toHaveBeenCalled();await capture.start();expect(media.getUserMedia).toHaveBeenCalledWith({audio:true,video:false});const file=await capture.stop();expect(file).toBeInstanceOf(File);expect(file.size).toBe(5);expect(input.stop).toHaveBeenCalledOnce();
 });
 it('locks repeated starts while permission is pending',async()=>{
  const permission=deferred<MediaStream>();const media={getUserMedia:vi.fn(()=>permission.promise)};const capture=new VoiceCapture(media,Native);const pending=capture.start();await expect(capture.start()).rejects.toThrow('already active');expect(media.getUserMedia).toHaveBeenCalledOnce();const input=stream();permission.resolve(input.value);await pending;capture.cancel();expect(input.stop).toHaveBeenCalledOnce();
 });
 it('stops late permission tracks after cancellation and never creates their recorder',async()=>{
  const permission=deferred<MediaStream>();const input=stream();const capture=new VoiceCapture({getUserMedia:()=>permission.promise},Native);const pending=capture.start();capture.cancel();permission.resolve(input.value);await expect(pending).rejects.toThrow('canceled');expect(input.stop).toHaveBeenCalledOnce();expect(Recorder.instances).toHaveLength(0);
 });
 it('does not let an older canceled permission request stop a newer recording',async()=>{
  const old=deferred<MediaStream>();const next=stream();const late=stream();const media={getUserMedia:vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(next.value)};const capture=new VoiceCapture(media,Native);const pending=capture.start();capture.cancel();await capture.start();old.resolve(late.value);await expect(pending).rejects.toThrow('canceled');expect(late.stop).toHaveBeenCalledOnce();expect(next.stop).not.toHaveBeenCalled();expect((await capture.stop()).size).toBe(5);
 });
 it('cancel while stopping cannot clear a newer session completion',async()=>{
  const first=stream();const second=stream();const capture=new VoiceCapture({getUserMedia:vi.fn().mockResolvedValueOnce(first.value).mockResolvedValueOnce(second.value)},Native);await capture.start();Recorder.instances[0].autoStop=false;const oldStop=capture.stop();const failed=expect(oldStop).rejects.toThrow('canceled');capture.cancel();await capture.start();await failed;expect((await capture.stop()).size).toBe(5);expect(first.stop).toHaveBeenCalledOnce();expect(second.stop).toHaveBeenCalledOnce();
 });
 it('stopping during a permission prompt cancels the pending request',async()=>{
  const permission=deferred<MediaStream>();const capture=new VoiceCapture({getUserMedia:()=>permission.promise},Native);const pending=capture.start();await expect(capture.stop()).rejects.toThrow('requesting');const input=stream();permission.resolve(input.value);await expect(pending).rejects.toThrow('canceled');expect(input.stop).toHaveBeenCalledOnce();
 });
 it('permission denial permits another explicit request',async()=>{
  const input=stream();const media={getUserMedia:vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(input.value)};const capture=new VoiceCapture(media,Native);await expect(capture.start()).rejects.toThrow('denied');await capture.start();capture.cancel();expect(input.stop).toHaveBeenCalledOnce();
 });
 it('checks codec support before asking for microphone access',async()=>{
  Recorder.isTypeSupported.mockReturnValue(false);const media={getUserMedia:vi.fn()};const capture=new VoiceCapture(media,Native);await expect(capture.start()).rejects.toThrow('format');expect(media.getUserMedia).not.toHaveBeenCalled();
 });
 it('releases all tracks if the recorder cannot start and permits a later retry',async()=>{
  const input=stream();const capture=new VoiceCapture({getUserMedia:async()=>input.value},Native);Recorder.failStart=true;await expect(capture.start()).rejects.toThrow('cannot start');expect(input.stop).toHaveBeenCalledOnce();Recorder.failStart=false;await capture.start();capture.cancel();expect(input.stop).toHaveBeenCalledTimes(2);
 });
 it('enforces a voice byte limit and releases resources without constructing a file',async()=>{
  const input=stream();const capture=new VoiceCapture({getUserMedia:async()=>input.value},Native);await capture.start();Recorder.instances[0].chunk(new Blob([new Uint8Array(20*1024*1024+1)]));await expect(capture.stop()).rejects.toThrow('20 MiB');expect(input.stop).toHaveBeenCalledOnce();
 });
 it('auto-stops at one minute but retains the local result until explicitly consumed',async()=>{
  vi.useFakeTimers();const input=stream();const capture=new VoiceCapture({getUserMedia:async()=>input.value},Native);await capture.start();vi.advanceTimersByTime(60000);expect(Recorder.instances[0].stop).toHaveBeenCalledOnce();expect(input.stop).toHaveBeenCalledOnce();expect((await capture.stop()).size).toBe(5);
 });
 it('fails boundedly if the browser never completes finalization',async()=>{
  vi.useFakeTimers();const input=stream();const capture=new VoiceCapture({getUserMedia:async()=>input.value},Native);await capture.start();Recorder.instances[0].autoStop=false;const result=capture.stop();const rejection=expect(result).rejects.toThrow('finish safely');vi.advanceTimersByTime(5000);await rejection;expect(input.stop).toHaveBeenCalledOnce();
 });
 it('recorder errors reject the pending result and stop all tracks',async()=>{
  const input=stream();const capture=new VoiceCapture({getUserMedia:async()=>input.value},Native);await capture.start();Recorder.instances[0].onerror?.();await expect(capture.stop()).rejects.toThrow('failed');expect(input.stop).toHaveBeenCalledOnce();
 });
 it('canceling a completed local result does not resurrect it',async()=>{
  vi.useFakeTimers();const input=stream();const capture=new VoiceCapture({getUserMedia:async()=>input.value},Native);await capture.start();vi.advanceTimersByTime(60000);capture.cancel();await expect(capture.stop()).rejects.toThrow('No voice');expect(input.stop).toHaveBeenCalledOnce();
 });
});
