/**
 * Reconnect-reason mapping — the cross-platform **reference** table.
 * The Android (`ReconnectReason.kt`) and iOS
 * (`ReconnectReason.swift`) ports must reproduce this mapping exactly so the
 * single shared `reconnectFailed.reason` / `reconnected.disconnection_reason`
 * analytics columns can't silently diverge per platform.
 *
 * Parity is locked by `scripts/check-telemetry-parity.mjs`, which diffs the
 * three reason tables (and the MOS coefficients) across platforms.
 *
 * Both `reconnectFailed` and `reconnected` reasons are keyed on the **server
 * signaling error code** (the only domain shared across all three cores) so a
 * new terminal error is classified identically everywhere. A code not in the
 * table is *not* a recovery-abandonment path and produces no reliability
 * event (`null`).
 * @module
 */

/** `reconnectFailed.reason` — emitted only on concrete recovery-abandonment. */
export type ReconnectFailedReason = 'timeout' | 'networkConnectivity';

/**
 * Map a terminal signaling error code to a `reconnectFailed` reason, or
 * `null` when the error is not a concrete recovery-abandonment path (so no
 * reliability event is emitted). Synthetic code `ICE_SERVER_FETCH_FAILED` is
 * raised locally when TURN/ICE fetch is exhausted (transport exhaustion).
 *
 * Only these four codes are recovery-abandonment paths; every other server
 * error (BAD_REQUEST, UNSUPPORTED_VERSION, ROOM_FULL, NOT_IN_ROOM, …) is an
 * arbitrary/unknown signaling error and must NOT report a failed reconnect.
 */
export function reconnectFailedReasonForCode(serverCode: string): ReconnectFailedReason | null {
    switch (serverCode) {
        case 'JOIN_TIMEOUT':
            return 'timeout';
        case 'INVALID_RECONNECT_TOKEN':
        case 'CONNECTION_FAILED':
        case 'ICE_SERVER_FETCH_FAILED':
            return 'networkConnectivity';
        default:
            return null;
    }
}
