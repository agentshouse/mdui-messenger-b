/**
 * Streaming median over a numeric sample stream — the
 * cross-platform **reference** implementation. Ported identically to
 * Android (`StreamingMedian.kt`) and iOS (`StreamingMedian.swift`).
 *
 * Two-heap design: a max-heap holds the lower half, a min-heap the upper
 * half. `add` is O(log n); `median` is O(1). This avoids re-sorting the full
 * (unbounded, multi-hour) sample history on every recompute.
 *
 * Median definition (exact, all cores): odd count → middle element; even
 * count → mean of the two middle elements, rounded to nearest int; zero
 * samples → null. Identical results to a sort-based median.
 * @module
 */

/** A binary heap of numbers, min or max ordered by the comparator. */
class NumberHeap {
    private readonly data: number[] = [];
    private readonly compare: (a: number, b: number) => number;

    /** `compare(a, b) < 0` means `a` has higher priority (sits at the root). */
    constructor(compare: (a: number, b: number) => number) {
        this.compare = compare;
    }

    get size(): number {
        return this.data.length;
    }

    peek(): number {
        return this.data[0]!;
    }

    push(value: number): void {
        this.data.push(value);
        this.siftUp(this.data.length - 1);
    }

    pop(): number {
        const top = this.data[0]!;
        const last = this.data.pop()!;
        if (this.data.length > 0) {
            this.data[0] = last;
            this.siftDown(0);
        }
        return top;
    }

    private siftUp(index: number): void {
        let i = index;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.compare(this.data[i]!, this.data[parent]!) >= 0) break;
            [this.data[i], this.data[parent]] = [this.data[parent]!, this.data[i]!];
            i = parent;
        }
    }

    private siftDown(index: number): void {
        let i = index;
        const n = this.data.length;
        for (;;) {
            const left = 2 * i + 1;
            const right = 2 * i + 2;
            let best = i;
            if (left < n && this.compare(this.data[left]!, this.data[best]!) < 0) best = left;
            if (right < n && this.compare(this.data[right]!, this.data[best]!) < 0) best = right;
            if (best === i) break;
            [this.data[i], this.data[best]] = [this.data[best]!, this.data[i]!];
            i = best;
        }
    }
}

export class StreamingMedian {
    // Lower half (max at root), upper half (min at root). Invariant:
    // |lower| - |upper| ∈ {0, 1} and every lower element ≤ every upper element.
    private readonly lower = new NumberHeap((a, b) => b - a); // max-heap
    private readonly upper = new NumberHeap((a, b) => a - b); // min-heap

    add(value: number): void {
        if (this.lower.size === 0 || value <= this.lower.peek()) {
            this.lower.push(value);
        } else {
            this.upper.push(value);
        }
        // Rebalance so lower holds the extra element on an odd total.
        if (this.lower.size > this.upper.size + 1) {
            this.upper.push(this.lower.pop());
        } else if (this.upper.size > this.lower.size) {
            this.lower.push(this.upper.pop());
        }
    }

    /** Median rounded to nearest int, or `null` when no samples were added. */
    median(): number | null {
        const total = this.lower.size + this.upper.size;
        if (total === 0) return null;
        if (this.lower.size > this.upper.size) {
            return Math.round(this.lower.peek());
        }
        return Math.round((this.lower.peek() + this.upper.peek()) / 2);
    }
}
