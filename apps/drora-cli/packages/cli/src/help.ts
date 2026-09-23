import { getDroraCopy, type SupportedLocale, type UiLocale } from "@drora/i18n";

export function formatCliHelp(
  version: string,
  locale?: UiLocale,
  detectedLocale?: SupportedLocale,
): string {
  return getDroraCopy(locale, detectedLocale).cli.help(version);
}
