import type { HouseBridge } from "@agentshouse/app-bridge";

export type NavigationBridge = Pick<HouseBridge, "address" | "onAddress" | "push">;
export type ChatRoute = { room: string | null; ready: boolean; error: string | null };
const roomPattern = /^[a-zA-Z0-9_.-]{1,256}$/;
export function chatAddress(room: string | null): string {
  if (room === null) return "/chats";
  if (!roomPattern.test(room)) throw new Error("Invalid chat address.");
  return `/chats?room=${encodeURIComponent(room)}`;
}
export function readChatAddress(address: string | null): ChatRoute {
  if (address === null) return { room: null, ready: false, error: null };
  try {
    if (address.length > 1000 || [...address].some(c => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127) || !/^\/(?:chats)?(?:\?|$)/.test(address)) throw new Error();
    const url = new URL(address, "https://app.invalid");
    if (url.origin !== "https://app.invalid" || url.hash || !["/", "/chats"].includes(url.pathname)) throw new Error();
    const keys = [...url.searchParams.keys()];
    if (keys.some(key => key !== "room") || url.searchParams.getAll("room").length > 1) throw new Error();
    const room = url.searchParams.get("room");
    if (room !== null && !roomPattern.test(room)) throw new Error();
    return { room, ready: true, error: null };
  } catch {
    return { room: null, ready: true, error: "This chat link is invalid. Choose a conversation from the list." };
  }
}

/** House owns history. Serial requests coalesce rapid clicks, while host events
 * never echo a navigation or write Room data. Stale failures cannot replace a
 * later host selection. No runtime/data loading is needed to retain a deep link. */
export class ChatNavigation {
  private state: ChatRoute;
  private listeners = new Set<() => void>();
  private close?: () => void;
  private sequence = 0;
  private active: { address: string; sequence: number } | null = null;
  private queued: { address: string; sequence: number } | null = null;
  constructor(private bridge: NavigationBridge) { this.state = readChatAddress(bridge.address()); }
  snapshot = () => this.state;
  private update(next: ChatRoute) {
    if (next.room === this.state.room && next.ready === this.state.ready && next.error === this.state.error) return;
    this.state = next;
    this.listeners.forEach(listener => listener());
  }
  private receive = (address: string) => {
    if (this.active && address !== this.active.address) {
      this.sequence++;
      this.queued = null;
    }
    this.update(readChatAddress(address));
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (!this.close) {
      this.close = this.bridge.onAddress(this.receive);
      const current = this.bridge.address();
      if (current !== null) this.receive(current);
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.close?.();
        this.close = undefined;
        this.active = null;
        this.sequence++;
        this.queued = null;
      }
    };
  };
  navigate(room: string | null) {
    let address: string;
    try { address = chatAddress(room); }
    catch { this.update({ ...this.state, error: "Invalid chat address." }); return; }
    if (!this.active && this.state.ready && this.state.room === room && !this.state.error) return;
    this.queued = { address, sequence: ++this.sequence };
    this.drain();
  }
  private drain() {
    if (this.active || !this.queued || !this.listeners.size) return;
    const request = this.queued;
    this.queued = null;
    this.active = request;
    void this.bridge.push(request.address).then(address => {
      if (request.sequence === this.sequence && this.listeners.size) this.update(readChatAddress(address));
    }).catch(error => {
      if (request.sequence === this.sequence && this.listeners.size) {
        this.update({ ...this.state, error: error instanceof Error ? error.message : "House refused navigation." });
      }
    }).finally(() => {
      if (this.active === request) {
        this.active = null;
        this.drain();
      }
    });
  }
}
