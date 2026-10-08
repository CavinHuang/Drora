import { createRequire } from "node:module";
import { join } from "node:path";

var sharpPromise = null;
export function loadSharp() {
  if (!sharpPromise) {
    try {
      const requireBases = [
        process.env.ZCODE_CUA_PLUGIN_ROOT
          ? join(process.env.ZCODE_CUA_PLUGIN_ROOT, "package.json")
          : void 0,
        typeof import.meta.url === "string" && import.meta.url ? import.meta.url : void 0,
        typeof __filename === "string" && __filename ? __filename : void 0,
        process.env.ZCODE_PLUGIN_ROOT
          ? join(process.env.ZCODE_PLUGIN_ROOT, "package.json")
          : void 0,
        process.env.ZCODE_ALLOW_HOST_SHARP === "1" ? join(process.cwd(), "package.json") : void 0,
      ].filter((base) => typeof base === "string");
      let sharp;
      let lastError;
      for (const requireBase of new Set(requireBases)) {
        try {
          sharp = createRequire(requireBase)("sharp");
          break;
        } catch (error51) {
          lastError = error51;
        }
      }
      if (!sharp) throw lastError;
      if (typeof sharp !== "function" || typeof sharp.versions?.vips !== "string") {
        throw new Error("Resolved sharp runtime failed callable/libvips validation");
      }
      sharpPromise = Promise.resolve(sharp);
    } catch (error51) {
      sharpPromise = Promise.reject(error51);
    }
  }
  return sharpPromise;
}
