// 移动端远程控制·启动恢复（对齐原版 webRemoteControlLastEnabledContext /
// restorePreviouslyEnabled 语义）：
// - start 成功即持久化 {workspacePath, workspaceIdentity}；
// - 手动停止即清除；窗口关闭/应用退出保留；
// - 下次应用启动、窗口 Host 就绪且工作区匹配时自动恢复一次（每次运行至多恢复一次）。
// 原版存于 settings store 单键；Main 进程不持有 settings 写句柄（由 Host 侧 settings
// 服务独占写盘，避免双写竞态），故用 Main 自有的单键 JSON 文件承载同一形状。
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const RESTORE_FILE_NAME = "mobile-pairing-last-enabled-context.json";

export interface MobilePairingRestoreContext {
  workspacePath: string;
  workspaceIdentity?: string;
}

export class MobilePairingRestoreStore {
  private readonly filePath: string;

  constructor(optionsDir: string) {
    this.filePath = join(optionsDir, RESTORE_FILE_NAME);
  }

  async load(): Promise<MobilePairingRestoreContext | null> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        typeof (parsed as { workspacePath?: unknown }).workspacePath !== "string" ||
        (parsed as { workspacePath: string }).workspacePath.trim() === ""
      ) {
        return null;
      }
      const record = parsed as { workspacePath: string; workspaceIdentity?: unknown };
      return {
        workspacePath: record.workspacePath,
        ...(typeof record.workspaceIdentity === "string" && record.workspaceIdentity.trim() !== ""
          ? { workspaceIdentity: record.workspaceIdentity }
          : {}),
      };
    } catch {
      // 文件不存在/损坏等同"无恢复上下文"（原版 load 失败仅 warn 并继续）。
      return null;
    }
  }

  async save(context: MobilePairingRestoreContext): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const payload: MobilePairingRestoreContext = {
      workspacePath: context.workspacePath,
      ...(context.workspaceIdentity ? { workspaceIdentity: context.workspaceIdentity } : {}),
    };
    await writeFile(this.filePath, JSON.stringify(payload, null, 2), "utf-8");
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true });
  }
}

/** 工作区身份 key（AGENTS.md：workspaceIdentity?.trim() || workspacePath）。 */
export function workspaceKeyOf(target: {
  workspacePath?: string;
  workspaceIdentity?: string;
}): string | null {
  const identity = target.workspaceIdentity?.trim();
  if (identity) return identity;
  const path = target.workspacePath?.trim();
  return path || null;
}

/**
 * 是否执行启动恢复（对齐原版 restorePreviouslyEnabled 的前置判定）：
 * - 有已保存上下文；
 * - 本次运行尚未 start 过配对服务、当前也没有运行中的服务；
 * - 目标窗口的 Host 主工作区与保存上下文是同一个工作区（原版按 workspaceKey 在
 *   窗口可用工作区列表中匹配，此处等价：Host 主工作区即窗口当前工作区）。
 */
export function shouldRestorePairing(input: {
  saved: MobilePairingRestoreContext | null;
  serviceRunning: boolean;
  alreadyStartedThisRun: boolean;
  hostWorkspace?: { workspacePath?: string; workspaceIdentity?: string };
}): boolean {
  const { saved, serviceRunning, alreadyStartedThisRun, hostWorkspace } = input;
  if (!saved || serviceRunning || alreadyStartedThisRun || !hostWorkspace?.workspacePath) {
    return false;
  }
  const savedKey = workspaceKeyOf(saved);
  return savedKey !== null && savedKey === workspaceKeyOf(hostWorkspace);
}
