import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  MicOff01Icon,
  VideoIcon,
  Mic01Icon,
  VideoOffIcon,
  ChevronDown,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useStorage } from "@/hooks/use-storage";
import { useAudioLevels } from "@/hooks/use-audio-analysis";
import { useMediaDevices } from "@/hooks/use-media-devices";

type MediaKind = "audio" | "video";

interface MediaButtonProps {
  kind: MediaKind;
  enabled: boolean;
  onToggle: () => void;
}

const ICON_MAP = {
  audio: { on: Mic01Icon, off: MicOff01Icon },
  video: { on: VideoIcon, off: VideoOffIcon },
} as const;

export function MediaButton({ kind, enabled, onToggle }: MediaButtonProps) {
  const storageKey = `${kind}DeviceId`;
  const { value: storedDeviceId, setValue: setStoredDeviceId } =
    useStorage(storageKey);

  const icon = ICON_MAP[kind][enabled ? "on" : "off"];
  const { t } = useTranslation();
  const [devices, loadDevices] = useMediaDevices(kind);
  const streamRef = useRef<MediaStream | null>(null);
  const effectiveDeviceIdRef = useRef<string | null>(null);
  const [streamState, setStreamState] = useState<MediaStream | null>(null);
  const audioLevels = useAudioLevels(kind === "audio" ? streamState : null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Keep video element in sync with stream changes
  const setStream = (stream: MediaStream) => {
    streamRef.current = stream;
    setStreamState(stream);
    if (kind === "video" && videoRef.current) {
      setVideoReady(false);
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  };

  const stopMediaProcessing = useCallback(() => {
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStreamState(null);
  }, []);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      // Persist effective device when closing so the next open starts correct
      if (effectiveDeviceIdRef.current) {
        setStoredDeviceId(effectiveDeviceIdRef.current);
      }
      // Stop preview streams immediately when dropdown closes
      stopMediaProcessing();
    }
    setIsDropdownOpen(open);
  };

  // Default to first device when stored device is missing or invalid
  const isValidDevice = devices.some((d) => d.deviceId === storedDeviceId);
  const effectiveDeviceId =
    storedDeviceId && isValidDevice ? storedDeviceId : devices[0]?.deviceId;

  // Track latest effectiveDeviceId in a ref to avoid stale closures
  effectiveDeviceIdRef.current = effectiveDeviceId;

  // Open: load devices + start media after the dropdown is rendered
  useEffect(() => {
    if (!isDropdownOpen) return;

    (async () => {
      await loadDevices();
      requestAnimationFrame(async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            [kind]: effectiveDeviceId ? { deviceId: effectiveDeviceId } : true,
          });
          setStream(stream);
        } catch {
          // permission denied or cancelled
        }
      });
    })();

    return () => {
      requestAnimationFrame(() => stopMediaProcessing());
    };
  }, [isDropdownOpen]);

  const handleDeviceChange = async (deviceId: string) => {
    setStoredDeviceId(deviceId);
    stopMediaProcessing();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        [kind]: deviceId ? { deviceId } : true,
      });
      setStream(stream);
    } catch {
      // permission denied
    }
  };

  useEffect(() => {
    return stopMediaProcessing;
  }, []);

  return (
    <DropdownMenu open={isDropdownOpen} onOpenChange={handleOpenChange}>
      <ButtonGroup>
        <Button
          size="lg"
          variant={enabled ? "outline" : "destructive"}
          onClick={() => onToggle()}
          aria-label={t(`mediaButton.${kind}Toggle${enabled ? "On" : "Off"}`)}
        >
          <HugeiconsIcon icon={icon} />
        </Button>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-lg"
            variant={enabled ? "outline" : "destructive"}
            aria-label={t(`mediaButton.${kind}Devices`)}
          >
            <HugeiconsIcon icon={ChevronDown} />
          </Button>
        </DropdownMenuTrigger>
      </ButtonGroup>
      <DropdownMenuContent className="w-56" align="end">
        {kind === "audio" && (
          <>
            <div className="flex items-end justify-center gap-1 h-16">
              {audioLevels.map((level, i) => (
                <div
                  key={i}
                  className="w-1.5 rounded-full bg-primary transition-all duration-75"
                  style={{
                    height: `${Math.max(8, level * 100)}%`,
                    opacity: 0.3 + level * 0.7,
                  }}
                />
              ))}
            </div>
            <DropdownMenuSeparator />
          </>
        )}
        {kind === "video" && (
          <>
            <div className="relative">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                onPlaying={() => setVideoReady(true)}
                onLoadedData={() => setVideoReady(true)}
                className="rounded-md w-full aspect-video object-cover bg-muted rotate-y-180"
              />
              {!videoReady && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
                </div>
              )}
            </div>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          <DropdownMenuRadioGroup
            value={effectiveDeviceId}
            onValueChange={handleDeviceChange}
          >
            {devices.map((device) => (
              <DropdownMenuRadioItem
                key={device.deviceId}
                value={device.deviceId}
                onSelect={(event) => event.preventDefault()}
              >
                {device.label}
              </DropdownMenuRadioItem>
            ))}
            {devices.length === 0 && (
              <DropdownMenuRadioItem disabled value="">
                {t("mediaButton.noInputDevices")}
              </DropdownMenuRadioItem>
            )}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
