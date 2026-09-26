// 第 48 轮：Claude Code 兼容的「输出风格」服务实现，对齐官方原版 asar 逆向
// （官方 pf = createOutputStyleService、bG/uf = settings.json 读写、lke = 内置三档）。
//
// 路径品牌决策：官方把自定义风格与激活状态放在 ~/.claude（output-styles/*.md 与
// settings.json 的 outputStyle 字段）。这是 Claude Code 外部生态的事实路径——与
// claude-native session import 扫描 ~/.claude/projects 同属外部生态读取豁免——
// Drora 按官方原样使用 ~/.claude，不做品牌重定向，保证与 Claude Code CLI 互认。
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { IOutputStyleService, OutputStyle, OutputStyleConfig } from "./outputStyle.js";

const logger = createServiceLogger("output-style");

const CLAUDE_CONFIG_DIR_NAME = ".claude";
const USER_STYLES_DIR_NAME = "output-styles";
const SETTINGS_FILE_NAME = "settings.json";
const CUSTOM_STYLE_ID_PREFIX = "custom-";
const STYLE_FILE_EXTENSION = ".md";
const DEFAULT_CUSTOM_STYLE_NAME = "Custom Style";

/**
 * 官方 lke：内置三档逐字对齐（content 均为空串——内置档的 prompt 在 agent 侧
 * 另有 default 段，不经此服务下发）。
 */
const BUILT_IN_OUTPUT_STYLES: Array<Omit<OutputStyle, "enabled">> = [
  {
    id: "default",
    name: "Default",
    description: "Claude completes coding tasks efficiently and provides concise responses",
    content: "",
    isBuiltIn: true,
  },
  {
    id: "explanatory",
    name: "Explanatory",
    description: "Claude explains its implementation choices and codebase patterns",
    content: "",
    isBuiltIn: true,
  },
  {
    id: "learning",
    name: "Learning",
    description: "Claude pauses and asks you to write small pieces of code for hands-on practice",
    content: "",
    isBuiltIn: true,
  },
];

/** 输出风格允许注入 env（官方 resolveUserHomeDir = env.HOME || USERPROFILE），测试用临时 HOME。 */
interface OutputStyleServiceEnv {
  HOME?: string | undefined;
  USERPROFILE?: string | undefined;
}

export interface CreateOutputStyleServiceOptions {
  env?: OutputStyleServiceEnv;
}

/** 官方 resolveUserHomeDir：HOME 优先、USERPROFILE 兜底（Windows），最后回落 os.homedir()。 */
function resolveUserHomeDir(env: OutputStyleServiceEnv): string {
  const envHome = env.HOME?.trim() || env.USERPROFILE?.trim();
  return envHome && envHome.length > 0 ? envHome : homedir();
}

function resolveClaudeConfigDir(env: OutputStyleServiceEnv): string {
  return join(resolveUserHomeDir(env), CLAUDE_CONFIG_DIR_NAME);
}

function resolveUserStylesDir(env: OutputStyleServiceEnv): string {
  return join(resolveClaudeConfigDir(env), USER_STYLES_DIR_NAME);
}

function resolveClaudeSettingsPath(env: OutputStyleServiceEnv): string {
  return join(resolveClaudeConfigDir(env), SETTINGS_FILE_NAME);
}

function stripStyleFileExtension(fileName: string): string {
  return fileName.replace(/\.md$/, "");
}

/** 官方 id 规则：自定义档 id = `custom-<文件名去 .md>`。 */
function toCustomStyleId(fileName: string): string {
  return `${CUSTOM_STYLE_ID_PREFIX}${stripStyleFileExtension(fileName)}`;
}

/** 官方 update/delete 规则：id 去 "custom-" 前缀得文件基名，补 .md 定位物理文件。 */
function toStyleFileName(id: string): string {
  return `${id.replace(/^custom-/, "")}${STYLE_FILE_EXTENSION}`;
}

/** 官方 addStyle 文件名规则：name 小写、空白折叠为连字符。 */
function toStyleFileSlug(name: string): string {
  return `${name.toLowerCase().replace(/\s+/g, "-")}${STYLE_FILE_EXTENSION}`;
}

/**
 * 官方 addStyle 平铺写盘模板：`name: ${name}\ndescription: ${description}\n\n${content}`。
 * 逆向锚点里的单空格 = 一个换行、双空格 = 空行（模板字符串换行被折叠）；头两行是
 * 平铺键值行（无 frontmatter 围栏），解析端用 /^name:\s*(.+)$/m 与
 * /^description:\s*(.+)$/m 逐行取头，这里必须按相同布局写回。
 */
function formatOutputStyleFile(config: OutputStyleConfig): string {
  return `name: ${config.name}\ndescription: ${config.description}\n\n${config.content}`;
}

/**
 * 官方解析：name/description 用多行正则从头区取值；name 缺省回落文件名去 .md，
 * 再缺省 "Custom Style"。content 保持文件原文（头 + prompt 正文整体即注入用 prompt，
 * 官方不在此剥离头行）。
 */
function parseOutputStyleFile(
  raw: string,
  fileName: string,
): { name: string; description: string; content: string } {
  const nameMatch = /^name:\s*(.+)$/m.exec(raw)?.[1]?.trim();
  const descriptionMatch = /^description:\s*(.+)$/m.exec(raw)?.[1]?.trim();
  return {
    name: nameMatch || stripStyleFileExtension(fileName) || DEFAULT_CUSTOM_STYLE_NAME,
    description: descriptionMatch || "",
    content: raw,
  };
}

/** 官方 bG/uf：settings.json 读写均容错——读失败/非 JSON 视作空对象，不抛错。 */
async function readClaudeSettings(env: OutputStyleServiceEnv): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(resolveClaudeSettingsPath(env), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function createOutputStyleService(
  options: CreateOutputStyleServiceOptions = {},
): IOutputStyleService {
  // 每次调用动态解析 env：官方实现即按调用时进程环境取 HOME，
  // 测试可通过改写 process.env.HOME（或注入 env）指向临时目录。
  const resolveEnv = (): OutputStyleServiceEnv => options.env ?? process.env;

  async function getActiveStyle(): Promise<{ styleId: string | null }> {
    const settings = await readClaudeSettings(resolveEnv());
    const outputStyle = settings.outputStyle;
    return { styleId: typeof outputStyle === "string" ? outputStyle : null };
  }

  async function setActiveStyle(params: { styleId: string | null }): Promise<void> {
    const env = resolveEnv();
    // 官方：目录不存在则 mkdir ~/.claude，再 merge 写 settings.json（保留其它字段）。
    await mkdir(resolveClaudeConfigDir(env), { recursive: true });
    const settings = await readClaudeSettings(env);
    settings.outputStyle = params.styleId;
    await writeFile(
      resolveClaudeSettingsPath(env),
      JSON.stringify(settings, null, 2),
      "utf8",
    );
  }

  async function listStyles(): Promise<{ styles: OutputStyle[] }> {
    const activeStyleId = (await getActiveStyle()).styleId ?? "default";
    const styles: OutputStyle[] = BUILT_IN_OUTPUT_STYLES.map((style) => ({
      ...style,
      enabled: style.id === activeStyleId,
    }));

    const customStyles: OutputStyle[] = [];
    const stylesDir = resolveUserStylesDir(resolveEnv());
    let fileNames: string[];
    try {
      fileNames = await readdir(stylesDir);
    } catch (error) {
      // 官方：目录读取失败记录后继续（全新安装尚无 output-styles 时返回纯内置三档）。
      logger.error(undefined, "read output-styles directory failed:", error);
      return { styles };
    }

    for (const fileName of fileNames) {
      if (!fileName.endsWith(STYLE_FILE_EXTENSION)) {
        continue;
      }
      const filePath = join(stylesDir, fileName);
      try {
        const raw = await readFile(filePath, "utf8");
        const styleId = toCustomStyleId(fileName);
        customStyles.push({
          ...parseOutputStyleFile(raw, fileName),
          id: styleId,
          isBuiltIn: false,
          enabled: styleId === activeStyleId,
          filePath,
        });
      } catch (error) {
        // 官方 pf：单个文件读取失败仅记录后继续（如同名目录、权限问题），不阻断列表。
        logger.error(undefined, `read output style file failed: ${filePath}`, error);
      }
    }

    // 官方：自定义按 name localeCompare 排序，内置三档在前。
    customStyles.sort((left, right) => left.name.localeCompare(right.name));
    return { styles: [...styles, ...customStyles] };
  }

  async function addStyle(params: { config: OutputStyleConfig }): Promise<void> {
    const env = resolveEnv();
    const stylesDir = resolveUserStylesDir(env);
    // 官方：mkdir output-styles 且 EEXIST 忽略；recursive 同时覆盖父目录缺失的情况。
    await mkdir(stylesDir, { recursive: true });
    await writeFile(
      join(stylesDir, toStyleFileSlug(params.config.name)),
      formatOutputStyleFile(params.config),
      "utf8",
    );
  }

  async function updateStyle(params: { id: string; config: OutputStyleConfig }): Promise<void> {
    const stylesDir = resolveUserStylesDir(resolveEnv());
    await writeFile(
      join(stylesDir, toStyleFileName(params.id)),
      formatOutputStyleFile(params.config),
      "utf8",
    );
  }

  async function deleteStyle(params: { id: string }): Promise<void> {
    await unlink(join(resolveUserStylesDir(resolveEnv()), toStyleFileName(params.id)));
  }

  async function getUserStylesDirectory(): Promise<{ path: string }> {
    const stylesDir = resolveUserStylesDir(resolveEnv());
    try {
      // 官方：mkdir（吞错）后直接返回路径，调用方负责展示。
      await mkdir(stylesDir, { recursive: true });
    } catch (error) {
      logger.warn(undefined, "create output-styles directory failed:", error);
    }
    return { path: stylesDir };
  }

  return {
    getActiveStyle,
    setActiveStyle,
    listStyles,
    addStyle,
    updateStyle,
    deleteStyle,
    getUserStylesDirectory,
  };
}
