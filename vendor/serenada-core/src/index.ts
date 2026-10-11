export const SERENADA_CORE_VERSION = '0.9.7';
// House build: donor session/media/layout core. External server, recovery-token storage and diagnostics are omitted.
export { SerenadaCore } from './SerenadaCore.js';
export { SerenadaSession } from './SerenadaSession.js';
export { SignalingProviderEmitter } from './SignalingProvider.js';
export type * from './SignalingProvider.js';
export type * from './types.js';
export { DEFAULT_CAMERA_MODES } from './types.js';
export { SnapshotError, captureFrameFromStream } from './media/captureSnapshot.js';
export * from './layout/computeLayout.js';
export { AudioLevelMonitor } from './media/AudioLevelMonitor.js';

export { shouldForceLocalVideoRefresh, shouldRecoverLocalVideo } from './media/localVideoRecovery.js';

export * from './constants.js';
