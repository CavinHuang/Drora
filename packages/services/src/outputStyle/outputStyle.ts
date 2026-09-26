// 第 48 轮：Claude Code 兼容的「输出风格」服务接口（官方 asar 逆向 pf/lke）。
// 接口与 token 独立成 browser-safe 文件，实现（含 node:fs）在 outputStyleService.ts，
// 与 memory/skills 等同级服务的目录结构保持一致。
import { ServiceChannels } from "@drora/shared";
import { createServiceDescriptor } from "../descriptors.js";

/** 单个输出风格条目。内置三档 content 为空串（官方如此：内置档 prompt 在 agent 侧另有 default 段）。 */
export interface OutputStyle {
  id: string;
  name: string;
  description: string;
  content: string;
  isBuiltIn: boolean;
  /** 当前激活档标记（listStyles 内 active 缺省 "default"）。 */
  enabled: boolean;
  /** 自定义档的物理文件路径；内置档无。 */
  filePath?: string;
}

/** 新增/更新自定义风格时的用户输入。 */
export interface OutputStyleConfig {
  name: string;
  description: string;
  content: string;
}

export interface IOutputStyleService {
  /** 读取 ~/.claude/settings.json 的 outputStyle 字段；缺省 null。 */
  getActiveStyle(): Promise<{ styleId: string | null }>;

  /** merge 写入 ~/.claude/settings.json（保留其它字段），必要时创建 ~/.claude。 */
  setActiveStyle(params: { styleId: string | null }): Promise<void>;

  /** 内置三档在前 + 自定义按 name localeCompare 排序；单文件读取失败记录后跳过。 */
  listStyles(): Promise<{ styles: OutputStyle[] }>;

  /** 以 name slug 为文件名写入 ~/.claude/output-styles/<slug>.md（平铺头格式）。 */
  addStyle(params: { config: OutputStyleConfig }): Promise<void>;

  /** id 去 "custom-" 前缀定位文件并整体覆写。 */
  updateStyle(params: { id: string; config: OutputStyleConfig }): Promise<void>;

  /** id 去 "custom-" 前缀定位文件并删除。 */
  deleteStyle(params: { id: string }): Promise<void>;

  /** 返回（并尽量创建）自定义风格目录路径；创建失败不抛错。 */
  getUserStylesDirectory(): Promise<{ path: string }>;
}

export const IOutputStyleService = createServiceDescriptor<IOutputStyleService>(
  ServiceChannels.OutputStyle,
);
