/** House-only adapter for the real Serenada media/session core. No server or storage. */
import {z} from 'zod';
import {SignalingProviderEmitter, type JoinOptions, type PeerMessage, type SignalingProviderParticipant} from '@agatx/serenada-core';

export const MAX_SIGNAL_BYTES = 32 * 1024;
export const SIGNAL_TTL_MS = 30_000;
export const MAX_ENVELOPE_TTL_MS = 120_000;
export const callToken = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
export const callMode = z.enum(['audio', 'video']);
export type CallMode = z.infer<typeof callMode>;
const envelope = {
  protocol: z.literal('house-messenger-call'), version: z.literal(1),
  callId: callToken, copyId: callToken, peerId: callToken,
  expiresAt: z.number().int().positive(),
};
const targeted = {recipientCopyId: callToken, recipientPeerId: callToken};
const offer = z.object({sdp: z.string().min(1), offerId: z.string().max(256).optional(), timestamp: z.number().finite().optional(), from: callToken.optional()}).strict();
const candidate = z.object({candidate:z.string(),sdpMid:z.string().nullable().optional(),sdpMLineIndex:z.number().int().nullable().optional(),usernameFragment:z.string().nullable().optional()}).strict();
export const peerSignalSchema = z.discriminatedUnion('type', [
  z.object({type:z.literal('offer'), payload:offer}).strict(),
  z.object({type:z.literal('answer'), payload:offer}).strict(),
  z.object({type:z.literal('ice'), payload:z.object({candidate,offerId:z.string().max(256).optional(),from:callToken.optional()}).strict()}).strict(),
  z.object({type:z.literal('participant_media_state'), payload:z.object({audioEnabled:z.boolean(),videoEnabled:z.boolean(),from:callToken.optional()}).strict()}).strict(),
  z.object({type:z.literal('media_restart_request'), payload:z.object({reason:z.string().max(256),from:callToken.optional()}).strict()}).strict(),
  z.object({type:z.literal('media_liveness'), payload:z.object({cids:z.array(callToken).max(2),from:callToken.optional()}).strict()}).strict(),
]);
export type PeerSignal = z.infer<typeof peerSignalSchema>;
export const callEnvelopeSchema = z.discriminatedUnion('type', [
  z.object({...envelope,type:z.literal('invite'),mode:callMode}).strict(),
  z.object({...envelope,...targeted,type:z.literal('accept')}).strict(),
  z.object({...envelope,...targeted,type:z.literal('decline')}).strict(),
  // A broadcast to the callee's copies confirms one copy and cancels the rest.
  z.object({...envelope,type:z.literal('selected'),selectedCopyId:callToken,selectedPeerId:callToken}).strict(),
  z.object({...envelope,type:z.literal('cancel')}).strict(),
  z.object({...envelope,...targeted,type:z.literal('hangup')}).strict(),
  z.object({...envelope,...targeted,type:z.literal('signal'),signal:peerSignalSchema}).strict(),
  z.object({...envelope,...targeted,type:z.literal('part-sent'),partNumber:z.number().int().min(1).max(1_000_000)}).strict(),
]);
export type CallEnvelope = z.infer<typeof callEnvelopeSchema>;
export type HouseMessage = {from:string;body:unknown};

export function jsonByteLength(body:unknown): number {
  try {const encoded=JSON.stringify(body);return encoded ? new TextEncoder().encode(encoded).byteLength : Infinity;} catch {return Infinity;}
}
/** The signed bridge sender is intentionally outside the untrusted body. */
export function parseCallEnvelope(body:unknown, now=Date.now()):CallEnvelope|null {
  if(jsonByteLength(body)>MAX_SIGNAL_BYTES)return null;
  const parsed=callEnvelopeSchema.safeParse(body);
  if(!parsed.success || parsed.data.expiresAt<=now || parsed.data.expiresAt>now+MAX_ENVELOPE_TTL_MS)return null;
  return parsed.data;
}

export type HouseSignalingOptions = {
  callId:string; localPeerId:string; remotePeerId:string; remoteUserId:string;
  localName:string; remoteName:string; hostPeerId:string; mode:CallMode;
  iceServers:RTCIceServer[]; iceExpiresAt:number;
  send:(signal:PeerSignal)=>Promise<unknown>;
  leave:()=>void;
  now?:()=>number;
};

/** One accepted, authenticated House counterpart; broadcast never escapes that pair. */
export class HouseSignalingProvider extends SignalingProviderEmitter {
  readonly capabilities={handlesReconnection:true};
  private connected=false;
  private joined=false;
  private stopped=false;
  private queued:{message:PeerMessage;expiresAt:number}[]=[];
  private readonly now:()=>number;
  constructor(private readonly options:HouseSignalingOptions) {
    super();this.now=options.now??Date.now;
    if(!callToken.safeParse(options.callId).success || !callToken.safeParse(options.localPeerId).success || !callToken.safeParse(options.remotePeerId).success || options.localPeerId===options.remotePeerId)throw new Error('Invalid accepted call identity.');
    if(!options.remoteUserId)throw new Error('An authenticated House counterpart is required.');
    this.validateIce();
  }
  private validateIce() {
    const {iceServers,iceExpiresAt}=this.options;
    if(!Number.isFinite(iceExpiresAt)||iceExpiresAt<=this.now()||!iceServers.length)throw new Error('Fresh House relay credentials are required.');
    for(const server of iceServers) {
      const urls=Array.isArray(server.urls)?server.urls:[server.urls];
      if(!urls.length||urls.some(url=>typeof url!=='string'||!/^turns?:/i.test(url))||typeof server.username!=='string'||typeof server.credential!=='string')throw new Error('Unsupported House relay credentials.');
    }
  }
  connect() {
    if(this.stopped||this.connected)return;
    this.connected=true;
    // The Core constructor must finish before observable joins and media startup.
    queueMicrotask(()=>{if(this.connected&&!this.stopped)this.emit('connected',{transport:'house-app-messages'});});
  }
  disconnect() {this.stopped=true;this.connected=false;this.joined=false;this.queued=[];}
  joinRoom(roomId:string,_options?:JoinOptions) {
    void _options;
    if(this.stopped||!this.connected||this.joined)return;
    if(roomId!==this.options.callId){this.emit('error',{code:'INVALID_ROOM_ID',message:'The call invitation no longer matches.'});return;}
    this.validateIce();this.joined=true;
    // Set the media engine's config before updateRoomState can create a peer connection.
    this.emit('iceServersChanged',this.options.iceServers);
    const p=(peerId:string,displayName:string,appPeerId?:string):SignalingProviderParticipant=>({peerId,displayName,appPeerId,audioEnabled:true,videoEnabled:this.options.mode==='video',capabilities:{trickleIce:true,maxParticipants:2,independentContentVideo:false},mediaPolicy:{videoMediaEnabled:this.options.mode==='video'}});
    this.emit('joined',{peerId:this.options.localPeerId,hostPeerId:this.options.hostPeerId,maxParticipants:2,participants:[p(this.options.localPeerId,this.options.localName),p(this.options.remotePeerId,this.options.remoteName,this.options.remoteUserId)]});
    for(const queued of this.queued.splice(0))if(!this.stopped&&queued.expiresAt>this.now())this.emit('message',queued.message);
  }
  leaveRoom(){if(this.stopped)return;this.options.leave();this.disconnect();}
  endRoom(){this.leaveRoom();}
  async getIceServers(){this.validateIce();return this.options.iceServers.map(server=>({...server,urls:Array.isArray(server.urls)?[...server.urls]:server.urls}));}
  sendToPeer(peerId:string,type:string,payload:unknown) {
    if(this.stopped||!this.joined||peerId!==this.options.remotePeerId)return;
    const parsed=peerSignalSchema.safeParse({type,payload});
    if(!parsed.success)return;
    if(parsed.data.payload.from && parsed.data.payload.from!==this.options.localPeerId)return;
    // Local IDs come from our accepted tuple, never a media payload's identity claim.
    const signal={...parsed.data,payload:{...parsed.data.payload,from:this.options.localPeerId}} as PeerSignal;
    if(jsonByteLength(signal)>MAX_SIGNAL_BYTES-1024){this.emit('error',{code:'BAD_REQUEST',message:'Call signaling exceeds the House message limit.'});return;}
    void this.options.send(signal).catch(()=>{if(!this.stopped)this.emit('error',{code:'CONNECTION_FAILED',message:'House could not send call signaling.'});});
  }
  broadcast(type:string,payload:unknown){this.sendToPeer(this.options.remotePeerId,type,payload);}
  /** Called only after the controller verifies House sender + call + copy + peer. */
  receive(fromUserId:string,fromPeerId:string,signal:PeerSignal,expiresAt=this.now()+SIGNAL_TTL_MS) {
    if(this.stopped||expiresAt<=this.now()||fromUserId!==this.options.remoteUserId||fromPeerId!==this.options.remotePeerId)return;
    const parsed=peerSignalSchema.safeParse(signal);
    if(!parsed.success||jsonByteLength(signal)>MAX_SIGNAL_BYTES||(parsed.data.payload.from && parsed.data.payload.from!==fromPeerId))return;
    const message:PeerMessage={from:fromPeerId,type:parsed.data.type,payload:{...parsed.data.payload,from:fromPeerId}};
    if(this.joined)this.emit('message',message);
    else if(this.queued.length<64)this.queued.push({message,expiresAt});
  }
}
