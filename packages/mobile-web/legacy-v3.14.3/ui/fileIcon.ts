// 官方文件类型图标还原（specs/mobile-relay-r3-frontend.md §32.17）。
// 证据：官方 3.14.3 bundle（upstream 字节冻结）index-NjWRUABD.js：
//  - 图标基址 BCe()：`${`/remote/v4/3.14.3/`.replace(/\/?$/, `/`)}material-icons`
//    ——与 vite.config base 同值，经 import.meta.env.BASE_URL 单一来源化；
//  - 文件名映射 NCe / 扩展名映射 PCe / 图标名选择器 ICe / 路径元数据 Mh；
//  - 加载失败回退链 UCe：原 URL → document.svg → 内联 SVG（三级，data-uri 返回 null 终止）。
// 本模块是纯逻辑移植（键值与分支逐字对照 bundle）；46 枚图标 svg 由 public/material-icons
// 字节原样随构建下发（build-app.mjs 排列为官方路径形状 /remote/v4/3.14.3/material-icons）。

/** 官方 document 内联回退（bundle LCe，data:image/svg+xml;utf8,%3Csvg…，字节原样）。 */
export const DOCUMENT_ICON_INLINE_SRC =
  "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22none%22%3E%3Cpath%20d%3D%22M4.5%201.5h4.586L12.5%204.914V13a1.5%201.5%200%200%201-1.5%201.5h-6A1.5%201.5%200%200%201%203.5%2013V3A1.5%201.5%200%200%201%205%201.5Z%22%20stroke%3D%22%252394A3B8%22%20stroke-width%3D%221.2%22%20stroke-linejoin%3D%22round%22%2F%3E%3Cpath%20d%3D%22M9%201.75V5h3.25%22%20stroke%3D%22%252394A3B8%22%20stroke-width%3D%221.2%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E";

/** 目录图标名（bundle jh = Ah(`folder`)）。 */
export const FOLDER_ICON_NAME = "folder";

/** 默认文件图标名（bundle MCe = `document`）。 */
export const DOCUMENT_ICON_NAME = "document";

// NCe：文件名（小写、可含点分段）→ 图标名。键集与值逐字对照 bundle @~671000。
const FILE_NAME_ICON_MAP: Readonly<Record<string, string>> = {
  ".editorconfig": "editorconfig",
  ".env": "settings",
  ".gitattributes": "git",
  ".gitignore": "git",
  ".npmrc": "npm",
  ".nvmrc": "nodejs_alt",
  ".prettierrc": "prettier",
  ".yarnrc": "yarn",
  "babel.config": "babel",
  bun: "lock",
  "bun.lock": "lock",
  cargo: "rust",
  "cargo.lock": "lock",
  dockerfile: "docker",
  eslint: "eslint",
  "eslint.config": "eslint",
  gemfile: "gemfile",
  jest: "jest",
  "jest.config": "jest",
  makefile: "makefile",
  "package-lock": "lock",
  "pnpm-lock": "lock",
  readme: "readme",
  tsconfig: "tsconfig",
  vitest: "vitest",
  "vitest.config": "vitest",
  yarn: "yarn",
};

// PCe：扩展名（小写）→ 图标名。逐字对照 bundle。
const FILE_EXT_ICON_MAP: Readonly<Record<string, string>> = {
  backup: "document",
  bash: "console",
  cjs: "javascript",
  cts: "typescript",
  css: "css",
  doc: "word",
  docx: "word",
  go: "go",
  html: "html",
  java: "java",
  jpeg: "image",
  jpg: "image",
  js: "javascript",
  jsx: "react",
  json: "json",
  jsonl: "json",
  mjs: "javascript",
  md: "markdown",
  m4a: "audio",
  m4v: "video",
  flac: "audio",
  mov: "video",
  mp3: "audio",
  mp4: "video",
  ogg: "audio",
  opus: "audio",
  mts: "typescript",
  pdf: "pdf",
  php: "php",
  png: "image",
  pptx: "powerpoint",
  py: "python",
  responses: "json",
  rs: "rust",
  sb: "storybook",
  sql: "database",
  sh: "console",
  snap: "snapcraft",
  svg: "svg",
  toml: "toml",
  ts: "typescript",
  tsx: "react_ts",
  txt: "document",
  wav: "audio",
  weba: "audio",
  webm: "video",
  xlsx: "table",
  yaml: "yaml",
  yml: "yaml",
  zsh: "console",
};

/** 官方全部图标名的闭集（两表值 ∪ {folder, document}，= public/material-icons 的 46 枚）。 */
export const FILE_ICON_NAMES: readonly string[] = Object.freeze([
  ...new Set([
    ...Object.values(FILE_NAME_ICON_MAP),
    ...Object.values(FILE_EXT_ICON_MAP),
    FOLDER_ICON_NAME,
    DOCUMENT_ICON_NAME,
  ]),
].sort());

/** 反斜杠归一（bundle kh：`e.replace(/\\/g, "/")`——Windows 路径参与同一选择器）。 */
function normalizeSeparators(path: string): string {
  return path.replace(/\\/g, "/");
}

/** 路径 → 末段文件名（bundle Mh 的 rl 步骤）。 */
export function fileBasename(path: string): string {
  const normalized = normalizeSeparators(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? normalized : normalized.slice(index + 1);
}

/**
 * 文件名 → 图标名（bundle ICe 逐分支移植）：
 * 1. 候选集 = 全名小写 ∪ 去末段扩展名的名字小写 ∪ 逐层剥点的前缀段；
 * 2. 依插入序查文件名表（如 `babel.config.js` → `babel.config` 命中 babel）；
 * 3. 无扩展名未命中 → document；
 * 4. 有扩展名未命中 → 扩展名表，再退扩展名本身（线上 404 时由回退链兜底）。
 */
export function fileNameToIconName(rawName: string): string {
  const name = fileBasename(rawName);
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const stem = dot === -1 ? lower : lower.slice(0, dot);
  const candidates = new Set([lower, stem]);
  for (let cursor = stem; cursor.includes("."); ) {
    cursor = cursor.slice(0, cursor.lastIndexOf("."));
    if (cursor !== "") candidates.add(cursor);
  }
  for (const candidate of candidates) {
    const mapped = FILE_NAME_ICON_MAP[candidate];
    if (mapped !== undefined) return mapped;
  }
  if (dot === -1) return DOCUMENT_ICON_NAME;
  const ext = lower.slice(dot + 1);
  return FILE_EXT_ICON_MAP[ext] ?? ext ?? DOCUMENT_ICON_NAME;
}

/** 路径 → 图标名（bundle Mh 的图标选择：kind=directory 恒 folder）。 */
export function fileIconNameFor(path: string, kind?: "directory" | "file"): string {
  if (kind === "directory") return FOLDER_ICON_NAME;
  return fileNameToIconName(path);
}

/** 官方基址字面量（bundle BCe 内嵌值；与 vite.config base 同值，node:test 无注入时的回落）。 */
export const DEFAULT_FILE_ICON_BASE = "/remote/v4/3.14.3/";

/** 图标基址（bundle BCe 语义：base 归一尾斜杠 + `material-icons`；base 来自 vite 注入）。 */
export function fileIconBaseUrl(): string {
  // vite 构建注入 BASE_URL（= vite.config base）；node:test（tsx）直跑时无注入，
  // 回落官方字面量——两值同源同义，渲染与单测不断链。
  const meta = import.meta as ImportMeta & { env?: { BASE_URL?: string } };
  const base = (meta.env && meta.env.BASE_URL) || DEFAULT_FILE_ICON_BASE;
  return `${base.replace(/\/?$/, "/")}material-icons`;
}

/** 图标名 → URL（bundle Ah：`${base}/${name}.svg`）。 */
export function fileIconSrc(iconName: string): string {
  return `${fileIconBaseUrl()}/${iconName}.svg`;
}

/**
 * 加载失败回退（bundle UCe 逐分支移植）：返回下一次应尝试的 src；
 * 已是内联 data-uri 返回 null（终止链）。链路：原 URL → document.svg → 内联 SVG。
 */
export function resolveFileIconFallbackSrc(currentSrc: string): string | null {
  if (currentSrc === DOCUMENT_ICON_INLINE_SRC) return null;
  if (currentSrc === fileIconSrc(DOCUMENT_ICON_NAME) || currentSrc.endsWith("/document.svg")) {
    return DOCUMENT_ICON_INLINE_SRC;
  }
  return fileIconSrc(DOCUMENT_ICON_NAME);
}
