/**
 * MOS (Mean Opinion Score) heuristic — the cross-platform **reference**
 * implementation. The Android (`Mos.kt`) and iOS (`Mos.swift`) ports must
 * reproduce this formula exactly; parity is locked by a checked-in golden
 * test vector asserted identically in all three core test suites.
 *
 * Simplified ITU-T G.107 E-model → MOS mapping, computed at call end from
 * the call-level medians. Do not change a coefficient without regenerating
 * the golden vector from this file and updating all three test suites in
 * lockstep.
 * @module
 */

const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, value));

/**
 * Compute a MOS estimate from call-level quality medians.
 *
 * @param rttMs    median round-trip time in ms (0 if unknown)
 * @param jitterMs median jitter in ms (0 if unknown)
 * @param lossPct  audio packet-loss percentage (0 if unknown)
 * @returns MOS clamped to `[1.0, 4.5]`, rounded to 2 decimals.
 */
export function computeMos(rttMs: number, jitterMs: number, lossPct: number): number {
    const effLatency = rttMs / 2 + 2 * jitterMs + 10;
    let r = effLatency < 160
        ? 93.2 - effLatency / 40
        : 93.2 - (effLatency - 120) / 10;
    r = r - 2.5 * lossPct;
    r = clamp(r, 0, 100);
    let mos = 1 + 0.035 * r + r * (r - 60) * (100 - r) * 0.000007;
    mos = clamp(mos, 1.0, 4.5);
    return Math.round(mos * 100) / 100;
}
