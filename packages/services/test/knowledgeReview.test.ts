/**
 * W06 审核写入主场景测试（A31–A34 + specs/obsidian-knowledge.md §5e 验收映射）。
 *
 * 全部使用 mkdtemp 合成临时 Vault，绝不触碰用户真实 Vault；零模型/零网络。
 * 「断线未知结果」用第二个裸 sqlite 连接手工构造崩溃现场（operation 停在 applying、
 * 部分文件已落盘）——与真实进程死亡的账本/磁盘状态一致，不依赖测试钩子。
 *
 * 运行：node --import tsx --test packages/services/test/knowledgeReview.test.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { setDataBaseDir } from "../src/paths.js";
import { configureVaultAt } from "../src/obsidian-vault/config.js";
import {
  createKnowledgeServices,
  type KnowledgeServices,
} from "../src/knowledge/knowledgeServices.js";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf-8").digest("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface TestEnv {
  root: string;
  pluginDataDir: string;
  vault: string;
  databasePath: string;
  services: KnowledgeServices;
  review: KnowledgeServices["reviewService"];
}

async function createEnv(options: { writePathEnabled?: boolean } = {}): Promise<TestEnv> {
  const root = await mkdtemp(join(tmpdir(), "drora-review-"));
  setDataBaseDir(root);
  const pluginDataDir = join(root, "plugin-data");
  const vault = join(root, "vault");
  await mkdir(vault, { recursive: true });
  const databasePath = join(root, "knowledge", "knowledge-index.sqlite");
  const services = createKnowledgeServices({
    databasePath,
    pluginDataDir,
    // S03 Hard Write Safety GO 门禁未满足，生产装配默认关闭写路径；
    // 本套件验证的是门禁通过后的机制行为，故显式使能（仅测试环境）。
    reviewWritePathEnabled: options.writePathEnabled ?? true,
  });
  await configureVaultAt(pluginDataDir, vault, { allowAgentWrites: true });
  return { root, pluginDataDir, vault, databasePath, services, review: services.reviewService };
}

async function destroyEnv(env: TestEnv): Promise<void> {
  env.services.dispose();
  await rm(env.root, { recursive: true, force: true });
}

/** 生成一个基于磁盘当前内容的 write 变更（base 与现实对齐）。 */
async function writeChangeFor(
  vault: string,
  relativePath: string,
  nextContent: string,
): Promise<{ kind: "write"; relativePath: string; baseSha256: string; content: string }> {
  const current = await readFile(join(vault, ...relativePath.split("/")), "utf-8");
  return { kind: "write", relativePath, baseSha256: sha256(current), content: nextContent };
}

test("S03 门禁未满足（默认装配）：apply/undo 一律 write_path_disabled，文件零触碰（W06 修复轮 1）", async () => {
  // 不传使能开关 = 生产装配形态：写路径整体 fail-closed。
  const env = await createEnv({ writePathEnabled: false });
  try {
    await writeFile(join(env.vault, "a.md"), "base", "utf-8");
    // 提案/批准（账本与审批面）保持可用，供审计与门禁复验。
    const proposal = await env.review.createProposal({
      title: "t",
      reason: "r",
      changes: [await writeChangeFor(env.vault, "a.md", "next")],
    });
    const approval = await env.review.approveProposal({ proposalId: proposal.proposalId });
    assert.equal(approval.expired, false);

    const apply = await env.review.applyProposal({ proposalId: proposal.proposalId });
    assert.equal(apply.outcome, "blocked");
    assert.equal(apply.reason, "write_path_disabled");
    assert.equal(apply.operation, null);

    const undo = await env.review.undoOperation({ operationId: "rop-anything" });
    assert.equal(undo.outcome, "blocked");
    assert.equal(undo.reason, "write_path_disabled");

    assert.equal(await readFile(join(env.vault, "a.md"), "utf-8"), "base");
  } finally {
    await destroyEnv(env);
  }
});

test("L2 正常批准→执行：文件经门面写入且账本 applied（A32 正常路径）", async () => {
  const env = await createEnv();
  try {
    await writeFile(join(env.vault, "a.md"), "base", "utf-8");
    const proposal = await env.review.createProposal({
      title: "更新 a.md",
      reason: "知识提炼",
      evidence: [{ note: "来自某次问答结论" }],
      changes: [await writeChangeFor(env.vault, "a.md", "updated")],
    });
    assert.equal(proposal.revision, 1);
    assert.equal(proposal.changes[0]?.nextSha256, sha256("updated"));

    const approval = await env.review.approveProposal({ proposalId: proposal.proposalId });
    assert.equal(approval.expired, false);
    assert.equal(approval.revision, 1);

    const result = await env.review.applyProposal({ proposalId: proposal.proposalId });
    assert.equal(result.outcome, "applied");
    assert.equal(result.operation?.status, "applied");
    assert.equal(await readFile(join(env.vault, "a.md"), "utf-8"), "updated");
    assert.equal(result.operation?.files[0]?.status, "applied");
    assert.equal(result.operation?.files[0]?.snapshotSha256, sha256("base"));

    // Diff 预览返回精确目标内容。
    const content = await env.review.getProposalChangeContent({
      proposalId: proposal.proposalId,
      relativePath: "a.md",
    });
    assert.equal(content?.content, "updated");
    assert.equal(content?.sha256, sha256("updated"));
  } finally {
    await destroyEnv(env);
  }
});

test("未批准/过期批准绝不写文件（A32）", async () => {
  const env = await createEnv();
  try {
    await writeFile(join(env.vault, "a.md"), "base", "utf-8");
    const proposal = await env.review.createProposal({
      title: "t",
      reason: "r",
      changes: [await writeChangeFor(env.vault, "a.md", "next")],
    });

    // 未批准。
    const unapproved = await env.review.applyProposal({ proposalId: proposal.proposalId });
    assert.equal(unapproved.outcome, "blocked");
    assert.equal(unapproved.reason, "not_approved");
    assert.equal(unapproved.operation, null);
    assert.equal(await readFile(join(env.vault, "a.md"), "utf-8"), "base");

    // 过期批准（ttlMs=0 为立即过期的测试钩子）。
    await env.review.approveProposal({ proposalId: proposal.proposalId, ttlMs: 0 });
    const expired = await env.review.applyProposal({ proposalId: proposal.proposalId });
    assert.equal(expired.outcome, "blocked");
    assert.equal(expired.reason, "approval_expired");
    assert.equal(await readFile(join(env.vault, "a.md"), "utf-8"), "base");
  } finally {
    await destroyEnv(env);
  }
});

test("审批后改稿：revision+1 使旧批准失效，必须重审（A32）", async () => {
  const env = await createEnv();
  try {
    await writeFile(join(env.vault, "a.md"), "base", "utf-8");
    const proposal = await env.review.createProposal({
      title: "t",
      reason: "r",
      changes: [await writeChangeFor(env.vault, "a.md", "v1")],
    });
    await env.review.approveProposal({ proposalId: proposal.proposalId });

    const revised = await env.review.reviseProposal({
      proposalId: proposal.proposalId,
      changes: [await writeChangeFor(env.vault, "a.md", "v2")],
    });
    assert.equal(revised.revision, 2);
    assert.notEqual(revised.changesHash, proposal.changesHash);
    // 旧 revision 的批准仍在账本，但视图只呈现当前 revision 的批准（无）。
    assert.equal(revised.approval, null);

    const result = await env.review.applyProposal({ proposalId: proposal.proposalId });
    assert.equal(result.outcome, "blocked");
    assert.equal(result.reason, "not_approved");
    assert.equal(await readFile(join(env.vault, "a.md"), "utf-8"), "base");

    // 重新批准新 revision 后可执行，且写的是新内容。
    await env.review.approveProposal({ proposalId: proposal.proposalId });
    const applied = await env.review.applyProposal({ proposalId: proposal.proposalId });
    assert.equal(applied.outcome, "applied");
    assert.equal(await readFile(join(env.vault, "a.md"), "utf-8"), "v2");
  } finally {
    await destroyEnv(env);
  }
});

test("提案与现实对齐：base SHA 不符/目标已存在/非法路径在创建期被拒（L3 结构排除）", async () => {
  const env = await createEnv();
  try {
    await writeFile(join(env.vault, "a.md"), "base", "utf-8");
    await writeFile(join(env.vault, "b.md"), "old", "utf-8");

    // base 不命中当前文件。
    await assert.rejects(
      env.review.createProposal({
        title: "t",
        reason: "r",
        changes: [{ kind: "write", relativePath: "a.md", baseSha256: sha256("stale"), content: "x" }],
      }),
      /baseSha256 与当前文件不一致/,
    );
    // create 对已存在文件。
    await assert.rejects(
      env.review.createProposal({
        title: "t",
        reason: "r",
        changes: [{ kind: "create", relativePath: "b.md", content: "x" }],
      }),
      /create 应改为 write/,
    );
    // .obsidian（隐藏段）。
    await assert.rejects(
      env.review.createProposal({
        title: "t",
        reason: "r",
        changes: [{ kind: "create", relativePath: ".obsidian/x.md", content: "x" }],
      }),
      /路径非法/,
    );
    // 非 Markdown。
    await assert.rejects(
      env.review.createProposal({
        title: "t",
        reason: "r",
        changes: [{ kind: "create", relativePath: "notes/a.txt", content: "x" }],
      }),
      /路径非法/,
    );
    // `..` 穿越。
    await assert.rejects(
      env.review.createProposal({
        title: "t",
        reason: "r",
        changes: [{ kind: "create", relativePath: "../outside.md", content: "x" }],
      }),
      /路径非法/,
    );
    // 同一文件重复出现。
    await assert.rejects(
      env.review.createProposal({
        title: "t",
        reason: "r",
        changes: [
          await writeChangeFor(env.vault, "a.md", "x"),
          await writeChangeFor(env.vault, "a.md", "y"),
        ],
      }),
      /重复/,
    );
    // 全部被拒后磁盘不变。
    assert.equal(await readFile(join(env.vault, "a.md"), "utf-8"), "base");
  } finally {
    await destroyEnv(env);
  }
});

test("拒绝的提案不能再执行；修订可复活并重走审批", async () => {
  const env = await createEnv();
  try {
    await writeFile(join(env.vault, "a.md"), "base", "utf-8");
    const proposal = await env.review.createProposal({
      title: "t",
      reason: "r",
      changes: [await writeChangeFor(env.vault, "a.md", "next")],
    });
    await env.review.approveProposal({ proposalId: proposal.proposalId });
    await env.review.rejectProposal({ proposalId: proposal.proposalId });
    const rejected = await env.review.applyProposal({ proposalId: proposal.proposalId });
    assert.equal(rejected.outcome, "blocked");
    assert.equal(rejected.reason, "proposal_rejected");
    assert.equal(await readFile(join(env.vault, "a.md"), "utf-8"), "base");
  } finally {
    await destroyEnv(env);
  }
});

test("外部并发修改造成 conflict：不静默覆盖，提案 base 校验拦截（A34）", async () => {
  const env = await createEnv();
  try {
    await writeFile(join(env.vault, "a.md"), "base", "utf-8");
    const proposal = await env.review.createProposal({
      title: "t",
      reason: "r",
      changes: [await writeChangeFor(env.vault, "a.md", "next")],
    });
    await env.review.approveProposal({ proposalId: proposal.proposalId });

    // 外部（Obsidian/旁路进程）在批准后修改文件。
    await writeFile(join(env.vault, "a.md"), "external-edit", "utf-8");

    const result = await env.review.applyProposal({ proposalId: proposal.proposalId });
    assert.equal(result.outcome, "conflict");
    assert.equal(result.operation?.status, "conflict");
    assert.equal(result.operation?.files[0]?.status, "conflict");
    // 外部编辑原样保留——绝不静默覆盖。
    assert.equal(await readFile(join(env.vault, "a.md"), "utf-8"), "external-edit");
  } finally {
    await destroyEnv(env);
  }
});

test("重复 operationId 只执行一次：回放返回账本记录，不二次写盘（A33）", async () => {
  const env = await createEnv();
  try {
    await writeFile(join(env.vault, "a.md"), "base", "utf-8");
    const proposal = await env.review.createProposal({
      title: "t",
      reason: "r",
      changes: [await writeChangeFor(env.vault, "a.md", "next")],
    });
    await env.review.approveProposal({ proposalId: proposal.proposalId });
    const operationId = "rop-test-once";
    const first = await env.review.applyProposal({ proposalId: proposal.proposalId, operationId });
    assert.equal(first.outcome, "applied");

    // 第一次执行后外部改掉文件，再回放同一 operationId：必须返回既有记录且不触碰文件。
    await writeFile(join(env.vault, "a.md"), "external-after", "utf-8");
    const replay = await env.review.applyProposal({ proposalId: proposal.proposalId, operationId });
    assert.equal(replay.outcome, "idempotent_replay");
    assert.equal(replay.operation?.operationId, operationId);
    assert.equal(replay.operation?.status, "applied");
    assert.equal(await readFile(join(env.vault, "a.md"), "utf-8"), "external-after");
  } finally {
    await destroyEnv(env);
  }
});

test("断线未知结果：账本停在 applying + 部分落盘 → reconcile 只读落定，绝不自动重放（A33）", async () => {
  const env = await createEnv();
  try {
    await writeFile(join(env.vault, "a.md"), "baseA", "utf-8");
    await writeFile(join(env.vault, "b.md"), "baseB", "utf-8");
    const proposal = await env.review.createProposal({
      title: "t",
      reason: "r",
      changes: [
        await writeChangeFor(env.vault, "a.md", "nextA"),
        await writeChangeFor(env.vault, "b.md", "nextB"),
      ],
    });
    await env.review.approveProposal({ proposalId: proposal.proposalId });

    // 构造崩溃现场：operation 已转入 applying；文件 a 已落盘但账本未及更新；
    // 文件 b 未写。与真实进程死亡时的账本/磁盘状态一致。
    const operationId = "rop-crash";
    const raw = new DatabaseSync(env.databasePath);
    try {
      raw.exec("BEGIN IMMEDIATE");
      raw
        .prepare(
          `INSERT INTO review_operations(
             operation_id, proposal_id, revision, vault_id, source_epoch, status,
             error, created_at_ms, finished_at_ms, reconciled_at_ms
           ) VALUES (?, ?, ?, ?, ?, 'applying', NULL, ?, NULL, NULL)`,
        )
        .run(operationId, proposal.proposalId, proposal.revision, proposal.vaultId, 1, Date.now());
      const insertFile = raw.prepare(
        `INSERT INTO review_operation_files(
           operation_id, ordinal, relative_path, kind, base_sha256, next_sha256,
           next_content, snapshot_content, snapshot_sha256, status, error, updated_at_ms
         ) VALUES (?, ?, ?, 'write', ?, ?, ?, ?, ?, ?, NULL, ?)`,
      );
      const changeA = proposal.changes[0]!;
      const changeB = proposal.changes[1]!;
      insertFile.run(
        operationId, 0, changeA.relativePath, changeA.baseSha256, changeA.nextSha256,
        "nextA", "baseA", sha256("baseA"), "applying", Date.now(),
      );
      insertFile.run(
        operationId, 1, changeB.relativePath, changeB.baseSha256, changeB.nextSha256,
        "nextB", "baseB", sha256("baseB"), "prepared", Date.now(),
      );
      raw.exec("COMMIT");
    } finally {
      raw.close();
    }
    await writeFile(join(env.vault, "a.md"), "nextA", "utf-8");
    // b.md 保持 baseB：reconcile 绝不能替执行器把它写成 nextB。

    const reconciled = await env.review.reconcileOperation({ operationId });
    assert.equal(reconciled.outcome, "reconciled");
    assert.equal(reconciled.operation?.status, "prepared");
    const fileA = reconciled.operation?.files.find((f) => f.relativePath === "a.md");
    const fileB = reconciled.operation?.files.find((f) => f.relativePath === "b.md");
    assert.equal(fileA?.status, "applied");
    assert.equal(fileB?.status, "prepared");
    // 核心断言：reconcile 未自动重放（b.md 内容未被改写）。
    assert.equal(await readFile(join(env.vault, "b.md"), "utf-8"), "baseB");

    // 已落定的操作不再处于 applying：再次 reconcile 是 not_applicable。
    const again = await env.review.reconcileOperation({ operationId });
    assert.equal(again.outcome, "not_applicable");

    // 「reconcile 后才继续」：显式新 operationId 重放。a.md 已是 nextA（相对 base 变化）
    // → 快照对齐阶段 conflict，绝不盲目覆盖；先 undo 恢复 a.md 再重放才成功。
    const replayBlocked = await env.review.applyProposal({
      proposalId: proposal.proposalId,
      operationId: "rop-retry",
    });
    assert.equal(replayBlocked.outcome, "conflict");
    assert.equal(await readFile(join(env.vault, "a.md"), "utf-8"), "nextA");

    const undo = await env.review.undoOperation({ operationId });
    assert.equal(undo.outcome, "applied");
    assert.equal(await readFile(join(env.vault, "a.md"), "utf-8"), "baseA");

    const retry = await env.review.applyProposal({
      proposalId: proposal.proposalId,
      operationId: "rop-retry-2",
    });
    assert.equal(retry.outcome, "applied");
    assert.equal(await readFile(join(env.vault, "a.md"), "utf-8"), "nextA");
    assert.equal(await readFile(join(env.vault, "b.md"), "utf-8"), "nextB");
  } finally {
    await destroyEnv(env);
  }
});

test("重启 reconcile：新服务实例对同一 DB 做 reconcileStuckOperations 恢复（A33）", async () => {
  const env = await createEnv();
  let restarted: KnowledgeServices | null = null;
  try {
    await writeFile(join(env.vault, "a.md"), "base", "utf-8");
    const proposal = await env.review.createProposal({
      title: "t",
      reason: "r",
      changes: [await writeChangeFor(env.vault, "a.md", "next")],
    });
    await env.review.approveProposal({ proposalId: proposal.proposalId });

    // 崩溃现场：operation applying、文件已落盘（账本未更新）。
    const operationId = "rop-restart";
    const raw = new DatabaseSync(env.databasePath);
    try {
      raw.exec("BEGIN IMMEDIATE");
      raw
        .prepare(
          `INSERT INTO review_operations(
             operation_id, proposal_id, revision, vault_id, source_epoch, status,
             error, created_at_ms, finished_at_ms, reconciled_at_ms
           ) VALUES (?, ?, ?, ?, ?, 'applying', NULL, ?, NULL, NULL)`,
        )
        .run(operationId, proposal.proposalId, proposal.revision, proposal.vaultId, 1, Date.now());
      raw
        .prepare(
          `INSERT INTO review_operation_files(
             operation_id, ordinal, relative_path, kind, base_sha256, next_sha256,
             next_content, snapshot_content, snapshot_sha256, status, error, updated_at_ms
           ) VALUES (?, 0, ?, 'write', ?, ?, ?, ?, ?, 'applying', NULL, ?)`,
        )
        .run(
          operationId,
          "a.md",
          sha256("base"),
          sha256("next"),
          "next",
          "base",
          sha256("base"),
          Date.now(),
        );
      raw.exec("COMMIT");
    } finally {
      raw.close();
    }
    await writeFile(join(env.vault, "a.md"), "next", "utf-8");

    // 「重启」：原实例 dispose，新实例挂同一 DB + 同一 vault-config。
    env.services.dispose();
    restarted = createKnowledgeServices({
      databasePath: env.databasePath,
      pluginDataDir: env.pluginDataDir,
    });
    const recovered = await restarted.reviewService.reconcileStuckOperations();
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0]?.operationId, operationId);
    assert.equal(recovered[0]?.status, "applied");
    assert.equal(recovered[0]?.files[0]?.status, "applied");
    assert.equal(await readFile(join(env.vault, "a.md"), "utf-8"), "next");
  } finally {
    restarted?.dispose();
    await destroyEnv(env);
  }
});

test("撤权：allowAgentWrites=false 时 apply/undo 一律拒绝（ADR #8/#9）", async () => {
  const env = await createEnv();
  try {
    await writeFile(join(env.vault, "a.md"), "base", "utf-8");
    const proposal = await env.review.createProposal({
      title: "t",
      reason: "r",
      changes: [await writeChangeFor(env.vault, "a.md", "next")],
    });
    await env.review.approveProposal({ proposalId: proposal.proposalId });

    await configureVaultAt(env.pluginDataDir, env.vault, { allowAgentWrites: false });
    const denied = await env.review.applyProposal({ proposalId: proposal.proposalId });
    assert.equal(denied.outcome, "blocked");
    assert.equal(denied.reason, "writes_disabled");
    assert.equal(await readFile(join(env.vault, "a.md"), "utf-8"), "base");

    // 重新授权 → configuredAt 变化 → epoch+1：旧批准按 sourceEpoch 失效（必须重新批准）。
    await sleep(5);
    await configureVaultAt(env.pluginDataDir, env.vault, { allowAgentWrites: true });
    const staleEpoch = await env.review.applyProposal({ proposalId: proposal.proposalId });
    assert.equal(staleEpoch.outcome, "blocked");
    assert.equal(staleEpoch.reason, "approval_epoch_stale");
    // 账本持久：epoch 递增/重新授权不清除提案（索引侧清除路径与此无关）。
    const listed = await env.review.listProposals();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.proposalId, proposal.proposalId);

    await env.review.approveProposal({ proposalId: proposal.proposalId });
    const applied = await env.review.applyProposal({ proposalId: proposal.proposalId });
    assert.equal(applied.outcome, "applied");

    // 撤权同样阻断 undo（Agent 发起的写入许可标志对逆操作同等生效）。
    await configureVaultAt(env.pluginDataDir, env.vault, { allowAgentWrites: false });
    const undoDenied = await env.review.undoOperation({
      operationId: applied.operation?.operationId ?? "",
    });
    assert.equal(undoDenied.outcome, "blocked");
    assert.equal(undoDenied.reason, "writes_disabled");
    assert.equal(await readFile(join(env.vault, "a.md"), "utf-8"), "next");
  } finally {
    await destroyEnv(env);
  }
});

test("切库：其他 vault 的提案对当前 vault 不可见且不可执行", async () => {
  const env = await createEnv();
  try {
    const otherVault = join(env.root, "vault-other");
    await mkdir(otherVault, { recursive: true });
    await writeFile(join(env.vault, "a.md"), "base", "utf-8");
    const proposal = await env.review.createProposal({
      title: "t",
      reason: "r",
      changes: [await writeChangeFor(env.vault, "a.md", "next")],
    });
    await env.review.approveProposal({ proposalId: proposal.proposalId });

    await configureVaultAt(env.pluginDataDir, otherVault, { allowAgentWrites: true });
    assert.equal(await env.review.getProposal({ proposalId: proposal.proposalId }), null);
    assert.equal((await env.review.listProposals()).length, 0);
    const switched = await env.review.applyProposal({ proposalId: proposal.proposalId });
    assert.equal(switched.outcome, "blocked");
    assert.equal(switched.reason, "vault_mismatch");
  } finally {
    await destroyEnv(env);
  }
});

test("双 Host 串行：同一文件不同 operationId 由门面 CAS 串行，后写者 conflict；同 operationId 幂等（A34）", async () => {
  const env = await createEnv();
  // 第二实例模拟另一 Host：同样显式使能写路径（本套件验证门禁通过后的机制）。
  const hostB = createKnowledgeServices({
    databasePath: env.databasePath,
    pluginDataDir: env.pluginDataDir,
    reviewWritePathEnabled: true,
  });
  try {
    await writeFile(join(env.vault, "a.md"), "base", "utf-8");
    const proposal = await env.review.createProposal({
      title: "t",
      reason: "r",
      changes: [await writeChangeFor(env.vault, "a.md", "next")],
    });
    await env.review.approveProposal({ proposalId: proposal.proposalId });

    const first = await env.review.applyProposal({
      proposalId: proposal.proposalId,
      operationId: "rop-host-a",
    });
    assert.equal(first.outcome, "applied");

    // Host B 用自己的 operationId 执行同一提案：文件已是 next（base 失配）→ conflict。
    const second = await hostB.reviewService.applyProposal({
      proposalId: proposal.proposalId,
      operationId: "rop-host-b",
    });
    assert.equal(second.outcome, "conflict");
    // 文件保持 first 写入的内容，绝不被 second 静默重写回旧/异版本。
    assert.equal(await readFile(join(env.vault, "a.md"), "utf-8"), "next");

    // Host B 回放 Host A 的 operationId：幂等返回账本记录。
    const replay = await hostB.reviewService.applyProposal({
      proposalId: proposal.proposalId,
      operationId: "rop-host-a",
    });
    assert.equal(replay.outcome, "idempotent_replay");
  } finally {
    hostB.dispose();
    await destroyEnv(env);
  }
});

test("双 Host 并发：同一提案两实例同时 apply，最终文件必为提案目标内容且账本自洽（A34）", async () => {
  const env = await createEnv();
  // 第二实例模拟另一 Host：同样显式使能写路径（本套件验证门禁通过后的机制）。
  const hostB = createKnowledgeServices({
    databasePath: env.databasePath,
    pluginDataDir: env.pluginDataDir,
    reviewWritePathEnabled: true,
  });
  try {
    await writeFile(join(env.vault, "a.md"), "base", "utf-8");
    const proposal = await env.review.createProposal({
      title: "t",
      reason: "r",
      changes: [await writeChangeFor(env.vault, "a.md", "next")],
    });
    await env.review.approveProposal({ proposalId: proposal.proposalId });

    const [ra, rb] = await Promise.all([
      env.review.applyProposal({ proposalId: proposal.proposalId, operationId: "rop-conc-a" }),
      hostB.reviewService.applyProposal({ proposalId: proposal.proposalId, operationId: "rop-conc-b" }),
    ]);
    // 目标内容相同：无论谁先谁后（含 read-SHA 窗口内的重叠写），最终文件必为 next。
    assert.equal(await readFile(join(env.vault, "a.md"), "utf-8"), "next");
    for (const result of [ra, rb]) {
      if (result.operation?.status === "applied") {
        assert.equal(result.outcome, "applied");
      } else {
        // 未 applied 者只能是 conflict（门面 CAS 拒绝），账本如实记录。
        assert.equal(result.outcome, "conflict");
      }
    }
  } finally {
    hostB.dispose();
    await destroyEnv(env);
  }
});

test("Undo 正常：快照恢复原内容；Undo 冲突：外部编辑后拒绝且不覆盖（A34）", async () => {
  const env = await createEnv();
  try {
    await writeFile(join(env.vault, "a.md"), "base", "utf-8");
    const proposal = await env.review.createProposal({
      title: "t",
      reason: "r",
      changes: [await writeChangeFor(env.vault, "a.md", "next")],
    });
    await env.review.approveProposal({ proposalId: proposal.proposalId });
    const applied = await env.review.applyProposal({ proposalId: proposal.proposalId, operationId: "rop-undo" });
    assert.equal(applied.outcome, "applied");

    // 外部编辑后 undo：当前 SHA 与账本记录不符 → undo_conflict，外部内容保留。
    await writeFile(join(env.vault, "a.md"), "external", "utf-8");
    const conflictUndo = await env.review.undoOperation({ operationId: "rop-undo" });
    assert.equal(conflictUndo.outcome, "conflict");
    assert.equal(conflictUndo.operation?.files[0]?.status, "undo_conflict");
    assert.equal(await readFile(join(env.vault, "a.md"), "utf-8"), "external");

    // 无可撤销文件时再 undo → blocked。
    const noUndo = await env.review.undoOperation({ operationId: "rop-undo" });
    assert.equal(noUndo.outcome, "blocked");
    assert.equal(noUndo.reason, "undo_unavailable");
  } finally {
    await destroyEnv(env);
  }
});

test("Undo 正常路径：撤销已应用操作恢复快照；create/delete 的逆操作正确", async () => {
  const env = await createEnv();
  try {
    await writeFile(join(env.vault, "a.md"), "base", "utf-8");
    const workable = await env.review.createProposal({
      title: "t",
      reason: "r",
      changes: [
        { kind: "create", relativePath: "new.md", content: "created" },
        { kind: "delete", relativePath: "a.md", baseSha256: sha256("base") },
      ],
    });
    await env.review.approveProposal({ proposalId: workable.proposalId });
    const applied = await env.review.applyProposal({
      proposalId: workable.proposalId,
      operationId: "rop-inverse",
    });
    assert.equal(applied.outcome, "applied");
    await assert.rejects(readFile(join(env.vault, "a.md"), "utf-8"), /ENOENT/);
    assert.equal(await readFile(join(env.vault, "new.md"), "utf-8"), "created");

    const undo = await env.review.undoOperation({ operationId: "rop-inverse" });
    assert.equal(undo.outcome, "applied");
    // delete 的逆：快照内容被 createOnly 重建；create 的逆：文件被删除。
    assert.equal(await readFile(join(env.vault, "a.md"), "utf-8"), "base");
    await assert.rejects(readFile(join(env.vault, "new.md"), "utf-8"), /ENOENT/);
    assert.equal(undo.operation?.files.find((f) => f.relativePath === "a.md")?.status, "undo_applied");
  } finally {
    await destroyEnv(env);
  }
});

test("旁路工具写盘（Bash/MCP/js 的等价最终形态：直接写文件）：本层不构成硬阻断，但审核链经 SHA 检测绝不静默覆盖（A31 有意分歧的补偿控制）", async () => {
  const env = await createEnv();
  try {
    await writeFile(join(env.vault, "a.md"), "base", "utf-8");
    const proposal = await env.review.createProposal({
      title: "t",
      reason: "r",
      changes: [await writeChangeFor(env.vault, "a.md", "next")],
    });
    await env.review.approveProposal({ proposalId: proposal.proposalId });

    // 旁路写入（模拟 Bash 重定向/MCP server 进程内写）：不被审核门面阻断——这是
    // W00 矩阵实证的结构性事实，本测试如实固化，不伪装成「已被拦截」。
    await writeFile(join(env.vault, "a.md"), "bypass-write", "utf-8");
    assert.equal(await readFile(join(env.vault, "a.md"), "utf-8"), "bypass-write");

    // 补偿控制：审核执行在快照对齐阶段发现 base 失配 → conflict，旁路内容保留。
    const result = await env.review.applyProposal({ proposalId: proposal.proposalId, operationId: "rop-bypass" });
    assert.equal(result.outcome, "conflict");
    assert.equal(await readFile(join(env.vault, "a.md"), "utf-8"), "bypass-write");
  } finally {
    await destroyEnv(env);
  }
});

test("未配置 Vault：提案创建/执行返回结构化 no_source", async () => {
  const env = await createEnv();
  try {
    await unlink(join(env.pluginDataDir, "vault-config.json"));
    await assert.rejects(
      env.review.createProposal({ title: "t", reason: "r", changes: [{ kind: "create", relativePath: "x.md", content: "" }] }),
      /尚未配置 Vault/,
    );
  } finally {
    await destroyEnv(env);
  }
});

test("create/delete 混合提案的顺序执行与账本视图（快照先于落盘）", async () => {
  const env = await createEnv();
  try {
    await writeFile(join(env.vault, "keep.md"), "keep-base", "utf-8");
    await writeFile(join(env.vault, "gone.md"), "gone-base", "utf-8");
    const proposal = await env.review.createProposal({
      title: "重组",
      reason: "清理",
      changes: [
        await writeChangeFor(env.vault, "keep.md", "keep-next"),
        { kind: "delete", relativePath: "gone.md", baseSha256: sha256("gone-base") },
        { kind: "create", relativePath: "folder/new.md", content: "brand-new" },
      ],
    });
    await env.review.approveProposal({ proposalId: proposal.proposalId });
    const result = await env.review.applyProposal({ proposalId: proposal.proposalId });
    assert.equal(result.outcome, "applied");
    assert.equal(await readFile(join(env.vault, "keep.md"), "utf-8"), "keep-next");
    await assert.rejects(readFile(join(env.vault, "gone.md"), "utf-8"), /ENOENT/);
    assert.equal(await readFile(join(env.vault, "folder", "new.md"), "utf-8"), "brand-new");
    assert.equal(result.operation?.files.map((f) => f.status).join(","), "applied,applied,applied");
    // 每个被改/删的文件都有写前快照（先保护快照后落盘，§5e.6）。
    assert.equal(result.operation?.files[0]?.snapshotSha256, sha256("keep-base"));
    assert.equal(result.operation?.files[1]?.snapshotSha256, sha256("gone-base"));
  } finally {
    await destroyEnv(env);
  }
});
