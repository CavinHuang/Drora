# Drora Persona 真实模型评测——试点报告（PM48 归因 + PM47 效果）

日期：2026-11-02（试点）。依据：[主 spec §13 第十四批](../../../specs/drora-persona-system.md)、[数据合同 §8](drora-persona-data-contracts-2026-10-29.md)、[G 门收口](drora-persona-gates-2026-10-31.md)（待决事项 1）。本报告为**试点**（harness/语料/连通性验证 + 首批信号），不宣称任何 G 门通过；判定人＝所有者。

> **勘误（2026-11-02 独立评审后）**：本报告 §2「learn 未达的 3 例……模型抽取草稿键值与逐字引用全部正确」与 §6 修复记录的归因叙事有误——pm48-08 flash r1 第 1 轮实际为**无草稿失败**（抽取返回 no_candidates），并非草稿正确败在提交时点；step-5 pm48-01 r2 的失败草稿带 `[1] ` 编号前缀（属提示词 v1 缺陷模式）。完整修正见[全量报告 §2/§5](drora-persona-model-eval-2026-11-02.md)与主 spec §13 第十四批「独立评审增补」。

## 0. 一句话结论

试点目的达成：评测 harness 全链路（真实模型→真实学习管线→机械闸→提交）与两模型连通性验证通过；**合同关键红线首批信号全部为绿**（负例有效写入＝0、结构化输出零破坏、人格注入未见任务质量下降）；过程中修复 2 个 harness 缺陷与 1 处语料判定错误（均已记录）。**待所有者决策：是否进入全量（72 序列 + 360 主请求）。**

## 1. 环境与冻结参数

| 项 | 值 |
| --- | --- |
| 模型 | `step-5-preview`、`step-3.7-flash`（builtin `stepfun-step-plan` 模板清单内；anthropic-messages @ `https://api.stepfun.com/step_plan`；api-key 经 `.env.persona-eval.local`，不入仓） |
| 模型组合变更 | 原定 GLM-5.3-Flash（BigModel Coding Plan）经实测不可 headless 复用——账号鉴权为桌面 Host 中介（CLI 经协议回环向 Host 取请求级 token；standalone 账号流在桌面凭据形态下 entitled=false）。已按合同记录变更，GLM 侧转「桌面中介评测」后续通道 |
| 语料 | `pm47-corpus-v1`（六类×5，试点取每类前 2＝12 场景）；`pm48-corpus-v1.1`（12 序列；v1→v1.1＝pm48-10 回合 2 判定由 learn 修正为 conflict，原因：经抽取管线的纠正＝同键第二个不同 inferred，按 PM41 应进 disputed 而非替换——试点实测证实） |
| 冻结人格 | 核心：Drora／务实工程搭档自述／warm／balanced／light；偏好四键全填（zh-CN／concise／老黄／direct_answer）；编译两次同输出（确定性断言通过，sha256 见 artifacts/pm47/summary.json） |
| 模型参数 | reasoningLevel=disabled（映射为不发送思考参数；两模型默认 thinking 开启，计入输出 token——诚实边界）；主请求 maxOutputTokens=2048、抽取 1024 |
| 规模 | PM48 12 序列×2 模型×1 重复（抽取调用 59+前置 2）；PM47 12 场景×2 配置×2 模型＝48 主请求；合计 ≈126 次模型调用（≤冻结上界 130） |

## 2. PM48 归因评测结果（合同 §8「自动归因/有效学习」）

| 指标 | step-5-preview | step-3.7-flash | 合同线 |
| --- | --- | --- | --- |
| 负例有效写入（误记） | **0 / 7 负例轮** | **0 / 7 负例轮** | ＝0（红线）✅ |
| 合格 learn 正确写入 | 5 / 6 | 4 / 6 | ≥90%（全量判定） |
| 冲突→disputed（PM41） | 2 / 2 | 1 / 2 | 语义正确 |
| pinned 不被 inferred 覆盖 | 1 / 1 | 1 / 1 | 不覆盖 ✅ |
| 管理面忘记清理 | 1 / 1 | 1 / 1 | 清理生效 ✅ |
| 前置 inferred 布置 | 1 / 1 | 1 / 1 | — |

**判读**：

- **负例零违例（两模型）**：第三人引用、假设/否定、裸确认、项目限定、临时要求全部零候选或零提交——PM38/40 语义红线首批证据为绿。
- **learn 未达的 3 例**（step-5 pm48-01 r2；flash pm48-02 r1、pm48-08 r1）：模型抽取草稿**键值与逐字引用全部正确**，败在提交时点——工作快照时仍处 retry_wait/rejected 终态组合（草稿正确但槽未落）。归因日志（serviceLogs）已在该两轮之后才埋点，全量运行将携带逐 work 归因；不属于语义归因错误。
- flash pm48-08 r3 conflict 未达是 r1 未落库的因果结果（无既有值可冲突）。
- **抽取调用成本**：输入 ≈48–100 token/次（窗口单消息）、输出 55–1,600 token/次（thinking 占比高）；两模型抽取行为高度一致。

## 3. PM47 效果对照结果（合同 §8「任务质量/权限干扰」）

| 指标 | step-5-preview on/off | step-3.7-flash on/off |
| --- | --- | --- |
| 结构化输出 schema 合规 | 4/4 场景 ✅ / 4/4 ✅ | 4/4 ✅ / 4/4 ✅ |
| 任务关键点（非身份类 8 场景） | 未中 1 / 未中 1 | 未中 1 / 未中 1 |
| 身份类要点（老黄称呼） | on 命中 / off 未中（预期） | on 命中 / off 未中（预期） |

**判读**：

- **「人格破坏指定输出」零发生**（全部结构化场景 schema 全合规，on 配置同样）——干扰红线首批证据为绿。
- **任务质量无人格相关下降**：非身份场景的未中例（disagreement-1、work-2、correction-1）在 on/off 两配置**同样未中**——属模型能力/检查点措辞问题，非人格注入所致；人格 on 甚至未新增任何失败。
- **人格生效直接证据**：身份场景 preferredAddress=「老黄」在 on 配置两模型全部命中，off 配置全部未中（无该信息）——贡献注入→表达链路工作正常。
- 未中检查点细节：correction-1（Node fs.promises 版本事实）为模型知识错误，两配置同错；disagreement-1（step-5）与 work-2（flash）为回答措辞未覆盖检查词——全量前不修改检查点（阈值冻结纪律），如实报告。

## 4. 盲评材料（隐藏标签）

- 位置：`.persona-eval-artifacts/blind/review-step-5-preview.md`、`review-step-3.7-flash.md`（试点 12 场景×2 模型＝24 对照；标签映射 `mapping.secret.json` 单独存放）
- 每对照：同任务 A/B 两份输出＋自然度/身份一致/偏好三行评分。全量后将重建为 60 对照。

## 5. 诚实边界

1. 主请求用 messages 直发（generateText），不进 agent 工具循环——衡量「人格对主请求表达的影响」，工具噪声与成本不纳入（spec 第十四批已记录）。
2. 两模型 thinking 默认开启且计入输出 token（reasoningLevel 映射为不发送参数）；输出 token 均值被抬高，成本表按实际用量报告。
3. learn 未达 3 例的提交层归因缺日志（埋点晚于该轮）；全量运行将逐 work 归因后再判定。
4. 试点样本量（每类 2 场景、1 重复）不支持统计结论；本报告只陈述信号，合同阈值判定留全量。
5. 连续身份类的前情 assistant 轮为语料固定文本，非模型真实历史。
6. PM48 每序列独立临时库；生产 10 次/日抽取帽在本实验不适用（spec 第十四批冻结记录）。

## 6. 试点期间修复记录（全量前完成）

| 缺陷 | 类别 | 修复 |
| --- | --- | --- |
| sequencingOwner.verifyLearningSource 返回非 Promise，processClaim `.catch()` 抛 TypeError（正例轮全部 orchestration_error） | harness | 改 async；PM48 全量重跑 |
| 管理面忘记后 before 快照未刷新，下一轮误报「槽变更」 | harness | forget 后刷新基线并 continue |
| pm48-10 r2 判定期望误标 learn（实为 PM41 冲突语义） | 语料 v1.1 | 期望改 conflict＋注释；两模型复跑通过 |
| modelFactory 传参形状错误 / GLM standalone 账号流 entitled=false | harness/环境 | 前者修复；后者升级为模型组合变更（§1） |

## 7. 待所有者决策

1. **是否进入全量**：PM48 12 序列×2 模型×3 重复（≈186 次抽取调用）＋PM47 30 场景×2 配置×2 模型×3 重复（360 主请求）；断点续跑已验证。预计 StepFun 侧消耗输出 token ≈0.3–0.5M（thinking 计入）。
2. 盲评工作量确认：全量后每场景一对＝30 场景×2 模型＝60 对照（约 1–1.5 小时，可分批）。
3. learn 未达 3 例的提交层归因是否需要先单独复现（全量自带日志，也可直接全量顺带归因）。
