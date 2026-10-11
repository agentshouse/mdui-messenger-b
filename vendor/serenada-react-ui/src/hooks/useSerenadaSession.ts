import { useEffect, useMemo, useState } from 'react';
import type { SerenadaConfig, CallState, SerenadaSessionHandle } from '@agatx/serenada-core';
import { SerenadaCore } from '@agatx/serenada-core';
import { useCallState } from './useCallState.js';
import { EMPTY_STREAMS } from './constants.js';

export interface UseSerenadaSessionOptions {
    roomId?: string;
    config: SerenadaConfig;
}

export interface UseSerenadaSessionResult {
    session: SerenadaSessionHandle | null;
    state: CallState;
    localStream: MediaStream | null;
    remoteStreams: Map<string, MediaStream>;
}

export function useSerenadaSession(options: UseSerenadaSessionOptions): UseSerenadaSessionResult {
    const { roomId, config } = options;
    const [session, setSession] = useState<SerenadaSessionHandle | null>(null);
    const transportsKey = config.transports?.join('|') ?? '';

    const core = useMemo(
        () => new SerenadaCore({
            ...config,
            transports: config.transports ? [...config.transports] : undefined,
        }),
        [
            config.serverHost,
            config.defaultAudioEnabled,
            config.defaultVideoEnabled,
            transportsKey,
            config.turnsOnly,
        ],
    );

    useEffect(() => {
        if (!roomId) return;

        const sess = core.join({ roomId });
        setSession(sess);

        return () => {
            sess.destroy();
            setSession(null);
        };
    }, [roomId, core]);

    const state = useCallState(session);

    return {
        session,
        state,
        localStream: session?.localStream ?? null,
        remoteStreams: session?.remoteStreams ?? EMPTY_STREAMS,
    };
}
