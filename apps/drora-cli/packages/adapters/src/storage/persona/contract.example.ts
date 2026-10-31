import type { PersonaEditableCore } from "@drora/shared";
import { openPersonaStore } from "./persona-store.js";

/**
 * cli-persona-store 用法示例（architecture-governance 五件套；只演示端口语义，
 * 不是可执行入口）。库路径必须由调用方从可信存储根解析：
 * join(getCliStorageRoot(), PERSONA_STORAGE_KEYS.directory, PERSONA_STORAGE_KEYS.database)。
 * 本示例用 openPersonaStore（在程 engine）演示端口语义；生产装配（bootstrap
 * persona-system）经 openWorkerPersonaStore 走正式异步 worker（合同 §2），端口 API 相同。
 */
export async function examplePersonaStoreFlow(
  dbPath: string,
  now: number,
): Promise<void> {
  const initialCore: PersonaEditableCore = {
    displayName: "Drora",
    selfDescription: "",
    warmth: "balanced",
    directness: "direct",
    humor: "light",
  };
  const store = await openPersonaStore({ dbPath });

  // 显式初始化：同 mutationId 重试回放，同 ID 异摘要拒绝。
  const initialized = await store.initializeAuthority({
    initialCore,
    mutationId: "example-init-mutation",
    now,
    requestDigest: "digest(initialCore)",
    templateVersion: 1,
  });
  if (!initialized.ok) throw new Error(`initialize failed: ${initialized.code}`);

  // CAS 更新：expectedRevision 不匹配返回 revision_conflict；同内容返回 unchanged。
  const updated = await store.updateCore({
    expectedRevision: initialized.value.snapshot.core.coreRevision,
    mutationId: "example-core-mutation",
    next: { ...initialCore, displayName: "Dro" },
    now,
    requestDigest: "digest(next)",
  });
  if (updated.ok && updated.value.status === "saved") {
    const snapshot = await store.readSnapshot();
    if (snapshot.state === "initialized") {
      assertRevision(snapshot.core.coreRevision, updated.value.coreRevision);
    }
  }

  // P1b 学习面：接收（evidenceId 幂等）→ 领取（租约/fence）→ 预算预留 → 提交。
  // 真实学习前置（E && Q && U && L && 预算 && 成功源证据）由服务层判定后才调用。
  const learning = store.learning;
  const accepted = await learning.acceptLearningEvidence({
    evidenceId: "example-evidence",
    sourceHandle: {
      authorityId: "example-authority",
      workspaceKey: "D:/workspace/example",
      sessionId: "example-session",
      productTurnId: "turn-1",
      origin: "local-desktop",
      sourceRevision: "rev-1",
      messageBoundary: "messages[3..4]",
      branchEvidence: "commit-boundary:rev-1",
    },
    policyEpoch: 0,
    keyGenerations: {},
    now,
  });
  if (accepted.ok && accepted.value.status === "accepted") {
    const claim = await learning.claimLearningWork({
      leaseOwner: "example-worker",
      leaseDurationMs: 60_000,
      now,
    });
    if (claim.ok && claim.value.status === "claimed") {
      const reserved = await learning.reserveLearningBudget({
        estimatedInputTokens: 800,
        maxOutputTokens: 200,
        now,
      });
      if (reserved.ok) {
        // 模型抽取发生在库外（无文件工具端口）；返回后单库提交并核销实际用量。
        await learning.commitLearningWork({
          workId: claim.value.claim.workId,
          fence: claim.value.claim.fence,
          candidates: [
            {
              key: "replyLanguage",
              value: "zh-CN",
              evidenceRefs: ["messages[3]:0..64"],
            },
          ],
          now,
        });
        await learning.settleLearningBudget({
          day: reserved.value.day,
          reservedInputTokens: 800,
          reservedOutputTokens: 200,
          confirmed: true,
          actualInputTokens: 640,
          actualOutputTokens: 120,
          now,
        });
      }
    }
  }
  await store.close();
}

function assertRevision(actual: number, expected: number): void {
  if (actual !== expected) throw new Error(`revision ${actual} != ${expected}`);
}
