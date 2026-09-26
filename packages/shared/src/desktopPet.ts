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
  target: desktopPetTargetSchema.optional(),
});
export type DesktopPetPresentation = z.infer<typeof desktopPetPresentationSchema>;
