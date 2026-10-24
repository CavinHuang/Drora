# 独立 MCP 直跑（Computer Use 脱离桌面宿主）评估

## 结论（建议）

**维持现状：Computer Use 由桌面宿主托管运行；CLI/独立进程维持 fail-closed。**
不建议在 v0.0.x 阶段实施"独立 MCP 直跑"。理由与实施代价见下；若未来产品决定
支持"纯 CLI 用户的 Computer Use"，正确的形态是"Helper 生命周期编排 + TUI 权限
提示"作为独立特性立项，而不是恢复被开源剥离的 token 凭据回退。

## 现状（已验证的事实）

1. CUA MCP server（`packages/zcode-cua/src/mcp/server.ts` 的 `buildServer`）
   在缺少 `brokerSocketPath` 或 `brokerToken` 时注册 **0 个工具**——静默
   fail-closed，不崩、不越权。CLI 场景（插件由 manifest 直接 spawn、无宿主
   凭据注入）即此形态：agent 看不到 Computer Use 工具。
2. 凭据的合法来源只有桌面宿主：desktop 以 `__drora-plugin-host` 子命令拉起
   MCP server 时，经 `plugin-host-command.ts` 的三重断言（resolver 权威写入的
   plugin id + 完整捕获凭据组 + canonical broker socket）恢复 bearer token。
   断言防止第三方/被替换插件借宿主边界拿到 TCC 能力。
3. Windows 上原生能力经 helper（`windows-helper.js`，提权安装）+ broker
   中转；`unsafe-pointer.node`/`koffi` 原生绑定把 N-API 符号绑定到 NODE.EXE
   （见 specs/sea-tui-node-alias.md 同类问题）。权限请求（
   `permission-broker-client.ts`，574 行）依赖桌面 UI 完成用户授权手势。

## 解封需要什么（若产品决定支持）

| 工作块                        | 内容                                                                                                        | 规模 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- | ---- |
| Helper 生命周期编排（CLI 侧） | 提权安装、启动、健康检查、升级、卸载——桌面宿主里这部分横跨 helper-installer/launcher/verifier/orphan-reaper | 大   |
| 权限提示 UX                   | broker 的 permission-request 目前由桌面窗口应答；CLI 需要 TUI/系统通知形态的授权流（且是安全敏感 UI）       | 大   |
| 凭据发放                      | CLI 宿主生成 token + 写 canonical socket + 注入 MCP env，替代 plugin-host-command 的宿主捕获路径            | 中   |
| 协议对齐                      | 原版 0.5.13 的 token 凭据组字段与现身份模式的字段差异逐一回放                                               | 中   |

## 建议

- v0.0.x：维持 fail-closed。当前行为**安全上正确**：没有宿主凭据的进程
  本就不该拿到桌面控制能力。
- 若要支持：以"CLI 宿主"为产品立项（Helper 编排 + TUI 授权 UI），另立
  spec 与实施计划；不要以恢复 token 回退的方式静默放开。

## 2026-10-24 官方 zcode-cua-plugin 0.6.5 同步记录

官方参考物：`D:/software/ZCode/resources/glm/packages/zcode-cua-plugin`（0.6.5）。
官方 0.6.3→0.6.5 的实质变化：producer 收编进官方 mono-repo（依赖改 `workspace:*`、
`sync-skill.mjs` 极简化为仓内拷贝、`check-version-coherence.mjs` 重写为 workspace 断言、
license 改 Apache-2.0、去除 Codex/@oai 注释表述、docs 示例域名中性化）；运行时客户端
无行为变化（对照官方 0.6.5 全量 diff 证实：除注释表述外无运行时 diff）。

### 同步了什么（本组：apps/drora-cli/packages/zcode-cua-plugin）

| 文件 | 变化 | 依据 |
| --- | --- | --- |
| `.zcode-plugin/plugin.json` | version 0.6.3→0.6.5；新增 `license: "Apache-2.0"`（现与官方 0.6.5 逐字节一致） | 官方 0.6.5 `plugin.json` |
| `package.json` | version 0.6.3→0.6.5；license MIT→Apache-2.0；scripts 与 `catalog:` 依赖保持本仓接缝不动 | 官方 0.6.5 `package.json` |
| `scripts/computer-use-client.mjs` | 整体对齐官方 0.6.5（去 Codex/@oai 注释表述，无运行时变化）；重放本仓 `action_receipt` 收据下钻补丁（`receiptOf`，官方 0.6.3/0.6.5 均无此下钻）；文件头注明对齐依据与本仓接缝 | 官方 0.6.5 `scripts/computer-use-client.mjs` |
| `docs/computer-use.md` | 示例域名 `openai.com`→`example.com`（官方 0.6.5 中性化，`docs/computer-use.md:347`）；保留 `DRORA_*` env 改名接缝（`docs/computer-use.md:31-33`） | 官方 0.6.5 `docs/computer-use.md` |
| `scripts/check-version-coherence.mjs` | 重写为本仓独立布局的等价断言（见下节）；旧 git-pin 时代断言随布局退役 | 官方 0.6.5 `scripts/check-version-coherence.mjs` 的本仓等价 |

不变化：`skills/computer-use/SKILL.md`（官方 0.6.5 与 0.6.3 相同，本仓仅 `DRORA_*` env
接缝）、`scripts/sync-cache.mjs`（流水线注释按本仓布局保留）、`scripts/check-sdk.mjs`
（与官方逐字节一致）。五个本仓资产原样保留未削弱：`action_receipt` 补丁（client 内）、
`bump-zcode-cua-producer.mjs`、`check-cua-baseline.mjs`、`resolve-pnpm-invocation.mjs`、
`sync-skill-from-zcode-cua.mjs`。

### 适配了什么（独立仓 ≠ 官方 mono-repo）

- `check-version-coherence.mjs` 断言对照：
  - 官方：producer（mono-repo 内 `@zcode/zcode-cua`）版本为唯一基准；消费方一律
    `workspace:*`；producer 携带 `zcodeCuaRuntime` Windows Helper 发布契约与
    `./frame-contract` 公开子路径；wrapper 两处 + producer manifest +
    official-plugin-definitions 全部对齐 producer 版本。
  - 本仓：插件版本基准 = wrapper `package.json.version`；producer 是 `packages/zcode-cua`
    的本地切段占位包（`@drora/drora-cua`，`droraCuaPlaceholder=true`，fail-closed），版本
    跟随 upstream 切段（冻结 0.6.3）；插件自 0.6.5 起与切段解耦，映射表
    `{"0.6.5": "0.6.3"}` 是解耦决策的机器可读形态（未映射的插件版本回退旧不变量：切段
    与插件同版）；`droraCuaPlaceholder === true` 契约断言阻止未立项重切段；
    `./frame-contract` 断言按本仓平铺布局（官方为 `dist/` 布局）；官方 `zcodeCuaRuntime`
    契约的本仓等价 = 冻结 Helper 运行时资产（`packages/zcode-cua-helper/runtime/cua-helper`，
    还原资产保留原名 `@zcode/zcode-cua-helper-runtime`，改名豁免）版本 === 映射切段；
    五个 workspace 消费方（desktop/services/node-repl-host/core/adapters）必须
    `workspace:*` 引用 `@drora/drora-cua`；wrapper 自身是冻结 seed（被
    `pnpm-workspace.yaml` 排除，依赖保持 `catalog:`），不在消费方断言之列；
    official-plugin-definitions 的 computer-use version === 插件版本。
  - 写回模式只对齐 wrapper manifest 与 official-plugin-definitions 到插件基准；producer
    切段、冻结 Helper 资产与映射表不可写回——它们表达 upstream 切段事实，改动必须走
    specs 正式决策。
- 官方 `sync-skill.mjs` 不引入：它从官方 mono-repo 的
  `packages/zcode-cua/plugin/skills/computer-use/SKILL.md` 拷贝，依赖官方仓布局。本仓
  继续沿用 `sync-skill-from-zcode-cua.mjs` 语义（外部 producer 检出 `ZCODE_CUA_REPO`/
  同级 `../zcode-cua` + catalog pin 断言 + `upstream.json` provenance + wrapper 版本回写）；
  两脚本语义差异以本节为准。
- 旧 git-pin 时代断言（`pnpm-workspace.yaml` catalog、`pnpm-lock.yaml`、插件目录
  `upstream.json`、`.gitlab/ci/30-build.yml` 字面量、installed producer 运行时契约）随
  「producer 改为本地 workspace 包」的布局退役；此前脚本在该布局下已无法运行（实测
  exit 1 且报错误导性的 Windows Helper 契约失败）。bump/baseline/skill-sync 本地脚本
  原样保留，待 producer 切段升级决策落地时一并复用或退役。

### 待决策遗留项（0.6.5 producer 切段升级）——已立项实施，见文末实施记录

- 本仓 producer（`packages/zcode-cua`）upstream 切段维持 0.6.3；官方 0.6.5 已把 producer
  收编进其 mono-repo。是否把本仓 producer 重切段到 0.6.5（或仅按
  `specs/upstream-v3.16.1-migration.md` 第 8 项做占位版本对照登记）须另立决策；在此之前，
  映射表 `{"0.6.5": "0.6.3"}` + `droraCuaPlaceholder` 断言就是「禁止随插件 bump 顺手
  重切段」的机器边界。
  **（2026-10-24 更新：用户拍板重切段，决策与证据见文末「2026-10-24 producer 重切段
  0.6.5 实施记录」；本节保留为决策前状态存档。第 2 条跨组跟进的 definitions 写回已在
  插件同步轮落地。）**
- 跨组跟进：`apps/drora-cli/packages/bootstrap/src/app/official-plugin-definitions.ts` 的
  computer-use `version` 仍为 0.6.3（不在插件组可改路径内）。该文件注释已预留「上游
  0.6.5 待插件资产同步后再 bump」；本次插件资产同步（0.6.5）落地后，需 bootstrap 侧把
  该记录 bump 到 0.6.5（或由有权限的一方运行 `check-version-coherence.mjs` 写回模式）。
  在此之前 `--check` 对该记录报漂移（非零退出），属预期信号而非脚本缺陷。

### 自检（2026-10-24 实测）

- `node scripts/check-sdk.mjs`（包 build/typecheck 入口）→ exit 0。
- `node scripts/check-version-coherence.mjs --check` → 仅报 official-plugin-definitions
  漂移（0.6.3 ≠ 0.6.5，上述跨组跟进项）；其余记录（wrapper 两处、producer 切段 0.6.3、
  冻结 Helper 资产 0.6.3、占位契约、frame-contract、五消费方）全部一致。
- 临时沙箱副本验证写回模式：只写 official-plugin-definitions 的 computer-use version
  （0.6.3→0.6.5，`:471`；同文件其他插件的 `0.6.1` 记录不动），写回后 `--check` 全绿
  exit 0。
- 沙箱另验证守卫：producer 被顶到 0.6.5 而映射仍 0.6.3 → 重切段 fatal；
  `droraCuaPlaceholder` 移除 → fatal；消费方改掉 `workspace:*` → fatal；未映射的
  0.6.6 组合回退同版本不变量。

## 2026-10-24 producer 重切段 0.6.5 实施记录

决策：把本仓 producer upstream 切段从 0.6.3 升级到 0.6.5。方式为**整段替换**（发行物
原样原则，与 0.6.3 段入库方式同构），不做逐点修补——0.6.3↔0.6.5 段级 diff 实测
2,657 个差异块（段 1.37MB→1.89MB，+38%），差异混合了真实演进、两代 esbuild bundle 的
helper 命名/重排搅动与段边界移动，逐点挑拣既不安全也不可维护。

### 提取证据（全部 2026-10-24 实测，只读）

- 来源 bundle：`D:/software/ZCode/resources/glm/packages/node-repl-host/dist/mcp/server.js`
  （官方 node-repl-host **0.6.1**，5,618,452 bytes，sha256 `c8d8f245650c0aa22caa03d4e…`）。
  producer 随该 bundle 分发（与 0.6.3 段取自旧桌面 node-repl-host 0.6.0 bundle 同一模式）；
  bundle 内 `0.6.5` 标记命中、`0.6.3` 零命中，横幅为
  `// ../../../../packages/zcode-cua/dist/index.js`。
- 段边界：1-based 行 [80503, 130590)，字节 [3644372, 5541827)。段后第一个横幅是
  node-repl-host 自身的 `// src/browser-bridge.ts`（130590 行）；段内 80504–130589 行
  之间无任何非 cua 横幅。注意段内存在以 `// ` 开头的**普通代码注释行**（如 99303 行附近），
  边界探测必须用打包器横幅形态（`// ../../…` 或 `// src/…`），不能用任意行首注释。
- 段核心（横幅切片）：横幅 [80503, 130590) 行、字节 [3644372, 5541827)，1,897,491 bytes，
  sha256 `192a29532baafeebae7f74ab0ef64e8ee2d31c404243289e052b6bc09d16b721`；段内
  `0.6.5` 标记 ×2、`0.6.3` ×0。
- 最终产物 `zcode-cua-0.6.5.index.js` = 1,901,876 bytes / 50,152 行，
  sha256 `0c587bf8160bdb7246e217eaac1a62b1720054a0f7b046005f91835737225d01` =
  头注释 + **前奏** + 段核心 + 导出尾。相对发行 bundle 的全部差异逐字声明为三处：
  1. **前奏前置**：官方 bundle 第 [1, 38) 行（`createRequire` 顶层 require + esbuild
     helper 块）原样前置。段核心用到 9 个 helper（`__toESM/__commonJS/__require` 等），
     ajv 全家桶惰性访问器（`require_code2` 等，定义于段内 80608–92676 行）自包含；运行时
     裸 `require("ajv/…")` 由前奏的 require 解析，与官方 bundle 运行时行为逐字一致。
     两代 bundle 布局不同（0.6.3 时代的旧 bundle 把同款前奏包含在切片范围内），本段需
     显式前置。注意段内另有以 `// ` 开头的普通代码注释行，边界探测必须用打包器横幅形态。
  2. **express 死声明移除**：官方 0.6.5 把 express 内联在段外（`require_express2` 惰性
     访问器，27440 行起），段内对其唯一引用 `var import_express = __toESM(require_express2(), 1)`
     是**死代码**（`import_express` 全段零引用；0.6.3 段同样如此，且 0.6.3 构建即被
     esbuild tree-shake——旧产物零 express 残留可证）。本仓接缝等价移除该行：宿主与裸
     ESM 加载均不再触碰 express，依赖面相对 0.6.3 收窄，运行时行为与官方一致（官方
     bundle 中该访问器同样永不执行）。
  3. **export 尾行**：官方 bundle 的 ESM 出口在文件尾、段内无段级 export；末尾补一行
     `export { createComputerUseRuntime };`。官方 bundle 的该符号仅为包内符号，宿主消费
     面与本仓一致——`node-repl-host/src/server.ts` 仅消费该符号与 `ComputerUseRuntime`
     类型，`cua-broker.ts` 仅消费类型。
  4. 段内保留的运行时裸 `require("ajv/dist/runtime/*")`、`require("ajv-formats/dist/formats")`
     属官方 ajv 打包原样（非接缝）：随前奏的 require 解析；esbuild 对 ESM 段内的自由
     require 原样保留不内联（现网产物 `dist/mcp/server.js` 的 12 处字面保留可证）。
     **0.6.3 段头「仅依赖 node:* 内建」的表述对两代段都不准确，本段头不沿用。**
- 冻结 Helper 资产：官方 `D:/software/ZCode/resources/tools/cua-helper` =
  `@zcode/zcode-cua-helper-runtime@0.6.5`（还原资产名保留原名，改名豁免），其
  `runtime-manifest.json` 自带 entry（`dist/windows-helper.js`，sha256 `def39fc9…`）与
  addon（`build/Release/ax_native.node`，sha256 `0dee894c…`）；替换后逐文件校验。
  两侧 `node_modules/` 经 `diff -rq` 全等，不动。

### 实施步骤（与本次改动一一对应）

1. 新增 `packages/zcode-cua/upstream/zcode-cua-0.6.5.index.js`（原样切段 + 上述接缝），
   删除 `zcode-cua-0.6.3.index.js`。
2. `node-repl-host/scripts/build.mjs`：alias 指向改 0.6.5，注释同步。
3. `zcode-cua-plugin/scripts/check-version-coherence.mjs`：删除映射项
   `"0.6.5": "0.6.3"`——未映射插件版本回退「切段与插件同版」不变量（0.6.5→0.6.5）；
   注释同步（重切段已立项，边界守卫保留防未来插件版本先行）。
4. `packages/zcode-cua/package.json`：version 0.6.3→0.6.5。**`droraCuaPlaceholder: true`
   保持不变**：占位 fail-closed 契约描述的是 packages/zcode-cua 自身面（非 node-repl-host
   消费方拿到的仍是 fail-closed 占位），真实运行时依旧只在 node-repl-host 构建期经
   alias 换入；重切段改变的是冻结段版本，不是占位包语义。
5. `packages/zcode-cua-helper/runtime/cua-helper/`：`package.json`、`runtime-manifest.json`、
   `dist/windows-helper.js`、`build/Release/ax_native.node` 换为官方 0.6.5 版本
   （manifest sha256 逐文件校验）。
6. `packages/zcode-cua/test/cua-tool-layer-smoke.mjs`：import 路径与头注释跟随 0.6.5。
7. 契约层核对：官方段内嵌 `frame-contract/*`、`presentation/*` 模块，与本仓语义还原层
   （`src/frame-contract/`、host-display-contract）核对键面——消费方锚点是
   `CUA_APP_ASSOCIATIONS_META_KEY`（host-display-contract）与 `isOfficialCuaImageRefText`
   （frame-contract）及 `zcode-cua-state-observation-v1` 等字面量，核对结果记录于自检。

### 自检（2026-10-24，重切段后实测）

- `node scripts/check-version-coherence.mjs`（写回）→ official-plugin-definitions
  computer-use 0.6.3→0.6.5 落地真文件（前轮仅沙箱验证，本批写回）；随后 `--check` →
  全绿 exit 0：producer 切段 0.6.5、冻结 Helper 资产 0.6.5、占位契约 true、
  frame-contract 子路径、五消费方 workspace:*、wrapper 两处一致（空映射表回退同版
  不变量生效）。
- producer 冒烟：`restored-smoke` 绿；`cua-tool-layer-smoke` 绿——直接裸 ESM 加载
  0.6.5 段，假 helper 42 项协议四契约全过（list_apps→list_applications 方法翻译、
  authenticate→broker_info 握手序、MCP envelope、应用数据透传）。
  `embedded-build-id`、`mac-launch-contract` 在 Windows 无法运行（plutil/.app 包/
  POSIX 0700 权限断言，均为 macOS 专属验收，输入与本批改动零交集）——既有环境限制，
  非本批回归；macOS 侧待真机补跑。
- node-repl-host：`pnpm --filter @drora/node-repl-host build` → exit 0，段经 esbuild
  alias 内联成功，产物含 0.6.5 标记 ×3、`require_express2` 残留 ×0；`vitest run test`
  → 6 文件 / 51 用例全绿（含 bundle-smoke 的临时目录 import 与 MCP 2026-07-28 协商——
  重切段过程中曾因 express 死声明未移除而红，接缝②按死代码移除后转绿）。
- 契约键核对（段 vs 本仓还原层，逐字一致）：`zcode.cua/app-associations-v1`、
  `zcode.cua/official-frame-integrity-v1`、`zcode.cua/request-access-status-v1`、
  `zcode-cua-state-observation-v1`、`isOfficialCuaImageRefText`；
  `frame-integrity-rejections-v1` 两代段均无（我方还原层自有键，无对齐问题）。
- 根 `pnpm typecheck`（含 `tsc -p packages/zcode-cua --noEmit`）：见门禁记录。
