// Adapted donor factory: retain real headless session, with House-supplied signaling only.
import type { SerenadaConfig, SerenadaSessionHandle } from './types.js';
import { SerenadaSession } from './SerenadaSession.js';
import { resolveSerenadaConfig } from './configValidation.js';
export class SerenadaCore {
  constructor(private readonly config: SerenadaConfig) { resolveSerenadaConfig(config); }
  static isSupported(): boolean { return typeof RTCPeerConnection !== 'undefined'; }
  join(options: {roomId: string; displayName?: string; peerId?: string}): SerenadaSessionHandle {
    if (!SerenadaCore.isSupported()) throw new Error('WebRTC is unavailable in this browser.');
    const {signalingProvider} = resolveSerenadaConfig(this.config);
    return new SerenadaSession(this.config, options.roomId, null, signalingProvider, {displayName: options.displayName, peerId: options.peerId});
  }
}
