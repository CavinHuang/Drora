# 分支自研功能完整性审计报告(feat/agents-team @ 05f814da)

- 审计方式:dynamic-workflow 六员审计(盘点员/分叉分析员/4 核查员+校对员逐项复核),git 事实经 world.run 确定性锚定
- 锚定事实:HEAD=05f814da;merge-base=f7c0e4c3;领先 drora/main 14 笔;落后 drora/main 10 笔

## 结论

盘点自研功能 **25 项:22 项落地完整,3 项 partial,0 项缺失**。分支落后 drora/main 10 笔,其中 5 笔为 merge(无自有内容),**5 个实质提交经逐文件集 diff 验证全部为分支真缺**(桌宠体系重写、create-pet 技能、Codex 宠物兼容测试、G 覆盖收口 E2E、D-G20-1 竞态修复)。

三项 partial 均为「主体在位、有残留缺口」,无一项整体缺失。

## 逐项判定总表

| 簇 | 功能 | 判定 | 要点 |
|---|---|---|---|
| agents-team | Agents Team(本分支主功能) | yes | 内核 10 测试文件约 86 用例 + bootstrap team-session-summary + ui team 9 文件;菜单目录订阅已实证 |
| remote-control | v4 网关协议面 | yes | golden/一致性/冷恢复等 30+ V4 测试文件 |
| remote-control | Relay 客户端与云中继 | yes | relay 三层测试齐(replay 缓冲/流控/双桥竞态/crc32) |
| remote-control | 手机远控 UI | yes | 47+41+27+8+11 用例覆盖 |
| remote-control | 多工作区推送 | yes | 41 用例含聚合推送/空推送不清空/双桥竞态 |
| vault | Obsidian 插件与 Vault 浏览器 | yes | permission-path-policy 18/agent-access 19/hooks-e2e 12 |
| vault | Agent 写入安全门控(S03) | yes | 10 个验收 ID 全覆盖(34 用例) |
| vault | Knowledge 证据账本 | yes | 10+7+20 用例含 fail-closed |
| pet-cua | Browser Use | yes | 约 20 个 browser 测试文件 |
| pet-cua | Node REPL 宿主 | yes | 6 文件约 60 用例 + core 侧 30+29+10+8 |
| pet-cua | 桌宠 | yes(旧版) | 分支保留旧实现 13 用例;**main 已重写 94 文件(见合并缺口①)** |
| pet-cua | droraCuaPlaceholder | yes | 4 用例与文档验收对应 |
| brand-ci | Drora 全量改名与品牌 | yes | OAuth 回调契约/DeepLink 用例在位 |
| brand-ci | 统一 Node 发行 | yes | 5 个进程/安装器用例 |
| brand-ci | 产品官网 | yes | check-website.mjs 实跑 exit 0 |
| brand-ci | **GitHub 更新源** | **partial** | 见缺口 A |
| brand-ci | **CI 发布工程** | **partial** | 见缺口 B |
| platform | PR#23 流程门禁体系 | yes | 9 acceptance spec 37 用例(静态确认) |
| platform | Start Plan 人机校验 | yes | 4+5 用例 |
| platform | **移动视口判定钩子** | **partial** | 见缺口 C |
| platform/other | 其余(C′ Server 工作区/workspace identity/output-style 等) | yes | 详见核查表格产物 |

## 三项 partial 的具体缺口(均经校对员独立复核证实)

### A. GitHub 更新源(partial,verified)

主体在位:electron-builder.config.js:1082-1090 publish github/CavinHuang/Drora;release.yml 双架构合并含版本守验(:318-363)、SHA256SUMS sha256 校验(:396-413)、mac 签名三锚(:51-52/:119-145/:178-183)。缺口四条:

1. `requestForceAutoUpdate`/`ForceAutoUpdateState`/`notifyForceAutoUpdate` 死导出——git log -S 证实 3813c063 删除后由上游同步 780721e7(ZCode v3.15.1)带回,现 autoUpdater.ts:103/377/1848 无调用方
2. i18n `forceUpdate.*` 键(en-US.ts:1907-1914、zh-CN.ts:1769-1776)全仓无消费方
3. `ForceUpdateConfig` 类型残留(shared/coding-plan-subscription.ts:187、services bigmodelCodingPlanSubscriptionProvider.ts:12,162),无代码读取 .forceUpdate 做门控
4. desktopSecondInstanceDeepLink.test.ts:89-90 向已不含强更字段的 deps 接口传陈旧 fixture 键

附:测试计数口径勘误——autoUpdaterReadyState.test.ts 声称 124 用例实为未锚定子串计数,真实注册 59 处 it()。

### B. CI 发布工程(partial,verified)

criteria 前三点已落地且行号吻合(kern.maxfiles :154-162、SHA256SUMS :364-416、per-arch 合并 :318-363)。缺口两条:

1. docs/desktop-ci-artifact-layout.md 系上游 v3.15.1 带入的 **GitLab CI 遗留文档**(git log --diff-filter=A 仅 780721e7),其描述的 `<platform>-<arch>/` 目录布局在本仓 GitHub Actions 链零实现(TARGET_OUTPUT_DIR/release:upload:* 等全仓 0 命中),文档与现行链脱节
2. windows-arm64 有意不上架(release.yml:45-46 注明 CUA helper 无 arm64 原生产物)——记录在案的取舍,非缺口

### C. 移动视口判定钩子(partial,verified)

`useIsMobileViewport` 全仓零消费方(死代码);其 docstring 声称的消费方实际全部使用另一实现 `lib/mobileTextInput.ts`(同一媒体查询字面量重复定义+自带订阅设施);另有 WorkspaceShellLayout.tsx:121/236/850(width-only)与 contextUsage.tsx:982('(hover: none)')各自实现 matchMedia。钩子本体无测试(现有 mobileInputZoom.test.ts 17 用例声称值实为 10 处 it(),且测的是 mobileTextInput)。

## 合并缺口(main 领先 10 笔,5 实质提交全部真缺)

| 提交 | 内容 | 分支状态 |
|---|---|---|
| e8113e6a | 桌宠体系重写:94 文件(+5242/-1634,desktopPetLibrary/Port/Configuration/NativeInteraction、preload player/pointer/tray、shared contracts、ginger/noir/snow/violet 内置资产) | **真缺**——分支对该文件集仅动 3 个共享文件(team 文案),且仍保留被 main 删除的旧实现(desktopPetCatgirlArtwork.ts 等,-1640 行) |
| 3f53112c | bundled create-pet 技能:40 文件(+6224,SKILL.md+scripts/tests+spec) | 真缺,整目录不存在 |
| 9ada15bf | Codex 宠物兼容验证:codex-pet-parity.test.mjs(+664)/production-pet.test.mjs(+164) | 真缺 |
| a20770ae | G 覆盖收口:3 个 acceptance e2e(820/941/1317 行)+3 fixture+CI 更新 | 真缺,该文件集 diff 为空 |
| e8c578ba | D-G20-1 竞态修复:usePreviousKnowledgeActions.ts 34 行 token/ref 重构+knowledgeCitationMarkdown +9+协议类型 3 处 | 真缺,分支仍停 merge-base 旧态 |

**合并提示**:双方在 packages/ui/src/App.tsx 与 i18n/locales/{en-US,zh-CN}.ts 各有叠加(分支 +5 行 team 文案,main 桌宠重写亦改此三文件),merge drora/main 进分支时需解这三处冲突。

## 验证方式

- git 事实经 world.run 确定性执行(rev-parse/merge-base/rev-list --count)
- 4 名核查员逐项 grep/read 取证(file:line);校对员独立复核全部 partial/no 判定 + 20% yes 抽样,四项 partial 全部证据重跑吻合并纠正两处测试计数口径
- 分叉分析员逐条 `git show --stat` 核对 main 领先提交并按文件集 diff 验证「真缺」

## 未覆盖

- 运行时行为验证(真实实例操作链路)——静态审计不含
- 测试只确认存在性与数量,未执行套件(只读审计纪律)
- CI 工作流结果以 GitHub CI 为准
