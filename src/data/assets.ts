import type { Runtime } from "./house";
import { attachmentSchema, type Attachment } from "./model";

export async function sha256(blob: Blob) {
  const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(hash), (v) => v.toString(16).padStart(2, "0")).join("");
}
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export async function uploadAttachment(
  md: Runtime,
  room: string,
  file: File,
  version: string = crypto.randomUUID(),
): Promise<Attachment> {
  if (!file.name.trim() || file.name.length > 200 || file.size === 0 || file.size > MAX_FILE_BYTES)
    throw new Error("Choose a nonempty named file of at most 20 MiB.");
  if (!/^[a-zA-Z0-9_-]+$/.test(version)) throw new Error("Invalid file operation identifier.");
  const path = `files/${version}`;
  const digest = await sha256(file);
  const draft = await md.roomDraft.write(room, path, null, { file: { blob: file } });
  if (draft.outcome !== "written" || !draft.roomDraft) throw Object.assign(new Error(`File draft was not written (${draft.outcome}).`), draft);
  const saved = await md.save(room, [{ path, revision: draft.roomDraft.revision }]);
  if (saved.outcome !== "saved") throw Object.assign(new Error(`File save was refused (${saved.code}).`), saved);
  return { path, name: file.name, mime: file.type || "application/octet-stream", bytes: file.size, sha256: digest };
}
export async function readAttachment(
  md: Runtime,
  room: string,
  attachment: Attachment,
): Promise<{ blob: Blob | null; name: string; status: string }> {
  const file = attachmentSchema.parse(attachment);
  const result = await md.binaryFile.read(room, file.path);
  if (result.kind !== "binary") return { blob: null, name: file.name, status: result.code };
  if (result.blob.size !== file.bytes || (await sha256(result.blob)) !== file.sha256)
    throw new Error("File content failed its size/hash check.");
  const blob = result.blob.type === file.mime ? result.blob : new Blob([await result.blob.arrayBuffer()], { type: file.mime });
  return { blob, name: file.name, status: "available" };
}
