import { getDroraCopy } from "@drora/i18n";
export function formatCliHelp(version, locale, detectedLocale) {
    return getDroraCopy(locale, detectedLocale).cli.help(version);
}
