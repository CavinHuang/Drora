import { DRORA_OFFICIAL_PLUGIN_MARKETPLACE } from "@drora/contracts";

// 内置插件的商店信息 seed（原样写入官方 marketplace.json 的条目 raw，键名与 CDN 目录
// schema 一致：displayName_i18n / examplePrompts_i18n 等），解析复用 adapter 的
// parseEntryStoreListing。icon 指向官方 assets CDN；请求失败时 UI 会安全降级为默认图标。
export interface OfficialPluginListingSeed {
  displayName?: string;
  displayName_i18n?: Record<string, string>;
  description_i18n?: Record<string, string>;
  category?: string;
  author?: { name: string; url?: string };
  icon?: string;
  homepage?: string;
  privacyPolicy?: string;
  termsOfService?: string;
  heroImage?: string;
  examplePrompts?: string[];
  examplePrompts_i18n?: Record<string, string[]>;
}

export const OFFICIAL_BROWSER_USE_PLUGIN_NAME = "browser-use";
export const OFFICIAL_BROWSER_USE_PLUGIN_ID = `${OFFICIAL_BROWSER_USE_PLUGIN_NAME}@${DRORA_OFFICIAL_PLUGIN_MARKETPLACE}`;
/**
 * node_repl 宿主。它不是面向用户的插件：没有 skill、没有 listing、不进市场，唯一职责是
 * 携带 `dist/mcp/server.js` 这个 Browser Use 与 Computer Use 共用的运行时产物。
 *
 * 为什么它需要成为一个 seed 单元：宿主产物过去长在 browser-use 包里，于是
 * resolveBuiltInNodeReplMcpServers 只能在 browser-use 的 rootPath 下找它 —— browser-use
 * 包缺失时，即便 Computer Use 自己启用也拿不到宿主。做成独立 seed 单元后，两个插件
 * 各自只贡献自己的领域资产，谁启用都能拿到同一个宿主。
 */
export const OFFICIAL_NODE_REPL_HOST_PLUGIN_NAME = "node-repl-host";
export const OFFICIAL_NODE_REPL_HOST_PLUGIN_ID = `${OFFICIAL_NODE_REPL_HOST_PLUGIN_NAME}@${DRORA_OFFICIAL_PLUGIN_MARKETPLACE}`;
export const OFFICIAL_CUA_PLUGIN_NAME = "computer-use";
export const OFFICIAL_CUA_PLUGIN_ID = `${OFFICIAL_CUA_PLUGIN_NAME}@${DRORA_OFFICIAL_PLUGIN_MARKETPLACE}`;
/**
 * 官方 obsidian 插件 id（B4 注册门消费）：obsidian 宿主能力（VaultSearch 工具面等）的
 * 三态合成按插件 id 判抑制（specs/obsidian-vault-plugin-extraction.md §3/§4.4）。
 * 与 bootstrap knowledge-evidence/vault-config-reader.ts 的 OBSIDIAN_PLUGIN_ID、
 * services obsidianVaultService/hostComponentsPresence 的本地常量同值（各侧依赖方向
 * 约束不允许互相 import，值的一致性由各自注释锁定；本处是 bootstrap app 域的引用点）。
 */
export const OFFICIAL_OBSIDIAN_PLUGIN_NAME = "obsidian";
export const OFFICIAL_OBSIDIAN_PLUGIN_ID = `${OFFICIAL_OBSIDIAN_PLUGIN_NAME}@${DRORA_OFFICIAL_PLUGIN_MARKETPLACE}`;

/**
 * app 级常驻服务声明（g1，specs/obsidian-vault-phase2-true-extraction.md §3/§6/§10-P1）。
 * 生命周期语义：宿主启动即拉起、独立于 session lease、崩溃重启（带退避）、宿主退出收割。
 * singleton 是**优化声明而非正确性前提**——强制作用域为宿主进程级（同一 host 进程内每
 * pluginId 至多一实例）；跨进程多实例（多窗口/多 Host）是仓库受支持场景，写竞争防护由
 * DB 级 index_lease/fencing 承担（§3/g8），不得进程内化。
 */
export interface OfficialPluginAppServiceDeclaration {
  /** manifest mcpServers 的原始 server 键（seed 重写前的 declared key，如 knowledge）。 */
  server: string;
}

export interface OfficialPluginDefinition {
  /**
   * app 级常驻服务声明（specs/obsidian-vault-phase2-true-extraction.md §6 g1，P1 新增键）：
   * 宿主启动即拉起、独立于 session lease、崩溃重启、宿主退出收割；语义与 singleton 作用域
   * 见 {@link OfficialPluginAppServiceDeclaration}。仅官方插件可声明；manifest 尚无
   * 所指 server 条目时启动链惰性跳过（P3 落地 knowledge server 清单前 obsidian 即按此
   * 惰性生效，声明先行不报错）。
   */
  appService?: OfficialPluginAppServiceDeclaration;
  /**
   * 卸载（抑制）后的可恢复条目没有运行时信息，商店只能靠这里判断是否归入「UI 插件」。
   * 插件包 manifest 声明 ui.surfaces 时必须同时声明 "ui"，由 bootstrap 测试校验一致。
   */
  componentTypes?: readonly string[];
  // 内容型 plugin (无 MCP server / 无系统依赖) 可以设为 true,
  // 这样用户首次 `/skill <name>` 就能用,不必先 `drora plugins enable`。
  // 默认 false 保持 ios-simulator / android-emulator 这类重负载 plugin 原来行为。
  defaultEnabled?: boolean;
  listing?: OfficialPluginListingSeed;
  /**
   * 由宿主为该官方插件提供、但不属于 plugin manifest 的 MCP server。
   * 仅用于产品归属和设置页状态展示；运行时仍保留宿主 identity。
   */
  hostMcpServerNames?: readonly string[];
  /**
   * 宿主实现归属声明（specs/obsidian-vault-plugin-extraction.md §4.2，B1 新增键）：
   * 由 host/CLI 进程内实现、归属该官方插件名的宿主服务（如 obsidian 的
   * obsidian-vault/knowledge-* 四服务）。语义同 hostMcpServerNames——仅官方插件可
   * 声明，用于商店/设置页归属展示与装配条件化（B3 消费），不改变运行时 identity。
   */
  hostServices?: readonly string[];
  name: string;
  /** filesystem/SEA seed 缺少任一项时拒绝生成残缺的官方插件缓存。 */
  requiredSeedPaths?: readonly string[];
  rootCandidates: readonly string[];
  /** Extra top-level paths intentionally staged as plugin runtime assets. */
  runtimeTopLevelPaths?: readonly string[];
  /**
   * 定义级卸载数据保留声明（specs/obsidian-vault-plugin-extraction.md §6 D6-a 起源；
   * 阶段二 specs/obsidian-vault-phase2-true-extraction.md §11-D6 升级为**强制**）：
   * true = 卸载链路**无条件**保留插件数据目录（显式 keepData:false 也不生效）——
   * obsidian 插件数据目录现含知识库（P6 搬迁后的索引库/向量/审核账本）+ 嵌入模型，
   * rm 即全库丢失；「恢复」必须零损失。未声明的其他插件维持全局「!==true 即删」
   * 语义，显式参数仍优先（细粒度声明，不动全局 keepData 语义）。
   */
  uninstallKeepData?: boolean;
  version: string;
}

const ZAI_AUTHOR = { name: "Z.ai", url: "https://z.ai" } as const;
const OFFICIAL_PLUGIN_ASSETS_BASE_URL = "https://cdn-zcode.z.ai/zcode/official-plugin/assets";

export const OFFICIAL_NODE_REPL_HOST_REQUIRED_SEED_PATHS = ["dist/mcp/server.js"] as const;

/** 文档插件（documents / pdf / presentations / spreadsheets）查看面板的构建产物。 */
export const OFFICIAL_OFFICE_VIEWER_RUNTIME_PATHS = [
  "dist/server.mjs",
  "dist/ui/assets.json",
  "dist/ui/panel.html",
] as const;

export const OFFICIAL_BROWSER_USE_REQUIRED_SEED_PATHS = [
  "docs/api.json",
  "docs/documents.json",
  "docs/overview.md",
  // documents.json 已注册 recording lookup；若不强制校验正文，会 seed 出无法读取录屏指南的残缺插件。
  "docs/recording.md",
  "docs/workflow.md",
  "scripts/browser-client.mjs",
  "skills/control-browser/SKILL.md",
  "skills/web-gui-tester/SKILL.md",
] as const;

export const OFFICIAL_CUA_REQUIRED_SEED_PATHS = [
  // 官方 manifest 声明了 skills；漏校验正文会让 filesystem/SEA 缓存静默丢失电脑控制指导。
  // 与官方 requiredSeedPaths 和 Desktop staging 保持一致，冻结 0.6.3 SDK 也包含此 Skill。
  "skills/computer-use/SKILL.md",
  "docs/computer-use.md",
  "scripts/computer-use-client.mjs",
  "package.json",
  // sharp/koffi/semver 等 seed 级 native 依赖仍随插件发行（宿主 bundle externalize
  // sharp 后按插件自身 node_modules 解析），缺失时 SDK 首次调用即 MODULE_NOT_FOUND。
  "node_modules/sharp/package.json",
] as const;

// 修复原因（2026-08-24）：drora-guide 原本没有 requiredSeedPaths，seed 丢文件时会静默装出一个
// 残缺插件而没有任何诊断。0.3.0 起 `/workflow` 与 dynamic-workflows 技能不再随本插件发布
// （命令编进 CLI，技能进 packages/bundled-skills，见 docs/dynamic-workflow/authoring.md），
// 这里钉住的是配置指南技能正文。
export const OFFICIAL_DRORA_GUIDE_REQUIRED_SEED_PATHS = [
  "skills/drora-configuration-guide/SKILL.md",
] as const;

export const OFFICIAL_PLUGIN_DEFINITIONS: readonly OfficialPluginDefinition[] = [
  {
    defaultEnabled: true,
    listing: {
      author: ZAI_AUTHOR,
      category: "productivity",
      displayName: "Visualize",
      displayName_i18n: { "zh-CN": "交互视图" },
      description_i18n: { "zh-CN": "在对话中创建交互图表、解释和设计预览。" },
    },
    name: "visualize",
    requiredSeedPaths: [
      "skills/visualize/SKILL.md",
      "skills/visualize/references/api.md",
      "skills/visualize/references/styles.md",
      "skills/visualize/tweak.md",
      "skills/visualize/LICENSE.md",
      "skills/visualize/scripts/render.py",
      "skills/visualize/assets/visualize.css",
      "skills/visualize/assets/visualize.html",
      "skills/visualize/assets/calendar.js",
      "skills/visualize/assets/runtime-manifest.json",
      "skills/visualize/scripts/vendor.py",
      "skills/visualize/assets/vendor/manifest.json",
      "skills/visualize/assets/vendor/floating-ui-core-1.7.3.min.js",
      "skills/visualize/assets/vendor/floating-ui-core-1.7.3.min.js.LICENSE",
      "skills/visualize/assets/vendor/floating-ui-dom-1.7.4.min.js",
      "skills/visualize/assets/vendor/floating-ui-dom-1.7.4.min.js.LICENSE",
      "skills/visualize/assets/vendor/lucide-1.17.0.js",
      "skills/visualize/assets/vendor/lucide-1.17.0.js.LICENSE",
      "skills/visualize/assets/vendor/d3-7.9.0.min.js",
      "skills/visualize/assets/vendor/d3-7.9.0.min.js.LICENSE",
      "skills/visualize/widgets/calendar.md",
      "skills/visualize/examples/calendar.html",
      "skills/visualize/assets/standalone-host-bridge.js",
      "skills/visualize/assets/standalone-shell.js",
    ],
    rootCandidates: [
      "packages/visualize-plugin",
      "../visualize-plugin",
      "../../visualize-plugin",
      "../../../visualize-plugin",
    ],
    version: "0.1.1",
  },
  {
    // 无 listing：宿主不进市场、不对用户露出。它必须始终可用，因为 node_repl 的注册门禁
    // 是「Browser Use 或 Computer Use 任一启用」，宿主自己不参与那个判断。
    //
    // 这里的 defaultEnabled 不违反「仅限内容型插件」那条约定（见下方 computer-use 的说明）：
    // 约定要防的是「首启即注入整套工具集并拉起 Helper」，而 seed 宿主两件都不做——工具是否
    // 进模型工具池由两个能力插件的启停决定，Helper 由 SDK 首次调用时才拉起。
    defaultEnabled: true,
    name: OFFICIAL_NODE_REPL_HOST_PLUGIN_NAME,
    requiredSeedPaths: OFFICIAL_NODE_REPL_HOST_REQUIRED_SEED_PATHS,
    rootCandidates: [
      "packages/node-repl-host",
      "../node-repl-host",
      "../../node-repl-host",
      "../../../node-repl-host",
    ],
    version: "0.7.0",
  },
  {
    listing: {
      author: ZAI_AUTHOR,
      category: "developer-tools",
      displayName: "Android Emulator",
      displayName_i18n: { "zh-CN": "Android 模拟器" },
      icon: `${OFFICIAL_PLUGIN_ASSETS_BASE_URL}/android-emulator/icon.png`,
      description_i18n: {
        "zh-CN": "提供 Android 开发工作流与模拟器自动化能力。",
      },
    },
    name: "android-emulator",
    rootCandidates: [
      "packages/android-emulator-plugin",
      "../android-emulator-plugin",
      "../../android-emulator-plugin",
      "../../../android-emulator-plugin",
    ],
    version: "0.1.0",
  },
  {
    // manifest 只声明 browser-use skill；宿主 node_repl MCP 独立注入，package 另外携带其 server/client
    // runtime 资产。默认启用仅控制「何时/如何用内置浏览器」的 skill 与 browser bridge。
    defaultEnabled: true,
    hostMcpServerNames: ["node_repl"],
    listing: {
      author: ZAI_AUTHOR,
      category: "productivity",
      displayName: "Browser Use",
      displayName_i18n: { "zh-CN": "浏览器操作" },
      icon: `${OFFICIAL_PLUGIN_ASSETS_BASE_URL}/browser-use/icon.png`,
      description_i18n: {
        "zh-CN": "操作 Drora 内置浏览器，检查网页并验证交互。",
      },
    },
    name: OFFICIAL_BROWSER_USE_PLUGIN_NAME,
    requiredSeedPaths: OFFICIAL_BROWSER_USE_REQUIRED_SEED_PATHS,
    rootCandidates: [
      "packages/browser-use-plugin",
      "../browser-use-plugin",
      "../../browser-use-plugin",
      "../../../browser-use-plugin",
    ],
    // 官方 0.5.1 发行物随包携带 node_modules sharp 运行时（browser-client 的截图/缩放链，
    // 宿主 bundle externalize sharp 后按插件自身 node_modules 解析）。本包仍是 pnpm
    // workspace 成员，node_modules 混有开发依赖，只能按确定性运行时子树 seed/staging，
    // 不能像 zcode-cua-plugin（入库基线，整目录干净）那样整目录复制。
    runtimeTopLevelPaths: [
      "node_modules/sharp",
      "node_modules/semver",
      "node_modules/detect-libc",
      "node_modules/@img/colour",
      "node_modules/@img/sharp-win32-x64",
    ],
    // 插件 package/manifest 升版时遗漏官方 seed 版本，会继续加载旧缓存目录。
    // package、manifest、definition 三处版本应保持一致，避免发布内容和安装版本再次分叉。
    version: "0.5.1",
  },
  ...(
    [
      // 版本按插件各自升，换新缓存目录：pdf 0.2.1 起面板带中日韩字体回退；0.2.1（pdf 0.2.2）起
      // server 由工作区内各 session 共享，旧缓存的 server 不区分 session，不能沿用。
      ["documents", "docx", "Documents", "Word文档", "0.2.1"],
      ["pdf", "pdf", "PDF", "PDF", "0.2.2"],
      ["presentations", "pptx", "Presentations", "演示文档", "0.2.1"],
      ["spreadsheets", "xlsx", "Spreadsheets", "电子表格", "0.2.1"],
    ] as const
  ).map(
    ([name, skill, displayName, chineseName, version]): OfficialPluginDefinition => ({
      componentTypes: ["ui"],
      defaultEnabled: true,
      listing: {
        author: ZAI_AUTHOR,
        category: "productivity",
        displayName,
        displayName_i18n: { "zh-CN": chineseName },
        // 复用已发布的文档图标，拆分插件无需依赖新 CDN 资源。
        icon: `${OFFICIAL_PLUGIN_ASSETS_BASE_URL}/document-skills/icon.png`,
        description_i18n: { "zh-CN": `创建、编辑与审阅${chineseName}（${skill.toUpperCase()}）。` },
      },
      name,
      // 0.2.0 起文档插件同时提供查看面板：MCP server 与面板资源由 office-runtime 构建进 dist/，
      // 缺任一项都会 seed 出能看到面板入口却无法启动的残缺插件。
      requiredSeedPaths: [
        "agents/visual-judge.md",
        `skills/${skill}/SKILL.md`,
        `skills/${skill}-viewer/SKILL.md`,
        ...OFFICIAL_OFFICE_VIEWER_RUNTIME_PATHS,
      ],
      rootCandidates: [
        `packages/${name}-plugin`,
        `../${name}-plugin`,
        `../../${name}-plugin`,
        `../../../${name}-plugin`,
      ],
      version,
    }),
  ),
  {
    // 沿用原聚合文档插件的官方搜图能力，仅拆出独立开关；认证仍由官方 MCP adapter 注入。
    defaultEnabled: true,
    listing: {
      author: ZAI_AUTHOR,
      category: "productivity",
      displayName: "Image Search",
      displayName_i18n: { "zh-CN": "搜图" },
      description_i18n: { "zh-CN": "查找插图与参考配图。" },
    },
    name: "image-search",
    requiredSeedPaths: [".mcp.json"],
    rootCandidates: [
      "packages/image-search-plugin",
      "../image-search-plugin",
      "../../image-search-plugin",
      "../../../image-search-plugin",
    ],
    version: "0.1.1",
  },
  {
    listing: {
      author: ZAI_AUTHOR,
      category: "developer-tools",
      displayName: "iOS Simulator",
      displayName_i18n: { "zh-CN": "iOS 模拟器" },
      icon: `${OFFICIAL_PLUGIN_ASSETS_BASE_URL}/ios-simulator/icon.png`,
      description_i18n: {
        "zh-CN": "提供 iOS 开发工作流与模拟器自动化能力。",
      },
    },
    name: "ios-simulator",
    rootCandidates: [
      "packages/ios-simulator-plugin",
      "../ios-simulator-plugin",
      "../../ios-simulator-plugin",
      "../../../ios-simulator-plugin",
    ],
    version: "0.1.0",
  },
  {
    // Obsidian Vault 能力（Proma 式原生访问）：SessionStart 注入 Vault 上下文 +
    // PermissionRequest 授权 Vault 内原生写入；无 MCP server。hooks 属可执行副作用，
    // 按「defaultEnabled 仅限内容型插件」的约定不默认启用，由用户在商店显式开启。
    //
    // 0.3.0（specs/obsidian-vault-plugin-extraction.md §1/§4，剥离战役 B2）：
    // - componentTypes 加 "ui" + manifest ui.surfaces 声明 app 级宿主面板 VaultView
    //   （四视图，实现留 renderer 注册表，hostPanelId="vault" 命中 shared 白名单）；
    // - hostServices 归属四服务（obsidian-vault / knowledge-index/query/review），
    //   实现物理位置不变（host 进程内），仅商店/设置页归属展示与 B3 装配条件化消费；
    // - uninstallKeepData=true（§6 D6-a 裁定，阶段二 §11-D6 升级为强制）：卸载保留
    //   插件数据目录——P6 搬迁后该目录除 vault-config/vault-focus 外还含知识库
    //   （索引库/向量/审核账本）+ 嵌入模型，rm 即全库丢失；重装「恢复」零损失；
    // - 不声明 defaultEnabled——hooks 缺省启用维持 false（D1b，现状与约定均不变；
    //   DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS 机械对照单测不动）。
    // P1（specs/obsidian-vault-phase2-true-extraction.md §3/§10-P1）：追加 app 级常驻
    // 知识服务生命周期声明（宿主启动拉起/宿主进程级 singleton/崩溃重启/退出收割，g1）。
    // server 键 "knowledge" 对应 P3 落地的 manifest mcpServers.knowledge（§3 形态）；
    // P3 之前清单无 mcpServers，启动链按声明缺 server 条目惰性跳过（不报错不拉起），
    // P3 清单落地后本声明即刻生效。
    //
    // P3（§10-P3，manifest 0.3.0→0.4.0）：
    // - knowledge 栈 + obsidian-vault 门面物理迁入插件包（C1/C2，逐文件 HEAD 对照），
    //   本条 appService 声明自此实际生效（knowledge server 随宿主常驻拉起）；
    // - runtimeTopLevelPaths 登记 onnxruntime-node 确定性子树（g7，browser-use sharp
    //   同款纪律）：dist/binding.js 运行时 require onnxruntime-common（同版本钉死），
    //   两棵子树缺任一棵都会在首次本地嵌入时 MODULE_NOT_FOUND；adm-zip/global-agent
    //   仅其 postinstall 装期脚本使用，不进运行时闭包，不登记。模型文件（~24MB）不进
    //   seed（首用下载落插件数据目录，§5b.9 语义原样）。desktop 打包态按目标平台重产
    //   子树（bin/napi-v6 只保留目标平台），见 prepare-agent-node-bundle 的 stagedNativeRuntimes。
    // P4（§4/§10-P4，manifest 0.4.0 就地补键——分支内未发版，不另起版本号）：
    // - mcpServers.knowledge 追加 `alwaysLoad: true`（D15 建议值先行）：agent 工具
    //   vault_search/vault_neighbors（C8 契约随迁 + evidence 工具内复验）随 server
    //   常驻每会话 context 首发；deferred 收敛时在 manifest 加工具级
    //   `tools.<name>.deferred: true`（P2 g3 机制）即可，无需改定义。
    //   常驻占用差异已在 §9 已知差异⑧如实记录，不静默。
    // P5（§2/§10-P5，manifest 0.4.0 分支内继续演进）：
    // - ui.surfaces 从 `availability:"app"+hostPanelId` 切到 `availability:"session"+
    //   server:"knowledge"+resourceUri:"ui://obsidian/panel.html"`（Vault webview 面板，
    //   React 单文件内联 + ui://obsidian/data/* 只读资源面；上面 0.3.0 的 app 级宿主
    //   面板形态自此失去声明来源，本体 hostPanel 机制死面由 P7 随 C4 拆除）；
    // - requiredSeedPaths 增 dist/ui/panel.html（面板产物锚点）。
    appService: { server: "knowledge" },
    componentTypes: ["ui"],
    hostServices: [
      "obsidian-vault",
      "knowledge-index",
      "knowledge-query",
      "knowledge-review",
    ],
    listing: {
      author: ZAI_AUTHOR,
      category: "productivity",
      displayName: "Obsidian",
      displayName_i18n: { "zh-CN": "Obsidian 笔记" },
      icon: `${OFFICIAL_PLUGIN_ASSETS_BASE_URL}/obsidian/icon.png`,
      description_i18n: {
        "zh-CN": "连接本机 Obsidian Vault：浏览、检索、创作与整理 Markdown 笔记。",
      },
    },
    name: "obsidian",
    requiredSeedPaths: [
      "dist/hooks/session-start.mjs",
      "dist/hooks/permission-request.mjs",
      "dist/hooks/user-prompt-submit.mjs",
      "skills/obsidian/SKILL.md",
      // 0.3.0 新增知识检索能力使用指南（VaultSearch 工具面 + 面板引导）；
      // 漏校验正文会 seed 出 agent 拿不到新能力指导的残缺插件。
      "skills/obsidian-knowledge/SKILL.md",
      "package.json",
      // P3：knowledge server 入口是常驻 appService 与会话级 MCP 的共同产物锚点，
      // 缺失会 seed 出商店可见但工具面/面板都无法启动的残缺插件。
      "dist/mcp/server.js",
      // P5（§2/§10-P5）：session 级沙箱面板页面（manifest ui.surfaces[].resourceUri
      // 指向 ui://obsidian/panel.html）；缺失会 seed 出面板入口存在但页面打不开的残缺插件。
      "dist/ui/panel.html",
    ],
    rootCandidates: [
      "packages/obsidian-plugin",
      "../obsidian-plugin",
      "../../obsidian-plugin",
      "../../../obsidian-plugin",
    ],
    // P3（g7）：onnxruntime 确定性子树随插件发行（本地语义嵌入的 N-API 运行时）。
    runtimeTopLevelPaths: [
      "node_modules/onnxruntime-node",
      "node_modules/onnxruntime-common",
    ],
    uninstallKeepData: true,
    version: "0.4.0",
  },
  {
    listing: {
      author: ZAI_AUTHOR,
      category: "utilities",
      displayName: "Restore Legacy Sessions",
      displayName_i18n: { "zh-CN": "恢复旧版会话" },
      icon: `${OFFICIAL_PLUGIN_ASSETS_BASE_URL}/restore-legacy-sessions/icon.png`,
      description_i18n: {
        "zh-CN": "将旧版会话恢复为 Drora 任务与会话记录。",
      },
    },
    name: "restore-legacy-sessions",
    rootCandidates: [
      "packages/restore-legacy-sessions-plugin",
      "../restore-legacy-sessions-plugin",
      "../../restore-legacy-sessions-plugin",
      "../../../restore-legacy-sessions-plugin",
    ],
    version: "0.1.0",
  },
  {
    defaultEnabled: true,
    name: "plugin-creator",
    version: "0.1.1",
    listing: {
      author: ZAI_AUTHOR,
      category: "utilities",
      displayName: "Plugin Creator",
      // 创建器使用客户端自带图标，不再借用 skill-creator 的远端图片。
      displayName_i18n: { "zh-CN": "插件创建器" },
      description_i18n: {
        "zh-CN": "开发、校验 Drora 插件，完成本地 dev 市场安装、试用与更新。",
      },
    },
    rootCandidates: [
      "packages/plugin-creator-plugin",
      "../plugin-creator-plugin",
      "../../plugin-creator-plugin",
      "../../../plugin-creator-plugin",
    ],
    requiredSeedPaths: [
      "skills/plugin-creator/SKILL.md",
      "skills/plugin-creator/scripts/create-basic-plugin.mjs",
      "skills/plugin-creator/scripts/marketplace-files.mjs",
      "skills/plugin-creator/scripts/upsert-dev-marketplace.mjs",
      "skills/plugin-creator/scripts/scaffold-files.mjs",
      "skills/plugin-creator/scripts/validate-plugin.mjs",
      "skills/plugin-creator/references/plugin-json-spec.md",
      "skills/plugin-creator/references/installing-and-updating.md",
    ],
  },
  {
    defaultEnabled: true,
    listing: {
      author: ZAI_AUTHOR,
      category: "utilities",
      displayName: "Skill Creator",
      displayName_i18n: { "zh-CN": "技能创建器" },
      icon: `${OFFICIAL_PLUGIN_ASSETS_BASE_URL}/skill-creator/icon.png`,
      description_i18n: { "zh-CN": "创建、编辑和验证可复用的 Drora 技能。" },
    },
    name: "skill-creator",
    rootCandidates: [
      "packages/skill-creator-plugin",
      "../skill-creator-plugin",
      "../../skill-creator-plugin",
      "../../../skill-creator-plugin",
    ],
    version: "0.1.0",
  },
  {
    // 纯内容型插件（只有 commands + skills，无 MCP / 无系统依赖），默认启用，
    // 让用户/agent 开箱即用地拿到 Drora 配置指南、自诊断技能与 dynamic workflow 编写指南。
    defaultEnabled: true,
    listing: {
      author: ZAI_AUTHOR,
      category: "utilities",
      displayName: "Drora Guide",
      displayName_i18n: { "zh-CN": "Drora 使用指南" },
      icon: `${OFFICIAL_PLUGIN_ASSETS_BASE_URL}/drora-guide/icon.png`,
      description_i18n: {
        "zh-CN": "提供 Drora 配置指南与插件、技能、MCP、命令和钩子诊断。",
      },
      examplePrompts: [
        "How do I configure MCP servers in Drora?",
        "Diagnose my current Drora setup",
      ],
      examplePrompts_i18n: {
        "zh-CN": ["Drora 里怎么配置 MCP 服务器？", "帮我诊断当前的 Drora 配置"],
      },
    },
    name: "drora-guide",
    requiredSeedPaths: OFFICIAL_DRORA_GUIDE_REQUIRED_SEED_PATHS,
    rootCandidates: [
      "packages/drora-guide-plugin",
      "../drora-guide-plugin",
      "../../drora-guide-plugin",
      "../../../drora-guide-plugin",
    ],
    version: "0.3.0",
  },
  {
    // 产品决策：电脑控制回退为默认关闭，需用户在设置页显式开启。
    // 因此这里不声明 defaultEnabled——computer-use 携带 SDK 客户端与系统 Helper 依赖，
    // 默认开启意味着每个新用户首启即注入整套工具集并拉起 Helper。
    // 「defaultEnabled 仅限内容型插件」的旧约定随之恢复完整。
    // 判定式是 enabledPlugins[id] ?? defaultEnabled：曾在设置页手动开过的用户已落盘
    // 显式 true，不受本次默认值变更影响。改回默认开启时，需同步
    // packages/shared/src/plugin-marketplaces.ts 的名单（bootstrap 单测机械对照两者）、
    // isDroraCuaInternalFeatureEnabled（打包层默认 true）与输入框入口 hidden 默认值的联动语义。
    name: "computer-use",
    hostMcpServerNames: ["node_repl"],
    // 用户露出名统一为「Computer Use / 电脑控制」。包名与 producer workspace 包仍保持 drora-cua，
    // 以兼容原生 Helper identity；EN 描述基线走 manifest
    // description，这里只放 zh-CN 覆盖；resolveLocalizedText 在 en-US 时回退到 manifest。
    listing: {
      author: ZAI_AUTHOR,
      category: "productivity",
      displayName: "Computer Use",
      displayName_i18n: { "zh-CN": "电脑控制" },
      description_i18n: {
        "zh-CN": "自动化桌面应用：智能体驱动鼠标、键盘与界面元素，代你完成实际任务。",
      },
      // 插件更名为 computer-use 后，CDN 图标仍发布在 drora-cua 目录；沿用资源路径避免 404。
      icon: `${OFFICIAL_PLUGIN_ASSETS_BASE_URL}/zcode-cua/icon.png`,
    },
    rootCandidates: [
      "packages/zcode-cua-plugin",
      "../zcode-cua-plugin",
      "../../zcode-cua-plugin",
      "../../../zcode-cua-plugin",
    ],
    requiredSeedPaths: OFFICIAL_CUA_REQUIRED_SEED_PATHS,
    // Bug 根因：迁移 node_repl 时把旧 MCP launcher 与 SDK 仍需的 Sharp runtime 一并裁掉了。
    // Dev/desktop 会把最小 Sharp 闭包 stage 到这里；官方 cache 必须继续携带 node_modules，
    // 否则 seed 原子替换后首次截图才会报 Cannot find module 'sharp'。
    runtimeTopLevelPaths: ["node_modules"],
    // 这里的 version 追踪上游 drora-cua runtime 版本，使插件 UI 展示、缓存路径、
    // marketplace 条目都对齐；具体版本由原子 producer bump 工作流维护。
    // 0.6.5（2026-11-09 R4.1 解冻）：wrapper 与 manifest 已随 0.6.5 切段同步 bump，
    // 冻结条件（插件资产与 0.6.5 对齐）已满足；版本一致性仍由
    // check-version-coherence.mjs --check 门禁锁定。
    version: "0.6.5",
  },
  {
    // Drora Sites（技术方案 4）：Skill 指导 Agent 把项目改造并打包成 runner 可直接运行的产物包，
    // 再用 scripts/drora-site.mjs（CLI）上传发布；commands/ 是 /site-* 斜杠命令。
    // 0.4.0 起自带 Sites 面板（UI plugin）：MCP server 与面板页面构建进 dist/，只给面板用，模型看不到
    // （docs/site/sites-panel.md）。默认开启，用户不必先去设置里打开就能让 Agent 部署站点。
    componentTypes: ["ui"],
    name: "drora-site",
    defaultEnabled: true,
    listing: {
      author: ZAI_AUTHOR,
      category: "productivity",
      displayName: "Drora Sites",
      displayName_i18n: { "zh-CN": "Drora Sites" },
      description_i18n: {
        "zh-CN": "把 Web 项目改造为可在云端 Linux 运行的部署包，一个 start.sh 即可启动。",
      },
      examplePrompts: ["Deploy this project as a website"],
      examplePrompts_i18n: { "zh-CN": ["把这个项目部署成网站"] },
      icon: `${OFFICIAL_PLUGIN_ASSETS_BASE_URL}/drora-site/icon.png`,
    },
    rootCandidates: [
      "packages/drora-site-plugin",
      "../drora-site-plugin",
      "../../drora-site-plugin",
      "../../../drora-site-plugin",
    ],
    requiredSeedPaths: [
      "commands/site-deploy.md",
      "scripts/drora-site.mjs",
      "scripts/stage.mjs",
      "skills/site-deploy/SKILL.md",
      "skills/site-deploy/templates/static.sh",
      "skills/site-deploy/templates/static-server.mjs",
      "skills/site-deploy/templates/node.sh",
      "skills/site-deploy/templates/python.sh",
      // 缺了会 seed 出能看到面板入口却启动不了 MCP server 的残缺插件。
      "dist/server.mjs",
      "dist/ui/panel.html",
    ],
    version: "0.4.2",
  },
];

// 在 official plugin 定义里标了 defaultEnabled: true 的, 拼成 `<name>@<marketplace>` 形式,
// 透传给 adapter 让它在用户没显式配置时默认开启 (内容型 plugin 才适用)。
// 注意: 任何解析 plugin 的入口 (CLI 子命令 resolveDroraPlugins、应用启动 resolveStartupPlugins)
// 都必须把这个集合传给 discoverNodePluginsSync, 否则 defaultEnabled 不生效。
export const DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS: ReadonlySet<string> = new Set(
  OFFICIAL_PLUGIN_DEFINITIONS.filter((definition) => definition.defaultEnabled).map(
    (definition) => `${definition.name}@${DRORA_OFFICIAL_PLUGIN_MARKETPLACE}`,
  ),
);

export function resolveOfficialPluginHostMcpServerNames(pluginId: string): string[] {
  const definition = OFFICIAL_PLUGIN_DEFINITIONS.find(
    (candidate) => `${candidate.name}@${DRORA_OFFICIAL_PLUGIN_MARKETPLACE}` === pluginId,
  );
  return definition?.hostMcpServerNames ? [...definition.hostMcpServerNames] : [];
}

/** 宿主服务归属反查（§4.2 hostServices 键，与 hostMcpServerNames 同一查找口径）。 */
export function resolveOfficialPluginHostServices(pluginId: string): string[] {
  const definition = OFFICIAL_PLUGIN_DEFINITIONS.find(
    (candidate) => `${candidate.name}@${DRORA_OFFICIAL_PLUGIN_MARKETPLACE}` === pluginId,
  );
  return definition?.hostServices ? [...definition.hostServices] : [];
}

/**
 * app 级常驻服务声明反查（§6 g1，P1；与 hostServices 同一查找口径），未声明即 undefined。
 * 消费方是 bootstrap official-plugin-app-service 启动链。
 */
export function resolveOfficialPluginAppService(
  pluginId: string,
): OfficialPluginAppServiceDeclaration | undefined {
  const definition = OFFICIAL_PLUGIN_DEFINITIONS.find(
    (candidate) => `${candidate.name}@${DRORA_OFFICIAL_PLUGIN_MARKETPLACE}` === pluginId,
  );
  return definition?.appService;
}

/**
 * 定义级卸载数据保留解析（§6 D6-a 起源；阶段二 §11-D6 升级为强制）：声明 true 的
 * 插件（obsidian——数据目录含知识库+模型，rm 即全库丢失）**无条件保留**，显式
 * keepData:false 不生效；未声明插件回落「显式参数优先，缺省 false（删）」的全局语义。
 */
export function resolveOfficialPluginUninstallKeepData(
  pluginId: string,
  explicit?: boolean,
): boolean {
  const forced =
    OFFICIAL_PLUGIN_DEFINITIONS.find(
      (candidate) => `${candidate.name}@${DRORA_OFFICIAL_PLUGIN_MARKETPLACE}` === pluginId,
    )?.uninstallKeepData ?? false;
  return forced || explicit === true;
}

/**
 * 官方插件由 host CLI 注入的 MCP（如 browser-use 的 `node_repl`）server name 不带 `plugin:` 前缀，
 * 资源管理器归属插件时需要反查所属官方插件名。
 */
export function resolveOfficialPluginNameByHostMcpServerName(
  serverName: string,
): string | undefined {
  return OFFICIAL_PLUGIN_DEFINITIONS.find((definition) =>
    definition.hostMcpServerNames?.includes(serverName),
  )?.name;
}
