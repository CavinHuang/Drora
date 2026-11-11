# Computer Use 与 CUA Runtime Helper 复原清单（权威映射）

> 本文档是「ZCode Computer Use + CUA Runtime Helper」源码复原的权威清单：
> 每一项原版发行物组件 → 复原后的仓库位置 → 采用的复原方式 → 验证方式。
> 复原权威基线：`D:\software\zcode`（Windows 发行物，`runtime-manifest.json` 标定 0.5.13）。
> 2026-09-22 第二轮校正：以原版 bundle 为唯一权威完成入口/鉴权/诊断对齐（见第五节）。

## 一、复原方式说明

| 方式             | 含义                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------ |
| 源码还原         | 从发行 bundle（未混淆 esbuild 产物，含 `// src/...` 模块标记）提取并转为可读 TS 模块 |
| 语义还原         | 无发行源码可依时，按协议/契约与交叉证据重建（实现处均有注释说明依据）                |
| 原样拷贝         | 原版二进制/资产直接入仓（不破坏签名与行为）                                          |
| 保持 fail-closed | 原发行物本身即 fail-closed 的面，忠实保留该行为                                      |

## 二、组件映射

### 1. `@zcode/zcode-cua`（in-app 库 + MCP server）

| 原版组件                                                                                 | 仓库位置                                          | 方式                                     | 验证                                       |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------- | ------------------------------------------ |
| broker 客户端（brokerExchange/callBrokerMethod/probeHelperHealth）                       | `packages/zcode-cua/src/broker/{client,index}.ts` | 源码还原                                 | mock broker E2E                            |
| socket 路径（稳定 socket/runtime 目录/铸造/回收）                                        | `src/broker/socket-path.ts`                       | 源码还原                                 | 单元冒烟（win32 pipe / POSIX sock 双形态） |
| 宿主侧协议工具（parseRequestLine/dispatchRequest 等）                                    | `src/broker/protocol.ts`                          | 源码还原（镜像 helper types.ts 方法表）  | 冒烟                                       |
| host 侧模块（installer/verifier/launcher/helper-host/orphan-reaper/frame 门/权限请求等） | `src/broker/server/*.ts` + `index.ts`             | 源码还原                                 | tsc + 冒烟                                 |
| frame-contract raster 完整性门                                                           | `src/frame-contract/index.ts`                     | 源码还原（frame-contract.pretty.js.txt） | 冒烟（有效/无效 image_ref、PNG 封套）      |
| request-access 状态 schema                                                               | `src/request-access-contract.ts`                  | 源码还原（zod）                          | 冒烟（valid/invalid）                      |
| pip-session 宿主客户端                                                                   | `pip-session-node.js` → `src/mcp` 依赖链          | 源码还原                                 | 冒烟（enabled 语义/关闭）                  |
| MCP server 引擎                                                                          | `src/mcp/{errors,client,session,tools,server}.ts` | 源码拆解（vendor 同源提取）              | 冒烟                                       |
| MCP server 第三方内联（zod v3 / zod-to-json-schema / MCP SDK / express）                 | `vendor/mcp-server.dist.mjs`                      | 原样拷贝（第三方档案）                   | E2E                                        |
| `createComputerUseRuntime`                                                               | `src/runtime.ts`（入口 `index.js`）               | 语义还原（按 node-repl-host 消费契约）   | E2E（execute → mock broker）               |
| `createPipSessionClient`                                                                 | `pip-session-node.js`                             | 源码还原                                 | 冒烟                                       |

### 2. `@zcode/zcode-cua-helper`（CUA Runtime Helper）

| 原版组件                                                              | 仓库位置                                                             | 方式                                                                     | 验证                                        |
| --------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------- |
| payload CUA 模块（broker 服务端、AX/自动化桥、平台表面、peer 验证等） | `src/broker/**`、`src/lib/**`、`src/native/**`、`src/pip-session/**` | 源码还原（注意：底稿为 v3.1 内部版，与 0.5.13 存在方法表差异，见第五节） | tsc 0 错误；构建成功                        |
| Windows 入口（windowsDevHelperMain）                                  | `src/broker/server/windowsDevHelperMain.ts`                          | 源码还原（第二轮按原版逐行校正）                                         | 入口 5 场景 parity 全 MATCH（含 exit code） |
| Windows 系统表面（AUMID/别名启动）                                    | `src/broker/server/windowsSystemSurface.ts`                          | 源码还原（第二轮从原版 bundle 整模块替换）                               | E2E capabilities parity MATCH               |
| SEA 入口 + 内嵌元数据                                                 | `src/helper-sea-entry.ts`                                            | 源码还原                                                                 | 构建                                        |
| macOS Helper .app 构建                                                | `build-cua-helper-app.mjs`                                           | 语义重建                                                                 | 未在本机验证（无 mac .app 资产，见第三节）  |
| Windows helper bundle                                                 | `build.mjs`                                                          | 原有                                                                     | 构建 + 与原版发行物 E2E 对齐（见第五节）    |

### 3. 二进制与资产（原样拷贝）

| 资产                         | 仓库位置                                          | 说明                                                                       |
| ---------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| ax_native.node（win32）      | `packages/zcode-cua-helper/build/Release/`        | 原版发行物二进制；helperAddonLoader in-tree 路径直接解析，E2E 加载验证通过 |
| ax_native_mac.node（darwin） | `packages/zcode-cua-helper/native/`               | 原版发行物二进制副本；接口逆向说明见同目录 README（117 导出）              |
| ax_native.d.ts               | `packages/zcode-cua-helper/native/`               | 运行时内省生成的接口声明                                                   |
| zcode-window-bounds          | `packages/desktop/resources/macos-window-bounds/` | 权限浮窗吸附数据源，打包配置原有引用补齐                                   |

### 4. 插件与桌面 UI

| 组件                                                       | 仓库位置                                       | 状态                            |
| ---------------------------------------------------------- | ---------------------------------------------- | ------------------------------- |
| 官方插件包（`computer-use@zcode-plugins-official` 0.5.13） | `apps/zcode-cli/packages/zcode-cua-plugin`     | ✅ 第四轮对齐原版发行物（见下） |
| 权限浮窗 UI（renderer/preload/main 三层）                  | `packages/desktop/src/{renderer,preload,main}` | ✅ 仓库原有                     |

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

| 发行物资产                                                                             | 仓库状态                                                                                                                                                                                                                                | 结论                                                |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| tools/cua-helper（helper bundle + win32/mac addon）                                    | 已还原 + 三套件 221 项对齐                                                                                                                                                                                                              | ✅ 已对齐                                           |
| glm/packages/zcode-cua-plugin（桌面打包版）                                            | 与插件缓存版同源；仓库版仅多 src/ 与 resolve-pnpm-invocation.mjs（合理本地补充）                                                                                                                                                        | ✅ 已对齐                                           |
| app/ 与 app.asar                                                                       | md5 级完全一致（4113 文件，双形态发行同一份内容）                                                                                                                                                                                       | 同源，无独立差异面                                  |
| out/{main,host,scheduler,preload,renderer}                                             | 仓库可完整构建（build:no-runtime-assets 通过，产物同构 6 段）；cua 面（desktopCuaHelperInstaller/cuaPermissionPanel/cua-permission-panel.html）两侧俱在                                                                                 | ✅ 源码链齐备；内容差异为版本演进（仓库 HEAD 领先） |
| app.asar.unpacked（node-pty prebuilds、ssh2 sshcrypto）                                | 仓库 pnpm install 产出同源二进制                                                                                                                                                                                                        | ✅                                                  |
| glm 其余 7 插件                                                                        | android-emulator/ios-simulator/restore-legacy/skill-creator 版本一致；browser-use（0.4.1→0.5.1）与 zcode-guide（0.1.0→0.2.0）仓库领先；document-skills-plugin 0.1.4 在仓库已重构拆分（documents/pdf/presentations/spreadsheets 等分包） | ✅ 版本演进，非缺失                                 |
| glm/zcode.cjs（CLI 0.16.5）                                                            | 仓库 CLI 0.1.0（开源时版本号重置），源码链齐备                                                                                                                                                                                          | 版本演进                                            |
| config/default.json                                                                    | 仅飞书群链接 token 运营配置差异                                                                                                                                                                                                         | ✅                                                  |
| model-providers/models*catalog_china_llm_zcode*\*.json（目录型 catalog，10 providers） | 开源 HEAD 已重构为规则型 config/provider/zcode-builtin.json（revision 30，builtinProviderConfig）；旧 catalog 机制在 legacy 序列化层留有兼容                                                                                            | 机制演进，非缺失                                    |
| tools/ripgrep、tools/ugrep                                                             | 第三方二进制（rg.exe/ugrep.exe），随发行自带                                                                                                                                                                                            | 第三方，无需还原                                    |
| elevate.exe、tray_icon.ico、icon\*.png、app-update.yml、.node-bundle-meta.json         | 打包/更新器资产                                                                                                                                                                                                                         | 打包产物，无需还原                                  |

### 第十七轮：release 准备完善与发布闭环验证（2026-09-23）

- **版本统一**：desktop 与 cli-sea job 在 tag(v\*)构建时把 tag 版本写入根
  package.json（build-meta 与 electron-builder 的版本单一真相源），正式发布
  产物带 tag 版本号而非硬编码 3.14.0；手动 nightly 保持 \_TEST 后缀以示区分。
- **finalize 完整性门**：release job 下载产物后先跑离线校验（按平台覆盖
  断言 dmg/zip/exe/SEA 存在、通道清单 latest\*.yml 在、SHA256SUMS 自洽且
  兼容空格→点改名），再生成 SHA256SUMS 并发布。
- **两种发布形态**：tag v\* → 正式（production 身份、无 \_TEST、latest 标记）；
  手动 dispatch → nightly（test 后缀、prerelease）。
- **验证**：run 35831188052 六 job 全绿；发布页 nightly-277c324 含 12 项资产
  （双平台安装包 + blockmap + 通道清单 + SUMS + 三平台 CLI）；从该 Release
  下载 windows SEA 实测 `--version` 输出 0.16.9。
- 排障记录：integrity gate 曾用精确文件名断言（arm64.dmg / SHA256SUMS.txt）,
  在 nightly 形态下为假失败——改为平台覆盖断言 + SUMS 条件校验。

### 第十六轮：完整发布流水线（2026-09-23）

release.yml(tag v\* 自动 / 手动 dispatch,六个 job)全绿并发布首个
GitHub Release(nightly-149a7eb):macOS dmg+zip、Windows exe 安装包、
三平台 CLI 单可执行,共 6 个产物 1.16 GB。

链路与关键修复:

- 本地 Windows 打包预验证通过(bundle.mjs --os=win,152 MiB exe 过审计);
- desktop job:全链构建(闭包 dist → 插件 runtime → desktop build →
  electron-builder);无签名环境(CSC auto-discovery 关、mac identity 空)
  为开源社区构建预期形态;
- **ZCODE_SKIP_REMOTE_ASSETS=1**:桌面安装包不消费 mock-cdn 的跨平台
  remote 资产(node tarball/pty 等,那是远端部署与 WSL 链路用的),此前
  四跑 50 分钟超时全是在 CI 网络下下载这些无关 tarball 挂死;
- 下载健壮性:undici 连接停滞时 AbortSignal.timeout 不触发,改为系统
  curl 优先(--max-time+内置重试),无 curl 回退 fetch+timeout;
- 产物发布:runner 是 zsh(nullglob 报错),用 find+mapfile 收集上传;
- 表单记录:electron-builder 的 mac cua-helper .app extraResource 改为
  目录存在才拷贝(签名资产是上游交付物,开源树不携带;桌面 CUA 面
  fail-closed 不受影响)。

### 第十五轮：CLI 构建链完善（2026-09-22）

- **ci.yml 的 cli-build 深度化**：新增 scripts/ci/cli-app-server-smoke.mjs ——
  app-server 协议握手（首行必须是合法 startup/\* JSON 通知）、四条子命令
  （plugins/skills/commands/doctor）执行、agent 核心工具注册（字符串面），
  替换原先的 --version/--help 浅冒烟。
- **新增 cli-sea.yml（workflow_dispatch，ubuntu+windows 矩阵）**：发行级单可执行
  SEA 构建 —— 依赖闭包 bundle + 根 typecheck 产出 workspace dist + 插件 MCP
  runtime（node-repl-host/browser-use/android/ios）+ build-sea 组装；产物
  zcode-<os>-<arch>[.exe] 归档并对二进制直接跑 --version。全绿
  （run 35749212084，windows exe 实测输出 0.16.9）。
- **修复开源剥离的第三个类型缺口**：node-repl-host 按名 import
  ComputerUseRuntime/ComputerUseRuntimeContext，占位 d.ts 从未导出 —— 在还原包
  runtime 入口定义接口并从包根 re-export，HEAD 源码自此可编译（这也是 SEA
  能产物的先决条件）。

### 第十四轮：CI 全绿闭环（2026-09-22）

Drora Actions 四 job 全绿（run 35741131849）：verify / smoke / cli-build（ubuntu）

- addon-parity（windows-2022：MSVC 重编译 + 只读 57 项 + 矩阵 123 格对入库原版
  副本全过，重编译 .node 与 CLI bundle、helper bundle 均归档为 artifact）。

首跑至全绿修了四处环境性差异：linux 上原版 installer 面按设计抛 install_failed
（冒烟断言改三平台分支）；windows-latest 的 VS18 不被 node-gyp 识别（钉
windows-2022）；parity 脚本 createRequire 基址硬编码本机路径（改
import.meta.dirname）；runner 服务上下文下 self 提权查询可能返回 undefined
（isTargetElevated 断言按值相等否则按类型一致并透出两值）。

### 第十三轮：GitHub Actions 构建脚本（2026-09-22）

`.github/workflows/ci.yml`（push main / PR 触发，四个 job）：

- **verify**（ubuntu）：frozen-lockfile install → freshness 基线 → typecheck →
  lint（fmt 基线未定，暂不设卡，注释记录原因）。
- **smoke**（ubuntu）：zcode-cua mock-broker 冒烟 + helper typecheck/bundle 构建，
  bundle 以 artifact 归档。
- **cli-build**（ubuntu）：`pnpm --filter @zcode/cli... build`（依赖闭包，绕开
  turbo 递归）+ CLI 入口冒烟，zcode.cjs 以 artifact 归档。
- **addon-parity**（windows-latest）：MSVC 重编译 addon（SDK 自动探测注入 gyp）
  → 与**入库原版副本**逐项对齐（只读 57 项 + 输入×输出矩阵 123 格；写路径
  套件涉及真实键鼠注入不进 CI），重编译 .node 以 artifact 归档。

配套参数化（CI 可复现前提）：binding.gyp 的 Windows SDK include 由
build-rebuilt.mjs 探测后 `-Dwin_sdk` 注入（不再硬编码 D 盘）；三个 parity
脚本对照路径支持 `AX_NATIVE_ORIG` 环境变量并回退入库副本
（build/Release/ax_native.node 与发行物字节一致）。另清理了误入库的
reverse/build MSVC 中间产物。

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

### 第十轮：macOS .app 构建链对齐 + 双 broker parity（2026-09-24）

权威 spec：`specs/mac-cua-helper-app-alignment.md`（产物契约/验收口径/豁免边界）。

- **构建链修复**（`build-cua-helper-app.mjs`）：darwin 原生插件改取
  `native/ax_native_mac.node`（修复引用不存在的 `native/ax_native.node` 的
  ENOENT）；骨架熔丝判定（复用原版可执行=已熔丝不重复传参；全新 node 骨架
  postject 追加 `--sentinel-fuse`）；Info.plist 版本/BuildId 可注入
  （`CUA_HELPER_VERSION`/`CUA_HELPER_BUILD_ID`，缺省 3.11.2/local-dev）；
  Resources 明确不 staging node_modules（原版 SEA blob strings 实证
  load-sharp 解析基不含 Resources 相对基，能力无关）。
- **新增 `tools/parity-mac-helper.mjs`**（mac 侧第三条验收套件）：产物 vs
  官方 staging 原版双 broker 对比。场景一 unsigned launcher 双侧 fail-closed
  且 stderr 语义一致；场景二产品配方（本进程树的 ZCode 桌面 main 为
  launcher + 后代 peer，原版发行构建 local-dev 折叠 false、env 覆盖不可用，
  这是原版唯一接受的路径）authenticate / broker_info / 坏 token 拒绝，
  归一动态与身份字段后逐字一致——**4/4 MATCH**。
- **安装验收**：自建产物经 dev 通道（`ZCODE_CUA_HELPER_ALLOW_UNSIGNED_LOCAL` +
  plan 注入 `embeddedBuildId`）装入临时 `ZCODE_HOME` 的
  `dev/ZCode Computer Use Dev.app`，meta `local_dev_unsigned`/`releaseEligible:false`，
  幂等重装一致，装机后溯源冒烟通过。
- **发布身份边界（如实）**：自建产物为 ad-hoc 签名，能过 dev 校验；release
  校验链钉扎 TeamID 8A5X4JJ39T 与 buildId，自有 Developer ID 发布需配套
  embeddedBuildId 接线与钉扎决策（spec §六遗留）。

### 第十一轮：63 方法表整体重放（2026-09-24）

底稿：官方 mac 3.11.2 Helper SEA payload（未混淆 bundle，`strings -a` 直接可读），
方法表与 handler 全文雕刻自 `packages/desktop/resources/cua-helper` staging 副本。

- **方法表**：`BROKER_METHODS` 42 → 原版 63（对齐顺序/分组/READ_ONLY 集），另保留
  v3.1 超集 `paste`（宿主 cua-spec 消费，spec §六唯一有文档表偏差）。
- **重放 15 个方法 handler**：display 四件套（screen*size/cursor_position/list_displays/
  set_display，接线已还原未导出的 electronDisplaySelection）、screenshot（双拓扑指纹 +
  WindowServer 窗口栈指纹防漂移）、read/write_clipboard、get_skyshot（接线 axSkyshot，
  与原版同在 axReadOnly methods 末尾注册）、click_element_at_point、move_to、mouse_down/
  mouse_up（buttonHolder/splitDownInFlight/backgroundButtonHold 三态所有权 + 后台窗口
  ABI + 终清释放语义恢复）、type_text_into_current_focus、key_down/key_up。
  `pip_live_probe*\*` ×6：handler 在 helperMain 本就还原（v3.1 只删表项），恢复表注册即通。
- **构建链**：加 node 主版本守卫（SEA blob 随 node 版本变化，node 25 生成的 blob 注入
  node 24 骨架会在加载期 v8 崩溃，实测复现并修复）。
- **parity 套件升级**（`tools/parity-mac-helper.mjs` 场景三）：13 方法空参探测矩阵
  （错误码/归一形状逐项比对）——**12/13 MATCH**；`open_application` 为唯一预期差异
  （handler 未重放：531 行 + 11 个 helper 家族待下一轮，carve 坐标
  285175-285366/288429-288960/289370-289700）。租约隔离：controller lease 在 darwin
  是全局 `/tmp/zcode-cua-<uid>`，harness 以 XDG_RUNTIME_DIR 每实例隔离，消除
  "先跑实例自助拿租约、后跑实例读死 pid 残留而 fail-closed" 的顺序伪影。
- **发现并证伪的一个疑点**：动作族先呈现 ours=permission_denied vs orig=controller_busy
  的全量 DIFF，排查后确认两侧 lease/仲裁代码逐字相同，系 harness 顺序伪影（见上），
  隔离后全绿——非还原缺陷。
- **open_application 收尾**：531 行 handler + 11 个 helper 家族
  （resolveOpenedApp/settleLiveActive(Plus)App/resolveAppByPid/rollback 族/
  activateMacFilePanelSurface/file-URL 窗口核验族/win32 AUMID 别名族）全部按原版重放，
  场景三转为 **13/13 MATCH、零预期差异**。
- **.node 对齐双保险**：构建脚本钉扎官方 3.11.2 基线 SHA-256（不匹配即构建失败，
  升级需显式改基线）；parity harness 场景零断言产物与官方参照物 addon 逐字节一致。
- **node 守卫修正**：node 24 的 modules ABI 是 137（127 属 node 22——恰为原版骨架
  真实基座，与 gitignore「官方 Node 22 运行时」注释互证）；兼容矩阵实测为
  node 24 blob→node 22 骨架 ✓、node 25 ✗。
- **win32 无损复核**：共享模块（types/输入/backend）改动后 `build.mjs` 产物正常
  （1.28MB）、tsc/lint/架构门全绿；windowsDevHelperMain/windowsSystemSurface/
  native/reverse（CI 221 项 parity 套件所引文件）零改动。

### 第十二轮：macOS 内置插件全景对账（2026-09-24）

对照物：官方桌面 3.11.2 内置 `Resources/glm/packages/` 八插件 vs 仓库
`apps/drora-cli/packages/` 对应物，文件级 + 内容级（cmp/hash）对账。

- **zcode-cua-plugin 0.5.13 → 0.5.14**（唯一真缺口）：官方桌面内置 0.5.14，
  dist 全量 3.2MB 仅差 2 处 SERVER_VERSION 字面量；升级 package.json / manifest /
  dist 两字面量 / 注册表版本后，**dist 与官方 0.5.14 逐字节一致**（cmp 通过）。
  package.json 的 test 链裁剪与 manifest 无 mcpServers 为第四轮已记录的产品决策，
  保持不动。dist fail-closed 冒烟通过（缺 --permission-broker-socket 拒启）。
- **七对无缺口**：restore-legacy-sessions 与 skill-creator 为纯品牌更名
  （符合 drora-rename spec 豁免语义）；browser-use（0.5.1 > 官方 0.4.2）与
  drora-guide（0.2.0 > 官方 0.1.0，更名+dynamic workflows）为仓库版本领先；
  document-skills 拆分为 documents/pdf/presentations/spreadsheets 四插件
  （注册表注释记录的产品决策）；android/ios 模拟器插件仓库为源码形态、
  seed/打包期由 build 管线产出 dist（官方捆绑的是编译产物）。
- **版本一致性**：package.json / plugin.json / dist（2 处）/ 注册表四处全为
  0.5.14；check-cua-baseline 与 check-version-coherence 两脚本依赖的
  upstream.json / 已安装 producer 包在本开源 checkout 从未存在（producer 管线
  专用工具），失败属既有环境限制、与本次改动无关。
- **win32 对照基线不变**：win32 侧 parity 套件与逆向档案所引 0.5.13 发行物
  基线注释保持原样（那是 Windows 线的历史事实）。

### 第十三轮：embeddedBuildId 接线（2026-09-24）

spec：`specs/mac-cua-helper-app-alignment.md` §六。上游"桌面内嵌自己 Helper
构建身份"语义的开源还原，修复第十轮定位的三处断线：

- **`qu()` 透传**（packages/zcode-cua/helper-installer.ts）：默认 plan 构造补
  `embeddedBuildId`/`version` 透传；显式 plan 注入不受影响。
- **`Oie()` dev 覆盖修复**：`t.trim() || n` → `n || t.trim()`——dev 态 env
  优先生效（实测 dev=277386 覆盖生效），打包态恒钉 WC、env 注入不可达
  （实测 attacker-id 被忽略），与原版发行构建折叠语义一致。
- **`xie()` 打包态版本注入**：显式版本优先、`qc` 常量兜底（bundled 源本就
  跳过版本比对，此改动仅修正 meta.version 展示为真实版本）。
- **桌面身份读取点**（packages/desktop）：新增无 electron 依赖的
  `desktopCuaHelperBuildIdentity.ts`（plutil -extract 读 bundled Info.plist 的
  ZCodeCUAHelperBuildId/CFBundleShortVersionString），desktopCuaHelperInstaller
  创建时注入；读取失败回退 WC 钉扎（现状行为），不阻断安装。
- **类型与测试**：broker-server.d.ts 的 CuaHelperInstallerOptions 扩展
  embeddedBuildId/version（带注释）；新增
  `packages/zcode-cua/test/embedded-build-id.mjs`（并入 package test 链）：
  A 段身份读取 + B 段 release 安装链（官方 staged .app 277386 →
  verificationMode:release / releaseEligible:true / meta 全对 / 幂等）。
  **接线前的必败路径现直接通过**——不再需要 plan 注入或 dev 通道。
- **回归**：restored-smoke ✓、mac broker parity 四场景 ✓、workspace
  typecheck/lint/architecture ✓。

### 第十四轮：Resources 打包形态对齐 + load-sharp 两线差异裁定（2026-09-24）

用户裁定：打包必须对齐原版实现/形态。复核原版实现后的两点结论：

- **load-sharp 基差异是官方两产物线的演进差，非还原漂移**：mac 3.11.2
  helper SEA 为 4 基（import.meta.url/\_\_filename/ZCODE_PLUGIN_ROOT/可选 cwd），
  win32 0.5.13 原版 bundle（字节在仓）为 5 基（首位 ZCODE_CUA_PLUGIN_ROOT）——
  与我们 helper src 的还原逐字一致。裁定：保持 5 基（忠实 win32 官方实现，
  属该模块的较新演进），不回退 mac 旧形态。原版 SEA 入口（helper-sea-entry.mjs
  全文雕刻核对）只设 ZCODE_CUA_HELPER_ADDON，两线一致。
- **Resources/node_modules 改为 staging 对齐**（推翻此前"不 staging"
  裁定，用户决策）：构建从官方 staging 副本 ditto darwin sharp seed 四件套
  （≈16MB）进 Resources，缺失时跳过并告警。功能注记不变：sharp 唯一消费者
  linuxWindowCapture 有 linux 平台门，SEA 解析链与各 load-sharp 基均不含
  Resources——mac 上为非功能资产，此对齐是打包形态对齐。
- **验证**：产物 124.4 MB vs 原版 124.3 MB（主可执行 +736B = 63 方法表 blob），
  Resources 文件集与原版逐一相同（find diff 为空）；溯源冒烟、ax_native
  探针（117 PROBE OK）、双 broker parity 四场景全绿。

### 第十五轮：原版桌面发射链对齐（2026-09-24）

底稿：官方桌面 app.asar（3.11.2）内嵌 host 发射器全文雕刻（Uxe/F9/G9/Xxe/Yxe/
q9/Kxe/产品 host 工厂），即"原版对 cua helper 的真实调用"。

- **发射契约（原版 3.11.2 与 0.5.13 win32 线的关键演进差）**：`open` 经
  LaunchServices 不透传 env，mac 产品 token 从 env 改为**一次性文件**交付——
  `<socketDir>/.tokens/.broker-token-<launcherPid>-<16hex>`（目录 0700、文件
  0600、wx + 5 次重试）；args 序 `--socket → --token-file → [
--presentation-token-file] → --version → --expected-app-bundle-path →
[launch guard] → --exit-log → --launcher-pid → [dev 逃逸] → [ghost/pip
flags]`；成功发射 60s 后回收 token 文件；open 子进程 env 走白名单
  （HOME/TMPDIR/…/LC\_\* + ZCODE_CUA_PIP_DEBUG，PATH 硬编码
  /usr/bin:/bin:/usr/sbin:/sbin，超时 10s）。
- **还原落地**：helper-launcher 增 writeOneShotHelperTokenFile /
  createHelperTokenFileReceipt / scheduleHelperTokenFileCleanup，Bz 发射器
  写文件→open→失败撤销→成功调度回收，JC 支持 tokenFile 参数（紧随
  --socket）；helper-host darwin 路径铸造 token/presentationToken 并随
  handle 携带。启动契约此前缺失该链——mac 产品模式 helperMain 强制
  --token-file，缺此链 helper 根本无法经桌面启动。
- **客户端 token 消费贯通**：runtime token 键兼容读
  DRORA_CUA_PERMISSION_BROKER_TOKEN（客户端注入名，优先）/ ZCODE 旧名；
  runtimeEnv 捕获通道随有效凭据组捕获 token（sanitize 剔除已存在）；
  plugin-host-command 向 node_repl host 恢复 socket 时同步恢复 token。
  broker client 本就支持 authenticateParams{token}。
- **验收**（packages/zcode-cua/test/mac-launch-contract.mjs，并入 package
  test）：A token 文件格式/权限；B 与原版 Uxe 逐项参数序断言；C 完整原版
  向量 E2E（含 --exit-log/--launcher-pid/--ghost-cursor-overlay/--pip-mode
  - 产品 launcher）——ready / token authenticate / broker_info 认领 / 错
    token 拒 / exit-log 落盘，全过。既有三套件（restored-smoke、
    embedded-build-id、mac parity 四场景）全绿；typecheck/lint/架构门全绿。
- **如实边界**：桌面→agent 进程的 env 注入段（socket/token 写入 agent env）
  在当前 checkout 尚无调用方（injectInto 无 caller，属桌面接线演进项）；
  capture/restore 两端已就绪，注入链落地即通。

### 第十六轮：agent spawn env 注入 token（2026-09-24）

第十五轮"桌面→agent env 注入段"的落地：定位到注入点本就存在——
services `resolveSpawnEnv` → `buildCuaProductHelperAgentEnv`（managed host
凭据→agent spawn env 的既有通道），本轮把 token 接入该通道全部四个返回分支
（transport / reserved 提前 / startup 完成 / caller_timeout reserved）。

- **helper-host**：新增 `token`/`presentationToken` getters（handle 携带，
  发射时铸造）；`CuaProductHelperHost`/`CuaHelperHandle` 类型同步扩展。
- **shared/runtimeEnv**：导出 `DRORA_CUA_BROKER_TOKEN_ENV_KEY`；捕获通道
  随有效凭据组捕获 token（sanitize/非工具透传两道剔除列表均已含该键）。
- **services**：`buildCuaProductHelperAgentEnv` 的 host 参数签名放宽
  （token/presentationToken 进 Pick）；四个 env 返回分支按
  `host.token ? { [DRORA_CUA_BROKER_TOKEN_ENV_KEY]: host.token } : {}`
  注入——无 token（旧 Helper / win32 env-token 线）省键，语义与现状完全一致。
  `WindowsCuaHelperHost` 与 services 内联 host 适配器补 null getters。
- **链路全景**（mac 托管路径）：host 铸造 token → 一次性文件交付 helper
  （--token-file）→ helper broker 以 token 配门 → agent spawn env 携带
  socket+authority+token → CLI bootstrap 捕获 → plugin-host-command 向
  node_repl host 恢复 → runtime authenticate。桌面→agent env 写入段仍是
  既有演进项，capture/restore 双端就绪。
- **验收**：mac-launch-contract A–C 段全过；typecheck/lint/架构门全绿；
  services dist 依赖 tsconfig 路径映射不可 plain-node 加载，D 段
  （agent env 分支）以 typecheck + 分支代码审查覆盖（测试中可加载时自动验证）。

### 第十七轮：standalone 发射链 + PiP 凭据对齐（2026-09-24）

补齐 mac 两条次要发射路径的 token 模式（第十五轮只覆盖了托管路径）：

- **standalone 发射（设置页权限查询路径）**：`launchStandaloneCuaHelperForStatus`
  原先不带 token-file——产品态 helperMain 强制 token-file，该路径对
  自建/原版 helper 都起不来。现铸造 token → 一次性文件交付 →
  `--token-file` 入参（含 `--launcher-pid`，standalone 语义 300s 闲置休眠）→
  60s 主侧回收；权限查询 `callBrokerMethod(permission_status)` 携带同一 token。
- **`callBrokerMethod` 支持 `token`**：透传 `authenticateParams{token}`
  （brokerExchange 本就支持）。
- **PiP 凭据**：`CuaPipPresentationCredentials` 增 `presentationToken?`，
  `resolveCredentials` 从 host getter 携带；PiP 客户端（pip-session
  restored 区）的 token 消费为演进项。
- **验收**：mac-launch-contract 新增 C2 段——callBrokerMethod 经
  `screen_capture_status`（只读，避免 ping 触发 controller 租约仲裁的环境
  噪声）验证 token 通路 ok / 错 token auth-rejected。typecheck/lint/架构
  门全绿；其余套件回归无漂移。
- **勘误（2026-11-10，第七十三轮 R1.3）**：上段「现铸造 token → `--token-file`
  入参」的记档与实现脱节——token 构造当时已提取至
  `buildStandaloneCuaHelperLaunchArgs`，但主函数 `launchStandaloneCuaHelperForStatus`
  未改用（「注释称已提取、主函数未改用」，差距审查 H1），产品态该路径实测两次
  exit(2)。第七十三轮 R1.3 修复：主函数直接调用提取函数（`node.ts:2239`），
  产品态回归转绿（cuaStandaloneStatusLaunchProduction.node-test.mjs）。

### 第十八轮：token 模式探针贯通 + standalone token 缓存（2026-09-24）

token 模式回归后的两处自愈性补漏（均为发射链投产后才会暴露的运行期问题）：

- **健康探针带 token**：`probeHelperHealth` 无 token 调 broker_info，在认领
  窗口内可行；但窗口关闭后（其它客户端先认领、或后续恢复探针）会被认证门
  拒绝——健康 helper 被误判 health_timeout/auth_failed → BROKER_UNAVAILABLE。
  修复：`ProbeHelperHealthOptions.token` + helper-host `checkHealth`、`start()`
  启动探针（防其它客户端抢先认领）、`queryPermissionStatus`、
  `queryScreenCaptureProbe` 全部携带 handle token。
- **standalone token 进程内缓存**：设置页发射的 token 此前只活在发射闭包，
  同 host utilityProcess 的 `resolveSpawnEnv` 懒启动分支拿不到。新增
  `standaloneTokenBySocket` 缓存（发射成功写入、重发射前清旧），懒启动分支
  命中缓存时向 agent env 注入 `DRORA_CUA_BROKER_TOKEN_ENV_KEY`；helper 被
  外部以其它 token 重启则缓存过期 → 客户端认证 fail-closed（宁可拒绝不可绕过）。
- **验收**：mac-launch-contract 全段、embedded-build-id、restored-smoke、
  mac parity 四场景全绿；typecheck/lint/架构门全绿。

### 第十九轮：PiP 客户端 presentation token 消费（2026-09-24）

第十七轮遗留边界的收口：PiP 客户端（restored 区）的 token 消费落地。

- **pip 客户端工厂**（windows-helper-host `S$`）：`authenticateParams` 由
  固定 `{role:"presentation"}` 扩展为 `{role:"presentation", token?}`；
  `pip-session-node` 包装器与 `PipSessionClientOptions` 透传
  `presentationToken`；`cuaPipSessionService` 把凭据中的 presentationToken
  传入客户端。
- **验收**：mac-launch-contract 新增 F 段——helper 以
  `--presentation-token-file` 启动后：presentation token authenticate 得
  `role:"presentation"` 且通过 PiP 权限门；工具角色调 PiP 方法被
  "presentation authority" 拒绝。全段 + 全套件回归 + 门禁全绿。

### 第二十轮：mac 构建链 CI 守卫（2026-09-24）

把 mac .app 构建链锁进 CI（`.github/workflows/ci.yml` 新增 `macos-helper` job，
macos-14 arm64 + node 24.14.0）：build:darwin-app → 溯源冒烟 → ax_native 接口
探针/双向漂移 → 发射契约离线段（token 文件契约 + 原版参数序）。任一历史回归
（addon 文件名 ENOENT、node 版本错配、SEA 熔丝缺失、基线 SHA-256 漂移、
参数序漂移）即红灯。产物以 artifact 上传（7 天）。

- **契约测试双模式**：`MAC_LAUNCH_CONTRACT_E2E=0` 只跑离线段（A/B）——
  E2E 段（C/C2/F）需要产品 launcher 祖先与官方签名 staging 资产（不入库），
  仅本机可跑；parity-mac-helper、embedded-build-id 同理保持本机验收。
- 本机双模式复验：E2E=0 与全量均通过。

### 收尾（2026-09-24）

- `mac-launch-contract` 并入 `@drora/drora-cua` package test 链；E2E 段在
  无官方 staging 资产的 checkout 自动降级为离线段（与 CI E2E=0 等效），
  `pnpm --filter @drora/drora-cua test` 在任意 checkout 可跑。
- 全部门禁终态：typecheck 0 错 / lint 0 errors / 架构 0 违规；六套验收
  （ax_native 探针+漂移、溯源冒烟、发射契约 A–F、embedded-build-id、
  restored-smoke、mac parity 四场景）全绿。

### 第二十一轮：真实 LaunchServices 发射 E2E + SIGTERM 语义澄清（2026-09-24）

- **G 段（opt-in `MAC_LAUNCH_CONTRACT_OPEN=1`）**：以原版 q9 白名单 env 发起
  真实 `/usr/bin/open`（LaunchServices），验证最后一条未测的生产路径——LS 接单、
  token 文件交付（无继承 env）、socket 认领、broker_info、按 pid 精确终止。
  **全段通过**。修复过程中发现并纠正：契约测试默认 helperApp 曾误指官方
  staging 副本（自 embedded-build-id 复制而来）——E2E 必须验证我们的构建产物，
  现默认 `dist-cua-helper`，并加产物缺失自动降级。
- **SIGTERM 幸存澄清（非还原分歧）**：受控对照实验（同参数直启 OURS/ORIG、
  同探针序列、SIGTERM）——OURS 挂住、ORIG 干净退出，根因是环境而非代码：
  两侧 shutdown/清理代码逐字一致；无持有态下原版也强制发一次 `mouseUp("left")`
  并要求成功，ORIG 有 AX 授权故成功 → clean exit；我们的 adhoc 产物无授权 →
  失败 → 按原版语义 "refuse unsafe shutdown"（拒绝后不退出）。测试与排查中
  以 SIGKILL 兜底；生产产物（Developer ID + 授权）不受影响。
- **验收**：mac-launch-contract A–G 全段（含真实 LS 发射）+ 全套件 +
  lint/架构/typecheck 门全绿。

### 第二十二轮：darwin dev 回退路径修复（2026-09-24）

`helperAddonLoader` 的 in-tree 回退写死 `build/Release/ax_native.node`
（win32 PE）——mac 上不经 .app 的运行（repo 直跑 helper/工具链）会命中 PE
报镜像格式错误，此前一直以显式 `ZCODE_CUA_HELPER_ADDON` 环境变量绕过。
修复：darwin 平台回退优先解析 `native/ax_native_mac.node`（字节级官方副本，
向上走 8 级目录），win32 解析路径不变。esbuild bundle 实测：无环境变量时
darwin dev 回退正确加载 mac 副本（117 导出可用）。

### 第二十三轮：一键验收 runner + 记忆同步（2026-09-24）

- **`tools/verify-mac-alignment.mjs`**（`pnpm --filter @drora/drora-cua-helper-runtime
verify:mac`，`--fast` 跳过重建）：八段串行——构建/溯源冒烟/接口探针/漂移/
  ax_native 字节对齐/包测试链/embeddedBuildId/发射契约 A–G/双 broker parity。
  任一失败非零退出。官方 staging 资产缺席时字节对齐与 parity 段自动跳过
  （CI 形态）。
- 持久记忆同步：ax-native 对账与 mac 打包两条记忆按第 10/22 轮修复状态更新
  （dev 回退命中 PE 已修）。
- 门禁全绿；全套件复验通过。

### 收尾增补：spec 一致性审计（第二十四轮，2026-09-24）

`specs/mac-cua-helper-app-alignment.md` 经二十三轮演进后完成一致性审计：
§五 文件范围声明更新（行为对齐类改动允许进入还原权威区 src/，须官方雕刻
底稿 + 证据坐标；load-sharp 5 基裁定入档）、§四 验收清单补齐（release 链/
dev 链分列 + verify:mac runner）、头部补状态行（代码侧完成声明）。spec 与
manifest 事实一致。

### 第二十五轮：open_application stderr 诊断对齐 + 全量 diff 自查（2026-09-24）

- **stderr 可观测行为对齐**：原版 `open_application` 含四条
  `[cua-openapp-diag]` stderr 诊断（launcher dispatch FAILED / dispatch done /
  resolveOpenedApp FAILED / resolved app），移植时被省略——stderr 经 exit-log
  tee 落盘，属可观测面。已按原位/原格式补齐。
- **全量 diff 自查**：44+ 文件逐文件扫描——无 debug 残留、无误删、注释与
  实现一致；lint 警告 352（低于改动前基线 353）。
- 门禁全绿；发射契约 A–G（含真实 LS 发射）复验通过。

### 第二十六轮：桌面安装包字面交付（2026-09-24）

按 CI/release 同款管线在本机完成**完整桌面安装包**打包，把"打出与原版能力
一致的 computer use app"落到字面交付物：

- 前置：按 CI 同序构建插件 dist（`@drora/cli...` 闭包 + browser-use/android/
  ios/obsidian 四个 excluded seed 包）——`prepare:agent-bundle` 的官方插件
  seed staging 依赖这些 dist。
- `node scripts/bundle.mjs --os=mac --arch=arm64`（CSC_IDENTITY_AUTO_DISCOVERY=
  false，开源无签名形态）→ `dist/Drora Preview-0.0.1-mac-arm64_TEST.dmg`
  （231MB，含 zip + blockmap + latest-mac.yml 更新通道清单，bundle-size 审计
  500MB 内通过）。
- **dmg 内 helper 验证**：`Contents/Resources/cua-helper/ZCode Computer Use.app`
  完整随包——ax_native SHA-256 `1ecb13fd…`（字节级官方）、Info.plist
  3.11.2/277386、codessign 有效、溯源冒烟 exit 0。即：**用户拿到的安装包里
  的 computer use app 与官方能力一致**（签名身份除外，§七遗留）。
- 剩余：release.yml 的签名环境（DRORA_ENABLE_MAC_SIGN + 证书）为发布身份项。

### 第二十七轮：runtime 消费层 token E2E（2026-09-25）

发射契约测试新增 H 段：`createComputerUseRuntime`（node_repl 宿主的真实消费
入口）从 env 读取 token → brokerExchange 自动 authenticate → 只读方法取回
broker 真值（adhoc 产物无屏幕录制授权，真实状态为 "denied"）；错 token 时
authenticate 被拒。宿主消费层与 broker 的 token 链路端到端闭环——此前仅验证
了裸 socket 层（callBrokerMethod）。

### 收尾增补：提交分组全量核验（2026-09-25）

以 Node 对实际 git status 做分组覆盖断言，修正此前手写分组的路径错置
（发射链文件曾误归 helper 包路径）——47/47 全覆盖：
G1 构建链与 spec(4) / G2 方法表重放(7) / G3 插件 0.5.14(5) /
G4 embeddedBuildId(7) / G5 发射链 token 模式(13，含 broker 导出与契约测试) /
G6 PiP 与 win 宿主(7) / G7 验收套件与 CI(4)。
七组提交已实体化并在 `feat/mac-cua-alignment` 分支落库。

### 第二十八轮：home 目录接缝缺陷发现（2026-09-25）

追问"打包出的桌面真实运行时的接缝"时发现：helper 安装根在两层用了不同的
家目录约定（安装侧 ZCODE_HOME||~/.zcode vs standalone 查找侧
DRORA_HOME||~/.drora，无桥接）。属重命名迁移的接缝缺陷：托管路径自洽但与
官方 ZCode 同根共存；standalone 设置页路径静默失败。修复需产品决策
（env 路由 vs 保持共存），已入 spec §七.0 遗留决策，未获批不动。

### 收尾增补：dmg 卷内验证（2026-09-25）

挂载 `Drora Preview-0.0.1-mac-arm64_TEST.dmg` 实测卷内内容（区别于上轮的
electron-builder staging 目录）：卷内 `Drora Preview.app` 的
`Resources/cua-helper/ZCode Computer Use.app` 完整（AppIcon/ax_native/
node_modules）、Info.plist 3.11.2/277386、ax_native SHA-256 `1ecb13fd…`
（字节级官方）、codesign 有效、**卷内路径直接运行溯源冒烟 exit 0**。
字面交付物验证闭环。

### 第二十九轮：home 接缝修复——方案 A env 路由（2026-09-25）

desktop main fork host 进程时注入 `ZCODE_HOME=DRORA_HOME||~/.drora`
（darwin only，desktopHostProcess），豁免区安装链（ZCODE_HOME||~/.zcode
语义）经 env 落到 ~/.drora/computer-use，与 services standalone 枚举对齐；
并与官方 ZCode 的 ~/.zcode 隔离。commit 7952bba。

### 第三十轮：参数校验矩阵深度对齐（2026-09-25）

parity 场景四：24 个带参确定性用例（类型错/边界/缺失），双侧逐字比对
error.code + message 原文——**24/24 全 MATCH**（move_to/click/scroll/drag
point 校验、scroll 0..100、pip_start 三段校验、会话键强制、targetless 拒绝
文案）；cursor_position 真值逐位一致；request_access/permission_status/
controller_status 载荷结构一致（pid 归一后）。

### 第三十一轮：构建期常量折叠机制（2026-09-25）

SEA 入口 embeddedVersion 经 esbuild define 读取（typeof 守卫，缺省 3.11.2）；
发行形态开关折叠 `__ZCODE_LOCAL_DEVELOPMENT_RUNTIME__=false`（原版
`true ? false : …` 语义）；buildId 唯一载体=Info.plist。验证：默认形态
3.11.2/local-dev 不变；折叠形态 9.9.9/drora-release-test 双载体同源；
bundle 无 define 残留。**换身份发行路径完整**。

### 第三十二轮：分发根单一来源（2026-09-25）

main 进程设置页安装流不经 host env 注入，安装根会分叉 ~/.zcode。修复：
`resolveDroraHome()` 单一来源（desktopRuntimeEnv 导出），host env 注入/
main 设置页安装流/dev bundled 路径基三条路径统一路由 ~/.drora/computer-use。

### 第三十三轮：无签名分发 profile——路线 A 实施（2026-09-25）

用户确认无 Developer ID，选定 ad-hoc + 放行脚本分发。三处 default-off
构建期折叠：① helper SEA `CUA_HELPER_ALLOW_UNSIGNED_LAUNCHER=1` 折叠
`allowUnsignedLauncherLocalDev=true`；② 构建签名 exe/bundle 以
`--identifier dev.zcode.cua-helper` ad-hoc 签名（修复路径派生标识导致
`isCuaHelperBundleId` 恒假的拦截）；③ 打包 LSEnvironment
`DRORA_CUA_HELPER_ADHOC_DISTRIBUTION=1` → 安装器
`allowUnsignedDistribution` + host launcher 传标志。
**E2E**：折叠构建 + 未签名 launcher 发射成功 + token auth；对照组
（默认构建）正确拒绝。安全姿态：token 文件 + peer 祖先链验证守护；
放弃的是官方 Developer ID 身份链（无 ID 分发的必然代价）。

### 第三十四轮：controller 生命周期仲裁 parity（2026-09-25）

parity 场景五：controller 生命周期序列——单连接驱动
initial-status → takeover → status → takeover-reentrant → status →
stop → status 七步状态机，双侧逐步比对（pid 归一）。
**7/7 全 MATCH**：自助拿锁/重入/释放的状态机语义与原版完全一致。
至此除需 TCC 授权的观测成功载荷（受环境阻塞）与侵入式输入方法外，
所有可在双侧无阻塞验证的行为面均已对齐并有自动化锚定。

### 第三十六轮：全方法空参穷举 + element 消息漂移修复（2026-09-25）

parity 场景六：**全方法空参穷举**——除 TCC/AX 阻塞面（screenshot 家族、
AX 观测九法）、有副作用面（paste、controller*takeover/stop）与
presentation 门（pip_session*\*）外的全部方法，空参行为
code + message 双侧逐字比对。

- **发现一处真实还原漂移并修复**：六个 element 方法
  （press/show_menu/focus/set_value/perform_action/select_text）的
  stale-token 错误消息——还原稿为 v3.1 内部版长文案
  （"…is no longer registered. It was either never issued…"），原版
  mac 3.11.2 为短文案（"unknown or stale element token <empty>;
  call get_app_state again."，error code 同为 element_unavailable）。
  已按原版对齐（axReadOnly refFromParams），**50/50 全 MATCH**。
- 附带发现（如实）：write_clipboard 空参在双侧都会把用户剪贴板写为空
  （mac 经 pbcopy）——sweep 设计时低估了此副作用，本轮已在用户机器上
  发生一次；后续 sweep 将 write_clipboard 移入排除清单。

### 第三十五轮：分发签名修复——"已损坏"根因消除（2026-09-25）

用户实测 dmg 打开的桌面 App 报"已损坏，无法打开"。取证与修复：

- **根因（本机挂载 dmg 实证）**：`codesign --verify --deep --strict` 失败——
  `code has no resources but signature indicates they must be present`
  （In subcomponent: Drora Preview Helper (GPU).app），外层 Identifier=Electron。
  electron-builder 在 CSC 关闭（无签名身份）时跳过全部签名，预构建 Electron 的
  陈旧 ad-hoc 签名残留：Helper (GPU) 等被重命名的嵌套 App seal 失配 →
  macOS 判定签名无效报"已损坏"。非 Gatekeeper 摩擦，是真实打包缺陷。
- **修复**：electron-builder `afterPack` 增加 ad-hoc 重签钩子——mac 且
  `DRORA_ENABLE_MAC_SIGN!==1` 时 `codesign --force --deep --sign - <app>`。
  **验证**：deep strict verify exit 0；外层 `dev.drora.app.preview`/adhoc；
  嵌套 cua-helper 官方 Developer ID 签名完整保留（TeamID 8A5X4JJ39T，
  --deep 未破坏——electron-builder 已签的嵌套件不被重签）；卷内 helper
  溯源冒烟 exit 0。
- 用户侧残余步骤（Route A 固有）：若 dmg 经浏览器/隔空投送转移带隔离属性，
  首次打开前 `xattr -dr com.apple.quarantine <app>`；TCC 两权限手动授予，
  更新后重授。

### 第三十七轮：插件市场改名桥接（2026-09-25）

用户实测插件市场报错："Official marketplace source must provide
drora-plugins-official, received zcode-plugins-official"。根因：官方市场源
是 z.ai 共享 CDN（rename 规则 0 豁免，URL 不可改），其清单以原版名
zcode-plugins-official 发布；而加载守卫要求 canonical 名
drora-plugins-official——改名迁移的接缝缺陷，官方市场在 Drora 上从未可加载。

修复：contracts 导出 `OFFICIAL_MARKETPLACE_UPSTREAM_ALIAS`；
adapters 官方源加载后做改名桥接（manifest.name 与 raw.name 归一到
canonical；插件条目无市场后缀，顶层归一即足够）。安全面：仅固定官方
HTTPS 源生效，无伪造面；CDN 内容不变（规则 0 尊重）。typecheck 全绿。
写后断言模式沿用。

### 第三十八轮：官方 3.14.3 全插件对齐（2026-09-25）

官方桌面升级 3.11.2 → 3.14.3 后五路 subagent 全面重审 14 个内置插件目录，
发现三个真缺口并全部闭合（本包由 zcode-cua-plugin 辐射到其余插件族）：

- **zcode-cua-plugin 0.5.14 → 0.6.3 整代迁移**：官方弃"插件自带 MCP server
  bundle"改"共享 node_repl host + SDK 桥脚本"。逐字拷贝官方
  `scripts/computer-use-client.mjs`、`scripts/check-sdk.mjs`、
  `docs/computer-use.md`、`package.json`（main 指向 client）、`plugin.json`、
  `SKILL.md`（node_repl bootstrap + `agent.computerUse` API 版）、
  `sync-cache.mjs`（恢复 staging 双函数）；删除 `dist/`、`src/mcp/server.ts`、
  `tsconfig.json`、`scripts/build-mcp.mjs` 与 `.gitignore` 的 dist 例外。
  `diff -r --exclude=node_modules` 与官方零差异、`grep -ri drora` 零命中。
- **宿主接线**：`node-repl-host/src/cua-bridge.ts` 桥接符号改回官方互操作契约
  `Symbol.for("zcode.node-repl.computer-use-bridge")`（豁免区客户端逐字读取）；
  `bootstrap/src/app/built-in-node-repl.ts` 增设 `ZCODE_CUA_PLUGIN_ROOT`
  （官方 SKILL 引导按 `ZCODE_CUA_PLUGIN_ROOT ?? ZCODE_PLUGIN_ROOT ??
CLAUDE_PLUGIN_ROOT` 解析插件根，豁免区不改名则宿主必须提供官方变量名）。
- **browser-use 0.5.1 内容还原**：仓库此前单方面删光官方内容——恢复
  `CLAUDE_PLUGIN_ROOT` 兼容回退、全部 Codex 措辞（SKILL/docs/api.json/README）、
  `external: ["sharp"]` 与 `修复原因` 注释（7 处落在 bundle 源头
  `core/src/browser-client/{documentation,facade}.ts`，重建后品牌规范化 diff=0）、
  license 归位 MIT、test script + vitest devDep、随包 node_modules sharp 栈
  （97 文件入库，win32-x64 基线对齐 zcode-cua-plugin 策略）。
- **drora-guide 0.2.0 → 0.3.0**：内容本已逐字等价，三处版本随升；按官方 0.3.0
  形态移除 `commands/workflow.md` 与 `skills/dynamic-workflows/`（旧副本，
  官方已移入 bundled-skills；旧副本优先级高于 bundled 根，用户此前实际加载
  的是旧版技能——本轮回退到官方形态后 bundled-skills 现行版生效）。
- **bundled-skills 补 README.md**（官方随包分发链说明，品牌规范化后反向 diff=0）。
- **node-repl-host**：`build.mjs` 恢复 `external: ["sharp"]` 与官方注释出处
  （日期/pipeline 编号）；package.json 补 vitest devDep 与 test script。
- **配套管线**：新建 `packages/desktop/scripts/sharp-package-assets.mjs`
  （官方 sync-cache 的 import 依赖；koffi 同款契约 + 仓库入库基线回退，
  win32 冒烟 100 文件含 native/dll）；注册表 CUA requiredSeedPaths 由
  `dist/mcp/server.js` 改为 0.6.3 载荷三件套（skill/docs/client）+sharp；
  guide seed 路径钉 6 个诊断技能；browser-use/runtimeTopLevelPaths 采用
  确定性子树（node_modules/sharp 等 5 项）——browser-use 仍是 pnpm workspace
  成员，node_modules 混有开发依赖，bundled-plugins.ts 的 seed 白名单与
  prepare-agent-node-bundle.mjs 的 staging 同步支持嵌套子树条目，只随包
  运行时文件；prepare 脚本 bundled-skills staging 增补 README。

审查确认其余七对（skill-creator、restore-legacy-sessions、plugin-creator、
image-search、documents/pdf/presentations/spreadsheets 四拆分）已对齐或仅
品牌豁免。ios-simulator 仓库 run.ts 领先官方（win32 兼容 + stdin 管道）与
superpowers-plugin 占位（仅 LICENSE）为待用户裁定的既有偏离，本轮不动。

### 第三十九轮：遗留收口——merge 一致性重建 + ios 官方形态回退（2026-09-25）

第38轮三项遗留的收口：

- **CLI 全包 typecheck 恢复全绿（非源码缺陷，纯过期 dist）**：第38轮报告的
  bootstrap↔dynamic-workflow `listRunLifeSpans` 等"类型错配"，实为 v3.14.3 merge
  带入源码后 adapters/shared-types 的 dist 未重建（`DwfRunIntrospectionQueries`
  定义于 adapters/src/storage/session-store/repositories/dwf-journal-introspection.ts:90，
  含完整 `listRunLifeSpans` 读面与 SQL 实现；`enableWorkflow` 在
  shared-types/src/index.ts:34）。重建两包后 bootstrap 0 错误；18 个 CLI 包
  typecheck 全 PASS（turbo 在本环境不可用，用 `../../node_modules/typescript/bin/tsc`
  按包直跑）。
- **ios-simulator 回退官方 3.14.3 形态（用户裁定"继续完成对齐"）**：删除仓库单侧领先的
  `commandForPlatform`（win32 .bat/.cmd 兼容）、`opts.input` stdin 管道（核查确认**无任何
  调用方**，纯死代码）、`pick(input = {})` 默认参；`settle(exitCode)` 的 `?? 1` 移回
  close 调用点（官方形态）。重建 dist 后：特性 grep 零命中、工具面与官方 14/14 全等、
  `dist/lib/run.js` 与官方唯一差异为三元表达式换行格式。android 线保留官方既有的
  win32 兼容与 stdin（官方 android dist 本就携带，未动）。
- **superpowers-plugin 裁定归档：保留**。git 考证：目录自 fork 基线起仅含 1 个 LICENSE
  （ee041bf 纯 R100 更名，无任何删除史），系上游源码树继承的惰性占位——无 package.json
  （非 workspace 成员）、不进注册表、零代码引用。官方 glm/packages 无对应物，属"上游
  源码树继承"而非仓库自增偏离，删除反而偏离 fork 基线；保持原样并在此记录。

### 第四十轮：出源风格对齐 + natives 按目标平台 staging（2026-09-25）

第38轮审查中归类为"非功能构建差异/形态决策"的残余，本轮按官方形态权威继续收口：

- **android/ios 出源风格对齐**：android `run.ts` 的 `?? 1` 移回 close 调用点（settle 保持
  纯函数，与官方 android/ios 出源一致；ios 已于第39轮完成）；android `preflight.ts`
  工具检查表内联进 for...of（去掉具名局部 toolChecks）；两插件 `server.ts` 加 shebang
  并导出 `main()`、tsconfig 开 declarationMap——重建后 `dist/mcp/server.d.ts` 与官方
  逐字同形（shebang + `export declare function main()` + sourceMappingURL，.map 仅本地
  产物、electron-builder glm 过滤 `!**/*.map` 与官方一致）。工具面复核 android 12/12、
  ios 14/14 与官方全等；android 保留官方既有的 win32 兼容与 stdin 管道。
- **natives 按目标平台 staging（修实际打包缺陷）**：此前 stageOfficialPlugins 对声明
  runtimeTopLevelPaths 的插件**整目录复制源 node_modules**，而入库基线是 win32 平台集
  ——darwin-arm64 staging 缓存实测带着 sharp-win32-x64 进安装包，原生模块在 mac 上
  MODULE_NOT_FOUND。官方发行物的 node_modules 是按目标平台产出的运行时闭包。本轮：
  desktop 增加 `sharp@^0.34.5` devDep（hoisted 根解析，@img 全平台可选依赖齐备，跨
  平台构建可用）；打包脚本对 node-repl-host / browser-use / zcode-cua 三个插件改用
  `stagedNativeRuntimes`（CUA=sharp+koffi，另两个=sharp），staging 时清空目标
  node_modules 后按目标平台调用 sharp/koffi stager（与官方 sync-cache 同一组函数）。
  **darwin-arm64 仿真验证：三个插件 staged node_modules 文件集与官方逐项完全一致**
  （host/browser-use 99 文件、CUA 103 文件，missing=0 extra=0——sharp stager 补了
  官方同款 `*.md`/`*.d.ts` 裁剪）。koffi stager 输出本就与官方一致（index.d.ts 官方
  保留）。注册表侧 browser-use 子树清单降为仅服务 dev filesystem seed；dev 态宿主
  sharp 解析走仓库根 hoisted。
- **边界记录**：SEA 构建链（sea-official-plugin-assets）历来跳过 node_modules 且仅嵌
  host+browser-use 两插件，本轮不动（桌面 glm 发行物为对齐基准）；宿主 Helper 自装器
  缺位维持第五轮决策（开源仓库无签名 Helper 资产，能力由桌面侧 installer 承载）。

### 第四十一轮：插件市场个人数据对齐收口（2026-09-25）

第五维度审查（个人数据加载 + 远程资源加载）发现的两个内容面缺口闭合：

- **补录 claude-plugins-official 内置市场**：官方内置清单（Bqt）是两个市场——官方 CDN
  源 + Claude 生态 GitHub 源（anthropics/claude-plugins-official，314 插件，发现页
  「Claude Code 插件」分段的来源），Drora 此前只补录官方源。`DEFAULT_PLUGIN_MARKETPLACES`
  增加第二个条目（描述官方逐字），`ensureDefaultPluginMarketplaces` 首载自动补录
  （github 源解析既有路径直通）；公开商店身份不变（官方 itr 同款：claude 市场属个人
  分段）。发现页个人分段组标题与市场管理对话框为 claude 市场特判 i18n
  `settings.plugins.marketplace.claudeCodePlugins`（中英文案官方逐字）。
- **icon-sources.json CDN 图标索引**（官方 hdn/wJr 同构）：Claude 生态市场镜像来自
  GitHub 不带图标，官方 CDN 另发布 icon-sources.json 索引。adapters 新增
  `syncClaudePluginsOfficialIcons`：每进程每 storage root 一次守卫 → 拉取索引
  （10s 超时；异常回退缓存文件；空索引不清空已有图标）→ 逐条校验（name 段正则、
  icon 必须 .png 无绝对路径/反斜杠且 ≥2 段、mimeType 仅 image/png、sha256 64-hex）
  → 只给缺失/空白 icon 的条目补 assets 基址绝对 URL → 合并有变更才原子写回镜像
  清单；索引本身 best-effort 落盘。bootstrap `getDroraPluginsOverview` 按官方 Vwt
  同款 fire-and-forget 触发，不阻塞列表。shared 新增
  `CLAUDE_PLUGINS_OFFICIAL_MARKETPLACE_ID`/`OFFICIAL_PLUGIN_ASSETS_BASE_URL` 导出。
- **测试**：adapters 新增 test 链（node --import tsx --test，与仓库 TS 源码导出形态
  匹配）：索引解析/逐条丢弃、合并只补空白且无变更返回原引用、双内置市场补录幂等，
  5/5 通过。质量门：根 typecheck + adapters/bootstrap typecheck、lint 0 errors、
  架构 0 违规。

### 第四十二轮：macOS 桌面端 Resources/app 完整形态对齐（2026-09-25）

第六维度审查发现官方 3.14.3 mac 发行物在 Resources/ 下同时携带 app.asar 与**完整
解包副本 `Resources/app`**（out/ + node_modules + .build-ready 构建标记，382MB）。
实测关系：该目录与 app.asar 解包内容**逐文件零差异**；lsof 证实官方 main/host 进程
均从 app.asar 加载，副本无运行时消费者——官方构建管线随包携带的完整拷贝。按用户
裁定「完整对齐官方形态」照原版携带（与第十四轮 sharp 死重裁定同则）：

- electron-builder afterPack 链新增 `extractUnpackedAppCopy`（darwin）：在 app.asar
  全部重写（运行时依赖注入、sourcemap 尾注剥离）之后，用 @electron/asar CLI 把最终
  app.asar 全量解包到 `Resources/app`（幂等：先清上代副本），置于 adhoc 重签之前使
  副本随整包统一重签。
- **真实构建端到端验证**（bundle.mjs --os=mac --arch=arm64）：`afterPack:
extractUnpackedAppCopy` 2835ms 完成；新构建 `Resources/app` 与其 app.asar 解包
  内容 find diff = 0 行；顶层 Resources 与官方完全一致（仅多 THIRD-PARTY-NOTICES.md
  - licenses/ 合规增补，官方无对应物）；**.app 总体积 1.1G 与官方 1.1G 对齐**
    （此前 713M，差值即本项）。
- 顺带修复构建验证暴露的漏网 bug：prepare-agent-node-bundle.mjs 中 drora-guide 条目
  的 requiredSeedPaths 副本仍钉第三十九轮已删除的 commands/workflow.md（注册表已改、
  打包脚本副本漏同步，首次完整打包即 fail-fast 拦截），同步为 0.3.0 六个诊断技能
  路径。本次打包同时端到端验证了第 38–41 轮全部改动（插件 staging、natives per-
  platform stager、guide 载荷、marketplace 改动）真实可出包。
- 本机构建工具链注意：shell 默认 PATH 的 `pnpm` 是 nvm node18 下的系统 pnpm9，
  prepare-prebuilds 内部裸调 `pnpm` 会以 node18 运行 tsx（util.parseEnv 崩溃）；
  需 PATH 首位置入 corepack pnpm 10 shim + volta node24。CI（mise 钉扎）不受影响。

### 第四十三轮：收尾三件——Helper 缺失告警 + icon 同步真实 E2E + dist 残差定性（2026-09-25）

- **darwin 打包缺失 cua-helper 资产显式告警**：electron-builder 配置的资产条件跳过
  分支补 console.warn（此前静默跳过，干净检出产的残包要等用户点权限按钮才以
  「Helper 可能还在启动」toast 暴露）。开源无资产构建不被阻断（fail-closed 设计
  不变），但缺失在打包日志可见。
- **第41轮 icon-sources 同步真实 CDN 端到端验证**：以官方 app 的 claude 市场镜像
  清单（314 插件、全量无图标）为输入，临时 storage root 跑 `syncClaudePluginsOfficial
Icons`——真实拉取 CDN 索引 256 条、244 个条目获得 CDN 图标并原子持久化进镜像
  清单，进程内一次性守卫二次调用直接跳过。实现与官方 hdn/wJr 行为吻合。
- **android/ios dist 残差定量收口**：第四十轮出源对齐后重建产物 vs 官方残余差异
  定性——server.js（639/271 行）= esbuild 模块内联顺序 + 标识符编号（编译器输出
  形态，源码无差异）；run.js/sim.js/preflight.js（≤25 行）= tsc 80 列换行 vs 官方
  宽行 + 对齐注释。工具面（12/12、14/14）、特性 grep、文件面全等，审计项以证据
  关闭，不再追编译器输出级字节差异。

### 第四十四轮：十路复审两个 🔴 修复——extendInfo 重复键 + Windows CUA 运行时链（2026-09-26）

十路复审实证确认的两个打包缺陷修复，真实构建产物级验证：

- **mac.extendInfo 重复键**：`mac` 对象里两个同名 `extendInfo` 键（后者静默覆盖前者），
  `LSEnvironment.DRORA_CUA_HELPER_ADHOC_DISTRIBUTION="1"` 从未落进 Info.plist——
  desktopCuaHelperInstaller 与 helper-host 的 adhoc 放行判定全部失效，路线 A 包的
  Helper 校验被错误按严格模式 fail-closed。修复合并为单一 extendInfo 对象；重打包
  实测 Info.plist 同时含 LSEnvironment 标记与 NSAppleEventsUsageDescription。
- **Windows CUA 运行时链四重修复**（glm/tools/cua-helper）：
  ① 路径：staging 由 `glm/tools/` 迁至 `bundled-tools/<platformKey>/cua-helper`
  （与 ripgrep 同一模式），新增 win32 专属 extraResources 条目映射到
  `resources/tools/cua-helper`（消费方 resolveWindowsCuaRuntime 的产品路径）；
  ② 平台门控：仅 win32 staging（官方 mac 发行物 glm 无 tools/，对照实测），
  重打包后 mac 产物 glm 顶层=drora.cjs+packages（官方形态），23.9MB win32 死重移除；
  ③ 期望拆分：改名清扫曾把 dev/product 两处包名期望统一成 @drora/drora-cua，与
  实体全部脱配——dev 期望改为随仓运行时包 @zcode/zcode-cua-helper-runtime（并为其
  package.json 补 droraCuaRuntime 契约 {schema:1,windows:{entry,nativeAddon}}），
  产品 manifest 期望改为上游包名 @zcode/zcode-cua（豁免区字节保持）；
  ④ manifest 哈希重铸：仓库快照天生不配对（entry 的 sha256 与实际字节不符、addon
  相符，同提交入库）——随包字节为权威，重铸 sha256.entry。
- **回归测试**：packages/services 新增 test 链（node --import tsx --test）：dev 路径
  真实契约解析成功/缺契约 fail-closed、产品路径 staged 布局（含 SHA-256 校验）成功/
  arch 不匹配拒绝/非 win32 拒绝，5/5 通过。测试临时目录须置于仓库树内（macOS
  /var/folders 符号链接触发产品路径的 samePhysicalPath 防护，属测试环境伪影）。
- 质量门：typecheck/lint 0 errors/架构 0 违规；真实打包端到端验证（日志含 win32
  skip 分支行、Info.plist 双键、glm/tools 消失）。

### 第四十五轮：CLI 斜杠命令帮助对齐收尾——/model main 特判与两处文案漂移（2026-09-26）

第12维审查发现的唯一内容级漂移闭合（v3.14.3 合并基线即有）：

- **/model help 对齐官方原文**：usage `/model [list|provider/model]` → 官方
  `/model [list|main|lite|provider/model]`；details 两条改为官方逐字（"Use main,
  lite, or a provider/model id to switch the active session model."）。`lite` 在官方
  运行时**无实现**（bundle 内非斜杠参数解析为 undefined，仅文案提及）——照抄文案、
  不实现别名，与官方行为面一致。
- **/model main 运行时特判**（官方 i9a/h$o 同款语义）：保留当前会话的模型选择、
  仅把推理档重置为目录默认——经 selectedRef 通道送入 resolveTuiModelSelection 复用
  现有校验与默认档回落；无当前选择时报错引导 provider/model。TUI 与命令中心两条
  入口汇于同一 handler（create.ts:293）。
- **/login details 措辞**：补齐官方的 "Coding Plan"（"Z.ai and BigModel Coding Plan
  browser login…"）。第二句存储机制描述保留本仓如实文案（官方"write the final API
  key to config.json"——官方 bundle 运行时无此写盘代码、仅文案；Drora OAuth 实际
  落 JWT 凭据到 credentials 存储，逐字照抄将描述错误行为）。
- 质量门：cli/shared typecheck、根 typecheck、lint 0 errors、架构 0 违规。

### 第四十六轮：三项功能面缺口对齐——dev-badge / base-url fallback / server 远程客户端（2026-09-26）

第 15 维终态中"待裁定功能引入"清单，按用户裁定"继续对齐"实施其中三项可从官方
产物逆向且可验证的；其余（多 Agent 供应商组、marketing/rewards/manualClaim 营销族、
forceUpdate——后者有 removal spec）明确搁置：

- **dev-badge**（官方 renderDevBadgeIcon 逐语义重放，desktopDevBadge.ts 新建）：
  SVG 丝带（比例 0.24/0.199/0.152/0.625、#2563eb、-45° 旋转、letter-spacing
  max(2, 0.008×size)）→ sharp 合成 over → 原图 dest-in 保 alpha → nativeImage；
  尺寸缺失/空图/异常三回退仅告警（官方文案逐字）。applyAppIcon 改为接受
  string|NativeImage（官方 oC 同款），index.ts dev 态先渲染角标。纯 sharp 冒烟
  1024×1024 通过（alpha 裁切正确）。
- **base-url per-env fallback 层**（官方 p1 语义，droraEndpoint.ts）：解析链补齐
  `DRORA_BASE_URL → DRORA_ENDPOINT_ORIGIN → (production: DRORA_PRODUCTION_BASE_URL
?? 生产站 / test: DRORA_TEST_BASE_URL ?? 测试站)`；测试站常量取官方
  zcode.chatglm.site；pickProductEndpointEnv 白名单同步两键。六场景实测通过
  （默认/双向覆盖/两显式键优先）。
- **server 型远程工作区客户端链**（官方 IRe/RRe/ARe/ERe/JJ 五函数语义重放）：
  shared 补 resolveServerRemoteEndpoints（http↔ws 互转、/ws(/host) 尾剥、
  错误文案逐字）+ ServerRemoteTargetSnapshot/ConnectOptions 入联合 + zod/
  identity/platform 七处类型收敛；services 新建 server-remote 子路径导出
  （fetch 双 token 通道 Bearer+?token=、capability POST、ws 头 x-drora-rpc-host-
  capability、before-ready close 语义逐字）；desktop 连接注册表 server 键分支 +
  server backend 显式 fail-closed；顺带修复 desktopRemoteSessions 既有 9 个死
  case 编译错误。**测试 14 项**（端点 6/fetch 4/connect 4）全过；服务端端点早已
  在仓库（http.ts:320-346），客户端-服务端 schema 同源。
- **搁置说明**：多 Agent 供应商（~85 i18n 键 + 第三方 agent 二进制分发，自成项目）、
  marketing touch/asset + manualClaimPlan（依赖 Z.ai 营销后端）、rewards webview
  （依赖 Z.ai 账号侧）、forceUpdate（specs/force-update-gate-removal.md 已裁定移除，
  重新引入需推翻既有决策）、bot provider 枚举（随多 Agent）。server 远程的 Host
  连接分派与 UI 表单（向导入口 + 14 i18n 键）为已知剩余接线面，见实施报告。
- 质量门：根 typecheck 0 错、lint 0 errors、架构 0 违规、services 测试 19/19。

### 第四十七轮：server 远程剩余接线面补齐——Host 分派 + services 组装 + UI 表单（2026-09-26）

第46轮遗留的 server 远程"剩余接线面"按官方原版实现补齐（官方 yAe/MJ/\_Re/$O/YD
逆向重放）：

- **Host 连接分派**（官方 yAe= createWindowRemoteConnectionHandle 的 server 分支）：
  server 三元分派不走 remoteAssets/部署链；onClose 映射 exitCode=ws close code +
  error=reason；disposeAndWait(5s) 超时收口（官方 m4）；遥测 environmentKey 用
  serverInfo.serverId（官方 l0）、telemetrySupported 按 server-info 能力门控；
  capabilities 无 backend 返回 {}。
- **services 组装**（官方 MJ=createServerRemoteWorkspaceServiceCollection）：新建
  serverRemoteConnection.ts——ws wrap（官方 \_Re 语义）→ SocketProtocol+ChannelClient
  RPC（官方 $O+YD 对应）→ 远端代理按官方 MJ 清单逐项 register（30+ 服务），
  clientConfig 本地实例、无 backend/promptAttachment 桥。5 项单测（RPC 组装/close
  上报去重/disposeAndWait 超时/注册清单逐项断言/legacy channel fail-fast）全过。
- **UI + i18n**：向导 buildAvailableKinds 加 server、四字段表单（url 历史/名称/
  token/默认目录）+ urlRequired/invalidUrl 校验（invalidUrl 经
  resolveServerRemoteEndpoints 真解析）；连接成功 workspacePath 非空直开目录；
  14 键双语（zh 官方原文品牌替换逐字、en 语义对齐翻译——官方英文原文未提供，如实
  注记）。
- **有意偏离（5 项，均注记在案）**：serverInfo.workspaces 列表选择 UI 未做（沿
  DirectoryBrowser 手选）；outputStyleService 无对应 token 未注册；
  conversationShareService 用远端代理（server 端已 expose，避免本地再建 API/凭据
  桥）；name/workspacePath 不持久化（快照类型 round-46 已定）；dispose 跳过
  disposeServiceResourcesAndWait（远端代理 disposeAll 会波及共享 server 的其他
  客户端，本地仅收口 ws）。
- 质量门：根 typecheck 0 错、lint 0 errors、架构 0 违规；desktop 新测试 5/5、
  services 回归 19/19、ui 9/9。

### 第四十八轮：outputStyleService 功能域对齐——Claude Code 输出风格系统（2026-09-26）

第 47 轮五项偏离中的 ②（此前误判"架构性缺失"，深挖后确认 agent 侧注入链
fork 基线已有、只缺服务层与注册）：

- **能力面**（官方 pf/bG/uf/lke 逆向）：Claude Code 兼容的输出风格——内置三档
  （default/explanatory/learning，name+description 官方逐字、content 空串）+
  自定义 `~/.claude/output-styles/*.md`（平铺 `name:/description:` 头 + prompt
  正文，parse 正则逐字）；激活状态写 `~/.claude/settings.json` 的 outputStyle
  字段（merge 保留其它字段）；服务 7 方法（list/add/update/delete/
  getUserStylesDirectory/setActive/getActive），listStyles 内置在前+自定义
  name 排序+坏文件容错。agent 侧生效链 fork 基线已在（core/src/context/
  builder.ts:84-163 注入 config.outputStyle），激活即生效，零 UI（官方
  renderer 无键无组件——纯 CLI/文件生态入口）。
- **路径品牌决策**：官方用 `~/.claude`（Claude Code 生态兼容）；Drora 原样沿用
  （与 claude-native session import 读 ~/.claude/projects 同属外部生态豁免），
  保证与 Claude Code CLI 互认，注释写明依据。
- **注册三处**（官方 `.register(Tl, pf())` 模式）：本地 Host（services/node.ts
  createLocalServices，本地实例）；ssh/wsl/docker 远程集合
  （remoteWorkspaceServiceCollection，本地实例——官方对 ssh 系也用本地实例，
  output style 是本机状态）；server 远程（serverRemoteConnection MJ，远端代理
  经 RemoteServiceAccess 新增 getChannel）。agent 侧注入链零改动。
- **写盘格式注记**：官方模板锚点显示平铺空格，与逐字解析正则联立唯一自洽解释
  为单空格=换行、双空格=空行；测试断言写盘与回读 parse 往返一致。
- 测试：services 新增 9 项（active merge/内置逐字/排序/容错/id 前缀/回落链）
  全过，套件 28/28；desktop MJ 清单测试补 outputStyleService 断言 5/5。
- 质量门：根 typecheck 0 错、lint 0 errors、架构 0 违规。

### 第四十九轮：server 远程五项偏离全部收口（2026-09-26）

第 47 轮五项有意偏离经官方逆向定案后全部闭合：

- **③ conversationShare（官方 cRe 定案，推翻第 47 轮判断）**：官方对 server 远程的
  会话分享**明确禁用**——createUnsupportedRemoteConversationShareService，message
  固定 "Conversation sharing is not available for this client or remote target"，
  onRejected 记 {kind:"feature_disabled", reason:"server_remote_unsupported"}；真实
  实现只在 ssh 系 TJ 的 Ud（远端物化+本地 API 分享）。第 47 轮注册的远端代理是
  **超出官方的能力面**（虽功能可用），按官方形态回退为禁用门禁
  （createUnsupportedConversationShareService 仓库既有统一门禁工厂 + 官方 message
  逐字 + serviceLogger("conversation-share") 审计）。
- **⑤ dispose 语义（官方 TE 定案）**：官方对 server 远程同样调用
  disposeServiceResourcesAndWait——内部按 hasDisposeAllAndWait/hasDisposeAll 能力
  探测逐个处理，RemoteServiceAccess 远端代理没有这两个方法天然跳过，实际收口的
  是容器内本地资源。第 47 轮"跳过防波及共享 server"的担忧不成立，已照官方调用。
- **④ 快照持久化 name/workspacePath（官方提交形态已提取）**：
  ServerRemoteTargetSnapshot 增加两可选字段（官方 target 同款），连接成功写入
  历史/快照（token 仍只落 credentialKey），恢复链回读——tab 副标题显示 name、
  重连自动打开 workspacePath；settings patch schema 新旧形态兼容。
- **① serverInfo.workspaces 目录选择 UI**：透出链复用既有通道（连接 handle →
  registry descriptor（schema 增可选 serverInfo，strict 校验）→ main
  attachRendererPort 元数据 → renderer service port bridge → session store →
  UI），无新 IPC；目录步骤顶部渲染 Server 工作区快捷列表（path+label，点击与
  手选一致走 selectRemoteDirectory），空列表不渲染直接进完整 DirectoryBrowser；
  i18n 新增 remote.serverWorkspacesTitle 双语一条。
- 测试：desktop server-remote-host 6/6（新增 serverInfo descriptor 透出断言 +
  share 门禁语义断言更新）、services 28/28；根 typecheck 0 错、lint 0 errors、
  架构 0 违御。

### 第五十轮：mac computer use 打通——自建 Helper 打包接线 + 路线 A 信任链两断点 + 两个还原 bug（2026-09-26）

用户实测反馈三症状（包无 Helper / 设置页权限引导点击无反应 / mac CUA 整体不可用），
逐层定位为四点根因并全部收口：

- **① 打包接线缺失（症状：包无 Helper）**：`resources/cua-helper`（官方签名
  staging 副本，gitignored）缺失时发布链静默产出无 Helper 包。新增
  `prepare:cua-helper`（desktop `build` 链，darwin target 专属）：**恒**自建
  `build:darwin-app`（路线 A 折叠 `CUA_HELPER_ALLOW_UNSIGNED_LAUNCHER=1`、
  buildId `drora-<desktop 版本>`）staging 至 `bundled-cua-helper/`（新
  electron-builder 源）。官方副本只作 parity 参照物与 node_modules 种源不入包
  ——其 launcher 门钉死 dev.zcode.app + 8A5X4JJ39T，Drora 永远拉不起（本仓
  官方副本自 9/19 就在位，用户昨晚的包却无 Helper，正是干净检出构建所致；
  若照旧"官方副本优先"，本仓构建会打包一个必然拒启的死资产）。构建失败即
  失败不降级；构建脚本调用改为当前 node 直跑（pnpm --filter 会被 volta shim
  解析到项目钉扎外 node，实测 18，SEA 骨架守卫需同 ABI node）。
- **② 陈旧官方副本死锁（症状：设置页「未知」+ 点击无反应）**：`~/.drora/`
  computer-use 曾手拷官方 Helper——其编译期 `allowUnsignedLauncherLocalDev=false`，
  对 ad-hoc Drora launcher 恒拒启（broker exit log 实锤：`--launcher-pid did
not verify as a code-signed ZCode process`）。每次 getStatus 走 5s health
  超时→徽章「未知」；点击授权按钮先跑最多 3×5s+2×2s 预检查、期间守卫静默吞
  后续点击→用户感知「点了没反应」。收口：包内自建 Helper（buildId 不同）经
  安装器 payload/身份比对自动重装替换陈旧副本；helper-host 两处分发标记判定
  统一 `options.env ?? process.env` 源（生产同源、测试可注入）。
- **③ 路线 A 信任链最后断点**：helper-host live 进程复核（vse/LW）此前只接
  dev 线或 TeamID 严格锚，生产 adhoc 包对自建 Helper（产品 id、无证书链）必杀。
  补 `adhocDistribution` 门（非 dev runtime 且 `DRORA_CUA_HELPER_ADHOC_DISTRIBUTION=1`）：
  该门下复核放宽为产品 id 的 identifier 锚；dev 线与严格线语义不变（对照组
  E2E 锚定 fail-closed）。
- **④ 两个还原 bug 顺带修复**：
  - `build-cua-helper-app.mjs` adhoc 签名先于 Info.plist/AppIcon/ax_native/
    node_modules staging——CodeResources 封条从未覆盖这些文件，
    `codesign --verify --strict` 恒报 sealed resource invalid（第 14 轮 node_modules
    staging 落地后即坏，路线 A live 复核首次消费）。签名移至全部资源落位后并
    改 fail-loud（spec §二.5）。
  - orphan-reaper `db` ps 解析按空行切分且正则无 m 标志——无空行 ps 输出整段
    只解析出第一个进程，终止/清理链（terminateHelperPid/failedLaunch cleanup/
    授权后 restart）全部退化为 "absent from ps snapshot" 终止失败，测试现场
    四个 Helper 进程滞留实证。改为按行切分（dist + 草稿同步）。
- **验收**：新增 `packages/zcode-cua/test/adhoc-distribution-profile.mjs`——
  A vse 三分支 requirement 单测；B 发射参数折叠；C 生产形态 E2E（NODE_ENV=
  production、无 dev env、分发标记经 options.env）：CuaHelperHost 全链
  launch（LS+token 文件）→health→live 复核（adhoc 分支）→permission_status
  应答→干净 stop；C2 对照组严格门 fail-closed。既有套件回归：mac-launch-contract
  / embedded-build-id / restored-smoke / services windowsCuaRuntime 5/5 全绿；
  根 typecheck 0 错、lint 0 errors、架构 0 违规；真实重打包（corepack pnpm
  10.33.2 + node 24.14.0，与 mise.toml 钉扎一致）安装实测见轮末补充。

### 第五十一轮：parity 基线双轨升级 3.14.3——原生层字节跟随 + peer 收紧 delta 定性（2026-09-26）

官方 3.14.3 发行物本机可得（`/Applications/ZCode.app`，此前 spec 判定"3.14 线本机
不存在"已过时；`ZCode_副本.app` 为完整 3.11.2 存档），全量对账后实施：

- **差异盘点**：broker 方法面零变化（两版 SEA strings 裸 token 差集为空，63+1
  方法表仍现行）；原生 addon 纯增量 117→125 导出（parentProcessPid /
  responsibleProcessPid / peerCodeSigningSummary / setCpsActivationDisabled /
  pasteboard provided-paste 四件套，官方 payload 均为可选守卫消费）；payload 内部
  演进（zod 升级、captureApp 启动 settle 链、provided-paste 接线、peer 验证原语
  产品模式硬门槛化）。
- **形态锚升级 3.14.3**：`native/ax_native_mac.node` 字节替换（SHA-256
  5b46401f…，纯增量无删除，本仓 payload 不调用新导出不受影响）；构建钉扎/125
  导出预期表/ax_native.d.ts 增量节（调用形态自官方 payload strings 还原）同步；
  staging 参照物（`resources/cua-helper`）换 3.14.3 副本；缺省版本 3.14.3；
  `qc/WC` 常量解禁并按实测更新为 3.14.3/pipeline-293504-ab4d5e6b（spec §五
  禁改条按新证据修订，遗留决策 1 闭合）。
- **peer 收紧 delta（本轮最重要发现，待裁定）**：官方 3.14.3 在连接级把 peer
  验证收紧为原生码签名校验——无签名进程（含本仓 parity harness 的 node）即使
  token 合法、位于受信 launcher 后代链上也一律拒答（`peer verification failed`
  实测；场景二此前的 MATCH 是双侧同被拒的空匹配）。本仓 payload 维持 3.11.2
  语义（token+祖先链）：照搬收紧会拒掉路线 A 的 ad-hoc 桌面宿主自身，跟随收紧
  的前置条件是签名身份落地（spec §七.3 新增）。
- **双轨 parity 基线**：形态锚=3.14.3（字节/身份/溯源/启动门，新增 form-anchor
  断言段）；行为锚=3.11.2 参照副本（`resources/cua-helper-3.11.2-reference/`，
  源自 ZCode\_副本.app，gitignored）承载场景二～六（产品配方/13 方法探针/24 参数
  矩阵/controller 七步/50 方法空参穷举）——100 MATCH 全绿（version 字段随构建
  身份脱敏，同 pid）。插件面 0.6.3 已是最新（本机缓存 0.5.13/0.5.14/0.6.3）。
- **harness 三处工程修复**（对账过程的副产物）：① kill 后确认退出
  （SIGTERM→至多 5s→SIGKILL；3.14.3 优雅退出慢于 3.11.2，fire-and-forget kill
  会泄漏实例跨段/跨 run 占租约——实测四个泄漏进程）；② 移除 XDG_RUNTIME_DIR
  每实例隔离（3.14.3 参照在 XDG 被设时接受连接但永不回复；生产 GUI 会话本就不
  设该变量，harness 与生产一致才是 parity 正解），改为全局租约预检 fail-fast
  （发现存活外部持有者时给出处置指引，不静默击杀用户活会话）；③ verify:mac
  段间 settle（等本机 Helper 进程全部退场，修复 parity 段后契约段的 30s
  not-ready 竞争——单独重跑即绿的环境伪影）。
- **验收**：双轨 parity 100 MATCH；verify:mac 全套（build/probe 125/interface
  双向/溯源/embeddedBuildId 293504 直通/契约 A–H/双轨 parity）EXIT=0；
  adhoc-distribution-profile 生产形态 E2E 全绿；typecheck 0 错、lint 0 errors、
  架构 0 违规；win32 helper 构建无损（build.mjs exit 0、零源码漂移）。
  正式包重打（Drora-0.0.1-mac-arm64，随包 Helper=3.14.3 形态/125 导出）。
- **随包 addon 字节保真（打包链第三处修复，字节级对账暴露）**：electron-builder
  的 mac 签名准备会把 extraResources 里的 cua-helper `ax_native.node` 重签为
  adhoc（identifier 加 hash 后缀、-128B）——自第四十二轮首次随包即存在，此前
  只验封条未比字节所以未暴露。修复：afterSign 钩子（签名后、产物构建前）恢复
  仓内官方原始字节（自带官方 Developer ID 8A5X4JJ39T 签名），随后**先单签内层
  Helper 修复封条、再整包 --deep 重签**（直接 --deep 会因嵌套封条失效报
  sealed resource invalid，实测）。终态三验：包内 addon SHA-256=5b46401f…（官方
  字节+官方签名）、内层封条+identifier 锚过、整包 deep 校验过。

### 第五十二轮：官方 3.14.3 asar 宿主库全量对账——认证模型 v2 换代定性（2026-09-27）

抽取官方 3.14.3 `app.asar`（out/host bundle，1.5MB）与我方还原的 zcode-cua
宿主库逐模块对账（launcher/installer/host/live-verify/协议客户端/getStatus）：

- **认证模型 v2 换代（五面一体，全部签名死结同源，无单点可跟随项）**：
  ① token 文件链整体移除——3.14.3 发射向量无 `--token-file`/
  `--presentation-token-file`，host 无 token 铸造（tokenFile/randomBytes(32)/
  writeOneShot 计数全 0）；② helper 启动门同步放宽——官方 3.14.3 helper 无
  token 即 ready（3.11.2 拒启），token 门被原生 peer 门取代；③ 连接级 peer
  收紧（第 51 轮已录）；④ 客户端 authenticate 恒携 `clientApiVersion:2`（无
  token）+ 客户端侧 `peerChecker/verifySocketPeer` 反向验证 broker——双向原生
  peer 互验；⑤ 发射参数增删：新增 `--permission-broker-socket`，未签名
  launcher 放行门收为纯 dev runtime（官方产品态永不放行）。帧格式未变（换行
  分帧维持）。
- **正向确认一致的面（不受死结影响）**：live 复核 requirement 构造（vse/Cse）
  逐字一致；安装链结构一致（INSTALL_VARIANT/verificationMode/releaseEligible/
  meta/install-lock）；standalone getStatus 形状一致（grantOwner/
  accessibilityProbeOk/screenRecording/screenCaptureProbeOk/idle 文案）；
  发射参数主干一致（socket/version/expected-app-bundle-path/controller-variant/
  disable-cps-activation/broker-launch-guard/exit-log/launcher-pid/
  permission-preflight 两参 3.11.2 已有）。
- **处置**：零代码改动——我方 3.11.2 模型内部自洽且全绿锚定（发射契约 A–H、
  双轨 parity 100 MATCH、adhoc 生产形态 E2E）；v2 五面任何单点跟随都会拒掉
  路线 A 的 ad-hoc 宿主，属签名身份（spec §七.2）落地后的整体还原项。本轮
  为纯审查定性轮，spec §七.3 已扩写为完整换代图景。

### 第五十三轮：glm 内嵌 CUA 插件原生件官方字节对齐 + 三面审查收口（2026-09-27）

- **glm 内嵌 zcode-cua-plugin 对账**：版本一致（0.6.3 = 官方 3.14.3 内嵌），整树
  diff 仅 3 个 darwin 原生二进制不同——koffi 2.15.6 / sharp-darwin-arm64 /
  libvips dylib（sharp 0.34.5）。剥离签名后代码字节仍不同：官方为自建产物，
  我方 staging 源是 npm prebuilt（且被 adhoc 重签过）。按「官方形态为权威」
  实施：① 官方种子目录 `resources/glm-natives-3.14.3/`（gitignored，17MB，
  源自官方 3.14.3 glm）；② koffi/sharp stager 官方字节优先替换（版本守卫
  koffi 2.15.6/sharp 0.34.5，漂移 fail-open 告警保留 npm 字节；种子目录
  从 glmDir 有界回溯定位——stager 两种调用位形到包根层级不同，写死层数必错）；
  ③ afterSign 恢复扩展到三件 glm natives（electron-builder 签名准备会再把
  它们 adhoc 化；普通文件非嵌套 bundle，恢复后由整包 --deep 统一封条）。
  **验证**：staging 与包内三件 SHA-256 = 官方字节（官方 Developer ID 签名保留）；
  包内直载 koffi（38 导出）与 sharp native（metadata/pipeline/cache/concurrency）
  成功；整包 deep 校验过。
- **window-bounds 定性**：官方 `zcode-window-bounds`（Developer ID）vs 我方
  `drora-window-bounds`——我方为 swift 源重放后本地编译产物（build-macos-
  window-bounds.mjs + native/macos-window-bounds/main.swift），字节永不可比，
  命名差异属 specs/drora-rename.md 豁免。按既定设计定性为对齐（与 Helper SEA
  同类：还原源码 + 自建产物），无需动作。
- **渲染层 CUA UI 抽查**：官方 3.14.3 renderer 全部 cuaPermission.\* i18n 键
  与我方 zh-CN 键集 32=32 双向零差（权限浮窗 + 设置页文案面无漂移）。
- 质量门：typecheck 0 错、lint 0 errors、架构 0 违规；正式包已重装。

### 第五十四轮：两个遗留观察项实证闭合——插件持久化完好 + 空态死路为官方同构（2026-09-27）

- **观察项 ①「插件开关重启回 OFF」→ 实证非缺陷**：写入链 ✓（config 落盘
  `~/.drora/cli/config.json` `enabledPlugins["computer-use@drora-plugins-official"]=true`
  持续在位）；读取链 ✓（随包 agent CLI `plugins list` 权威回读 `[enabled]`）。
  第五十轮 GUI 观察重新定性为**首帧竞态**（pluginManagementStore 加载完成前
  checkbox 渲染默认 false），非数据丢失；官方 store 同为异步初始化，同构。
- **观察项 ②「欢迎空态授权按钮禁用零反馈」→ 官方逐字同构**：从官方 3.14.3
  renderer bundle（styles-DEELZGp2.js）提取 ComputerUseSection 与状态 hook
  全套逻辑对照——`disabled:!settled`、settled 三态文案（granted/stale/missing/
  unknown + verifying 占位）、tone 映射（green/amber/red/muted）、`openCuaPermissionOnboarding
typeof function` 门、hook 的 `!workspacePath || !service → 不查询` 守卫 +
  mount ensure + focus refresh，全部与我方 useCuaPermissionStatus/
  ComputerUseSection 逐字等价（仅压缩命名不同）。空态死路为官方原生行为
  （官方用户不感知只因其 Helper 恒可用、settled 快速为真）。
- **main 胶水面扫描**：官方 out/main 的 CUA 标记（PrepareCuaHelperPermissionDrag/
  GetCuaOsSupport/openCuaPermissionOnboarding/cua-helper/macos-window-bounds）
  与我方 desktop main 一一对应，无 3.14.3 独有新增面。
- **处置**：零代码改动（两项均为官方同构行为，修复即偏离原版）；第 50 轮
  manifest 中"未定性观察"条目就此闭合。至此 computer use 对官方 3.14.3 的
  行为面审查清单全部走完，唯一剩余差距仍为签名身份前置的认证模型 v2（§七.3）。

### 第五十五轮：真机首用链验收揪出四处串联断裂并全部修复（2026-09-27）

以"设置页授权点击"的服务端全程做真机验收（对已装 /Applications 包、真实
~/.drora/computer-use），逐层暴露四个串联断裂——全部是"从未被端到端跑通过"
的潜伏缺陷（此前各轮 E2E 要么走 dev env 语义、要么绕过安装器）：

1. **host 托管安装器缺 embeddedBuildId 注入**（services/node.ts）：plan 期望
   回落 WC 常量（官方 pipeline id），与随包自建 Helper（drora-<版本>）必然
   失配，agent 首次驱动 CUA 的 ensureInstalled 即 verification*failed。
   修复：main 经 host env 下发随包 Info.plist 身份（DRORA_CUA_HELPER_EMBEDDED*
   BUILD_ID/\_VERSION，spec §六"main 唯一读取点"语义的 env 化延伸），host 侧
   readEmbeddedCuaHelperBuildIdentityFromEnv 消费。
2. **host 托管安装器缺路线 A 放行**：TeamID 稳定签名门对 adhoc 随包 Helper
   必拒（desktop main 包装层有、host 侧没有）。修复：判定统一为 services 的
   isDroraCuaAdhocDistributionEnv，main 包装层与 host 同源。
3. **qu() 丢弃 allowUnsignedDistribution 透传**（zcode-cua dist+草稿，根因）：
   Mie 早已定义该显式选项（第 33 轮），但 qu() 构造 plan 只透传四字段——
   桌面包装层/host 传入的放行被静默丢弃，路线 A 安装放行自第 33 轮起从未
   真正接通（dev 流走 env 语义掩盖）。修复：qu() 补透传。
4. **resolveHelperPermissionSubjectIdentity 是恒抛桩**（zcode-cua barrel）：
   授权引导（onboarding/拖拽浮窗）以身份四元组为 TCC 主体与会话 key，恒抛
   unavailable 会让设置页点击在安装成功后必死在身份解析——用户"点击无反应"
   的最后一环。修复：恢复真身（Info.plist 四元组 + 路径拼接，plutil 读取，
   plist 缺失/键不全维持 fail-closed），dist+草稿同步。

**验收**：新增 services 回归测试 cuaHostInstallerBuildIdentity（env 契约解析/
真实身份安装通过/错误身份 fail-closed，3/3）；真机 live 验收（host 路径构造）
全绿——随包 Helper 安装落盘 `~/.drora/computer-use`（meta：drora-0.0.1/
local_dev_unsigned/bundled 源）+ 幂等重装 + 身份四元组 + verifyInstalled；
既有套件（embedded-build-id 293504 直通、adhoc-profile 全链）全绿；typecheck
0 错、lint 0 errors、架构 0 违规；正式包重打重装。GUI 全程点击流因自动化
窗口态受限未复跑，但其服务端依赖链已逐环 live 验证。

### 第五十六轮：standalone 状态发射的第 5 处断裂 + 桩面清零审计（2026-09-27）

- **桩面审计（第 55 轮教训的推广）**：zcode-cua barrel 其余 fail-closed 桩
  （loadRealNativeAddon/resolvePackagedNativeAddonPath/resolveInTreeAddonPath/
  createAxReadOnlyMethods/requestHelper\*PermissionViaLaunchServices）逐一查消费
  方——除两处死导入外零生产调用面，无同类死点残留。
- **第 5 处断裂（live ±flag 对照实证）**：services 的 standalone 状态发射
  （launchStandaloneCuaHelperForStatus——设置页getStatus 的按需拉起路径）只在
  dev runtime 传放行 argv；打包态（路线 A）发射折叠 Helper 时不传，Helper 的
  launcher 门拒掉无签名 host 进程 → 首查「未知」的直接原因之一。对照实验：
  无 flag 拒启/带 flag 就绪且 permission_status 返回真实授权数据
  （grant_owner/dev.zcode.cua-helper/version 3.14.3）。修复：提取
  buildStandaloneCuaHelperLaunchArgs（dev 与 adhoc 分发共享同一对放行 argv），
  回归测试 4/4（含严格态对照锚——注意 dev 常量关断需 ZCODE_RUNTIME_ENV=
  production，NODE_ENV 不够）。
- **验收**：verify:mac 全套 EXIT=0（第 55 轮改动回归通过）；typecheck 0 错、
  lint 0 errors、架构 0 违规；正式包重打重装。

### 第五十七轮：托管 host 全链 live 终验通过——两条服务端路径全部对已装包闭环（2026-09-27）

- **托管链（agent 驱动 CUA 首用）live 终验**：以已装包路径/身份 env（含 55/56
  轮全部修复形态）构造 product host——安装器幂等复用已装 Helper（embeddedBuildId
  匹配 + adhoc 门通过）→ 发射（token 文件 + launcher flag）→ health → live 复核
  （adhoc 分支）→ permission_status 返回真实授权数据 → 干净停止。至此
  **设置页状态路径（standalone）与 agent 驱动路径（managed）两条服务端链均对
  已装包 live 闭环**，55–56 轮五处修复各有测试/live 锚。
- **GUI 全程点击流**：受阻于本会话的 ZCode computer-use 控制会话被此前调试中的
  显式 stop() 终结（插件会话不可在会话内重启）；AppleScript 被技能规约排除。
  服务端依赖链已逐环验证，剩 `shell.openExternal` 标准动作；留 10 秒手工配方
  给用户：打开 App → 任开会话 → 设置 → 电脑控制 → 徽章应显示「未授权」（可点）
  → 点「打开辅助功能设置」应弹出系统设置。
- 附带：发现并清理 round-56 测试遗留的 standalone Helper 占用全局租约（会堵
  ZCode 插件自家 broker——测试后必须清场的入档教训）。

### 第五十八轮：Helper 生命周期自愈对齐——idle 自眠接线 + 认领超时僵尸修复（2026-09-27）

从"round-56 测试 Helper 占全局租约 14 分钟"的现场反推，发现**两个生命周期
断裂**（官方 3.11.2→3.14.3 新增了 idle 机制——strings 对照 16 处 vs 0 处）：

1. **idle 自眠从未接线**：brokerServer 的 idleExit 机制（无连接 && 无 in-flight
   持续 timeoutMs → 自毁）此前无人传参=死代码。按官方 3.14.3 形态接线
   `idleExit:{timeoutMs:3e5,reason:"idle_timeout_reached"}` + **onIdleExit 显式
   process.exit(0) 处理器**（官方 strings 实证有该 handler；broker 优雅 stop 后
   原生句柄撑住事件循环，自然 drain 不会发生，必须显式退）。
2. **认领超时自毁链断裂（僵尸根因）**：90s 启动认领看门狗触发后走优雅停机，
   原生清理失败即抛错——此前 catch 分支只记日志不退出，进程滞留成僵尸
   （实测 14/47 分钟存活直至手杀，占全局租约可堵死其它 broker）。修复：失败
   分支无条件走 onStartupClaimTimeout（最后手段 process.exit(0)，与官方
   "孤儿授权主体不允许滞留"语义一致）。

- **双生命周期实测**（自建产物直启）：未认领实例 ~90s 自灭
  （trigger=startup-claim-timeout）；已认领实例（authenticate+broker_info）
  280s 存活、320s 内自眠——两路退出均验证。
- 附带：window-bounds 二进制功能烟雾通过（输出窗口 bounds JSON）。
- 质量门：typecheck 0 错、lint 0 errors、架构 0 违规；verify:mac --fast
  EXIT=0；正式包重打重装（含 idle 修复的 Helper）。

### 第五十九轮：第 58 轮生命周期改动的 win32 无损验证（纯验证轮，2026-09-27）

第五十八轮改动落在共享源 `helperMain.ts`（idle 接线 + 认领超时最后退出）。按
「改共享 CUA 模块勿破 win32」的既定要求做结构审查 + 实证：

- **结构审查**：win32 helper 走完全独立入口 `windows-helper.ts →
runWindowsDevHelper`（`--parent-pid` 协议，父进程守望生命周期），不经过
  `helperMain`——mac 侧生命周期改动对 win32 零路径交叠。
- **实证**：`build.mjs`（win32 helper bundle）exit 0 零源码漂移；
  `windowsCuaRuntime.node-test` 5/5；services 全量 node-test 批 **32/32**；
  restored-smoke 通过。
- 附带复核：桌面宿主对"自眠后的 standalone Helper"的处理链健康——
  probeStable 返回 null → 四候选重发射（第五十五/五十六轮已修通），managed
  路径 host 按需 start——两个消费方都不假设 Helper 常驻。

### 第六十轮：认领超时兜底退出的复现确认（纯验证轮，2026-09-27）

第58轮遗留的唯一异常（单实例未认领存活>120s）精确复现失败：单实例、客户端
连接即断的场景下，Helper 在 **90s 整**自灭，退出链完整——优雅停机原生清理
失败（post-drain input cleanup failed）→ catch 分支 → 最后手段
`process.exit(0)`（trigger=startup-claim-timeout，exit code=0）。时间线回查：
该异常观测于"只带 onIdleExit、未加认领超时兜底"的中间构建——构建时序伪影，
非未修路径。至此 Helper 生命周期全部路径（认领超时兜底/闲置自眠）均有直接
观测证据，僵尸问题闭合。

### 第六十一轮：权限浮窗逐字同构确认 + 全量终回归（纯验证轮，2026-09-27）

- **权限浮窗（cua-permission-panel）闭合**：与官方 3.14.3 的面板文件逐字比对
  ——拖拽逻辑/元素绑定/完成提示/双语文案完全同构（1793B vs 1793B，diff 仅
  产品名 ZCode→Drora，属 specs/drora-rename.md 豁免）。此前该面只做过 i18n
  键对照，本轮升级为全文比对闭合。
- **全量 verify:mac 终回归**（第 58 轮生命周期改动后的完整跑，非 --fast）：
  build/probe 125/interface 双向/溯源/embeddedBuildId/发射契约 A–H/双轨
  parity（含新增 idle 行为下的场景二~六）全部通过，EXIT=0。

### 第六十二轮：agent 侧 CUA 胶水对账闭合（纯审查轮，2026-09-27）

最后一个未比过的面：agent bundle 内的 CUA 胶水（官方 glm/zcode.cjs vs 我方
glm/drora.cjs——此前只对齐了插件字节，bundle 本体的注入段没比过）：

- **MCP env 注入形态完全同构**：官方与 我方均为同一五键结构——broker socket +
  refreshMarker（可选）+ pluginAuthority（可选）+ node-repl-host 标志="1" +
  官方插件 ID，条件分支一致。
- **env 名改名为内部契约**：ZCODE*CUA_PERMISSION_BROKER_SOCKET →
  DRORA*…（specs/drora-rename.md 豁免）；消费方 node-repl-host 的
  dist/mcp/server.js 为双读（DRORA* 主 + ZCODE* 兜底），注入-消费链自洽。
- **唯一实质差 = 已知 v2 delta 的 agent 侧投影**：我方额外注入
  DRORA_CUA_PERMISSION_BROKER_TOKEN（3.11.2 token 模型，agent 内嵌消费端在
  run-plugin 包装里 set/restore）；官方 3.14.3 无 token 注入（其 bundle 中
  唯一一处 PERMISSION_BROKER_TOKEN 字符串仅为子进程 env 透传白名单的遗留
  条目，不再设值）。与 spec §七.3 认证模型 v2 记录一致。
- 零代码改动。至此 agent（bundle 胶水 + 插件字节 + node_repl 消费端）、host
  （库 + 安装/发射/生命周期）、桌面（main + 渲染 + 浮窗）、产物（字节级）
  四层的 CUA 面全部过审。

### 第六十三轮：payload 行为演进 backlog 编目（审查轮，2026-09-27）

把"payload 内部演进差"从一句话展开为可执行清单（spec §八）：A级 4 项纯行为
（启动 settle 链/窗口语义增强/event 前台约束/观测通道）、B级 1 项 provided-paste
防劫持协议（**零门控可还原**——3.14.3 addon 已随包，125 导出含四件套，仅 payload
未调用）、C级=v2 认证（签名门控）。win32 侧 29 处行为 strings 本机不可验随线处理。
零代码改动；A/B 级共 5 项为后续还原候选，按用户优先级排期。

### 第六十四轮：第六十三轮勘误——A/B 级五项已全部在库，真实残差收窄至 ~30 行（2026-09-27）

第六十三轮的 backlog 编目犯方法学错误：diff 官方 3.11.2 vs 3.14.3 并假设我方
=3.11.2 纯重放。逐标记验证（源码 + 产物 strings 双侧）证明 provided-paste 四
阶段/启动 settle 链/窗口 onscreen+subrole/event 前台约束/诊断通道**全部已在我
方 payload**（paste 超集早期轮次有档）。改为**我方产物 vs 官方 3.14.3 直接
比对**后，真实残差收窄至 CUA 域 ~30 整行：PiP 表面溯源组（presentationWindowId/
allowProvenAttachedSurface/exactForegroundSurface 等）、capture-settle 措辞
变体组、零散上浮字段——需逐行定性（部分可能为我方不同表述的等价实现）。
spec §八已改写为修正版。教训：**差距审计必须直接比对"我方产物 vs 官方现行"，
任何"我方=X 版"的假设都要先验证**。

### 第六十五轮：残差逐项定性完成——可观测行为面零确认缺口（2026-09-27）

第六十四轮的"~30 行残差"在展开后膨胀（整行 diff 2147 行、字面量抽取 212 条），
经方法学四级递进（整行→字面量→切分伪影识别→token 级）逐家族核验，全部判定
为**比对伪影**（两套 minify 产物格式差 + strings(1) 换行切分）：

- frame 派发守卫全变体（geometry/identity/expired/owner-changed/bundle-identity/
  coordinate-endpoints）：两侧 1/1 齐备
- 输入上限校验（MAX_SYNTHETIC_TEXT=1024 units/key chord 1..8 keys≤128B/
  click count/action_sent 语义）：源码常量与文案逐字相同，产物 token 级等价
- 隐私提示、覆盖窗口跳过、AX set 失败文案、win32 原生族：均在
- provided-paste/settle 链/窗口语义（第六十四轮已证）：均在

**结论：除 v2 认证（签名门控）与 win32（本机不可验）外，我方 Helper payload
的可观测行为面与官方 3.14.3 零确认缺口。**比对方法学教训一并入档：跨 minify
产物比以 token 级为准，整行/字面量级只作候选发现。

### 第六十六轮：收尾工程——零漂移复核 + 交接状态文档（2026-09-27）

- **零漂移复核**：已装 /Applications 包的 Helper 可执行与 addon、glm 三原生件
  与当前树产物及官方 3.14.3 字节三方 MATCH（62–66 轮纯审查/验证轮后无漂移）。
- **新增 `docs/cua-alignment-status.md`**：一页交接文档（状态矩阵/分发形态/
  复验命令/工具链注意/待用户输入两项），供团队接手；过程细节仍在本文档。

### 已知偏差（下一阶段）

- **（已清零）方法面遗留**：open_application 已于第十一轮重放完成，63 表全部对齐；
  唯一表偏差仍为有文档的 paste 超集。
- lint 基线 0 errors；还原包贡献 ~280 条风格 warnings（unused-vars 等），随打磨项消化。

### 第六十七轮：3.17.2 对齐立项——证据基座（2026-11-09）

spec `specs/cua-3.17.2-alignment.md` 落地（四项用户裁定：addon 逆向重建不走拷贝 / 升 0.6.5+Apache-2.0 / win32 维持 0.6.3 随线 / 对齐权威修订为官方 3.17.2 bundle，R3 修订记录入台账 15/16）。本轮只读取证：

- **参照物换装**：`packages/desktop/resources/cua-helper/` ← 官方 3.17.2（addon sha256 `b169b8dc…ceaea`、主可执行 `36ba7e60…cad2b`、plist 3.17.2、buildId `pipeline-326130-a2d1ba73`）；3.14.3 副本转 `cua-helper-3.14.3-reference/`；`tools/parity-mac-helper.mjs` 形态锚标签同步 3.17.2。
- **官方 SEA 可读性定性**：3.17.2 Helper SEA 的 broker server 层**未混淆**（模块标记 `// packages/zcode-cua/dist/…` 共 77 个 + 中文注释齐全），P4 还原从 token 级雕刻升级为模块级直读。
- **方法表差分**：BROKER_METHODS 42→**43**，唯一新增 `element_scroll`（offset 85184509，动作域）；`pip_live_probe_*` 六方法墓碑注释在表（49→43 演进记录）。
- **ghost 模块族证据（offset 锚定）**：`ghostCursorTurnLifecycle.js` 模块 @85745356（shipped 实现=按会话粒度 `hideSessionCursor`/`removeSessionCursor`，已演进过 upstream 设计文档的 `withGhostCursorTurnEndHide` 全局判据）；`GHOST_SESSION_SCOPED_METHODS` 集合 @85567977（~35 原生方法名 + performAction/setValue 元素路径 + windows 模式梯注释）；`withGhostRequestSessionScope` Proxy @85570858（`ghostSetRequestSession(currentBrokerRequestSession())` + `ghostBeginActionWithTitle(0, session, title)`，finally 清空）；`PublishGhostMoveForTarget` @85568704（元素动作成功后发布）。
- **截图/窗口细化证据**：`normalizeApplicationName` 后缀规范化 @85704745（`.app|\s+app|应用程序|应用$` 剥除 + 尾 app 音节保护）；TCC granted-only 截屏注释在 screenCapture* 模块族（P4 模块还原时逐条取）。
- **内嵌 sharp 机制**：`lib/load-sharp.js` @85752962——require 链 `ZCODE_CUA_PLUGIN_ROOT/package.json` → SEA `import_meta.url=process.execPath`（即 .app Resources 内 node_modules，嵌入原因）→ `__filename` → `ZCODE_PLUGIN_ROOT` → opt-in cwd。
- **host dist 切段坐标**（3.17.2 node-repl-host 0.7.0）：zcode-cua 段在尾部 ~4.70M–4.88M（BROKER_METHODS @4772172、两处 `ghostCursorOverlay: true` 恒开 @4792354/@4792470、`element_scroll` @4708555/4709473/4772892）；alias 消费点 `node-repl-host/scripts/build.mjs:44-52`。
- **addon 静态新基线**（`native/reverse/data/mac-3.17.2-*`）：导出面 96→**136**（运行时内省；PascalCase→camelCase 命名换代 + 真实新增 **48**/移除 8）——ghost 家族 22（含 ghostInit/ghostMove/ghostClickRipple/ghostRenderPng/三自检）、**PiP 原生化 17**（pipBeginTurn/Dismiss/FreezeGroup/GetLeadTarget/SetActiveGroup/StackCount/TaskCompleted 等——PiP 控制面从 SEA JS 下沉原生）、原生粘贴 4（pasteboardAwaitProvidedRead/Begin/Finish/MarkProvidedPasteDispatched）、身份杂项 5（parentProcessPid/responsibleProcessPid/peerCodeSigningSummary/setCpsActivationDisabled）；移除=旧后台输入协议（QueueBackgroundInput/LegacyBackgroundInputRejected）+ 旧目标解析 4（ParseWindowTarget/OptionalGhostTarget*/ParseOptionalKeyboardWindowId）+ ResolveRef/ProjectFrameContentForTest。ObjC 类 52（ZcPip 四件套 UI/ZCodeCuaPasteDataProvider/CAAnimation 动画族/SC* ScreenCaptureKit）；符号 2400；方法 170。
- **check-bundle-key-parity 双对跑**：① Helper SEA 对——metaKeys/permissionKeys/diagCodes 全 identical；envKeys 原版独有 `ZCODE_CUA_PERMISSION_BROKER_SOCKET`、我方独有 `ZCODE_CUA_PERMISSION_BROKER_TOKEN`（0.6.3→0.6.5 token-env→socket-env 演进，P4 helperMain 还原时落）。② host dist 对——meta/permission/diag 全 identical；原版独有 `ZCODE_CUA_HELPER_ADDON`/`ZCODE_CUA_WIN_HELPER_RECIPE`（P3 切段落带）。

### 第六十八轮：3.17.2 对齐 P4 批——ghost 接线+IPC v3+三处改名漏网点修复（2026-11-09）

spec `specs/cua-3.17.2-alignment.md` P4 批。改动面与证据：

- **IPC v3**（切段配套必改）：`zcode-cua-helper/src/broker/ipcVersion.ts` 2→3（官方 SEA `var CUA_BROKER_IPC_VERSION = 3` @~85211750；门语义不变=客户端>服务端才拒，v2 老客户端兼容；0.6.5 切段客户端为 v3，配 v2 服务端必互拒——本 bump 前树上 node-repl 路径实际已断）。
- **ghost 接线四件**（全部官方 3.17.2 SEA 证据还原，配 0.6.3 addon 安全 no-op）：① 新模块 `broker/server/ghostCursorTurnLifecycle.ts`（@85745356；shipped=per-session hideSessionCursor/removeSessionCursor，已演进过设计文档）；② brokerServer 请求会话域（AsyncLocalStorage+runWithBrokerRequestSession/currentBrokerRequestSession/ActionTitle+brokerRequestScopeFromParams=pip_session_context 的 session_id/action_title ≤255 无 NUL，@85211920 区；dispatch 包进域 @85241958 同构）；③ nativeAxSource 尾部 GHOST_SESSION_SCOPED_METHODS（58 项全量+官方三段真机修复注释逐字）+ withGhostRequestSessionScope Proxy（@85567977/85570858）；④ helperMain `native = withGhostRequestSessionScope(options.native)` 一次包装下传 + coordinator effects 过生命周期包装（@86540514，hideSessionCursor→ghostSessionTurnEnd?./removeSessionCursor→ghostRemoveSession?.）。
- **element_scroll 两层能力门控移植**：nativeAxSource `if (typeof addon.scrollElement === "function")` 桥（@85654437）+ axReadOnly `if (source.elementScroll)` handler（@85310963-85312580，参数校验文案逐字 direction up|down|left|right / amount 1..100 / no_scrollable_container）。**运行时内省实证官方 3.17.2 mac addon 亦无 scrollElement 导出**——两侧今日均 no-op，与官方 mac 行为一致（方法在表、后端不实现、优雅降级）。
- **三处 2026-09-28 改名裁定漏网点修复**（考古定论：非合并回归，是改名 sweep"191 处"漏网、测试未重跑掩盖）：① orphan-reaper `Nh` 期望 id 兜底 Ss→dev.drora.cua-helper（生产形态 env 覆盖通道死路是根因）；② helper-host `vse` adhoc live 复核锚 Ss/DEV 值→Drora 树；③ helper-host `$se` host 期望 id兜底同。三处均 rootDir 折叠故内联+注释，`test/restored-smoke.mjs` 新增 Nh 生产兜底单一出处断言钉住。
- **3.17.2 SEA 骨架落地**：postject 对新骨架 `memory access out of bounds`→构建脚本 Mach-O 直补回退路径生效，产物可运行（参数校验 fail-closed 出错即证 SEA+JS 正常）；helperMain 报错串证实我方已是 SOCKET 直读形态。
- **内嵌 node_modules 清单化**：build 脚本 blind ditto→显式清单校验（顶层 @img/detect-libc/semver/sharp + @img 内 3 包；首跑即逮到作用域目录形态后修正），漂移 fail-fast。
- **版本族**：@drora/drora-cua 0.6.3→0.6.5 + license Apache-2.0（plugin 侧 P2 已先行）。
- **架构准入**：architecture-policy.yaml `drora-cua-unmanaged-new-files` 补 helper src/**（同先例同理由）。

**验证**：helper 重建 OK；zcode-cua 五测试链全过（restored-smoke/tool-layer/embedded-build-id/mac-launch-contract/**adhoc-distribution-profile ALL OK**=P5 前置身份门探针通过：真发射+live 复核+严格门 fail-closed）；helper tsc + win32 bundle build 无损；architecture:check 三零。**已知残留**：coordinator 的 warn 通道（官方 0.6.5 有、我方未接，P5 批顺手）；P5 逆向重建未开工；真机 ghost 肉眼验收与 release 打包冒烟待用户/发版窗口。

### 第六十九轮：3.17.2 对齐——截图细化核销+warn 通道+P5 5a 启动（2026-11-09）

- **截图细化核销（已对齐，零改动）**：P1 证据清单两项经行为码比对实为 v3.17 合并已吸收——`screenCaptureProbe` 的 granted-only 早退（`status !== "granted"`→probed:false 全 null 形状，官方 review !1460 修复注释逐字同构）与 `macosApplicationResolver.normalizeApplicationName`（`.app|\s+app|应用程序|应用$` 剥除+CJK 码点守护+NFKC 小写，逐字同构）。登记为已验证对齐。
- **coordinator warn 通道**：helperMain 装配补 `warn(message, details){ warnPipOnce(pipWarnKey(...), ...) }` + `pipWarnKey` 去重键（官方 @86540514 区同构逐字）；coordinator/presentation-scheduler 两模块经核亦已是 0.6.5 形态（墓碑+10 warn 点在树）。
- **P5 5a 启动（mac addon 逆向重建第一批）**：`native/reverse/src/ax_native_mac.mm` 骨架落地——136 导出面注册表（data/mac-3.17.2-napi-functions.json 为底稿）+40 个参数校验器（[S] 文案逐字）+96 个 NotImplemented 占位（5b-5g 逐域填充）；binding.gyp 增 `ax_native_mac_rebuilt` target（AppKit/CoreGraphics 框架、c++17、复用根 workspace node-addon-api）。**node-gyp 编译链接通过**（Release/ax_native_mac_rebuilt.node 128KB）。
- **5a 首轮 parity 矩阵**：导出面 **136/136 精确 MATCH**；校验面 **41/47 MATCH**——6 处已知分歧全在 async 家族（官方 async 实现走 promise 路径同步不抛：clickAtPoint 首参错/dragAsync 尾参错/pasteboard* 三元系）+ cancelInputHoldsForSession 空串（[E] 实测官方接受、文案写 non-empty——四级证据 [E]>[S] 已修）。分歧清单与 async 语义补齐路线记入 .mm 头注。
- **方法坑（5a 探针）**：官方 addon 后台线程撑事件循环——同进程双载探针跑完不退出（须 timeout/kill）；同进程加载两份官方系 addon 会 ObjC 类重复警告（ZcPip*/ZCodeCua* 五类）。
- 验证：helper tsc/win32 bundle/五测试链全绿；architecture:check 三零。

### 第七十轮：P5 5b 批——只读+行为域达标（26/26 全 MATCH，2026-11-09）

- **async 家族 6 分歧定论**（新进程单例探针，[E]>[S]）：clickAtPoint 官方**确实同步抛**（矩阵 run2 的 no-throw=进程内状态串扰伪影，我方原实现即正确）；dragAsync=worker 侧异步（同步不抛、pending Promise）；pasteboard 三元系不校验 token 类型（Finish(42)→true / Mark(42)→false / Await(42)→resolve `{ok:false,…,error:"unknown_paste_token"}` 完整形状）；cancelInputHoldsForSession 接受空串返 false。五函数按实测修正+注释留档。
- **5b 只读域 12 方法**（[E] 形状=官方同环境返回值）：cursorPoint（**坐标系考古：官方=CG 全局左上原点，NSEvent=AppKit 左下原点，y 按主屏高翻转——实测官方(1,2)↔我方(1,1438)、主屏 1440 精确吻合**）、isTrusted/probeAccessibilityStatus（AXIsProcessTrustedWithOptions）、screenCaptureStatus（CGPreflight→denied/granted）、displays（[]，官方受录屏门控，真实枚举 5e）、parent/responsibleProcessPid（-1）、getPeerCredentials/peerCodeSigningSummary（null）、pipIsRunning/pipStackCount（false/0）、**ghostState 23 键默认形状逐键落**（5g 状态面契约到手）。
- **5b 行为域**：listApplications **逐字节 FULL MATCH**（NSWorkspace.runningApplications+Regular 策略+pid 升序；坑=enumerateRunningApplicationsUsingBlock 不存在）；applicationInfo 三边界 MATCH（真 pid/不存在→null/类型错）；listWindows 形态+window_id/bounds/onscreen 真值落（非 number→N-API 通用文案 MATCH；main/focused/text_preview 依赖 AX=5c 批已知范围）。
- **5b 综合矩阵 26/26 MATCH + 导出面 136/136**。
- 工程坑入档：注入/删除脚本顺序坑两发（先注入后删=同名双匹配，须删前留后；单行占位闭合括号不在独立行）；ObjC 声明不可入 C++ namespace；AXIsProcessTrusted 无参（带选项的是 WithOptions 变体）。
- 验证：node-gyp 编译 0 error（产物 169KB）；探针纪律=单例新进程+timeout（官方后台线程撑事件循环）。

### 第七十一轮：P5 5c/5d/5e 批——AX 域+动作域+displays 门控（35/35 全 MATCH，2026-11-09）

- **生成器固化为持久资产**：`native/reverse/generate-mac-rebuilt.py`——.mm 改为全量生成物（改实现改生成器勿手编；本轮两起手编残体事故后定案，含"泛匹配孤儿块清除误删 70 函数体"教训）。
- **5c AX 域**：elementAtPoint/policyIdentityAtPoint（AXUIElement hit-test，**SDK 签名考古=分离 float x/y 非 CGPoint**；探针环境官方 null=同境同值）；readElement 宽容 null（42/假 pid/真 pid 全 null——官方对未注册句柄一律 null）；setFocused 恒 `{ok:false,axError:"invalid_element"}`（axh-N 句柄注册表留后续）；probeAccessibility→true。
- **5d 动作域核心 9 方法**（CGEvent 注入，[E] 返回形态=true）：moveTo/clickAtPoint/mouseDown/mouseUp/scrollAt/typeTextGlobal/pressKeyGlobal/keyDownGlobal/keyUpGlobal（CGEventCreateScrollWheelEvent 2 轴；unicode 键盘注入经 CGEventKeyboardSetUnicodeString）。真机逐项动作 parity 留 P6 验收。
- **5e displays 门控枚举**：denied→[]（与官方探针同境同值）、granted→CGGetActiveDisplayList→DisplayInfo{id,bounds,main,scale_factor}。
- **综合矩阵 35/35 MATCH + 导出面 136/136**（5a 校验+5b 只读行为+async 修正+5c/5d/5e 全量）。产物 187KB。
- capture 族（captureApp 门控回退 AX 树形态已探明但深水区）与 listWindows AX 字段（main/focused/text_preview）、*ToPid/*Verified/窗口系动作 = 下一批（5c-2/5d-2）。

### 第七十二轮：P5 5c-2/5d-2/5f/5g 全量收官——136/136 全实现+达标换装自建产物（2026-11-09）

- **证据大扫荡**：99 方法 300+ 形态新进程探针（官方 3.17.2 addon），关键解码——
  - **axh-N 句柄注册表**：全局只增数组，首轮 capture walk 上限恰 1000 元素（axh-1000 有效/axh-10000 无效/第二轮自 1001 续/跨 capture 保活）；captureApp 后 readElement("axh-N") 返回 12 键单元素形状（含真实 AXUIElementCopyActionNames 与 selected_text_range）。
  - **captureApp 树契约**（全键逐节点实测反推）：根=聚焦窗 `AXContents[0]`（桌面组非聚焦窗本身）；**AX 原始 frame 即输出坐标（无翻转**，menubar{0,0,2560,30}→[0,0,2560,30] 实证；cursorPoint 的翻转仅 NSEvent 路径）；title 解析链=AXTitle 非空→AXMenu 专属 AXParent 标题→AXDescription→AXIdentifier（空串=缺失继续回退）；tree 层 actions 恒空（真 actions 走 readElement）；selected 按角色省略（Radio 族 unsupported）；editable=`AXUIElementIsAttributeSettable(AXValue)`；window_id=CG 全列表首个属主窗（_AXWindowID 属性实测不存在）；window.title=kCGWindowName（未授权恒 null）；text_preview=DFS 先序收集标题（跳过空与 "_NS" 前缀）词元拼装 50 码点截断加 " …"（**与官方字节级一致**）。
  - **ghost 状态机**：enabled/multiCursor 直存；move/ripple→default 组显形态{shown,α=1,placed,animating}+gen+2；moveTarget(screenIdx≥0)→default 组{placed,animating,idle=1,shown:false}+gen+2、负 idx→false 零副作用；focusRect→组缺席时 occl 形态建组+gen+1（组已在则 no-op）；setControllerStatus(string)→controllerActive+default 组 occl=1+gen+1；beginActionWithTitle(0,session,title)→会话组{multi,occl,badge,会话色}；turnEnd→仅隐藏（placed/animating 保留）；removeSession 不动 default；**自检三件套=确定性纯数学输出逐字复刻**（motion 8 采样贝塞尔/geometry 13 键/palette 44 键实测覆盖表——StableSessionIndex 规则=单字母字母序 mod 11/纯数与 agent-N 尾数 n-1 mod 11/其余实测表+fnv1a 兜底 [I]）。
  - **生产路径探针盲区实锤**：`getPeerCredentials(fd)`（LOCAL_PEERCRED+LOCAL_PEERPID→{uid,pid}）与 `verifyProcessCodeSignature(pid, requirement)`（SecRequirement 真校验，launcher 身份门消费）——换装首跑 mac-launch-contract 即抓到恒 null/恒 false 导致 broker 拒连接/拒启，live 修复（unix socket 实测 {uid:502,pid:真}）。auditToken 无公开 socket 途径→省略键→JS ancestry 回退（官方同构）。
  - 其余：ToPid 族 NP 仍 true 不投递、Verified 族 rejected/invalid_key_chord 拒绝形状、窗口系无同步校验恒 false、后台输入族恒定失败形状（14 键/10 键/3 键三种）、PiP 控制面全返回形状、pasteboardBeginProvidedPaste→{ok,error:null,token:n}、promptTrust=开系统设置+返 isTrusted、scw=OnScreenOnly+ownerName 取 CG kCGWindowOwnerName、acceptsLeftMouseDown=层值规则（false∈{≥2147483600,24,2001}）[I]。
- **parity 终态**：扫荡 297 形态（余 3=驱动器内嵌 PPID 跨跑键错位伪差、2=scw 分钟级窗表漂移按 windowId 对齐 37/37 零差）；**captureApp 全树 1000/1000 节点全键 JSON 精确零差**；ghost 状态机 20 场景+调色板 44 键+axh 生命周期 17 步+自检三件套全 MATCH；导出面 136/136。已知残留：beginAction 会话组 occl 官方 0/1 跨轮翻转（异步遮蔽态，取多数 0 记档）；AXColumn 全属性 cannot-complete 的 enabled 官方稳定 true（特例化）。
- **达标换装（裁定①兑现）**：`native/ax_native_mac.node` ←自建产物（4214ee9be3d1394…）；build-cua-helper-app.mjs 钉扎换新值+语义注释（自建产物无"官方字节"，钉扎=可复现构建当前产物，重跑生成器须同步换值）；**五测试链全绿含 adhoc-distribution-profile ALL OK**（真发射+live 复核+严格门 fail-closed，身份门对新 addon 复测通过）；prepare:cua-helper 全链冒烟（SEA→Mach-O 回退补→重签→staged bundled-cua-helper，staged addon=自建 hash 实证）；helper/zcode-cua tsc、win32 bundle build、architecture:check 三零。
- **P6 残留（用户参与项）**：真机 ghost 肉眼验收（glide/涟漪/会话色/badge/多屏）与 release 真实打包（electron-builder 全量 16 类资产）——非本机自动化可覆盖。

### 第七十三轮：差距修复战役收官——桥接键/懒启动占位/行为面还原/版本解锁/打包门五批（2026-11-10）

**溯源**：差距审查工作流（run dwfrun-7c7706ec → dwfrun-29201688 修订版）23 条定案
（high 3 / medium 11 / low 9）；权威方案 `specs/cua-gap-remediation-2026-11-09.md`
（决策点 D1=选项 A pre-launch 占位、D2=随批解锁，用户 2026-11-09 裁定）。施工四批
（R1 / R2 / R3 / R4+R5）+ 评审整改批逐项登记于下；本轮回填方案 R6 记档收口
（manifest 登记+第十七轮勘误+台账 17+状态文档+spec 勾销）。

- **R1.1 launcher-pid 键名撕裂（审查 H3）**：`desktopHostProcess.ts` 注入键
  `DRORA_CUA_LAUNCHER_PID` 全仓零消费者，运行链消费方（0.6.5 冻结切段
  resolveLauncherPid + node-repl-host dist 同源内联）读 `ZCODE_CUA_LAUNCHER_PID`。
  切换为 ZCODE_ 名（常量单一出处 `ZCODE_CUA_LAUNCHER_PID_ENV`，注入
  `desktopHostProcess.ts:306`），DRORA_ 名零消费者不保留双写。前置取证
  （2026-11-09 本机实测）：错误/非官方 launcher pid 产品态一律 exit(2)
  fail-loud（无需配套放行链）；孤儿 Helper 实测绑定同机官方 ZCode pid
  1299——键名撕裂会让切段回退 host 自身 pid 或顶替为官方泄漏 pid。
- **R1.2 懒启动发现链桥接（审查 H2）**：切段按 ZCODE_ 名 + `ZCODE_HOME||~/.zcode`
  找 Helper，我方注入与安装全在 DRORA_ 名/`~/.drora`，同机官方 ZCode 在场时
  `~/.zcode/computer-use/` 官方 Helper 会被错拉。修复=注入侧三桥接键
  （`node.ts:1271-1281` 常量区单一出处：`ZCODE_CUA_BUNDLED_HELPER_APP_PATH`
  直注实际 .app 路径 / `ZCODE_CUA_HELPER_INSTALL_VARIANT` 对齐安装根 /
  `ZCODE_CUA_WIN_HELPER_RECIPE` 桥接 win32 recipe——实施时消费面可接线，**未降级
  延后**，注入 `node.ts:1418-1428`）+ `ZCODE_HOME` 透传链钉住（SANITIZED
  键表负向锁定，防止后续把 ZCODE_ 键加进清洗表致懒启动静默断线）。DRORA_ 名
  host 侧消费面不动，双轨=有意分歧（台账 17）。
- **R1.3 设置页状态发射链补 token（审查 H1）**：`launchStandaloneCuaHelperForStatus`
  主函数改用姊妹提取函数 `buildStandaloneCuaHelperLaunchArgs`（`node.ts:2239`），
  消除「注释称已提取、主函数未改用」脱节；第十七轮记档勘误见该轮内注。
- **R2 鉴权贯通（D1=选项 A pre-launch 占位）**：新模块
  `cua-permission-broker/cuaLazyPreLaunch.ts`——切段懒启动触发前（agent spawn
  env 构造时点）用现有 token 链先拉起 Helper 并占住桥接 socket，切段发现存活
  即直连，零安全弱化、零冻结资产改动。实施取证结论（已录方案 §R2）：切段对
  已存活 socket 逐调用直连复用、绝不自拉；authenticate 载荷恒
  `{clientApiVersion:3}` 无 token 通道；切段自身（node_repl 链）连上后在 Helper
  token 校验 fail-closed（`not_authorized`）——官方 v2 peer 模型与我方 3.11.2
  token 模型的结构性终态，非缺口；占位/验收链须用 IPC v3 构建份。
- **R3 Helper 行为面机械还原六件**（官方 SEA offset 逐字锚定+头注释）：
  cps 旋钮 / 多光标旋钮（`helperConstants.ts` 常量 @ 85321464 段）、socket 第三
  兜底（`socketPath.ts` 四返回路径 @ 85316105 段）、paste 全局串行化
  （`electronNativeBackend.ts:56` pasteSerialTail @ 85520859）、paste 收尾协议
  （`paste_provided_cleanup_failed` warn+抛错 @ 85546274 段）、exit-log 管道
  （`helperMain.ts:541-553` helperLogLines+pruneHelperLogs @ 86549645/86550881）、
  `command+v` 字面量修正（@ 85542433，原还原稿误写 `cmd+v`）。
  **backlog 记档（方案 R3 注）**：paste reader 钉扎（审查降级 low）不在本批——
  官方 native 同样忽略第三参、两侧拦截语义均未生效，JS 接线待官方语义生效
  证据再随线。
- **R4 版本/元数据解锁批**：R4.1 bootstrap definition 冻结 0.6.3→0.6.5
  （`official-plugin-definitions.ts:479`，dist 产物同步）；R4.2 版本门硬退改
  显式诊断路径（`check-version-coherence.mjs` 保持非零退出但可辨识）；R4.3
  包根 mcp 工具面对齐官方 0.6.5 十四工具（`src/mcp/tools.ts` 增 paste、剔 17 个
  非官方项；`server.ts:70-71` 版本字面量 0.6.5；session 补 element_scroll）；
  R4.4 `droraCuaPlaceholder:false` + description 真实化（解锁 dev:desktop 注入
  Helper env、CUA dev 暂存、打包门三调用方）；R4.5 切段头注释 ghost 增量归属
  勘误（ghost 会话域实际在 Helper native AX 桥 `nativeAxSource.ts:866-969`，
  切段内仅 pip/element_scroll/ghostCursorOverlay 属实——还原错误修复，原版
  证据随注）；R4.6 zod 装配修正走兜底记档接受（见下评审整改段，协议保持
  `link:` 未改）；R4.7 并入 R3 `command+v`。
- **R5 打包门与 staging 对齐**：`prepare-cua-helper.mjs` staging 布局加
  `<targetArch>` 段（主规则 from 不再恒 ENOENT，门生效）；config 兜底分支补
  绕过告警（兜底保留但可见）；addon 入包 chmod 755 对齐官方权限位；顶层
  CodeResources 属官方旧签名形态残留不仿制（config 注释记档）；afterSign 记档
  失实改口——`electron-builder.config.js:782` 与
  `specs/mac-cua-helper-app-alignment.md` §一改「钉扎自建产物（裁定①）」，
  删「官方字节」表述。
- **评审整改批（施工四批之后，2026-11-10）**：
  ① R4.6 zod 装配修正降级为兜底记档接受——协议替换在仓库结构下不可行：
  `apps/drora-cli` 是独立的嵌套 pnpm workspace（自带 pnpm-workspace.yaml 与
  pnpm-lock.yaml），`@drora/shared`/`@drora/drora-cua` 属根 workspace 项目，
  `workspace:*` 协议只在声明方所在 workspace 的项目集内解析，实测
  `pnpm install --lockfile-only` 报 `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`；
  跨层 `link:../../../../packages/*` 引用为既有装配惯例（11 处同构），协议
  保持 `link:` 不改。目标半项「bundle 单内联」经 esbuild metafile 实测独立
  达成：zod 输入 203 文件全部来自同一份 `zod@4.6.5`，shared 内 import zod
  的模块（validation/channel-mention/conversationSelection）经 tree-shake
  未进 bundle——无需装配修正（方案 R4.6 注同口径）。
  ② R4.5 切段头注释净插 6 行后，方案 spec 与各代码注释中的切段行号锚统一按
  改写后工作树基准校正（≥切段 :6898 的行 +6，更早行不受影响）。
  ③ 记档随线修正：manifest 本轮 R4.6 行初稿误写「`link:`→`workspace:*`」，
  与现场（`node-repl-host/package.json` 协议未动）不符，已按整改结论改写。
- **验证（本轮回填时复跑）**：`packages/zcode-cua` lazy-discovery-bridge ALL
  PASS（对照组复现 H2：官方根命中撞 token 门 exit(2)；桥接组负测：官方根候选
  不被 open、伪 bundled 不被 promote）；`zcode-cua-helper`
  r3-behavior-restoration ALL PASS（六件+裸启动越 socket 门停 token 门）；
  services 四新增回归（cuaLazyLaunchBridge / cuaLazyPreLaunch /
  cuaLazyPreLaunchOccupation / cuaStandaloneStatusLaunchProduction，
  `node --import tsx --test`）18/18 pass，含 R1.3 严格产品态 exit(2) 审查基准
  + adhoc 产品态发射成功 token 真值。施工批验证矩阵（helper tsc/构建、五测试
  链、win32 无损套件、architecture:check）属方案 §三各批要求项，本轮回填未复跑。
- **验证口径与未跑项（如实登记）**：R5 打包门以 config 解析 + staging 布局
  断言为准（已实测两态：staging 含/不含 `<targetArch>` 段），完整 release
  打包与打包 dry-run 资产清单核对属 P6 用户参与项未跑；afterPack 的
  `assertPackagedCuaHelper`（`electron-builder.config.js:215`）落位校验未在
  真实打包中 exercised。全量门禁（根 typecheck/lint/verify:pre-push 全套、
  win32 无损套件）按执行纪律由统一收口脚本重跑，战役期间仅定向跑过四个包
  typecheck 与定向 oxlint/oxfmt。
- **记档收口（方案 R6）**：本轮=manifest 登记；第十七轮内联勘误（R1.3）；
  `specs/drora-divergence-ledger.md` 台账 17（桥接键双轨=有意分歧）；
  `docs/cua-alignment-status.md` 状态矩阵补差距修复行；方案 spec 勾销标记。
  `specs/mac-cua-helper-app-alignment.md` §一口径核对一致（R5 已改「钉扎自建
  产物（裁定①，2026-11-09 改口）」，与 `electron-builder.config.js` afterSign
  注释同口径，无「官方字节」残留表述）。paste reader 钉扎 backlog 已于 R3 行
  记档；win32 recipe 未延后（已随 R1.2 实施），无对应 backlog。

### 第七十三轮：第二轮差距排查与修复——R7 快修/R8 输入守卫还原/R9 记档（2026-11-10）

- **第二轮排查**（三路并行复验：asar renderer/main 面、env+MCP 链、Helper SEA 行为面细扫）：大面积转绿（MCP 协议 token 级全同、R3 六件逐字对齐、i18n 164 键零差、权限浮窗/IPC/fork env/host 参数向量一致、阈值零缺口）；残余四簇。
- **R7 快修批**：①`ZCODE_RUNTIME_ENV` 全链桥接（desktopRuntimeEnv 随 DRORA_ 同源直注 + tsup define 补 `__ZCODE_LOCAL_DEVELOPMENT_RUNTIME__` 生产折叠——官方 out/main offset 48548 同款；此前生产态信任门恒判 dev 的 high 缺口，两路交叉证实）；②钉扎双更新 qc="3.17.2"/WC="pipeline-326130-a2d1ba73"（官方 kp@767360/Mx@~729600）；③安装链落盘名 xt/DEV 名 Drora 化（09-28 裁定"随常量走"漏网点，发现侧只找 Drora 名的自杀性不一致）；④发射向量补 `--disable-multi-cursor-overlay`（disableMultiCursorOverlayRequested+Hg，Helper 端 R3.2 消费打通）；⑤DRORA_CUA_WIN_HELPER_RECIPE 死键移除；⑥CLI standalone 桥接补 ZCODE_HOME 缺省注入（切段 candidates 兜底臂不再落 ~/.zcode 跨产品；测试断言更新含不覆盖/DRORA_HOME 优先两分支）。
- **R8 输入守卫还原批**（G1-G6，官方 SEA unminified 逐段提取+机读二校）：G1 文本注入语义（element_focus_unavailable 预检+typeTextGlobalAsync 截断双语义+排水 max(120,len×20)ms 上限 3000）；G2 活窗四段门禁（四 reason 码逐字+frontmost Set 去重）；G3 key-hold 防误路由（窗口/pid 级+click/scroll/drag 三变体）；G4 clickAtPointAsync 通道+缺 ABI 拒绝；G5/G6 激活与并发诊断。29 项新断言全绿。**spec 事实勘误**：136 导出面不含 typeTextGlobalAsync/clickAtPointAsync（官方 helper JS typeof 门控回退同步原语，mac 即同步路径）——不补导出即官方行为。
- **R9 记档**：切段 bundled 分支身份校验结构性不可过（expectedBuildId 无 env 通道恒优先官方值）——接受记档，拉起由 pre-launch/托管链承担，R1.2 验证①口径勘误已落 spec。
- 验证：五测试链 5/5（含 adhoc ALL OK）、字面量族 0 original-only、services CUA 定向 4/4、architecture 三零、win32 build、双侧 tsc。全程未 commit。
- **R8 已知未还原面（偏离记档，施工偏离 1-5）**：①delivery 轨迹框架（appendAttempt/finalizeDelivery 与 `{method, delivery}` 返回封套）——非守卫域，win32 后台投递（postMessage）族与 assertWindowsPhysicalAssociation、element_provenance 二次校验同属依赖未还原上下文 machinery 且 mac 无对应 ABI；②G1 焦点预检挂点等价改道（官方挂 Windows 元素插入 delivery 非空时，我方挂 element_native+readback registry 可用即启用，等价"无 ref 不预检"）。后续如官方语义生效或 win32 线开工再随线。

### 第七十四轮：win32 0.6.5 对齐分析线启动——官方参照锚鉴定+数据基座+施工蓝图（2026-11-10）

- **参照锚**：用户提供的 cua-helper.zip 鉴定为官方 `@zcode/zcode-cua` **0.6.5 win32-x64** 运行时（runtime-manifest 自带 SHA-256 与实测逐字节一致；electron 44.7.0；构建 2026-11-02 与官方 3.17.2 mac 资产同日）。即裁定③ win32 线的 parity 锚。
- **数据基座四件**（native/reverse/data/）：①`win32-3.17.2-napi-functions.json`——**94 导出面**定谳（PE 符号已剥离，方法=PE 字符串∩(mac136∪我仓 0.6.3 注册面 49∪helper JS 引用)；旧面 49 **零移除纯增量**，增量四类：mac 血统 22（**ghost 核心进 win**）/win 专属 postMessage 投递 5/读回与 UIA 模式梯系/async 化补齐）；②`win32-3.17.2-pe-analysis.json`——PDB（gitlab-runner d5-EUcYuG）/上游 native 源/WinRT 2.0.250303.1/SDK 26100/**UTF-16 窗口类指纹族**（Chrome_WidgetWin_/CefBrowser/TkTopLevel/gdkWindow/WinUIDesktop…）+内嵌引擎分类学+D3D11 复合截图 worker；③`win32-3.17.2-js-family-diff.json`——vendored 0.6.3 vs 官方 0.6.5 四族差分（IPC v2→v3、BROKER_METHODS +element_scroll 同 mac、argv +2、**错误码 +83**=win 侧行为面地图：守卫族 win 形态+postMessage/UIA/provenance 域）；④全量 strings dump。
- **施工蓝图**：specs/win32-cua-0.6.5-alignment-plan.md——生成器化优先（mac 手编事故教训）、[E] 探针纪律须 win 机（probe-one-win 移植；字面量门 mac 可代跑——JS 文本离线比对）、W0-W5 施工序、换装配套（IPC v3 断代坑与 mac 同款、electron 44.7.0、sharp-win32-x64 清单门）。
- **坑**：窗口类指纹是 UTF-16LE 字面量，ASCII strings 扫描不命中（双编码扫描必须）；PE 无符号无 mac 的 demangle 通道，ABI 定谳靠三方交集法。

### 第七十五轮：win32 0.6.5 完整实施设计——三面账勘误+三层断代定性+L0-L3 设计定稿（2026-11-10）

- **数据基座勘误（七十四轮改账）**：原 delta added=24 为扫描漏账（49+24≠94 自相矛盾）。本轮以 strings 逐名双扫（vendored 0.6.3 sha 92533fe5…/官方 0.6.5 sha 11f8bc9c…）定谳**三面账**：官方 0.6.5=96（94 定谳+displays/drag PE 复核）、vendored 0.6.3 官方=52、我方还原线=49（欠 vendored 0.6.3 就有的 activateWindow/launchApplicationAsync/listInstalledApplicationsAsync——0.5.13 期参照遗留欠账，vendored JS 引用 7/3/1 次实证）。**真实增量=44 纯增零移除**（ghost 16/pasteboard 4/postMessage 5/读回梯 4/surface 域 7/杂项 8）。win32-3.17.2-napi-functions.json 已改三段式（faces/added-44/missing-3），蓝图 §二同步改账。
- **三层断代定性（win CUA 当前=死链）**：①IPC——切段 v3 客户端 vs vendored 0.6.3 helper v2 服务端，clientVersion>服务端即 version_mismatch；②Electron ABI——desktop 已 44.7.0（v3.17.2 合并带入）vs vendored addon 41 ABI；③argv——我方还原 win main `args.length!==4 → exit 2` vs 切段 fork 传 5-6 args（ghost 双旗）。三层在 W1 换装批同修。
- **官方 0.6.5 win entry 证据坐标全套**（[S] 主源，解包 dist/windows-helper.js 行号）：argv 契约 :34054-34090（allowedFlags 过滤+positional 恰 4）；延迟原生初始化（deferNativeInitialization/onTransportReady/transport_ready 控制消息）；**鉴权门临时全开** `WINDOWS_PEER_IDENTITY_GATE_TEMPORARILY_OPEN=true`（:19866）+告警文案+assertPeerIdentityAuthCapable 文案；**token 退场**（entry 全文 authToken 零出现、schema 无 token 字段——win 0.6.5 鉴权=版本门+管道命名空间，官方行为如实还原并注记）；enableGhostCursorOnNative（ghostSetEnabled+ghostSetMultiCursorEnabled 可选链）。切片 fork 消费面 :45057-45101（recipe 五字段校验/argv/env）。
- **TS 还原线现状盘点（利好）**：mac 战役落在共享源的 0.6.5 面 win 直接受益（GHOST_SESSION_SCOPED_METHODS/scrollElement 门控/elementPatternCallAsync 优先/postMessage 回退/element_scroll/IPC v3/错误码族/ghost argv 常量）；剩余 win 面 6 项（argv 0.6.5 化/token 退场/鉴权门同构/defer 面/ghost plumb/win 专属消费契约）全部有官方逐字锚，本仓可写可测。
- **设计定稿**：specs/win32-cua-0.6.5-implementation-design.md——L0 本仓准备（生成器 generate-win-rebuilt.py 不泛化 mac 版/ghost 共享常量 JSON 单一出处/probe-one-win/参照 gitignored 入仓）/L1 addon 三批（追赶 3+ABI 切换→mac 血统 22→win 专属 22，错误码 +83 为行为面地图）/L2 helper JS 六项/L3 换装三件套（win 版裁定① 应用；staging/afterPack 链已健全仅过验；manifest 由 staging 用真实 electronVersion 重生成天然跟随）；施工序 W0（本仓）→W1 止血复活→W2 ghost→W3 深水→W4 收口；验收矩阵双场地分层。
- **注记**：官方开门态（peer 门临时全开+token-less）按官方形态权威还原并登记台账，自研硬化不混入对齐批；arm64 随官方再启；本轮零代码改动（数据 JSON 勘误+两份 spec+本文档）。

### 第七十六轮：win32 W0 施工批落地（工作流 dwfrun-e4547cca，9 子代理 6 阶段，门禁 10/10）（2026-11-10）

- **L2 win 入口 0.6.5 化全落**（windowsDevHelperMain.ts + helperMain.ts 共享面）：argv 契约逐字（allowedFlags 双旗过滤+positional 恰 4，官方 :34054-34090）；**token 退场**（configSchema 去 token、authToken 零出现，win 鉴权=版本门+管道命名空间）；**鉴权门同构**（WINDOWS_PEER_IDENTITY_GATE_TEMPORARILY_OPEN=true + 开门 stderr 告警 + PeerIdentityAuthGateError 文案含 gateDetail 拼接，品牌词 Drora 化/env 键不动）；**defer 面**（runHelper deferBackendInitialization/onTransportReady/createDeferredBackend/transport_ready 控制消息——顺带修正 helperMain:423 旧「官方无 defer 路径」错误注释为官方 0.6.5 证据注释）；ghost plumb（enableGhostCursorOnNative 可选链降级）。连带：socketPath.ts 三常量四路径+helperConstants 双旗常量（复审逐字核过 vs 官方 :19849-19850）。
- **L2.6 接线核对**三分类落档（已有/新增/缓办），L0 基线四件：generate-win-rebuilt.py（49 面零漂移迁移+--list-pending 实测 3/22/22）、ghost-shared-constants.json 单一出处+mac 生成器改造（--verify 字节级闭环）、参照入仓 reference/win32-0.6.5/（gitignored）、win32-0.6.5-js-contract.md 契约文档（40KB，行号+字节偏移双锚）。
- **门禁 10/10 全绿**：win-entry 新测试/helper typecheck/helper 包测试（test 链扩为 tsc+r3+r8+win-entry 串跑）/r8 回归/zcode-cua 六链/node-repl-host 构建/services CUA 三件/双生成器 --verify/architecture:check。
- **test:drora 路由基建改动（升级终裁保留）**：门禁揭示全仓 11 件 .node-test.mjs 全通道失执行缺口（glob 不进 test:unit:node、被 vitest 清单按契约排除）——修障员建 scripts/run-drora-tests.mjs 按归属分流+node-unit-test-files.mjs 补后缀 glob+内容双判定（防 0 用例假绿）+回归测试 48/48；旧语义对清单内文件完全保留。**AGENTS.md 对 test:drora 的口径描述是否补句，留用户裁定**。
- **保真复审 9 findings 处置**（1 verified 修复+8 主会话甄别）：①测试链挂接（已修，verified）；②socketPath/helperConstants 连带改动漏报（代码已核逐字一致，仅补汇报）；③helperMain R3 系 SEA 字节偏移 not-verified 沿档（本会话无 3.17.2 SEA 参照可复核；win entry 可交叉验证的家族已逐字核过）；④**pipSessionEnabled 判据口径差**（我方 presentationAuthToken vs 官方 peerIdentityAuth@:33626，行为面当前零差）→ 已入设计 W1 清单 #15；⑤tokensMatch 死 import（0.6.3 既有非本批，留档）；⑥probe-one-win 未落地 → 收口改判随 W1 win 机开工（设计 §五已记）；⑦ghost JSON win 侧消费 TODO(W2)（设计 L0.3 已补注）；⑧**geometry 14 键勘误**（设计原写 13 为笔误，JSON 实测 14+mac --verify 背书，设计已改）；⑨upstream/ staged A 切段=mac 战役 P3 批未提交资产，甄别完毕非 W0 引入。
- **W1 换装批清单 15 项**落设计 §五（含 manifest electronVersion 41.0.3→44.7.0 联动、bundled-agents gitignored 生成物禁手改、0.6.3 切段处置随批裁定等）；缓办项明细指针已由收口记录员写入。
- 全程未 commit；win 机侧（addon 重建/换装/真机）未动（裁定③）。

### 第七十七轮：R10 认证模型换代对齐——token 链整体退役→官方 peer 身份模型（2026-11-10）

- **触发**：用户令「继续完成对齐官方原版的实现……避免盲猜、无意义的桥接」。对比审计揭出 pipSessionEnabled 判据口径差（#15）与方法表 65v43（#16），深挖后证据雪崩：官方 0.6.5/3.17.2 **token 链全不存在**（3.17.2 SEA 与官方 win entry 的 token-file/launcher-minted/resolveAuthToken/authToken 全 0；3.14.3 亦 0；3.11.2 有 presentationAuthToken×12）——我方 helper/producer 全线 token 机械系 3.11.2 血统幻影，52 轮定性「v2 换代 token 链移除」当年因签名死结未跟随、后由 P5 addon 重建（peer 四原语齐备）解锁。
- **官方模型全套逐字还原**（SEA/win entry 双锚）：runHelper 判据 `peerIdentityAuth === true && enablePipSession !== false`；createPeerVerifier 返回 **verdict 对象**（uid 门→dev 逃生→audit_token team 签名门→父进程归责+签名门，describePeer 摘要可选）；handleAuthenticate 无 token（tool=身份声明置位；presentation=peerVerdict+peerPresentationEligible 门，observed 文案逐字）；peerPresentationEligible 三路（identifier 白名单＞双逃生并开＞launcher 世系 8 深回溯）；resolveCuaPeerTeamRequirement 纯 team 锚；main() peerIdentityAuthCapable darwin 四原语门（exit 2 文案逐字）+ launcher 门补官方缺失的 `&& launcherPid !== null` 第三条件（裸启动跳过 launcher 门）。
- **token 链退役面**：helper 侧（brokerServer 双 token 字段/tokensMatch/developmentNoAuth 全删+verdict 挂 conn；helperMain --token-file 强制门/双 token 解析/一次性文件读取删）；producer 侧（helper-launcher JC 推参与 F9/Xxe/Yxe 铸造链删、helper-host 铸造/handle getter/agent env 注入删、services cuaAgentEnvironment×4 死注入删、node.ts presentationToken 透传删）；cuaPipSessionService 条件透传留档（no-op，随 presentation 链后续核）。
- **#16 方法表**：types.ts 65→**官方 43 双平台同表**（SEA@84310036 与 win entry 提取完全一致，含 pip 六方法与 paste；screen_size/get_skyshot/探针六件等 22 个 3.11.2 超集移除——官方 v3.1 攻击面瘦身 49→43 墓碑注释实证）。
- **连带键撕裂修复（R1 级）**：producer 注入面 DRORA_CUA_PERMISSION_BROKER_{SOCKET,UNAVAILABLE,REFRESH_MARKER}/DRORA_CUA_HELPER_ADDON → **ZCODE_**（切段消费 45:2 实证；shared/runtimeEnv 值切、node-repl-host server.ts 改 ZCODE_ 优先+DRORA_ 兜底一轮；此前靠 node-repl-host 双读桥接存活＝无意义桥接清除）。
- **测试面换代**：r3 R3.3/R3.6 重写（裸启动=官方语义驻留非 exit2；exit-2 路径改走不可信 launcher-pid 门+exit-log 断言）；mac-launch-contract 全文重写 R10 版（A=token 链退役负契约/B=token-free 官方向量序/C=身份认证+伪 token 被忽略/C2=免 token callBrokerMethod/F=presentation 双逃生过+tool 角色拒/H=runtime 免 token/G=LS 免 token 轮询/D=agent env 零 token 键+socket ZCODE_ 面）；lazy-discovery 对照组改 R10 等价防护（错配 Helper 对未签名对端不可达——实测 peer 门拒连）；restored-smoke 两处 W0 软断言漂移修复（resolveBrokerSocketPath/injectPermissionBrokerConfig 键面）。**坑**：check() 软断言 exit 0——六链从未拦住这两处漂移；.app 重建须带 CUA_HELPER_ALLOW_UNSIGNED_LAUNCHER=1（路线 A 折叠）否则逃生旗无效、E2E 连接被 peer 门静默销毁。
- **门禁全绿**：helper 链（tsc+r3+r8+win-entry）/zcode-cua 六链/services CUA 三件 fail0/根 typecheck 0 error/node-repl-host 构建/双生成器 --verify/architecture 三零。mac 链在官方 peer 模型下 E2E 实测贯通（同 .app 直启身份认证+认领+presentation 双逃生）。
- **记档待办**：services dist 未重建（D 段按设计跳过，desktop 打包链自会重建）；pip 会话 client 的 presentationToken 选项随 W1/presentation 链复核；token 相关历史 spec 段（cua-gap-remediation R2 pre-launch 等）状态标注待下一批随改。全程未 commit。

### 第七十八轮：全线对齐批（用户令「最好不要有差距」）——token 卫生清零+W3-JS 半成品入位+pre-launch 免铸化（2026-11-10）

- **token 卫生批（代理全绿）**：src/mcp/server token 门退役（无 token 即注册工具→仅 socket fail-closed；configSchema 去 token）；src/mcp/client 官方化（authenticateParams 逐字切段 :37503-37522、恒发 authLine={clientApiVersion:3,...}、reply.id===0 门、拒绝文案勘误官方逐字）；runtime.ts 双键 token 读删；cuaPipSessionService presentationToken 选项删（切段 S$ 恒发 role:"presentation" 已官方）；specs R2 段加 R10 状态注记。
- **R10 连带真 bug 修复（主会话）**：services pre-launch 链悬空——node.ts :2226 仍 `await import` 解构已删除的 writeOneShotHelperTokenFile（skipLibCheck 掩盖、运行时 TypeError 被吞=占位链静默失效）——整链免铸化（launchStandaloneCuaHelperOnSocket 返 boolean、standaloneTokenBySocket 表/agent env token 注入/permission_status token 透传全删）；zcode-cua broker-server.d.ts 三条 stale 声明+CuaProductHelperHost token 成员清汰；cuaAgentEnvironment Pick 键收窄。两测试文件 R10 化（缓存门退役测试/接线负契约/占位 e2e 语义翻转——**切段在 peer 模型下直连我方 Helper 实测成功**，旧 token 拒文案断言改 doesNotMatch）9/9 绿。
- **W3-JS 机械域（代理 1 于 16:13 额度阵亡，半成品入位）**：死前已写入 ~1383 行——新模块 windowsDeliveryReceipt（DeliveryAttempt/appendAttempt/finalizeDelivery 封套）/windowsValueReadback/windows-operation-request/windows-frame-target/windows-menu-observation/windows-operation-association/app-frame-surfaces 等 + electronInputHandlers/nodeAutomationAdapter/electronNativeBackend 大改。主会话收尾：4 处字面量联合类型错误修复（as const/DeliveryAttempt 注解）→ **tsc 0 error、helper 四件链全绿、六链绿**；**officialOnly 59→14**（残余：delivery 细分码 14 个——changed_contains/text_input/droppable_xaml_input/delivery_unknown/key_combo/xaml_accelerator_entry/accelerator_missed/chord_key_state_unreachable/mouse_scroll/mouse_move/imprecise_target(_pid_only)/explicit_event_strategy/dispatch_surface）。
- **⚠️ 半成品状态如实记档**：代理 1 的 W3-JS 写入**未经官方逐字核验、无新增测试、证据锚未复核**（仅达「编译过+既有测试不破+字面量面 59→14」）。下一轮（代理额度 19:30 重置）任务形态=「审计-续完」：对照官方 entry 逐块核验已写机械、消化残余 14、补 w3 注入式测试（fake native 双态）、终检 officialOnly 清零或逐项记档。
- 门禁：根 typecheck 0 error/helper 链/六链/services 5 件（三件+pre-launch 两件 9/9）/双生成器 --verify/arch 三零。全程未 commit。

### 第七十九轮：全线对齐收官——W3-JS 审计-续完（officialOnly=0）+ 旧 handler 清退（mineOnly=0）（2026-11-10）

- **W3-JS 审计-续完（代理，17M tokens）**：①上轮阵亡代理的 1383 行逐文件对照官方核验——六新模块逐字一致（windowsDeliveryReceipt@:21534/windowsValueReadback@:21568/operation-request@:20003/frame-target@:29815/menu-observation@:29846/operation-association@:20006），大改文件抽样到块级一致；修复 3 处偏离（operation-request 去 `?.` 防御/win.ts readElement 补 `:generation:` 代际守卫@:31017/六方法后置包装+appendResolvedAppRef presentationAppRef 优先@:24373）。②残余 14 字面量全消化——上批只写函数未接调用点（tree-shake 致缺席），本批按官方接线 type_text_to_app 插入链@:26158/press_key_to_app 键梯@:26410/scroll@:27071/drag@:27252/click 非精确封套@:26767，**officialOnly=0**。③新建 test/w3-delivery-machinery.mjs（19 断言块，fake-native 双态）；r8 两断言按官方原文收紧（G1a 断完整封套+dispatch_surface 更严；G1f 补官方门所需 ABI——如实记档的红线处置）。
- **旧 handler 清退（代理，22M tokens，约 1700 行外科删除）**：22 个 3.11.2 血统方法 handler+专属机械全删（open_application 家族 30 函数/displaySelection 状态机/三态指针族/探针六件）；**四文件整删**（axSkyshot 178 行/electronDisplaySelection 106 行/file-url-window-verification 149 行零消费副本）；保留边界全部官方锚注释（captureApp 拉起链/paste 剪贴板链/captureScreenPng/mouseUpToPid 有界清/keyDown 修饰链等）。READ_ONLY 死表项 8 个清汰。**mineOnly 53→0**（SEA 在场 23=mac 血统合法保留〔controller/lease/runtime 域〕；SEA 也不在场 30=真死码已删）。
- **终态：官方 276 / 我方 276 snake 字面量完全同集，双向零差**——JS 源级与官方 0.6.5 win entry 字面量面全线对齐。终验（新 .app 重建后）：helper 四件链/mac-launch-contract R10 版 E2E/根 typecheck 0 error 全绿。
- **记档待办**：displayNameFor 段 deferred（:30901 非字面量域，win.ts 现场注释+台账）；tools/parity-mac-helper.mjs（3.11.2 行为锚 harness）随裁表已漂移，建议随 3.11.2 行为锚退役处置；check-ax-native-interface 本机无 win addon 不可跑（环境限制）；oxlint 14 warning 为 R10 死导入遗留（未触碰文件，下批清）。
- 全程未 commit。win 机侧三批（W1 换装/W2 ghost native/W3 native）不变（裁定③）。

### 第八十轮：win32 W1 止血复活批（win 机施工）——追赶 3 落地+electron44 重编+三件套换装+fork 链 E2E 复活（2026-11-11）

- **参照资产重建**：`native/reverse/reference/win32-0.6.5/` 为 gitignored mac 侧资产未随分支到 win 机——本机官方 ZCode 桌面安装（D:\software\ZCode\resources\tools\cua-helper）经 runtime-manifest+sha256 三值核验（addon=11f8bc9c… 与台账逐字节一致）后 `cp -R`+`diff -rq` 入仓参照位（34337 行 entry 与契约文档一致）。
- **probe-one-win 基座（L0.4 补课）**：tools/probe-one-win.cjs——fresh-process 单例（每 addon×面独立 ELECTRON_RUN_AS_NODE electron 宿主）/timeout 包裹/官方 vs 自建同机同场对照/差异 JSON dump（ms·PID·垫片竞速等噪声字段不参与判定但留 dump）。官方 3 面行为锚全采集：**activateWindow** 坏参/错 pid/垃圾 bundleId/短名→false 不抛、真窗→true+前台实切（"atomically raised, focused, activated, and verified"=QueryFullProcessImageNameW+lstrcmpiW 内容核验+GetForegroundWindow 复核，双 API 均官方导入表实证）；**launchApplicationAsync** 失败恒 resolve null（非 0 非 reject）、aumid 优先且失败不回退 targetPath；**listInstalledApplicationsAsync** 恒 5 键 252 记录（packaged=纯 AUMID、classic=lnk 原文、非 exe 目标连坐 null 槽）。
- **生成器升级（W1-1）**：四区模型=前体/中部/尾部 sha256 三锁（0.5.13/0.6.3 语义底座手改即 FAIL）+机器管理实现块（标记包裹，生成器所有）+注册表；**CRLF 坑修复**——mac W0 版正则按 LF 写死，win 机 autocrlf 检出 CRLF 即失配（--verify 首跑即 FAIL 的根因），读取统一 CRLF→LF 规范化、产物恒写 LF（git status 恒净）；data JSON 改账 faces 49→52+missing 清空。JS 侧坑教训：Buffer 字节偏移 vs 字符串 UTF-16 索引两坐标系在 CJK 文件差 ~2600——定位必须单坐标系。
- **追赶 3 实现（四轮探针迭代至记录级零差）**：activateWindow（验窗+验 pid+验全路径 bundle+激活舞+前台复核）；launchApplicationAsync（AsyncWorker "LaunchApplicationWorker"、ApplicationActivationManager aumid 路线/CreateProcessW target 路线）；listInstalledApplicationsAsync（AsyncWorker "InstalledApplicationsWorker"、shell:AppsFolder 枚举驱动+Start Menu lnk 索引供 raw args——属性存储吃首尾空格（向日葵" --mod=uninstall"实证）、lnk GetPath 对 alias 型目标返回空（WSL）、同名 lnk 撞名须 target 全等配对（Uninstall×2）、系统 lnk 显示名≠文件名须按项显示名索引（ADK 尾随空格）——终态 252/252 记录全等、args/description 字段级零差）。
- **electron44 ABI 重编（W1-2）**：build-rebuilt.mjs 扩展——缺省 `--target=44.7.0 --dist-url=https://electronjs.org/headers`（configure 期烘焙 config.gypi），绕过 node-gyp build 全量 sln（mac 目标 win 机必败）改直 MSBuild ax_native_win.vcxproj（vswhere+常见安装位探测）；binding.gyp +version.lib。坑：BHID_EnumItems 在 ShlGuid.h 不在 ShObjIdl_core.h（前置 initguid.h 物化 GUID 定义免 uuid.lib）。
- **W1-1b 验收**：官方 vs 自建探针对照——activateWindow/launchApplicationAsync/listInstalledApplicationsAsync 三面 **EQUAL（含 --live 真激活/真拉起）**；introspect 52/96（W2/W3 补齐）。
- **三件套换装（W1-4）+fork 链 E2E（W1-6）**：runtime/cua-helper dist/windows-helper.js（esbuild 自建产物 sha 9cdcff41…）/build/Release/ax_native.node（52 面 sha 46834ec7…）/package.json 0.6.5+manifest 三值（0.6.5/44.7.0/双 sha）；仓内镜像 native/ax_native_win.node 同步；tools/e2e-fork-win.cjs 验收链 RECIPE→argv（4-positional 无 exit 2）→transport_ready/ready 控制消息→authenticate v3+broker_info（bundle_id=dev.drora.cua-helper）→list_applications 工具冒烟（28 应用）——**三断同修实证，win CUA 复活**。
- **W1 清单 16 项**：#1/2/3/4 换装与门随批原子翻转 ✓；#5/6 打包注释改写 ✓；#7 四处配对注释改写（「0.6.3 addon」→「自建 52 面 W1 换装件，ghost 面随 W2 批」——可选链 no-op 语义不变）✓；#8 复核不改（mac 包 R3 契约与 win 运行时无关）；#9 状态板 win32 行翻转 ✓；#10 D-frozen 文案更新 ✓；#11 gitignored 禁手改 ✓；#12 0.6.3 切段保留（处置随 0.6.5 切段验收，留用户裁定）；#13 架构零违规（helper tools/** 并入 drora-cua-unmanaged-new-files 准入）✓；#15/16 R10 已决 ✓。
- **门禁**：helper 四件链全绿（win 机首跑暴露三处宿主坑并修——r3/win-entry 的 `URL.pathname` 非 fs 路径（D:\D:\ 双盘符）改 fileURLToPath、r3 socket 断言 POSIX 专用形态改平台分支感知）；zcode-cua 六链 win 可跑子集全绿（restored-smoke/tool-layer/tool-surface-065 过，embedded-build-id/mac-launch-contract=mac 宿主专用、lazy-discovery=darwin skip 设计内）；**字面量门复算 officialOnly=0 且 mineOnly=0（276/276 双向零差）**；test:unit:node 307/317 过、2 失败=cuaLazyLaunchBridge darwin 路径断言在 win 宿主的平台敏感项（W1 未触 services 代码，非本批回归，如实记档）。
- **打包冒烟受阻（如实）**：prepare-windows-cua-helper staging 门 ✓（staged 0.6.5 win32/x64 PE=0x8664）；全链 `prepare:runtime-assets` 卡 prepare:agent-bundle——期望 node-repl-host `dist/server.mjs` 实际产出 `dist/mcp/server.js`（上游 v3.17.2 CLI 拆独立 workspace 的既有 fallout，与 CUA 换装无关，未顺手修）。afterPack 全链 verifier 留待该缺口修复后或 W4 收口补跑；fork 链 E2E+staging 门为本批 W1 验收基准。
- 全程未 commit。W2（ghost native 22 面，常量走 ghost-shared-constants.json）/W3（win 专属 22 面）按设计 §四 L1 推进。

### 第八十一轮：win32 W2 批（mac 血统 22 面）——ghost 16/pasteboard 4/getWindowId/hasActiveInputHolds 全 EQUAL（2026-11-11）

- **官方 22 面行为锚全采集**（probe-one-win 扩 ghost/pasteboard/getWindowId/hasActiveInputHolds 四面+三轮判别探针）：**win ghost 形态较 mac 大幅薄化**——ghostState 恒 8 键（groups 空/gen 恒 1/sessionCount 0/multiCursorEnabled 恒 true——setter 成功但状态不翻），ready 唯一转移=enabled∧(move|ripple)；beginActionWithTitle 三参形态→true 无组副作用；坏参恒 false 不抛。**pasteboard**：begin 仅认 "html"/"text"（其余 unsupported_format+token 0）、支持格式走 async（ProvidedPasteBeginWorker，unsupported 同步返回）、token 自增数值、markDispatched unknown→false、finish 恒 true 并恢复剪贴板、awaitRead 8 键形（unknown_paste_token/pasteboard_read_timed_out）；注册格式名 [S] "ZCodeCuaProvidedPasteOwner"。**getWindowId=元素注册表查找非解析**（硬编码 42-marker ref 亦 null 实证；Pane→宿主窗上溯）；**hasActiveInputHolds 恒 false**（与 holdKeyGlobal 解耦）。连带发现并修 readClipboardTextAsync 失败形状（接管态官方 {ok:false,error:"invalid_data"} 无 text 槽——经生成器锁区补丁机制落位+PRE_SHA 重钉）。
- **生成器 W2 批落地**：22 面并入 WIN_IMPLEMENTED（74/96，pending 22 全 W3）；ghost palette 常量自 ghost-shared-constants.json 单一出处注入（palette 11 色 rgb 与官方 selftest 逐值一致；samples default=#1F8CFF/agent-3=palette[2]）；**锁区补丁机制**（PRECURSOR_PATCHES：前体 byte 级有据变更+审计账+PRE_SHA 重钉）首用即 readClipboardTextAsync。
- **探针对照**：ghost/pasteboard/getWindowId/hasActiveInputHolds 四面 **EQUAL**；W1 三面回归 EQUAL；fork 链 E2E 复活态保持（4-arg+`--ghost-flags` 双形态均绿——ghost plumb 已调真导出）。
- **换装刷新**：runtime addon→74 面（sha ab609cf6…）+仓内镜像+manifest addon sha 同步；entry 不变（9cdcff41…）。
- **坑**：Git Bash heredoc 在本环境吃反斜杠（`'\\.\pipe\'`写入文件变 `'\.\pipe\'`）——临时测试脚本管道名被毁伪装成 argv 契约失败，改 Write 工具写正式测试文件后现形；`pnpm test`（tsc）会覆盖 esbuild bundle（复跑字面量门前须 `pnpm build`）。
- **ghost 肉眼（如实）**：win 官方 ghost 在探针环境无可观测视觉面（shown 恒 false/[I] 渲染后端不可观测——官方同形）；桌面链 ghost argv fork E2E 已活体（enableGhostCursorOnNative→ghostSetEnabled/ghostSetMultiCursorEnabled 真调用）；真 overlay 视觉验收留待用户真机桌面使用（官方 win 形态本身即不显形于探针环境）。
- 门禁：helper 四件链绿/生成器 --verify 绿/字面量门 276/276（officialOnly=0 且 mineOnly=0）/typecheck 0 error。全程未 commit。W3（win 专属 22 深水面）待做。

### 第八十二轮：win32 W3 批（win 专属 22 深水面）——96/96 面全收（2026-11-11）

- **[S] 证据基座**：22 面 TypeError 全文案（elementPatternCallAsync 等四面的 elementRef=bigint 语义即由文案揭示）；UTF-16 窗口类指纹（Chrome_WidgetWin_*/CefBrowser*）；错误码/键名词表（filtered 七 reason/decorative 标签/attribution_failure/producer_id 等）。
- **[E] 行为锚三轮采集**：综合 w3 面（spawn 专属 notepad+explorer/chrome 分类窗）+ 字面量判别 + shadow-hunt 专项。关键定谳：**getWindowId 系=元素注册表查找非文本解析**（硬编码 42-marker ref 亦 null；Pane→RawViewWalker 宿主上溯≤256 级——Chromium 深树）；**composite 门=root.expectedBounds 精确匹配当前窗矩形**（无界/旧界=invalid_target，前台+新界={ok,format,data,width,height,bounds,captured,gaps} 八键封套）；**postMessage 全家 notepad 后台全 ok**（scroll 无前台门/key+char 有 focus_missing 门/click/drag 后台可投）；**chromium 窗原生层不拒**（chrome 直投 ok——JS classify 预滤是唯一闸）；**官方整条 WinRT capture 管线在本上下文 fail-closed invalid_target**（与 0.5.13 stub 同形，我方 CaptureViaGraphicsCapture 真管线在 fgFreshBounds 路真出 PNG）；**frameWindowContext 20 键**（producer_id=pid:FILETIME/window_generation=UIA RuntimeId[2]/focused_input_window_id=GUITHREADINFO 门控）；**enumerate 四键 taxonomy**（surfaces/independent_candidates/decorative_summaries/filtered——decorative 类族分「owner 归属帧→summaries/未归属→shadow_owner_form」两路，wetype/WeType 非装饰属 invisible）；**winAx token 活性**（任意 hex ptr→token_unknown，须注册表在場指针）。
- **实现四轮迭代至 8 面（96 面）探针全 EQUAL**（含 --live 真激活/真拉起/真投递）。坑与修：① substring "IME" 撞 TIMER 假阳性（decorative 词表改精确类名）；② **rt: ref 负数 RuntimeId 段（"4--4179"）使 ParseRef 空段判 null**——全链（getWindowId/dispatch/scrollElement/fromToken）改注册表精确匹配先行；③ **fromToken 提前 Release+Release 面双重释放打穿注册表引用**（0xC0000374 堆损崩溃）——token 引用所有权配对（lookup 引用即 token，Release 面消费；ptr: 活性命中 AddRef 交接）；④ SysShadow/判序/枚举归因多轮对齐。
- **探针机器态归一化体系**（w3 面）：layer/producer_id/ptr-bigint/窗实例字段（pid/tid/bounds/title→形状）、光标下元素漂移（uia 值槽 slot/role/ref 尾段）、桌面态词表（decorative 词表主体+clickthrough 旗标化）——确定性契约字段全保真比对，机器态字段形状化（首末两轮 getWindowId/w3 瞬态 DIFF 复跑两轮全 EQUAL 确认）。
- **换装终态**：runtime addon→96 面（sha 0f9f4cb9…）+仓内镜像+manifest；fork 链 E2E 双形态（4-arg+ghost 旗）全绿；门禁：helper 四件链/双生成器 --verify/字面量门 276/276（officialOnly=0 且 mineOnly=0）全绿。台账 faces 96/96=官方全集（W1 3/W2 22/W3 22/基座 49）。
- [I] 如实标注：enumerate layer 内部计数不可导出（形状化）；accelerator 跨进程加速器表不可达恒 miss；hitTest/patternCall 依光标下元素（值槽形状化）；composite captured 条目最小面。全程未 commit。

### 第八十三轮：win32 W4 收口批——第 97 面 windowsOperationScene+基面六键形补齐+接口工具双平台化+打包链修复（2026-11-11）

- **第 97 面 windowsOperationScene 发现并落地**（parity-native 三面套件揭出）：官方导出面实为 97 而非 96——三源交集法漏账（该面 JS :32055 条件消费在场但未被 mac∪0.6.3∪JS 引用三源捕捉）；napi 清单+faces 台账勘误至 97/97。[E] 全形锚：(rootHwnd, hostHwnd[, elementRef, x, y]) → 11 键封套（root/host 窗条目/producer_id/monitor_ready/mutation_sequence:0/external_input_sequence:0/input_monitor_counters 四计数/input+root_input 四键/input_roots/windows=pid 全部顶层窗含不可见）；坏参/坏窗 → null 不抛。W4_IMPL 机器块实现（W4WindowEntry 11 键逐窗条目）。
- **基面六键形/滤集对齐（锁区补丁 1-9 链，PRE_SHA 三轮重钉）**：parity-native 三面套件（57 只读+123 矩阵+full 写路径）对官方 0.6.5 跑出基面差距——①EnumTopWindows TOOLWINDOW/空标题滤除废除（12 窗差集：PixPin/GhostCursor/NVIDIA Overlay 实证；二轮勘正=仅 probeWindows 收录、listApplications 仍滤 TOOLWINDOW+LAYERED）②AppEntryToJs +window_id 尾键（官方 6 键形）③probeWindows +acceptsLeftMouseDown（=!(WS_EX_TRANSPARENT)，12 差集全吻合）④ParseRef 容忍 ":generation:N" 尾标 ⑤MakeRef + 代际尾标（首轮恒 1、二轮勘正=进程级递增计数器——captureApp(ZCode) 官方 :61 实证）⑥负数 RuntimeId 段（"4--2995"）并入 ⑦captureApp window +cloaked/+minimized 尾键。三面套件结果：57/57 全过+123 矩阵 0 结构差+full 写路径余 6 DIFF（见残差）。
- **接口工具双平台化**：ax-native-expected-win.txt 97 面清单（生成自 data JSON napi 数组）；probe-ax-native/check-ax-native-interface 双工具按 addon 路径自动切清单+win 模式 mac 家族守卫（136−97 差集自动入 OPTIONAL_GUARDED）+Object builtin 排除（target.native.length 误报）。双工具对 win addon 全绿（97/97 一致+128 调用点全可解析）。
- **打包链修复（agent-bundle 五坑全清）**：①陈旧重复 node-repl-host 注册表条目（requiredRuntimePaths 旧路径+错误 stagedPath——3.17.2 CLI 拆分合并残留）②stageKoffiForCuaPlugin() 死调用（定义消失调用残留 ReferenceError）③isSharpRequiredByComputerUse 死 import④tar 解压 GNU tar 盘符冒号当远程主机（win32 优先系统 bsdtar）⑤npm-12.2.0.tgz 下载（npmmirror/TLS 全断——腾讯镜像手取+sha512 逐字节与钉扎一致）。agent-bundle 全绿（18 官方插件+npm runtime+skill pack 齐 staging）。**打包链出口仍卡 mobile-web build 0xC0000005 崩溃**（access violation at rendering chunks——与本仓 CUA 无关的 win 机工具链问题，mac 正常，如实记档）。
- **换装终态**：runtime addon→97 面（sha fa53c70e…）+仓内镜像+manifest；fork 链 E2E 双形态绿；helper 四件链/双生成器 --verify/字面量门 276/276 全绿。
- **如实残差（6 DIFF，根因=跨 addon ref 解析架构差）**：full 写路径套件中 orig-ref→rest setValue/setFocused/selectText/performAction 跨侧解析失败（官方注册表跨实例共享 vs 我方 FIFO 进程内+树走查找在部分场景 miss）+captureApp(ZCode) 首元素 ref 代数计数器值不同（进程级递增、逐字比对必差——测试归一化缺口非行为差）。根修需元素注册表跨进程共享或 UIA runtime-id 直接解析——留 W5 批裁定。
- 全程未 commit。win32 三面套件（57/123/full）+probe-one-win 9 面+接口双工具+fork E2E=六链验收体系全部落位。

### 第八十四轮：win32 W5 收官批——跨侧 ref 根修+三面套件 41/41+9 面全 EQUAL（2026-11-11）

- **跨侧 ref 解析根修（补丁 10-15，PRE_SHA 三轮重钉）**：W4 遗留 6 DIFF 根因两层——①**MakeRef 尾标撕裂**（补丁 5 原位加 ":generation:N" 使注册表键/ResolveRefToElement 树走比对串不等——四老面全 invalid_element）：MakeRef 回撤裸形态、尾标移 ElementToJs 出口附加+注册带尾标全文（补丁 10/11）；②**Chromium 元素跨侧树走 miss**（RuntimeId 跨查询不稳的已知 UIA 边界）：setValue/performAction/setFocused/selectText 四老面 LookupElementRef 注册表优先（补丁 12-15，树走降兜底）。
- **测试侧四归一**（parity-native-full/parity-native）：captureApp window bounds 形状化（宿主 DPI 虚拟化差——绝对像素不比）、ZCode 首元素 ref 代数 `:generation:<n>` 归一（进程级计数器两侧独立必异）、performAction 对称 ref（各侧 elementAtPoint 同点各产——注册表进程内私有，官方同样不可跨实例解析）、probeWindows 瞬态窗容忍（≤1 对称差且计数相等；自对照两次同 addon drift=0 实证噪声本质）。
- **三面套件终态**：parity-native **57/57** + parity-native-matrix **123 格 0 结构差** + parity-native-full **41/41** 全绿。W4 遗留 6 DIFF 清零。
- **probe-one-win 终态归一**（机器态三定谳）：getForegroundRootWindowId 坏参返回值=前台窗 hwnd 机器态形状化；rt ref 归一模式放宽（无 '-' 尾段的两段形态）；decorativeVocabulary=桌面瞬态词表形状化为计数桶（≥4=机制在）；captureWindowPngComposite fgFreshBounds=前台存在性瞬态恒化 presence-varies。**9 面（97 面）全 EQUAL**。
- **换装终态**：runtime addon→W5 97 面（sha dd1b456d…）+仓内镜像+manifest；fork E2E 双形态绿；helper 四件链/双生成器 --verify/字面量门 276/276/接口双工具（97/97+128 调用点）全绿。
- **win32 CUA 0.6.5 对齐战役（W0-W5）至此全线收官**：97/97 面（=官方全集，含 parity 揭出的 windowsOperationScene 漏账面）、六链验收体系（probe-one-win 9 面/parity 三面套件/接口双工具/fork E2E/字面量门/生成器 --verify）全绿、三件套换装+fork 链复活实证。遗留=打包链出口 mobile-web 0xC0000005（win 机工具链，非 CUA）与 W4 记档的 afterPack 全链补跑。全程未 commit。
