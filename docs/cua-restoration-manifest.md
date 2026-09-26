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

第46轮遗留的 server 远程"剩余接线面"按官方原版实现补齐（官方 yAe/MJ/_Re/$O/YD
逆向重放）：

- **Host 连接分派**（官方 yAe= createWindowRemoteConnectionHandle 的 server 分支）：
  server 三元分派不走 remoteAssets/部署链；onClose 映射 exitCode=ws close code +
  error=reason；disposeAndWait(5s) 超时收口（官方 m4）；遥测 environmentKey 用
  serverInfo.serverId（官方 l0）、telemetrySupported 按 server-info 能力门控；
  capabilities 无 backend 返回 {}。
- **services 组装**（官方 MJ=createServerRemoteWorkspaceServiceCollection）：新建
  serverRemoteConnection.ts——ws wrap（官方 _Re 语义）→ SocketProtocol+ChannelClient
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

### 已知偏差（下一阶段）

- **（已清零）方法面遗留**：open_application 已于第十一轮重放完成，63 表全部对齐；
  唯一表偏差仍为有文档的 paste 超集。
- lint 基线 0 errors；还原包贡献 ~280 条风格 warnings（unused-vars 等），随打磨项消化。
