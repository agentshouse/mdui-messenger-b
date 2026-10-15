import { DraftChangedError, DraftSaveError, DraftSaveUncertainError, DraftSession, type RoomDraft } from "./draft-session";
import { MAX_FILE_BYTES, uploadAttachment } from "./assets";
import { houseBridge as getHouseBridge } from "@agentshouse/app-bridge";
import {
  chatSchema,
  attachmentSchema,
  messageSchema,
  callSchema,
  callPartSchema,
  type Store,
  type Snapshot,
  type Message,
  type Chat,
  type CallPart,
  type Author,
  type ComposerDraft,
  type MessageDraft,
  type MessageOutcome,
  type Attachment,
} from "./model";
export type Runtime = Awaited<ReturnType<typeof getHouseBridge>["runtime"]>;
const observeQueue = (runtime: Runtime, room: string) => runtime.observe("queue", room);
type Queue = ReturnType<Awaited<ReturnType<typeof observeQueue>>["current"]>;
const messageKey = (message: { room: string; path: string }) => `${message.room}/${message.path}`;
type Document = {
  room: string;
  path: string;
  type?: string;
  fields?: Readonly<Record<string, unknown>>;
  change?: {
    author?: { kind: string; id: string; name?: string | null } | null;
  } | null;
};
export const query = {
  types: [
    "messenger_chat",
    "messenger_message",
    "messenger_call",
    "messenger_call_part",
  ],
  select: { fields: "all" as const, change: true as const },
  orderBy: [{ by: "path" as const, direction: "asc" as const }],
};
let bridge: ReturnType<typeof getHouseBridge> | undefined;
export function houseBridge() {
  if (!bridge) {
    bridge = getHouseBridge();
    bridge.setTab({ title: "messenger-b" });
  }
  return bridge;
}
export function houseRuntime() { return houseBridge().runtime; }
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
export class HouseMessengerStore implements Store {
  private state: Snapshot = {
    composerDrafts: {},
    availableDrafts: [],
    messageDrafts: {},
    messageOutcomes: {},
    chats: [],
    messages: [],
    callParts: [],
    loading: true,
    error: null,
    sync: "",
    busy: false,
    halted: false,
  };
  private listeners = new Set<() => void>();
  private close: (() => void)[] = [];
  private init?: Promise<void>;
  private connectionTimer?: ReturnType<typeof setTimeout>;
  private md?: Runtime;
  private rooms = new Map<string, string>();
  private composerSessions = new Map<string, DraftSession>();
  private messageSessions = new Map<string, DraftSession>();
  private messagePending = new Map<string, number>();
  private messageFailed = new Set<string>();
  private messageWork = new Map<string, Promise<void>>();
  private queues = new Map<string, Queue>();
  private queueRooms = new Set<string>();
  private localOutcomes = new Map<string, MessageOutcome>();
  private providerOutcomes = new Map<string, MessageOutcome>();
  private accepted = new Map<string, { room: string; roomVersion: string; batchId: string }>();
  private localDrafts: readonly RoomDraft[] = [];
  private composerPending = new Map<string, number>();
  private composerWork = new Map<string, Promise<void>>();
  private composerFailed = new Set<string>();
  private uploadReceipts = new WeakMap<File, Map<string, Attachment>>();
  private retainedMessageFiles = new WeakMap<File, { room: string; path: string }>();
  private fatal: string | null = null;
  private bindingError: string | null = null;
  private refusalError: string | null = null;
  private storageError: string | null = null;
  private ready = false;
  private get blockingError() {
    return this.fatal ?? this.refusalError ?? this.storageError ?? this.bindingError;
  }
  private locked = false;
  private disposed = false;
  constructor(private provider: () => Promise<Runtime> = houseRuntime) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit(patch: Partial<Snapshot>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  private fail(message: string) {
    this.fatal = message;
    this.emit({ loading: false, error: message });
  }
  private outcome(key: string, value: MessageOutcome) {
    if (value.status === "waiting" && this.localOutcomes.get(key)?.status === "confirmed" && value.batchId === this.localOutcomes.get(key)?.batchId) return;
    this.localOutcomes.set(key, value);
    this.refreshMessageDrafts();
  }
  private refreshMessageDrafts() {
    const messageDrafts: Record<string, MessageDraft> = {};
    const messageOutcomes: Record<string, MessageOutcome> = {};
    for (const [key, outcome] of this.providerOutcomes) {
      if ([...this.rooms.keys()].some(room => key.startsWith(`${room}/messages/`))) messageOutcomes[key] = outcome;
    }
    for (const [key, outcome] of this.localOutcomes) {
      if (![...this.rooms.keys()].some(room => key.startsWith(`${room}/messages/`))) continue;
      const provider = messageOutcomes[key];
      if (outcome.status !== "waiting" || provider?.batchId !== outcome.batchId) messageOutcomes[key] = outcome;
    }
    for (const draft of this.localDrafts) {
      if (!this.rooms.has(draft.room) || !/^messages\/[0-9a-f-]{36}\.md$/.test(draft.path)) continue;
      const key = messageKey(draft);
      const creation = this.readComposer(draft);
      const message = this.state.messages.find(value => messageKey(value) === key);
      if (!creation && !message) continue;
      const field = draft.parts.fields?.text?.value;
      const attachments = attachmentSchema.array().safeParse(draft.parts.fields?.attachments?.value ?? creation?.attachments ?? message?.attachments ?? []);
      messageDrafts[key] = { room: draft.room, path: draft.path, text: typeof field === "string" ? field : creation?.text ?? message!.text, revision: draft.revision, draft, ...(attachments.success ? { attachments: attachments.data } : {}) };
      if (draft.returned) {
        const reason = draft.returned;
        // A returned native draft is the authoritative outcome. Do not revive
        // an old queue receipt when this returned draft is later discarded.
        this.providerOutcomes.delete(key);
        this.localOutcomes.delete(key);
        this.accepted.delete(key);
        messageOutcomes[key] = { status: reason.kind, returned: reason, details: `House ${reason.kind}: ${reason.code}. ${JSON.stringify(reason.fields)}` };
      } else if (Object.keys(draft.changedUnderneath).length) {
        messageOutcomes[key] = { status: "changed-underneath", details: `The Room changed beneath this draft. Original bases are preserved. ${JSON.stringify(draft.changedUnderneath)}` };
      } else if (!this.localOutcomes.has(key) || !["invalid", "uncertain", "changed-underneath"].includes(this.localOutcomes.get(key)!.status)) {
        messageOutcomes[key] = { status: "draft", details: "Local Room draft; not sent." };
      }
    }
    for (const [key, draft] of Object.entries(this.state.messageDrafts ?? {})) {
      if (this.messagePending.get(key) || this.messageFailed.has(key)) messageDrafts[key] = draft;
    }
    if (this.state.halted) for (const [key, outcome] of Object.entries(messageOutcomes)) {
      if (outcome.status === "waiting") messageOutcomes[key] = { ...outcome, details: "Queued locally; House writes are paused." };
    }
    this.emit({ messageDrafts, messageOutcomes });
  }
  private readQueue(room: string, queue: Queue) {
    const previous = this.queues.get(room) ?? [];
    this.queues.set(room, queue);
    for (const entry of previous) {
      if (queue.some(current => current.batch.id === entry.batch.id)) continue;
      for (const change of entry.batch.changes) {
        const key = `${room}/${change.path}`;
        const held = this.providerOutcomes.get(key);
        if (held?.batchId === entry.batch.id && held.status !== "accepted" && held.status !== "confirmed") {
          this.providerOutcomes.set(key, { status: "uncertain", batchId: entry.batch.id, details: "The queue entry is no longer visible; no Provider confirmation was observed. Check the Room before retrying." });
        }
      }
    }
    for (const entry of queue) {
      for (const change of entry.batch.changes) {
        if (!/^messages\/[0-9a-f-]{36}\.md$/.test(change.path)) continue;
        const key = `${room}/${change.path}`;
        const held = this.providerOutcomes.get(key);
        if (held?.status === "confirmed" && held.batchId === entry.batch.id) continue;
        const common = { batchId: entry.batch.id };
        this.providerOutcomes.set(key, entry.state === "accepted"
          ? { ...common, status: "accepted", details: "Accepted by House; waiting for the Room to refresh." }
          : entry.state === "reset"
            ? { ...common, status: "retrying", details: `Pending in House; the Provider scheduled a retry at ${entry.reset}.` }
            : entry.state === "submitted"
              ? { ...common, status: "submitted", details: "Submitted to House; awaiting the Provider's result." }
              : { ...common, status: "waiting", details: "Queued locally; waiting for House." });
        if (entry.state === "accepted") {
          const receipt = this.accepted.get(key);
          if (receipt?.batchId !== entry.batch.id || receipt.roomVersion !== entry.roomVersion) this.accepted.set(key, { room, roomVersion: entry.roomVersion, batchId: entry.batch.id });
        } else if (this.accepted.get(key)?.batchId !== entry.batch.id) this.accepted.delete(key);
      }
    }
    this.refreshMessageDrafts();
    void this.confirmAccepted();
  }
  private async confirmAccepted() {
    if (!this.md || this.disposed) return;
    for (const [key, accepted] of this.accepted) {
      if (!this.rooms.has(accepted.room)) continue;
      try {
        if (!await this.md.reached(accepted.room, accepted.roomVersion)) continue;
        if (this.disposed || this.accepted.get(key) !== accepted) continue;
        this.accepted.delete(key);
        if (this.providerOutcomes.get(key)?.batchId === accepted.batchId) this.providerOutcomes.set(key, { status: "confirmed", batchId: accepted.batchId, details: "House confirmed this change in the Room." });
      } catch { /* Transport/observation uncertainty never means rejection. */ }
    }
    this.refreshMessageDrafts();
  }
  private async observeQueues() {
    if (!this.md) return;
    for (const room of this.rooms.keys()) {
      if (this.disposed) return;
      if (this.queueRooms.has(room)) continue;
      this.queueRooms.add(room);
      try {
        const watch = await observeQueue(this.md, room);
        if (!this.ownObservation(watch, () => {
          this.readQueue(room, watch.current());
        })) return;
      } catch (error) {
        this.queueRooms.delete(room);
        this.emit({ error: `House message status is unavailable: ${errorText(error)}` });
      }
    }
  }
  private read(result: { documents: readonly Document[] }) {
    const chats: Chat[] = [],
      messages: Message[] = [],
      callParts: CallPart[] = [];
    const identities = new Set<string>();
    const calls = new Set<string>();
    for (const doc of result.documents) {
      if (!this.rooms.has(doc.room))
        throw new Error("House returned a document outside the bound Rooms.");
      const key = `${doc.room}/${doc.path}`;
      if (identities.has(key))
        throw new Error("Duplicate House document path.");
      identities.add(key);
      if (doc.type === "messenger_chat") {
        const fields = chatSchema.parse(doc.fields);
        if (doc.path !== "chats/main.md")
          throw new Error(
            "Each Room must contain its single chat at chats/main.md. Private audiences need separate Rooms.",
          );
        chats.push({
          ...fields,
          room: doc.room,
          roomName: this.rooms.get(doc.room)!,
          path: doc.path,
        });
      } else if (doc.type === "messenger_message") {
        const fields = messageSchema.parse(doc.fields);
        if (doc.path !== `messages/${fields.id}.md`)
          throw new Error("Message identity does not match its path.");
        const author = doc.change?.author;
        messages.push({
          ...fields,
          room: doc.room,
          path: doc.path,
          author: author
            ? ({ ...author, name: author.name ?? null } as Author)
            : null,
        });
      } else if (doc.type === "messenger_call") {
        const fields = callSchema.parse(doc.fields);
        if (doc.path !== `calls/${fields.id}.md`)
          throw new Error("Call identity does not match its path.");
        calls.add(`${doc.room}/${fields.id}`);
      } else if (doc.type === "messenger_call_part") {
        const fields = callPartSchema.parse(doc.fields);
        if (doc.path !== `call-parts/${fields.id}.md`)
          throw new Error("Call-part identity does not match its path.");
        callParts.push({ ...fields, room: doc.room, path: doc.path });
      } else throw new Error("Unexpected Messenger document type.");
    }
    for (const item of messages) {
      if (!chats.some((c) => c.room === item.room))
        throw new Error("A message refers to a missing Room chat.");
      if (
        item.reply &&
        !messages.some(
          (m) =>
            m.room === item.room &&
            m.path === `messages/${item.reply!.slice(2)}`,
        )
      )
        throw new Error("A message reply target is unavailable.");
    }
    for (const item of callParts) {
      if (
        !calls.has(`${item.room}/${item.call_id}`) ||
        item.call !== `../calls/${item.call_id}.md`
      )
        throw new Error("A call part refers to an unavailable call.");
      if (
        new Set(item.participants.map((x) => x.id)).size !== 2 ||
        new Set(item.files.map((x) => x.speaker_id)).size !== 2 ||
        item.files.some(
          (x) => !item.participants.some((p) => p.id === x.speaker_id),
        )
      )
        throw new Error("A call part must contain one file per named speaker.");
    }
    this.emit({
      chats,
      messages: messages.sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      ),
      callParts: callParts.sort((a, b) => a.part - b.part),
      loading: false,
      error: this.blockingError,
    });
    this.refreshMessageDrafts();
  }
  private readComposer(draft: RoomDraft): ComposerDraft | null {
    const creation = draft.parts.creation;
    if (!this.rooms.has(draft.room) || !creation || !("type" in creation) || creation.type !== "messenger_message") return null;
    const fields = creation.fields;
    if (typeof fields.id !== "string" || draft.path !== `messages/${fields.id}.md` || fields.chat !== "../chats/main.md" || typeof fields.text !== "string" || typeof fields.created_at !== "string") return null;
    const attachments = attachmentSchema.array().safeParse(fields.attachments);
    if (!attachments.success) return null;
    return { room: draft.room, path: draft.path, id: fields.id, text: fields.text, created_at: fields.created_at, attachments: attachments.data, ...(typeof fields.reply === "string" ? { reply: fields.reply } : {}) };
  }
  private refreshComposers() {
    if (!this.md || !this.ready) return;
    const available = this.localDrafts.map(draft => this.readComposer(draft)).filter((draft): draft is ComposerDraft => draft !== null).sort((one, two) => two.created_at.localeCompare(one.created_at) || one.path.localeCompare(two.path));
    const next = { ...this.state.composerDrafts };
    for (const room of this.rooms.keys()) {
      if (this.composerPending.get(room) || this.composerFailed.has(room)) continue;
      const current = this.composerSessions.get(room);
      const draft = available.find(item => item.room === room && item.path === current?.path) ?? available.find(item => item.room === room);
      if (draft) {
        if (!current || current.path !== draft.path) this.composerSessions.set(room, new DraftSession(this.md, room, draft.path));
        next[room] = draft;
      } else {
        this.composerSessions.delete(room);
        delete next[room];
      }
    }
    this.emit({ composerDrafts: next, availableDrafts: available });
  }
  selectComposer(room: string, path: string) {
    if (!this.md || this.composerPending.get(room) || this.state.busy) return;
    const draft = this.state.availableDrafts?.find(item => item.room === room && item.path === path);
    if (!draft) return;
    this.composerFailed.delete(room);
    this.composerSessions.set(room, new DraftSession(this.md, room, path));
    this.refreshComposers();
  }
  writeComposer(room: string, text: string, reply?: Message | null): Promise<void> {
    // No schema validation while typing: even incomplete business-field values
    // belong to the actual message creation draft. Only Send validates them.
    const previous = this.state.composerDrafts?.[room];
    const optimistic: ComposerDraft = { room, path: previous?.path ?? "", id: previous?.id ?? "", text, created_at: previous?.created_at ?? "", attachments: previous?.attachments ?? [], ...(reply === undefined && previous?.reply ? { reply: previous.reply } : reply ? { reply: `./${reply.id}.md` } : {}) };
    this.composerPending.set(room, (this.composerPending.get(room) ?? 0) + 1);
    this.emit({ composerDrafts: { ...this.state.composerDrafts, [room]: optimistic } });
    const work = (this.composerWork.get(room) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      await this.start();
      if (this.disposed || !this.md || !this.ready || !this.rooms.has(room)) throw new Error("The message's Room is unavailable for local drafting.");
      if (reply && (reply.room !== room || !this.state.messages.some(message => messageKey(message) === messageKey(reply)))) throw new Error("The reply target is not in this Room.");
      let session = this.composerSessions.get(room);
      if (!session) {
        const existing = this.localDrafts.map(draft => this.readComposer(draft)).find(draft => draft?.room === room);
        const id = existing?.id ?? crypto.randomUUID();
        session = new DraftSession(this.md, room, existing?.path ?? `messages/${id}.md`);
        this.composerSessions.set(room, session);
      }
      const id = session.path.slice('messages/'.length, -3);
      await session.stage(current => {
        const creation = current?.parts.creation;
        if (creation && (!("type" in creation) || creation.type !== "messenger_message")) throw new Error("The message draft changed its document type. It has been preserved.");
        const fields = { ...(creation && "fields" in creation ? creation.fields : { id, chat: "../chats/main.md", created_at: new Date().toISOString(), kind: "text", attachments: [] }), text };
        const values: Record<string, unknown> = fields;
        if (reply) values.reply = `./${reply.id}.md`; else if (reply === null) delete values.reply;
        return { creation: { ...(creation ?? { type: "messenger_message", sections: {} }), fields: values } };
      });
      this.composerFailed.delete(room);
    }).catch(error => { this.composerFailed.add(room); throw error; }).finally(() => {
      this.composerPending.set(room, (this.composerPending.get(room) ?? 1) - 1);
      this.refreshComposers();
    });
    this.composerWork.set(room, work);
    return work;
  }
  writeMessage(message: Message, text: string): Promise<void> {
    const key = messageKey(message);
    const previous = this.state.messageDrafts?.[key];
    this.messagePending.set(key, (this.messagePending.get(key) ?? 0) + 1);
    this.emit({ messageDrafts: { ...this.state.messageDrafts, [key]: { ...previous, room: message.room, path: message.path, text } } });
    const work = (this.messageWork.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      await this.start();
      if (this.disposed || !this.md || !this.ready || !this.rooms.has(message.room) || !this.state.messages.some(value => messageKey(value) === key)) throw new Error("This message is no longer available in a bound Room. Your input is preserved.");
      let session = this.messageSessions.get(key);
      if (!session) {
        session = new DraftSession(this.md, message.room, message.path);
        this.messageSessions.set(key, session);
      }
      await session.stage(current => {
        if (current?.parts.creation || current?.parts.markdown || current?.parts.removal || current?.parts.move) throw new Error("This message has a whole-document draft. Review it in House; its contents are preserved.");
        return { fields: { text: { value: text, base: current?.parts.fields?.text?.base ?? { value: message.text } } } };
      });
      this.messageFailed.delete(key);
      if (this.localOutcomes.get(key)?.status !== "uncertain") this.localOutcomes.delete(key);
    }).catch(error => {
      this.messageFailed.add(key);
      this.outcome(key, { status: "invalid", details: errorText(error) });
      throw error;
    }).finally(() => {
      this.messagePending.set(key, (this.messagePending.get(key) ?? 1) - 1);
      this.refreshMessageDrafts();
    });
    this.messageWork.set(key, work);
    return work;
  }
  async saveMessage(message: Message): Promise<void> {
    const key = messageKey(message);
    if (this.localOutcomes.get(key)?.status === "uncertain") throw new Error(this.localOutcomes.get(key)!.details);
    if (this.locked || this.state.busy) throw new Error("A save is already in progress.");
    this.locked = true;
    this.emit({ busy: true });
    const pending = this.messageWork.get(key);
    const work = (async () => {
      await this.start();
      await pending?.catch(error => { if (this.messageFailed.has(key)) throw error; });
      if (this.disposed || !this.md || !this.ready || !this.rooms.has(message.room) || this.blockingError) throw new Error(this.blockingError ?? "This message's Room is unavailable.");
      let session = this.messageSessions.get(key);
      if (!session) {
        session = new DraftSession(this.md, message.room, message.path);
        this.messageSessions.set(key, session);
      }
      const draft = await session.read();
      if (!draft) return;
      const current = this.state.messages.find(value => messageKey(value) === key);
      if (!current) throw new Error("This message is no longer available. Its draft is preserved.");
      if (draft.parts.creation || draft.parts.markdown || draft.parts.move || draft.parts.removal) throw new Error("This message has a whole-document draft. Review it in House; its contents are preserved.");
      const fields: Record<string, unknown> = { ...current };
      for (const [name, field] of Object.entries(draft.parts.fields ?? {})) fields[name] = field.value;
      messageSchema.parse(fields);
      const batchId = await session.commit(draft.revision);
      if (batchId) this.outcome(key, { status: "waiting", batchId, details: "Queued locally; waiting for House." });
      this.read(await this.md.query({ ...query, rooms: [...this.rooms.keys()] }));
    })().catch(error => {
      this.recordSaveFailure(key, error);
      throw error;
    }).finally(() => {
      this.locked = false;
      this.emit({ busy: false });
      this.refreshMessageDrafts();
    });
    this.messageWork.set(key, work);
    return work;
  }
  private recordSaveFailure(key: string, error: unknown) {
    const status: MessageOutcome["status"] = error instanceof DraftSaveUncertainError ? "uncertain" : error instanceof DraftSaveError
      ? error.refusal.code === "changed-underneath" ? "changed-underneath" : "invalid"
      : error instanceof DraftChangedError ? "changed-underneath" : "invalid";
    this.outcome(key, { status, details: error instanceof DraftSaveError ? `${error.message} ${JSON.stringify(error.refusal)}` : errorText(error) });
  }
  start() {
    if (this.disposed) return Promise.resolve();
    this.init ??= this.connect();
    return this.init;
  }
  private ownObservation(
    watch: { subscribe(listener: () => void): () => void; close(): void },
    render: () => void,
  ): boolean {
    let released = false;
    let unsubscribe: (() => void) | undefined;
    const close = () => {
      if (released) return;
      released = true;
      try {
        unsubscribe?.();
      } finally {
        watch.close();
      }
    };
    if (this.disposed) {
      close();
      return false;
    }
    // Own the observation before subscribing or rendering: either may notify a
    // view synchronously, and that view can dispose the store during the call.
    this.close.push(close);
    const update = () => {
      if (!this.disposed && !released) render();
    };
    try {
      const off = watch.subscribe(update);
      if (released) {
        off();
        return false;
      }
      unsubscribe = off;
      update();
      return !this.disposed;
    } catch (error) {
      close();
      throw error;
    }
  }
  private async connect() {
    const timer = (this.connectionTimer = setTimeout(
      () =>
        this.emit({
          loading: false,
          error:
            "Open Messenger inside House with its Room bindings. House has not supplied the runtime.",
        }),
      15000,
    ));
    try {
      this.md = await this.provider();
      if (this.disposed) return;
      // rooms() is a local snapshot, initially empty. Both observations must
      // stay alive so a completed sync and a later binding can recover in-place.
      const bindings = await this.md.observe("rooms");
      if (this.disposed) { bindings.close(); return; }
      let syncComplete = false;
      let guardsReady = false;
      let queryKey = "";
      let queryGeneration = 0;
      let renderQuery: (() => void) | undefined;
      let releaseQuery: (() => void) | undefined;
      const refresh = async () => {
        if (this.disposed) return;
        const next = bindings.current();
        this.ready = guardsReady && syncComplete && next.length > 0;
        this.bindingError = syncComplete && !next.length
          ? "Room bindings changed or are missing. Bind a Messenger Room in House. Different private audiences must use separate Rooms."
          : null;
        if (!this.ready) {
          this.emit({ loading: !syncComplete, error: this.blockingError });
          return;
        }
        const key = JSON.stringify(next.map(room => room.locator).sort());
        this.rooms = new Map(next.map(room => [room.locator, room.name]));
        void this.confirmAccepted();
        if (key === queryKey) {
          renderQuery?.();
          return;
        }
        queryKey = key;
        void this.observeQueues();
        const generation = ++queryGeneration;
        releaseQuery?.();
        renderQuery = undefined;
        this.emit({ loading: true, error: this.blockingError });
        try {
          const watch = await this.md!.observe("query", {
            ...query, rooms: [...this.rooms.keys()],
          });
          if (this.disposed || generation !== queryGeneration) { watch.close(); return; }
          let released = false;
          const subscription: { unsubscribe?: () => void } = {};
          releaseQuery = () => {
            if (released) return;
            released = true;
            subscription.unsubscribe?.();
            watch.close();
          };
          this.close.push(releaseQuery);
          renderQuery = () => {
            if (this.disposed || released || generation !== queryGeneration || !this.ready) return;
            try {
              const result = watch.current();
              if ("pending" in result) return;
              this.read(result);
            }
            catch (e) { this.emit({ loading: false, error: this.blockingError ?? errorText(e) }); }
          };
          const off = watch.subscribe(renderQuery);
          if (released) { off(); return; }
          subscription.unsubscribe = off;
          renderQuery();
        } catch (e) {
          if (!this.disposed && generation === queryGeneration)
            this.emit({ loading: false, error: this.blockingError ?? errorText(e) });
        }
      };
      if (!this.ownObservation(bindings, () => { void refresh(); })) return;
      const status = await this.md.observe("sync-status");
      const showSync = () => {
        const value = status.current();
        syncComplete = value.lastCompleted !== null && value.lastCompleted !== undefined;
        this.emit({ sync: value.attentionRequired.length ? "House drafts need attention" : "" });
        void refresh();
      };
      if (!this.ownObservation(status, showSync)) return;
      const mode = await this.md.observe("service-mode");
      if (!this.ownObservation(mode, () => { this.emit({ halted: mode.current() === "write-halted" }); this.refreshMessageDrafts(); })) return;
      const refusal = await this.md.observe("connection-refusal");
      if (!this.ownObservation(refusal, () => {
        this.refusalError = refusal.current() ? "House authorization changed. Reopen the App before continuing." : null;
        void refresh();
      })) return;
      const loss = await this.md.observe("storage-loss");
      if (!this.ownObservation(loss, () => {
        this.storageError = loss.current() ? "House reports lost unsynchronized changes. Check the Room before continuing." : null;
        void refresh();
      })) return;
      const drafts = await this.md.observe("room-drafts");
      if (!this.ownObservation(drafts, () => {
        this.localDrafts = drafts.current();
        this.composerSessions.forEach(session => session.accept(this.localDrafts.find(draft => draft.room === session.room && draft.path === session.path) ?? null));
        this.messageSessions.forEach(session => session.accept(this.localDrafts.find(draft => draft.room === session.room && draft.path === session.path) ?? null));
        this.refreshComposers();
        this.refreshMessageDrafts();
      })) return;
      guardsReady = true;
      await refresh();
      this.refreshComposers();
    } catch (e) {
      this.emit({ loading: false, error: errorText(e) });
    } finally {
      clearTimeout(timer);
      if (this.connectionTimer === timer) this.connectionTimer = undefined;
    }
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.connectionTimer);
    this.connectionTimer = undefined;
    this.listeners.clear();
    for (const close of this.close.splice(0)) {
      try {
        close();
      } catch {
        // Release the remaining observations even if one cleanup fails.
      }
    }
  }
  private async create(
    room: string,
    path: string,
    type: string,
    fields: Record<string, unknown>,
  ) {
    if (this.locked) throw new Error("A save is already in progress.");
    this.locked = true;
    this.emit({ busy: true });
    try {
      await this.start();
      if (this.disposed || !this.ready) throw new Error(this.blockingError ?? "Loading Messenger Rooms…");
      if (this.state.error) throw new Error(this.state.error);
      if (!this.md || !this.rooms.has(room))
        throw new Error("That Room is not bound.");
      if (await this.md.roomDraft.read(room, path))
        throw new Error(
          "An unfinished House draft already exists for this document. Resolve it in House.",
        );
      const result = await this.md.roomDraft.write(room, path, null, {
        creation: { type, fields, sections: {} },
      });
      if (result.outcome !== "written" || !result.roomDraft)
        throw new Error(
          "The House draft changed. Your composer is preserved; inspect the draft before retrying.",
        );
      let saved: Awaited<ReturnType<Runtime["save"]>>;
      try { saved = await this.md.save(room, [{ path, revision: result.roomDraft.revision }]); }
      catch (error) { throw new DraftSaveUncertainError(error); }
      if (saved.outcome !== "saved") throw new DraftSaveError(saved);
      if (type === "messenger_message") this.outcome(`${room}/${path}`, { status: "waiting", batchId: saved.identifier, details: "Queued locally; waiting for House." });
      this.read(
        await this.md.query({ ...query, rooms: [...this.rooms.keys()] }),
      );
    } finally {
      this.locked = false;
      this.emit({ busy: false });
    }
  }
  async send(room: string, text: string, reply?: Message, files: File[] = []) {
    await this.start();
    if (!this.ready || !this.rooms.has(room)) throw new Error(this.blockingError ?? "Room bindings changed. Select an available Room chat.");
    if (!this.state.chats.some(chat => chat.room === room)) throw new Error("Select an existing Room chat.");
    if (reply && (reply.room !== room || !this.state.messages.some(message => messageKey(message) === messageKey(reply)))) throw new Error("The reply target is not in this Room.");
    if (files.length && this.state.halted) throw new Error("House attachment uploads are paused. Your message draft is preserved.");
    if (files.length > 8) throw new Error("Attach at most eight files.");
    for (const file of files) {
      const retained = this.retainedMessageFiles.get(file);
      if (retained?.room === room) throw new Error(`This file is already retained on message ${retained.path}. Open that message's editor and choose Save changes. Remove this file from the composer before sending a new message.`);
    }
    if (this.locked || this.state.busy) throw new Error("A send is already in progress.");
    if (this.state.error || !this.md) throw new Error(this.state.error ?? "House is not writable.");
    if (!text.trim() && !files.length && !this.state.composerDrafts?.[room]?.attachments.length) throw new Error("Write a message or attach a file.");
    // Validate before any upload, retaining the unmodified native draft on error.
    try { messageSchema.shape.text.parse(text); }
    catch (error) {
      const draft = this.state.composerDrafts?.[room];
      if (draft?.path) this.recordSaveFailure(messageKey(draft), error);
      throw error;
    }
    for (const file of files) {
      attachmentSchema.omit({ path: true, sha256: true }).parse({ name: file.name, mime: file.type || "application/octet-stream", bytes: file.size });
      if (!file.name.trim() || file.size === 0 || file.size > MAX_FILE_BYTES) throw new Error("Choose a nonempty named file of at most 20 MiB.");
    }
    this.emit({ busy: true });
    const previous = this.composerWork.get(room);
    const work = (async () => {
      await previous?.catch(error => { if (this.composerFailed.has(room)) throw error; });
      let composer = this.composerSessions.get(room);
      let prepared = await composer?.read();
      const priorCreation = prepared?.parts.creation;
      if (composer && (!prepared || !priorCreation || !("type" in priorCreation) || priorCreation.type !== "messenger_message")) throw new DraftChangedError();
      const priorFields = priorCreation && "fields" in priorCreation ? priorCreation.fields : undefined;
      if (priorFields && priorFields.text !== text) {
        const error = new DraftChangedError();
        this.recordSaveFailure(`${room}/${composer!.path}`, error);
        throw error;
      }
      const existingAttachments = attachmentSchema.array().max(8).parse(priorFields?.attachments ?? []);
      const id = composer ? composer.path.slice("messages/".length, -3) : crypto.randomUUID();
      const key = `${room}/messages/${id}.md`;
      const newFiles = files.filter(file => !existingAttachments.some(held => held.path === this.uploadReceipts.get(file)?.get(key)?.path));
      if (existingAttachments.length + newFiles.length > 8) throw new Error("Attach at most eight files, including files already in this draft.");
      const fields: Record<string, unknown> = {
        ...(priorFields ?? { id, chat: "../chats/main.md", text, created_at: new Date().toISOString(), kind: "text", attachments: [] }),
        ...(reply ? { reply: `./${reply.id}.md` } : {}),
      };
      // Validate business-field shapes before uploading. The content-or-file
      // refinement waits until the selected files have acknowledged references.
      for (const [name, schema] of Object.entries(messageSchema.shape)) schema.parse(fields[name]);
      try {
        if (files.length && !composer) {
          // File-only Send needs a real native draft before the first upload.
          // A later uncertain file must never erase earlier acknowledged refs.
          composer = new DraftSession(this.md!, room, `messages/${id}.md`);
          this.composerSessions.set(room, composer);
          prepared = await composer.stage({ creation: { type: "messenger_message", fields, sections: {} } });
        } else if (composer && prepared && priorCreation && "fields" in priorCreation && reply) {
          prepared = await composer.stage(() => ({ creation: { ...priorCreation, fields } }), prepared.revision);
        }
        let revision = prepared?.revision;
        let changedDuringUpload = false;
        const acknowledged: Attachment[] = [];
        for (const file of files) {
          let attachment: Attachment;
          try {
            attachment = this.uploadReceipts.get(file)?.get(key) ?? await uploadAttachment(this.md!, room, file);
            const receipts = this.uploadReceipts.get(file) ?? new Map<string, Attachment>();
            receipts.set(key, attachment);
            this.uploadReceipts.set(file, receipts);
          }
          catch (error) {
            const detail = `File upload outcome needs review. Acknowledged files remain in the native draft; do not resend automatically. ${errorText(error)}`;
            this.outcome(key, { status: "uncertain", details: detail });
            this.fail(detail);
            throw new DraftSaveUncertainError(error);
          }
          acknowledged.push(attachment);
          try {
            prepared = await composer!.stage(current => {
              const creation = current?.parts.creation;
              if (!current || !creation || !("fields" in creation)) throw new DraftChangedError();
              if (current.revision !== revision) changedDuringUpload = true;
              const attached = attachmentSchema.array().parse(creation.fields.attachments);
              const merged = [...attached, ...acknowledged.filter(item => !attached.some(held => held.path === item.path))];
              return { creation: { ...creation, fields: { ...creation.fields, attachments: merged, kind: merged.length === 1 && merged[0].mime.startsWith("audio/") ? "voice" : "file" } } };
            });
          } catch (error) {
            const receiptEvidence = acknowledged.map(item => `${item.name} (${item.path})`).join(", ");
            if (!(error instanceof DraftChangedError)) throw new DraftSaveUncertainError(`Acknowledged files could not be added to the native draft. Their references remain in this open App only: ${receiptEvidence}. ${errorText(error)}`);
            // Preserve acknowledgements only on the same business path. If a
            // tab already saved it, attachments become native field edits with
            // their first bases from the currently held message document.
            const documents = await this.md!.query({ ...query, rooms: [room] });
            const saved = documents.documents.find(document => document.path === composer!.path && document.type === "messenger_message");
            if (!saved) throw new DraftSaveUncertainError(`The original message path ${composer!.path} is no longer available. Acknowledged file references are retained in this open App only: ${receiptEvidence}. No replacement draft was created. Review these receipts in House before retrying.`);
            const original = messageSchema.parse(saved.fields);
            prepared = await composer!.stage(current => {
              if (current?.parts.creation || current?.parts.markdown || current?.parts.move || current?.parts.removal) throw new DraftSaveUncertainError(`The original message has an incompatible whole-document draft. Acknowledged references remain in this open App only: ${receiptEvidence}. Review in House before retrying.`);
              const attached = attachmentSchema.array().parse(current?.parts.fields?.attachments?.value ?? original.attachments);
              const merged = [...attached, ...acknowledged.filter(item => !attached.some(held => held.path === item.path))];
              return { fields: {
                attachments: { base: { value: original.attachments }, value: merged },
                kind: { base: { value: original.kind }, value: merged.length === 1 && merged[0].mime.startsWith("audio/") ? "voice" : "file" },
              } };
            });
            this.messageSessions.set(key, composer!);
            for (const selected of files) if (this.uploadReceipts.get(selected)?.has(key)) this.retainedMessageFiles.set(selected, { room, path: composer!.path });
            if (this.composerSessions.get(room) === composer) this.composerSessions.delete(room);
            const changed = new DraftChangedError();
            changed.message = "The original message was saved while its file uploaded. Acknowledged files are preserved as native attachment edits on that same message path. Open its editor, review the files and choose Save changes.";
            throw changed;
          }
          revision = prepared?.revision;
          const creation = prepared?.parts.creation;
          if (!creation || !("fields" in creation) || creation.fields.text !== fields.text || creation.fields.reply !== fields.reply) changedDuringUpload = true;
        }
        if (changedDuringUpload) throw new DraftChangedError();
        if (this.disposed || !this.ready || !this.rooms.has(room) || this.blockingError) throw new Error(this.blockingError ?? "Room bindings changed. Your draft is preserved.");
        if (composer && prepared) {
          const creation = prepared.parts.creation;
          if (!creation || !("fields" in creation)) throw new DraftChangedError();
          messageSchema.parse(creation.fields);
          const batchId = await composer.commit(prepared.revision);
          if (batchId) this.outcome(key, { status: "waiting", batchId, details: "Queued locally; waiting for House." });
          if (!composer.current() && this.composerSessions.get(room) === composer) this.composerSessions.delete(room);
          this.read(await this.md!.query({ ...query, rooms: [...this.rooms.keys()] }));
        } else {
          messageSchema.parse(fields);
          await this.create(room, `messages/${id}.md`, "messenger_message", fields);
        }
      } catch (error) {
        this.recordSaveFailure(key, error);
        if (!(error instanceof DraftChangedError) && !(error instanceof DraftSaveError)) this.fail("Message save needs review in House before another send. The composer is preserved. " + errorText(error));
        throw error;
      }
    })().finally(() => {
      this.emit({ busy: false });
      this.refreshComposers();
      this.refreshMessageDrafts();
    });
    // Later local typing waits for this exact Send. If it succeeds it creates a
    // new path; if refused it remains on the preserved native draft.
    this.composerWork.set(room, work);
    return work;
  }
  async initialize(room: string, title: string) {
    await this.start();
    if (this.state.chats.some((c) => c.room === room))
      throw new Error("This Room already has a chat.");
    const fields = chatSchema.parse({
      id: crypto.randomUUID(),
      title,
      mode: "room",
      created_at: new Date().toISOString(),
    });
    await this.create(room, "chats/main.md", "messenger_chat", fields);
  }
}
