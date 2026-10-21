/** Drora-owned pet compatibility contract; keep filesystem/wire keys in one place. */
export const DESKTOP_PET_CONTRACT = {
  creationSkill: "create-pet",
  customPrefix: "custom:",
  directory: "pets",
  legacyDirectory: "avatars",
  manifest: "pet.json",
  legacyManifest: "avatar.json",
  spritesheet: "spritesheet.webp",
  maxImageBytes: 20 * 1024 * 1024,
  maxActivities: 30,
  defaultSize: 112,
  minSize: 80,
  maxSize: 224,
  channels: {
    library: "drora:desktop-pet-library",
    configure: "drora:desktop-pet-configure",
    pointer: "drora:desktop-pet-pointer",
    command: "drora:desktop-pet-command",
  },
} as const;

export const DESKTOP_PET_BUILTINS = [
  { id: "violet", nameZh: "紫罗兰 · 小猫", nameEn: "Violet the cat" },
  { id: "noir", nameZh: "夜墨 · 黑猫娘", nameEn: "Noir" },
  { id: "snow", nameZh: "雪铃 · 白猫娘", nameEn: "Snow" },
  { id: "ginger", nameZh: "杏桃 · 橘猫娘", nameEn: "Ginger" },
] as const;

export const DESKTOP_PET_CORNERS = ["top-start", "top-end", "bottom-start", "bottom-end"] as const;
export const DESKTOP_PET_ACTIVITY_PRIORITY = {
  attention: 0,
  error: 1,
  completed: 2,
  working: 3,
} as const;
