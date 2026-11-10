# CUA 全量对齐官方 3.17.2 实施规格

- **状态**：已批准实施（用户 2026-11-09 四项裁定，见 §2）
- **对齐权威**：官方 ZCode 3.17.2 安装包（本机 `/Applications/ZCode.app`）
- **关联**：`specs/drora-divergence-ledger.md` 台账 15（Helper 身份常量，权威不变）、台账 16（本役新登记）；`specs/drora-rename.md`（改名规则与豁免区不变）；`docs/cua-restoration-manifest.md`（轮次登记）；`specs/upstream-v3.17.2-migration.md`（R3 原裁定出处，本 spec 修订之）
- **上游设计文档锚**（upstream/main，实现闭源）：`docs/cua/producer/ghost-cursor-turn-end-hide.md`、`docs/cua/producer/ghost-cursor-multi-display-spaces.md`

## 1. 背景与差距实证（2026-11-09 本仓差分）

官方 3.17.2 的 CUA 相对本仓 0.6.3 冻结线的差距，逐层实证：

| 层 | 差距 | 证据 |
| --- | --- | --- |
| 插件薄壳（skills/docs/manifest） | **零差距**（byte 级相同），仅版本号/license 字段差 | diff=0 |
| agent 工具面（14 工具） | **零差距** | SKILL.md byte 级相同 |
| ax_native 原生 addon | **ghost cursor 引擎整体缺失**：官方 139 全局符号 vs 我方 105；47 个官方独有导出（`ghost_motion` 贝塞尔轨迹引擎、`ghost_geometry` 多屏定位、点击涟漪、focus-rect、键盘 cue、badge、多会话、自检三件套），+102KB（+10.4%） | nm 导出表差分 |
| Helper SEA（broker server 侧 JS） | `ghostCursorTurnLifecycle`、`GHOST_SESSION_SCOPED_METHODS`、`PublishGhostMoveForTarget`、`request.ghostSession`/`job.ghost_session`、`withGhostCursorSessionLifecycle` 全部 0 命中；截图管线两代细化（TCC granted 才真截屏、窗口名 `.app|应用程序` 后缀规范化、frame-surface、owner 变化重拍） | SEA token 级计数（官方独有中文串 459 条中行为级 9 条） |
| Helper bundle 结构 | 官方内嵌 node_modules（@img/colour、@img/sharp-darwin-arm64、@img/sharp-libvips-darwin-arm64、detect-libc、semver、sharp 共 6 包集），3.11.2/3.14.3 均无此结构 | find 结构差分 |
| producer（node-repl-host 内嵌 zcode-cua 段） | PiP 启动路径 `ghostCursorOverlay: true` 恒开修复缺失（官方注释：症状「PiP 在、虚拟光标永不出现」，8/17 设置面收敛） | host dist ghostCursorOverlay 官方 3 处 vs 我方切段 1 处 |
| 版本线/license | 官方 Helper `CFBundleShortVersionString` 已随 App（3.17.2）、buildId `pipeline-326130-a2d1ba73`；manifest license MIT→Apache-2.0 | PlistBuddy / plugin.json |

**官方 3.17.2 锚点二进制**（证据基座引用值）：

- ax_native.node SHA-256：`b169b8dc8be0dc747fdba5d8e17d4c814e13068b711a238d421b808c660ceaea`（1,088,928 B）
- Helper 主可执行 SHA-256：`36ba7e600dce3cc715bdf278459fedb89eb9622dfbd8278abe9811f0717cad2b`
- 本仓现行 addon 钉扎（3.14.3 基线）：`5b46401f…a61440`（`packages/zcode-cua-helper/build-cua-helper-app.mjs:206-218`）

上游开源仓对 ghost 仅提供：ARG 常量与 broker re-export（已在 v3.17.2 合并时按台账 15 并入）+ 两篇设计文档；**引擎与 SEA 实现闭源**，只能走 bundle 还原。

## 2. 四项用户裁定（2026-11-09）

1. **addon 逆向还原路线**：二进制不走拷贝，把原版二进制逆向成源码——与 win32 反向工程线（`packages/zcode-cua-helper/native/reverse/src/ax_native_win.cc`，57/57 能力 parity）同路线；mac addon 以官方 3.17.2 为 parity 锚做全量源码重建（`src/ax_native_mac.mm`），达标后替换现行官方字节拷贝。
2. **版本与 license 跟随**：parity 达标后 zcode-cua/zcode-cua-plugin 升 0.6.5、license MIT→Apache-2.0 跟随官方翻转。
3. **win32 线维持 0.6.3**：用户后续在 Windows 机器实现；本轮 darwin 改动照旧跑 win32 无损套件，win32 行为不随线。
4. **对齐权威修订**：以官方 3.17.2 bundle 为权威（修订 R3 的 0.6.3 冻结，走 bundle 还原路线）。

## 3. R3 修订记录

- **原 R3**（`specs/upstream-v3.16.1-migration.md` + v3.17.1 `preservation-owners.tsv` 的 `D-frozen` zone）：维持冻结 CUA 0.6.3 SDK/Helper 运行时；上游 0.6.5 占位包仅登记对照。
- **修订后**（本 spec）：对齐目标从「上游开源仓」改为「官方发行 bundle」——producer 切段、Helper SEA JS 以 3.17.2 bundle 证据还原；addon 不再随包分发官方字节拷贝，改为逆向重建源自建产物。
- **不变项**：台账 15 的 Helper 身份五常量与包名以本仓为权威（`broker-helper-constants.js` 单一出处）；`specs/drora-rename.md` 豁免区与还原区 wire 契约字面量双名规则；0.6.3 切段文件在 0.6.5 切段验收前保留。

## 4. 证据规则（还原纪律）

- 每一处 bundle 还原改动附**原版证据三要素**：文件 + SHA-256 + 字节偏移（或 token 定位串）；登记入 `docs/cua-restoration-manifest.md` 对应轮次。
- 验证单位是**逐常量、逐字段集、逐拒绝文案、逐阈值**，不是逐函数逻辑（AGENTS.md 还原纪律）。
- 新还原文件头带 `还原自发行 bundle` 注释并登记 `.oxlintrc.json` ignorePatterns（如适用）；自研接线走新文件/ports，禁止写进还原文件、禁止还原文件 import 自研实现。
- 每批共享 CUA 模块改动后跑 **win32 无损套件**（build.mjs 产物零漂移 + typecheck + `restored-smoke` + `windowsCuaRuntime.node-test` + CI parity 所引文件零改动）。
- 上游同步前置门不变：`scripts/check-bundle-key-parity.mjs` 差分先行。

## 5. 批次划分

### P0 spec 先行（本文件 + 台账）

### P1 证据基座（只读分析，全部记字节偏移）

1. 参照物换装：`packages/desktop/resources/cua-helper/` ← 官方 3.17.2；3.14.3 副本转 `cua-helper-3.14.3-reference/`（同 3.11.2 先例，gitignored）；`tools/parity-mac-helper.mjs` 参照路径同步。
2. 官方 Helper SEA 证据提取：BROKER_METHODS 表差分（42→N）、ghost JS 模块族、截图管线 delta、阈值与拒绝文案 token 清单。
3. 官方 node-repl-host dist 的 zcode-cua 0.6.5 段边界定位（esbuild `// src/` 模块标记法）。
4. addon 静态分析新基线：3.17.2 nm 导出表/demangle 符号/ObjC 方法表/strings → `native/reverse/data/`（新文件，保留 0.6.3 基线）。
5. `check-bundle-key-parity.mjs` 双对跑（helper SEA 两侧、host dist 两侧）。
6. 证据登记 restoration manifest 新轮次（第六十七轮起）。

### P2 快改批（先行可合并）

- plugin manifest 版本 0.6.5 + license Apache-2.0；官方独有 `scripts/sync-skill.mjs` 对齐或登记差异。
- Helper 版本线随 App（`build-cua-helper-app.mjs` `CUA_HELPER_VERSION` 缺省改随 App 版本）；安装校验链回归。
- license 文本与 THIRD-PARTY-NOTICES 补齐。

### P3 producer 层 0.6.5 切段

1. 雕出 `packages/zcode-cua/upstream/zcode-cua-0.6.5.index.js`（品牌规范化仅 env 键 `ZCODE_→DRORA_`，照 0.6.3 段头规则）。
2. node-repl-host 构建配置 esbuild alias 切换；PiP 恒开修复随之生效。
3. 方法表落地：`cua-spec.ts` ZU 表（42→N）、`protocol.ts` ↔ helper `types.ts` 镜像、`cua-tool-layer-smoke.mjs` 假 helper 更新。
4. 还原草稿按 0.6.5 证据刷新；修正 `product-helper-host.ts` 过时头注释（实为编译路径）。

### P4 Helper SEA JS 0.6.5 增量还原

1. `packages/zcode-cua-helper/src/pip-session/` ghost 回合生命周期（`withGhostCursorTurnEndHide`：turn-ended/session-closed 后无 running 会话才 `ghostHide()`）+ `GHOST_SESSION_SCOPED_METHODS` 会话域守卫。
2. 截图管线细化逐条还原（TCC granted-only、窗口名后缀规范化、capture_surfaces 演进）。
3. Helper 内嵌 node_modules 清单化 staging（6 包集显式清单+SHA 校验，替换整目录 ditto）。
4. SEA 骨架/图标源升级 3.17.2；afterSign 嵌套 Mach-O 重签序适配。
5. 版本一致性脚本基线更新。
- **解耦保证**：ghost native 调用全部可选链（`?.`），配现行 0.6.3 addon 为安全 no-op——P4 可先行合入，视觉生效等 P5。

### P5 ax_native mac 逆向重建（长线，能力域 7 批滚动）

`native/reverse/src/ax_native_mac.mm`（ObjC++/node-gyp/Xcode），以官方 3.17.2 为 parity 锚，达标后 `native/ax_native_mac.node` 换自建产物、SHA 钉扎更新、afterSign 语义改「钉扎自建产物」、CI `addon-parity` 扩 mac。

- 5a 注册表+参数校验面（TypeError 文案逐字）→ 5b displays/cursor/dpi/list* → 5c AX 树 → 5d 动作域 → 5e 剪贴板+capture（TCC granted）→ 5f PiP+窗口域 → 5g ghost 新面（贝塞尔/多屏/涟漪/badge/multi-session/自检）。
- 每批：四级证据（[S][I][T][E]）→ 编译 → `parity-native-matrix.mjs` 扩 mac 项 → win32 无损套件 → manifest 轮次登记。

### P6 验证矩阵

- 离线：typecheck/lint + zcode-cua test 链四件套 + services node-test + `verify:mac`（parity 参照 3.17.2）。
- parity：addon 能力矩阵全 MATCH、SEA token 级差分退出码 0、方法表 N/N。
- 真机：首用安装链 → ghost 肉眼验收（glide/涟漪/focus-rect，多屏）→ 截图 TCC 行为 → 双实例 parity（用户参与验收）。
- win32：无损套件零漂移。
- release 打包冒烟（afterSign 新链 + 发版 16 类资产清单）。

### P7 收口

restoration manifest 全轮次、`docs/cua-alignment-status.md` 状态矩阵（形态锚 3.14.3→3.17.2、ghost 行转对齐、认证 v2 行更新）、台账/记忆存档。

## 6. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 3.17.2 addon 身份门拒我方自签（v2 认证模型演进） | P5 批前先跑 `adhoc-distribution-profile` + `probe-ax-native` 探针；若拒绝即停下用户裁定（唯一可能推翻方案面的点） |
| mac 逆向工程量大（ObjC/AX/ghost 动画域） | 7 小批滚动交付，每批独立 parity 可验收；ghost 批最后，期间 no-op（与今日行为等价，无回退风险） |
| 3.17.2 SEA 骨架 node 版本兼容（非 node24/modules137） | 构建脚本硬守卫按实测放宽并记录 |
| 切段边界/方法表增长 | P1 证据先行枚举；MCP 14 工具面预期不变（SKILL byte 同） |
| 上游未来同步 | 台账 15 权威规则不变；0.6.5 段新增带溯源头 |

## 7. win32 边界

本轮 darwin-only：win32 继续用 vendored `@zcode/zcode-cua-helper-runtime` 0.6.3（ghost 等 3.17.2 行为暂缺，`--ghost-cursor-overlay` 恒开参数对 0.6.3 runtime 为无副作用参数）。Windows 实现由用户另行开展，届时以官方 win 3.17.2 产物为对照另开轮次。

## 8. 执行终态（2026-11-09 第五会话收官，manifest 第六十七–七十二轮）

- **P0–P4**：全部落地（见各轮登记；0.6.5 切段/方法表 43/IPC v3/ghost 接线四件/element_scroll 门控/三处改名漏网点/3.17.2 骨架+清单门）。
- **P5 全批达标**（5a–5g）：`generate-mac-rebuilt.py` 生成 `src/ax_native_mac.mm`，136/136 全实现。parity 终态=扫荡 297 形态+**captureApp 全树 1000/1000 节点全键零差**+ghost 状态机 20 场景+调色板 44 键+axh 生命周期+自检三件套+导出面 136/136（第七十二轮）。生产路径探针盲区（getPeerCredentials/verifyProcessCodeSignature）经换装首跑 live 抓出修复。
- **达标换装（裁定①兑现）**：`native/ax_native_mac.node`=自建产物（sha256 `4214ee9be3d1394…`，build 脚本钉扎同步换值）；五测试链+adhoc-distribution-profile ALL OK（身份门对新 addon 复测通过）；prepare:cua-helper 全链冒烟 staged 实证。
- **P6 残留（用户参与）**：真机 ghost 肉眼验收（多屏）+release 真实打包冒烟（electron-builder 全量）。
- **P7**：manifest/状态页/台账/记忆收口（本节+docs/cua-alignment-status.md 重写+记忆存档）。
- 已知残留记档：beginAction occl 官方 0/1 翻转（异步遮蔽态）、AXColumn enabled 特例化、StableSessionIndex 一般式（44 键覆盖表+规则层+fnv1a 兜底）——均为可观测面非确定或仅影响配色的点，不改契约结论。
