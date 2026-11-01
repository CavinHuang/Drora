# 合入官方 ZCode v3.17.1（保留全部 Drora 自研特性）

## 背景
官方上游 zai-org/ZCode 自 v3.16.1 起新增两笔源同步提交（v3.16.2 + v3.17.1），累计 5,548 路径变更（新增 1,263 / 修改 1,987 / 删除 2,298）。本 PR 把全部增量合入 Drora main，并零丢失保留自研特性。

## 合并方法
按 specs/upstream-v3.17.1-migration.md 的「正向转换 + 逐文件三方合并」引擎执行（直接 git merge 会因 zcode→drora 全量改名产生命名空间撕裂）：base=T(0a1fc56d v3.16.1)、ours=main(66c9193fd)、theirs=T(a60ba6a7e v3.17.1)；六段应用（S1 根配置与共享协议 → S2 CLI → S3 服务/存储 → S4 桌面 → S5 UI/手机 → S6 资产/治理）+ S7 终验。收口含保留产品树的祖先 merge commit（49a922ba0），使 a60ba6a7e 成为本仓 git 祖先——**请用 merge commit 方式合并本 PR，禁止 squash/rebase**。

## 上游主轴（全部吸收）
- App 业务单测执行链退役 → 工程测试显式清单（engineering 157）+ Drora 保留集双清单（drora 523 + isolated 9，D01 裁决）
- data-sync 设备数据同步全链、remote daemon 生命周期、远程启动失败修复、conversation-telemetry
- 协议 v4：input-prediction、session-data、SessionLifecycleController（D02：官方 lifecycle 唯一 owner，Team/Persona/CommandInbox 经端口接入）
- 新模块 12 个：file-menu、image-preview-editor、settings-scope、provider-provisioning-status、drora-site-plugin 等
- e2e-promotion 24 项修复；工程设施（binaries mirror 校验、pre-push 链）

## Drora 特性保真（V2 审计 PASS，零丢失）
A 类目录零差异（team/persona/mobile/voice/knowledge/obsidian/relay-v2-server/website）；B 类挂载点逐点在位（App.tsx 四桥、SettingsPage 五区含 relay 官方/自建切换、create-app 三装配、main/index.ts 三扩展）；协议方法表 0 删除/7 新增（纯 additive）；523 条保留测试全量可执行。

## 验证
- 升级前基线电池全绿；每段 typecheck/测试门禁绿后提交
- S7 十项门禁：typecheck/lint/architecture/engineering/drora/isolated/node-tests/eng-tools/schema 全部 exit 0；upstream-cli 判定绿·含已裁决豁免（opentui.dll 平台崩溃/SEA Windows 断言/采样负载抖动三项有基线树复现证据，本机 Windows 平台性阻塞，Linux CI 为终验入口）
- 三向审计：V1 覆盖性 PASS（5,548 行零静默丢失，ledger disposition pending=0）、V2 保真 PASS、V3 一致性 PASS（发现的 2 medium 均已修复/登记：台账 11 通道别名、分享链接待裁定）
- 证据链：docs/upstream-sync/2026-10-31-v3.17.1/（spec/tasks/三清单/应用报告/审计结论）

## 未完成/待裁定（如实登记）
- 官方 v3.17.1 发行 bundle parity：本机无对应资产（P1-10 blocked，源码树级 env 键族差分作替代证据）
- 跨平台（macOS/Linux）与真机 E2E、Docker 远端、GUI 手感：环境准入未做（依赖本 PR 的 CI checks）
- 分享文案下载链接指向 zcode.z.ai：待产品裁定（分歧台账待甄别）
- persona 真实模型效果实验与 G 门收口：升级前即未完成的原缺口
