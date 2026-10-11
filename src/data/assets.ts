import { z } from "zod";
import type { Runtime } from "./house";
import type { Attachment } from "./model";
const ref = z.string().regex(/^at_[a-zA-Z0-9_.-]+$/);
const record = z
  .object({
    original: z.unknown(),
    version: z.string(),
    attachment: ref,
    name: z.string(),
    bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    media_type: z.string().nullable(),
    save: z
      .object({
        status: z.enum(["pending", "saved", "failed"]),
        failure: z.string().nullable(),
      })
      .strict(),
    storage: z
      .object({ provider: z.enum(["house", "connected"]), scope: z.string() })
      .strict(),
    read: z
      .object({ status: z.enum(["available", "not_saved", "unavailable"]) })
      .strict()
      .optional(),
    blob: z.instanceof(Blob).optional(),
  })
  .strict();
const short = z
  .object({ attachment: ref, upload_failure: z.string().optional() })
  .strict();
function resultValue(result: Awaited<ReturnType<Runtime["call"]>>) {
  if (result.kind !== "action")
    throw new Error(
      `House attachment operation did not complete (${result.kind}). No automatic retry was made.`,
    );
  return result.result;
}
export async function sha256(blob: Blob) {
  const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(hash), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
}
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export async function uploadAttachment(
  md: Runtime,
  room: string,
  file: File,
  version: string = crypto.randomUUID(),
): Promise<Attachment> {
  if (
    !file.name.trim() ||
    file.name.length > 200 ||
    file.size === 0 ||
    file.size > MAX_FILE_BYTES
  )
    throw new Error("Choose a nonempty named file of at most 20 MiB.");
  const digest = await sha256(file);
  const value = resultValue(
    await md.call("attachments/upload", {
      room_ref: room,
      version,
      name: file.name,
      bytes: file.size,
      sha256: digest,
      media_type: file.type || "application/octet-stream",
      blob: file,
    }),
  );
  const compact = short.safeParse(value);
  let attachment: string;
  if (compact.success) {
    if (compact.data.upload_failure)
      throw new Error(
        `House could not store the file (${compact.data.upload_failure}).`,
      );
    attachment = compact.data.attachment;
  } else {
    const full = record.parse(value);
    if (
      full.storage.scope !== room ||
      full.bytes !== file.size ||
      full.sha256 !== digest
    )
      throw new Error(
        "House file metadata does not match the selected Room or bytes.",
      );
    if (full.save.status === "failed")
      throw new Error(
        `House file save failed (${full.save.failure ?? "unknown"}).`,
      );
    attachment = full.attachment;
  }
  return {
    attachment_ref: attachment,
    name: file.name,
    mime: file.type || "application/octet-stream",
    bytes: file.size,
  };
}
export async function readAttachment(
  md: Runtime,
  room: string,
  attachment: Attachment,
): Promise<{ blob: Blob | null; name: string; status: string }> {
  const full = record.parse(
    resultValue(
      await md.call("attachments/get", {
        room_ref: room,
        attachment_ref: ref.parse(attachment.attachment_ref),
      }),
    ),
  );
  if (
    full.attachment !== attachment.attachment_ref ||
    full.storage.scope !== room
  )
    throw new Error(
      "House returned a file outside the requested Room or reference.",
    );
  if (full.blob && full.read?.status !== "available")
    throw new Error("House returned bytes with an incompatible read status.");
  if (
    full.blob &&
    (full.blob.size !== full.bytes || (await sha256(full.blob)) !== full.sha256)
  )
    throw new Error("House file content failed its size/hash check.");
  if (full.blob && full.bytes !== attachment.bytes)
    throw new Error("The saved attachment descriptor does not match the file.");
  return {
    blob: full.blob ?? null,
    name: full.name,
    status: full.blob ? "available" : (full.read?.status ?? "unavailable"),
  };
}
