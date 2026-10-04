// R3 P2a 自包含 i18n 运行时（D6：不依赖 @zcode/ui 的 IntlProvider）。
// 语义对齐 ui 侧用法：intl.formatMessage({id}, values?) + {placeholder} 插值；
// 语言从 localStorage 快照（key: zcode-mobile-lang），缺省跟随 navigator，en 缺键回退 zh。
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { zhCN } from "../intl/zh-CN.js";
import { enUS } from "../intl/en-US.js";

export type MobileLocale = "zh-CN" | "en-US";

const DICTIONARIES: Record<MobileLocale, Record<string, string>> = {
  "zh-CN": zhCN,
  "en-US": enUS,
};

const LOCALE_STORAGE_KEY = "zcode-mobile-lang";

export function resolveLocale(): MobileLocale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "zh-CN" || stored === "en-US") return stored;
  } catch {
    // storage 不可用：走 navigator 缺省。
  }
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export function storeLocale(locale: MobileLocale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // 忽略：语言快照失败不影响会话。
  }
}

export interface MobileIntl {
  locale: MobileLocale;
  formatMessage(descriptor: { id: string }, values?: Record<string, string | undefined>): string;
}

function format(
  dictionary: Record<string, string>,
  fallback: Record<string, string>,
  id: string,
  values?: Record<string, string | undefined>,
): string {
  const template = dictionary[id] ?? fallback[id] ?? id;
  if (!values) return template;
  return template.replaceAll(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

export interface IntlProviderProps {
  locale?: MobileLocale;
  children: ReactNode;
}

const IntlContext = createContext<MobileIntl | null>(null);

export function IntlProvider({ locale, children }: IntlProviderProps) {
  const value = useMemo<MobileIntl>(() => {
    const resolved = locale ?? resolveLocale();
    return {
      locale: resolved,
      formatMessage: (descriptor, values) =>
        format(DICTIONARIES[resolved], DICTIONARIES["zh-CN"], descriptor.id, values),
    };
  }, [locale]);
  return <IntlContext.Provider value={value}>{children}</IntlContext.Provider>;
}

export function useIntl(): MobileIntl {
  const intl = useContext(IntlContext);
  if (!intl) throw new Error("useIntl must be used within IntlProvider");
  return intl;
}
