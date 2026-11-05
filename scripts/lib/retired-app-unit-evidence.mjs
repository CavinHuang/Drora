import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const references = (text) =>
  [
    ...text.matchAll(
      /(?<![\w/:.-])(retired:)?((?:packages|apps|scripts)\/[^\s`|）)]+\.(?:test|spec)\.[cm]?[jt]sx?)/gu,
    ),
  ].map((match) => ({ path: match[2], retired: Boolean(match[1]) }));
const cells = (line) =>
  line.startsWith("|")
    ? line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim())
    : [];

export function inspectRetiredAppUnitEvidence(markdown, { engineeringTests = new Set() } = {}) {
  const errors = [];
  const rows = markdown.split(/\r?\n/u);
  const aliases = new Map();
  const isAppUnit = (path) =>
    path.startsWith("packages/") &&
    !path.startsWith("packages/zcode-cua/") &&
    !/\/test\/(?:e2e|browser)\//u.test(path) &&
    !engineeringTests.has(path);
  for (const line of rows) {
    const row = cells(line);
    const id = (row[0] ?? "").replaceAll("`", "");
    const refs = references(row[1] ?? "");
    if (/^[A-Z]+$/u.test(id) && refs.length) aliases.set(id, refs);
  }
  for (const [index, line] of rows.entries()) {
    const refs = references(line);
    for (const ref of refs) {
      // 保留项不能套用 App 退役标签；避免再次把 CLI/CUA 或工程证据误报为已删。
      if (ref.retired && !isAppUnit(ref.path))
        errors.push(`line ${index + 1}: protected evidence mislabeled as retired: ${ref.path}`);
      // 顶部免责声明不会影响索引消费者；退役路径必须逐处标记，不能冒充现行测试。
      if (isAppUnit(ref.path) && !ref.retired)
        errors.push(`line ${index + 1}: unmarked retired App unit evidence: ${ref.path}`);
    }
    const row = cells(line);
    if (!/^(?:unit|covered(?:-unit)?|partial)$/u.test(row[1] ?? "")) continue;
    const evidence = row[2] ?? "";
    const evidenceRefs = references(evidence);
    for (const alias of evidence.replaceAll("`", "").split(/[、,\s+]+/u))
      evidenceRefs.push(...(aliases.get(alias) ?? []));
    if (evidenceRefs.length && evidenceRefs.every((ref) => ref.retired)) {
      errors.push(`line ${index + 1}: ${row[0]} is ${row[1]} with only retired evidence`);
    }
  }
  return errors;
}

export async function inspectCoverageMatrices(root = repoRoot) {
  // 现行保留集 = engineering + drora 并发清单 + drora-fork-isolated 串行清单三份显式清单：
  // 串行清单是 drora 侧第二工程（vitest.config.ts「Drora 保留回归…串行隔离」），经 mate P2
  // 门禁平移（d156000e9）与 drora 并发清单互斥登记、执行通道唯一，同属 AGENTS「自研回归」
  // 保留集；三份清单里的测试都在跑，coverage matrix 引用它们不加 retired: 前缀。
  // 修复背景一：PR-1B 在矩阵引用 packages/services/test/assistantTicketsService.test.ts
  // （当时在 drora 清单、在跑），首版只豁免 engineering 清单而把它误判为退役 App 单测。
  // 修复背景二（2026-11-05 mate P4 门禁第 1 轮）：P2/P3 平移把 assistant* 服务测试等 mate
  // 回归互斥移入 drora-isolated-test-files.json 后，本函数仍只并 engineering+drora 两清单，
  // 终审矩阵如实引用在跑的 assistantTicketsService/assistantP4Report 服务单测再次被误判为
  // 退役证据——按 spec「retired-app-unit-evidence 按本仓实际保留面适配」，串行清单并入现行集。
  const engineeringTests = new Set([
    ...JSON.parse(await readFile(resolve(root, "scripts/engineering-test-files.json"), "utf8")),
    ...JSON.parse(await readFile(resolve(root, "scripts/drora-test-files.json"), "utf8")),
    ...JSON.parse(await readFile(resolve(root, "scripts/drora-isolated-test-files.json"), "utf8")),
  ]);
  const directory = resolve(root, "docs/testing");
  const files = (await readdir(directory))
    .filter((file) => /coverage.*matrix.*\.md$/u.test(file))
    .sort();
  const results = await Promise.all(
    files.map(async (file) => {
      const errors = inspectRetiredAppUnitEvidence(
        await readFile(resolve(directory, file), "utf8"),
        { engineeringTests },
      );
      return errors.map((error) => `docs/testing/${file}: ${error}`);
    }),
  );
  return results.flat();
}
