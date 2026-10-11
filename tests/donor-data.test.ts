import { test, expect } from 'vitest';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { HouseMessengerStore } from '../src/data/house';
import { fakeRuntime } from './fakeRuntime';

test('licensed chat payloads are complete, isolated and contain no call or media history', async () => {
 const provenance=JSON.parse(fs.readFileSync('tests/support/samples/PROVENANCE.json','utf8'));
 for(const [file,key] of [['messages.ts','source_sha256'],['LICENSE','license_sha256']]) expect(crypto.createHash('sha256').update(fs.readFileSync(`tests/support/samples/donor/${file}`)).digest('hex')).toBe(provenance[key]);
 const payloads=JSON.parse(fs.readFileSync('tests/support/donor-seed-rooms.json','utf8')) as {folder:string;requires_separate_room:boolean;changes:{path:string;content:string}[]}[];
 expect(payloads.map(p=>p.folder)).toEqual(['direct','group']); const ids = new Set();
 const documents=payloads.flatMap((payload,index)=>{
  expect(payload.requires_separate_room).toBe(true);expect(payload.changes).toHaveLength(18);
  return payload.changes.map(change=>{
   const fields=Object.fromEntries(change.content.split('\n').slice(1,-2).map(line=>{const i=line.indexOf(':');return [line.slice(0,i),JSON.parse(line.slice(i+1).trim())];}));
   expect(ids.has(fields.id)).toBe(false);ids.add(fields.id);const type=fields.type;delete fields.type;
   expect(['messenger_chat','messenger_message']).toContain(type);
   if(type==='messenger_message'){expect(fields.text).toMatch(/^\[Licensed donor sample · (Ann Smith|John Doe)\]\n/);expect(fields.attachments).toEqual([]);expect(fields.chat).toBe('../chats/main.md');expect(fields).not.toHaveProperty('author');}
   return {room:index===0?'r_one':'r_two',path:change.path,type,fields,markdown:change.content};
  });
 });
 const fake=fakeRuntime(documents);const store=new HouseMessengerStore(async()=>fake.runtime);await store.start();expect(store.snapshot().error).toBeFalsy();expect(store.snapshot().chats).toHaveLength(2);expect(store.snapshot().messages).toHaveLength(34);expect(fake.raw.roomDraft.write).not.toHaveBeenCalled();store.dispose();
});
