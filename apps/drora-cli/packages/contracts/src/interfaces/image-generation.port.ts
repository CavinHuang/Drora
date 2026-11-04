// ============================================================
// ImageGeneration Port - agent 内置文生图边界
// ============================================================
// specs/model-capabilities.md §6.1：CLI 工具经本端口把生成请求转发到 host 侧画图
// 服务（bootstrap 协议端口实现；出站、凭据解密全部留在 host，凭据零出 host）。
// 端口恒注入（不做 include 布尔门）：可用性由 host 侧档案 fail-closed 语义与
// -32601 翻译统一表达，CLI 不按端口在场猜测能力。

import type { GenerateImagePortResult } from "../tools/generate-image.js";

export interface ImageGenerationPort {
  /**
   * 生成一张图像（n 固定 1）。失败以结构化 ok:false 返回（不抛业务错，照
   * testJevConnection 风格）；传输/协议错误（含旧 host -32601 翻译）由实现层
   * 抛出，调用方按工具失败处理。
   *
   * options.signal：工具执行取消/超时信号（specs/model-capabilities.md §12 取消
   * 贯通修复）。文生图是长出站（180s），用户打断回合时必须随取消终止 pending
   * RPC，否则 CLI 已报 cancelled 而 Host 侧计费出站继续跑满（实现层把 signal
   * 透传给反向 RPC 的 requestClient options）。
   */
  generateImage(
    input: { prompt: string; size?: string },
    options?: { signal?: AbortSignal },
  ): Promise<GenerateImagePortResult>;
}
