import { z } from "zod";

export const desktopPetTargetSchema = z.object({
  workspacePath: z.string().min(1),
  workspaceIdentity: z.string().min(1).optional(),
  remoteSessionId: z.string().min(1).optional(),
  sessionId: z.string().min(1),
});
export type DesktopPetTarget = z.infer<typeof desktopPetTargetSchema>;

export const desktopPetPresentationSchema = z.object({
  mode: z.enum(["idle", "working", "attention", "completed", "error"]),
  activeCount: z.number().int().nonnegative().max(999),
  attentionCount: z.number().int().nonnegative().max(999),
  preview: z.string().max(120).optional(),
  target: desktopPetTargetSchema.optional(),
});
export type DesktopPetPresentation = z.infer<typeof desktopPetPresentationSchema>;

export const desktopPetDragSchema = z.enum(["start", "move", "end"]);
export type DesktopPetDrag = z.infer<typeof desktopPetDragSchema>;

/** 设置页管理中心用：从同一图集裁出的待机静帧定位（CSS background-position 语义）。 */
export const desktopPetPreviewSchema = z.object({
  /** 精灵图集 data URL，与宠物窗口渲染同源（单一资产出处）。 */
  dataUrl: z.string().min(1),
  /** 单帧显示格尺寸（CSS 像素）。 */
  frameWidth: z.number().int().positive(),
  frameHeight: z.number().int().positive(),
  /** 待机静帧所在列/行与图集网格规模。 */
  column: z.number().int().nonnegative(),
  row: z.number().int().nonnegative(),
  columns: z.number().int().positive(),
  rows: z.number().int().positive(),
});
export type DesktopPetPreview = z.infer<typeof desktopPetPreviewSchema>;

export const desktopPetCatalogEntrySchema = z.object({
  id: z.string().min(1),
  nameZh: z.string().min(1),
  nameEn: z.string().min(1),
  preview: desktopPetPreviewSchema,
});
export type DesktopPetCatalogEntry = z.infer<typeof desktopPetCatalogEntrySchema>;

export const desktopPetCatalogSchema = z.array(desktopPetCatalogEntrySchema);
export type DesktopPetCatalog = z.infer<typeof desktopPetCatalogSchema>;
