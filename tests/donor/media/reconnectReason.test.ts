import { describe, expect, it } from 'vitest';
import { reconnectFailedReasonForCode } from '../../../vendor/serenada-core/src/media/reconnectReason.js';

/**
 * Reconnect-reason table — the cross-platform source of truth.
 * Android (`ReconnectReasonTest.kt`) and iOS (`ReconnectReasonTests`)
 * assert the SAME mapping; parity across the three tables is additionally
 * guarded by `scripts/check-telemetry-parity.mjs`.
 */
describe('reconnectFailedReasonForCode', () => {
    it('maps only concrete recovery-abandonment codes', () => {
        expect(reconnectFailedReasonForCode('JOIN_TIMEOUT')).toBe('timeout');
        expect(reconnectFailedReasonForCode('INVALID_RECONNECT_TOKEN')).toBe('networkConnectivity');
        expect(reconnectFailedReasonForCode('CONNECTION_FAILED')).toBe('networkConnectivity');
        expect(reconnectFailedReasonForCode('ICE_SERVER_FETCH_FAILED')).toBe('networkConnectivity');
    });

    it('returns null for arbitrary/unknown server errors (no false reliability events)', () => {
        for (const code of ['BAD_REQUEST', 'UNSUPPORTED_VERSION', 'ROOM_FULL', 'ROOM_ENDED', 'NOT_IN_ROOM', 'NOT_HOST', 'SERVER_NOT_CONFIGURED', 'TURN_REFRESH_FAILED', 'UNKNOWN', '']) {
            expect(reconnectFailedReasonForCode(code)).toBeNull();
        }
    });
});
