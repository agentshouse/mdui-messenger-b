// Operator-only ordinary chat sample. This creates no call, recording or Agent history.
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
const pin = '25daf263eaea42d125c942a80e2ed03cc72b3fe2';
const source = fs.readFileSync('samples/donor/messages.ts', 'utf8');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context, { timeout: 1000 });
const events = context.exports.EVENTS;
if (events.length !== 17 || events.some(e => e.content.type !== 'message' || !e.content.text || e.content.files?.length)) throw new Error('Unexpected donor sample shape');
const uuid = key => { const b=crypto.createHash('sha1').update(`${pin}:${key}`).digest();b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.subarray(0,16).toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`; };
const markdown = (type, fields) => `---\n${Object.entries({ type, ...fields }).map(([key,value])=>`${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n`;
const manifest=[];const payloads=[];
for (const mode of ['direct','group']) {
 const chat={ id:uuid(`${mode}:chat`), title:`Licensed donor chat sample (${mode} Room)`, mode, created_at:new Date(Math.min(...events.map(e=>e.timestamp))).toISOString() };
 const documents=[{path:'chats/main.md',content:markdown('messenger_chat',chat)}];
 for(const e of events) {const id=uuid(`${mode}:message:${e.id}`);documents.push({path:`messages/${id}.md`,content:markdown('messenger_message',{id,chat:'../chats/main.md',text:`[Licensed donor sample · ${e.sender.name}]\n${e.content.text}`,created_at:new Date(e.timestamp).toISOString(),kind:'text',attachments:[]})});}
 for(const d of documents){fs.mkdirSync(`samples/${mode}/${d.path.split('/')[0]}`,{recursive:true});fs.writeFileSync(`samples/${mode}/${d.path}`,d.content);}
 manifest.push({folder:mode,files:documents.map(d=>d.path)});payloads.push({folder:mode,requires_separate_room:true,changes:documents.map(d=>({op:'create',...d}))});
}
fs.writeFileSync('scripts/sample-rooms.json',JSON.stringify(manifest,null,2)+'\n');fs.writeFileSync('scripts/donor-seed-rooms.json',JSON.stringify(payloads,null,2)+'\n');
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
fs.writeFileSync('samples/PROVENANCE.json',JSON.stringify({repository:'https://github.com/Mesailor/shadcn-chat',commit:pin,source:'src/data/messages.ts',source_sha256:hash(source),license:'MIT',license_sha256:hash(fs.readFileSync('samples/donor/LICENSE')),counts:{rooms:2,chats_per_room:1,messages_per_room:17,total_documents:36,unique_donor_messages:17},transform:['Reuse all17 ordinary donor example messages verbatim, preserving donor timestamps/order and two donor speaker labels. Each separate access-boundary Room receives a complete independent copy.','Prefix message text with Licensed donor sample and the donor fictional speaker name. Provider head author is the importing account, never claimed to be the donor speaker.','Map donor integer IDs to deterministic namespaced UUID-shaped IDs independently per Room; add relative chat reference and empty attachment list. Titles are explicit import metadata.','Omit external CDN avatars/usernames and claimed delivery status; no attachment, recording, call, model output or Agent conversation is fabricated.','Source/fixtures are operator-only, excluded from runtime import and release. No auto-seed or real device/call/Agent action.']},null,2)+'\n');console.log('Two independent Room payloads; each1chat+17messages;36documents total');
