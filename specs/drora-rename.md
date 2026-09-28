# Drora 全量重命名 Spec（ZCode → Drora）

用户决策：全量重命名（品牌层 + CLI 命令名 + 包名 + 环境变量 + 数据目录 + 市场 id）。
本 spec 是映射规则、豁免清单与验收口径的唯一权威。

## 替换规则（有序，全部文本文件）

| 序  | 规则                                                                                                                            | 说明                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 0   | 占位保护 `cdn-zcode.z.ai`、`/zcode/official-plugin/`、`https://zcode.z.ai`、`zcode://oauth/callback`、bigmodel `appId: "zcode"` | 外部 CDN 主机/路径与后端 API 端点是 z.ai 基础设施，改名即失效；OAuth 中转页白名单只认 `zcode://oauth/callback`，appId 是服务端注册值 |
| 1   | `@zcode/` → `@drora/`                                                                                                           | 包 scope（import specifier 与 package.json 依赖/名称）                                                                               |
| 2   | `ZCODE_` → `DRORA_`                                                                                                             | 环境变量（ZCODE_ENV、ZCODE_PLUGIN_ROOT/DATA/PROJECT_DIR 等）                                                                         |
| 3   | `.zcode` → `.drora`（但 `.zcode-plugin`/`.zcode-plugin-seed.json` 保留）                                                        | 用户数据目录 `~/.zcode`；插件 manifest 目录约定保留（与 0.5.13 逐字 seed 共享的磁盘格式，避免 8 处发现逻辑双读）                     |
| 4   | `ZCode` → `Drora`                                                                                                               | 品牌显示词（productName、UI 文案、文档）                                                                                             |
| 5   | `ZCODE` → `DRORA`                                                                                                               | 剩余全大写                                                                                                                           |
| 6   | `Zcode` → `Drora`                                                                                                               | 标题式变体（含标识符 normalizeDesktopZCodeEnv 等）                                                                                   |
| 7   | `z-code` → `drora`                                                                                                              | 连字变体                                                                                                                             |
| 8   | `zcode` → `drora`                                                                                                               | 兜底小写（命令名、路径、文件名、目录名引用）                                                                                         |

## 改名桥接（规则 0 配套，2026-09-25）

官方插件市场源指向 z.ai 共享 CDN（规则 0 豁免的外部设施），其清单以原版名
`zcode-plugins-official` 发布；Drora 的 canonical 市场 id 为
`drora-plugins-official`。加载官方源时在
`adapters/src/plugins/marketplace.ts` 做改名桥接（manifest.name 与 raw.name
归一到 canonical；插件条目不含市场后缀，无需逐条改）。安全面：仅对固定
官方 CDN 源生效，清单经 HTTPS 取自官方基础设施。

## 豁免区（内容逐字不动）

1. **apps/drora-cli/packages/zcode-cua-plugin/**：0.5.13 逐字 seed（dist/mcp + node_modules +
   manifest = 原版形态，md5 审计基线）。目录与包名不改；其 scripts/ 是 producer 联动工具，
   引用上游 zcode-cua 仓库名，一并豁免。
2. **packages/zcode-cua/ 与 packages/zcode-cua-helper/**：还原权威区。仅替换其中
   `@zcode/` import specifier 与 package.json name 的 scope（@drora/zcode-cua 等），
   其余内容（broker/管道/身份字符串、dist/windows-helper.js 原版 bundle、逆向档案）逐字保留，
   保证与原版发行物的对齐测试（221 项 E2E、8 项 parity、restored-smoke）持续有效。
   **2026-09-28 修订（用户裁定：Helper 身份 Drora 化）**：自签名链落地后 Helper 的
   签名身份已归 Drora（specs/update-feed-github.md「macOS 发布签名身份」），用户可见
   身份仍叫 "ZCode Computer Use" 构成品牌撕裂（TCC 授权弹窗/活动监视器/设置页/
   安装路径/permission_status.grant_owner）。修订如下：
   - **改名面（Drora 化）**：`HELPER_APP_NAME` "ZCode Computer Use.app" →
     "Drora Computer Use.app"；`HELPER_DISPLAY_NAME` → "Drora Computer Use"；
     `DEV_HELPER_APP_NAME` → "Drora Computer Use Dev.app"；
     `HELPER_BUNDLE_ID` "dev.zcode.cua-helper" → "dev.drora.cua-helper"；
     `DEV_CUA_HELPER_BUNDLE_ID` → "dev.drora.cua-helper.dev"（两棵常量树
     helperConstants.ts / broker-helper-constants.js 为单一出处，散落字面量随常量走）。
     连带：buildId 前缀本就为 drora-*；安装路径 ~/.drora/computer-use/<新 app 名>；
     TCC 授权主体随 bundle id 变更一次性重置（发布前执行，无存量授权损失）。
   - **保留逐字（官方锚点，非 Drora 身份）**：launcher 门钉扎 `dev.zcode.app` +
     TeamID `8A5X4JJ39T`（`HELPER_TEAM_ID`，官方发射门与严格链锚定的是官方发行物，
     改名即篡改还原语义）；`resources/cua-helper*/` 官方 staging/参照副本（含其
     "ZCode Computer Use.app" 原名与 bundle id）；上游仓库名/目录名
     （packages/zcode-cua* 等）；dist/windows-helper.js 原版 bundle；
     parity 工具中「官方侧」路径与断言。
   - 验收：zcode-cua 全套测试（restored-smoke/embedded-build-id/mac-launch-contract/
     cua-tool-layer-smoke/adhoc-distribution-profile）+ parity（our 侧新名/orig 侧
     原名）+ win32 tsc/build 无损 + 签名打包真机首用链全绿。
3. **third-party/ 与 THIRD-PARTY-NOTICES.md**：来源出处记录（provenance），改名即篡改记录。
4. **docs/cua-restoration-manifest.md**：17-19 轮还原历史档案，保留原称谓。
5. **pnpm-lock.yaml**：不 sed，由 `pnpm install` 重生成。

## 豁免区引发的兼容点

- `.zcode-plugin/` manifest 目录约定全仓库保留（含 cua seed），宿主发现逻辑零改动。
  （实现教训：兜底规则 `zcode→drora` 会越过第 3 条规则的 lookahead 改掉
  `.zcode-plugin`，本次已全仓回退该约定并 git mv 各插件 manifest 目录。）
- 目录 `packages/zcode-cua`、`packages/zcode-cua-helper`、`apps/zcode-cli/packages/
zcode-cua-plugin` 保留原名（与其豁免身份一致，CI/打包清单路径引用不变）。
- **OAuth 登录回调链路（重命名第 0 轮曾误改，2026-09 修复）**：登录授权地址由
  `buildDesktopOAuthRedirectUriFromEnv` 构造为官网中转页
  `https://<origin>/app/oauth/login?redirect=zcode://oauth/callback&app_version=...`，
  中转页对 `redirect` 参数做白名单校验。改名后浏览器授权完成会报
  "The sign-in callback URL is invalid"。对齐口径：
  - `packages/services/src/oauth/providers/configUtils.ts` 的
    `DESKTOP_OAUTH_CALLBACK_URI = "zcode://oauth/callback"`；
  - bigmodel provider `appId: "zcode"`（服务端注册值）；
  - 两个 provider 的静态 `redirectUri: "zcode://oauth/callback"`；
  - 桌面端注册 `zcode` + `drora` 双 scheme（`registerDeepLinkProtocol`、
    electron-builder `protocols.schemes`、Linux `MimeType`、dev 壳 Info.plist），
    `desktopDeepLinkUrl.ts` 对所有 deep-link 路由等价接受两个 scheme；
  - 验收：`packages/services/test/oauthDesktopCallbackContract.test.ts` 与
    `packages/desktop/test/desktopDeepLinkUrl.test.ts` 全绿。

## 目录/路径改名

- `apps/zcode-cli` → `apps/drora-cli`（workspace glob、CI、桌面打包清单、SEA 脚本同步）
- `packages/zcode-server-cli` → `packages/drora-server-cli`（根 typecheck 列表同步）
- `packages/shared/src/zcode-protocol` → `packages/shared/src/drora-protocol`
  （子路径导出与 import specifier 同步；AGENTS.md 指引同步）
- CLI 产物 `zcode.cjs` → `drora.cjs`；SEA 产物 `zcode-<os>-<arch>` → `drora-<os>-<arch>`
  （release 定位模式与 release-artifact-check.sh 同步）
- 桌面 productName `ZCode` → `Drora`（安装包名 Drora-0.0.1-\*、窗口标题、build-meta）
- 官方市场 id `zcode-plugins-official` → `drora-plugins-official`（contracts 常量、
  已装插件状态键会孤儿化——v0.0.1 无外部用户，接受重置）

## 验收

1. 除豁免区外，`git grep -i zcode` 零命中（外部保护 URL 除外）。
2. `pnpm install` 重生成 lockfile 成功；`pnpm typecheck`、`pnpm lint` 通过。
3. CLI 闭包构建 + cli-app-server-smoke（drora.cjs）通过。
4. obsidian 插件测试（安全语义 + stdio E2E）通过。
5. CUA restored-smoke（mock broker）通过；addon-parity 留 CI 验证。
6. 本地 win-x64 打包产出 `Drora-0.0.1-win-x64.exe`。
7. 重打 v0.0.1 后 Release 资产为 Drora-_/drora-_ 命名且完整性门禁全 PASS。

## 浏览器 responseMeta 键改名映射（2026-09-26，批 5 审查补记）

原版自身对浏览器桥 meta 键使用双前缀：`codex/browserUse`（@7523986 族）与
`zcode/browserTurnScreenshot`（@7470647 族）。本仓统一为 `drora/*`，三个键
（browserUse/toolSurface/browserTurnScreenshot）已提为 contracts 常量
（NODE*REPL*\*\_META_KEY，interfaces/mcp.port.ts），生产方（宿主 browser-bridge）
与消费方（core node-repl handler/session）引用同一常量。bundle parity 归一化
时 codex→drora 与 zcode→drora 都要映射。

## 归因 wire header 豁免（2026-09-26，批 3 provider 审查补记）

随每个模型请求发往 z.ai Coding Plan 网关的归因 header 是**服务端按名读取的 wire 契约**，
与规则 0 同族（后端是 z.ai 基础设施，改名即失效——main/subagent 归因与链路追踪读不到）：

- `x-zcode-trace-id`（三处消费：NodeHttpClientAdapter @2712432、provider endpoint
  routing @3710178、runner attribution @3938855）
- `x-zcode-session-type`（@3938855，main/subagent/other 来源区分）

实现位置：`adapters/src/model/runner-attribution.ts`（attribution）与
`adapters/src/http/index.ts`（通用 HTTP adapter 的 trace 透传）；debug 的
network-capture.ts 捕获列表同时认 zcode/drora 两种前缀。改名重放时这两个 header
名不得被 sweep 改写；`x-request-id`/`x-session-id`/`x-query-id` 未改名原样保留。
已知遗留（P2 备案）：`drora-source-headers.ts` 的出站源 header 组内一半改名
（User-Agent/X-Drora-App-Version）一半保留（X-Title "Z Code@"），z.ai 端灰度/客户端
识别会把 Drora 归入未知桶——待确认服务端消费语义后整组统一。
