# Jev 多阶段决策设计

Jev 可用时参与：意图路由、候选重排与证据直接性判断、结果充分性、回答后语义引用核验、追问路由。**不要将每一个决策都无条件触发远端 API**。

| 阶段 | Jev 输入/作用 | 决策不得覆盖的硬条件 |
|---|---|---|
| Intent | FIND_ARTICLE / ANSWER / COMPARE / EDIT / UNCERTAIN | 用户明确选定意图 |
| Rerank + evidence | 当前 Query + Top20/30 有界候选片段的 Noul/Score 评估 | 已授权范围和 FTS 召回范围 |
| Sufficiency | 正反证与覆盖范围，建议展示/扩搜/澄清/不足 | 索引 partial 与实际引用验证 |
| Citation support | 比较回答论断与原文，判断支持/反对/未知 | receipt、hash、quote 定位 |
| Follow-up | 判断沿用现有文章或开启新检索 | session/sourceEpoch 授权范围 |

默认本地模式，Jev 需用户显式授权发送查询及最少必要片段。出站目标、内容范围、时效和取消状态应明确；缓存键需涵盖 query、chunkSha、policyVersion、modelVersion、sourceEpoch。

所有异常（未配置、撤销许可、429、超时、非法分数、不一致 ID、部分失败）**保持本地候选可用**。不能把 Noul 数值显示为文章正确率。

必须分别评估 Recall@30、Hit@1/Hit@5/MRR、No-answer false positive、Citation support、P95 和成本。没有真实中文对照数据，不得宣称 Jev 改善命中率。

参考 `05_REFERENCE/JEV_DETAIL_v3.2.md` 与 `05_REFERENCE/PRD_v4.0.md`。