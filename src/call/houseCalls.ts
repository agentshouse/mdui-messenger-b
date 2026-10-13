import { z } from "zod";
import { houseBridge } from "@agentshouse/app-bridge";
import type { Runtime } from "../data/house";
const holderSchema = z
  .object({ user: z.string().min(1), name: z.string(), email: z.string() })
  .strip();
export type Holder = z.infer<typeof holderSchema>;
const relaySchema = z
  .object({
    ice_servers: z
      .array(
        z
          .object({
            urls: z.union([z.string(), z.array(z.string())]),
            username: z.string(),
            credential: z.string(),
          })
          .strip(),
      )
      .min(1),
    expires_at: z.string().datetime({ offset: true }),
  })
  .strip();
function answer(value: Awaited<ReturnType<Runtime["call"]>>) {
  if (value.kind !== "action")
    throw Object.assign(new Error(`House call operation was not completed (${value.code}).`), value);
  return value.result;
}
export class HouseCallAPI {
  constructor(private runtime: Runtime) {}
  async holders(): Promise<Holder[]> {
    return z
      .array(holderSchema)
      .parse(answer(await this.runtime.call("holder.list", {})));
  }
  async relay(): Promise<{ iceServers: RTCIceServer[]; expiresAt: number }> {
    const result = relaySchema.parse(
      answer(await this.runtime.call("relay.read", {})),
    );
    const expiresAt = Date.parse(result.expires_at);
    if (expiresAt <= Date.now())
      throw new Error("House relay credentials have expired.");
    for (const server of result.ice_servers)
      for (const url of Array.isArray(server.urls)
        ? server.urls
        : [server.urls])
        if (!/^turns?:/i.test(url))
          throw new Error("House returned an unsupported relay entry.");
    return { iceServers: result.ice_servers, expiresAt };
  }
  async ring(to: string) {
    if (!to.trim()) throw new Error("Choose a House holder.");
    return answer(await this.runtime.call("holder.ring", { to }));
  }
  async send(to: string, body: unknown) {
    if (!to.trim()) throw new Error("Choose a House holder.");
    const encoded = JSON.stringify(body);
    if (!encoded || new TextEncoder().encode(encoded).byteLength > 32768)
      throw new Error("App signaling must fit 32 KiB of JSON.");
    return answer(await this.runtime.call("message.send", { to, body }));
  }
}
export function receiveHouseMessages(
  listener: (message: { from: string; body: unknown }) => void,
) {
  return houseBridge().messages(listener);
}
