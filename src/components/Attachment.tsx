import { useEffect, useRef, useState } from "react";
import { Download, Play } from "lucide-react";
import { Button } from "./ui/button";
import { readAttachment } from "../data/assets";
import { houseRuntime } from "../data/house";
import type { Attachment as FileDescriptor } from "../data/model";
export function Attachment({
  file,
  room,
}: {
  file: FileDescriptor;
  room: string;
}) {
  const [url, setUrl] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const objectUrl = useRef<string | null>(null);
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [room, file.path],
  );
  const open = async () => {
    if (busy) return;
    const seq = ++request.current;
    setBusy(true);
    setError("");
    try {
      const data = await readAttachment(await houseRuntime(), room, file);
      if (seq !== request.current) return;
      if (!data.blob) {
        setError("These bytes are not available in House yet.");
        return;
      }
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = URL.createObjectURL(data.blob);
      setUrl(objectUrl.current);
    } catch (e) {
      if (seq === request.current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === request.current) setBusy(false);
    }
  };
  return (
    <div className="rounded-md border p-2 text-sm max-w-full">
      <div className="flex gap-2 items-center">
        <span className="truncate">{file.name}</span>
        <span className="text-muted-foreground">
          {Math.ceil(file.bytes / 1024)} KB
        </span>
        {!url && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void open()}
            aria-label={`Load ${file.name}`}
          >
            {file.mime.startsWith("audio/") ? <Play /> : <Download />}
            {busy ? "Loading…" : "Load"}
          </Button>
        )}
      </div>
      {url &&
        (file.mime.startsWith("audio/") ? (
          <audio
            className="w-full mt-2"
            controls
            preload="metadata"
            src={url}
            aria-label={file.name}
          />
        ) : (
          <a className="underline" href={url} download={file.name}>
            Download file
          </a>
        ))}
      {error && (
        <p role="alert" className="text-destructive mt-1">
          {error}
        </p>
      )}
    </div>
  );
}
