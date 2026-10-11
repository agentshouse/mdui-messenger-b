import type { SignalingProvider } from './SignalingProvider.js';
import type { SerenadaConfig } from './types.js';
export const SUPPORTED_SIGNALING_PROVIDER_VERSION = 1;
export interface ResolvedSerenadaConfig { serverHost: null; signalingProvider: SignalingProvider; }
export function resolveSerenadaConfig(config: SerenadaConfig): ResolvedSerenadaConfig {
  if (config.serverHost) throw new Error('Outside signaling servers are unavailable in House.');
  if (!config.signalingProvider || config.signalingProvider.version !== 1) throw new Error('A supported House signaling provider is required.');
  return {serverHost: null, signalingProvider: config.signalingProvider};
}
