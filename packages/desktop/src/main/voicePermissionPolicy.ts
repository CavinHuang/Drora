import type { Session } from "electron";

/**
 * 语音听写 mic 权限策略（specs/voice-agent-integration.md §9.2 / §10 TV-5）。
 *
 * TV-5 keptOpen 的方案落地：「request + check 双 handler 都显式登记」——Electron 无
 * permission handler 的 session 对权限请求的缺省行为跨版本不确定且不可审计；显式登记后
 * app 主窗口 session 的权限面变成可审计的代码决定。
 *
 * 策略（行为保持 + 最小收紧）：
 * - media(audio)（麦克风，即听写拾音）：显式允许——开启路径已被产品门控（§6.1 默认隐藏
 *   入口 + §6.2 隐私三条披露 + §5.1 仅点按后开启），Main 不再叠加产品弹窗；
 *   IPlatformService 权限引导方法（§5.3 拒绝→设置引导）另行批次接入。
 * - media 含 video（摄像头/混合请求）：拒绝——本产品无摄像头能力，fail-closed。
 * - 其余权限：保持 Electron 缺省（无 handler 时自动批准）的现状，避免本策略引入
 *   与语音无关的功能回归；后续如需统一权限治理另立 spec。
 */

/**
 * DI 形状导出：main/index.ts 以既有 logger 结构注入，测试以 fake 结构断言；
 * 无具名 import 消费方（knip @lintignore 先例：useTaskSessionFilePath.ts:7）。
 * @lintignore
 */
export interface VoiceMicPermissionLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

/** request 侧 details 的结构化最小形状（Electron MediaAccessPermissionRequest 兼容；DI/测试按结构注入，无具名 import）。@lintignore */
export interface VoiceMicPermissionRequestDetails {
  mediaTypes?: readonly string[];
}

/** check 侧 details 的结构化最小形状（Electron PermissionCheckHandlerHandlerDetails 用单数 mediaType；DI/测试按结构注入，无具名 import）。@lintignore */
export interface VoiceMicPermissionCheckDetails {
  mediaType?: string;
}

/**
 * DI 会话形状：main/index.ts 传入 Electron Session（结构兼容），测试传 fake；
 * 无具名 import 消费方（knip @lintignore 先例：workspaceConnectionRegistry.ts:60）。
 * @lintignore
 */
export interface VoiceMicPermissionSession {
  setPermissionRequestHandler(
    handler: (
      webContents: unknown,
      permission: string,
      callback: (permissionGranted: boolean) => void,
      details: VoiceMicPermissionRequestDetails,
    ) => void,
  ): void;
  setPermissionCheckHandler(
    handler: (
      webContents: unknown,
      permission: string,
      requestingOrigin: string,
      details: VoiceMicPermissionCheckDetails,
    ) => boolean,
  ): void;
}

function isAudioOnlyMediaRequest(mediaTypes: readonly string[] | undefined): boolean {
  const types = mediaTypes ?? [];
  // Electron 在无显式 mediaTypes 的老式 media 请求下给空数组；
  // Array#every 对空数组返回 true，空数组天然按纯音频放行。
  return types.every((type) => type === "audio");
}

export function applyVoiceMicPermissionPolicy(
  targetSession: VoiceMicPermissionSession | Session,
  options: { logger: VoiceMicPermissionLogger },
): void {
  const { logger } = options;
  targetSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    // Session 侧 details 是多态 union（MediaAccessPermissionRequest 等）；本策略只消费
    // mediaTypes 形状，结构化收窄。
    const requestDetails = details as VoiceMicPermissionRequestDetails;
    if (permission === "media") {
      if (isAudioOnlyMediaRequest(requestDetails.mediaTypes)) {
        logger.info("[voicePermission] mic request allowed", {
          mediaTypes: requestDetails.mediaTypes ?? [],
        });
        callback(true);
        return;
      }
      logger.warn("[voicePermission] media request with video denied", {
        mediaTypes: requestDetails.mediaTypes ?? [],
      });
      callback(false);
      return;
    }
    // 保持无 handler 时代的自动批准现状（见模块注释：避免与本策略无关的功能回归）。
    callback(true);
  });
  targetSession.setPermissionCheckHandler((_webContents, permission, _requestingOrigin, details) => {
    if (permission === "media") {
      // check 侧是单数 mediaType（'video' | 'audio' | 'unknown'）；unknown 按纯音频放行
      //（与 request 侧空数组同口径，保持无 handler 时代的批准现状）。
      const allowed = details.mediaType == null || details.mediaType === "audio";
      if (!allowed) {
        logger.warn("[voicePermission] media check denied", { mediaType: details.mediaType });
      }
      return allowed;
    }
    return true;
  });
}
