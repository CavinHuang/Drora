/**
 * cli-persona-service 标准调用示例（architecture-governance 五件套；只演示端口语义，
 * 不是可执行入口）。库路径只能来自可信存储根：resolvePersonaDatabasePath(getCliStorageRoot(...))。
 */
import { resolvePersonaDatabasePath, type PersonaAppService } from "./contract.js";
import { getProductPersonaTemplate } from "./product-template.js";

export async function examplePersonaServiceFlow(
  trustedCliStorageRoot: string,
  service: PersonaAppService,
  mutationId: string,
): Promise<void> {
  // 路径解析只做一次（装配层职责）；服务构造无 IO，首显式管理调用才打开库。
  const dbPath = resolvePersonaDatabasePath(trustedCliStorageRoot);
  if (dbPath === "") throw new Error("unreachable: resolver rejects empty roots");

  // 显式管理：overview 如实回答 uninitialized，不暗建身份。
  const overview = await service.getPersonaOverview();
  if (!overview.ok && overview.code !== "uninitialized") throw new Error(overview.code);

  // 初始化：同 mutationId 重试回放，同 ID 异摘要 mutation_conflict。
  const initialized = await service.initializePersona({ mutationId });
  if (!initialized.ok) throw new Error(initialized.code);

  // CAS 更新：expectedRevision 不匹配 revision_conflict；同内容 unchanged。
  const core = await service.getPersonaCore();
  if (!core.ok || core.value.state !== "current") throw new Error("expected initialized core");
  const updated = await service.updatePersonaCore({
    expectedRevision: core.value.coreRevision,
    patch: { displayName: "Dro" },
    mutationId: `${mutationId}:rename`,
  });
  if (updated.ok && updated.value.status === "saved") {
    const preview = await service.previewPersona({
      draft: getProductPersonaTemplate().defaultCore,
    });
    // 预览零副作用：不写库、不请求模型；同一草稿永远得到同一文本。
    if (preview.ok && preview.value.text === "") throw new Error("empty preview");
  }
  await service.close();
}
