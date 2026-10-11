import {describe,it,expect,vi} from 'vitest';
import {connectHouseBridge} from '@agentshouse/app-bridge';
import {createHouseBridgeTestHost} from '@agentshouse/app-bridge/test-host';
import {HouseMessengerStore} from '../src/data/house';
import {chat,message,fakeRuntime,MESSAGE} from './fakeRuntime';
function deferred<T>() {let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return {promise,resolve};}
describe('House Messenger Room boundary',()=>{
 it('uses the exact host injected runtime and retains Provider author',async()=>{const f=fakeRuntime();const host=createHouseBridgeTestHost();host.attachRuntime(f.runtime);const bridge=connectHouseBridge(host);expect(await bridge.runtime).toBe(f.runtime);const store=new HouseMessengerStore(()=>bridge.runtime);await store.start();expect(store.snapshot().messages[0].author?.name).toBe('Alex');expect(f.raw.observe).toHaveBeenCalledWith('query',expect.objectContaining({rooms:['r_one','r_two'],select:{fields:'all',change:true}}));store.dispose();});
 it('keeps audiences in separate Room locators',async()=>{const f=fakeRuntime([chat(),chat('r_two'),message(),message('r_two')]);const s=new HouseMessengerStore(async()=>f.runtime);await s.start();expect(s.snapshot().chats).toHaveLength(2);expect(s.snapshot().messages.map(m=>m.room)).toEqual(['r_one','r_two']);});
 it('saves one message document without fabricating author, delivery, read or current identity',async()=>{const f=fakeRuntime();const s=new HouseMessengerStore(async()=>f.runtime);await s.start();await s.send('r_one',' A new message ');expect(f.raw.roomDraft.write).toHaveBeenCalledWith('r_one',expect.stringMatching(/^messages\/.+\.md$/),null,{creation:{type:'messenger_message',fields:expect.objectContaining({text:' A new message ',attachments:[]}),sections:{}}});const fields=f.raw.roomDraft.write.mock.calls[0][3].creation as {fields:Record<string,unknown>};expect(fields.fields).not.toHaveProperty('author');expect(fields.fields).not.toHaveProperty('delivered');expect(f.raw.call).not.toHaveBeenCalled();expect(s.snapshot().messages).toHaveLength(2);});
 it('writes same-Room replies with proper relative references',async()=>{const f=fakeRuntime();const s=new HouseMessengerStore(async()=>f.runtime);await s.start();await s.send('r_one','A reply',s.snapshot().messages[0]);expect(f.raw.roomDraft.write).toHaveBeenCalledWith('r_one',expect.any(String),null,expect.objectContaining({creation:expect.objectContaining({fields:expect.objectContaining({reply:`./${MESSAGE}.md`})})}));});
 it('rejects cross-Room replies before drafting',async()=>{const f=fakeRuntime([chat(),chat('r_two'),message('r_two')]);const s=new HouseMessengerStore(async()=>f.runtime);await s.start();await expect(s.send('r_one','Oops',s.snapshot().messages[0])).rejects.toThrow('not in this Room');expect(f.raw.roomDraft.write).not.toHaveBeenCalled();});
 it.each(['outside-room','duplicate','bad-path','bad-fields','missing-chat','missing-reply'])('rejects %s records',async(mode)=>{let docs:unknown[]=[chat(),message()];if(mode==='outside-room')docs.push(chat('r_unbound'));if(mode==='duplicate')docs.push(message());if(mode==='bad-path')docs=[{...chat(),path:'chats/other.md'}];if(mode==='bad-fields')docs=[{...chat(),fields:{title:'no id'}}];if(mode==='missing-chat')docs=[message()];if(mode==='missing-reply')docs=[chat(),{...message(),fields:{...message().fields,reply:'./33333333-3333-4333-8333-333333333333.md'}}];const f=fakeRuntime(docs),s=new HouseMessengerStore(async()=>f.runtime);await s.start();expect(s.snapshot().error).toBeTruthy();await expect(s.send('r_one','Blocked')).rejects.toThrow();expect(f.raw.roomDraft.write).not.toHaveBeenCalled();});
 it('does not seed automatically',async()=>{const f=fakeRuntime([]),s=new HouseMessengerStore(async()=>f.runtime);await s.start();expect(s.snapshot().chats).toEqual([]);expect(f.raw.roomDraft.write).not.toHaveBeenCalled();});
 it('stops saves after Room bindings change',async()=>{const f=fakeRuntime(),s=new HouseMessengerStore(async()=>f.runtime);await s.start();f.observations.rooms.publish([{locator:'r_two',name:'Team'}]);await expect(s.send('r_one','Blocked')).rejects.toThrow('bindings changed');expect(f.raw.save).not.toHaveBeenCalled();});
 it.each(['connection-refusal','storage-loss'] as const)('fails closed on %s',async(topic)=>{const f=fakeRuntime(),s=new HouseMessengerStore(async()=>f.runtime);await s.start();f.observations[topic].publish({reason:'changed'});await expect(s.send('r_one','Blocked')).rejects.toThrow();expect(f.raw.save).not.toHaveBeenCalled();});
 it('keeps errors visible after new snapshots',async()=>{const f=fakeRuntime(),s=new HouseMessengerStore(async()=>f.runtime);await s.start();f.observations['storage-loss'].publish('lost');f.setDocuments([chat(),message()]);expect(s.snapshot().error).toContain('lost');});
 it('does not discard a shared draft on CAS refusal',async()=>{const f=fakeRuntime(),s=new HouseMessengerStore(async()=>f.runtime);await s.start();f.raw.roomDraft.write.mockResolvedValueOnce({outcome:'changed'} as never);await expect(s.send('r_one','Keep this')).rejects.toThrow('draft changed');expect(f.raw.save).not.toHaveBeenCalled();expect(s.snapshot().error).toContain('needs review');});
 it('halts after an uncertain save rather than creating duplicates on retry',async()=>{const f=fakeRuntime(),s=new HouseMessengerStore(async()=>f.runtime);await s.start();f.raw.save.mockRejectedValueOnce(new Error('transport uncertain'));await expect(s.send('r_one','Keep')).rejects.toThrow('uncertain');await expect(s.send('r_one','Keep')).rejects.toThrow('needs review');expect(f.raw.roomDraft.write).toHaveBeenCalledTimes(1);});
 it('prevents repeated sends while the first save is pending',async()=>{const f=fakeRuntime(),s=new HouseMessengerStore(async()=>f.runtime);await s.start();let finish!:(value:unknown)=>void;f.raw.save.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}) as never);const first=s.send('r_one','First');await vi.waitFor(()=>expect(f.raw.save).toHaveBeenCalledTimes(1));await expect(s.send('r_one','Second')).rejects.toThrow('progress');finish({outcome:'saved',identifier:'1'});await first;expect(f.raw.roomDraft.write).toHaveBeenCalledTimes(1);});
 it('does not add donor-absent offline status or imply delivery',async()=>{const f=fakeRuntime(),s=new HouseMessengerStore(async()=>f.runtime);await s.start();f.observations['sync-status'].publish({lastCompleted:'2026-10-11T13:00:00Z',attentionRequired:[],providerUnreachable:true,state:'pending'});expect(s.snapshot().sync).toBe('');expect(s.snapshot().sync).not.toMatch(/delivered|read/i);});
 it('queues local text while halted and prevents attachment actions',async()=>{const f=fakeRuntime(),s=new HouseMessengerStore(async()=>f.runtime);await s.start();f.observations['service-mode'].publish('write-halted');await s.writeComposer('r_one','Paused text');expect(f.raw.save).not.toHaveBeenCalled();await s.send('r_one','Paused text');expect(f.raw.save).toHaveBeenCalledOnce();await expect(s.send('r_one','File',undefined,[new File(['a'],'file.txt')])).rejects.toThrow('uploads are paused');expect(f.raw.call).not.toHaveBeenCalled();s.dispose();});
 it('rejects oversized text before uploading and permits a corrected send',async()=>{
  const f=fakeRuntime(),s=new HouseMessengerStore(async()=>f.runtime);await s.start();
  const busy: boolean[]=[];const off=s.subscribe(()=>busy.push(s.snapshot().busy));
  await expect(s.send('r_one','x'.repeat(50001),undefined,[new File(['synthetic'],'note.txt',{type:'text/plain'})])).rejects.toThrow();
  expect(f.raw.call).not.toHaveBeenCalled();expect(f.raw.roomDraft.write).not.toHaveBeenCalled();expect(f.raw.save).not.toHaveBeenCalled();
  expect(busy).not.toContain(true);expect(s.snapshot()).toMatchObject({busy:false,error:null});
  await s.send('r_one','Corrected message');expect(f.raw.save).toHaveBeenCalledOnce();expect(s.snapshot().busy).toBe(false);off();s.dispose();
 });
 it('accepts the maximum text length without leaving the send lock set',async()=>{
  const f=fakeRuntime(),s=new HouseMessengerStore(async()=>f.runtime);await s.start();
  await s.send('r_one','x'.repeat(50000));expect(f.raw.save).toHaveBeenCalledOnce();expect(s.snapshot()).toMatchObject({busy:false,error:null});s.dispose();
 });
 it.each([
  {name:'x'.repeat(201),type:'text/plain',contents:'synthetic'},
  {name:'note.txt',type:'x'.repeat(101),contents:'synthetic'},
  {name:'   ',type:'text/plain',contents:'synthetic'},
  {name:'empty.txt',type:'text/plain',contents:''},
 ])('validates attachment metadata before any upload and allows correction: $name',async({name,type,contents})=>{
  const f=fakeRuntime(),s=new HouseMessengerStore(async()=>f.runtime);await s.start();
  await expect(s.send('r_one','Attachment',undefined,[new File(['valid'],'first.txt',{type:'text/plain'}),new File([contents],name,{type})])).rejects.toThrow();
  expect(f.raw.call).not.toHaveBeenCalled();expect(f.raw.roomDraft.write).not.toHaveBeenCalled();expect(s.snapshot()).toMatchObject({busy:false,error:null});
  await s.send('r_one','Corrected');expect(f.raw.save).toHaveBeenCalledOnce();s.dispose();
 });
 it('releases busy even if message preparation unexpectedly fails after locking',async()=>{
  const f=fakeRuntime(),s=new HouseMessengerStore(async()=>f.runtime);await s.start();
  const uuid=vi.spyOn(crypto,'randomUUID').mockImplementationOnce(()=>{throw new Error('Synthetic ID failure');});
  try {await expect(s.send('r_one','Keep this')).rejects.toThrow('Synthetic ID failure');}finally{uuid.mockRestore();}
  expect(s.snapshot()).toMatchObject({busy:false,error:null});expect(f.raw.save).not.toHaveBeenCalled();
  await s.send('r_one','Corrected');expect(f.raw.save).toHaveBeenCalledOnce();s.dispose();
 });
 it.each(['query','sync-status','service-mode','connection-refusal','storage-loss','room-drafts','rooms'] as const)('closes a late %s observation without subscribing and stops initialization',async(blocked)=>{
  const f=fakeRuntime();const pending=deferred<(typeof f.observations)[typeof blocked]>();
  const live=new Set<()=>void>();
  const subscriptions=Object.fromEntries(Object.entries(f.observations).map(([topic,watch])=>{
   const original=watch.subscribe;
   const subscribe=vi.spyOn(watch,'subscribe').mockImplementation(listener=>{const off=original(listener);live.add(listener);return()=>{live.delete(listener);return off();};});
   return [topic,subscribe];
  }));
  f.raw.observe.mockImplementation(topic=>topic===blocked?pending.promise:Promise.resolve(f.observations[topic]));
  const s=new HouseMessengerStore(async()=>f.runtime),changed=vi.fn();s.subscribe(changed);
  const starting=s.start();await vi.waitFor(()=>expect(f.raw.observe.mock.calls.some(([topic])=>topic===blocked)).toBe(true));
  const calls=f.raw.observe.mock.calls.length,snapshot=s.snapshot();
  s.dispose();changed.mockClear();expect(live.size).toBe(0);
  const late=f.observations[blocked],read=vi.spyOn(late,'current');pending.resolve(late);await starting;
  expect(subscriptions[blocked]).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();expect(late.close).toHaveBeenCalledOnce();
  expect(live.size).toBe(0);expect(f.raw.observe).toHaveBeenCalledTimes(calls);expect(changed).not.toHaveBeenCalled();expect(s.snapshot()).toBe(snapshot);
  s.dispose();expect(late.close).toHaveBeenCalledOnce();
 });
 it('owns the Room observation before its first render can dispose the store',async()=>{
  const f=fakeRuntime(),off=vi.fn(),subscribe=vi.spyOn(f.observations.rooms,'subscribe').mockReturnValue(off);
  const s=new HouseMessengerStore(async()=>f.runtime);s.subscribe(()=>s.dispose());await s.start();
  expect(subscribe).toHaveBeenCalledOnce();expect(off).toHaveBeenCalledOnce();expect(f.observations.rooms.close).toHaveBeenCalledOnce();
  expect(f.raw.observe).toHaveBeenCalledTimes(1);
 });
 it('removes a Room subscription returned after its synchronous notification disposes the store',async()=>{
  const f=fakeRuntime(),off=vi.fn();
  vi.spyOn(f.observations.rooms,'subscribe').mockImplementation(listener=>{listener();return off;});
  const s=new HouseMessengerStore(async()=>f.runtime);s.subscribe(()=>s.dispose());await s.start();
  expect(off).toHaveBeenCalledOnce();expect(f.observations.rooms.close).toHaveBeenCalledOnce();expect(f.raw.observe).toHaveBeenCalledTimes(1);
 });
 it('clears the connection timeout immediately and never restarts a disposed store',async()=>{
  vi.useFakeTimers();
  try {
   const f=fakeRuntime(),pending=deferred<typeof f.runtime>(),provider=vi.fn(()=>pending.promise);
   const s=new HouseMessengerStore(provider),starting=s.start();expect(vi.getTimerCount()).toBe(1);
   s.dispose();expect(vi.getTimerCount()).toBe(0);pending.resolve(f.runtime);await starting;await s.start();
   expect(provider).toHaveBeenCalledOnce();expect(f.raw.rooms).not.toHaveBeenCalled();expect(f.raw.observe).not.toHaveBeenCalled();
   const never=new HouseMessengerStore(provider);never.dispose();await never.start();expect(provider).toHaveBeenCalledOnce();
  }finally{vi.useRealTimers();}
 });
});

describe('sync-aware Messenger bindings',()=>{
 it('keeps loading before initial sync and recovers when completed empty bindings arrive later',async()=>{
  const f=fakeRuntime(),s=new HouseMessengerStore(async()=>f.runtime);
  f.observations.rooms.publish([]);
  f.observations['sync-status'].publish({...f.observations['sync-status'].current(),lastCompleted:null});
  await s.start();expect(s.snapshot()).toMatchObject({loading:true,error:null});expect(f.raw.rooms).not.toHaveBeenCalled();
  expect(f.raw.observe.mock.calls.some(([topic])=>topic==='query')).toBe(false);
  f.observations['sync-status'].publish({...f.observations['sync-status'].current(),lastCompleted:'2026-10-11T13:00:00Z'});
  expect(s.snapshot().loading).toBe(false);expect(s.snapshot().error).toContain('Bind a Messenger Room');
  f.observations.rooms.publish([{locator:'r_one',name:'Direct'},{locator:'r_two',name:'Group'}]);
  await vi.waitFor(()=>expect(s.snapshot()).toMatchObject({loading:false,error:null}));
  expect(s.snapshot().chats).toHaveLength(1);expect(f.raw.observe).toHaveBeenCalledWith('query',expect.objectContaining({rooms:['r_one','r_two']}));s.dispose();
 });
 it('requires completed sync even when cached bindings are available',async()=>{
  const f=fakeRuntime(),s=new HouseMessengerStore(async()=>f.runtime);
  f.observations['sync-status'].publish({...f.observations['sync-status'].current(),lastCompleted:null});
  await s.start();expect(s.snapshot()).toMatchObject({loading:true,error:null,chats:[]});
  f.observations['sync-status'].publish({...f.observations['sync-status'].current(),lastCompleted:'2026-10-11T13:00:00Z'});
  await vi.waitFor(()=>expect(s.snapshot().chats).toHaveLength(1));s.dispose();
 });
 it('recovers from temporary reach and authorization loss without erasing existing chat snapshots',async()=>{
  const f=fakeRuntime(),s=new HouseMessengerStore(async()=>f.runtime);await s.start();const bindings=f.observations.rooms.current();
  f.observations.rooms.publish([]);expect(s.snapshot().chats).toHaveLength(1);
  await expect(s.send('r_one','Keep draft')).rejects.toThrow('bindings changed');expect(f.raw.save).not.toHaveBeenCalled();
  f.observations.rooms.publish(bindings);await vi.waitFor(()=>expect(s.snapshot().error).toBeNull());
  f.observations['connection-refusal'].publish({reason:'temporary'});expect(s.snapshot().error).toContain('authorization');
  f.observations['connection-refusal'].publish(null);expect(s.snapshot().error).toBeNull();
  await s.send('r_one','Recovered');expect(f.raw.save).toHaveBeenCalledOnce();s.dispose();
 });
});

describe('durable browser-local message creation drafts',()=>{
 it('stages actual message fields while typing without Save, uploads, call or extra types',async()=>{
  const f=fakeRuntime(),s=new HouseMessengerStore(async()=>f.runtime);await s.start();
  await s.writeComposer('r_one','Unfinished message');
  const draft=s.snapshot().composerDrafts!.r_one;
  expect(draft.path).toBe(`messages/${draft.id}.md`);expect(draft.text).toBe('Unfinished message');
  expect(f.raw.roomDraft.write).toHaveBeenCalledWith('r_one',draft.path,null,{creation:{type:'messenger_message',fields:expect.objectContaining({id:draft.id,text:'Unfinished message',chat:'../chats/main.md'}),sections:{}}});
  expect(f.raw.save).not.toHaveBeenCalled();expect(f.raw.call).not.toHaveBeenCalled();
  await s.writeComposer('r_one','x'.repeat(50001));expect(s.snapshot().composerDrafts!.r_one.text).toHaveLength(50001);
  await expect(s.send('r_one','x'.repeat(50001))).rejects.toThrow();expect(f.raw.save).not.toHaveBeenCalled();s.dispose();
 });
 it('hydrates on a fresh store and explicitly sends the same draft path once',async()=>{
  const f=fakeRuntime(),first=new HouseMessengerStore(async()=>f.runtime);await first.start();
  await first.writeComposer('r_one','Keep across reload');const path=first.snapshot().composerDrafts!.r_one.path;first.dispose();
  const reload=new HouseMessengerStore(async()=>f.runtime);await reload.start();
  expect(reload.snapshot().composerDrafts!.r_one).toMatchObject({path,text:'Keep across reload'});expect(f.raw.save).not.toHaveBeenCalled();
  await reload.send('r_one','Keep across reload');expect(f.raw.save).toHaveBeenCalledOnce();
  expect(f.raw.save).toHaveBeenCalledWith('r_one',[{path,revision:expect.any(String)}]);
  expect(reload.snapshot().composerDrafts!.r_one).toBeUndefined();expect(f.drafts.size).toBe(0);reload.dispose();
 });
 it('keeps separate Room drafts and synchronizes other-tab typing without replacing disjoint reply selection',async()=>{
  const f=fakeRuntime([chat(),chat('r_two'),message()]),one=new HouseMessengerStore(async()=>f.runtime);await one.start();
  await one.writeComposer('r_one','Original');await one.writeComposer('r_two','Group draft');
  const two=new HouseMessengerStore(async()=>f.runtime);await two.start();
  await one.writeComposer('r_one','Original',one.snapshot().messages[0]);
  await two.writeComposer('r_one','Later text');
  expect(one.snapshot().composerDrafts!.r_one).toMatchObject({text:'Later text',reply:`./${MESSAGE}.md`});
  expect(two.snapshot().composerDrafts!.r_two.text).toBe('Group draft');
  expect(f.drafts.size).toBe(2);expect(f.raw.save).not.toHaveBeenCalled();one.dispose();two.dispose();
 });
 it('serializes fast typing and keeps the newest input',async()=>{
  const f=fakeRuntime(),s=new HouseMessengerStore(async()=>f.runtime);await s.start();
  await Promise.all(['a','ab','abc','abcd'].map(text=>s.writeComposer('r_one',text)));
  expect(s.snapshot().composerDrafts!.r_one.text).toBe('abcd');expect(f.drafts.size).toBe(1);expect(f.raw.save).not.toHaveBeenCalled();s.dispose();
 });
});
