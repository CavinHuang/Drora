/**
 * Renderer 内语音定向命令（spec §9.8.1）。canStop 不是会话路由：广播 cancelTask
 * 会让多个正在运行的会话各自通过守卫。取消只投递一个绑定目标；停播只投递播报 owner。
 */
export type VoiceCommandKind = "stopAnnouncement" | "stopAnnouncementPressed" | "cancelTask";
export interface VoiceCommandTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  sessionId: string | null;
}
export type VoiceCommandHandler = (kind: VoiceCommandKind) => void;
interface Registration {
  handler: VoiceCommandHandler;
  getTarget(): VoiceCommandTarget;
  isAnnouncementOwner(): boolean;
}
const handlers = new Set<Registration>();
const targetKey = (target: VoiceCommandTarget) =>
  JSON.stringify([target.workspaceIdentity?.trim() || target.workspacePath, target.sessionId]);

export function registerVoiceCommandHandler(
  handler: VoiceCommandHandler,
  routing: Pick<Registration, "getTarget" | "isAnnouncementOwner">,
): () => void {
  const registration = { handler, ...routing };
  handlers.add(registration);
  return () => {
    handlers.delete(registration);
  };
}

export function dispatchVoiceCommand(kind: VoiceCommandKind, target?: VoiceCommandTarget): void {
  const matching = Array.from(handlers).filter((registration) =>
    kind !== "cancelTask"
      ? registration.isAnnouncementOwner()
      : target?.sessionId != null && targetKey(registration.getTarget()) === targetKey(target),
  );
  // 同会话双 pane 只选一个处理者；优先播报 owner 才能同步静音，不能交给空闲副本。
  const recipient =
    matching.find((registration) => registration.isAnnouncementOwner()) ?? matching[0];
  recipient?.handler(kind);
}

export function resetVoiceCommandHandlersForTest(): void {
  handlers.clear();
}
