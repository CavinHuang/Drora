import { isAbsolute, join, resolve } from "node:path";

import type { FileSystemPort, Logger, TraceContext } from "@drora/contracts";

import { ensureMemoryDirectoryExists } from "../memory/directory.js";
import type { MemoryRuntimeConfig } from "../runtime/types.js";
import type { AgentDefinitionsSnapshot } from "./definitions.js";
import type { AgentProfile, AgentMemoryScope } from "./profile.js";
import { buildPersistentAgentMemoryPrompt } from "./persistent-memory-prompt.js";

const PERSISTENT_MEMORY_TOOLS = ["Write", "Edit"] as const;

export function sanitizePersistentAgentMemoryKey(agentName: string): string {
  const key = agentName.replace(/[^a-zA-Z0-9_-]/g, "-");
  return key === "" ? "unknown" : key;
}

export function resolvePersistentAgentMemoryRoot(input: {
  agentName: string;
  scope: AgentMemoryScope;
  storageRoot: string;
  workspaceRoot: string;
}): string {
  const agentKey = sanitizePersistentAgentMemoryKey(input.agentName);
  // 修复：该根路径既是提示词里的 <MEMORY_ROOT>（模型面展示），也直接喂给 node fs。
  // Windows 的 join/resolve 产出反斜杠，导致提示词里的路径形态随平台漂移；node fs
  // 在 Windows 上接受正斜杠，故统一归一为正斜杠，展示与文件操作共用同一形态。
  if (input.scope === "user") {
    return join(input.storageRoot, "agent-memory", agentKey).replaceAll("\\", "/");
  }
  // 修复：宿主给的 workspaceRoot 已是绝对路径时按原样使用。Windows 的 resolve 会给
  // POSIX 风格的 "/workspace/app" 前置当前盘符（D:\workspace\app），令根路径形态随平台
  // 漂移；仅相对路径才需要补全。
  const workspace = isAbsolute(input.workspaceRoot) ? input.workspaceRoot : resolve(input.workspaceRoot);
  const root =
    input.scope === "project"
      ? join(workspace, ".drora", "agent-memory", agentKey)
      : join(workspace, ".drora", "agent-memory-local", agentKey);
  return root.replaceAll("\\", "/");
}

function isPersistentAgentMemoryEnabled(
  memory: MemoryRuntimeConfig | undefined,
): memory is MemoryRuntimeConfig & { storageRoot: string } {
  return memory?.enabled === true && memory.use !== false && Boolean(memory.storageRoot);
}

function withPersistentAgentMemoryTools(profile: AgentProfile): AgentProfile {
  if (!profile.memory || profile.tools === undefined) return profile;

  const tools = [...profile.tools];
  for (const tool of PERSISTENT_MEMORY_TOOLS) {
    if (!tools.includes(tool)) tools.push(tool);
  }
  return tools.length === profile.tools.length ? profile : { ...profile, tools };
}

export function projectPersistentAgentMemoryTools(
  definitions: AgentDefinitionsSnapshot,
  memory: MemoryRuntimeConfig | undefined,
): AgentDefinitionsSnapshot {
  if (!isPersistentAgentMemoryEnabled(memory)) return definitions;
  const profiles = definitions.activeAgents;

  const projected = profiles.map(withPersistentAgentMemoryTools);
  if (projected.every((profile, index) => profile === profiles[index])) return definitions;
  return {
    ...definitions,
    activeAgents: projected,
  };
}

export interface PersistentAgentMemory {
  rootDir: string;
  prompt: string;
}

export async function loadPersistentAgentMemory(input: {
  fileSystemPort: FileSystemPort | undefined;
  memory: MemoryRuntimeConfig | undefined;
  logger?: Logger;
  profile: AgentProfile;
  traceContext?: TraceContext;
  workspaceRoot: string;
}): Promise<PersistentAgentMemory | undefined> {
  if (!input.profile.memory || !input.fileSystemPort) return undefined;
  if (!isPersistentAgentMemoryEnabled(input.memory)) return undefined;

  const rootDir = resolvePersistentAgentMemoryRoot({
    agentName: input.profile.name,
    scope: input.profile.memory,
    storageRoot: input.memory.storageRoot,
    workspaceRoot: input.workspaceRoot,
  });
  await ensureMemoryDirectoryExists(
    input.fileSystemPort,
    rootDir,
    input.traceContext,
    input.logger,
  );

  let indexContent = "";
  try {
    // 修复：rootDir 已统一为正斜杠形态，这里 join 会再引入反斜杠（Windows），令
    // 路径形态回漂；node fs 在 Windows 接受正斜杠，读文件沿用同一形态。
    indexContent = (
      await input.fileSystemPort.readTextFile({ path: `${rootDir}/MEMORY.md` })
    ).content;
  } catch {
    // 不存在或不可读的 MEMORY.md 都使用基线的 empty index 文案。
  }

  return {
    rootDir,
    prompt: buildPersistentAgentMemoryPrompt({
      indexContent,
      rootDir,
      scope: input.profile.memory,
    }),
  };
}
