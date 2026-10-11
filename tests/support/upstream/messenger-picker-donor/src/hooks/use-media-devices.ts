import { useState, useCallback } from "react";

type MediaKind = "audio" | "video";

export interface MediaDevice {
  deviceId: string;
  label: string;
}

async function enumerate(kind: MediaKind): Promise<MediaDevice[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === `${kind}input`)
      .map((d) => ({
        deviceId: d.deviceId,
        label:
          d.label ||
          `${kind === "audio" ? "Microphone" : "Camera"} ${d.deviceId.slice(0, 5)}`,
      }));
  } catch {
    return [];
  }
}

/**
 * Enumerate media input devices on demand.
 *
 * @example
 *   const [devices, loadDevices] = useMediaDevices("audio");
 */
export function useMediaDevices(kind: MediaKind) {
  const [devices, setDevices] = useState<MediaDevice[]>([]);

  const load = useCallback(async () => {
    setDevices(await enumerate(kind));
  }, [kind]);

  return [devices, load] as const;
}
