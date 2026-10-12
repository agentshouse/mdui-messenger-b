import { describe, expect, it, vi } from "vitest";
import { houseBridge } from "@agentshouse/app-bridge";
import { createHouseBridgeTestHost } from "@agentshouse/app-bridge/test-host";
import { ChatNavigation, chatAddress, readChatAddress, type NavigationBridge } from "../src/navigation";
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function controlled(initial: string | null = null) {
  let current = initial;
  const listeners = new Set<(address: string) => void>();
  const calls: { address: string; resolve: (address: string) => void; reject: (error: Error) => void }[] = [];
  const bridge: NavigationBridge = {
    address: () => current,
    onAddress: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    push: address => new Promise((resolve, reject) => { calls.push({ address, resolve, reject }); }),
  };
  return { bridge, calls, listeners, open(address: string) { current = address; listeners.forEach(listener => listener(address)); } };
}
describe("House chat addressing", () => {
  it("round trips only stable Room identity, never composer data", () => {
    expect(readChatAddress(chatAddress("r_19.z"))).toEqual({ room: "r_19.z", ready: true, error: null });
    expect(readChatAddress("/").room).toBeNull();
    expect(readChatAddress(null).ready).toBe(false);
    for (const address of ["/chats?room=r_one\n", "https://evil.test", "//evil.test", "/chats/../private", "/chats?room=", "/chats?room=a&room=b", "/chats?text=secret", "/chats?room=%2Fprivate", "/chats#message", "/chats?room=%00", "/chats?room=" + "a".repeat(1001)]) expect(readChatAddress(address).error).toBeTruthy();
    expect(() => chatAddress("../private")).toThrow();
  });
  it("subscribes then reads initial state; waits for null without publishing a default", () => {
    const f = controlled(); const nav = new ChatNavigation(f.bridge); const off = nav.subscribe(vi.fn());
    expect(nav.snapshot().ready).toBe(false); expect(f.calls).toHaveLength(0);
    f.open("/chats?room=r_two"); expect(nav.snapshot().room).toBe("r_two"); expect(f.calls).toHaveLength(0);
    off(); expect(f.listeners.size).toBe(0);
    f.open("/chats?room=r_three"); const off2 = nav.subscribe(vi.fn()); expect(nav.snapshot().room).toBe("r_three"); off2();
  });
  it("serializes and coalesces rapid clicks, without echoing acknowledgements", async () => {
    const f = controlled("/chats"); const nav = new ChatNavigation(f.bridge); const off = nav.subscribe(vi.fn());
    nav.navigate("r_one"); nav.navigate("r_two"); nav.navigate("r_three"); expect(f.calls).toHaveLength(1);
    f.open(f.calls[0].address); f.calls[0].resolve(f.calls[0].address); await tick();
    expect(f.calls.map(call => call.address)).toEqual(["/chats?room=r_one", "/chats?room=r_three"]);
    f.open(f.calls[1].address); f.calls[1].resolve(f.calls[1].address); await tick();
    expect(nav.snapshot().room).toBe("r_three"); expect(f.calls).toHaveLength(2); off();
  });
  it("host Back cancels queued clicks and stale refusal cannot steal the view", async () => {
    const f = controlled("/chats?room=r_one"); const nav = new ChatNavigation(f.bridge); const off = nav.subscribe(vi.fn());
    nav.navigate("r_two"); nav.navigate("r_three"); f.open("/chats");
    f.calls[0].reject(new Error("Late refusal")); await tick();
    expect(nav.snapshot()).toEqual({ room: null, ready: true, error: null }); expect(f.calls).toHaveLength(1); off();
  });
  it("current refusal keeps accepted identity, recovers on a later choice, and does not emit after disposal", async () => {
    const f = controlled("/chats?room=r_one"); const nav = new ChatNavigation(f.bridge); const listener = vi.fn(); const off = nav.subscribe(listener);
    nav.navigate("r_two"); f.calls[0].reject(new Error("House refused navigation.")); await tick();
    expect(nav.snapshot().room).toBe("r_one"); expect(nav.snapshot().error).toContain("refused");
    nav.navigate("r_three"); off(); const count = listener.mock.calls.length;
    f.calls[1].resolve("/chats?room=r_three"); await tick(); expect(listener).toHaveBeenCalledTimes(count);
  });
  it("uses the actual official bridge host for initial link, navigation and Back/Forward", async () => {
    const host = createHouseBridgeTestHost({ address: "/chats?room=r_two" });
    const nav = new ChatNavigation(houseBridge()); const off = nav.subscribe(vi.fn());
    await vi.waitFor(() => expect(nav.snapshot().room).toBe("r_two")); expect(host.navigations).toHaveLength(0);
    nav.navigate("r_one"); await vi.waitFor(() => expect(nav.snapshot().room).toBe("r_one"));
    expect(host.navigations).toEqual([{ mode: "push", address: "/chats?room=r_one" }]);
    host.open("/chats?room=r_two"); await vi.waitFor(() => expect(nav.snapshot().room).toBe("r_two"));
    host.open("/chats?room=r_one"); await vi.waitFor(() => expect(nav.snapshot().room).toBe("r_one"));
    host.open("/chats"); await vi.waitFor(() => expect(nav.snapshot().room).toBeNull());
    expect(host.navigations).toHaveLength(1); off();
  });
});
