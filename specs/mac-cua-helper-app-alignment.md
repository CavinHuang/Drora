# macOS CUA Helper .app 构建对齐 Spec（能力 parity 为唯一目标）

用户决策：完整对齐 ZCode 原版官方 macOS CUA 能力，最终从本仓库打出与原版
**能力完全一致**的 `ZCode Computer Use.app`。本 spec 是产物契约、构建规则、
验收口径与豁免边界的唯一权威。

**状态（第二十三轮）**：代码侧全部完成——方法面（原版 63 + paste 超集）、
发射链（token 文件/参数序/env 白名单）、安装链（embeddedBuildId）、打包形态、
CI 守卫均与原版对齐并有测试锚定；遗留仅 §七 两项（均需用户输入）。

对照基线（parity 参照物）：本机官方原版 3.11.2 / buildId `pipeline-277386-89817f5b`
（`packages/desktop/resources/cua-helper/` 的 staging 副本，Developer ID 8A5X4JJ39T 签名）。
仓库内嵌常量 `qc="3.14.0"` / `WC="pipeline-291084-a1328db1"` 指向的官方线本机不存在，
不作为本轮 parity 参照（见「遗留决策」）。

## 一、能力一致的定义（分层）

| 层 | 一致口径 | 依据 |
| --- | --- | --- |
| 原生层（ax_native） | **字节级一致**：构建直接复用仓库内原版二进制 `native/ax_native_mac.node`（SHA-256 与官方 .app 内 `Resources/ax_native.node` 相同） | 117 导出面 + `check-ax-native-interface` |
| TS payload（helper 主体） | **行为一致**：`src/helper-sea-entry.ts` → helperMain 的还原实现，经双 broker 对比验收（见第四节） | 复原清单 + 本 spec 新增 mac parity 工具 |
| App 形态 | **结构一致**：Node SEA 单可执行 + `Resources/ax_native.node` + Info.plist 键集与原版相同（值允许按构建身份不同） | 构建脚本 |
| 签名身份 | **允许不同**：dev 构建 ad-hoc；发布构建用自有 Developer ID + 公证。签名身份不同必然导致 TCC 授权主体不同，属产品决策而非能力差异 | — |

## 二、产物契约（构建输出 `dist-cua-helper/ZCode Computer Use.app`）

1. `Contents/MacOS/ZCode Computer Use`：以骨架（优先级：`NODE_SEA_SKELETON` env →
   仓库 staging 的原版可执行 → 本机 node）注入 SEA blob（`helper.cjs`，esbuild
   CJS/minify/target node24，external `sharp`/`koffi`/`ax_native.node`）。
   - 全新 node 骨架必须熔丝：postject 追加
     `--sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`；
     复用原版 helper 可执行作骨架时已熔丝，不得重复传参（postject 对已含
     NODE_SEA 段的骨架用 `--overwrite`）。
   - arm64 注入后必须重签（ad-hoc 兜底已存在；`CODESIGN_IDENTITY` 时深签整包）。
2. `Contents/Resources/ax_native.node`：darwin 一律取 `native/ax_native_mac.node`
   （历史 bug：脚本曾引用不存在的 `native/ax_native.node`，win32 路径不变）。
3. `Contents/Resources/node_modules`：**staging 官方 seed**（第十四轮按用户裁定
   改齐原版打包形态；此前曾裁定不装）。来源：官方 staging 副本
   （desktop/resources/cua-helper）的 Resources/node_modules（darwin sharp
   四件套，≈16MB），`ditto` 保元数据拷入；副本缺失时跳过并告警。
   功能注记（如实）：helper 内 sharp 唯一消费者是 linuxWindowCapture
   （`process.platform === "linux"` 平台门），SEA require 解析链
   （`Contents/MacOS` 向上）不含 `Contents/Resources` 子目录基，
   load-sharp 各解析基（原版 mac 4 基 / win32 0.5.13 五基，均无 Resources）
   也不可达——mac 上为非功能资产，staging 属打包形态对齐而非能力项。
   load-sharp 基差异为官方两产物线演进差（win32 0.5.13 字节在仓可证），
   helper src 保持与 win32 官方一致的 5 基形态，不回退。
4. `Contents/Info.plist`：键集与原版一致；值规则——
   - `CFBundleShortVersionString`/`CFBundleVersion`：env `CUA_HELPER_VERSION`，缺省
     `3.11.2`（parity 基线）；
   - `ZCodeCUAHelperBuildId`：env `CUA_HELPER_BUILD_ID`，缺省 `local-dev`；
   - `CFBundleIdentifier` 恒 `dev.zcode.cua-helper`（校验链白名单成员，不改）；
   - `LSUIElement` true、`NSAppleEventsUsageDescription` 与原版逐字一致。
5. 失败语义：addon / 骨架缺失、SEA blob 超出骨架段容量即构建失败（不降级、不静默跳过）。

## 三、构建命令

```
pnpm --filter @drora/drora-cua-helper-runtime build:darwin-app
```

## 四、验收（全部执行、报告真实结果）

1. **溯源冒烟**：产物二进制跑 `--cua-helper-provenance-smoke`，退出码 0，输出
   arch/modules/version/bundleId 与 Info.plist 一致。
2. **原生接口**：`tools/probe-ax-native.mjs <产物>/Contents/Resources/ax_native.node`
   → `exports: 117 PROBE OK`；`tools/check-ax-native-interface.mjs` 双向无漂移；
   构建期钉扎官方 3.11.2 基线 SHA-256（`build-cua-helper-app.mjs`，升级需显式
   更新基线常量或 `CUA_NATIVE_ADDON_SHA256` 审计覆盖）。
3. **双 broker parity（`tools/parity-mac-helper.mjs`）**：
   场景零 .node 字节级对齐（产物 vs 官方参照物 SHA-256 逐字节一致）；
   场景一 unsigned launcher 双侧 fail-closed；场景二产品配方（ZCode 桌面 main 为
   launcher + 后代 peer + 一次性 token-file）authenticate / broker_info / 坏 token；
   场景三 13 方法空参探测矩阵（错误码/归一形状），全部要求 MATCH、无预期差异。
   租约以 XDG_RUNTIME_DIR 每实例隔离（darwin 全局 /tmp/zcode-cua-<uid> 会产生
   顺序伪影）。只读安全面，不注入输入、不激活应用。
4. **安装验收**：
   - release 链（embeddedBuildId 接线后为主路径）：桌面包装层读 bundled
     Info.plist 身份 → `createCuaHelperInstaller` 装入临时 `ZCODE_HOME`，
     `verificationMode:"release"`/`releaseEligible:true`/meta 全对/幂等
     （`packages/zcode-cua/test/embedded-build-id.mjs`）；
   - dev 链（`ZCODE_CUA_HELPER_ALLOW_UNSIGNED_LOCAL`）：自建 adhoc 产物走
     `local_dev_unsigned`，为无官方签名产物时的开发路径。
5. **一键 runner**：`pnpm --filter @drora/drora-cua-helper-runtime verify:mac`
   （`--fast` 跳过重建）串行执行本节全部验收；`tools/verify-mac-alignment.mjs`
   任一段失败非零退出，官方 staging 资产缺席段自动跳过。

## 五、边界与豁免

- `packages/zcode-cua-helper`、`packages/zcode-cua` 为还原权威区（见
  `specs/drora-rename.md` 豁免 2）：**行为对齐类改动允许进入 `src/`**（方法表
  重放、发射链 token 模式等，逐轮入档 manifest 第 10–21 轮），但必须以官方
  blob/asar 雕刻为底稿并注明证据坐标；纯品牌改名（ZCode→Drora）沿用
  `specs/drora-rename.md` 豁免语义。`load-sharp` 经审计保持与 win32 官方一致
  的 5 基形态（两产物线演进差，见 §二.3），不得"顺手改齐" mac 4 基旧形态。
- 不改 TeamID 钉扎（`8A5X4JJ39T`）、bundle id 白名单、`qc`/`WC` 常量。

## 六、embeddedBuildId 接线（第十二轮实现项）

上游语义：桌面发布构建把自己的 Helper build id **内嵌**在安装期望里，使
"bundled .app 是什么 build" 与 "安装校验期望什么 build" 恒等。开源还原版此线
断裂（三处），行为修复如下；所有权与失败语义：

- **所有者**：桌面 main 进程的 installer 包装层（desktopCuaHelperInstaller）
  是 bundled Helper 身份的唯一读取点；zcode-cua 的 `qu()` 负责把
  `embeddedBuildId`/`version` 透传进默认 plan。
- **读取方式**：installer 创建时对 bundledAppPath 执行
  `plutil -extract <key> raw`（darwin + 打包态 + bundled 路径存在才读）；
  读取失败/键缺失 → 字段缺省 → 回退既有 `WC` 钉扎（不阻断安装，最坏退回
  现状）。不缓存、不在 renderer、不走 IPC。
- **`qu()` 透传**：默认 plan 构造补 `embeddedBuildId`/`version` 两个入参；
  显式 `plan` 注入路径不受影响。
- **`Oie()` dev 覆盖死代码修复**：`t.trim() || n` → `n || t.trim()`——
  dev runtime（`bn()` 为真）下 env 覆盖优先生效；打包态 `bn()` 恒假，
  行为与原版发行构建逐字一致（原版把 dev 常量折叠为 false，env 本就不可达）。
- **验收**：桌面包装层对官方 staging .app（3.11.2/277386）走 release 校验链
  安装到临时 `ZCODE_HOME`：`verificationMode:"release"`、`releaseEligible:true`、
  `meta.buildId === pipeline-277386-89817f5b`、幂等重装；测试落
  `packages/zcode-cua/test/embedded-build-id.mjs`。
- **不做**：TeamID 钉扎改集合、`qc="3.14.0"` 常量变更（bundled 源跳过版本
  比对，`qc` 仅影响 meta.version 展示，现由真实版本注入覆盖）。

## 七、遗留决策（已向用户报告，未获批不动）

1. `qc=3.14.0`/`WC=291084` 钉扎与本机可得官方 3.11.2/277386 的版本线错位——
   需上游 3.14 产物或改钉扎决策（bundled 安装已被 §六接线消解，仅
   下载通道仍受影响）。
2. 自有 Developer ID + 公证的发布签名身份（含 TCC 重新授权成本）。
