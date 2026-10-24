# 官方发行项目全貌调研：D:/software/zcode/resources/glm

- 调研日期：2026-10-19
- 调研方式：只读（find / cat / grep / du / node -e JSON 解析；zcode.cjs 未整读）
- 对应批次：batch1-target-overview

## 1. 目录树（find -maxdepth 2）

```
D:/software/zcode/resources/glm/
├── .node-bundle-meta.json      (142 B)
├── zcode.cjs                   (15,127,039 B ≈ 14.4 MB, 15647 行, mtime 2025-10-13, 可执行)
├── debug/
│   └── zcode-debug.cjs         (14,821,589 B ≈ 14.1 MB, 15450 行, mtime 2025-09-27, 可执行)
├── provider/
│   └── zcode-builtin.json      (188,476 B, mtime 2025-09-26)
└── packages/                   (16 个目录, 见 §3)
    ├── android-emulator-plugin/    (1.6M)  [.mcp.json .zcode-plugin/ README.md commands/ dist/ hooks/ package.json scripts/ skills/ templates/]
    ├── browser-use-plugin/         (20M)   [.zcode-plugin/ README.md docs/ node_modules/ package.json scripts/ skills/]
    ├── bundled-skills/             (180K)  [README.md skills/]                ← 已知清单之外
    ├── documents-plugin/           (689K)  [.zcode-plugin/ agents/ package.json skills/]
    ├── image-search-plugin/        (14K)   [.mcp.json .zcode-plugin/ README.md package.json]
    ├── ios-simulator-plugin/       (1.5M)  [.mcp.json .zcode-plugin/ README.md commands/ dist/ hooks/ package.json scripts/ skills/ templates/]
    ├── node-repl-host/             (25M)   [.zcode-plugin/ README.md dist/ node_modules/ package.json scripts/]
    ├── pdf-plugin/                 (1.2M)  [.zcode-plugin/ agents/ package.json skills/]
    ├── plugin-creator-plugin/      (58K)   [.zcode-plugin/ package.json skills/]
    ├── presentations-plugin/       (71K)   [.zcode-plugin/ agents/ package.json skills/]
    ├── restore-legacy-sessions-plugin/ (59K) [.zcode-plugin/ README.md commands/ package.json skills/]
    ├── skill-creator-plugin/       (14K)   [.zcode-plugin/ package.json skills/]
    ├── spreadsheets-plugin/        (351K)  [.zcode-plugin/ agents/ package.json skills/]
    ├── visualize-plugin/           (1.1M)  [.zcode-plugin/ package.json skills/]
    ├── zcode-cua-plugin/           (22M)   [.zcode-plugin/ docs/ node_modules/ package.json scripts/ skills/]
    └── zcode-guide-plugin/         (78K)   [.zcode-plugin/ README.md package.json skills/]
```

`glm/` 总体积 102M。node_modules 仅出现在 3 个包：browser-use-plugin、node-repl-host、zcode-cua-plugin，内容均为原生依赖（`@img/sharp-win32-x64`、`detect-libc`、`semver`；zcode-cua 额外带 `koffi`）。

安装根还有（glm 之外，供上下文）：`D:/software/zcode/.zcode-install-manifest`（77KB 全量文件清单，含 593 条 glm 条目）、`ZCode.exe`（Electron 壳）、`resources/app/`（desktop 源码产物）、`resources/app.asar`（340MB）、`resources/tools/`（cua-helper、ripgrep/rg.exe、ugrep）、`resources/config/`。

## 2. 顶层 CLI：zcode.cjs 与 .node-bundle-meta.json

`.node-bundle-meta.json` 全文：

```json
{
  "runtime": "electron-node",
  "entry": "zcode.cjs",
  "platform": "win32-x64",
  "source": "apps/zcode-cli/packages/cli/dist/zcode.cjs"
}
```

zcode.cjs 头部为 `#!/usr/bin/env node "use strict";...` 的 esbuild minified bundle；进程标题常量为 `xrr="zcode", v$t="zcode-cli"`（`setCliProcessTitle`）。尾部结构以 `normalizeProcessExitCode` / `waitForPendingWarnings` 收尾。

## 3. packages/ 插件包清单（16 个）

### 3.1 总表：package.json 字段 + .zcode-plugin/plugin.json 清单

说明：所有插件目录（bundled-skills 除外）的 `.zcode-plugin` 是**目录**，内含 `plugin.json` 完整插件清单；`plugin.json` 的 `name` 一律去掉 `-plugin` 后缀（如 `zcode-guide-plugin` → `zcode-guide`）。

| 目录 | package.json name | ver | plugin.json name | 入口/bin | 体积 | 职责推断 |
|---|---|---|---|---|---|---|
| android-emulator-plugin | @zcode/android-emulator-plugin | 0.1.0 | android-emulator | bin `android-emulator-mcp` → dist/mcp/server.js（exports `./mcp`） | 1.6M | Android 模拟器自动化：MCP server + `android-dev` skill/command + hooks.json + compose-app 模板；userConfig（sdk_path/avd/api_level/jdk 等 8 项） |
| browser-use-plugin | @zcode/browser-use-plugin | 0.5.1 | browser-use | main dist/mcp/server.js | 20M | 浏览器自动化 runtime + skills `control-browser`、`web-gui-tester` + docs（13 个 md/json）；node_repl 执行面由 node-repl-host 提供 |
| bundled-skills | （无 package.json） | — | （无 .zcode-plugin） | — | 180K | 仅 `skills/dynamic-workflows/` 一个内置技能 |
| documents-plugin | @zcode/documents-plugin | 0.1.8 | documents | 无 main（纯 skill 包） | 689K | docx 技能 + `visual-judge` agent；description_i18n（en/zh-CN） |
| image-search-plugin | @zcode/image-search-plugin | 0.1.1 | image-search | .mcp.json 声明 HTTP MCP | 14K | 搜图：远程 HTTP MCP `${ZCODE_BASE_URL}/api/v1/mcp/server/image_search`，auth `zcode_official`/jwt_token，timeout 90s |
| ios-simulator-plugin | @zcode/ios-simulator-plugin | 0.1.0 | ios-simulator | bin `ios-simulator-mcp` → dist/mcp/server.js | 1.5M | iOS 模拟器自动化：MCP + `ios-dev` skill/command + hooks + swiftui-app 模板；userConfig（default_device/ui_backend） |
| node-repl-host | @zcode/node-repl-host | 0.6.1 | node-repl-host | exports `./src/server.ts` 及 cua-bridge/browser-bridge/cua-broker/result/tool-contract/runtime-bridge；dist/mcp 为打包产物 | 25M | 共享 node_repl MCP 宿主，持有 JS 执行面与 CUA/Browser 域桥；依赖 @zcode/zcode-cua (catalog:) |
| pdf-plugin | @zcode/pdf-plugin | 0.1.8 | pdf | 无 main | 1.2M | pdf 技能 + visual-judge agent；i18n |
| plugin-creator-plugin | @zcode/plugin-creator-plugin | 0.1.1 | plugin-creator | 无 main（type: module）；test:integration 引用 `../cli/dist/zcode.cjs` | 58K | 插件创作 skill 与脚手架 |
| presentations-plugin | @zcode/presentations-plugin | 0.1.8 | presentations | 无 main | 71K | pptx 技能 + visual-judge；i18n |
| restore-legacy-sessions-plugin | @zcode/restore-legacy-sessions-plugin | 0.1.0 | restore-legacy-sessions | 无 main | 59K | 旧版会话恢复 skill + 同名 command |
| skill-creator-plugin | @zcode/skill-creator-plugin | 0.1.0 | skill-creator | 无 main | 14K | skill 创作技能 |
| spreadsheets-plugin | @zcode/spreadsheets-plugin | 0.1.8 | spreadsheets | 无 main | 351K | xlsx 技能 + visual-judge；i18n |
| visualize-plugin | @zcode/visualize-plugin | 0.1.0 | visualize | 无 main（type: module） | 1.1M | Gen UI 可视化技能（visualize skill） |
| zcode-cua-plugin | @zcode/zcode-cua-plugin | 0.6.4 | computer-use | main `./scripts/computer-use-client.mjs` | 22M | Computer Use SDK + `computer-use` skill；执行由 node-repl-host 承担；依赖 @zcode/zcode-cua (catalog:)；node_modules 带 koffi |
| zcode-guide-plugin | @zcode/zcode-guide-plugin | 0.3.0 | zcode-guide | 无 main | 78K | 使用/自诊断指南技能集：diagnosing-commands/-hooks/-mcp/-plugins/-skills + zcode-configuration-guide 共 6 个 |

### 3.2 依赖要点

- workspace 内部依赖（`workspace:*`）：browser-use 与 node-repl-host 依赖 `@zcode/contracts`、`@zcode/core`、`@zcode/shared`；browser-use 另依赖 `@zcode/node-repl-host`，devDeps 有 `@zcode/adapters`、`@zcode/bootstrap`。
- MCP SDK：本地 stdio MCP（android/ios/node-repl-host/browser-use）统一 `"@modelcontextprotocol/server": "2.0.0"`（devDeps 配 client 2.0.0）；zod 4.x。
- 工具链：esbuild ^0.25、typescript ^5.9、vitest ^4.1.5、@types/node ^24。
- 版本分层明显：node-repl-host/zcode-cua（0.6.x，执行面）> browser-use（0.5.x，运行时）> zcode-guide（0.3.x）> 文档/创作类（0.1.x）。

## 4. provider/ 目录结论

**是模型 provider 配置目录（纯 JSON，非二进制）**，唯一文件 `zcode-builtin.json`（188KB）：

```json
{ "schemaVersion": 1, "revision": 30, "config": { ... } }
```

`config` 两大部分：

- `providerConfigRules.templateRules`（20 个接入模板）：`zai-api`（Z.ai Coding Plan，anthropic-messages → `https://api.z.ai/api/anthropic`，access `zhipu-coding-plan-api-key`，builtinModelIds `["GLM-5.3","GLM-5.3-Flash"]`）、`zai-standard-api`（openai-chat-completions → `https://api.z.ai/api/paas/v4`，含 GLM-5.3/5.1/5/4.7/4.6/4.5/4.1V/4V 全系）、`bigmodel-api`、`bigmodel-standard-api`、`moonshot-kimi`、`minimax`、`deepseek`、`qwen-alibaba-model-studio-cn/-intl`、`xiaomi-mimo`、`openai`、`anthropic`、`xai`、`openrouter`、`opencode-go-chat/-messages/-responses`、`opencode-zen-responses/-messages/-chat`。
- `providerConfigRules.providerRules`（8 个账号型 provider）：`account:zai-individual-coding-plan`、`account:zai-team-coding-plan`、`account:zai-start-plan`、`account:bigmodel-individual-coding-plan`、`account:bigmodel-team-coding-plan`、`account:bigmodel-start-plan`、`account:zai-offpeak-idle-plan`、`account:bigmodel-offpeak-idle-plan`（按 group `zai-family`/`bigmodel-family` 分组）。
- `modelConfigRules`：`modelRules` 84 条、`modelApiRules` 72 条、`providerSiteRules` 52 条、`templateModelRules` 244 条、`builtinProviderModelRules` 26 条。

即该文件是官方内置的 provider/模型目录（模板 + 账号计划 + 模型元数据），对应本仓 Drora 的 provider 对齐对象。

## 5. debug/ 目录结论

`zcode-debug.cjs`（14,821,589 B）：

- 头部与主 bundle 同构：`#!/usr/bin/env node` + esbuild minified，含相同 `aZn="zcode", L8t="zcode-cli"`（进程标题）与 `setCliProcessTitle`；尾部同为 `normalizeProcessExitCode`/`waitForPendingWarnings`。
- 15450 行 vs 主 bundle 15647 行；`--inspect` 系列出现次数一致（各 40 次，属 Node flag 表）。
- 同样含 `typeof __ZCODE_VERSION__<"u"?__ZCODE_VERSION__:"0.0.0-dev"`（define 未应用）。
- **未被引用**：主 bundle 中 grep `zcode-debug` 零命中；`resources/app.asar` 二进制 grep 亦零命中；安装清单 `.zcode-install-manifest` 含 `resources\debug\zcode-debug.cjs` 条目（随发行包分发）。
- mtime 2025-09-27，早于主 bundle（2025-10-13）。

**判定**：是同一 zcode-cli 入口的另一个 esbuild 构建产物（调试用/保留构建），作为独立 CLI 随包附带，不是主入口的运行时依赖。精确差异需逐段 diff（本次未做）。

## 6. 版本判定：**3.14.3**

证据链：

1. `D:/software/zcode/resources/app/package.json`（发行内桌面应用清单）：`"name": "@zcode/desktop"`、`"version": "3.14.3"` —— 发行版本唯一权威字面量。
2. CLI bundle 自身**不含**版本字面量：zcode.cjs 中 `a2=typeof __ZCODE_VERSION__<"u"?__ZCODE_VERSION__:"0.0.0-dev",vur=typeof __ZCODE_COMMIT__<"u"?__ZCODE_COMMIT__:"unknown"`，即构建时经 esbuild define 注入，且该 artifact 中 define 未生效（运行时回退 "0.0.0-dev"）。grep `3\.1[0-9]\.[0-9]\+` 在 zcode.cjs 零命中，故无法从 CLI 直接判定版本。
3. `.node-bundle-meta.json` 仅声明 runtime/entry/platform/source，无版本。
4. 旁证：包内 semver 依赖 `playwright-core 1.59.1`、`@modelcontextprotocol/* 2.0.0`、`zod 4.6.5`，与 Drora 仓 3.14 代际观测一致。

结论：**该发行 bundle 为官方 3.14.3**（注意：Drora 当前对齐基线是 3.15.1，本机安装的官方版落后一个小版本线，做差分时需注明目标版本错位）。

## 7. 意外发现与对齐提示

1. **packages 实为 16 个目录**：已知清单漏了 `bundled-skills`（无 package.json、无 plugin.json，仅 `skills/dynamic-workflows`）——与 Drora 仓 `apps/drora-cli/packages/bundled-skills` 结构同源。
2. **`.zcode-plugin` 是目录而非标记文件**，内含 `plugin.json` 完整清单（name/version/description_i18n/skills/commands/agents/mcpServers/userConfig），这是官方插件清单的一等格式。
3. **双 MCP 声明格式并存**：android/ios 同时有 plugin.json 内 `mcpServers`（占位符 `${ZCODE_PLUGIN_ROOT}`/`${ZCODE_PROJECT_DIR}`/`${ZCODE_PLUGIN_DATA}`）和顶层 `.mcp.json`（占位符 `${CLAUDE_PLUGIN_ROOT}` 等 Claude 命名空间 + `${user_config.*}`）——后者疑似兼容格式；image-search 仅有 `.mcp.json`（HTTP 型远程 MCP，`${ZCODE_BASE_URL}/api/v1/mcp/server/image_search`，`zcode_official` jwt 认证）。
4. **原生依赖随包分发**：sharp(win32-x64) 在 3 个包、koffi 在 zcode-cua；对齐/迁移时需处理平台二进制。
5. **发行包附带 tools**：`resources/tools/`（cua-helper、ripgrep rg.exe、ugrep.exe，各带 .bundle-meta.json/SOURCES.json），CLI 工具链由发行包供给而非 npm。
6. **provider 目录是 JSON 配置**而非二进制，`schemaVersion/revision` 结构适合做字面量族差分（可并入 `check-bundle-key-parity` 思路）。
7. `plugin-creator-plugin` 的集成测试直接引用 `../cli/dist/zcode.cjs`，佐证 monorepo 源路径 `apps/zcode-cli/packages/cli` 与 meta 一致。
