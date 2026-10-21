import {
  DESKTOP_PET_BUILTINS,
  DESKTOP_PET_CONTRACT,
  DESKTOP_PET_CORNERS,
  type DesktopPetConfiguration,
  type AppSettings,
} from "@drora/shared";
import { codexPetTracks } from "../shared/desktopPetAnimation.js";
import type { createDesktopPetLibrary } from "./desktopPetLibrary.js";

/** All characters are validated Codex packs; presentation has no legacy artwork branch. */
export async function resolvePetConfiguration(
  settings: Partial<AppSettings>,
  library: ReturnType<typeof createDesktopPetLibrary>,
): Promise<DesktopPetConfiguration> {
  const fallback = DESKTOP_PET_BUILTINS[0].id;
  const pack =
    (await library.load(settings.desktopPetCharacter ?? fallback)) ??
    (await library.load(fallback));
  if (!pack) throw new Error("Default Codex pet pack is unavailable");
  const width = Math.round(
    Math.max(
      DESKTOP_PET_CONTRACT.minSize,
      Math.min(
        settings.desktopPetSize ?? DESKTOP_PET_CONTRACT.defaultSize,
        DESKTOP_PET_CONTRACT.maxSize,
      ),
    ),
  );
  return {
    id: pack.entry.id,
    image: pack.image,
    columns: 8,
    rows: pack.entry.spriteVersionNumber === 1 ? 9 : 11,
    width,
    height: Math.ceil((width * 208) / 192),
    spriteVersionNumber: pack.entry.spriteVersionNumber,
    badgeCorner: settings.desktopPetBadgeCorner ?? DESKTOP_PET_CORNERS[1],
    tracks: codexPetTracks(),
  };
}
