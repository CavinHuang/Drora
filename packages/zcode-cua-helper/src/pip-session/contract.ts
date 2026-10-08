import { z } from "zod";

export var PIP_SESSION_PROTOCOL_VERSION = 2;
export var PIP_SESSION_RUNTIME_ID = "zcode-cua-pip-session-v2";
export var PIP_SESSION_HIDDEN_GROUP_ID = "__zcode_pip_no_active_session_v2__";
export var PIP_SESSION_CAPTURE_PENDING_TTL_MS = 2e3;
var identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !value.includes("\0"), "identifier cannot contain NUL")
  .refine(
    (value) => value !== PIP_SESSION_HIDDEN_GROUP_ID,
    "identifier is reserved by the PiP session runtime",
  );
var sequenceSchema = z.number().int().nonnegative().safe();
export var pipSessionEventSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("focus-changed"),
      revision: sequenceSchema,
      sourceWindowId: identifierSchema,
      sessionId: identifierSchema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("turn-started"),
      sessionId: identifierSchema,
      turnId: identifierSchema,
      sequenceNumber: sequenceSchema,
      eventId: identifierSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("turn-ended"),
      sessionId: identifierSchema,
      turnId: identifierSchema,
      sequenceNumber: sequenceSchema,
      eventId: identifierSchema,
      outcome: z.enum(["completed", "failed"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("session-closed"),
      sessionId: identifierSchema,
      sequenceNumber: sequenceSchema,
      eventId: identifierSchema,
    })
    .strict(),
]);
export var pipCaptureTargetSchema = z
  .object({
    windowId: z.number().int().positive().safe(),
    presentationWindowId: z.number().int().positive().safe().optional(),
    pid: z.number().int().positive().safe(),
    bundleId: z.string().trim().min(1).max(255),
  })
  .strict();
