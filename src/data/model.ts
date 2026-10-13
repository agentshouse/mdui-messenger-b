import { z } from "zod";
import type { RoomDraft } from "./draft-session";
const id = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
export const attachmentSchema = z.object({
  path: z.string().regex(/^files\/[a-zA-Z0-9_-]+$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().min(1).max(200),
  mime: z.string().max(100),
  bytes: z.number().int().nonnegative(),
});
export const chatSchema = z.object({
  id,
  title: z.string().trim().min(1).max(200),
  mode: z.enum(["room", "direct", "group"]),
  created_at: timestamp,
});
export const messageSchema = z
  .object({
    id,
    chat: z.literal("../chats/main.md"),
    text: z.string().max(50000),
    created_at: timestamp,
    kind: z.enum(["text", "voice", "file"]),
    reply: z
      .string()
      .regex(/^\.\/[0-9a-f-]{36}\.md$/)
      .optional(),
    attachments: z.array(attachmentSchema).max(8),
  })
  .refine(
    (x) => x.text.trim().length > 0 || x.attachments.length > 0,
    "A message must contain text or a file",
  );
const participant = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
});
export const callSchema = z.object({
  id,
  wire_call_id: id,
  chat: z.literal("../chats/main.md"),
  started_at: timestamp,
  participants: z.array(participant).length(2),
});
export const callPartSchema = z.object({
  id: z.string().regex(/^[0-9a-f-]{36}-part-[1-9][0-9]*$/),
  wire_call_id: id,
  call: z.string().regex(/^\.\.\/calls\/[0-9a-f-]{36}\.md$/),
  call_id: id,
  part: z.number().int().positive(),
  start: timestamp,
  start_offset_ms: z.number().nonnegative(),
  duration_ms: z.number().nonnegative(),
  participants: z.array(participant).length(2),
  files: z
    .array(attachmentSchema.extend({ speaker_id: z.string().min(1).max(200) }))
    .length(2),
});
export type ChatFields = z.infer<typeof chatSchema>;
export type MessageFields = z.infer<typeof messageSchema>;
export type CallPartFields = z.infer<typeof callPartSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type Author = { kind: string; id: string; name: string | null } | null;
export type Chat = ChatFields & {
  room: string;
  roomName: string;
  path: string;
};
export type Message = MessageFields & {
  room: string;
  path: string;
  author: Author;
};
export type CallPart = CallPartFields & { room: string; path: string };
export type ComposerDraft = {
  room: string; path: string; id: string; text: string; reply?: string;
  created_at: string; attachments: Attachment[];
};
export type MessageDraft = {
  room: string; path: string; text: string; revision?: string; draft?: RoomDraft; attachments?: Attachment[];
};
export type MessageOutcome = {
  status: "draft" | "waiting" | "submitted" | "retrying" | "accepted" | "confirmed" | "rejected" | "conflicted" | "expired" | "withdrawn" | "changed-underneath" | "invalid" | "uncertain";
  details: string;
  batchId?: string;
  returned?: RoomDraft["returned"];
};
export type Snapshot = {
  composerDrafts?: Record<string, ComposerDraft>;
  availableDrafts?: ComposerDraft[];
  messageDrafts?: Record<string, MessageDraft>;
  messageOutcomes?: Record<string, MessageOutcome>;
  chats: Chat[];
  messages: Message[];
  callParts: CallPart[];
  loading: boolean;
  error: string | null;
  sync: string;
  busy: boolean;
  halted: boolean;
};
export type Store = {
  writeMessage?(message: Message, text: string): Promise<void>;
  saveMessage?(message: Message): Promise<void>;
  writeComposer?(room: string, text: string, reply?: Message | null): Promise<void>;
  selectComposer?(room: string, path: string): void;
  start(): Promise<void>;
  dispose(): void;
  subscribe(listener: () => void): () => void;
  snapshot(): Snapshot;
  send(
    room: string,
    text: string,
    reply?: Message,
    files?: File[],
  ): Promise<void>;
  initialize(room: string, title: string): Promise<void>;
};
