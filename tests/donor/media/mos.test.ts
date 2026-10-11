import { describe, expect, it } from 'vitest';
import { computeMos } from '../../../vendor/serenada-core/src/media/mos.js';

/**
 * MOS golden vector — the cross-platform source of truth.
 * Android (`MosTest.kt`) and iOS (`MosTests.swift`) assert the SAME table to
 * ±0.01. If any coefficient in `mos.ts` changes, regenerate this table from
 * the reference impl and update all three suites in lockstep.
 */
const GOLDEN_VECTOR: ReadonlyArray<{
    medianLatencyMs: number;
    medianJitterMs: number;
    packetLossPct: number;
    expectedMos: number;
}> = [
    { medianLatencyMs: 0, medianJitterMs: 0, packetLossPct: 0, expectedMos: 4.40 },
    { medianLatencyMs: 50, medianJitterMs: 5, packetLossPct: 0, expectedMos: 4.39 },
    { medianLatencyMs: 150, medianJitterMs: 20, packetLossPct: 1, expectedMos: 4.28 },
    { medianLatencyMs: 300, medianJitterMs: 40, packetLossPct: 3, expectedMos: 3.77 },
    { medianLatencyMs: 500, medianJitterMs: 60, packetLossPct: 8, expectedMos: 2.43 },
];

describe('computeMos golden vector', () => {
    for (const { medianLatencyMs, medianJitterMs, packetLossPct, expectedMos } of GOLDEN_VECTOR) {
        it(`rtt=${medianLatencyMs} jitter=${medianJitterMs} loss=${packetLossPct} -> ${expectedMos}`, () => {
            expect(computeMos(medianLatencyMs, medianJitterMs, packetLossPct)).toBeCloseTo(expectedMos, 2);
        });
    }

    it('clamps to the [1.0, 4.5] range under pathological inputs', () => {
        // Best-quality input yields the formula's natural maximum (~4.40),
        // never the documented 4.5 ceiling — assert the exact value so a
        // future edit that raises/removes the ceiling or drifts a coefficient
        // fails here (the old `<= 4.5` assertion was a tautology).
        expect(computeMos(0, 0, 0)).toBeCloseTo(4.40, 2);
        // No valid input may breach the [1.0, 4.5] contract; floor exercised
        // by a pathological input.
        expect(computeMos(5000, 5000, 100)).toBe(1.0);
        expect(computeMos(0, 0, 0)).toBeLessThanOrEqual(4.5);
    });
});
