import type { Runtime as HouseRuntime } from './house';

export type DraftParts = Parameters<HouseRuntime['roomDraft']['write']>[3];
export type RoomDraft = NonNullable<Awaited<ReturnType<HouseRuntime['roomDraft']['read']>>>;
export type DraftPatch = DraftParts | ((current: RoomDraft | null) => DraftParts);
export type SaveRefusal = Exclude<Awaited<ReturnType<HouseRuntime['save']>>, { outcome: 'saved' }>;
export class DraftSaveError extends Error {
  constructor(readonly refusal: SaveRefusal) {
    super(`House did not queue this draft: ${refusal.rule}. The draft is preserved.`);
  }
}
export class DraftChangedError extends Error {
  constructor() { super('The message draft changed after Send was selected. Its newer contents are preserved; review and send again.'); }
}
export class DraftSaveUncertainError extends Error {
  constructor(cause: unknown) { super(`The House save outcome is uncertain. Review the Room before retrying. ${cause instanceof Error ? cause.message : String(cause)}`); }
}
export function mergeDraftParts(current: DraftParts, patch: DraftParts): DraftParts {
  const fields = { ...current.fields, ...patch.fields };
  for (const name of Object.keys(patch.fields ?? {})) {
    if (current.fields?.[name] && 'base' in current.fields[name]) fields[name] = { ...fields[name], base: current.fields[name].base };
  }
  const sections = { ...current.sections, ...patch.sections };
  for (const name of Object.keys(patch.sections ?? {})) {
    if (current.sections?.[name] && 'base' in current.sections[name]) sections[name] = { ...sections[name], base: current.sections[name].base };
  }
  return {
    ...current, ...patch,
    ...(current.fields || patch.fields ? { fields } : {}),
    ...(current.sections || patch.sections ? { sections } : {}),
    ...(patch.preamble && current.preamble ? { preamble: { ...patch.preamble, base: current.preamble.base } } : {}),
    ...(patch.markdown && current.markdown ? { markdown: { ...patch.markdown, base: current.markdown.base } } : {}),
  };
}
/** Durable Room-local edits. Master1420: later local input wins a stale overlap;
 * retain disjoint parts and first bases; only explicit Save queues a change. */
export class DraftSession {
  private draft: RoomDraft | null = null;
  private readonly opened: Promise<RoomDraft | null>;
  private tail: Promise<unknown>;
  private epoch = 0;
  private listeners = new Set<(draft: RoomDraft | null) => void>();
  readonly runtime: HouseRuntime;
  readonly room: string;
  readonly path: string;
  constructor(runtime: HouseRuntime, room: string, path: string) {
    this.runtime = runtime; this.room = room; this.path = path;
    const epoch = this.epoch;
    this.opened = runtime.roomDraft.read(room, path).then(draft => {
      if (this.epoch === epoch) this.accept(draft);
      return this.draft;
    });
    this.tail = this.opened;
  }
  async read() { await this.opened; await this.tail.catch(() => undefined); return this.draft; }
  current() { return this.draft; }
  /** Feed this from the Runtime's live room-drafts observation, including null
   * when that draft is saved/discarded. Never infer author or device identity. */
  accept(draft: RoomDraft | null) {
    if (draft && (draft.room !== this.room || draft.path !== this.path)) throw new Error('Draft scope does not match this editor.');
    this.epoch++;
    this.draft = draft;
    this.listeners.forEach(listener => listener(draft));
  }
  subscribe(listener: (draft: RoomDraft | null) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.catch(() => undefined).then(work);
    this.tail = result;
    return result;
  }
  private async refresh() {
    for (;;) {
      const epoch = this.epoch;
      const current = await this.runtime.roomDraft.read(this.room, this.path);
      if (epoch !== this.epoch) continue;
      this.accept(current);
      return current;
    }
  }
  stage(input: DraftPatch, expectedRevision?: string): Promise<RoomDraft | null> {
    return this.serialize(async () => {
      await this.opened;
      let known = this.draft;
      for (;;) {
        if (expectedRevision !== undefined && known?.revision !== expectedRevision) throw new DraftChangedError();
        const patch = typeof input === 'function' ? input(known) : input;
        const parts = mergeDraftParts(known?.parts ?? {}, patch);
        const epoch = this.epoch;
        const result = await this.runtime.roomDraft.write(this.room, this.path, known?.revision ?? null, parts);
        if (result.outcome === 'written') {
          // A newer observation may arrive while the local bridge answer is in
          // flight. Do not redraw that newer shared draft with an older reply.
          if (this.epoch === epoch) this.accept(result.roomDraft);
          else await this.refresh();
          if (expectedRevision !== undefined && this.draft?.revision !== result.roomDraft?.revision) throw new DraftChangedError();
          return this.draft;
        }
        if (result.outcome !== 'stale') throw new Error('The House draft changed unexpectedly. Its contents are preserved.');
        // The Runtime owns revision comparison. Re-read, preserve its current
        // parts, and reapply this editor's latest queued input as instructed.
        known = await this.refresh();
      }
    });
  }
  flush() { return this.tail; }
  commit(expectedRevision?: string): Promise<string | null> {
    return this.serialize(async () => {
      await this.opened;
      const draft = this.draft;
      if (expectedRevision !== undefined && draft?.revision !== expectedRevision) throw new DraftChangedError();
      if (!draft) return null;
      let result: Awaited<ReturnType<HouseRuntime['save']>>;
      try { result = await this.runtime.save(this.room, [{ path: this.path, revision: draft.revision }]); }
      catch (error) { throw new DraftSaveUncertainError(error); }
      if (result.outcome !== 'saved') { await this.refresh(); throw new DraftSaveError(result); }
      // Save clears the named revision only. Retain later typing from a tab.
      await this.refresh();
      return result.identifier;
    });
  }
}
