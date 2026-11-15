# 插件与逆向实现审查报告（10）

- 日期：2026-11-15；三路并行独立审查（自研插件深审 / 官方同源漂移对照 / 逆向还原件），全部只读、结论带 file:line/sha1 实证
- 对象：apps/drora-cli/packages/ 34 包 + packages/zcode-cua 引擎 + packages/zcode-cua-helper + design-plugin
- 基准：refs/upstream-trees/v3.18.2；中间产物 D:/workspace/tmp/plugin-drift/

## 一、总体判定：插件与逆向体系健康，1 high + 2 待裁定 + ~12 卫生项

| 路 | 结论 |
|---|---|
| 官方同源漂移 | **5,625 官方文件全部对账闭合**：等价 5,370（95.4%）+ 实质差 254 **全部有据**（七家族：win32 修复/自研域/官方契约字面量/拆分拓扑/裁定注释/生成物登记/R3 冻结）；官方独有仅 1 件（有据不跟，台账 40-5）；**版本零漂移**（31 包与 v3.18.2 全一致）；10-24 落后的 documents/pdf/presentations/spreadsheets/cua **全部闭合**；design-plugin 361 资产 sha256 逐件对齐+**57 测试全绿** |
| 逆向还原件 | 三面（zcode-cua 0.6.5/zcode-cua-plugin/zcode-cua-helper W1-W5）**结构完整、证据链闭环、R3 冻结区零回退**：HELPER 五常量单一出处测试钉住、三处资产 sha256 与各自 manifest 钉扎一致、protectProtocolStdio+d.ts 四补自洽、typecheck 全绿 |
| 自研插件 | **归属翻案**：superpowers-plugin 非自研（官方有、逐字节一致）；drora-site/drora-guide 为纯改名版（过滤品牌词后增行为零）；**唯一真自研 = obsidian-plugin**（121 文件/5.1 万行）——契约合规（v3.18.2 plugin-api 1.4.0 体系下无需 engines，形态正确）、fail-closed 纪律贯穿、抽离残留零、战役兼容通过 |

## 二、HIGH（1 项，建议立即修）

**obsidian-plugin 5 个 phase2 核心测试无执行通道**（knowledgeMcpServer / knowledgeMigration / knowledgeAgentTools / vaultPanelModel / vaultUiResources，均 node:test 面）：不在 package.json test script（仅 3 个 .mjs）、不在 ci.yml node --test 清单（25 项）、不在 drora/engineering 清单——**与 CI 注释里记录过的历史「全通道失执行」事故同型**（4c9be763b Vault 抽离新增面重演）。本地实测 5 件全绿（29 用例），纯登记缺位。修复=补进 .github/workflows/ci.yml 的 node --import tsx --test 步骤清单。

## 三、待用户裁定（2 项）

1. **zcode-cua-plugin verbatim producer 脚本链**（check-version-coherence / check-cua-baseline / bump-producer 等 5 脚本）：官方仓 verbatim 移植——(a) 断言官方契约名 `@zcode/zcode-cua`（本仓 `@drora/drora-cua`）**手跑必红**；(b) 硬路径 `apps/zcode-cli/...` 走到即 ENOENT。未接 CI 属「休眠必红」。选项：A=保持 verbatim+登记「仅供上游同步参照」（推荐，保真优先）；B=最小适配（路径参数化+断言认本仓身份）。
2. **plugin 卫生补齐**：官方 tsconfig.json（336B）缺失 + package.json test 引用不存在的 `tests/*.node-test.mjs`——补齐 or 在 spec 登记缺失原因。

## 四、LOW 卫生项（~12，按域）

**obsidian-plugin**：崩溃路径 `process.exit(0)` 应置非零退出码（server.ts:338）；contracts 注释声称的 PLUGIN_APP_SERVICE 消费点实际零落地（注释漂移）；onnxruntime InferenceSession 无 release（单例缓存泄漏面极小）；工具 schema 与 handler 内 z.parse 双份字面量。
**drora-site-plugin**：stage.test GNU tar 把 `C:` 当远程主机（win32 必红，产品代码不受影响）——加 --force-local。
**zcode-cua**：还原标记两档口径未统一（逐字 vs 结构还原稿）；草稿区 region-constants.d.ts 反向失同步（唯一 drora 化件）；embedded-build-id 测试 win32 必挂无平台守卫。
**宿主/其他**：shared/src/extension-host/CONTRACT.md 仍写 1.3.0（实际 1.4.0）；services node_modules 旧名 symlink（@zcode/zcode-cua，10-04 残留，下次 install 自然收敛）；schema.baseline.sql 表序差无专门台账；node-repl mcp-server.test 一处文案用词；漂移对照的 2 个低风险尾巴（生成文档 regenerate 登记）。

## 五、三路互证

- 漂移对照的 254 实质差路径集与战役收口 TSV **逐路径一致**（diff 为空）；11 件存疑件三基准定位全部早于本轮（历史定制非漏跟）
- obsidian 抽离残留检查 `check-vault-extraction-residuals` OK（8,746 文件零命中）；pluginCount 17 断言族修复在案
- design-plugin 专项：361 资产+57 测试双验通过（战役结论独立复核成立）


---

## 六、修复批（2026-11-15，15/15 项全部处置）

| 域 | 项 | 处置 |
|---|---|---|
| obsidian | **HIGH：5 测试进 CI** | ci.yml node --test 清单 25→30 项（无 paths filters；本地 29/29 绿复验） |
| obsidian | 崩溃退出码 | shutdown(exitCode) 参数化，uncaughtException→exit(1)；运行时实测 crash=1/正常=0 |
| obsidian | contracts 注释漂移 | 按现实重写（插件侧零消费实证）；改 import 评估不合规未做（自包含插件边界） |
| obsidian | onnx release | 端口 dispose 单次释放+热切换点接线（防误伤在用会话） |
| obsidian | schema 双份 | tools-vault 14 处单出处化（行为零变化）；tools.ts 5 处有意收窄登记不修 |
| 卫生 | producer 脚本链（裁定 A） | 5 脚本保 verbatim 零改动 + docs/producer-scripts.md 登记 + 台账 43①（两必红根因行号在案） |
| 卫生 | plugin tsconfig+test | 官方原文落位（逐字节同）+ test 空操作化（双侧同款 TS18003 休眠态验证） |
| 卫生 | GNU tar C: | --force-local（置于 -tvzf 前）+ 第二层 win32 chmod 守卫；5 pass/0 fail |
| 卫生 | 标记口径 | 5 处统一两档措辞 + spec §七.7 两档口径定义（逐字/结构级） |
| 卫生 | d.ts 失同步 | 草稿区回正 dev.zcode（与 src/编译版一致） |
| 卫生 | embedded-build-id | non-darwin SKIP；exit 0 |
| 卫生 | CONTRACT.md | 1.3.0→1.4.0（与 manifest.ts 一致） |
| 卫生 | 旧名 symlink | junction 删除（删除前零引用实证；目标完好） |
| 卫生 | 表序差 | 台账 43② 登记 |
| 卫生 | mcp-server 文案 | zcode-cua-plugin 回正 + 勘误注释；27/27 绿 |

收尾：`pnpm typecheck` exit 0 / `pnpm lint` 826 warn 0 err（基线零差分）/ architecture:check violations 0 / 全部定向测试绿。fmt 既有红门零新增（台账 42 在案）。
