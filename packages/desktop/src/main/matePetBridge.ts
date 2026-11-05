import { BrowserWindow, ipcMain } from "electron";
import {
  MATE_PET_COMMANDS,
  EMPTY_MATE_PET_PROJECTION,
  matePetCommandSchema,
  matePetProjectionSchema,
  type MatePetProjection,
  type MatePetRendererEvent,
} from "@drora/shared";

/**
 * Drora Mate 桌宠接缝 Main 侧桥（specs/drora-personal-assistant.md §11 P3 落地注记；
 * docs/mate-implementation-plan-2026-11-04/03-p3-detailed-design.md §6）。
 *
 * Main 只转发（spec §4 状态所有者表：Main/relay 不承载工单）：唯一职责是
 * ①接收主窗口 renderer 发布的有界 MatePetProjection（校验来源窗口 + zod，事件驱动
 * 通知 render 循环转发）；②把宠物窗/tray 窗的速览命令（open-ticket/decide）转发回
 * 主窗口 renderer 的导航端口（rendererEvent）——open-ticket 唤起主窗口（点卡直达
 * 语义），decide 不唤起（速览内放行不打断当前工作，状态一致性由同一服务的快照推送
 * 自然回传两侧）；③「打开大副」菜单动作=唤起主窗口并投 open-mate 事件。
 * 路由核心（core）为纯对象便于单测；electron 包装层只做 ipcMain 接线。
 */

/** 来源窗口判定回调（main/index.ts 的 windowHostProcessMap 同款判定注入）。 */
export type MatePetIsMainWindow = (window: BrowserWindow) => boolean;

/** 路由纯核（无 electron 依赖）：投影发布与命令转发的判定/状态推进。 */
export function createMatePetBridgeCore() {
  let sourceWindowId: number | null = null;
  let current: MatePetProjection = EMPTY_MATE_PET_PROJECTION;
  return {
    get current(): MatePetProjection {
      return current;
    },
    /** 消费发布帧：sender 必须是主窗口；payload 必须通过 schema。返回是否接受。 */
    consumeProjection(raw: unknown, senderIsMainWindow: boolean): boolean {
      if (!senderIsMainWindow) return false;
      const parsed = matePetProjectionSchema.safeParse(raw);
      if (!parsed.success) return false;
      current = parsed.data;
      return true;
    },
    /** 发布方窗口登记（rendererEvent 回投目标；窗口销毁时由包装层调用 detach）。 */
    attachSource(windowId: number): void {
      sourceWindowId = windowId;
    },
    detachSource(windowId: number): void {
      if (sourceWindowId === windowId) sourceWindowId = null;
    },
    /** rendererEvent 回投目标（最近发布方；null=尚无发布方或已销毁）。 */
    get targetWindowId(): number | null {
      return sourceWindowId;
    },
    /** 发布方缺席（尚无主窗口发布过投影）——open-mate 无法定位 renderer，诚实报否。 */
    get hasSource(): boolean {
      return sourceWindowId !== null;
    },
    /**
     * 消费宠物窗/tray 窗命令：payload 过 schema；非法/非宠物来源返回 null（静默丢弃——
     * 宠物窗口是不可信面，不做二次播报）。decide 的放行档预填由 Main 从当前投影查
     * （suggestedTier 透传；投影无此卡/无档=缺席，renderer 回落 build）——宠物窗命令
     * payload 不携带档位，不可信面不可自行指定权限档。
     */
    routeCommand(raw: unknown, senderIsPetWindow: boolean): MatePetRendererEvent | null {
      if (!senderIsPetWindow) return null;
      const parsed = matePetCommandSchema.safeParse(raw);
      if (!parsed.success) return null;
      const value = parsed.data;
      if (value.action === "open-ticket")
        return {
          kind: "open-ticket",
          ticketId: value.ticketId,
          ...(value.targetWorkspaceIdentity !== undefined
            ? { targetWorkspaceIdentity: value.targetWorkspaceIdentity }
            : {}),
        };
      const suggestedTier = current.pendingDecisions.find(
        (decision) => decision.decisionId === value.decisionId,
      )?.suggestedTier;
      return {
        kind: "decide",
        decisionId: value.decisionId,
        choice: value.choice,
        ...(suggestedTier !== undefined ? { suggestedTier } : {}),
      };
    },
  };
}

/** 桌宠接缝桥公开面（desktopPetWindow / drora-extensions 消费）。 */
export interface MatePetBridge {
  /** 当前投影（宠物窗/tray 窗 render 用）。 */
  current(): MatePetProjection;
  /** 「打开大副」：唤起主窗口并投 open-mate；无主窗口时 false（菜单项 no-op+warn）。 */
  openMate(): boolean;
  /**
   * 宠物/tray 命令入口（desktopPetWindow 按 fromPet/fromTray 守卫后调用）。
   * open-ticket 唤起主窗口直达工单；decide 只转发事件（不抢焦点）。
   */
  handleWindowCommand(raw: unknown, fromPetWindow: boolean): void;
  dispose(): void;
}

export function createMatePetBridge(options: {
  isMainWindow: MatePetIsMainWindow;
  logger: { warn: (...args: unknown[]) => void };
  /** 合法投影落地后的通知（desktopPetWindow 的 render——把新帧推给宠物窗/tray 窗）。 */
  onChange: () => void;
}): MatePetBridge {
  const core = createMatePetBridgeCore();

  const onPublish = (event: Electron.IpcMainEvent, raw: unknown): void => {
    const sender = BrowserWindow.fromWebContents(event.sender);
    const accepted =
      !!sender && !sender.isDestroyed() && core.consumeProjection(raw, options.isMainWindow(sender));
    if (!accepted) return;
    core.attachSource(sender.id);
    sender.once("closed", () => core.detachSource(sender.id));
    options.onChange();
  };

  /** 唤起主窗口（restore/show/focus，desktopPetSource.open 同款顺序）。 */
  const revealMainWindow = (window: BrowserWindow): void => {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  };

  /** 解析 rendererEvent 回投目标（最近发布方优先，退而取任一存活主窗口）。 */
  const resolveTarget = (): BrowserWindow | null => {
    const fromSource =
      core.targetWindowId !== null ? BrowserWindow.fromId(core.targetWindowId) : null;
    if (fromSource && !fromSource.isDestroyed()) return fromSource;
    return (
      BrowserWindow.getAllWindows().find(
        (window) => !window.isDestroyed() && options.isMainWindow(window),
      ) ?? null
    );
  };

  const bridge: MatePetBridge = {
    current: () => core.current,
    openMate(): boolean {
      const target = resolveTarget();
      if (!target) {
        options.logger.warn("[mate-pet] 打开大副失败：尚无可用主窗口（无投影发布方）");
        return false;
      }
      revealMainWindow(target);
      target.webContents.send(MATE_PET_COMMANDS.channels.rendererEvent, { kind: "open-mate" });
      return true;
    },
    handleWindowCommand(raw, fromPetWindow) {
      const routed = core.routeCommand(raw, fromPetWindow);
      if (!routed) return;
      const target = resolveTarget();
      if (!target) {
        options.logger.warn("[mate-pet] 速览命令丢弃：主窗口不可达");
        return;
      }
      // open-ticket=点卡直达（唤起窗口）；decide=速览内放行（不抢焦点，结果经快照推送
      // 回传两侧，一致性不依赖窗口前后顺序）。
      if (routed.kind === "open-ticket") revealMainWindow(target);
      target.webContents.send(MATE_PET_COMMANDS.channels.rendererEvent, routed);
    },
    dispose() {
      ipcMain.removeListener(MATE_PET_COMMANDS.channels.publish, onPublish);
    },
  };

  ipcMain.on(MATE_PET_COMMANDS.channels.publish, onPublish);
  return bridge;
}
