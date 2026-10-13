import {vi} from 'vitest';
import {assertStrictLocalQuery} from './strictQuery';
import type {Runtime} from '../src/data/house';
import type {RoomDraft, DraftParts} from '../src/data/draft-session';
export const ID='11111111-1111-4111-8111-111111111111';
export const MESSAGE='22222222-2222-4222-8222-222222222222';
export const NOW='2026-10-10T09:00:00Z';
export const chat=(room='r_one')=>({room,path:'chats/main.md',type:'messenger_chat',fields:{id:ID,title:'Design review',mode:'direct',created_at:NOW}});
export const message=(room='r_one')=>({room,path:`messages/${MESSAGE}.md`,type:'messenger_message',fields:{id:MESSAGE,chat:'../chats/main.md',text:'Ready for review',kind:'text',attachments:[],created_at:NOW},change:{author:{kind:'user',id:'u_alex',name:'Alex'}}});
export function observation<T>(value:T){let current=value;const listeners=new Set<()=>void>();return {current:()=>current,subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>listeners.delete(listener);},close:vi.fn(),publish:(next:T)=>{current=next;listeners.forEach(fn=>fn());}};}
type Document={room:string;path:string;type?:string;fields?:Record<string,unknown>;sections?:Record<string,string>;change?:unknown};
type Queue=readonly ({batch:{id:string;baseRoomVersion:string;changes:readonly {kind:'field';path:string;name:string;value:unknown}[];preconditions:readonly unknown[]}} & ({state:'waiting'|'submitted'}|{state:'reset';reset:string}|{state:'accepted';roomVersion:string}))[];
export function fakeRuntime(initial:unknown[]=[chat(),message()]) {
 let docs=initial as Document[]; const drafts=new Map<string,RoomDraft>(); let revision=0;
 const key=(room:string,path:string)=>`${room}/${path}`;
 const rooms=observation([{locator:'r_one',name:'Design review'},{locator:'r_two',name:'Team'}]);
 const draftWatch=observation<RoomDraft[]>([]);
 const observations={'room-drafts':draftWatch,query:observation({documents:docs}),queue:observation<Queue>([]),rooms,'sync-status':observation({lastCompleted:NOW as string|null,attentionRequired:[],providerUnreachable:false,state:'synced'}),'service-mode':observation('open'),'connection-refusal':observation<unknown>(null),'storage-loss':observation<unknown>(null)};
 const roomQueues=new Map([['r_one',observations.queue],['r_two',observation<Queue>([])]]);
 const binaries=new Map<string,Blob>();
 const raw={
  binaryFile:{read:vi.fn(async(room:string,path:string)=>binaries.has(key(room,path))?{kind:"binary",blob:binaries.get(key(room,path))}:{kind:"absent",code:"not_found",retryable:false})},
  rooms:vi.fn(async()=>rooms.current()),query:vi.fn(async(input:unknown)=>{assertStrictLocalQuery(input);return {documents:docs};}),
  observe:vi.fn(async(topic:keyof typeof observations,input?:unknown)=>{if(topic==='query')assertStrictLocalQuery(input);if(topic==='queue'&&typeof input==='string')return roomQueues.get(input)??observations.queue;return observations[topic];}),
  reached:vi.fn(async()=>false),
  roomDraft:{
   list:vi.fn(async()=>[...drafts.values()]),
   read:vi.fn(async(room:string,path:string)=>drafts.get(key(room,path))??null),
   write:vi.fn(async(room:string,path:string,base:unknown,parts:DraftParts)=>{
    const prior=drafts.get(key(room,path));
    if((prior?.revision??null)!==base)return {outcome:'stale',current:prior??null};
    const draft:RoomDraft={room,path,revision:`draft-${++revision}`,parts:parts as RoomDraft['parts'],returned:prior?.returned??null,changedUnderneath:prior?.changedUnderneath??{}};
    drafts.set(key(room,path),draft);draftWatch.publish([...drafts.values()]);return {outcome:'written',roomDraft:draft};
   }),
  },
  save:vi.fn(async(room:string,entries:{path:string;revision:string}[])=>{
   for(const entry of entries)if(drafts.get(key(room,entry.path))?.revision!==entry.revision)return {outcome:'refused',code:'stale',retryable:false};
   for(const entry of entries){
    const draft=drafts.get(key(room,entry.path))!;
    if(draft.parts.file){binaries.set(key(room,entry.path),(draft.parts.file as {blob:Blob}).blob);drafts.delete(key(room,entry.path));continue;}
    const creation=draft.parts.creation;
    const existing=docs.find(doc=>doc.room===room&&doc.path===entry.path);
    if(creation && 'type' in creation) docs=[...docs,{room,path:entry.path,type:creation.type,fields:{...creation.fields},sections:{...creation.sections},change:{author:{kind:'user',id:'u_member',name:'Room member'}}}];
    else if(existing) docs=docs.map(doc=>doc===existing?{...doc,fields:{...doc.fields,...Object.fromEntries(Object.entries(draft.parts.fields??{}).map(([name,field])=>[name,field.value]))},sections:{...doc.sections,...Object.fromEntries(Object.entries(draft.parts.sections??{}).map(([name,section])=>[name,section.value]))}}:doc);
    drafts.delete(key(room,entry.path));
   }
   draftWatch.publish([...drafts.values()]);observations.query.publish({documents:docs});return {outcome:'saved',identifier:'save-1'};
  }),
  call:vi.fn(async()=>({kind:'action',result:null})),
 };
 return {runtime:raw as unknown as Runtime,raw,observations,roomQueues,drafts,setDocuments:(next:unknown[])=>{docs=next as Document[];observations.query.publish({documents:docs});}};
}
