import {afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {App} from '../src/App';
import type {Store,Snapshot} from '../src/data/model';
import {MESSAGE,NOW} from './fakeRuntime';
import {ChatToolbarTextarea} from '../registry/new-york/chat/chat-toolbar';
afterEach(cleanup);
beforeAll(()=>{Object.defineProperty(window,'matchMedia',{value:()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}})});globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}} as typeof ResizeObserver;});
function store():Store & {send:ReturnType<typeof vi.fn>} {
 const state:Snapshot={chats:[{room:'r_one',roomName:'Product room',path:'chats/main.md',id:'1',title:'Product',mode:'direct',created_at:NOW},{room:'r_two',roomName:'Team room',path:'chats/main.md',id:'2',title:'Team',mode:'group',created_at:NOW}],messages:[{room:'r_one',path:`messages/${MESSAGE}.md`,id:MESSAGE,text:'Review the first draft',kind:'text',attachments:[],created_at:NOW,chat:'../chats/main.md',author:{kind:'user',id:'u_a',name:'Alex'}}],callParts:[],loading:false,error:null,sync:'',busy:false,halted:false};
 return {start:vi.fn(async()=>{}),dispose:vi.fn(),snapshot:()=>state,subscribe:()=>()=>{},send:vi.fn(async()=>{}),initialize:vi.fn(async()=>{})};
}
describe('retained donor chat UI and House composition',()=>{
 it('keeps saved call parts and their speaker files without any Agent draft action (Master1118)',()=>{
   const s=store(); const callId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
   s.snapshot().callParts.push({room:'r_one',path:`call-parts/${callId}-part-1.md`,id:`${callId}-part-1`,call_id:callId,wire_call_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',call:`../calls/${callId}.md`,part:1,start:NOW,start_offset_ms:0,duration_ms:1000,participants:[{id:'local-peer',name:'This device'},{id:'remote-peer',name:'Remote fixture'}],files:[{attachment_ref:'at_local_fixture',name:'local-speaker.webm',mime:'audio/webm',bytes:100,speaker_id:'local-peer'},{attachment_ref:'at_remote_fixture',name:'remote-speaker.webm',mime:'audio/webm',bytes:100,speaker_id:'remote-peer'}]});
   render(<App store={s}/>);fireEvent.click(screen.getByRole('button',{name:'Open Product chat'}));
   fireEvent.click(screen.getByText('Recorded call parts (1)'));
   expect(screen.getByText('Part 1')).toBeTruthy();
   expect(screen.getByText(/local-speaker.webm/)).toBeTruthy();expect(screen.getByText(/remote-speaker.webm/)).toBeTruthy();
   expect(screen.queryByRole('button',{name:/send to agent/i})).toBeNull();
   expect(screen.queryByText(/conditional shared-draft/)).toBeNull();
   expect(s.send).not.toHaveBeenCalled();
 });
 it('shows per-Room chat list and opens a real donor chat/header/event/toolbar',()=>{render(<App store={store()}/>);fireEvent.click(screen.getByRole('button',{name:'Open Product chat'}));expect(document.querySelector('[data-slot="chat"]')).toBeTruthy();expect(document.querySelector('[data-slot="chat-header"]')).toBeTruthy();expect(document.querySelector('[data-slot="chat-event"]')).toBeTruthy();expect(document.querySelector('[data-slot="chat-toolbar"]')).toBeTruthy();expect(screen.getByText('Alex')).toBeTruthy();});
 it('preserves separate drafts and reply selection across chat navigation',()=>{render(<App store={store()}/>);fireEvent.click(screen.getByRole('button',{name:'Open Product chat'}));fireEvent.change(screen.getByLabelText('Message'),{target:{value:'Product draft'}});fireEvent.click(screen.getByLabelText(`Reply to message ${MESSAGE}`));fireEvent.click(screen.getByRole('button',{name:'Open Team chat'}));fireEvent.change(screen.getByLabelText('Message'),{target:{value:'Team draft'}});fireEvent.click(screen.getByRole('button',{name:'Open Product chat'}));expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('Product draft');expect(screen.getByLabelText('Cancel reply')).toBeTruthy();});
 it('sends explicitly and clears only the matching composer after success',async()=>{const s=store();render(<App store={s}/>);fireEvent.click(screen.getByRole('button',{name:'Open Product chat'}));fireEvent.change(screen.getByLabelText('Message'),{target:{value:'Hi'}});fireEvent.click(screen.getByLabelText('Send message'));await waitFor(()=>expect(s.send).toHaveBeenCalledWith('r_one','Hi',undefined,[]));await waitFor(()=>expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe(''));});
 it('preserves composer on failed send',async()=>{const s=store();s.send.mockRejectedValueOnce(new Error('Save refused'));render(<App store={s}/>);fireEvent.click(screen.getByRole('button',{name:'Open Product chat'}));fireEvent.change(screen.getByLabelText('Message'),{target:{value:'Keep me'}});fireEvent.click(screen.getByLabelText('Send message'));await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('Save refused'));expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('Keep me');});
 it('filters messages without generating fake empty-state messages',()=>{render(<App store={store()}/>);fireEvent.click(screen.getByRole('button',{name:'Open Product chat'}));fireEvent.change(screen.getByLabelText('Search messages'),{target:{value:'no match'}});expect(screen.getByText('No matching messages.')).toBeTruthy();});
 it('opens the actual donor call screen in honest unavailable state, no capture',async()=>{const media={getUserMedia:vi.fn(),enumerateDevices:vi.fn()};Object.defineProperty(navigator,'mediaDevices',{value:media,configurable:true});render(<App store={store()}/>);fireEvent.click(screen.getByRole('button',{name:'Open Product chat'}));fireEvent.click(screen.getByLabelText('Audio call'));expect(await screen.findByLabelText('Call a holder')).toBeTruthy();expect(screen.getByLabelText('Recording destination')).toBeTruthy();expect(media.getUserMedia).not.toHaveBeenCalled();expect(media.enumerateDevices).not.toHaveBeenCalled();fireEvent.click(screen.getAllByRole('button',{name:'Close'})[0]);await waitFor(()=>expect(screen.queryByLabelText('Call a holder')).toBeNull());expect(media.getUserMedia).not.toHaveBeenCalled();});
 it('uses inert escaped text rather than HTML message content',()=>{const s=store();s.snapshot().messages[0].text='<img src="https://remote.test/x" onerror="alert(1)">';render(<App store={s}/>);fireEvent.click(screen.getByRole('button',{name:'Open Product chat'}));expect(document.querySelector('img[src^="https"]')).toBeNull();});
 it('does not send during IME composition or Shift+Enter',()=>{const submit=vi.fn();render(<ChatToolbarTextarea aria-label="Composer" onSubmit={submit}/>);const input=screen.getByLabelText('Composer');fireEvent.keyDown(input,{key:'Enter',isComposing:true});fireEvent.keyDown(input,{key:'Enter',shiftKey:true});expect(submit).not.toHaveBeenCalled();fireEvent.keyDown(input,{key:'Enter'});expect(submit).toHaveBeenCalledTimes(1);});
});

it('keeps donor chat labels without exposing storage Room names or sync instrumentation',()=>{render(<App store={store()}/>);expect(screen.getByRole('button',{name:'Open Product chat'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Open Product chat'}));expect(screen.queryByText(/Product room/)).toBeNull();expect(screen.queryByText('Team room')).toBeNull();expect(screen.queryByText(/Saved in House|Offline|Syncing/)).toBeNull();});
it('retains actionable draft and write-halt notices',()=>{const s=store();s.snapshot().sync='House drafts need attention';s.snapshot().halted=true;render(<App store={s}/>);expect(screen.getByText('House drafts need attention')).toBeTruthy();expect(screen.getByText(/writes are paused/)).toBeTruthy();});

it('preserves an unfinished composer across binding loss and subsequent recovery',async()=>{
 const {HouseMessengerStore}=await import('../src/data/house');
 const {fakeRuntime}=await import('./fakeRuntime');
 const {act}=await import('@testing-library/react');
 const f=fakeRuntime(),s=new HouseMessengerStore(async()=>f.runtime);
 render(<App store={s}/>);fireEvent.click(await screen.findByRole('button',{name:'Open Design review chat'}));
 const composer=screen.getByLabelText('Message') as HTMLTextAreaElement;
 fireEvent.change(composer,{target:{value:'Keep this unfinished message'}});
 const bindings=f.observations.rooms.current();
 act(()=>f.observations.rooms.publish([]));
 expect((screen.getByLabelText('Send message') as HTMLButtonElement).disabled).toBe(true);
 expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('Keep this unfinished message');
 act(()=>f.observations.rooms.publish(bindings));
 await waitFor(()=>expect(s.snapshot().error).toBeNull());
 expect(screen.getByLabelText('Message')).toBe(composer);
 expect(composer.value).toBe('Keep this unfinished message');
 expect((screen.getByLabelText('Send message') as HTMLButtonElement).disabled).toBe(false);
 expect(f.raw.save).not.toHaveBeenCalled();
});

it('restores a Room-local composer after full App/store remount without sending',async()=>{
 const {HouseMessengerStore}=await import('../src/data/house');const {fakeRuntime}=await import('./fakeRuntime');
 const f=fakeRuntime(),first=new HouseMessengerStore(async()=>f.runtime);const view=render(<App store={first}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Open Design review chat'}));
 fireEvent.change(screen.getByLabelText('Message'),{target:{value:'My persistent message'}});
 await waitFor(()=>expect(first.snapshot().availableDrafts?.[0].text).toBe('My persistent message'));
 view.unmount();const reload=new HouseMessengerStore(async()=>f.runtime);render(<App store={reload}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Open Design review chat'}));
 expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('My persistent message');
 expect(f.raw.save).not.toHaveBeenCalled();expect(f.raw.call).not.toHaveBeenCalled();
});
