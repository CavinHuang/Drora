/**
 * i18n 键集对称差检查（specs/upstream-v3.18.0-migration.md §4 S6 段门）。
 *
 * 运行：pnpm --filter @drora/ui exec tsx scripts/check-i18n-key-parity.mts
 *
 * 规则：
 * - en-US 与 zh-CN 展平（含 spread）后键集必须完全一致（对称差 = 0）；
 * - ja-JP / ru-RU / ko-KR 相对 en-US 只允许缺 Drora 自研键（v3.18.0 合并保留块），
 *   缺口清单打印到 stdout 供 spec §10 登记（fallback 语义见 i18n/localeMessages.ts）。
 */
import enUS from "../src/i18n/locales/en-US.js";
import zhCN from "../src/i18n/locales/zh-CN.js";
import jaJP from "../src/i18n/locales/ja-JP.js";
import ruRU from "../src/i18n/locales/ru-RU.js";
import koKR from "../src/i18n/locales/ko-KR.js";

const keySet = (o: Record<string, string>) => new Set(Object.keys(o));

const en = keySet(enUS);
const zh = keySet(zhCN);
const onlyInEn = [...en].filter((k) => !zh.has(k)).sort();
const onlyInZh = [...zh].filter((k) => !en.has(k)).sort();

console.log(`en-US keys: ${en.size}`);
console.log(`zh-CN keys: ${zh.size}`);
console.log(`en↔zh symmetric difference: ${onlyInEn.length + onlyInZh.length}`);
if (onlyInEn.length) console.log("  only in en-US:\n    " + onlyInEn.join("\n    "));
if (onlyInZh.length) console.log("  only in zh-CN:\n    " + onlyInZh.join("\n    "));

for (const [name, table] of [
  ["ja-JP", jaJP],
  ["ru-RU", ruRU],
  ["ko-KR", koKR],
] as const) {
  const keys = keySet(table);
  const missing = [...en].filter((k) => !keys.has(k)).sort();
  console.log(`${name}: ${keys.size} keys, missing vs en-US: ${missing.length}`);
  if (missing.length) {
    // 只打印前 40 条 + 家族汇总，避免日志爆炸；完整清单由 spec §10 按家族登记。
    const fam = new Map<string, number>();
    for (const k of missing) {
      const f = k.split(".").slice(0, 2).join(".");
      fam.set(f, (fam.get(f) ?? 0) + 1);
    }
    console.log("  families: " + [...fam.entries()].map(([f, n]) => `${f}(${n})`).join(", "));
    console.log("  sample: " + missing.slice(0, 40).join(", "));
  }
}

if (onlyInEn.length || onlyInZh.length) {
  console.error("FAIL: en-US 与 zh-CN 键集不对称差非 0");
  process.exit(1);
}
console.log("PASS: en↔zh parity = 0");
