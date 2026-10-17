import { z } from "zod";
import {
  DESKTOP_PET_CONTRACT,
  DESKTOP_PET_BUILTINS,
  DESKTOP_PET_CORNERS,
} from "./contracts/desktopPet.js";

export const desktopPetCharacterIdSchema = z
  .string()
  .max(160)
  .refine(
    (value) =>
      DESKTOP_PET_BUILTINS.some((pet) => pet.id === value) ||
      (value.startsWith(DESKTOP_PET_CONTRACT.customPrefix) &&
        /^[^/\\\p{Cc}]+$/u.test(value.slice(DESKTOP_PET_CONTRACT.customPrefix.length)) &&
        ![".", ".."].includes(value.slice(DESKTOP_PET_CONTRACT.customPrefix.length))),
  );
export const desktopPetSizeSchema = z
  .number()
  .int()
  .min(DESKTOP_PET_CONTRACT.minSize)
  .max(DESKTOP_PET_CONTRACT.maxSize);
export const desktopPetCornerSchema = z.enum(DESKTOP_PET_CORNERS);
export const desktopPetManifestSchema = z.object({
  id: z.string().trim().min(1).optional(),
  displayName: z.string().trim().min(1).optional(),
  description: z
    .string()
    .nullish()
    .transform((value) => value?.trim() || null),
  spriteVersionNumber: z.union([z.literal(1), z.literal(2)]).default(1),
  spritesheetPath: z.string().trim().min(1).default(DESKTOP_PET_CONTRACT.spritesheet),
});
export type DesktopPetManifest = z.infer<typeof desktopPetManifestSchema>;

export const desktopPetTargetSchema = z.object({
  workspacePath: z.string().min(1),
  workspaceIdentity: z.string().min(1).optional(),
  remoteSessionId: z.string().min(1).optional(),
  sessionId: z.string().min(1),
});
export type DesktopPetTarget = z.infer<typeof desktopPetTargetSchema>;
export function desktopPetTargetKey(target: DesktopPetTarget): string {
  return JSON.stringify([
    target.workspaceIdentity?.trim() || target.workspacePath,
    target.remoteSessionId,
    target.sessionId,
  ]);
}

export const desktopPetActivitySchema = z.object({
  target: desktopPetTargetSchema,
  title: z.string().max(160),
  mode: z.enum(["working", "attention", "completed", "error"]),
  preview: z.string().max(120).optional(),
  revision: z.number().finite(),
});
export type DesktopPetActivity = z.infer<typeof desktopPetActivitySchema>;

export const desktopPetPresentationSchema = z.object({
  mode: z.enum(["idle", "working", "attention", "completed", "error"]),
  activeCount: z.number().int().nonnegative().max(999),
  attentionCount: z.number().int().nonnegative().max(999),
  preview: z.string().max(120).optional(),
  target: desktopPetTargetSchema.optional(),
  activities: z.array(desktopPetActivitySchema).max(DESKTOP_PET_CONTRACT.maxActivities).optional(),
});
export type DesktopPetPresentation = z.infer<typeof desktopPetPresentationSchema>;

export const desktopPetDragSchema = z.object({
  phase: z.enum(["start", "move", "end", "cancel"]),
  altKey: z.boolean().optional(),
});
export type DesktopPetDrag = z.infer<typeof desktopPetDragSchema>;

export interface DesktopPetLibraryEntry {
  id: string;
  displayName: string;
  description: string | null;
  spriteVersionNumber: 1 | 2;
  updatedAt: number;
}
export interface DesktopPetLibraryResult {
  directoryPath: string;
  pets: DesktopPetLibraryEntry[];
  errors: string[];
  cancelled?: boolean;
  upgrade?: { id: string; directoryPath: string };
  preview?: Pick<DesktopPetConfiguration, "id" | "image" | "columns" | "rows" | "width" | "height">;
}
export const desktopPetLibraryRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }),
  z.object({ action: z.literal("refresh") }),
  z.object({ action: z.literal("import-directory") }),
  z.object({ action: z.literal("import-image") }),
  z.object({ action: z.literal("open-folder") }),
  z.object({ action: z.literal("create-template") }),
  z.object({ action: z.literal("delete"), id: desktopPetCharacterIdSchema }),
  z.object({ action: z.literal("export"), id: desktopPetCharacterIdSchema }),
  z.object({ action: z.literal("preview"), id: desktopPetCharacterIdSchema }),
  z.object({ action: z.literal("prepare-upgrade"), id: desktopPetCharacterIdSchema }),
]);
export type DesktopPetLibraryRequest = z.infer<typeof desktopPetLibraryRequestSchema>;

export interface DesktopPetSpriteFrame {
  column: number;
  row: number;
  durationMs: number;
}
export interface DesktopPetAnimationTrack {
  state: string;
  frames: DesktopPetSpriteFrame[];
  loopStart: number | null;
}
export interface DesktopPetConfiguration {
  id: string;
  image: string;
  columns: 8;
  rows: 9 | 11;
  width: number;
  height: number;
  spriteVersionNumber: 1 | 2;
  badgeCorner: (typeof DESKTOP_PET_CORNERS)[number];
  tracks: DesktopPetAnimationTrack[];
}
export const desktopPetConfigurationSchema = z
  .object({
    id: desktopPetCharacterIdSchema,
    image: z
      .string()
      .max(30 * 1024 * 1024)
      .regex(/^data:image\/(?:png|webp);base64,[A-Za-z0-9+/=]+$/u),
    columns: z.literal(8),
    rows: z.union([z.literal(9), z.literal(11)]),
    width: desktopPetSizeSchema,
    height: z.number().int().min(1).max(448),
    spriteVersionNumber: z.union([z.literal(1), z.literal(2)]),
    badgeCorner: desktopPetCornerSchema,
    tracks: z
      .array(
        z
          .object({
            state: z.string().max(32),
            frames: z
              .array(
                z.object({
                  column: z.number().int().min(0).max(15),
                  row: z.number().int().min(0).max(31),
                  durationMs: z.number().positive().max(60000),
                }),
              )
              .min(1)
              .max(100),
            loopStart: z.number().int().nonnegative().nullable(),
          })
          .refine((track) => track.loopStart == null || track.loopStart < track.frames.length),
      )
      .min(1)
      .max(32),
  })
  .refine(
    (value) =>
      value.rows === (value.spriteVersionNumber === 1 ? 9 : 11) &&
      value.tracks.every((track) =>
        track.frames.every((frame) => frame.row < value.rows && frame.column < value.columns),
      ),
  );
export const desktopPetPointerSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
export const desktopPetCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("menu") }),
  z.object({ action: z.literal("toggle-tray") }),
  z.object({ action: z.literal("open"), target: desktopPetTargetSchema }),
  z.object({
    action: z.literal("dismiss"),
    target: desktopPetTargetSchema,
    revision: z.number().finite(),
  }),
  z.object({ action: z.literal("badge-corner"), corner: desktopPetCornerSchema }),
  z.object({
    action: z.literal("hit-test"),
    interactive: z.boolean(),
    captured: z.boolean().optional(),
  }),
]);
