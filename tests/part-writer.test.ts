import {describe,expect,it,vi} from 'vitest';
import {HouseCallPartWriter} from '../src/call/partWriter';
import {CallPartMachine,type CallPart} from '../src/call/callParts';
import type {Runtime} from '../src/data/house';
import type {Attachment} from '../src/data/model';
import {observation} from './fakeRuntime';
import {assertStrictLocalQuery} from './strictQuery';
const CALL='11111111-1111-4111-8111-111111111111';
const WIRE='22222222-2222-4222-8222-222222222222';
const START='2026-10-11T10:00:00.000Z';
const PARTICIPANTS=[{id:'local-copy',name:'This device'},{id:'remote-copy',name:'Remote participant'}];
type Doc={room:string;path:string;type:string;fields:Record<string,unknown>;change?:{time:string}|null};
type Draft={room:string;path:string;revision:string;parts:{creation:{type:string;fields:Record<string,unknown>;sections:Record<string,string>}};returned:{kind:string}|null};
function part(number=1):CallPart{return Object.freeze({id:`${CALL}-part-${number}`,callId:CALL,roomId:'r_one',number,participants:PARTICIPANTS.map(x=>x.id),startedAt:new Date(Date.parse(START)+(number-1)*1000).toISOString(),startOffsetMs:(number-1)*1000,durationMs:1000,files:PARTICIPANTS.map(x=>({speakerId:x.id,blob:new Blob([x.id],{type:'audio/webm'}),container:'complete' as const}))});}
function setup(autoConfirm=true){
 let index=0;const docs=new Map<string,Doc>();const drafts=new Map<string,Draft>();let lastDrafts:Draft[]=[];
 docs.set('chats/main.md',{room:'r_one',path:'chats/main.md',type:'messenger_chat',fields:{id:CALL,title:'Private Room',mode:'room',created_at:START},change:{time:START}});
 const rooms=observation([{locator:'r_one',name:'Room',operations:{write:['']},replica:{admission:'admitted'},synchronizationAvailable:true,refusal:null}]);
 const query=observation({documents:[...docs.values()]});const draftWatch=observation<Draft[]>([]);const queue=observation<{batch:{id:string};state:string;roomVersion?:string}[]>([]);
 const watches={rooms,query,'room-drafts':draftWatch,queue,'service-mode':observation('open'),'connection-refusal':observation<unknown>(null),'storage-loss':observation<unknown>(null)};
 const publish=()=>{query.publish({documents:[...docs.values()]});draftWatch.publish([...drafts.values()]);};
 const confirm=()=>{for(const [key,doc]of docs){if(key!=='chats/main.md')docs.set(key,{...doc,change:{time:START}});}drafts.clear();queue.publish([]);publish();};
 const raw={rooms:vi.fn(async()=>rooms.current()),query:vi.fn(async(input:unknown)=>{assertStrictLocalQuery(input);return {documents:[...docs.values()]};}),observe:vi.fn(async(topic:keyof typeof watches,input?:unknown)=>{if(topic==='query')assertStrictLocalQuery(input);return watches[topic];}),reached:vi.fn(async()=>true),
  roomDraft:{read:vi.fn(async(_room:string,path:string)=>drafts.get(path)??null),write:vi.fn(async(room:string,path:string,_base:unknown,parts:Draft['parts'])=>{const draft={room,path,revision:`draft-${++index}`,parts,returned:null};drafts.set(path,draft);docs.set(path,{room,path,type:parts.creation.type,fields:parts.creation.fields,change:null});publish();return {outcome:'written',roomDraft:draft};})},
  save:vi.fn(async(_room:string,entries:{path:string;revision:string}[])=>{lastDrafts=entries.map(x=>drafts.get(x.path)!);drafts.clear();queue.publish([{batch:{id:'batch-1'},state:'waiting'}]);publish();if(autoConfirm)confirm();return {outcome:'saved',identifier:'batch-1'};}),call:vi.fn(),
 };
 const assets={upload:vi.fn(async(_md:Runtime,_room:string,file:File):Promise<Attachment>=>({path:`files/${file.name.includes('speaker-1')?'first':'second'}`, sha256:'0'.repeat(64),name:file.name,mime:file.type,bytes:file.size})),read:vi.fn(async(_md:Runtime,_room:string,attachment:Attachment)=>({blob:new Blob(['fixture'],{type:attachment.mime}),name:attachment.name,status:'available'}))};
 const runtime=raw as unknown as Runtime;
 const writer=new HouseCallPartWriter({runtime,roomId:'r_one',callId:CALL,wireCallId:WIRE,callStartedAt:START,participants:PARTICIPANTS,assets});
 return {writer,raw,runtime,assets,docs,drafts,watches,publish,confirm,rejectBatch:()=>{for(const draft of lastDrafts)drafts.set(draft.path,{...draft,revision:`returned-${++index}`,returned:{kind:'rejected'}});queue.publish([]);publish();}};
}

describe('explicit House call-part writer',()=>{
 it('performs no read, upload or mutation on construction',()=>{const f=setup();expect(f.raw.rooms).not.toHaveBeenCalled();expect(f.assets.upload).not.toHaveBeenCalled();expect(f.raw.roomDraft.write).not.toHaveBeenCalled();});
 it('uploads both speakers and atomically saves the call and part with bare attachment refs',async()=>{
  const f=setup();const recording=part();expect(await f.writer.commit(recording)).toEqual({outcome:'committed'});
  expect(f.assets.upload).toHaveBeenCalledTimes(2);expect(f.assets.read).toHaveBeenCalledTimes(2);expect(f.raw.save).toHaveBeenCalledTimes(1);
  expect(f.raw.save.mock.calls[0][1].map(x=>x.path)).toEqual([`calls/${CALL}.md`,`call-parts/${CALL}-part-1.md`]);
  const saved=f.docs.get(`call-parts/${CALL}-part-1.md`)!.fields;
  expect(saved).toMatchObject({id:`${CALL}-part-1`,call_id:CALL,wire_call_id:WIRE,part:1,start:START,start_offset_ms:0,duration_ms:1000,participants:PARTICIPANTS});
  expect((saved.files as {path:string;speaker_id:string}[]).map(x=>[x.speaker_id,x.path])).toEqual([['local-copy','files/first'],['remote-copy','files/second']]);
  expect(f.raw.call).not.toHaveBeenCalled();
 });
 it('saves only the new part after the first call record is confirmed',async()=>{const f=setup();await f.writer.commit(part());await f.writer.commit(part(2));expect(f.raw.save.mock.calls[1][1].map(x=>x.path)).toEqual([`call-parts/${CALL}-part-2.md`]);expect(f.assets.upload).toHaveBeenCalledTimes(4);});
 it('does not confuse a locally queued save with sent confirmation',async()=>{
  const f=setup(false);const done=vi.fn();const sending=f.writer.commit(part()).then(done);await vi.waitFor(()=>expect(f.raw.save).toHaveBeenCalledOnce());expect(done).not.toHaveBeenCalled();
  f.watches.queue.publish([{batch:{id:'batch-1'},state:'accepted',roomVersion:'rv1'}]);await Promise.resolve();expect(done).not.toHaveBeenCalled();f.confirm();await sending;expect(done).toHaveBeenCalledWith({outcome:'committed'});
 });
 it('locks repeated sends while confirmation is pending',async()=>{const f=setup(false);const recording=part();const send=f.writer.commit(recording);await vi.waitFor(()=>expect(f.raw.save).toHaveBeenCalledOnce());expect((await f.writer.commit(recording)).outcome).toBe('rejected');expect(f.assets.upload).toHaveBeenCalledTimes(2);f.confirm();await send;});
 it('returns a confirmed receipt on duplicate completed commit without repeating a write',async()=>{const f=setup();const recording=part();await f.writer.commit(recording);expect(await f.writer.commit(recording)).toEqual({outcome:'committed'});expect(f.assets.upload).toHaveBeenCalledTimes(2);expect(f.raw.save).toHaveBeenCalledOnce();});
 it('does not reuse a stable id for a different recording object',async()=>{const f=setup();await f.writer.commit(part());expect((await f.writer.commit(part())).outcome).toBe('rejected');expect(f.assets.upload).toHaveBeenCalledTimes(2);});
 it('retains earlier speaker receipt and never retries an uncertain later upload',async()=>{
  const f=setup();f.assets.upload.mockRejectedValueOnce(new Error('transport unknown'));const recording=part();expect((await f.writer.commit(recording)).outcome).toBe('uncertain');expect((await f.writer.commit(recording)).outcome).toBe('uncertain');expect((await f.writer.reconcile(recording)).outcome).toBe('uncertain');expect(f.assets.upload).toHaveBeenCalledOnce();expect(f.raw.save).not.toHaveBeenCalled();
 });
 it('retains the first receipt if the second upload loses its answer',async()=>{
  const f=setup();f.assets.upload.mockResolvedValueOnce({path:'files/first', sha256:'0'.repeat(64),name:'first.webm',mime:'audio/webm',bytes:10}).mockRejectedValueOnce(new Error('lost second answer'));const recording=part();expect((await f.writer.commit(recording)).outcome).toBe('uncertain');await f.writer.commit(recording);expect(f.assets.upload).toHaveBeenCalledTimes(2);expect(f.raw.save).not.toHaveBeenCalled();
 });
 it('waits for readable audio before creating any Room documents and resumes without reuploading',async()=>{
  const f=setup();f.assets.read.mockResolvedValueOnce({blob:null as unknown as Blob,name:'first',status:'not_saved'});const recording=part();expect((await f.writer.commit(recording)).outcome).toBe('uncertain');expect(f.raw.roomDraft.write).not.toHaveBeenCalled();expect((await f.writer.reconcile(recording)).outcome).toBe('rejected');expect(await f.writer.commit(recording)).toEqual({outcome:'committed'});expect(f.assets.upload).toHaveBeenCalledTimes(2);
 });
 it('retains exact draft revisions after local save refusal, without repeat uploads',async()=>{
  const f=setup();f.raw.save.mockResolvedValueOnce({outcome:'refused',code:'stale',retryable:false} as never);const recording=part();expect((await f.writer.commit(recording)).outcome).toBe('rejected');expect(f.drafts.size).toBe(2);expect(await f.writer.commit(recording)).toEqual({outcome:'committed'});expect(f.assets.upload).toHaveBeenCalledTimes(2);expect(f.raw.roomDraft.write).toHaveBeenCalledTimes(2);expect(f.raw.save).toHaveBeenCalledTimes(2);
 });
 it('never blindly repeats a save whose result was lost, then reconciles read-only',async()=>{
  const f=setup();f.raw.save.mockImplementationOnce(async()=>{throw new Error('save transport unknown');});const recording=part();expect((await f.writer.commit(recording)).outcome).toBe('uncertain');expect((await f.writer.commit(recording)).outcome).toBe('uncertain');expect(f.raw.save).toHaveBeenCalledOnce();f.confirm();expect(await f.writer.reconcile(recording)).toEqual({outcome:'committed'});expect(f.assets.upload).toHaveBeenCalledTimes(2);expect(f.raw.save).toHaveBeenCalledOnce();
 });
 it('reports a provider-rejected batch and preserves its returned drafts',async()=>{
  const f=setup(false);const send=f.writer.commit(part());await vi.waitFor(()=>expect(f.raw.save).toHaveBeenCalledOnce());f.rejectBatch();expect((await send).outcome).toBe('rejected');expect(f.drafts.size).toBe(2);
 });
 it('refuses another view’s unfinished draft instead of overwriting it',async()=>{
  const f=setup();const path=`call-parts/${CALL}-part-1.md`;f.drafts.set(path,{room:'r_one',path,revision:'foreign',parts:{creation:{type:'messenger_call_part',fields:{foreign:true},sections:{}}},returned:null});f.publish();const outcome=await f.writer.commit(part());expect(outcome.outcome).toBe('rejected');expect(f.drafts.get(path)?.revision).toBe('foreign');expect(f.raw.save).not.toHaveBeenCalled();
 });
 it('rejects an existing different call-part path before uploading',async()=>{const f=setup();const path=`call-parts/${CALL}-part-1.md`;f.docs.set(path,{room:'r_one',path,type:'messenger_call_part',fields:{other:true},change:{time:START}});expect((await f.writer.commit(part())).outcome).toBe('rejected');expect(f.assets.upload).not.toHaveBeenCalled();});
 it.each(['missing','readonly','halted'])('rejects %s Room before uploads',async(mode)=>{
  const f=setup();if(mode==='missing')f.watches.rooms.publish([]);if(mode==='readonly')f.watches.rooms.publish([{...f.watches.rooms.current()[0],operations:{write:['messages']}}]);if(mode==='halted')f.watches['service-mode'].publish('write-halted');expect((await f.writer.commit(part())).outcome).toBe('rejected');expect(f.assets.upload).not.toHaveBeenCalled();
 });
 it('rechecks binding after uploading and never writes into a replacement Room',async()=>{const f=setup();const original=f.assets.upload.getMockImplementation()!;f.assets.upload.mockImplementationOnce(async(...args)=>{const result=await original(...args);f.watches.rooms.publish([]);return result;});expect((await f.writer.commit(part())).outcome).toBe('rejected');expect(f.assets.upload).toHaveBeenCalledOnce();expect(f.raw.roomDraft.write).not.toHaveBeenCalled();});
 it('cancels confirmation waiting without retrying the pending save',async()=>{const f=setup(false);const send=f.writer.commit(part());await vi.waitFor(()=>expect(f.raw.save).toHaveBeenCalledOnce());f.writer.dispose();expect((await send).outcome).toBe('uncertain');expect(f.raw.save).toHaveBeenCalledOnce();expect(f.watches.queue.close).toHaveBeenCalled();});
 it('treats Room loss during save confirmation as uncertain',async()=>{const f=setup(false);const send=f.writer.commit(part());await vi.waitFor(()=>expect(f.raw.save).toHaveBeenCalledOnce());f.watches.rooms.publish([]);expect((await send).outcome).toBe('uncertain');});
 it('rejects a mismatched Room, speaker, timing, or local recording id before upload',async()=>{
  for(const patch of [{roomId:'r_other'},{callId:WIRE},{participants:['fake','remote-copy']},{startedAt:'2020-01-01T00:00:00Z'}]){const f=setup();expect((await f.writer.commit({...part(),...patch})).outcome).toBe('rejected');expect(f.assets.upload).not.toHaveBeenCalled();}
 });
 it('handles hangup while a save is pending without uploading or saving the unsent tail',async()=>{
  const f=setup(false);let now=0;const recorder={start:vi.fn(),rotate:vi.fn(async()=>part().files),finish:vi.fn(async()=>part().files),discard:vi.fn()};
  const machine=new CallPartMachine({callId:CALL,roomId:'r_one',participants:PARTICIPANTS.map(x=>x.id),startedAt:START,now:()=>now,recorder,commit:f.writer.commit});machine.start();now=1000;const send=machine.send();await vi.waitFor(()=>expect(f.raw.save).toHaveBeenCalledOnce());now=1400;expect(await machine.hangup()).toBe('pending-warning');expect(f.assets.upload).toHaveBeenCalledTimes(2);f.confirm();await send;expect(machine.snapshot()).toMatchObject({committedParts:1,decision:'discarded-tail',hasLocalTail:false});expect(f.assets.upload).toHaveBeenCalledTimes(2);expect(f.raw.save).toHaveBeenCalledOnce();
 });
 it('keeps all explicit send paths local until their upload dependency is invoked',async()=>{const f=setup();const recording=part();const observed=await f.writer.commit(recording);expect(observed.outcome).toBe('committed');expect(f.assets.upload.mock.calls.every(call=>call[1]==='r_one'&&call[2] instanceof File)).toBe(true);});
 it('confirms sequential Sends with fractional performance-clock origins and offsets',async()=>{
  const f=setup();let now=100.1;const recorder={start:vi.fn(),rotate:vi.fn(async()=>part().files),finish:vi.fn(async()=>part().files),discard:vi.fn()};
  const machine=new CallPartMachine({callId:CALL,roomId:'r_one',participants:PARTICIPANTS.map(x=>x.id),startedAt:START,now:()=>now,recorder,commit:f.writer.commit});
  machine.start();now=1100.4;await machine.send();expect(machine.snapshot().committedParts).toBe(1);
  now=2100.9;await machine.send();expect(machine.snapshot()).toMatchObject({committedParts:2,pending:null});
  const saved=f.docs.get(`call-parts/${CALL}-part-2.md`)!.fields;
  expect(saved.start_offset_ms).toBeCloseTo(1000.3);expect(saved.duration_ms).toBeCloseTo(1000.5);
  expect(saved.start).toBe('2026-10-11T10:00:01.000Z');expect(f.assets.upload).toHaveBeenCalledTimes(4);expect(f.raw.save).toHaveBeenCalledTimes(2);
  machine.discard();f.writer.dispose();
 });

});
