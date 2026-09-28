# macOS CUA Helper .app 构建对齐 Spec（能力 parity 为唯一目标）

用户决策：完整对齐 ZCode 原版官方 macOS CUA 能力，最终从本仓库打出与原版
**能力完全一致**的 `ZCode Computer Use.app`。本 spec 是产物契约、构建规则、
验收口径与豁免边界的唯一权威。

**状态（第二十三轮）**：代码侧全部完成——方法面（原版 63 + paste 超集）、
发射链（token 文件/参数序/env 白名单）、安装链（embeddedBuildId）、打包形态、
CI 守卫均与原版对齐并有测试锚定；遗留仅 §七 两项（均需用户输入）。

对照基线（parity 参照物）：本机官方 **3.14.3** / buildId `pipeline-293504-ab4d5e6b`
（`packages/desktop/resources/cua-helper/` 的 staging 副本，Developer ID 8A5X4JJ39T 签名）。
第五十一轮（2026-09-26）从 3.11.2/89817f5b 升级：官方 3.14.3 发行物本机可得后全量对账——
broker 方法面零变化（strings 裸 token 差集为空，63+1 方法表仍现行）；原生 addon 纯增量
117→125 导出（新增 parentProcessPid / responsibleProcessPid / peerCodeSigningSummary /
setCpsActivationDisabled / pasteboard provided-paste 四件套，全部为官方 payload 可选守卫
消费，本仓 payload 不调用）；随包常量线 `qc="3.14.3"` / `WC="pipeline-293504-ab4d5e6b"`
（第五十一轮按本机官方 3.14.3 实测值更新，旧值 3.14.0/291084 为无产物可证的中间线）。
payload 内部演进差（zod 校验升级、captureApp 启动 settle 链、provided-paste 接线、
peer 验证原语硬门槛化）如实入档为后续还原项，方法面不受影响。

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
     `3.14.3`（parity 基线，第五十一轮随官方现行线升级）；
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
- 不改 TeamID 钉扎（`8A5X4JJ39T`）、bundle id 白名单。`qc`/`WC` 常量第五十一轮解禁并
  按本机官方 3.14.3 实测值更新（此前禁改因官方 3.14 线本机不可得、无法验证；现产物
  在机，`/Applications/ZCode.app` 随包 Helper Info.plist 即为权威值源）。

## 六、embeddedBuildId 接线（第十二轮实现项）

上游语义：桌面发布构建把自己的 Helper build id **内嵌**在安装期望里，使
"bundled .app 是什么 build" 与 "安装校验期望什么 build" 恒等。开源还原版此线
断裂（三处），行为修复如下；所有权与失败语义：

- **所有者**：桌面 main 进程的 installer 包装层（desktopCuaHelperInstaller）
  是 bundled Helper 身份的唯一读取点；zcode-cua 的 `qu()` 负责把
  `embeddedBuildId`/`version` 透传进默认 plan。第五十五轮补两条：
  main 经 host env（`DRORA_CUA_HELPER_EMBEDDED_BUILD_ID/_VERSION`）把同一身份
  下发给 host 托管安装器（services readEmbeddedCuaHelperBuildIdentityFromEnv），
  host 侧不再回落 WC；`qu()` 同时透传 `allowUnsignedDistribution`（路线 A
  放行此前被静默丢弃，自第 33 轮起从未接通）。授权引导的身份四元组解析
  （resolveHelperPermissionSubjectIdentity）由恒抛桩恢复为 Info.plist 真身。
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

0. **helper 安装根的家目录约定分裂（第二十九轮已按方案 A 实施并落库）**：
   - 安装侧（zcode-cua 豁免区，还原原版语义）：`ZCODE_HOME || ~/.zcode` + `computer-use`；
   - 查找侧（services standalone，Drora 改名形态）：`DRORA_HOME || ~/.drora` + `computer-use`；
   - 桥接：不存在（桌面/服务无人设 `ZCODE_HOME`，zcode-cua 不读 `DRORA_HOME`）。
   净效果：托管路径自洽（装 ~/.zcode、从 ~/.zcode 启动），但与官方 ZCode
   **同根共存**（互相覆盖/构建 ID 冲突隐患）；设置页 standalone 路径枚举
   ~/.drora 永远落空 → 静默失败退化。
   实施记录：方案 A（env 路由）——desktop main 于 fork host 进程时注入
   `ZCODE_HOME=DRORA_HOME||~/.drora`（darwin only），豁免区零改动；
   安装根 ~/.drora/computer-use 与 standalone 枚举对齐，并与官方 ZCode
   的 ~/.zcode 隔离（共存冲突隐患消除）。commit 7952bba。

0a. **无签名分发 profile（用户选定分发路线：ad-hoc + 首次放行；第三十三轮实施）**：
   用户明确无 Developer ID，选定 ad-hoc + 放行脚本分发。实现三处构建期折叠
   （全部 default-off，默认构建语义与原版严格链一致）：
   - helper SEA：`CUA_HELPER_ALLOW_UNSIGNED_LAUNCHER=1` 折叠
     `allowUnsignedLauncherLocalDev=true`（接受
     `--allow-unsigned-launcher-local-dev`，跳过 launcher 签名验证）；
   - 构建签名步骤：exe 与 .app bundle 均以
     `--identifier dev.zcode.cua-helper` ad-hoc 签名——修复路径派生标识
     （`ZCode Computer Use-<hash>`）导致
     `isCuaHelperBundleId(code_signing_identifier)` 恒假的拦截；
   - 桌面/host/安装器：`DRORA_CUA_HELPER_ADHOC_DISTRIBUTION=1`
     （经 dmg 的 LSEnvironment 注入，LaunchServices 发射链与子进程继承）
     → 安装器走 `allowUnsignedDistribution`（local_dev_unsigned 校验）、
     host launcher 传 `--allow-unsigned-launcher-local-dev`。
   安全姿态（如实）：helper 由 token 文件 + peer 祖先链验证守护；放弃的是
   "launcher/helper 必须官方 Developer ID 签名" 的身份链（无 ID 分发的必然代价）。
   正式签名身份到位后：移除三个 env/键即回到严格链。
   用户侧步骤：dmg 安装 → 首次打开右键放行 → 系统设置授予
   辅助功能 + 屏幕录制（ad-hoc 授权绑定 cdhash，更新后需重授）。
   - **第四轮缺口收口（第五十轮）——两处路线 A 断链**：
     a. **打包接线**：发布构建此前仅在 `resources/cua-helper`（官方签名 staging
        副本，gitignored）存在时才 staging，干净检出/CI 静默产出"无 Helper 包"
        （官方发行物恒带）。新增 `prepare:cua-helper`（desktop build 链，darwin
        target 专属）：**恒**自建 `build:darwin-app` 并 ditto staging 至
        `bundled-cua-helper/`（electron-builder 源，gitignored）。官方副本只作
        parity 参照物与 node_modules 种源，**不入包**——其 launcher 门钉死
        `dev.zcode.app` + TeamID `8A5X4JJ39T`，Drora（dev.drora.app）无论
        ad-hoc 还是自有 Developer ID 都永远无法拉起它。折叠：路线 A **默认恒**
        注入 `CUA_HELPER_ALLOW_UNSIGNED_LAUNCHER=1`（自签名签名构建同属路线 A，
        §七.2 2026-09-27 部分裁定——launcher 严格门锚官方 Developer ID，自签名
        无法满足，按 `DRORA_ENABLE_MAC_SIGN` 关折叠会让签名包 Helper 恒拒启）；
        仅 `DRORA_CUA_HELPER_STRICT_CHAIN=1`（Developer ID 落地 + §七.3 v2
        整体还原时）不折叠。buildId 取 `drora-<desktop 版本>`。
        构建失败即失败，不降级出"无 Helper 包"；构建经当前 node 直跑（pnpm
        --filter 会被 volta shim 解析到项目钉扎外 node，SEA 骨架守卫需同 ABI）。
     b. **host live 进程验证分发门**：`helper-host` 对已启动 Helper 的
        codesign 复核（`vse` requirement 构造）此前只认 dev 线
        （`allowAdHocLocalDev && bundle id === dev.zcode.cua-helper.dev`）或
        严格 TeamID 锚——adhoc 包的自建 Helper（产品 id、无证书链）在生产环境
        必被"live process identity verification failed"杀掉。补
        `adhocDistribution` 判定（`!Ps(env) && DRORA_CUA_HELPER_ADHOC_DISTRIBUTION=1`）：
        该门下 adhoc 复核放宽为 `identifier "dev.zcode.cua-helper"`（无 cert
        anchor）；dev 线与严格线语义不变。
     c. **陈旧安装副本替换**：既有安装副本（如手拷官方 Helper）与 bundled
        payload 不一致时（`Hie` 字节比对 / buildId 期望失配），安装器按
        "not usable, reinstalling" 从 bundled 自建产物重装——路由 A 包携带的
        自建 Helper 会自动覆盖历史手拷官方副本（官方副本对 ad-hoc launcher
        恒拒启，不可继续使用）。
     验收：`packages/zcode-cua/test/adhoc-distribution-profile.mjs`——vse 三分支
     requirement 单测 + 生产形态 E2E（NODE_ENV=production、无 dev env、
     `DRORA_CUA_HELPER_ADHOC_DISTRIBUTION=1`，CuaHelperHost 全链
     launch→health→live verify→permission_status，对照组严格门 fail-closed）。

1. （第五十一轮已闭合）版本线钉扎已随本机官方 3.14.3 产物对账升级为
   `qc=3.14.3`/`WC=293504`；下载通道期望与现行官方线一致。
2. 自有 Developer ID + 公证的发布签名身份（含 TCC 重新授权成本）。
   **2026-09-27 部分裁定**：用户选定自签名证书作为桌面 app 主体的过渡发布
   身份（解 Squirrel 自动更新链 + 主 app TCC 持久化，见
   specs/update-feed-github.md「macOS 发布签名身份」）。本 spec 的严格链
   不因此恢复：CUA Helper 的 launcher 门锚定官方 Developer ID +
   TeamID `8A5X4JJ39T`，自签名证书无法满足，路线 A（§七.0a）保持不变；
   Developer ID 仍为待定终态（届时按 §七.3 整体还原 v2 五面）。
3. **官方 3.14.3 CUA 认证模型 v2 代际（第五十一/五十二轮定性，行为 delta 待
   签名身份裁定）**：官方 3.14.3 对 3.11.2 的认证/发射模型做了整体换代，五个
   面一体：
   - **token 文件链整体移除**：launcher 发射向量不再携带
     `--token-file`/`--presentation-token-file`（asar out/host 实证
     tokenFile/randomBytes(32)/writeOneShot 全为 0）；host 不再铸造 token。
   - **helper 启动门同步放宽**：官方 3.14.3 helper 无 `--token-file` 即可启动
     （3.11.2 拒启"requires a launcher-minted --token-file"）；token 门被原生
     peer 门取代。
   - **连接级 peer 收紧**：broker 对连接 peer 做原生码签名校验
     （peerCodeSigningSummary/parentProcessPid 新原语；实测
     `peer verification failed`——无签名进程即使 token 合法、位于受信 launcher
     后代链上也一律拒答）。
   - **客户端协议 v2 + 双向互验**：authenticate 恒携 `clientApiVersion:2`（无
     token）；客户端新增 `peerChecker/verifySocketPeer` 反向验证 broker peer。
   - **发射参数增删**：新增 `--permission-broker-socket`（preflight 模式引用主
     broker）；launcher 未签名放行门收为纯 dev runtime（官方产品态永不放行）。
   本仓 host/payload 保持 3.11.2 模型（token + 祖先链 + 同 UID 外部 peer 需
   dev 门）——模型内部自洽（发射契约/双轨 parity/生产 E2E 全绿锚定），且照搬
   v2 会拒掉路线 A 的 ad-hoc 桌面宿主自身（客户端进程无官方签名）。跟随换代的
   前置条件是 §七.2 签名身份落地（届时需整体还原 v2 五面，非单点）。
   已验证 3.14.3 与本仓一致的面（第五十二轮正向确认）：live 复核 requirement
   构造逐字一致；安装链结构一致（variant/meta/verificationMode/
   releaseEligible/install-lock）；getStatus 形状一致（字段/语义/idle 文案）；
   发射参数主干一致（除上述 token 两参移除与新 preflight 参数）。
   parity 影响：双 broker 行为对比锚定 3.11.2（官方最后一个可质询版本），
   3.14.3 作为形态锚（字节/版本/启动门），见 manifest 第五十一轮双轨基线。

## 八、payload 行为演进残差（第六十四轮修正；第六十三轮编目方法学错误已纠正）

> **第六十三轮勘误**：彼时 diff 的是官方 3.11.2 vs 官方 3.14.3，并假设我方
> payload=3.11.2 纯重放——错。我方还原 payload 早已吸收后续线行为（paste 超集
> 自早期轮次有档；settle 链/窗口语义/诊断通道均在源码与产物中实证存在）。
> 第六十四轮改为**我方产物 strings vs 官方 3.14.3 直接比对**，真实残差如下。

原 A/B 级五项（settle 链/窗口 onscreen+subrole/minimized/event 前台约束/
provided-paste）经逐标记验证（源码 grep + 产物 strings）**全部已在**。

**真实残差终稿（第六十五轮逐项定性完成）**：比对方法学四级递进（整行 diff →
字面量抽取 → 换行切分伪影识别 → **token 级比对**）后，此前 2147 行/212 字面量
的"残差"全部判定为比对伪影（两套 minify 产物的格式差 + strings(1) 换行切分）。
token 级逐家族核验：frame 派发守卫全变体（geometry changed/does not match
frame/live pixel owner/expired before dispatch/closed-moved-changed owner/
stable bundle identity/different live windows）两侧 1/1 齐备；输入上限校验
（UTF-16 units/key chord/click count/action_sent 语义）两侧等价；隐私提示/
覆盖窗口跳过/AX set 失败文案/win32 原生族均在。**可观测行为面零确认缺口**。
- C级不变：v2 认证（签名门控）

**A级——立即可还原（纯 payload 行为，零门控）**
1. `open_application`/`capture_app` 启动 settle 链：`settleFreshlyLaunchedTree(pid, probe)`
   （launch 后轮询 AX 树稳定再返回）、名字→bundle 解析 `resolveApplicationBundleId` +
   失败 reResolve、`[cua-captureapp-launch]` 诊断日志族（LaunchServices 解析/attach 已跑
   pid/后台 launch begin/completed）、capture_app 详版错误文案（含恢复指引）。
2. 窗口列表语义增强：`onscreen`/`subrole`/`minimized` 字段上浮、minimized 窗口
   screenshot_error、overlay 窗口跳过提示（"do not move the skipped overlay windows"）、
   `cloaked`/`minimized` 过滤。
3. `strategy=event` 前台约束详版错误（global input 仅前台生效 + action_sent 状态语义）。
4. 观测面：`diagnostic?.(paste_provided/paste_provided_failed)` 诊断通道、
   `reads_before_dispatch`/`ax_error` 字段上浮。

**B级——立即可还原（依赖 3.14.3 原生导出——已随包！125 导出含四件套，仅 payload 未调用）**
5. `paste` → provided-paste 防劫持协议：begin/awaitRead/finish/markDispatched 四阶段 +
   剪贴板恢复（writeClipboardText(previous)）+ 三类新错误（interrupted=他者接管/
   timed out=app 未消费/take over failed=写入失败，各带 action_sent 语义）。

**C级——签名身份门控（即 §七.3 认证模型 v2，不赘）**

win32 侧另有 29 处行为 strings（windowsScreenCaptureBrokerError 等），本机无官方
win32 产物不可验，随 win32 对齐线处理。
