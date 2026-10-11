// Adapted from chatcn a7be5c3aedebed3441594ce8f532acc168c1628c. MIT, 2025 chatcn contributors.
import type * as React from "react";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatHeaderProps {
  title: string;
  subtitle?: string;
  avatar?: React.ReactNode;
  actions?: React.ReactNode;
  onBack?: () => void;
  className?: string;
}

function ChatHeader({
  title,
  subtitle,
  avatar,
  actions,
  onBack,
  className,
}: ChatHeaderProps) {
  return (
    <header
      data-slot="chat-header"
      className={cn(
        "sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--chat-border)] bg-[var(--chat-bg-header)] px-4 py-3 backdrop-blur-[20px] backdrop-saturate-[180%]",
        className,
      )}
    >
      {onBack && (
        <button
          onClick={onBack}
          aria-label="Back to chats"
          className="mr-1 text-[var(--chat-text-secondary)] hover:text-[var(--chat-text-primary)]"
        >
          <ChevronLeft className="size-5" />
        </button>
      )}
      {avatar}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-semibold tracking-[-0.02em] text-[var(--chat-text-primary)]">
          {title}
        </span>
        {subtitle && (
          <span className="truncate text-[12px] text-[var(--chat-text-secondary)]">
            {subtitle}
          </span>
        )}
      </div>
      {actions}
    </header>
  );
}

// ─── Shared: Sidebar conversation item ────────────────────────────────────────

interface SidebarConversation {
  id: string;
  title: string;
  lastMessage?: string;
  lastMessageTime?: string;
  isGroup?: boolean;
}

function ConversationItem({
  convo,
  isActive,
  onClick,
}: {
  convo: SidebarConversation;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={`Open ${convo.title} chat`}
      aria-current={isActive ? "true" : undefined}
      className={cn(
        "mx-1 flex w-[calc(100%-8px)] items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
        isActive
          ? "bg-[var(--chat-accent-soft)]"
          : "hover:bg-[var(--chat-accent-soft)]",
      )}
    >
      <div className="relative shrink-0">
        <div className="flex size-11 items-center justify-center rounded-full bg-[var(--chat-bubble-incoming)] text-[13px] font-semibold text-[var(--chat-text-secondary)]">
          {convo.title.charAt(0).toUpperCase()}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <span className="truncate text-[15px] font-semibold text-[var(--chat-text-primary)]">
            {convo.title}
          </span>
          {convo.lastMessageTime && (
            <span className="ml-2 shrink-0 text-[11px] text-[var(--chat-text-tertiary)]">
              {convo.lastMessageTime}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className="truncate text-[13px] text-[var(--chat-text-secondary)]">
            {convo.lastMessage}
          </span>
        </div>
      </div>
    </button>
  );
}

export { ChatHeader, ConversationItem };
