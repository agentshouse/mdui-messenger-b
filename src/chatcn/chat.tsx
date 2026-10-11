// Adapted from chatcn a7be5c3aedebed3441594ce8f532acc168c1628c.
// MIT, Copyright (c) 2025 chatcn contributors. See licenses/chatcn-MIT.txt.
// House supplies data, author attribution, attachments and outcomes. No donor
// delivery timer, current-user guess, external media or receipt is retained.
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUp,
  ChevronDown,
  Mic,
  Paperclip,
  Pencil,
  Plus,
  Reply,
  Square,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ThreadMessage = {
  id: string;
  senderId: string | null;
  senderName: string;
  text: string;
  timestamp: string;
  attachmentContent?: ReactNode;
  outcome?: ReactNode;
  replyTo?: { id: string; senderName: string; text: string };
};

function getBubbleRadius(position: "solo" | "first" | "middle" | "last") {
  switch (position) {
    case "solo":
    case "first":
      return "rounded-[18px_18px_18px_4px]";
    case "middle":
      return "rounded-[4px_18px_18px_4px]";
    case "last":
      return "rounded-[4px_18px_18px_18px]";
  }
}

export function ChatDateSeparator({ label }: { label: string }) {
  return (
    <div className="chat-date-separator my-6 flex items-center gap-4">
      <div className="h-px flex-1 bg-[var(--chat-border)]" />
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--chat-text-tertiary)]">
        {label}
      </span>
      <div className="h-px flex-1 bg-[var(--chat-border)]" />
    </div>
  );
}

export function ChatMessageReply({
  replyTo,
}: {
  replyTo: NonNullable<ThreadMessage["replyTo"]>;
}) {
  return (
    <button
      type="button"
      onClick={() =>
        document
          .getElementById(`message-${replyTo.id}`)
          ?.scrollIntoView?.({ block: "center", behavior: "smooth" })
      }
      className="mb-1.5 flex w-full items-start gap-2 rounded-lg border-l-2 border-[var(--chat-accent)] bg-[var(--chat-accent-soft)] px-2.5 py-1.5 text-left"
      aria-label={`Show replied message: ${replyTo.text}`}
    >
      <div className="min-w-0 flex-1">
        <span className="block text-[12px] font-semibold text-[var(--chat-accent)]">
          {replyTo.senderName}
        </span>
        <span className="block truncate text-[12px] text-[var(--chat-text-secondary)]">
          {replyTo.text}
        </span>
      </div>
    </button>
  );
}

export function ChatMessage({
  message,
  position,
  onReply,
  onEdit,
}: {
  message: ThreadMessage;
  position: "solo" | "first" | "middle" | "last";
  onReply: () => void;
  onEdit?: () => void;
}) {
  const showSender = position === "solo" || position === "first";
  const showAvatar = position === "solo" || position === "last";
  return (
    <article
      id={`message-${message.id}`}
      data-slot="chat-event"
      className={cn(
        "chat-message group/message relative flex items-end gap-2 flex-row",
        showSender ? "mt-4" : "mt-0.5",
      )}
    >
      <div className="w-8 shrink-0">
        {showAvatar && (
          <div
            className="flex size-8 items-center justify-center rounded-full bg-[var(--chat-bubble-incoming)] text-[11px] font-semibold text-[var(--chat-text-secondary)]"
            aria-hidden="true"
          >
            {message.senderName.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <div className="chat-message-column flex min-w-0 max-w-[85%] flex-col">
        {showSender && (
          <span
            className="mb-0.5 ml-3 text-[14px] font-semibold leading-tight tracking-[-0.01em] text-[var(--chat-text-secondary)]"
            title={`Last written by ${message.senderName}`}
          >
            {message.senderName}
          </span>
        )}
        <div className="relative">
          <div className="chat-toolbar-enter chat-message-actions absolute -top-3 right-0 z-10 flex items-center gap-0.5 rounded-lg border border-[var(--chat-border-strong)] bg-[var(--chat-bg-sidebar)] p-0.5 shadow-[var(--chat-shadow-toolbar)]">
            <button
              type="button"
              onClick={onReply}
              className="chat-icon-button"
              aria-label={`Reply to message ${message.id}`}
            >
              <Reply className="size-3.5" />
            </button>
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="chat-icon-button"
                aria-label={`Edit message ${message.id}`}
              >
                <Pencil className="size-3.5" />
              </button>
            )}
          </div>
          <div
            className={cn(
              "chat-bubble relative px-3.5 py-2 bg-[var(--chat-bubble-incoming)] text-[var(--chat-bubble-incoming-text)]",
              getBubbleRadius(position),
            )}
          >
            {message.replyTo && <ChatMessageReply replyTo={message.replyTo} />}
            {message.text && (
              <p className="whitespace-pre-wrap break-words text-[15px] leading-[1.45] tracking-[-0.01em]">
                {message.text}
              </p>
            )}
            {message.attachmentContent}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <time
                dateTime={message.timestamp}
                className="text-[11px] tracking-[0.02em] text-[var(--chat-text-secondary)]"
              >
                {new Date(message.timestamp).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </time>
              {message.outcome}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

export function ChatMessages({
  messages,
  onReply,
  onEdit,
  empty,
}: {
  messages: ThreadMessage[];
  onReply: (message: ThreadMessage) => void;
  onEdit?: (message: ThreadMessage) => void;
  empty: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [showScroll, setShowScroll] = useState(false);
  const scrollToBottom = () => {
    const el = containerRef.current;
    el?.scrollTo?.({ top: el.scrollHeight, behavior: "smooth" });
  };
  useEffect(() => {
    if (atBottom.current) scrollToBottom();
  }, [messages.length]);
  const grouped = (a?: ThreadMessage, b?: ThreadMessage) =>
    !!a?.senderId &&
    a.senderId === b?.senderId &&
    new Date(a.timestamp).toDateString() ===
      new Date(b.timestamp).toDateString() &&
    Math.abs(Date.parse(a.timestamp) - Date.parse(b.timestamp)) <= 120_000;
  return (
    <div className="chat-messages relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        ref={containerRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          atBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight <= 100;
          setShowScroll(!atBottom.current);
        }}
        className="flex-1 overflow-y-auto px-4 py-4"
        role="log"
        aria-label="Messages"
        aria-live="polite"
      >
        <div className="mx-auto w-full max-w-3xl">
          {messages.map((message, index) => {
            const before = grouped(messages[index - 1], message),
              after = grouped(message, messages[index + 1]);
            const date = new Date(message.timestamp);
            return (
              <div key={message.id}>
                {(!index ||
                  date.toDateString() !==
                    new Date(messages[index - 1].timestamp).toDateString()) && (
                  <ChatDateSeparator
                    label={date.toLocaleDateString([], {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                  />
                )}
                <ChatMessage
                  message={message}
                  position={
                    before
                      ? after
                        ? "middle"
                        : "last"
                      : after
                        ? "first"
                        : "solo"
                  }
                  onReply={() => onReply(message)}
                  onEdit={onEdit ? () => onEdit(message) : undefined}
                />
              </div>
            );
          })}
          {!messages.length && (
            <p className="p-6 text-center text-sm text-[var(--chat-text-secondary)]">
              {empty}
            </p>
          )}
        </div>
      </div>
      {showScroll && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 z-5 flex size-10 items-center justify-center rounded-full border border-[var(--chat-border-strong)] bg-[var(--chat-bg-main)] shadow-[var(--chat-shadow-md)]"
          aria-label="Scroll to bottom"
        >
          <ChevronDown className="size-[18px] text-[var(--chat-text-secondary)]" />
        </button>
      )}
    </div>
  );
}

export function ChatComposer({
  value,
  onChange,
  onSend,
  disabled,
  sendDisabled,
  hasAttachments,
  files,
  onFiles,
  onRemoveFile,
  replyingTo,
  onCancelReply,
  onVoiceRecord,
  recording,
  voiceDisabled,
  children,
}: {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  disabled?: boolean;
  sendDisabled?: boolean;
  hasAttachments?: boolean;
  files: File[];
  onFiles: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
  replyingTo?: ThreadMessage;
  onCancelReply: () => void;
  onVoiceRecord: () => void;
  recording: boolean;
  voiceDisabled: boolean;
  children?: ReactNode;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null),
    fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setDragging] = useState(false);
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight || 42, 160)}px`;
    }
  }, [value]);
  const hasContent = !!value.trim() || !!files.length || hasAttachments;
  const addFiles = (items: FileList | File[]) => {
    if (!disabled && !voiceDisabled && !recording) onFiles(Array.from(items));
  };
  return (
    <div
      data-slot="chat-toolbar"
      className="chat-composer sticky bottom-0 z-10 relative"
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      {isDragging && (
        <div className="chat-drop-overlay pointer-events-none">
          <span>Drop files to attach; Send uploads them</span>
        </div>
      )}
      {replyingTo && (
        <div className="flex items-center gap-3 border-t border-[var(--chat-border)] bg-[var(--chat-bg-sidebar)] px-4 py-2">
          <div className="h-8 w-0.5 shrink-0 rounded-full bg-[var(--chat-accent)]" />
          <div className="min-w-0 flex-1">
            <span className="block text-[12px] font-semibold text-[var(--chat-accent)]">
              {replyingTo.senderName}
            </span>
            <span className="block truncate text-[13px] text-[var(--chat-text-secondary)]">
              {replyingTo.text || "Attachment"}
            </span>
          </div>
          <button
            className="chat-icon-button"
            aria-label="Cancel reply"
            onClick={onCancelReply}
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
      {files.length > 0 && (
        <div className="flex gap-3 overflow-x-auto border-t border-[var(--chat-border)] bg-[var(--chat-bg-composer)] px-4 pt-3 pb-2">
          {files.map((file, index) => (
            <div
              key={`${file.name}-${index}`}
              className="relative shrink-0 rounded-lg border border-[var(--chat-border-strong)] bg-[var(--chat-bg-sidebar)]"
            >
              <div className="flex items-center gap-2 px-3 py-2">
                <Paperclip className="size-3.5 text-[var(--chat-accent)]" />
                <div className="min-w-0">
                  <p className="max-w-[120px] truncate text-[12px] font-medium">
                    {file.name}
                  </p>
                  <p className="text-[10px] text-[var(--chat-text-secondary)]">
                    {(file.size / 1024).toFixed(0)} KB · unsent
                  </p>
                </div>
                <button
                  className="chat-icon-button"
                  aria-label={`Remove ${file.name}`}
                  disabled={disabled}
                  onClick={() => onRemoveFile(index)}
                >
                  <X className="size-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {children}
      <div className="border-t border-[var(--chat-border)] bg-[var(--chat-bg-composer)] px-3 py-2 backdrop-blur-[20px] backdrop-saturate-[180%]">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-end gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={
                disabled || voiceDisabled || recording || files.length >= 8
              }
              className="chat-attach-button flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--chat-border)] bg-[var(--chat-bg-sidebar)] text-[var(--chat-text-secondary)]"
              aria-label="Attach files"
            >
              <Plus className="size-5" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              aria-label="Choose attachments"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <div className="relative flex min-w-0 flex-1 items-end rounded-[22px] border border-[var(--chat-border)] bg-[var(--chat-bg-sidebar)] focus-within:ring-2 focus-within:ring-[var(--chat-accent)]">
              <textarea
                ref={textareaRef}
                aria-label="Message"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    if (hasContent && !sendDisabled) onSend();
                  }
                  if (e.key === "Escape" && replyingTo) onCancelReply();
                }}
                onPaste={(e) => {
                  const items = Array.from(e.clipboardData.items)
                    .filter((item) => item.kind === "file")
                    .map((item) => item.getAsFile())
                    .filter((file): file is File => file !== null);
                  if (items.length) addFiles(items);
                }}
                placeholder="Message"
                disabled={disabled}
                rows={1}
                className="min-w-0 flex-1 resize-none bg-transparent py-[10px] pl-4 pr-12 text-[15px] leading-[22px] tracking-[-0.01em] text-[var(--chat-text-primary)] placeholder:text-[var(--chat-text-tertiary)] focus:outline-none disabled:opacity-50"
                style={{ maxHeight: 160, overflowY: "auto" }}
              />
              <button
                onClick={onSend}
                disabled={!hasContent || disabled || sendDisabled}
                className={cn(
                  "absolute bottom-[6px] right-[6px] flex size-8 items-center justify-center rounded-full transition-colors",
                  hasContent
                    ? "bg-[var(--chat-accent)] text-white"
                    : "bg-transparent text-[var(--chat-text-tertiary)]",
                )}
                aria-label="Send message"
              >
                <ArrowUp className="size-4" strokeWidth={2.5} />
              </button>
            </div>
            <button
              onClick={onVoiceRecord}
              disabled={disabled || voiceDisabled}
              className="chat-icon-button size-10 shrink-0"
              aria-label={
                recording ? "Stop voice recording" : "Record voice message"
              }
            >
              {recording ? (
                <Square className="size-4" />
              ) : (
                <Mic className="size-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
