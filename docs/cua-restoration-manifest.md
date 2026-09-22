# Computer Use 与 CUA Runtime Helper 复原清单（权威映射）

> 本文档是「ZCode Computer Use + CUA Runtime Helper」源码复原的权威清单：
> 每一项原版发行物组件 → 复原后的仓库位置 → 采用的复原方式 → 验证方式。
> 复原权威基线：`D:\software\zcode`（Windows 发行物，`runtime-manifest.json` 标定 0.5.13）。
> 2026-09-22 第二轮校正：以原版 bundle 为唯一权威完成入口/鉴权/诊断对齐（见第五节）。

## 一、复原方式说明

| 方式             | 含义                                                                     |
| ---------------- | ------------------------------------------------------------------------ |
| 源码还原         | 从发行 bundle（未混淆 esbuild 产物，含 `// src/...` 模块标记）提取并转为可读 TS 模块 |
| 语义还原         | 无发行源码可依时，按协议/契约与交叉证据重建（实现处均有注释说明依据）    |
| 原样拷贝         | 原版二进制/资产直接入仓（不破坏签名与行为）                              |
| 保持 fail-closed | 原发行物本身即 fail-closed 的面，忠实保留该行为                          |

## 二、组件映射

### 1. `@zcode/zcode-cua`（in-app 库 + MCP server）

| 原版组件                                                                                     | 仓库位置                                          | 方式                                       | 验证                                   |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------ | -------------------------------------- |
| broker 客户端（brokerExchange/callBrokerMethod/probeHelperHealth）                           | `packages/zcode-cua/src/broker/{client,index}.ts` | 源码还原                                   | mock broker E2E                        |
| socket 路径（稳定 socket/runtime 目录/铸造/回收）                                            | `src/broker/socket-path.ts`                       | 源码还原                                   | 单元冒烟（win32 pipe / POSIX sock 双形态） |
| 宿主侧协议工具（parseRequestLine/dispatchRequest 等）                                        | `src/broker/protocol.ts`                          | 源码还原（镜像 helper types.ts 方法表）    | 冒烟                                   |
| host 侧模块（installer/verifier/launcher/helper-host/orphan-reaper/frame 门/权限请求等）     | `src/broker/server/*.ts` + `index.ts`             | 源码还原                                   | tsc + 冒烟                             |
| frame-contract raster 完整性门                                                               | `src/frame-contract/index.ts`                     | 源码还原（frame-contract.pretty.js.txt）   | 冒烟（有效/无效 image_ref、PNG 封套）  |
| request-access 状态 schema                                                                   | `src/request-access-contract.ts`                  | 源码还原（zod）                            | 冒烟（valid/invalid）                  |
| pip-session 宿主客户端                                                                       | `pip-session-node.js` → `src/mcp` 依赖链          | 源码还原                                   | 冒烟（enabled 语义/关闭）              |
| MCP server 引擎                                                                              | `src/mcp/{errors,client,session,tools,server}.ts` | 源码拆解（vendor 同源提取）                | 冒烟                                   |
| MCP server 第三方内联（zod v3 / zod-to-json-schema / MCP SDK / express）                     | `vendor/mcp-server.dist.mjs`                      | 原样拷贝（第三方档案）                     | E2E                                   |
| `createComputerUseRuntime`                                                                   | `src/runtime.ts`（入口 `index.js`）               | 语义还原（按 node-repl-host 消费契约）     | E2E（execute → mock broker）           |
| `createPipSessionClient`                                                                     | `pip-session-node.js`                             | 源码还原                                   | 冒烟                                   |

### 2. `@zcode/zcode-cua-helper`（CUA Runtime Helper）

| 原版组件                                   | 仓库位置                                                             | 方式                                                     | 验证                                                          |
| ------------------------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------- |
| payload CUA 模块（broker 服务端、AX/自动化桥、平台表面、peer 验证等） | `src/broker/**`、`src/lib/**`、`src/native/**`、`src/pip-session/**` | 源码还原（注意：底稿为 v3.1 内部版，与 0.5.13 存在方法表差异，见第五节） | tsc 0 错误；构建成功                                          |
| Windows 入口（windowsDevHelperMain）       | `src/broker/server/windowsDevHelperMain.ts`                          | 源码还原（第二轮按原版逐行校正）                         | 入口 5 场景 parity 全 MATCH（含 exit code）                   |
| Windows 系统表面（AUMID/别名启动）         | `src/broker/server/windowsSystemSurface.ts`                          | 源码还原（第二轮从原版 bundle 整模块替换）               | E2E capabilities parity MATCH                                 |
| SEA 入口 + 内嵌元数据                      | `src/helper-sea-entry.ts`                                            | 源码还原                                                 | 构建                                                          |
| macOS Helper .app 构建                     | `build-cua-helper-app.mjs`                                           | 语义重建                                                 | 未在本机验证（无 mac .app 资产，见第三节）                    |
| Windows helper bundle                      | `build.mjs`                                                           | 原有                                                     | 构建 + 与原版发行物 E2E 对齐（见第五节）                      |

### 3. 二进制与资产（原样拷贝）

| 资产                                    | 仓库位置                                        | 说明                                                                       |
| --------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------- |
| ax_native.node（win32）                 | `packages/zcode-cua-helper/build/Release/`      | 原版发行物二进制；helperAddonLoader in-tree 路径直接解析，E2E 加载验证通过 |
| ax_native_mac.node（darwin）            | `packages/zcode-cua-helper/native/`             | 原版发行物二进制副本；接口逆向说明见同目录 README（117 导出）               |
| ax_native.d.ts                          | `packages/zcode-cua-helper/native/`             | 运行时内省生成的接口声明                                                    |
| zcode-window-bounds                     | `packages/desktop/resources/macos-window-bounds/` | 权限浮窗吸附数据源，打包配置原有引用补齐                                 |

### 4. 插件与桌面 UI

| 组件                                                   | 仓库位置                                       | 状态        |
| ------------------------------------------------------ | ---------------------------------------------- | ----------- |
| 官方插件包（`computer-use@zcode-plugins-official` 0.5.13） | `apps/zcode-cli/packages/zcode-cua-plugin`  | ✅ 第四轮对齐原版发行物（见下） |
| 权限浮窗 UI（renderer/preload/main 三层）              | `packages/desktop/src/{renderer,preload,main}` | ✅ 仓库原有 |

### 5. 插件对齐记录（第四轮，2026-09-22）

以 `~/.zcode/cli/plugins/cache/zcode-plugins-official/computer-use/0.5.13`
（安装缓存，含安装器生成的 seed 清单）为权威，把仓库插件包从第一轮的
node_repl SDK 方案对齐回原版发行形态：

- **原样拷贝**：`skills/computer-use/SKILL.md`（原版 30 工具技能文档，替换
  node_repl bootstrap 版）、`dist/mcp/server.js`（3.2MB 自包含 bundle，字节一致）、
  `node_modules/`（seed 依赖：sharp/@img/detect-libc/koffi/semver，约 22MB）。
- **版本回归**：package.json / .zcode-plugin/plugin.json → 0.5.13；package.json
  恢复原版形态（`main: ./dist/mcp/server.js`、`build: tsc --noEmit && build-mcp.mjs`）。
- **scripts**：build-mcp.mjs 用原版文件；sync-cache.mjs 的 ENTRIES 对齐原版
  （skills/dist/manifest/package.json + node_modules）并移除指向本仓库不存在
  的 sharp-package-assets.mjs 的坏 import 与 desktop/adapters 二次 staging；
  bump-zcode-cua-producer.mjs 保留 Windows pnpm spawn 修复（resolve-pnpm-invocation.mjs）；
  删除 node_repl 方案专属的 check-sdk.mjs、computer-use-client.mjs、docs/。
- **源码链补充**（原版 seed 不带，开源还原需要）：`tsconfig.json` 以 paths
  指向仓库还原的 `packages/zcode-cua` 做 `tsc --noEmit`（通过）；
  `src/mcp/server.ts` 与原版 bundle 内嵌薄壳逐字一致（已核对）。
- **配套对齐**：`bootstrap/official-plugin-definitions.ts` 的
  OFFICIAL_CUA_REQUIRED_SEED_PATHS → 原版文件集、`runtimeTopLevelPaths:
  ["node_modules"]`（seed 打包放行原生依赖）、version → 0.5.13；
  `packages/desktop/scripts/prepare-agent-node-bundle.mjs` 的 staged 清单同步，
  并支持声明 runtimeTopLevelPaths 的插件把 node_modules 带入安装包。
- **验证**：dist 直跑 fail-closed（缺 `--permission-broker-socket` 拒绝启动）；
  `ZCODE_CUA_RUNTIME_PACKAGE_DIR` 别名下 esbuild 构建链可用（产物 3.78MB，
  内联仓库还原的 zcode-cua；dist 保留原版字节）；插件 tsc 通过；根 lint 0 errors；
  helper parity 8/8。

#### 已知边界（如实声明）

- **执行面为 node_repl 单宿主**（开源版 HEAD 产品决策）：`plugin-host-command.ts`
  的授权断言只把 broker 凭据恢复给 node_repl host，`mcp-config.ts` 将其它 CUA
  形态 MCP server 标记为 retired；且 broker 鉴权已从 0.5.13 的 bearer token
  演进为身份模式（shared/runtimeEnv.ts 明确不再产生/消费 token）。因此原版
  SKILL.md 描述的 30 工具面（`request_access`/`list_apps`/`get_app_state` 等）
  在开源版运行时**不默认可用**——dist/mcp/server.js 资产完整且可直接运行
  （`__zcode-plugin-host` 加载链保留），但自动凭据注入仅对 node_repl host 开放。
  若要恢复原版独立 MCP 直跑，需要：解开上述两处封条 + 恢复 token 凭据组
  （协议级回退，建议单独立项）。
- `check-version-coherence.mjs --check` 期望上游 producer 包环境
  （services/node_modules 链接 + `zcodeCuaRuntime` dist 契约），本仓库无此
  布局（HEAD 上同样不满足），按上游脚本原样保留。
- `sync-skill-from-zcode-cua.mjs` 从上游独立仓库拉 SKILL，本机无该仓库，不实跑。

## 三、无法从发行物复原（如实边界）

- `ax_native.node` 与 `zcode-window-bounds` 的官方 C++/Objective-C 源码:上游从未发布。
  二进制已随包交付;2026-09-22 第三轮完成原生插件的**静态逆向**:
  win32 PE(导入表/JS 导出面/参数校验消息)与 mac Mach-O(完整符号表,137 个 NAPI
  入口、AsyncWorker 类、5 个 ObjC 类、上游源文件布局)的分析报告与语义还原 C++
  源码见 `packages/zcode-cua-helper/native/reverse/`(证据链标注、不做字节等价声明;
  运行时仍使用原版二进制)。
- **macOS Helper .app 整包**：本机（Windows 安装）只有 `ax_native_mac.node` 单文件，没有
  `ZCode Computer Use.app` 整包。`packages/desktop/resources/cua-helper/` 目前不存在（已在
  .gitignore 预留），electron-builder 的 darwin extraResources 引用需要 mac 资产后才能成立；
  此前版本清单声称"签名 TeamID 校验通过"不属实，特此更正。
- `vendor/mcp-server.dist.mjs` 中内联的第三方编译产物，后续可改为包依赖以缩减档案体积。
- `src/mcp/` 还原稿：逻辑可用但类型标注与 esbuild 残留名（error51 等）清理为打磨项。

## 四、验收命令

```bash
# 类型与规范
pnpm typecheck && pnpm lint && pnpm fmt:check

# MCP 侧冒烟（mock broker；win32 断言已兼容命名管道形态）
node packages/zcode-cua/test/restored-smoke.mjs

# Helper Windows 构建
pnpm --filter @zcode/zcode-cua-helper-runtime build

# Helper 与原版发行物 E2E 对齐（authenticate + broker_info + 错 token 拒绝）
# 以原版 D:\software\zcode\resources\tools\cua-helper 为对照运行双实例比对
```

## 五、校正与对齐记录

以原版 `dist/windows-helper.js`（未混淆、61 个 `// src/` 模块标记）为唯一权威，校正了第一轮
还原稿的五类偏差，全部有 E2E 证据：

1. **字符串污染**：第一轮的标识符重命名把字符串字面量中的 "Use" 误替换为 "randomUUID"
   （"ZCode Computer randomUUID" 等，10 个文件 60+ 处），已逆向修复并对照原版 bundle 验证。
2. **入口行为**：`helperMain.ts` 尾部误内联了 macOS SEA 入口副作用（覆盖
   `ZCODE_CUA_HELPER_ADDON` 指向 .app Resources、与 Windows 入口双跑），已移除；
   `parseWindowsDevHelperConfig` 补齐 `--token` 拒绝与 env token（`ZCODE_CUA_PERMISSION_BROKER_TOKEN`）
   读取；恢复 AUMID activator 注入。入口 5 个参数场景（无参/缺参/--token/无 env token/坏 pipe）
   与原版逐字节一致（stdout JSON + stderr + exit 2）。
3. **鉴权模型**：还原稿用自创的 peer-verdict presentation 门替换了原版 `handleAuthenticate`
   的 tokensMatch 常量时间比对，且 constructor 未给 `authToken`/`presentationAuthToken` 赋值，
   导致任意 token 可通过认证。已按原版恢复：token 三分支 + "tool and presentation broker
   tokens must be different" 构造校验；移除原版不存在的
   `WINDOWS_PEER_IDENTITY_GATE_TEMPORARILY_OPEN=true` 后门开关与
   deferBackendInitialization/onTransportReady/transport_ready 预热路径。
4. **broker_info 诊断**：非 darwin 平台的 `authorization_subject` 按原版回报
   `stable_identity:false` 与 5 条 warnings（codesign unavailable 等）；`capabilities`
   补齐 `open_application`；`windowsSystemSurface` 从占位 stub 替换为原版完整实现
   （AUMID 启动 + 打包应用别名表 + spawn 启动器）。
5. **平台资产**：`native/ax_native.node` 实为 macOS 二进制（"not a valid Win32 application"），
   已更名 `ax_native_mac.node`；win32 原版二进制入 `build/Release/ax_native.node`
   （loader in-tree 路径）。

E2E 结果：ready 控制消息、authenticate+broker_info 全字段（含 authorization_subject 与
capabilities）、错误 token 拒绝，三项与原版发行物完全一致。

### 第三轮：原生插件逆向（2026-09-22）

- win32（PE64，符号已剥离）：导入表证实实现路径（SendInput/DXGI+WinRT 截图/
  AUMID property store/token 校验/输入桌面检查）；字符串表给出全部 JS 导出名与
  参数校验消息;PDB 路径证实上游源文件 `src/native/screen_capture_win.cc` 单编译单元。
- mac（Mach-O arm64，符号完整）：96 匿名命名空间 + 41 file-static NAPI 函数、
  5 个 .mm 源文件布局、ApplicationIconWorker/BackgroundInputWorker/InputWorker/
  VerifiedPipStartWorker（Napi::AsyncWorker）、AxCaptureDiagnosticState（epoch 取证
  状态）、PiP 栈语义函数群、5 个 ObjC 类 137 方法。
- 产出：`native/reverse/{win32-static-analysis.md, mac-static-analysis.md,
  src/ax_native_win.cc, data/*}`；`native/README.md` 与本清单同步更新。

### 第六轮：win32 addon 能力对齐重建（2026-09-22）

`native/reverse/src/ax_native_win.cc` 从语义骨架推进为**可编译、可验收**的重建版：

- **基线**：`reverse/probe-native-baseline.mjs` 对原版 addon 全量实测 —— 49 个导出、
  18 项参数校验消息、只读能力返回值（含 probeWindows/listApplications/elementAtPoint
  的完整结构）。
- **编译**：`reverse/build-rebuilt.mjs`（node-gyp + VS2022，C++20/utf-8，
  UIA/COM + shcore GetDpiForMonitor + dwmapi cloak 检查），产物
  `reverse/build/Release/ax_native_win.node`。
- **验收**：`reverse/parity-native.mjs` 双加载逐项对比，**57/57 MATCH**
  （导出面/参数校验/只读能力结构值/AX 错误路径/ref round-trip/剪贴板互操作/
  captureApp(invalid)/preventActivation 状态机）。
- 关键对齐事实（原版实测）：参数校验抛 TypeError；操作类返回 `{ok,axError}`；
  bounds 为数组；进程需在模块注册时切 PerMonitorV2（否则 displays/cursor 被
  虚拟化）；GetDpiForMonitor 在 shcore.dll；probeWindows 过滤 DWM cloaked 窗口
  而 listApplications 保留；`cancel*` 返回布尔；ref 为
  `rt:<pid>:<runtimeIds>` 且经元素注册表解析（UIA RuntimeId 跨查询不稳定，
  同构 mac 侧 StoreToken 设计）。
- 边界：截图为 PrintWindow/BitBlt 实现（原版 WinRT Graphics.Capture），同为
  合法 PNG Buffer，不做像素级一致性声明；重编译产物不替换运行时的原版二进制。

### 第七轮：win32 addon 写路径能力对齐（2026-09-22）

`native/reverse/parity-native-full.mjs` 以受控记事本为目标完成**写路径**端到端对齐
（28/28 MATCH；与只读 57 项合计 85 项全绿）：

- **captureApp 语义纠正**：实测为 AX 快照 `{app, window, elements}`（win.ts
  adaptSnapshot2 消费的正是该形状），elements 为整棵 UIA 子树 BFS 平铺、上限 400；
  此前报告误推为截图函数。
- **截图三兄弟**（captureWindowImage / captureWindowPngVerifiedAsync /
  captureMonitorPngAsync）接真 WinRT Graphics.Capture 管线（本机 SDK 10.0.26100
  cppwinrt，与原版同源）：本机 Win11 24H2 对未打包进程拒绝 capture item，两边一致
  fail-closed（`{ok:false,error:"invalid_target"}` / null）。
- **返回语义对齐**（全部原版实测）：输入/操作类返回布尔（scrollAt 本机恒 false、
  preventActivation 返回 false）；AX 写成功 `{ok:true, axError:null}`；selectText
  三参 `(ref, start, end)`，单参 illegal_argument；moveTo 为 SetCursorPos 绝对像素。
- **交叉验证**：setValue/typeTextGlobal 一方注入、另一方 AX 读回；剪贴板互写互读
  并恢复用户原值；moveTo 后 cursorPoint 验证真实位移。

### 第八轮：深层能力与注入路径对齐（2026-09-22）

验收扩到 **98 项（只读 57 + 写路径 41），五轮连跑全绿**。决定性发现与修正：

- **typeTextGlobal 走 KEYEVENTF_UNICODE 逐字符注入**：vk 路径（VkKeyScanW）在
  中文 IME 下数字键被候选选字吞掉（实测固定丢 '1'，原版注入干净）——这是
  vk/UNICODE 两种实现路径的可观测行为差异，端到端测试得以区分。
- 非法参数返回布尔 false（坏按钮/坏方向/空串 chord）；modifier-only chord 合法。
- probeWindows 额外排除最小化窗口（-32000 坐标）与零尺寸 shell 宿主弹窗
  （0x0，bounds 全 0，真实运行复测暴露的第四条枚举排除规则）。
- captureApp 大树（Electron 触顶 400）、AXPress 真实按压、setValue 不可写
  action_unsupported、cancelInputHoldsForSession → false 全部对齐。
- 移除死代码（mac 面函数与被 WinRT 替代的 PrintWindow 管线）。

### 第十轮：发行物全目录对齐盘点（2026-09-22，D:\software\zcode
esources）

对 resources 全目录逐一核对仓库对齐状态：

| 发行物资产 | 仓库状态 | 结论 |
| --- | --- | --- |
| tools/cua-helper（helper bundle + win32/mac addon） | 已还原 + 三套件 221 项对齐 | ✅ 已对齐 |
| glm/packages/zcode-cua-plugin（桌面打包版） | 与插件缓存版同源；仓库版仅多 src/ 与 resolve-pnpm-invocation.mjs（合理本地补充） | ✅ 已对齐 |
| app/ 与 app.asar | md5 级完全一致（4113 文件，双形态发行同一份内容） | 同源，无独立差异面 |
| out/{main,host,scheduler,preload,renderer} | 仓库可完整构建（build:no-runtime-assets 通过，产物同构 6 段）；cua 面（desktopCuaHelperInstaller/cuaPermissionPanel/cua-permission-panel.html）两侧俱在 | ✅ 源码链齐备；内容差异为版本演进（仓库 HEAD 领先） |
| app.asar.unpacked（node-pty prebuilds、ssh2 sshcrypto） | 仓库 pnpm install 产出同源二进制 | ✅ |
| glm 其余 7 插件 | android-emulator/ios-simulator/restore-legacy/skill-creator 版本一致；browser-use（0.4.1→0.5.1）与 zcode-guide（0.1.0→0.2.0）仓库领先；document-skills-plugin 0.1.4 在仓库已重构拆分（documents/pdf/presentations/spreadsheets 等分包） | ✅ 版本演进，非缺失 |
| glm/zcode.cjs（CLI 0.16.5） | 仓库 CLI 0.1.0（开源时版本号重置），源码链齐备 | 版本演进 |
| config/default.json | 仅飞书群链接 token 运营配置差异 | ✅ |
| model-providers/models_catalog_china_llm_zcode_*.json（目录型 catalog，10 providers） | 开源 HEAD 已重构为规则型 config/provider/zcode-builtin.json（revision 30，builtinProviderConfig）；旧 catalog 机制在 legacy 序列化层留有兼容 | 机制演进，非缺失 |
| tools/ripgrep、tools/ugrep | 第三方二进制（rg.exe/ugrep.exe），随发行自带 | 第三方，无需还原 |
| elevate.exe、tray_icon.ico、icon*.png、app-update.yml、.node-bundle-meta.json | 打包/更新器资产 | 打包产物，无需还原 |

### 第十二轮：CLI 构建链修复与全实现对齐终审（2026-09-22）

- **安装根目录盘点**：ZCode.exe/dll/pak/locales 等均为 Electron/Chromium 运行时
  资产，无还原义务。
- **CLI 构建链修复**（此前嵌套 workspace 无法构建）：
  - 移除 `apps/zcode-cli/pnpm-workspace.yaml`/`pnpm-lock.yaml` 嵌套边界 —— 上游
    monorepo 中 cli 与主 packages 同一 workspace，嵌套文件切断了
    @zcode/shared/provider/provider-node/model-option-map/zcode-cua 的可见性；
  - 清理 `bootstrap` 对 `@zcode/formal-proof` 的死依赖（开源剥离 formal-proof
    后的声明残留，src 零引用）；
  - turbo 从根 workspace 运行会递归执行 apps/zcode-cli 自身的 build script，
    构建改用 `pnpm --filter @zcode/cli... build`（依赖闭包）直达。
- **CLI 功能面对比**（仓库构建 zcode.cjs 31MB vs 发行 12.5MB）：版本 0.16.5 →
  0.16.9（仓库领先）；顶层命令集、全部子命令 help 结构、agent 核心工具面
  （Bash/Edit/Glob/Grep/Read/TodoRead/TodoWrite/Write）完全一致；差异为演进
  （login 新增 bigmodel 双 provider）。
- **renderer/preload cua 面定性**：cuaPermissionPanel 两侧 i18n 文案同源
  （波斯语/中文繁简/匈牙利语字串逐一对应，仅 minifier 变量名与打包噪声差异），
  纯演进。
- 构建污染回滚：zcode-cua 发行物副本曾被 cli 构建链的 tsc/esbuild 输出覆盖，
  已从 git 恢复并重跑冒烟确认无损；插件 seed node_modules 曾被嵌套 install
  误删，同样已恢复。

### 第十一轮：内置插件内容级对齐审计（2026-09-22）

在第十轮文件级覆盖之上做 md5 内容级审计，全部差异定性如下（无漂移、无内容丢失）：

- **skill-creator**：3/3 文件逐字节一致。
- **restore-legacy-sessions**：6/7 一致；唯一差异 `restore-conversation.mjs` 为仓库携带的
  消息契约修复（modelID/providerID → modelId/providerId + modelSelection 新契约），
  合法领先，保留。
- **zcode-cua**：6/10 一致；4 处差异全部有意——glm 版 plugin.json 的 mcpServers 段为
  桌面打包器写入（安装期配置，源形态不携带）、package.json test 脚本为本仓库布局
  适配、bump/sync-cache 两脚本的 Windows 修复与 ENTRIES 对齐（第四轮工作）。
- **zcode-guide**：7/9 一致；2 处差异均为版本字段（0.1.0 → 0.2.0 仓库领先）。
- **browser-use**：0.4.1 → 0.5.1 node_repl 架构演进（bootstrap 源码注释明载不再产出
  dist/mcp/server.js）；skills/docs 内容差异均为演进措辞，保留 HEAD。
- **android-emulator / ios-simulator**：仓库构建产物（tsc+esbuild 再生成功）与发行
  dist 同构（体积差 ~18% 为打包器版本噪声，与 cua bundle 同比例）；MCP 握手 probe
  下两版行为完全一致（同静默退出），实现同构。
- **document-skills → 四包拆分**：110 文件零缺失，28 处内容差异为拆分后演进。

未发现新的“发行物有、仓库缺”功能缺口；此前九轮还原的 cua/helper/插件面之外，
其余差异均属仓库 HEAD 相对发行物的正常版本演进或第三方/打包资产。

### 第九轮：输入×输出全矩阵对齐（2026-09-22）

第三验收套件 `parity-native-matrix.mjs`：49 导出 × 123 调用形态逐格比对，
**结构差异 0**；三套件合计 **221 项断言全绿**。完整输入输出契约入档：
无参校验函数族（无效输入走失败路径不抛）、带参翻转函数
（isScreenCaptureSupported/screenCaptureStatus/cancelInputHoldsForSession）、
reenableActivation 恒 true、截图三兄弟为发行物级 fail-closed stub（本进程
WinRT 实际可用但原版恒失败，对齐可观测表现）、边界值语义（clicks<1、负
duration、空串文本/空 Name/空 AUMID）。两处挂死根因修复：无效 AUMID 的
ShellExecuteExW 同步弹 UI（改 ApplicationActivationManager）、
Sleep(uint32(-1)) 长眠（负 duration 先判 false）。

### 已知偏差（下一阶段）

- **方法表版本错位**：还原稿 `BROKER_METHODS` 为内部 v3.1 瘦身后的 43 方法表；原版 0.5.13
  为 63 方法表（多出 screen_size、cursor_position、screenshot、list_displays、get_skyshot、
  set_display、move_to、mouse_down、mouse_up、type_text_into_current_focus、key_down、key_up、
  read_clipboard、write_clipboard、open_application、click_element_at_point 与 6 个
  pip_live_probe_*；还原稿反而多一个 v3.1 新增的 paste）。能力大多已在 adapter/surface 层
  存在，缺的是方法注册与 handler 组装；需以原版 bundle 为基线整体重放 backend 模块。
- lint 基线 0 errors；还原包贡献 ~280 条风格 warnings（unused-vars 等），随打磨项消化。
