import type { UiLocale, SupportedLocale } from "@drora/contracts";
import { enUS } from "./locales/en-US.js";
import { zhCN } from "./locales/zh-CN.js";
import {
  DEFAULT_LOCALE,
  detectLocale,
  isSupportedLocale,
  isUiLocale,
  resolveLocale,
  SUPPORTED_LOCALES,
} from "./locale.js";
import type { DroraCopy } from "./types.js";

export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  detectLocale,
  isSupportedLocale,
  isUiLocale,
  resolveLocale,
};
export type { LocaleDetectionInput } from "./locale.js";
export type { CliCopy, TuiCopy, UiLocale, SupportedLocale, DroraCopy } from "./types.js";

const CATALOGS: Record<SupportedLocale, DroraCopy> = {
  "en-US": enUS,
  "zh-CN": zhCN,
};

export function getDroraCopy(locale?: UiLocale | string, detected?: string | null): DroraCopy {
  return CATALOGS[resolveLocale(locale, detected)];
}
