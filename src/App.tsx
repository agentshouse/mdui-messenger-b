import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  MessageCircle,
  Moon,
  Phone,
  Search,
  Sun,
  Video,
  X,
} from "lucide-react";
import { ChatHeader, ConversationItem } from "./chatcn/layouts";
import { ChatComposer, ChatMessages, type ThreadMessage } from "./chatcn/chat";
import { Button } from "./components/ui/button";
import { Attachment } from "./components/Attachment";
import { CallWorkspace } from "./components/CallWorkspace";
import { HouseMessengerStore } from "./data/house";
import { type Store, type Message } from "./data/model";
import { VoiceCapture } from "./call/voiceCapture";
import "./chatcn/chat.css";
const productionStore = new HouseMessengerStore();
export function App({ store = productionStore }: { store?: Store }) {
  const state = useSyncExternalStore(store.subscribe, store.snapshot),
    [room, setRoom] = useState<string | null>(null),
    [filter, setFilter] = useState(""),
    [search, setSearch] = useState(""),
    [dark, setDark] = useState(
      () =>
        window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
    ),
    [callOpen, setCallOpen] = useState(false),
    [notice, setNotice] = useState(""),
    [editing, setEditing] = useState<string | null>(null),
    [recording, setRecording] = useState(false),
    [startingVoice, setStartingVoice] = useState(false);
  const [drafts, setDrafts] = useState<
    Record<string, { text: string; reply?: Message; files: File[] }>
  >({});
  const capture = useRef<VoiceCapture | null>(null),
    sendLock = useRef(false),
    mounted = useRef(true),
    voiceRoom = useRef<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    void store.start();
    return () => {
      mounted.current = false;
      capture.current?.cancel();
      store.dispose();
    };
  }, [store]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    return () => document.documentElement.classList.remove("dark");
  }, [dark]);
  const selected = state.chats.find((c) => c.room === room),
    shared = room ? state.composerDrafts?.[room] : undefined,
    draft = room
      ? {
          ...(drafts[room] ?? { text: "", files: [] }),
          ...(shared
            ? {
                text: shared.text,
                reply: state.messages.find(
                  (message) =>
                    message.room === room &&
                    `./${message.id}.md` === shared.reply,
                ),
              }
            : {}),
        }
      : { text: "", files: [] };
  const messages = useMemo(
    () =>
      state.messages
        .filter(
          (m) =>
            m.room === room &&
            (!search ||
              m.text.toLocaleLowerCase().includes(search.toLocaleLowerCase())),
        )
        .slice()
        .reverse(),
    [state.messages, room, search],
  );
  const setDraft = (change: Partial<typeof draft>) => {
    if (!room) return;
    const next = { ...draft, ...change };
    setDrafts((old) => ({ ...old, [room]: next }));
    if (
      store.writeComposer &&
      (Object.hasOwn(change, "text") || Object.hasOwn(change, "reply"))
    ) {
      void store
        .writeComposer(
          room,
          next.text,
          Object.hasOwn(change, "reply") ? (next.reply ?? null) : undefined,
        )
        .catch((error) => {
          if (mounted.current)
            setNotice(error instanceof Error ? error.message : String(error));
        });
    }
  };
  const select = (next: string | null) => {
    capture.current?.cancel();
    capture.current = null;
    setRecording(false);
    setStartingVoice(false);
    voiceRoom.current = null;
    setRoom(next);
    setSearch("");
    setNotice("");
    setEditing(null);
  };
  const submit = async () => {
    if (
      !room ||
      !selected ||
      state.error ||
      (state.halted && draft.files.length > 0) ||
      state.busy ||
      recording ||
      startingVoice ||
      sendLock.current
    )
      return;
    const target = room;
    const opened = draft;
    if (
      !opened.text.trim() &&
      !opened.files.length &&
      !shared?.attachments.length
    )
      return;
    sendLock.current = true;
    setNotice("");
    try {
      await store.send(target, opened.text, opened.reply, opened.files);
      if (mounted.current)
        setDrafts((old) => ({
          ...old,
          [target]:
            old[target]?.text === opened.text &&
            old[target]?.files === opened.files &&
            old[target]?.reply === opened.reply
              ? { text: "", files: [] }
              : old[target],
        }));
    } catch (e) {
      if (mounted.current)
        setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      sendLock.current = false;
    }
  };
  const toggleVoice = async () => {
    if (!room || state.busy) return;
    if (recording) {
      const current = capture.current;
      const target = room;
      try {
        const file = await current!.stop();
        if (
          mounted.current &&
          capture.current === current &&
          voiceRoom.current === target
        )
          setDrafts((old) => ({
            ...old,
            [target]: {
              ...(old[target] ?? { text: "", files: [] }),
              files: [...(old[target]?.files ?? []), file],
            },
          }));
      } catch (e) {
        if (mounted.current && capture.current === current)
          setNotice(e instanceof Error ? e.message : String(e));
      } finally {
        if (capture.current === current) {
          setRecording(false);
          capture.current = null;
        }
      }
      return;
    }
    setNotice("");
    setStartingVoice(true);
    voiceRoom.current = room;
    const recorder = new VoiceCapture();
    capture.current = recorder;
    try {
      await recorder.start();
      if (
        mounted.current &&
        capture.current === recorder &&
        voiceRoom.current === room
      )
        setRecording(true);
    } catch (e) {
      if (mounted.current && capture.current === recorder)
        setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current && capture.current === recorder)
        setStartingVoice(false);
    }
  };
  const parts = state.callParts.filter((p) => p.room === room);
  const threadMessage = (message: Message): ThreadMessage => {
    const replied = message.reply
      ? state.messages.find(
          (item) =>
            item.room === message.room &&
            item.path === `messages/${message.reply!.slice(2)}`,
        )
      : undefined;
    const outcome = state.messageOutcomes?.[`${message.room}/${message.path}`];
    return {
      id: message.id,
      senderId: message.author?.id ?? null,
      senderName: message.author?.name ?? "Author unavailable",
      text: message.text,
      timestamp: message.created_at,
      replyTo: replied
        ? {
            id: replied.id,
            senderName: replied.author?.name ?? "Author unavailable",
            text: replied.text || "Attachment",
          }
        : undefined,
      attachmentContent: message.attachments.map((file) => (
        <Attachment key={file.attachment_ref} file={file} room={message.room} />
      )),
      outcome: outcome ? (
        <span
          className={`message-outcome outcome-${outcome.status}`}
          title={outcome.details}
        >
          {outcome.details}
        </span>
      ) : undefined,
    };
  };
  const composerOutcome =
    room && shared?.path
      ? state.messageOutcomes?.[`${room}/${shared.path}`]
      : undefined;
  const editingMessage = state.messages.find(
    (item) => item.room === room && item.id === editing,
  );
  const edited = editingMessage
    ? state.messageDrafts?.[`${editingMessage.room}/${editingMessage.path}`]
    : undefined;
  const showError = (error: unknown) => {
    if (mounted.current)
      setNotice(error instanceof Error ? error.message : String(error));
  };
  return (
    <div
      className={dark ? "dark messenger-app" : "messenger-app"}
      data-chat-theme={dark ? "midnight" : "aurora"}
    >
      <div className="messenger-shell flex min-h-0 bg-[var(--chat-bg-app)] shadow-[var(--chat-shadow-lg)]">
        <aside
          className={`chat-list flex flex-col border-r border-[var(--chat-border-strong)] bg-[var(--chat-bg-sidebar)] min-h-0 ${room ? "mobile-hidden" : ""}`}
          aria-label="Chats"
        >
          <div className="flex items-center justify-between px-4 py-4">
            <h1 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
              <MessageCircle className="size-5 text-[var(--chat-accent)]" />
              Messenger
            </h1>
            <button
              className="chat-icon-button"
              aria-label={dark ? "Use light theme" : "Use dark theme"}
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          </div>
          <div className="px-3 pb-2">
            <div className="flex items-center gap-2 rounded-[10px] bg-[var(--chat-bg-main)] px-3 py-2">
              <Search className="size-3.5 text-[var(--chat-text-secondary)]" />
              <input
                aria-label="Find a chat"
                placeholder="Search conversations"
                className="min-w-0 w-full bg-transparent text-[14px] outline-none placeholder:text-[var(--chat-text-tertiary)]"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {state.chats
              .filter((chat) =>
                chat.title
                  .toLocaleLowerCase()
                  .includes(filter.toLocaleLowerCase()),
              )
              .map((chat) => {
                const latest = state.messages.find(
                  (message) => message.room === chat.room,
                );
                return (
                  <ConversationItem
                    key={chat.room}
                    convo={{
                      id: chat.room,
                      title: chat.title,
                      lastMessage: state.composerDrafts?.[chat.room]?.text
                        ? `Draft: ${state.composerDrafts[chat.room].text}`
                        : latest?.text ||
                          `${chat.mode === "direct" ? "Direct" : chat.mode === "group" ? "Group" : "Room"} chat`,
                      lastMessageTime: latest
                        ? new Date(latest.created_at).toLocaleDateString([], {
                            month: "short",
                            day: "numeric",
                          })
                        : undefined,
                    }}
                    isActive={room === chat.room}
                    onClick={() => select(chat.room)}
                  />
                );
              })}
            {!state.loading && !state.chats.length && (
              <p className="p-4 text-sm text-[var(--chat-text-secondary)]">
                No Room chats yet. Bind a Room containing a Messenger chat in
                House.
              </p>
            )}
            {!!state.chats.length &&
              !state.chats.some((chat) =>
                chat.title
                  .toLocaleLowerCase()
                  .includes(filter.toLocaleLowerCase()),
              ) && (
                <p className="p-4 text-sm text-[var(--chat-text-secondary)]">
                  No matching conversations.
                </p>
              )}
          </div>
          <div className="border-t border-[var(--chat-border)] p-3 text-xs text-[var(--chat-text-secondary)]">
            {state.loading && <p role="status">Loading messages…</p>}
            {state.sync && <p role="alert">{state.sync}</p>}
            {state.halted && (
              <p role="alert">
                House writes are paused. Text messages still queue locally;
                attachment uploads wait for writes to reopen.
              </p>
            )}
            <a
              className="underline inline-block mt-1"
              href="./THIRD_PARTY_NOTICES.txt"
              target="_blank"
              rel="noreferrer"
            >
              Licenses
            </a>
          </div>
        </aside>
        <main
          className={`chat-main bg-[var(--chat-bg-main)] ${!room ? "mobile-hidden" : ""}`}
        >
          {state.error && (
            <div role="alert" className="border-b p-3 text-sm text-destructive">
              {state.error}
            </div>
          )}
          {!selected ? (
            <div className="empty-chat">
              <div className="empty-chat-icon">
                <MessageCircle className="size-8" />
              </div>
              <h2 className="mt-4 text-lg font-semibold">Your conversations</h2>
              <p className="mt-2 max-w-xs text-sm text-[var(--chat-text-secondary)]">
                Choose a chat to read messages, reply or share a voice note.
              </p>
            </div>
          ) : (
            <div data-slot="chat" className="flex h-full min-h-0 flex-col">
              <ChatHeader
                title={selected.title}
                subtitle={
                  selected.mode === "direct"
                    ? "Direct chat"
                    : selected.mode === "group"
                      ? "Group chat"
                      : "Room chat"
                }
                avatar={
                  <>
                    <button
                      aria-label="Back to chats"
                      className="mobile-back chat-icon-button"
                      onClick={() => select(null)}
                    >
                      <span aria-hidden="true">‹</span>
                    </button>
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--chat-bubble-incoming)] text-sm font-semibold">
                      {selected.title.charAt(0).toUpperCase()}
                    </div>
                  </>
                }
                actions={
                  <div className="flex items-center gap-1">
                    <button
                      className="chat-icon-button"
                      aria-label="Audio call"
                      onClick={() => setCallOpen(true)}
                    >
                      <Phone className="size-4" />
                    </button>
                    <button
                      className="chat-icon-button"
                      aria-label="Video call"
                      onClick={() => setCallOpen(true)}
                    >
                      <Video className="size-4" />
                    </button>
                  </div>
                }
              />
              <div className="flex items-center gap-2 border-b border-[var(--chat-border)] px-4 py-2">
                <Search className="size-3.5 text-[var(--chat-text-secondary)]" />
                <input
                  aria-label="Search messages"
                  placeholder="Search this chat…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--chat-text-tertiary)]"
                />
              </div>
              <ChatMessages
                key={room}
                messages={messages.map(threadMessage)}
                empty={
                  search
                    ? "No matching messages."
                    : "No messages in this Room yet."
                }
                onReply={(item) => {
                  const original = messages.find(
                    (message) => message.id === item.id,
                  );
                  if (original) setDraft({ reply: original });
                }}
                onEdit={
                  store.writeMessage && store.saveMessage
                    ? (item) => setEditing(item.id)
                    : undefined
                }
              />
              {editingMessage && (
                <section
                  className="message-editor border-t border-[var(--chat-border)] bg-[var(--chat-bg-sidebar)] p-3"
                  aria-label="Edit message"
                >
                  <div className="mb-2 flex items-center justify-between text-sm font-semibold">
                    <span>Edit message</span>
                    <button
                      aria-label="Close message editor"
                      className="chat-icon-button"
                      onClick={() => setEditing(null)}
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                  <textarea
                    aria-label="Edit message text"
                    className="w-full min-h-20 rounded-lg border border-[var(--chat-border-strong)] bg-[var(--chat-bg-main)] p-3 text-sm"
                    value={edited?.text ?? editingMessage.text}
                    onChange={(event) =>
                      void store
                        .writeMessage?.(editingMessage, event.target.value)
                        .catch(showError)
                    }
                  />
                  {!!edited?.attachments?.length && (
                    <p className="mt-2 text-xs text-[var(--chat-text-secondary)]">
                      Files retained in this message draft:{" "}
                      {edited.attachments.map((file) => file.name).join(", ")}
                    </p>
                  )}
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <p className="text-xs text-[var(--chat-text-secondary)]">
                      Edits stay in this message’s local draft until Save.
                    </p>
                    <Button
                      size="sm"
                      disabled={state.busy || !!state.error || !edited}
                      onClick={() =>
                        void store
                          .saveMessage?.(editingMessage)
                          .catch(showError)
                      }
                    >
                      Save changes
                    </Button>
                  </div>
                </section>
              )}
              {parts.length > 0 && (
                <details className="border-t border-[var(--chat-border)] px-4 py-2 text-sm">
                  <summary className="cursor-pointer">
                    Recorded call parts ({parts.length})
                  </summary>
                  <div className="max-h-60 overflow-auto space-y-3 pt-2">
                    {parts.map((part) => (
                      <article key={part.id}>
                        <strong>Part {part.part}</strong> ·{" "}
                        {Math.round(part.duration_ms / 1000)} seconds ·{" "}
                        {part.participants
                          .map((person) => person.name)
                          .join(" and ")}
                        {part.files.map((file) => (
                          <Attachment
                            key={file.speaker_id}
                            file={file}
                            room={part.room}
                          />
                        ))}
                      </article>
                    ))}
                  </div>
                </details>
              )}
              {notice && (
                <p className="px-4 py-2 text-sm text-destructive" role="alert">
                  {notice}
                </p>
              )}
              <ChatComposer
                value={draft.text}
                onChange={(text) => setDraft({ text })}
                onSend={() => void submit()}
                files={draft.files}
                onFiles={(files) =>
                  setDraft({
                    files: [...draft.files, ...files].slice(
                      0,
                      8 - (shared?.attachments.length ?? 0),
                    ),
                  })
                }
                onRemoveFile={(index) =>
                  setDraft({ files: draft.files.filter((_, i) => i !== index) })
                }
                hasAttachments={!!shared?.attachments.length}
                replyingTo={
                  draft.reply ? threadMessage(draft.reply) : undefined
                }
                onCancelReply={() => setDraft({ reply: undefined })}
                onVoiceRecord={() => void toggleVoice()}
                recording={recording}
                voiceDisabled={
                  state.busy ||
                  startingVoice ||
                  draft.files.length + (shared?.attachments.length ?? 0) >= 8
                }
                sendDisabled={
                  state.busy ||
                  (state.halted && draft.files.length > 0) ||
                  !!state.error ||
                  recording ||
                  startingVoice
                }
              >
                {composerOutcome && composerOutcome.status !== "draft" && (
                  <p
                    className="px-4 py-2 text-xs text-[var(--chat-red)]"
                    role="alert"
                  >
                    {composerOutcome.details}
                  </p>
                )}
                {(state.availableDrafts?.filter((item) => item.room === room)
                  .length ?? 0) > 1 && (
                  <div className="px-4 py-2">
                    <select
                      aria-label="Local message drafts"
                      className="w-full max-w-full bg-[var(--chat-bg-sidebar)] text-sm"
                      value={shared?.path ?? ""}
                      disabled={state.busy || draft.files.length > 0}
                      onChange={(event) => {
                        if (room)
                          store.selectComposer?.(room, event.target.value);
                      }}
                    >
                      {state.availableDrafts
                        ?.filter((item) => item.room === room)
                        .map((item) => (
                          <option key={item.path} value={item.path}>
                            {item.text.slice(0, 60) || "Empty message draft"}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
                {!!shared?.attachments.length && (
                  <p className="px-4 py-2 text-xs">
                    Files kept in this local message draft:{" "}
                    {shared.attachments.map((file) => file.name).join(", ")}
                  </p>
                )}
                {(recording || startingVoice) && (
                  <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs">
                    <span>
                      {startingVoice
                        ? "Waiting for microphone permission…"
                        : "Recording locally, up to 60 seconds. Stop to review; Send uploads it."}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        capture.current?.cancel();
                        capture.current = null;
                        setRecording(false);
                        setStartingVoice(false);
                        voiceRoom.current = null;
                      }}
                    >
                      Discard recording
                    </Button>
                  </div>
                )}
              </ChatComposer>
            </div>
          )}
        </main>
      </div>
      <CallWorkspace
        rooms={state.chats}
        preferredRoom={room}
        open={callOpen}
        onOpenChange={setCallOpen}
      />
    </div>
  );
}
