// P1-08：apply-ledger.mjs 工具回归（specs/upstream-v3.17.1-migration.md §7 P1）。
// 在临时 git 仓库构造最小 ledger，逐场景断言应用器行为：
// 新增/取上游/文本干净合并/文本冲突/未改随删/删除本地改决策/漂移阻断/
// 二进制逐字/路径映射漂移/非法路径/决策覆写。
// 运行：node --import tsx --test scripts/test/upstream-apply-ledger.test.mjs
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { promisify } from "node:util";
import { transformContent } from "../../scripts/upstream/transform-upstream-tree.mjs";

const exec = promisify(execFile);
const TOOL = path.resolve("scripts/upstream/apply-ledger.mjs");

const HEADER =
  "id\tsegment\tchange\tzone\tupstream_path\tdrora_path\tbase_blob\ttarget_blob\tprevious_main_blob\tcurrent_main_blob\tnormalized_base_blob\tnormalized_target_blob\tprevious_main_dryrun\tcurrent_main_dryrun\ttest_asset\thistorical_feature_overlap\tfinal_disposition\tcandidate_commit\tevidence\treviewer";

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "usync-apply-test-"));
  await exec("git", ["init", "-q"], { cwd: root });
  // Node 24 + Git for Windows 下 async execFile 的 input 选项有 ~25s 管道句柄延迟，
  // 手动 spawn 写 stdin 为毫秒级（本文件验证过的唯一可靠形态）。
  const blob = async (content) => {
    const child = spawn("git", ["hash-object", "-w", "--stdin"], {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.stdin.end(Buffer.isBuffer(content) ? content : Buffer.from(content));
    const code = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    if (code !== 0) throw new Error(`hash-object 失败: ${err}`);
    return out.trim();
  };
  return { root, blob };
}

const row = (fields) =>
  [
    fields.id,
    "T1",
    fields.change,
    fields.zone ?? "normal",
    fields.up,
    fields.drora,
    fields.base ?? "-",
    fields.target ?? "-",
    "-",
    fields.ours ?? "-",
    "-",
    "-",
    fields.outcome,
    fields.outcome,
    "false",
    "false",
    "pending",
    "-",
    "-",
    "-",
  ].join("\t");

async function runTool(root, ledgerText, decisions) {
  const tsv = path.join(root, "ledger.tsv");
  await fs.writeFile(tsv, ledgerText, "utf8");
  const args = [TOOL, "--ledger", tsv, "--segment", "T1", "--report", path.join(root, "report.json")];
  if (decisions) {
    const dj = path.join(root, "decisions.json");
    await fs.writeFile(dj, JSON.stringify(decisions), "utf8");
    args.push("--decisions", dj);
  }
  // 工具在 errors/driftBlocked 时以 exit 2 报告（fail-closed），stdout 仍是 JSON 摘要。
  let stdout;
  try {
    ({ stdout } = await exec(process.execPath, args, { cwd: root, maxBuffer: 16 * 1024 * 1024 }));
  } catch (error) {
    if (!error.stdout) throw error;
    stdout = error.stdout;
  }
  return { summary: JSON.parse(stdout), report: JSON.parse(await fs.readFile(path.join(root, "report.json"), "utf8")) };
}

test("新增：上游新文件按转换规则落盘", async () => {
  const { root, blob } = await makeFixture();
  const target = await blob("export const zcodeValue = 'zcode-apple';\n");
  const ledger = [HEADER, row({ id: "U1", change: "A", up: "packages/shared/src/new.ts", drora: "packages/shared/src/new.ts", target, outcome: "add" })].join("\n");
  const { report } = await runTool(root, ledger);
  const written = await fs.readFile(path.join(root, "packages/shared/src/new.ts"), "utf8");
  assert.equal(written, transformContent("export const zcodeValue = 'zcode-apple';\n"));
  assert.equal(report.applied[0].action, "add");
});

test("take-upstream：本地未改，整文件取转换后的上游", async () => {
  const { root, blob } = await makeFixture();
  const baseText = "export const zcodeValue = 1;\n";
  const base = await blob(baseText);
  const target = await blob("export const zcodeValue = 2;\n");
  const oursOid = await blob(transformContent(baseText));
  await fs.mkdir(path.join(root, "packages/shared/src"), { recursive: true });
  await fs.writeFile(path.join(root, "packages/shared/src/mod.ts"), transformContent(baseText));
  const ledger = [HEADER, row({ id: "U2", change: "M", up: "packages/shared/src/mod.ts", drora: "packages/shared/src/mod.ts", base, target, ours: oursOid, outcome: "take-upstream" })].join("\n");
  await runTool(root, ledger);
  const written = await fs.readFile(path.join(root, "packages/shared/src/mod.ts"), "utf8");
  assert.equal(written, transformContent("export const zcodeValue = 2;\n"));
});

test("文本干净合并：双方不同区域改动并存且无冲突标记", async () => {
  const { root, blob } = await makeFixture();
  // 变更行之间保留足够未改行，避免 git merge-file 因零上下文把两处改动折叠成一块冲突。
  const baseText = "export const a = 1;\nexport const mid1 = 0;\nexport const mid2 = 0;\nexport const mid3 = 0;\nexport const b = 2;\n";
  const base = await blob(baseText);
  const target = await blob(baseText.replace("b = 2", "b = 3"));
  const oursText = transformContent(baseText.replace("a = 1", "a = 9"));
  const oursBlob = await blob(oursText);
  await fs.mkdir(path.join(root, "packages/shared/src"), { recursive: true });
  await fs.writeFile(path.join(root, "packages/shared/src/both.ts"), oursText);
  const ledger = [HEADER, row({ id: "U3", change: "M", up: "packages/shared/src/both.ts", drora: "packages/shared/src/both.ts", base, target, ours: oursBlob, outcome: "text-clean-needs-semantic-review" })].join("\n");
  const { report } = await runTool(root, ledger);
  const written = await fs.readFile(path.join(root, "packages/shared/src/both.ts"), "utf8");
  assert.ok(written.includes("a = 9"), "保留本地改动");
  assert.ok(written.includes("b = 3"), "吸收上游改动");
  assert.ok(!written.includes("<<<<<<<"), "无冲突标记");
  assert.deepEqual(report.semanticReview, ["packages/shared/src/both.ts"]);
});

test("文本冲突：写出带标记合并结果并登记冲突", async () => {
  const { root, blob } = await makeFixture();
  const base = await blob("export const a = 1;\n");
  const target = await blob("export const a = 3;\n");
  const oursBlob = await blob(transformContent("export const a = 2;\n"));
  await fs.mkdir(path.join(root, "packages/shared/src"), { recursive: true });
  await fs.writeFile(path.join(root, "packages/shared/src/conf.ts"), transformContent("export const a = 2;\n"));
  const ledger = [HEADER, row({ id: "U4", change: "M", up: "packages/shared/src/conf.ts", drora: "packages/shared/src/conf.ts", base, target, ours: oursBlob, outcome: "text-conflict" })].join("\n");
  const { report } = await runTool(root, ledger);
  const written = await fs.readFile(path.join(root, "packages/shared/src/conf.ts"), "utf8");
  assert.ok(written.includes("<<<<<<< ours"), "冲突标记存在");
  assert.equal(report.conflicts.length, 1);
});

test("删除：本地未改随上游删除；本地有改动则须决策且保留", async () => {
  const { root, blob } = await makeFixture();
  const baseText = "stale zcode file\n";
  const base = await blob(baseText);
  // ours 的「未修改」语义 = 与 T(B)（转换后的 base）一致。
  const unmodifiedOurs = await blob(transformContent(baseText));
  const modifiedOurs = await blob(transformContent(baseText) + "// drora local note\n");
  await fs.mkdir(path.join(root, "packages/shared/src"), { recursive: true });
  await fs.writeFile(path.join(root, "packages/shared/src/gone.ts"), transformContent(baseText));
  await fs.writeFile(path.join(root, "packages/shared/src/kept.ts"), transformContent(baseText) + "// drora local note\n");
  const ledger = [
    HEADER,
    row({ id: "U5", change: "D", up: "packages/shared/src/gone.ts", drora: "packages/shared/src/gone.ts", base, ours: unmodifiedOurs, outcome: "delete-review" }),
    row({ id: "U6", change: "D", up: "packages/shared/src/kept.ts", drora: "packages/shared/src/kept.ts", base, ours: modifiedOurs, outcome: "delete-local-change-review" }),
  ].join("\n");
  const { report } = await runTool(root, ledger);
  await assert.rejects(fs.stat(path.join(root, "packages/shared/src/gone.ts")));
  assert.ok(await fs.stat(path.join(root, "packages/shared/src/kept.ts")));
  assert.equal(report.decisionRequired.length, 1);
  assert.equal(report.decisionRequired[0].path, "packages/shared/src/kept.ts");
});

test("漂移阻断：工作区与 ledger 记录不一致时拒绝应用", async () => {
  const { root, blob } = await makeFixture();
  const base = await blob("v1 zcode\n");
  const target = await blob("v2 zcode\n");
  const ledgerOurs = await blob(transformContent("v1 zcode\n"));
  await fs.mkdir(path.join(root, "packages/shared/src"), { recursive: true });
  await fs.writeFile(path.join(root, "packages/shared/src/drift.ts"), transformContent("v1 zcode\n// unexpected external edit\n"));
  const ledger = [HEADER, row({ id: "U7", change: "M", up: "packages/shared/src/drift.ts", drora: "packages/shared/src/drift.ts", base, target, ours: ledgerOurs, outcome: "take-upstream" })].join("\n");
  const { report } = await runTool(root, ledger);
  assert.equal(report.driftBlocked.length, 1);
  const still = await fs.readFile(path.join(root, "packages/shared/src/drift.ts"), "utf8");
  assert.ok(still.includes("unexpected external edit"), "内容未被覆盖");
});

test("二进制：NUL 内容逐字落盘不走文本替换", async () => {
  const { root, blob } = await makeFixture();
  const bin = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a]);
  const target = await blob(bin);
  const ledger = [HEADER, row({ id: "U8", change: "A", up: "packages/shared/src/icon.png", drora: "packages/shared/src/icon.png", target, outcome: "add" })].join("\n");
  await runTool(root, ledger);
  const written = await fs.readFile(path.join(root, "packages/shared/src/icon.png"));
  assert.ok(written.equals(bin), "二进制逐字节一致");
});

test("路径映射漂移与非法路径：fail-closed 记 error", async () => {
  const { root, blob } = await makeFixture();
  const target = await blob("x zcode\n");
  const ledger = [
    HEADER,
    row({ id: "U9", change: "M", up: "packages/shared/src/a.ts", drora: "packages/shared/src/wrong-name.ts", target, outcome: "take-upstream" }),
    row({ id: "U10", change: "A", up: "packages/shared/src/esc.ts", drora: "../outside.ts", target, outcome: "add" }),
  ].join("\n");
  const { report } = await runTool(root, ledger);
  assert.equal(report.errors.length, 2);
  await assert.rejects(fs.stat(path.join(root, "../outside.ts")));
});

test("决策覆写：delete 决策直接删除本地修改文件", async () => {
  const { root, blob } = await makeFixture();
  const base = await blob("v1 zcode\n");
  const modifiedOurs = await blob(transformContent("v1 zcode\n// local\n"));
  await fs.mkdir(path.join(root, "packages/shared/src"), { recursive: true });
  await fs.writeFile(path.join(root, "packages/shared/src/decided.ts"), transformContent("v1 zcode\n// local\n"));
  const ledger = [HEADER, row({ id: "U11", change: "D", up: "packages/shared/src/decided.ts", drora: "packages/shared/src/decided.ts", base, ours: modifiedOurs, outcome: "delete-local-change-review" })].join("\n");
  await runTool(root, ledger, { "packages/shared/src/decided.ts": "delete" });
  await assert.rejects(fs.stat(path.join(root, "packages/shared/src/decided.ts")));
});

test("cua-limited zone：仅 @zcode/ scope 替换且路径不变", async () => {
  const { root, blob } = await makeFixture();
  const target = await blob('import x from "@zcode/pkg";\n');
  const ledger = [HEADER, row({ id: "U12", change: "A", up: "packages/zcode-cua/new.ts", drora: "packages/zcode-cua/new.ts", target, zone: "cua-limited", outcome: "add" })].join("\n");
  await runTool(root, ledger);
  const written = await fs.readFile(path.join(root, "packages/zcode-cua/new.ts"), "utf8");
  assert.equal(written, 'import x from "@drora/pkg";\n');
});
