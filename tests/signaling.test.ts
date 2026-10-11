import {describe,it,expect,vi} from 'vitest';
import {HouseSignalingProvider,parseCallEnvelope,type HouseSignalingOptions} from '../src/call/signaling';
const token=(name:string)=>`${name}-0000000000000000`;
function fixture(overrides:Partial<HouseSignalingOptions>={}){
  const send=vi.fn().mockResolvedValue(undefined),leave=vi.fn();
  const options:HouseSignalingOptions={callId:token('call'),localPeerId:token('local'),remotePeerId:token('remote'),remoteUserId:'u_remote',localName:'This device',remoteName:'Remote holder',hostPeerId:token('local'),mode:'audio',iceServers:[{urls:'turn:house.fixture.test',username:'fixture',credential:'synthetic'}],iceExpiresAt:Date.now()+60_000,send,leave,...overrides};
  return {provider:new HouseSignalingProvider(options),send,leave,options};
}
async function join(provider:HouseSignalingProvider){provider.on('connected',()=>provider.joinRoom(token('call')));provider.connect();await Promise.resolve();}
describe('House signaling provider',()=>{
  it('joins once with generated peers and House ICE before participants, no local House identity claim',async()=>{
    const {provider,options}=fixture();const order:string[]=[];const joined=vi.fn();provider.on('iceServersChanged',()=>order.push('ice'));provider.on('joined',event=>{order.push('joined');joined(event);});
    await join(provider);provider.joinRoom(token('call'));expect(joined).toHaveBeenCalledTimes(1);expect(order).toEqual(['ice','joined']);
    const result=joined.mock.calls[0][0];expect(result.peerId).toBe(token('local'));expect(result.participants[0].appPeerId).toBeUndefined();expect(result.participants[1].appPeerId).toBe('u_remote');expect(result.participants[0].mediaPolicy.videoMediaEnabled).toBe(false);expect(await provider.getIceServers()).toEqual(options.iceServers);provider.disconnect();
  });
  it('maps SDP/ICE and broadcasts only to the accepted counterpart',async()=>{
    const {provider,send}=fixture();await join(provider);
    provider.sendToPeer(token('remote'),'offer',{sdp:'fixture-offer',offerId:'o1'});
    provider.sendToPeer(token('remote'),'answer',{sdp:'fixture-answer',offerId:'o1'});
    provider.broadcast('ice',{candidate:{candidate:'fixture-candidate',sdpMid:'0'},offerId:'o1'});
    provider.broadcast('participant_media_state',{audioEnabled:false,videoEnabled:false});
    expect(send).toHaveBeenCalledTimes(4);expect(send.mock.calls.map(call=>call[0].type)).toEqual(['offer','answer','ice','participant_media_state']);
    expect(send.mock.calls.every(call=>call[0].payload.from===token('local'))).toBe(true);provider.disconnect();
  });
  it('ignores other peers, sender/peer mismatch, screen sharing, malformed and forged nested identity',async()=>{
    const {provider,send}=fixture();const message=vi.fn();provider.on('message',message);await join(provider);
    provider.sendToPeer(token('someone-else'),'offer',{sdp:'x'});
    provider.broadcast('content_state',{active:true});provider.broadcast('offer',{sdp:'x',from:token('forged')});
    provider.receive('u_spoof',token('remote'),{type:'offer',payload:{sdp:'x'}});
    provider.receive('u_remote',token('wrong'),{type:'offer',payload:{sdp:'x'}});
    provider.receive('u_remote',token('remote'),{type:'offer',payload:{sdp:'x',from:token('forged')}});
    expect(send).not.toHaveBeenCalled();expect(message).not.toHaveBeenCalled();
    provider.receive('u_remote',token('remote'),{type:'offer',payload:{sdp:'x'}});expect(message).toHaveBeenCalledExactlyOnceWith({from:token('remote'),type:'offer',payload:{sdp:'x',from:token('remote')}});provider.disconnect();
  });
  it('buffers negotiation before join, drops late messages after teardown',async()=>{
    const {provider}=fixture();const message=vi.fn();provider.on('message',message);
    provider.receive('u_remote',token('remote'),{type:'answer',payload:{sdp:'fixture'}});expect(message).not.toHaveBeenCalled();await join(provider);expect(message).toHaveBeenCalledTimes(1);
    provider.disconnect();provider.receive('u_remote',token('remote'),{type:'answer',payload:{sdp:'late'}});expect(message).toHaveBeenCalledTimes(1);
  });
  it('fails closed without fresh supported House relay, including outside STUN',()=>{
    expect(()=>fixture({iceServers:[]})).toThrow('Fresh House');expect(()=>fixture({iceExpiresAt:Date.now()-1})).toThrow('Fresh House');expect(()=>fixture({iceServers:[{urls:'stun:outside.test',username:'x',credential:'x'}]})).toThrow('Unsupported House');
  });
  it('bounds UTF-8 signaling and rejects stale, forged shape, oversized and future envelopes',()=>{
    const now=Date.now(),body={protocol:'house-messenger-call',version:1,callId:token('call'),copyId:token('copy'),peerId:token('peer'),expiresAt:now+1000,type:'invite',mode:'video'};
    expect(parseCallEnvelope(body,now)).not.toBeNull();expect(parseCallEnvelope({...body,from:'u_forged'},now)).toBeNull();expect(parseCallEnvelope({...body,expiresAt:now},now)).toBeNull();expect(parseCallEnvelope({...body,expiresAt:now+999999},now)).toBeNull();expect(parseCallEnvelope({...body,copyId:'bad'},now)).toBeNull();expect(parseCallEnvelope({...body,extra:'🙂'.repeat(9000)},now)).toBeNull();
  });
  it('ends once and never sends after disconnect',async()=>{
    const {provider,leave,send}=fixture();await join(provider);provider.endRoom();provider.leaveRoom();provider.broadcast('offer',{sdp:'late'});expect(leave).toHaveBeenCalledTimes(1);expect(send).not.toHaveBeenCalled();
  });
  it('does not replay negotiation whose expiry passed while waiting for local join',async()=>{
    let now=10_000;const {provider}=fixture({now:()=>now,iceExpiresAt:100_000});const message=vi.fn();provider.on('message',message);
    provider.receive('u_remote',token('remote'),{type:'offer',payload:{sdp:'stale'}},now+10);now+=20;await join(provider);expect(message).not.toHaveBeenCalled();provider.disconnect();
  });

});
