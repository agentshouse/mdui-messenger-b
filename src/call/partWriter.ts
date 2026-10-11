import type {Runtime} from '../data/house';
import {uploadAttachment, readAttachment, MAX_FILE_BYTES} from '../data/assets';
import {callPartSchema, callSchema, chatSchema, type Attachment, type CallPartFields} from '../data/model';
import {type CallPart, type CommitResult} from './callParts';

type Participant = Readonly<{id:string;name:string}>;
type Stored = {path:string;type:string;fields:Record<string,unknown>};
type Receipt = {
  part: CallPart | null; original: WeakRef<CallPart>; attachments: Map<string, Attachment>; uploadUnknown: boolean;
  drafts: Map<string,string>; documents: Stored[]; batch?: string; saveUnknown: boolean;
  result?: CommitResult; committed: boolean;
};
type Watch<T> = {current():T;subscribe(listener:(value:T)=>void):()=>void;close():void};
export type PartWriterOptions = {
  runtime: Runtime; roomId: string; callId: string; wireCallId: string; callStartedAt: string;
  /** Negotiated per-call/copy identities; never label these as authenticated current User ids. */
  participants: readonly Participant[];
  signal?: AbortSignal;
  /** Test seams; production defaults are the exact documented House attachment calls. */
  assets?: {upload:typeof uploadAttachment;read:typeof readAttachment};
};
const committed = ():CommitResult=>({outcome:'committed'});
const rejected = (reason:string):CommitResult=>({outcome:'rejected',reason});
const uncertain = (reason:string):CommitResult=>({outcome:'uncertain',reason});
const reason = (error:unknown)=>error instanceof Error?error.message:String(error);
const stable = (value:unknown):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stable(item)])):value;
const same = (a:unknown,b:unknown):boolean=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
function covered(scopes:readonly string[],path:string):boolean {
  return scopes.some(raw=>{
    const segments=raw.split('/').filter(x=>x&&x!=='.');
    if(segments.some(x=>x==='..'))return false;
    const prefix=segments.join('/');return prefix===''||path===prefix||path.startsWith(`${prefix}/`);
  });
}

/**
 * One presser's explicit Send writer, bound for its entire lifetime to one Room and
 * local recording-session UUID. No capture, automatic send, fallback Room, signal,
 * or Agent turn. A local save acknowledgement is NOT provider confirmation.
 */
export class HouseCallPartWriter {
  private readonly md:Runtime;
  private readonly assets:NonNullable<PartWriterOptions['assets']>;
  private readonly participants:readonly Participant[];
  private readonly receipts=new Map<string,Receipt>();
  private readonly aborter=new AbortController();
  private busy=false;
  private committedCount=0;

  constructor(private readonly options:PartWriterOptions) {
    this.md=options.runtime;
    this.assets=options.assets??{upload:uploadAttachment,read:readAttachment};
    this.participants=Object.freeze(options.participants.map(x=>Object.freeze({...x})));
    callSchema.parse({id:options.callId,wire_call_id:options.wireCallId,chat:'../chats/main.md',started_at:options.callStartedAt,participants:this.participants});
    if(new Set(this.participants.map(x=>x.id)).size!==2)throw new Error('Two distinct negotiated call participants are required.');
    this.options=Object.freeze({...options,participants:this.participants});
    options.signal?.addEventListener('abort',()=>this.aborter.abort(),{once:true});
    if(options.signal?.aborted)this.aborter.abort();
  }

  /** Invoke only from the explicit Send callback. Duplicate calls never repeat writes. */
  commit = async (part:CallPart):Promise<CommitResult>=>{
    if(this.aborter.signal.aborted)return uncertain('The recording writer is closed. Check House before retrying a pending send.');
    if(this.busy)return rejected('A call-part send or reconciliation is already in progress.');
    let receipt:Receipt;
    try {this.validatePart(part);receipt=this.receipt(part);}catch(error){return rejected(reason(error));}
    if(receipt.committed)return committed();
    if(receipt.uploadUnknown||receipt.saveUnknown||receipt.batch)return uncertain('The previous upload or save outcome must be reconciled. No request was repeated.');
    if(part.number!==this.committedCount+1)return rejected('Resolve the preceding call part before sending a new part.');
    this.busy=true;
    let watcher:ReturnType<HouseCallPartWriter['watchConfirmation']>|undefined;
    try {
      await this.writable();
      await this.checkExisting(receipt);
      for(const file of part.files) {
        if(receipt.attachments.has(file.speakerId))continue;
        await this.writable();
        const suffix=file.blob.type.includes('ogg')?'ogg':file.blob.type.includes('mp4')?'m4a':'webm';
        const name=`${part.id}-speaker-${this.participants.findIndex(x=>x.id===file.speakerId)+1}.${suffix}`;
        const content=new File([file.blob],name,{type:file.blob.type});
        // Mark before crossing the upload boundary; an exception cannot prove no upload.
        receipt.uploadUnknown=true;
        const attachment=await this.assets.upload(this.md,this.options.roomId,content);
        receipt.attachments.set(file.speakerId,Object.freeze({...attachment}));
        receipt.uploadUnknown=false;
      }
      for(const attachment of receipt.attachments.values()) {
        if(this.aborter.signal.aborted)throw new Error('The recording writer was closed.');
        const read=await this.assets.read(this.md,this.options.roomId,attachment);
        if(!read.blob)return this.result(receipt,uncertain('House has the audio reference but its bytes are not readable yet. Recheck before saving the call part.'));
      }
      receipt.documents=await this.documents(receipt);
      await this.writable();
      // Observe before Save, so a fast accepted-and-refreshed batch is not missed.
      watcher=this.watchConfirmation(receipt);
      await watcher.ready;
      for(const document of receipt.documents) {
        await this.writable();
        const draft=await this.md.roomDraft.read(this.options.roomId,document.path);
        const ownRevision=receipt.drafts.get(document.path);
        if(draft) {
          if(draft.revision!==ownRevision||!same(draft.parts,{creation:{type:document.type,fields:document.fields,sections:{}}}))return this.result(receipt,rejected('The call-part draft changed in another view. It was preserved; review it in House.'));
        } else {
          if(ownRevision)return this.result(receipt,uncertain('A prepared call-part draft disappeared. Check House before repeating the save.'));
          const write=await this.md.roomDraft.write(this.options.roomId,document.path,null,{creation:{type:document.type,fields:document.fields,sections:{}}});
          if(write.outcome!=='written'||!write.roomDraft)return this.result(receipt,rejected('A call-part draft already exists or changed. It was not overwritten.'));
          receipt.drafts.set(document.path,write.roomDraft.revision);
        }
      }
      await this.writable();
      receipt.saveUnknown=true;
      const saved=await this.md.save(this.options.roomId,receipt.documents.map(x=>({path:x.path,revision:receipt.drafts.get(x.path)!})));
      if(saved.outcome!=='saved') {receipt.saveUnknown=false;return this.result(receipt,rejected('House refused the local call-part save. Audio receipts and drafts were retained for review.'));}
      receipt.batch=saved.identifier;
      receipt.saveUnknown=false;
      // Remain pending through offline/queued sync; never emit Part sent early.
      return this.result(receipt,await watcher.wait());
    }catch(error){return this.result(receipt,this.aborter.signal.aborted||receipt.uploadUnknown||receipt.saveUnknown||Boolean(receipt.batch)?uncertain(reason(error)):rejected(reason(error)));}
    finally{watcher?.close();this.busy=false;}
  };

  /** Read-only recheck. A rejected answer means an explicit commit may safely resume. */
  async reconcile(part:CallPart):Promise<CommitResult> {
    if(this.busy)return uncertain('A send is still pending. No second operation was started.');
    const receipt=this.receipts.get(part.id);
    if(!receipt)return uncertain('No local upload receipts are available. Inspect the existing Room documents.');
    try {this.validatePart(part);this.receipt(part);}catch(error){return rejected(reason(error));}
    if(receipt.committed)return committed();
    if(receipt.uploadUnknown)return uncertain('An upload may have succeeded without returning its reference. No automatic retry is safe.');
    this.busy=true;
    try {
      if(receipt.batch||receipt.saveUnknown) {
        const watcher=this.watchConfirmation(receipt);
        try {await watcher.ready;return this.result(receipt,await watcher.check());}finally{watcher.close();}
      }
      for(const attachment of receipt.attachments.values()) {
        if(this.aborter.signal.aborted)throw new Error('The recording writer was closed.');
        const read=await this.assets.read(this.md,this.options.roomId,attachment);
        if(!read.blob)return uncertain('House audio bytes are still unavailable. No save or upload was repeated.');
      }
      return this.result(receipt,rejected('No call-part save was submitted. The known audio receipts are ready for an explicit retry.'));
    }catch(error){return uncertain(reason(error));}finally{this.busy=false;}
  }

  /** Cancel waiting and release this writer's local Blob references; never starts writes. */
  dispose():void {this.aborter.abort();this.receipts.clear();}

  private receipt(part:CallPart):Receipt {
    const existing=this.receipts.get(part.id);
    if(existing) {
      if(existing.original.deref()!==part)throw new Error('A part identity cannot be reused with a different recording object.');
      return existing;
    }
    const receipt:Receipt={part,original:new WeakRef(part),attachments:new Map(),uploadUnknown:false,drafts:new Map(),documents:[],saveUnknown:false,committed:false};
    this.receipts.set(part.id,receipt);return receipt;
  }
  private result(receipt:Receipt,result:CommitResult):CommitResult {
    receipt.result=result;
    if(result.outcome==='committed'&&!receipt.committed){receipt.committed=true;receipt.part=null;this.committedCount++;}
    return result;
  }
  private validatePart(part:CallPart):void {
    if(part.callId!==this.options.callId||part.roomId!==this.options.roomId||part.id!==`${part.callId}-part-${part.number}`)throw new Error('Call part does not match this writer’s fixed Room and recording identity.');
    if(!Number.isSafeInteger(part.number)||part.number<1||part.durationMs<=0||!Number.isFinite(part.durationMs)||part.startOffsetMs<0||!Number.isFinite(part.startOffsetMs))throw new Error('Invalid call-part timing or number.');
    if(Date.parse(part.startedAt)!==new Date(Date.parse(this.options.callStartedAt)+part.startOffsetMs).getTime())throw new Error('Call-part timestamp is inconsistent with the recording start.');
    if(!same(part.participants,this.participants.map(x=>x.id))||part.files.length!==2||new Set(part.files.map(x=>x.speakerId)).size!==2||part.files.some(x=>!part.participants.includes(x.speakerId)||x.container!=='complete'||!/^audio\//.test(x.blob.type)||x.blob.size<=0||x.blob.size>MAX_FILE_BYTES))throw new Error('One complete audio file per negotiated speaker is required.');
  }
  private async writable():Promise<void> {
    if(this.aborter.signal.aborted)throw new Error('The call-part writer was closed.');
    const room=(await this.md.rooms()).find(x=>x.locator===this.options.roomId);
    if(!room||room.refusal||room.replica.admission!=='admitted'||!room.synchronizationAvailable)throw new Error('The recording Room is no longer available to this App.');
    if(!covered(room.operations.write,`calls/${this.options.callId}.md`)||!covered(room.operations.write,'call-parts'))throw new Error('The bound Room does not grant write scope for call records.');
    const mode=await this.md.observe('service-mode');try{if(mode.current()!=='open')throw new Error('House writes are paused.');}finally{mode.close();}
    const documents=await this.md.query({rooms:[this.options.roomId],types:['messenger_chat'],select:{fields:'all'}});
    const chat=documents.documents.find(x=>x.path==='chats/main.md'&&x.room===this.options.roomId);if(!chat)throw new Error('The recording Room has no Messenger chat.');chatSchema.parse(chat.fields);
  }
  private async checkExisting(receipt:Receipt):Promise<void> {
    const docs=await this.md.query({rooms:[this.options.roomId],types:['messenger_call_part'],pathPrefix:'call-parts',select:{fields:'all',change:true}});
    if(docs.documents.some(x=>x.room!==this.options.roomId))throw new Error('House returned a call part outside the bound Room.');
    const existing=docs.documents.find(x=>x.path===`call-parts/${receipt.part!.id}.md`);
    const expected=receipt.documents.find(x=>x.path===existing?.path);
    if(existing&&!(receipt.drafts.has(existing.path)&&expected&&same(existing.fields,expected.fields)&&!existing.change?.time))throw new Error('This call-part path already exists. It was not overwritten. Reconcile it before retrying.');
  }
  private async documents(receipt:Receipt):Promise<Stored[]> {
    const part=receipt.part!;
    const fields:CallPartFields=callPartSchema.parse({id:part.id,call:`../calls/${part.callId}.md`,call_id:part.callId,wire_call_id:this.options.wireCallId,part:part.number,start:part.startedAt,start_offset_ms:part.startOffsetMs,duration_ms:part.durationMs,participants:this.participants,files:part.files.map(file=>({...receipt.attachments.get(file.speakerId)!,speaker_id:file.speakerId}))});
    const callFields=callSchema.parse({id:part.callId,wire_call_id:this.options.wireCallId,chat:'../chats/main.md',started_at:this.options.callStartedAt,participants:this.participants});
    const path=`calls/${part.callId}.md`;
    const result=await this.md.query({rooms:[this.options.roomId],types:['messenger_call'],pathPrefix:'calls',select:{fields:'all',change:true}});
    if(result.documents.some(x=>x.room!==this.options.roomId))throw new Error('House returned a call outside the recording Room.');
    const existing=result.documents.find(x=>x.path===path);
    if(existing&&!same(callSchema.parse(existing.fields),callFields))throw new Error('The call record at this identity has different participants or timing.');
    const ownDraft=existing&&receipt.drafts.has(path)&&!existing.change?.time;
    if(existing&&!existing.change?.time&&!ownDraft)throw new Error('The call record has not yet been confirmed in House.');
    return [...(!existing||ownDraft?[{path,type:'messenger_call',fields:callFields}]:[]),{path:`call-parts/${part.id}.md`,type:'messenger_call_part',fields}];
  }

  private watchConfirmation(receipt:Receipt) {
    const closers:(()=>void)[]=[];let closed=false;
    let queue:Watch<readonly {batch:{id:string};state:string;roomVersion?:string}[]>;
    let documents:Watch<{documents:readonly {room:string;path:string;fields?:Readonly<Record<string,unknown>>;change?:{time:string}|null}[]}>;
    let drafts:Watch<readonly {room:string;path:string;revision:string;parts:{creation?:unknown};returned:{kind:string}|null}[]>;
    let rooms:Watch<readonly {locator:string}[]>;
    let refusal:Watch<unknown>;let loss:Watch<unknown>;
    let wake=()=>{};
    const observe=async<T>(promise:Promise<Watch<T>>):Promise<Watch<T>>=>{const watch=await promise;if(closed){watch.close();return watch;}closers.push(watch.subscribe(()=>wake()),()=>watch.close());return watch;};
    const ready=Promise.all([
      observe(this.md.observe('queue',this.options.roomId)).then(x=>{queue=x;}),
      observe(this.md.observe('query',{rooms:[this.options.roomId],types:['messenger_call','messenger_call_part'],select:{fields:'all',change:true}})).then(x=>{documents=x;}),
      observe(this.md.observe('room-drafts')).then(x=>{drafts=x;}),observe(this.md.observe('rooms')).then(x=>{rooms=x;}),
      observe(this.md.observe('connection-refusal')).then(x=>{refusal=x;}),observe(this.md.observe('storage-loss')).then(x=>{loss=x;}),
    ]).then(()=>undefined);
    const check=async():Promise<CommitResult>=>{
      await ready;
      if(this.aborter.signal.aborted)return uncertain('Stopped waiting for confirmation. The previously submitted House save may still finish.');
      if(refusal.current()||loss.current()||!rooms.current().some(x=>x.locator===this.options.roomId))return uncertain('House access, storage, or Room bindings changed while confirming this send.');
      const paths=receipt.documents.map(x=>x.path);
      const pendingDrafts=drafts.current().filter(x=>x.room===this.options.roomId&&paths.includes(x.path));
      if(pendingDrafts.some(x=>x.returned?.kind==='rejected'||x.returned?.kind==='conflicted')) {
        for(const draft of pendingDrafts) {
          const expected=receipt.documents.find(x=>x.path===draft.path);
          if(expected&&same(draft.parts,{creation:{type:expected.type,fields:expected.fields,sections:{}}}))receipt.drafts.set(draft.path,draft.revision);
        }
        receipt.batch=undefined;receipt.saveUnknown=false;
        return rejected('House rejected or conflicted the call-part batch. Its drafts and audio receipts remain for review.');
      }
      if(pendingDrafts.length)return uncertain('A call-part draft is still present; provider confirmation is pending.');
      const queued=queue.current().find(x=>x.batch.id===receipt.batch);
      if(queued) {
        if(queued.state!=='accepted'||!queued.roomVersion||!await this.md.reached(this.options.roomId,queued.roomVersion))return uncertain('The call part is queued or syncing in House. It is not confirmed sent.');
      }
      const held=documents.current().documents;
      if(receipt.documents.length&&receipt.documents.every(expected=>held.some(doc=>doc.room===this.options.roomId&&doc.path===expected.path&&same(doc.fields,expected.fields)&&Boolean(doc.change?.time))))return committed();
      return uncertain('Waiting for the exact call-part documents and Provider metadata to be confirmed.');
    };
    const wait=async():Promise<CommitResult>=>{
      await ready;
      return new Promise<CommitResult>((resolve)=>{
        let checking=false;let changed=true;let settled=false;
        const finish=(result:CommitResult)=>{if(settled)return;settled=true;this.aborter.signal.removeEventListener('abort',onAbort);resolve(result);};
        const onAbort=()=>finish(uncertain('Stopped waiting for confirmation. The submitted House save may still finish.'));
        const pump=async()=>{if(checking||settled)return;checking=true;try{do{changed=false;const result=await check();if(result.outcome!=='uncertain'||this.aborter.signal.aborted||refusal.current()||loss.current()||!rooms.current().some(x=>x.locator===this.options.roomId)){finish(result);break;}}while(changed&&!settled);}catch(error){finish(uncertain(reason(error)));}finally{checking=false;}};
        wake=()=>{changed=true;void pump();};this.aborter.signal.addEventListener('abort',onAbort,{once:true});wake();
      });
    };
    return {ready,check,wait,close:()=>{closed=true;closers.splice(0).forEach(fn=>fn());}};
  }
}
