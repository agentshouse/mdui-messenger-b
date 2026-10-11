import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {SerenadaSession,type CallState,type SerenadaSessionHandle} from '@agatx/serenada-core';
import type {MediaEngine} from '../vendor/serenada-core/src/media/MediaEngine';
import type {CallStatsCollector} from '../vendor/serenada-core/src/media/callStats';
import {HouseCallController,INVITATION_TTL_MS,type SessionStartOptions} from '../src/call/callController';
import type {CallEnvelope,HouseMessage} from '../src/call/signaling';

const token=(label:string)=>`${label}-0000000000000000`;
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
function fakeSession({provider,callId}:SessionStartOptions){
  const listeners=new Set<(state:CallState)=>void>();
  const state:CallState={phase:'joining',roomId:callId,roomUrl:null,localParticipant:null,remoteParticipants:[],connectionStatus:'connected',signalingState:{kind:'connected'},activeTransport:null,requiredPermissions:null,error:null};
  // Fixture-only object. It never instantiates MediaStream, MediaRecorder or RTC.
  const session={state,peerConnectionState:'connected',localStream:null,remoteStreams:new Map(),destroy:vi.fn(()=>provider.disconnect()),subscribe:(listener:(state:CallState)=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},setInputDevice:vi.fn(),startScreenShare:vi.fn()} as unknown as SerenadaSessionHandle;
  provider.on('connected',()=>provider.joinRoom(callId));provider.on('joined',()=>{state.phase='inCall';for(const fn of listeners)fn(state);});provider.connect();return session;
}
function setup(){
  const delivered:{from:string;to:string;body:CallEnvelope}[]=[];
  const listeners=new Map<string,Set<(message:HouseMessage)=>void>>();
  const controls:HouseCallController[]=[];let serial=0;
  const holders=[{user:'u_alex',name:'Alex',email:'alex@fixture.test'},{user:'u_blair',name:'Blair',email:'blair@fixture.test'}];
  function copy(user:string,options:{relay?:()=>Promise<{iceServers:RTCIceServer[];expiresAt:number}>;session?:(context:SessionStartOptions)=>SerenadaSessionHandle|Promise<SerenadaSessionHandle>}={}){
    const factory=vi.fn(options.session??fakeSession);
    const api={holders:vi.fn().mockResolvedValue(holders),relay:vi.fn(options.relay??(async()=>({iceServers:[{urls:'turn:house.fixture.test',username:'fixture',credential:'synthetic'}],expiresAt:Date.now()+43_200_000}))),ring:vi.fn().mockResolvedValue({}),send:vi.fn(async(to:string,body:unknown)=>{delivered.push({from:user,to,body:body as CallEnvelope});for(const listener of listeners.get(to)??[])listener({from:user,body});})};
    const controller=new HouseCallController({api,id:()=>token(`id-${++serial}`),startSession:factory,messages:listener=>{const set=listeners.get(user)??new Set();listeners.set(user,set);set.add(listener);return()=>{set.delete(listener);};}});
    controls.push(controller);return {controller,api,factory};
  }
  const inject=(to:string,from:string,body:unknown)=>{for(const listener of listeners.get(to)??[])listener({from,body});};
  return {copy,delivered,inject,dispose:()=>controls.forEach(controller=>controller.dispose())};
}
async function flush(){for(let i=0;i<20;i++)await Promise.resolve();}
let cleanups:(()=>void)[]=[];
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-11T10:00:00Z'));vi.stubGlobal('RTCPeerConnection',vi.fn(()=>{throw new Error('No real RTC allowed in fixtures.');}));});
afterEach(()=>{cleanups.forEach(cleanup=>cleanup());cleanups=[];vi.useRealTimers();vi.unstubAllGlobals();});
function network(){const net=setup();cleanups.push(net.dispose);return net;}

describe('House call controller, synthetic fixtures only',()=>{
  it('does not allocate media before an explicit accepted selection; each side chooses its own Room',async()=>{
    const net=network(),a=net.copy('u_alex'),b=net.copy('u_blair');
    await a.controller.startOutgoing('u_blair','video','room-alex');await flush();
    expect(a.controller.current.phase).toBe('outgoing');expect(b.controller.current.phase).toBe('incoming');expect(a.factory).not.toHaveBeenCalled();expect(b.factory).not.toHaveBeenCalled();expect(a.api.relay).not.toHaveBeenCalled();
    expect(b.controller.current.recordingRoom).toBeUndefined();expect(JSON.stringify(net.delivered)).not.toContain('room-alex');
    await b.controller.accept('room-blair');await flush();
    expect(a.factory).toHaveBeenCalledTimes(1);expect(b.factory).toHaveBeenCalledTimes(1);expect(a.controller.current.phase).toBe('active');expect(b.controller.current.phase).toBe('active');
    expect(a.controller.current.recordingRoom).toBe('room-alex');expect(b.controller.current.recordingRoom).toBe('room-blair');
    expect(a.controller.current.participants).toEqual([{id:a.controller.current.localPeerId,name:'This device',isLocal:true},{id:b.controller.current.localPeerId,name:'Blair',isLocal:false,userId:'u_blair'}]);
    expect(a.factory.mock.calls[0][0].config.signalingProvider).toBe(a.factory.mock.calls[0][0].provider);expect(a.factory.mock.calls[0][0].config.serverHost).toBeUndefined();expect(a.factory.mock.calls[0][0].config.enableIndependentContentVideo).toBe(false);expect(RTCPeerConnection).not.toHaveBeenCalled();
  });
  it('repeats live invitations until answered, Ring occurs once after 5 seconds and never retries',async()=>{
    const net=network(),a=net.copy('u_alex');a.api.ring.mockRejectedValue(new Error('uncertain result'));
    await a.controller.startOutgoing('u_blair','audio');await vi.advanceTimersByTimeAsync(4_999);expect(a.api.ring).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1);expect(a.api.ring).toHaveBeenCalledExactlyOnceWith('u_blair');
    const b=net.copy('u_blair');await vi.advanceTimersByTimeAsync(1_000);expect(b.controller.current.phase).toBe('incoming');await b.controller.accept();await flush();await vi.advanceTimersByTimeAsync(15_000);
    expect(a.api.ring).toHaveBeenCalledTimes(1);expect(net.delivered.filter(item=>item.body.type==='invite').length).toBe(4);expect(a.controller.current.phase).toBe('active');
  });
  it('selects only one accepting callee copy and cancels all other ringing copies',async()=>{
    const net=network(),a=net.copy('u_alex'),b1=net.copy('u_blair'),b2=net.copy('u_blair');await a.controller.startOutgoing('u_blair','audio');await flush();
    await Promise.all([b1.controller.accept(),b2.controller.accept()]);await flush();
    expect(b1.factory.mock.calls.length+b2.factory.mock.calls.length).toBe(1);expect(a.factory).toHaveBeenCalledTimes(1);
    const winner=b1.factory.mock.calls.length?b1:b2,loser=winner===b1?b2:b1;
    expect(winner.controller.current.phase).toBe('active');expect(loser.controller.current.phase).toBe('ended');expect(loser.controller.current.reason).toBe('answered-elsewhere');
    const acceptance=net.delivered.find(item=>item.body.type==='accept')!;net.inject('u_alex','u_blair',acceptance.body);await flush();expect(a.factory).toHaveBeenCalledTimes(1);
  });
  it('decline, cancellation and hangup are idempotent and stop pending rings',async()=>{
    const net=network(),a=net.copy('u_alex'),b=net.copy('u_blair'),b2=net.copy('u_blair');await a.controller.startOutgoing('u_blair','audio');await flush();
    await b.controller.decline();await b.controller.decline();await flush();expect(a.controller.current.reason).toBe('declined');expect(b2.controller.current.reason).toBe('cancelled');await vi.advanceTimersByTimeAsync(10_000);expect(a.api.ring).not.toHaveBeenCalled();expect(a.factory).not.toHaveBeenCalled();
    await a.controller.startOutgoing('u_blair','audio');await b.controller.accept();await flush();const asession=a.controller.current.session!,bsession=b.controller.current.session!;
    await a.controller.hangup();await a.controller.hangup();await flush();expect(asession.destroy).toHaveBeenCalledTimes(1);expect(bsession.destroy).toHaveBeenCalledTimes(1);expect(b.controller.current.reason).toBe('remote-hangup');
  });
  it('expires unanswered calls and rejects replayed invitations and late acceptance',async()=>{
    const net=network(),a=net.copy('u_alex'),b=net.copy('u_blair');await a.controller.startOutgoing('u_blair','audio');await flush();const invitation=net.delivered[0].body;
    await vi.advanceTimersByTimeAsync(INVITATION_TTL_MS);expect(a.controller.current.phase).toBe('ended');expect(b.controller.current.phase).toBe('ended');net.inject('u_blair','u_alex',invitation);await b.controller.accept();await flush();expect(b.controller.current.phase).toBe('ended');expect(a.factory).not.toHaveBeenCalled();expect(b.factory).not.toHaveBeenCalled();
  });
  it('rejects wrong authenticated sender, recipient copy, peer, call ID and forged nested signal sender',async()=>{
    const net=network(),a=net.copy('u_alex'),b=net.copy('u_blair');await a.controller.startOutgoing('u_blair','audio');await b.controller.accept();await flush();
    const acceptance=net.delivered.find(item=>item.body.type==='accept')!.body;
    const base={...acceptance,expiresAt:Date.now()+10_000,type:'signal',signal:{type:'offer',payload:{sdp:'fixture'}}};
    const provider=a.factory.mock.calls[0][0].provider,seen=vi.fn();provider.on('message',seen);
    net.inject('u_alex','u_intruder',base);net.inject('u_alex','u_blair',{...base,peerId:token('forged')});net.inject('u_alex','u_blair',{...base,copyId:token('forged')});net.inject('u_alex','u_blair',{...base,recipientCopyId:token('forged')});net.inject('u_alex','u_blair',{...base,callId:token('forged')});net.inject('u_alex','u_blair',{...base,signal:{type:'offer',payload:{sdp:'fixture',from:token('forged')}}});net.inject('u_alex','u_blair',{...base,signal:{type:'offer',payload:{sdp:'🙂'.repeat(9000)}}});await flush();expect(seen).not.toHaveBeenCalled();
    net.inject('u_alex','u_blair',base);await flush();expect(seen).toHaveBeenCalledTimes(1);expect(a.controller.current.phase).toBe('active');
  });
  it('sends and receives monotonic Part sent hints only through the accepted counterpart',async()=>{
    const net=network(),a=net.copy('u_alex'),b=net.copy('u_blair');await expect(a.controller.sendPartSent(1)).rejects.toThrow('accepted');await a.controller.startOutgoing('u_blair','audio');await expect(a.controller.sendPartSent(1)).rejects.toThrow('accepted');await b.controller.accept();await flush();
    expect(net.delivered.some(item=>item.body.type==='part-sent')).toBe(false);await a.controller.sendPartSent(2);await a.controller.sendPartSent(1);await flush();expect(b.controller.current.lastRemotePartSent).toBe(2);await expect(a.controller.sendPartSent(0)).rejects.toThrow('Invalid');
    const hint=net.delivered.find(item=>item.body.type==='part-sent')!;net.inject('u_blair','u_spoof',{...hint.body,partNumber:99});await flush();expect(b.controller.current.lastRemotePartSent).toBe(2);
  });
  it('does not start media when hangup wins against a pending relay lookup',async()=>{
    const net=network(),relay=deferred<{iceServers:RTCIceServer[];expiresAt:number}>(),a=net.copy('u_alex',{relay:()=>relay.promise}),b=net.copy('u_blair');await a.controller.startOutgoing('u_blair','audio');await b.controller.accept();await flush();expect(a.factory).not.toHaveBeenCalled();
    await a.controller.hangup();relay.resolve({iceServers:[{urls:'turn:house.fixture.test',username:'fixture',credential:'synthetic'}],expiresAt:Date.now()+60000});await flush();expect(a.factory).not.toHaveBeenCalled();expect(a.controller.current.phase).toBe('ended');expect(b.controller.current.phase).toBe('ended');
  });
  it('destroys a late asynchronous session rather than resurrecting a closed call',async()=>{
    const net=network(),pending=deferred<SerenadaSessionHandle>(),a=net.copy('u_alex',{session:()=>pending.promise}),b=net.copy('u_blair');await a.controller.startOutgoing('u_blair','audio');await b.controller.accept();await flush();expect(a.factory).toHaveBeenCalledTimes(1);await a.controller.hangup();const late=fakeSession(a.factory.mock.calls[0][0]);pending.resolve(late);await flush();expect(late.destroy).toHaveBeenCalledTimes(1);expect(a.controller.current.phase).toBe('ended');
  });
  it('fails closed if House relay is missing and rejects non-holder outbound selection',async()=>{
    const net=network(),a=net.copy('u_alex',{relay:async()=>({iceServers:[],expiresAt:Date.now()+60000})}),b=net.copy('u_blair');await expect(a.controller.startOutgoing('u_other','audio')).rejects.toThrow('House App');expect(a.api.send).not.toHaveBeenCalled();
    await a.controller.startOutgoing('u_blair','audio');await b.controller.accept();await flush();expect(a.factory).not.toHaveBeenCalled();expect(a.controller.current.phase).toBe('error');expect(b.controller.current.phase).toBe('ended');
  });
  it('runs the actual SerenadaSession against synthetic media and the House adapter',async()=>{
    const makeMedia=()=>{
      const track={kind:'audio',enabled:true,stop:vi.fn()};
      const stream={getAudioTracks:()=>[track],getVideoTracks:()=>[],getTracks:()=>[track]} as unknown as MediaStream;
      const media={localStream:null as MediaStream|null,remoteStreams:new Map<string,MediaStream>(),isScreenSharing:false,lastContentRevision:0,canScreenShare:false,facingMode:'user',hasMultipleCameras:false,iceConnectionState:'new',connectionState:'new',signalingState:'stable',connectionStatus:'connected',lastLocalMediaError:null,
        onChange:()=>{},setOnChange(fn:()=>void){media.onChange=fn;},seedContentRevision:vi.fn(),updateRoomState:vi.fn(),updateSignalingConnected:vi.fn(),setIceServers:vi.fn(),getRoleLiveness:()=>({camera:false,content:false}),processSignalingMessage:vi.fn(),getPeerConnections:()=>[],
        startLocalMedia:vi.fn(async()=>{media.localStream=stream;return stream;}),destroy:vi.fn(()=>{media.localStream=null;track.stop();}),
      };
      return media;
    };
    const left=makeMedia(),right=makeMedia();
    const makeFactory=(media:ReturnType<typeof makeMedia>)=>(context:SessionStartOptions)=>new SerenadaSession(context.config,context.callId,null,context.provider,{media:media as unknown as MediaEngine,statsCollector:{stats:null,start:vi.fn(),stop:vi.fn()} as unknown as CallStatsCollector,displayName:'This device'});
    const net=network(),a=net.copy('u_alex',{session:makeFactory(left)}),b=net.copy('u_blair',{session:makeFactory(right)});
    await a.controller.startOutgoing('u_blair','audio');await flush();expect(left.startLocalMedia).not.toHaveBeenCalled();expect(right.startLocalMedia).not.toHaveBeenCalled();
    await b.controller.accept();await flush();expect(a.controller.current.session).toBeInstanceOf(SerenadaSession);expect(b.controller.current.session).toBeInstanceOf(SerenadaSession);
    expect(left.startLocalMedia).toHaveBeenCalledTimes(1);expect(right.startLocalMedia).toHaveBeenCalledTimes(1);expect(left.setIceServers).toHaveBeenCalledWith([{urls:'turn:house.fixture.test',username:'fixture',credential:'synthetic'}]);
    // A participant roster alone is not evidence that RTC connected.
    expect(a.controller.current.phase).toBe('connecting');left.connectionState='connected';left.onChange();expect(a.controller.current.phase).toBe('active');
    a.factory.mock.calls[0][0].provider.sendToPeer(b.controller.current.localPeerId!,'offer',{sdp:'synthetic-offer',offerId:'fixture-offer'});await flush();expect(right.processSignalingMessage).toHaveBeenCalledWith(expect.objectContaining({type:'offer',cid:a.controller.current.localPeerId,payload:expect.objectContaining({sdp:'synthetic-offer',from:a.controller.current.localPeerId})}));
    await a.controller.hangup();await flush();expect(left.destroy).toHaveBeenCalledTimes(1);expect(right.destroy).toHaveBeenCalledTimes(1);expect(RTCPeerConnection).not.toHaveBeenCalled();
  });

});
