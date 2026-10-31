#!/usr/bin/env node
// P1-06：local-preservation.tsv 机器归类（specs/upstream-v3.17.1-migration.md §7 P1）。
// 把 ours 相对 T(B) 的全部差异行按保护类别分桶，产出 preservation-owners.tsv
// 与汇总。needs-owner-review 剩余行交由各段（S1–S6）人工认领，S7 要求归零。
// 归类只依据路径与 PF/P 类定义（feature-preservation.md §1/§2），不改写清单本体。
//
// 用法：node scripts/upstream/classify-preservation.mjs [--tsv <path>] [--out <path>]

import fs from "node:fs/promises";

const args = process.argv.slice(2);
const getArg = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const TSV = getArg("tsv") ?? "docs/upstream-sync/2026-10-31-v3.17.1/local-preservation.tsv";
const OUT = getArg("out") ?? "docs/upstream-sync/2026-10-31-v3.17.1/preservation-owners.tsv";

// 有序规则：先命中先归属。D 类冻结资产优先于路径巧合。
const RULES = [
  [/^packages\/mobile-web\//, "D-frozen", "mobile-web 官方快照/还原区，整目录排除合并"],
  [/^packages\/zcode-cua(-helper)?\//, "D-frozen", "CUA 冻结还原区（R3：0.6.3 不随上游 0.6.5）"],
  [/^third-party\//, "D-frozen", "第三方许可/inventory（S6 专项）"],
  [/^packages\/desktop\/resources\/(cua-helper|cua-helper-3\.11\.2-reference|glm-natives-3\.14\.3)\//, "D-frozen", "冻结二进制资产"],
  [/^packages\/ui\/src\/team\//, "A-feature", "PF02/PF03 Agents Team"],
  [/^packages\/ui\/src\/drora-persona\//, "A-feature", "PF09 人格 UI"],
  [/^packages\/ui\/src\/voice\//, "A-feature", "PF08 语音"],
  [/^packages\/ui\/src\/mobile\//, "A-feature", "PF16 手机远控 UI"],
  [/^packages\/ui\/src\/WebRemoteControlMobileShell\.tsx$/, "A-feature", "PF16 手机壳"],
  [/^apps\/drora-cli\/packages\/bootstrap\/src\/app\/drora-team\//, "A-feature", "PF02 Team bootstrap"],
  [/^apps\/drora-cli\/packages\/bootstrap\/src\/app\/drora-persona\//, "A-feature", "PF09 persona bootstrap"],
  [/^apps\/drora-cli\/packages\/(core|adapters|bootstrap)\/(tests?|src)\/.*(team|persona)\//, "A-feature", "PF02/PF09 Team/persona 实现+测试"],
  [/^packages\/services\/src\/knowledge\//, "A-feature", "PF04 Knowledge"],
  [/^packages\/services\/src\/obsidian-vault\//, "A-feature", "PF05 Obsidian/Vault"],
  [/^packages\/relay-v2-server\//, "A-feature", "PF10 自建 Relay V2 服务"],
  [/^packages\/drora-server-cli\//, "A-feature", "PF16 Drora server-cli"],
  [/^apps\/website\/|^website\//, "A-feature", "产品官网（specs/website.md）"],
  [/^packages\/desktop\/src\/(main\/)?drora-extensions\//, "A-feature", "PF07/PF12 drora-extensions 四层"],
  [/^docs\/superpowers\//, "A-feature", "自研 superpowers 插件文档"],
  [/^docs\/(glm-parity-pass|dual-cli-gap|parity-sweep|ab-parity|final-gap-sweep|renderer-ui-sweep|alignment-sweep|risk-review|upstream-sync|upstream|pr-23-review|chatgpt-desktop-intelligent-ui|vaultview|s03-write-gating|full-sweep|full-regression|glm-cli-parity|glm-review-pass|live-production-ab|mock-title-bug|remote-control-service-census|zcode-bundle)/, "E-history", "对拍/审计/迁移历史证据"],
  [/^\.agents\//, "E-engineering", "技能与治理"],
  [/^scripts\//, "E-engineering", "工程脚本"],
  [/^(AGENTS\.md|DESIGN\.md|CONTEXT\.md|README|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|architecture-policy\.yaml|\.oxlintrc\.json|\.oxfmtrc\.json|vitest\.config\.ts|\.husky\/|mise\.toml|knip\.json|tsconfig)/, "E-engineering", "根配置"],
  [/^docs\/testing\//, "E-engineering", "测试矩阵/catalog"],
];

const B_CLASS_HINTS = [
  [/^packages\/desktop\//, "B-shared", "desktop 共享触点（S4）"],
  [/^packages\/ui\//, "B-shared", "ui 共享触点（S5）"],
  [/^packages\/(services|server|provider|provider-node|client|shared|rpc|web)\//, "B-shared", "服务/契约共享触点（S1/S3/S5）"],
  [/^apps\/drora-cli\//, "B-shared", "CLI 共享触点（S2）"],
];

const main = async () => {
  const text = await fs.readFile(TSV, "utf8");
  const [headerLine, ...lines] = text.split("\n");
  const header = headerLine.split("\t");
  const pathIdx = header.indexOf("drora_path");
  const outRows = [["id", "drora_path", "class", "owner", "note"].join("\t")];
  const counts = {};
  for (const line of lines.filter((l) => l.trim())) {
    const cols = line.split("\t");
    const p = cols[pathIdx];
    let cls = "needs-owner-review";
    let owner = "-";
    let note = "";
    for (const [re, c, o, n] of RULES) {
      if (re.test(p)) {
        cls = c;
        owner = o;
        note = n;
        break;
      }
    }
    if (cls === "needs-owner-review") {
      for (const [re, c, o, n] of B_CLASS_HINTS) {
        if (re.test(p)) {
          cls = c;
          owner = o;
          note = n;
          break;
        }
      }
    }
    counts[cls] = (counts[cls] ?? 0) + 1;
    outRows.push([cols[0], p, cls, owner, note].join("\t"));
  }
  await fs.writeFile(OUT, outRows.join("\n") + "\n", "utf8");
  console.log(JSON.stringify({ tsv: TSV, out: OUT, counts }, null, 1));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
