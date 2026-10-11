// UI-only preference kept in memory; no donor browser storage.
export type RemoteVideoFit = 'cover' | 'contain';
let current: RemoteVideoFit | undefined;
export function getPersistedRemoteVideoFit(defaultValue: RemoteVideoFit = 'cover'): RemoteVideoFit { return current ?? defaultValue; }
export function persistRemoteVideoFit(value: RemoteVideoFit): void { current = value; }
