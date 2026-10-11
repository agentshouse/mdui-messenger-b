import {afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {ChatComposer,ChatMessages, type ThreadMessage} from '../src/chatcn/chat';
import {ConversationItem} from '../src/chatcn/layouts';
import {App} from '../src/App';
import type {Store,Snapshot} from '../src/data/model';
import {MESSAGE,NOW} from './fakeRuntime';
afterEach(cleanup);
beforeAll(()=>{Object.defineProperty(window,'matchMedia',{configurable:true,value:()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}})});});
const message:ThreadMessage={id:'one',senderId:'real-head-author',senderName:'Alex',timestamp:NOW,text:'A real Room message'};
const props=()=>({value:'',onChange:vi.fn(),onSend:vi.fn(),files:[],onFiles:vi.fn(),onRemoveFile:vi.fn(),onCancelReply:vi.fn(),onVoiceRecord:vi.fn(),recording:false,voiceDisabled:false});
function fixture(){
 let resolve!:()=>void;
 const state:Snapshot={chats:[{room:'r_one',roomName:'Private boundary',path:'chats/main.md',id:'1',title:'Product',mode:'direct',created_at:NOW}],messages:[{room:'r_one',path:`messages/${MESSAGE}.md`,id:MESSAGE,text:'Saved Room text',kind:'text',attachments:[],created_at:NOW,chat:'../chats/main.md',author:{kind:'user',id:'head-id',name:'Alex'}}],callParts:[],loading:false,error:null,sync:'',busy:false,halted:false};
 const store:Store={start:vi.fn(async()=>{}),dispose:vi.fn(),snapshot:()=>state,subscribe:()=>()=>{},send:vi.fn(()=>new Promise<void>(r=>{resolve=r;})),initialize:vi.fn(async()=>{})};
 return {store,state,resolve:()=>resolve()};
}
describe('actual chatcn Room-bound components',()=>{
 it('renders the pinned conversation geometry without invented presence or unread state',()=>{
  render(<ConversationItem convo={{id:'r_one',title:'Design',lastMessage:'Latest Room text',lastMessageTime:'Oct 11'}} isActive onClick={()=>{}}/>);
  expect(screen.getByRole('button',{name:'Open Design chat'}).getAttribute('aria-current')).toBe('true');
  expect(document.querySelector('.rounded-xl')).toBeTruthy();
  expect(screen.queryByText(/online|unread|delivered|read receipt/i)).toBeNull();
 });
 it('uses controlled raw composer input without clearing it on Send',()=>{
  const p=props();const view=render(<ChatComposer {...p} value={'  raw\ntext  '}/>);
  fireEvent.click(screen.getByLabelText('Send message'));expect(p.onSend).toHaveBeenCalledOnce();
  expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('  raw\ntext  ');
  fireEvent.change(screen.getByLabelText('Message'),{target:{value:'   '}});expect(p.onChange).toHaveBeenCalledWith('   ');
  view.rerender(<ChatComposer {...p} value={'   '}/>);expect((screen.getByLabelText('Send message') as HTMLButtonElement).disabled).toBe(true);
 });
 it('does not Send on IME or Shift+Enter, and accepts plain Enter only when enabled',()=>{
  const p=props(),view=render(<ChatComposer {...p} value="Raw"/>),input=screen.getByLabelText('Message');
  fireEvent.keyDown(input,{key:'Enter',isComposing:true});fireEvent.keyDown(input,{key:'Enter',shiftKey:true});expect(p.onSend).not.toHaveBeenCalled();
  fireEvent.keyDown(input,{key:'Enter'});expect(p.onSend).toHaveBeenCalledOnce();
  view.rerender(<ChatComposer {...p} value="Raw" sendDisabled/>);fireEvent.keyDown(input,{key:'Enter'});expect(p.onSend).toHaveBeenCalledOnce();
 });
 it('can send existing native attachment references without new files or text',()=>{
  const p=props();render(<ChatComposer {...p} hasAttachments/>);fireEvent.click(screen.getByLabelText('Send message'));expect(p.onSend).toHaveBeenCalledOnce();
 });
 it('only selects attachments and removes them locally, never auto-sends',()=>{
  const p=props(),file=new File(['data'],'example.txt',{type:'text/plain'});render(<ChatComposer {...p} files={[file]}/>);
  fireEvent.change(screen.getByLabelText('Choose attachments'),{target:{files:[file]}});expect(p.onFiles).toHaveBeenCalledWith([file]);
  fireEvent.click(screen.getByLabelText('Remove example.txt'));expect(p.onRemoveFile).toHaveBeenCalledWith(0);expect(p.onSend).not.toHaveBeenCalled();
 });
 it('shows actual reply preview and Escape cancels only reply selection',()=>{
  const p=props();render(<ChatComposer {...p} value="Keep text" replyingTo={message}/>);
  fireEvent.keyDown(screen.getByLabelText('Message'),{key:'Escape'});expect(p.onCancelReply).toHaveBeenCalledOnce();expect(p.onChange).not.toHaveBeenCalled();expect(p.onSend).not.toHaveBeenCalled();
 });
 it('renders neutral author groups without inferring own-message identity',()=>{
  render(<ChatMessages messages={[message,{...message,id:'two',text:'Second same-author message'}]} empty="Empty" onReply={()=>{}}/>);
  expect(screen.getAllByText('Alex')).toHaveLength(1);expect(document.querySelector('.flex-row-reverse')).toBeNull();
  expect(screen.queryByText(/^you$|delivered|read$/i)).toBeNull();expect(screen.getAllByRole('article')).toHaveLength(2);
 });
 it('does not group two unavailable authors into one identity',()=>{
  render(<ChatMessages messages={[{...message,senderId:null},{...message,id:'two',senderId:null}]} empty="Empty" onReply={()=>{}}/>);
  expect(screen.getAllByText('Alex')).toHaveLength(2);
 });
 it('renders Provider outcome details without synthesizing a delivery state',()=>{
  render(<ChatMessages messages={[{...message,outcome:<span>Queued locally; waiting for House.</span>}]} empty="Empty" onReply={()=>{}}/>);
  expect(screen.getByText('Queued locally; waiting for House.')).toBeTruthy();expect(screen.queryByText(/delivered|read receipt/i)).toBeNull();
 });
 it('only exposes implemented reply/edit actions and escapes untrusted text',()=>{
  const reply=vi.fn(),edit=vi.fn();render(<ChatMessages messages={[{...message,text:'<script>doNotRun()</script>'}]} empty="Empty" onReply={reply} onEdit={edit}/>);
  fireEvent.click(screen.getByLabelText('Reply to message one'));expect(reply).toHaveBeenCalledWith(expect.objectContaining({id:'one'}));
  fireEvent.click(screen.getByLabelText('Edit message one'));expect(edit).toHaveBeenCalledWith(expect.objectContaining({id:'one'}));
  expect(document.querySelector('script')).toBeNull();expect(screen.queryByLabelText(/reaction|pin|delete|read receipt/i)).toBeNull();
 });
 it('preserves newer text during an in-flight Send and does not issue a second send',async()=>{
  const f=fixture();render(<App store={f.store}/>);fireEvent.click(screen.getByLabelText('Open Product chat'));
  fireEvent.change(screen.getByLabelText('Message'),{target:{value:'First'}});fireEvent.click(screen.getByLabelText('Send message'));
  fireEvent.change(screen.getByLabelText('Message'),{target:{value:'Newer'}});fireEvent.click(screen.getByLabelText('Send message'));f.resolve();
  await waitFor(()=>expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('Newer'));expect(f.store.send).toHaveBeenCalledOnce();
 });
 it('preserves a newer reply selection when older Send finishes',async()=>{
  const f=fixture();render(<App store={f.store}/>);fireEvent.click(screen.getByLabelText('Open Product chat'));
  fireEvent.change(screen.getByLabelText('Message'),{target:{value:'First'}});fireEvent.click(screen.getByLabelText('Send message'));
  fireEvent.click(screen.getByLabelText(`Reply to message ${MESSAGE}`));f.resolve();
  await waitFor(()=>expect(screen.getByLabelText('Cancel reply')).toBeTruthy());expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('First');
 });
 it('switches the actual donor theme without provider calls or storage',()=>{
  const f=fixture();render(<App store={f.store}/>);expect(document.querySelector('[data-chat-theme="aurora"]')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Use dark theme'));expect(document.querySelector('[data-chat-theme="midnight"]')).toBeTruthy();expect(f.store.send).not.toHaveBeenCalled();
 });
 it('opens the native message editor using draft value and never saves merely on input',()=>{
  const f=fixture(),original=f.state.messages[0];f.store.writeMessage=vi.fn(async()=>{});f.store.saveMessage=vi.fn(async()=>{});
  f.state.messageDrafts={[`${original.room}/${original.path}`]:{room:original.room,path:original.path,text:'Restored raw local edit'}};
  render(<App store={f.store}/>);fireEvent.click(screen.getByLabelText('Open Product chat'));fireEvent.click(screen.getByLabelText(`Edit message ${MESSAGE}`));
  expect((screen.getByLabelText('Edit message text') as HTMLTextAreaElement).value).toBe('Restored raw local edit');
  fireEvent.change(screen.getByLabelText('Edit message text'),{target:{value:'   '}});expect(f.store.writeMessage).toHaveBeenCalledWith(original,'   ');expect(f.store.saveMessage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Save changes'));expect(f.store.saveMessage).toHaveBeenCalledWith(original);
 });
});

it('shows a returned creation draft refusal beside the restored composer',()=>{
 const f=fixture(),path='messages/11111111-1111-4111-8111-111111111111.md';
 f.state.composerDrafts={r_one:{room:'r_one',path,id:'11111111-1111-4111-8111-111111111111',text:'Retained after rejection',created_at:NOW,attachments:[]}};
 f.state.messageOutcomes={[`r_one/${path}`]:{status:'rejected',details:'House rejected: permission_changed. The draft is preserved.'}};
 render(<App store={f.store}/>);fireEvent.click(screen.getByLabelText('Open Product chat'));
 expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('Retained after rejection');
 expect(screen.getByRole('alert').textContent).toContain('permission_changed');expect(f.store.send).not.toHaveBeenCalled();
});

it('exposes same-message retained attachment edits for explicit review and Save',()=>{
 const f=fixture(),original=f.state.messages[0];f.store.writeMessage=vi.fn(async()=>{});f.store.saveMessage=vi.fn(async()=>{});
 f.state.messageDrafts={[`${original.room}/${original.path}`]:{room:original.room,path:original.path,text:original.text,attachments:[{attachment_ref:'at_retained',name:'acknowledged.txt',bytes:10,mime:'text/plain'}]}};
 render(<App store={f.store}/>);fireEvent.click(screen.getByLabelText('Open Product chat'));fireEvent.click(screen.getByLabelText(`Edit message ${MESSAGE}`));
 expect(screen.getByText(/Files retained in this message draft: acknowledged.txt/)).toBeTruthy();expect(f.store.saveMessage).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText('Save changes'));expect(f.store.saveMessage).toHaveBeenCalledWith(original);
});
