import type { PersonaEditableCore } from "@drora/shared";
import { openPersonaStore } from "./persona-store.js";

/**
 * cli-persona-store 用法示例（architecture-governance 五件套；只演示端口语义，
 * 不是可执行入口）。库路径必须由调用方从可信存储根解析：
 * join(getCliStorageRoot(), PERSONA_STORAGE_KEYS.directory, PERSONA_STORAGE_KEYS.database)。
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
  await store.close();
}

function assertRevision(actual: number, expected: number): void {
  if (actual !== expected) throw new Error(`revision ${actual} != ${expected}`);
}
