import { useCallback, useEffect, useRef, useState } from "react";
import {MicOff, Video, Mic, VideoOff, ChevronDown} from 'lucide-react';
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
import { useAudioLevels } from "./use-audio-analysis";
import { useMediaDevices } from "./use-media-devices";

type MediaKind = "audio" | "video";

interface MediaButtonProps {
  kind: MediaKind;
  enabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
  onDeviceChange?: (deviceId: string) => void | Promise<void>;
}

const ICON_MAP = {
  audio: { on: Mic, off: MicOff },
  video: { on: Video, off: VideoOff },
} as const;

export function MediaButton({ kind, enabled, onToggle, disabled = false, onDeviceChange }: MediaButtonProps) {
  const [storedDeviceId, setStoredDeviceId] = useState("");
  const Icon = ICON_MAP[kind][enabled ? "on" : "off"];
  const t = (key: string) => key.includes("noInputDevices") ? "No input devices" : key.endsWith("Devices") ? `${kind === "audio" ? "Microphone" : "Camera"} devices` : `${enabled ? "Disable" : "Enable"} ${kind === "audio" ? "microphone" : "camera"}`;
  const [devices, loadDevices] = useMediaDevices(kind);
  const generation = useRef(0);
  const openRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const effectiveDeviceIdRef = useRef<string | null>(null);
  const [streamState, setStreamState] = useState<MediaStream | null>(null);
  const audioLevels = useAudioLevels(kind === "audio" ? streamState : null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const [mediaError, setMediaError] = useState<string | null>(null);

  const stopMediaProcessing = useCallback(() => {
    if (videoRef.current) videoRef.current.srcObject = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setStreamState(null);
    setVideoReady(false);
  }, []);

  const setStream = useCallback((stream: MediaStream, token: number): boolean => {
    if (!openRef.current || disabledRef.current || token !== generation.current) {
      stream.getTracks().forEach(track => track.stop()); return false;
    }
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = stream;
    setStreamState(stream);
    if (kind === "video" && videoRef.current) {
      setVideoReady(false);
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
    return true;
  }, [kind]);

  const handleOpenChange = (open: boolean) => {
    if (disabled && open) return;
    openRef.current = open;
    generation.current++;
    if (!open) stopMediaProcessing();
    else setMediaError(null);
    setIsDropdownOpen(open);
  };

  const isValidDevice = devices.some(device => device.deviceId === storedDeviceId);
  const effectiveDeviceId = storedDeviceId && isValidDevice ? storedDeviceId : devices[0]?.deviceId;
  effectiveDeviceIdRef.current = effectiveDeviceId;

  useEffect(() => {
    if (!isDropdownOpen || disabled) {
      if (disabled) { openRef.current = false; setIsDropdownOpen(false); }
      return;
    }
    const token = ++generation.current;
    let frame: number | undefined;
    const isCurrent = () => openRef.current && !disabledRef.current && token === generation.current;
    (async () => {
      await loadDevices();
      if (!isCurrent()) return;
      frame = requestAnimationFrame(() => {
        if (!isCurrent()) return;
        const deviceId = effectiveDeviceIdRef.current;
        void (async () => {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: kind === "audio" ? (deviceId ? { deviceId: { exact: deviceId } } : true) : false,
            video: kind === "video" ? (deviceId ? { deviceId: { exact: deviceId } } : true) : false,
          });
          setStream(stream, token);
        })().catch(() => {
          if (isCurrent()) setMediaError("Device preview is unavailable. Check browser permission or choose another device.");
        });
      });
    })().catch(() => { if (isCurrent()) setMediaError("Input devices are unavailable."); });
    return () => {
      generation.current++;
      if (frame !== undefined) cancelAnimationFrame(frame);
      stopMediaProcessing();
    };
  }, [isDropdownOpen, disabled, kind, loadDevices, setStream, stopMediaProcessing]);

  const handleDeviceChange = async (deviceId: string) => {
    if (!openRef.current || disabledRef.current) return;
    const token = ++generation.current;
    setMediaError(null);
    stopMediaProcessing();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: kind === "audio" ? (deviceId ? { deviceId: { exact: deviceId } } : true) : false,
        video: kind === "video" ? (deviceId ? { deviceId: { exact: deviceId } } : true) : false,
      });
      if (!setStream(stream, token)) return;
      await onDeviceChange?.(deviceId);
      if (!openRef.current || disabledRef.current || token !== generation.current) return;
      setStoredDeviceId(deviceId);
    } catch {
      if (openRef.current && !disabledRef.current && token === generation.current) {
        stopMediaProcessing();
        setMediaError("The device could not be selected. Your previous choice is unchanged.");
      }
    }
  };

  useEffect(() => () => { openRef.current = false; generation.current++; stopMediaProcessing(); }, [stopMediaProcessing]);

  return (
    <DropdownMenu open={isDropdownOpen} onOpenChange={handleOpenChange}>
      <ButtonGroup>
        <Button
          size="lg"
          variant={enabled ? "outline" : "destructive"}
          disabled={disabled}
          onClick={() => onToggle()}
          aria-label={t(`mediaButton.${kind}Toggle${enabled ? "On" : "Off"}`)}
        >
          <Icon />
        </Button>
        <DropdownMenuTrigger asChild>
          <Button
            disabled={disabled}
            size="icon-lg"
            variant={enabled ? "outline" : "destructive"}
            aria-label={t(`mediaButton.${kind}Devices`)}
          >
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
      </ButtonGroup>
      <DropdownMenuContent className="w-56" align="end">
        {mediaError && <p role="status" className="p-2 text-sm">{mediaError}</p>}
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
