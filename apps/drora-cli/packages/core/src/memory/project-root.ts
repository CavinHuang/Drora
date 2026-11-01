import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";

interface ProjectMemoryRootInput {
  cliStorageRoot: string;
  workspaceIdentity?: string;
  workspacePath: string;
}

export function resolveProjectMemoryRoot(input: ProjectMemoryRootInput): string {
  const workspaceIdentity = input.workspaceIdentity?.trim();
  const normalizedWorkspacePath = resolve(input.workspacePath);
  const keySource =
    workspaceIdentity ||
    (process.platform === "win32"
      ? normalizedWorkspacePath.toLowerCase()
      : normalizedWorkspacePath);
  const hash = createHash("sha256").update(keySource).digest("hex").slice(0, 16);
  const slug = workspaceIdentity
    ? "project"
    : sanitizeProjectSlug(basename(normalizedWorkspacePath) || "project");

  // 修复：该根路径进入提示词（`You have a persistent file based memory at \`<root>/\``）
  // 与记忆文件的规范键。Windows 的 join 产出反斜杠会令形态随平台漂移；node fs 在
  // Windows 接受正斜杠，统一归一为正斜杠。
  return join(input.cliStorageRoot, "memories", "projects", `${slug}-${hash}`, "memory").replaceAll(
    "\\",
    "/",
  );
}

function sanitizeProjectSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug.length > 0 ? slug : "project";
}
