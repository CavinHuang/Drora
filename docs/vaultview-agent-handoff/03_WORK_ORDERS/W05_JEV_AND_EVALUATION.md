# W05 — Jev 多阶段决策与实测 A/B

**依赖：W02/W03/W04；默认 feature flag 关闭。**

1. 增加独立 DecisionProvider、LocalFallback、JevAdapter。根据当时真实 TypeSafe 文档验证 JS/HTTP API，不得从 Python 示例猜接口；凭证仅在安全配置。
2. P0 优先合并 Jev 相关性与直接证据判断，只有真正需要时触发意图歧义、充分性或引用支持决策；不能为每条 Query 固定连续跑 9 次。
3. 本地 DecisionPolicy 执行 `SHOW_CANDIDATES / EXPAND_ONCE / ASK_CLARIFICATION / PREPARE_EVIDENCE_FOR_AGENT / NO_RELIABLE_MATCH`；最多扩搜一次。
4. Jev 权限按用户本次出站范围与 provider/source/epoch/queryHash/candidateHash 绑定，实际调用前重查；远端 Embedding/回答模型单独授权。
5. 超时/429/5xx/取消/非法评分/未知候选 ID/换源时本地回退，迟到响应不可覆盖新 Query。缓存按 model/policy/content 版本失效。
6. 使用真实脱敏、人工标注的中文 Vault 查询评估 Lexical、Hybrid、Hybrid+Jev 和专用 Reranker：Recall@30、Hit@1/Hit@5/MRR、No-answer FP、Citation support、P95 和调用费用。

**验收：** 至少一次使用非私密合成文本的真实 Jev 请求及响应/延迟日志；无授权 `outboundCount=0`。若缺凭据或标注集，则提交测试框架、保持关闭，不得声称实测改善。