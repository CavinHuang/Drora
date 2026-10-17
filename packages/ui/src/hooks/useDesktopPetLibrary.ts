import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopPetLibraryRequest, DesktopPetLibraryResult } from "@drora/shared";
import { useOptionalPlatform } from "./usePlatform.js";
import { logger } from "@/logger.js";

export function useDesktopPetLibrary(character: string) {
  const platform = useOptionalPlatform();
  const [catalog, setCatalog] = useState<DesktopPetLibraryResult | null>(null);
  const [preview, setPreview] = useState<DesktopPetLibraryResult["preview"]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  const run = useCallback(
    async (request: DesktopPetLibraryRequest) => {
      if (!platform?.manageDesktopPets) return;
      const token = ++generation.current;
      setBusy(true);
      setError(false);
      try {
        const result = await platform.manageDesktopPets(request);
        if (mounted.current && token === generation.current && !result.cancelled)
          setCatalog(result);
        if (mounted.current && token === generation.current && !result.cancelled) return result;
      } catch (cause) {
        logger.warn("[desktop-pet] library operation failed", cause);
        if (mounted.current && token === generation.current) setError(true);
      } finally {
        if (mounted.current && token === generation.current) setBusy(false);
      }
    },
    [platform],
  );
  useEffect(() => {
    mounted.current = true;
    void run({ action: "list" });
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, [run]);
  useEffect(() => {
    let active = true;
    setPreview(undefined);
    if (!catalog) return;
    void platform
      ?.manageDesktopPets?.({ action: "preview", id: character })
      .then((result) => {
        if (active) setPreview(result.preview);
      })
      .catch((cause) => logger.warn("[desktop-pet] preview failed", cause));
    return () => {
      active = false;
    };
  }, [character, catalog, platform]);
  return { catalog, preview, busy, error, run, supported: Boolean(platform?.manageDesktopPets) };
}
