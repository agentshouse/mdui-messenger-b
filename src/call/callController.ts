import {SerenadaCore, type CallState, type SerenadaConfig, type SerenadaSessionHandle} from '@agatx/serenada-core';
import {HouseCallAPI, receiveHouseMessages} from './houseCalls';
import {HouseSignalingProvider, MAX_SIGNAL_BYTES, SIGNAL_TTL_MS, callMode, callToken, jsonByteLength, parseCallEnvelope, type CallEnvelope, type CallMode, type HouseMessage, type PeerSignal} from './signaling';

export const INVITATION_TTL_MS=60_000;
export const INVITATION_REPEAT_MS=2_000;
export const RING_AFTER_MS=5_000;
export type ControllerPhase='idle'|'outgoing'|'incoming'|'accepting'|'connecting'|'active'|'ended'|'error';
export type CallParticipant=Readonly<{id:string;name:string;isLocal:boolean;userId?:string}>;
export type CallControllerState=Readonly<{
  phase:ControllerPhase;callId?:string;mode?:CallMode;remoteUserId?:string;remoteName?:string;
  localPeerId?:string;remotePeerId?:string;recordingRoom?:string;
  participants:readonly CallParticipant[];session:SerenadaSessionHandle|null;sessionState:CallState|null;
  lastRemotePartSent:number;error?:string;warning?:string;reason?:string;
}>;
export type SessionStartOptions={
  config:SerenadaConfig;provider:HouseSignalingProvider;callId:string;mode:CallMode;
  localPeerId:string;remotePeerId:string;remoteUserId:string;localName:string;remoteName:string;
};
export type SessionFactory=(options:SessionStartOptions)=>SerenadaSessionHandle|Promise<SerenadaSessionHandle>;
export type HouseCallControllerOptions={
  api:Pick<HouseCallAPI,'holders'|'relay'|'send'|'ring'>;
  messages?:(listener:(message:HouseMessage)=>void)=>()=>void;
  /** Fixtures replace this boundary; the production path uses the genuine donor Core. */
  startSession?:SessionFactory;
  now?:()=>number;id?:()=>string;
};

type Call={
  callId:string;localPeerId:string;remoteUserId:string;remoteName:string;mode:CallMode;
  direction:'outgoing'|'incoming';inviteExpiresAt:number;remoteCopyId?:string;remotePeerId?:string;
  recordingRoom?:string;selected:boolean;sessionStarting:boolean;
  session?:SerenadaSessionHandle;provider?:HouseSignalingProvider;unsubscribe?:()=>void;
  queue:{signal:PeerSignal;expiresAt:number}[];queuedBytes:number;
};
const initialState=():CallControllerState=>({phase:'idle',participants:[],session:null,sessionState:null,lastRemotePartSent:0});
const productionSession:SessionFactory=({config,callId})=>new SerenadaCore(config).join({roomId:callId,displayName:'This device'});

/**
 * App-copy invitation/selection controller. The authenticated bridge `from` is
 * the only House identity authority. A local copy and per-call peer ID are not
 * a claim about the current House User (core#3329).
 *
 * Recording Rooms never cross this wire. Each side may independently attach
 * its own bound Room to its local state; this controller never uploads media.
 */
export class HouseCallController {
  private state:CallControllerState=initialState();
  private listeners=new Set<(state:CallControllerState)=>void>();
  private call:Call|null=null;
  private disposed=false;
  private readonly now:()=>number;
  private readonly id:()=>string;
  private readonly copyId:string;
  private readonly closeMessages:()=>void;
  private readonly startSession:SessionFactory;
  private timers=new Set<ReturnType<typeof setTimeout>>();
  private repeatTimer:ReturnType<typeof setInterval>|null=null;
  private tombstones=new Map<string,number>();
  constructor(private readonly options:HouseCallControllerOptions) {
    this.now=options.now??Date.now;this.id=options.id??(()=>crypto.randomUUID());
    this.copyId=this.newId();this.startSession=options.startSession??productionSession;
    this.closeMessages=(options.messages??receiveHouseMessages)(message=>{
      // Untrusted input is parsed before state or media can change.
      void this.receive(message).catch(()=>{if(!this.disposed)this.patch({warning:'A House call update could not be completed.'});});
    });
  }
  get current(){return this.state;}
  subscribe=(listener:(state:CallControllerState)=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private patch(patch:Partial<CallControllerState>){if(this.disposed)return;this.state={...this.state,...patch};for(const listener of this.listeners)listener(this.state);}
  private newId(){const id=this.id();if(!callToken.safeParse(id).success)throw new Error('A cryptographically generated call ID is required.');return id;}
  private isCurrent(call:Call){return !this.disposed&&this.call===call;}
  private participants(call:Call):CallParticipant[]{return [{id:call.localPeerId,name:'This device',isLocal:true},...(call.remotePeerId?[{id:call.remotePeerId,name:call.remoteName,isLocal:false,userId:call.remoteUserId}]:[])];}
  private publish(call:Call,patch:Partial<CallControllerState>={}){
    if(!this.isCurrent(call))return;
    this.patch({callId:call.callId,mode:call.mode,remoteUserId:call.remoteUserId,remoteName:call.remoteName,localPeerId:call.localPeerId,remotePeerId:call.remotePeerId,recordingRoom:call.recordingRoom,participants:this.participants(call),session:call.session??null,...patch});
  }
  private reset(call:Call,phase:ControllerPhase){this.state=initialState();this.call=call;this.publish(call,{phase});}
  private later(fn:()=>void,delay:number){const timer=setTimeout(()=>{this.timers.delete(timer);fn();},Math.max(0,delay));this.timers.add(timer);}
  private clearTimers(){for(const timer of this.timers)clearTimeout(timer);this.timers.clear();if(this.repeatTimer!==null){clearInterval(this.repeatTimer);this.repeatTimer=null;}}
  private base(call:Call,expiresAt=this.now()+SIGNAL_TTL_MS){return {protocol:'house-messenger-call' as const,version:1 as const,callId:call.callId,copyId:this.copyId,peerId:call.localPeerId,expiresAt};}
  private target(call:Call){if(!call.remoteCopyId||!call.remotePeerId)throw new Error('The remote call copy is not selected.');return {recipientCopyId:call.remoteCopyId,recipientPeerId:call.remotePeerId};}
  private async send(call:Call,message:CallEnvelope){if(jsonByteLength(message)>MAX_SIGNAL_BYTES)throw new Error('Call signaling exceeds the House message limit.');await this.options.api.send(call.remoteUserId,message);}
  private background(call:Call,work:Promise<unknown>,warning='House could not deliver a call update.') {void work.catch(()=>{if(this.isCurrent(call))this.patch({warning});});}
  private invitation(call:Call){return this.send(call,{...this.base(call,call.inviteExpiresAt),type:'invite',mode:call.mode});}
  private acceptance(call:Call){return this.send(call,{...this.base(call,call.inviteExpiresAt),...this.target(call),type:'accept'});}
  private selection(call:Call){return this.send(call,{...this.base(call),type:'selected',selectedCopyId:call.remoteCopyId!,selectedPeerId:call.remotePeerId!});}
  private expireInvitation(call:Call){this.later(()=>{if(this.isCurrent(call)&&!call.selected){this.background(call,this.send(call,{...this.base(call),type:call.direction==='outgoing'?'cancel':'decline',...(call.direction==='incoming'?this.target(call):{})} as CallEnvelope));this.finish(call,'unanswered');}},call.inviteExpiresAt-this.now());}

  async startOutgoing(holderId:string,mode:CallMode,recordingRoom?:string):Promise<void>{
    if(this.disposed)throw new Error('The call controller is closed.');
    if(this.call)throw new Error('Finish the current call first.');
    callMode.parse(mode);if(!holderId.trim())throw new Error('Choose a House holder.');
    const call:Call={callId:this.newId(),localPeerId:this.newId(),remoteUserId:holderId,remoteName:'House caller',mode,direction:'outgoing',inviteExpiresAt:this.now()+INVITATION_TTL_MS,recordingRoom:recordingRoom||undefined,selected:false,sessionStarting:false,queue:[],queuedBytes:0};
    this.reset(call,'outgoing');
    try {
      const holders=await this.options.api.holders();if(!this.isCurrent(call))return;
      const holder=holders.find(item=>item.user===holderId);if(!holder)throw new Error('Choose someone who can use this House App.');
      call.remoteName=holder.name.trim()||'House caller';this.publish(call);
      this.expireInvitation(call);
      this.repeatTimer=setInterval(()=>{if(this.isCurrent(call)&&this.state.phase==='outgoing'&&this.now()<call.inviteExpiresAt)this.background(call,this.invitation(call));},INVITATION_REPEAT_MS);
      this.later(()=>{
        if(!this.isCurrent(call)||this.state.phase!=='outgoing'||call.selected)return;
        // A single notification is deliberate. Never retry an uncertain ring.
        this.background(call,this.options.api.ring(holderId),'The call invitation is open, but House could not confirm the ring notification.');
      },RING_AFTER_MS);
      await this.invitation(call);
    }catch(error){if(this.isCurrent(call))this.finish(call,'failed','House could not start this call.');throw error;}
  }

  async accept(recordingRoom?:string):Promise<void>{
    const call=this.call;if(!call||call.direction!=='incoming'||this.state.phase!=='incoming')return;
    if(this.now()>=call.inviteExpiresAt){this.finish(call,'expired');return;}
    call.recordingRoom=recordingRoom||undefined;this.publish(call,{phase:'accepting'});
    // Only the selected callee copy starts media. A second tab's Answer is safe.
    this.repeatTimer=setInterval(()=>{if(this.isCurrent(call)&&this.state.phase==='accepting')this.background(call,this.acceptance(call));},INVITATION_REPEAT_MS);
    try{await this.acceptance(call);}catch(error){if(this.isCurrent(call))this.finish(call,'failed','House could not send your answer.');throw error;}
  }
  async decline():Promise<void>{
    const call=this.call;if(!call||call.direction!=='incoming'||!['incoming','accepting'].includes(this.state.phase))return;
    const message:CallEnvelope={...this.base(call),...this.target(call),type:'decline'};
    this.finish(call,'declined');await this.send(call,message);
  }
  async hangup():Promise<void>{
    const call=this.call;if(!call)return;
    if(call.direction==='incoming'&&!call.selected){await this.decline();return;}
    const message:CallEnvelope=call.selected?{...this.base(call),...this.target(call),type:'hangup'}:{...this.base(call),type:'cancel'};
    // Tear down before awaiting live delivery, including a hung/failed send.
    this.finish(call,'hangup');await this.send(call,message);
  }
  /** Call only after the writer has confirmed the explicitly requested save. */
  async sendPartSent(partNumber:number):Promise<void>{
    const call=this.call;if(!call||!call.selected||!call.session)throw new Error('There is no accepted call to notify.');
    if(!Number.isInteger(partNumber)||partNumber<1||partNumber>1_000_000)throw new Error('Invalid call part number.');
    await this.send(call,{...this.base(call),...this.target(call),type:'part-sent',partNumber});
  }
  dispose(){
    if(this.disposed)return;const call=this.call;
    if(call){const message:CallEnvelope=call.selected?{...this.base(call),...this.target(call),type:'hangup'}:call.direction==='incoming'?{...this.base(call),...this.target(call),type:'decline'}:{...this.base(call),type:'cancel'};this.finish(call,'closed');void this.send(call,message).catch(()=>{});}
    this.disposed=true;this.clearTimers();this.closeMessages();this.listeners.clear();
  }
  private finish(call:Call,reason:string,error?:string){
    if(!this.isCurrent(call))return;
    this.clearTimers();this.tombstones.set(call.callId,this.now()+120_000);
    while(this.tombstones.size>256)this.tombstones.delete(this.tombstones.keys().next().value!);
    this.call=null;call.unsubscribe?.();call.provider?.disconnect();
    // Destroy releases donor-owned media; no recording or upload is triggered here.
    call.session?.destroy();call.queue=[];call.queuedBytes=0;
    this.patch({phase:error?'error':'ended',reason,error,session:null,sessionState:null});
  }
  private matchesRemote(call:Call,message:CallEnvelope,from:string){return from===call.remoteUserId&&message.callId===call.callId&&message.copyId===call.remoteCopyId&&message.peerId===call.remotePeerId;}
  private isTarget(message:CallEnvelope){return 'recipientCopyId'in message&&message.recipientCopyId===this.copyId&&message.recipientPeerId===this.call?.localPeerId;}

  private async receive(message:HouseMessage):Promise<void>{
    if(this.disposed||!message||typeof message.from!=='string'||!message.from)return;
    const wire=parseCallEnvelope(message.body,this.now());if(!wire||wire.copyId===this.copyId)return;
    for(const[id,expiresAt]of this.tombstones)if(expiresAt<=this.now())this.tombstones.delete(id);
    if(this.tombstones.has(wire.callId))return;
    let call=this.call;
    if(wire.type==='invite'){
      if(call){
        // Repeated invitations don't replace the incoming local peer or Room.
        if(call.direction==='incoming'&&this.matchesRemote(call,wire,message.from)&&call.inviteExpiresAt===wire.expiresAt&&this.state.phase==='accepting')this.background(call,this.acceptance(call));
        return;
      }
      call={callId:wire.callId,localPeerId:this.newId(),remoteUserId:message.from,remoteName:'House caller',remoteCopyId:wire.copyId,remotePeerId:wire.peerId,mode:wire.mode,direction:'incoming',inviteExpiresAt:wire.expiresAt,selected:false,sessionStarting:false,queue:[],queuedBytes:0};
      if(call.localPeerId===call.remotePeerId)return;
      this.reset(call,'incoming');this.expireInvitation(call);
      const current=call;
      this.background(current,this.options.api.holders().then(holders=>{if(this.isCurrent(current)){const name=holders.find(holder=>holder.user===current.remoteUserId)?.name.trim();if(name){current.remoteName=name;this.publish(current);}}}));
      return;
    }
    if(!call||wire.callId!==call.callId||message.from!==call.remoteUserId)return;
    if(wire.type==='accept'&&call.direction==='outgoing'){
      if(!this.isTarget(wire)||wire.peerId===call.localPeerId||wire.expiresAt!==call.inviteExpiresAt)return;
      if(call.selected){this.background(call,this.selection(call));return;}
      if(this.state.phase!=='outgoing'||this.now()>=call.inviteExpiresAt)return;
      call.remoteCopyId=wire.copyId;call.remotePeerId=wire.peerId;call.selected=true;
      this.clearTimers();this.publish(call,{phase:'connecting'});
      // Confirm chosen copy to all live callee copies before booting either end.
      try{await this.selection(call);if(this.isCurrent(call))await this.beginSession(call);}catch{if(this.isCurrent(call))this.finish(call,'failed','House could not confirm the accepted call.');}
      return;
    }
    if(wire.type==='decline'&&call.direction==='outgoing'){
      if(!this.isTarget(wire)||call.selected)return;
      this.background(call,this.send(call,{...this.base(call),type:'cancel'}));this.finish(call,'declined');return;
    }
    if(!this.matchesRemote(call,wire,message.from))return;
    if(wire.type==='selected'&&call.direction==='incoming'){
      if(wire.selectedCopyId!==this.copyId||wire.selectedPeerId!==call.localPeerId){if(!call.selected)this.finish(call,'answered-elsewhere');return;}
      if(call.selected)return;
      if(this.state.phase!=='accepting')return;
      call.selected=true;this.clearTimers();this.publish(call,{phase:'connecting'});await this.beginSession(call);return;
    }
    if(wire.type==='cancel'&&call.direction==='incoming'){this.finish(call,'cancelled');return;}
    if(!call.selected||!this.isTarget(wire))return;
    if(wire.type==='hangup'){this.finish(call,'remote-hangup');return;}
    if(wire.type==='part-sent'){
      if(wire.partNumber>this.state.lastRemotePartSent)this.patch({lastRemotePartSent:wire.partNumber});return;
    }
    if(wire.type==='signal'){
      if(wire.signal.payload.from&&wire.signal.payload.from!==wire.peerId)return;
      if(call.provider)call.provider.receive(message.from,wire.peerId,wire.signal,wire.expiresAt);
      else {const bytes=jsonByteLength(wire.signal);if(call.queue.length<64&&call.queuedBytes+bytes<=256*1024){call.queue.push({signal:wire.signal,expiresAt:wire.expiresAt});call.queuedBytes+=bytes;}}
    }
  }

  private async beginSession(call:Call){
    if(!this.isCurrent(call)||!call.selected||call.sessionStarting||call.session)return;
    call.sessionStarting=true;
    try{
      // House credentials must be present before any real peer/media allocation.
      const relay=await this.options.api.relay();if(!this.isCurrent(call))return;
      const provider=new HouseSignalingProvider({callId:call.callId,localPeerId:call.localPeerId,remotePeerId:call.remotePeerId!,remoteUserId:call.remoteUserId,localName:'This device',remoteName:call.remoteName,hostPeerId:call.direction==='outgoing'?call.localPeerId:call.remotePeerId!,mode:call.mode,iceServers:relay.iceServers,iceExpiresAt:relay.expiresAt,now:this.now,send:signal=>this.send(call,{...this.base(call),...this.target(call),type:'signal',signal}),leave:()=>{if(this.isCurrent(call))this.background(call,this.hangup());}});
      call.provider=provider;
      const config:SerenadaConfig={signalingProvider:provider,defaultAudioEnabled:true,defaultVideoEnabled:call.mode==='video',videoMediaEnabled:call.mode==='video',enableIndependentContentVideo:false,cameraModes:call.mode==='video'?['selfie','world']:[]};
      const session=await this.startSession({config,provider,callId:call.callId,mode:call.mode,localPeerId:call.localPeerId,remotePeerId:call.remotePeerId!,remoteUserId:call.remoteUserId,localName:'This device',remoteName:call.remoteName});
      if(!this.isCurrent(call)){provider.disconnect();session.destroy();return;}
      call.session=session;
      const update=(sessionState:CallState)=>{
        if(!this.isCurrent(call))return;
        if(sessionState.phase==='error'){
          const message:CallEnvelope={...this.base(call),...this.target(call),type:'hangup'};
          this.finish(call,'failed',sessionState.error?.message??'The media connection failed.');void this.send(call,message).catch(()=>{});return;
        }
        if(sessionState.phase==='idle'||sessionState.phase==='ending'){this.background(call,this.hangup());return;}
        this.publish(call,{sessionState,phase:sessionState.phase==='inCall'&&session.peerConnectionState==='connected'?'active':'connecting'});
      };
      call.unsubscribe=session.subscribe(update);update(session.state);
      for(const queued of call.queue.splice(0))provider.receive(call.remoteUserId,call.remotePeerId!,queued.signal,queued.expiresAt);call.queuedBytes=0;
    }catch{
      if(this.isCurrent(call)){
        const message:CallEnvelope={...this.base(call),...this.target(call),type:'hangup'};
        this.finish(call,'failed','The accepted call could not start. Check media permissions and House relay access.');void this.send(call,message).catch(()=>{});
      }
    }
  }
}
