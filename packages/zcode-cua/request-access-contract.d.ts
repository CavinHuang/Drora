import { z } from "zod";
export declare const CUA_REQUEST_ACCESS_STATUS_META_KEY = "zcode.cua/request-access-status-v1";
export declare var cuaRequestAccessStatusSchema: z.ZodObject<
  {
    schemaVersion: z.ZodLiteral<1>;
    platform: z.ZodLiteral<"darwin">;
    grantOwner: z.ZodString;
    accessibility: z.ZodEnum<{
      granted: "granted";
      stale: "stale";
      denied: "denied";
    }>;
    screenRecording: z.ZodEnum<{
      granted: "granted";
      denied: "denied";
      unknown: "unknown";
    }>;
  },
  z.core.$strict
>;
