# W03 — Evidence → 真实 Drora Session → 引用回跳

**依赖：W02、W00 的 S02 结论。最高优先的端到端产品闭环。**

1. 服务端创建 opaque EvidenceReceipt，绑定 session/run/sourceEpoch/fileSha/quote selector；打开及发送前再次验证授权与文件当前版本。
2. 在原有 Composer/Session 允许显式 `@Vault` 或“用选中文章回答”；用户发送前可预览有界引用内容及模型数据出站范围。
3. 查明现有 Runtime busy input `CommandInbox` admission 的真正执行时机：若排队期间修改文件、撤权或切库，旧 evidence 不得在执行时作为 current。
4. 模型文字不得自行构造可信 citation；`# userselect` 的 `{text,path}` 不是 Receipt；点击前必须由服务端 resolveCitation。
5. FIND_ARTICLE 不强制触发 Agent 回答；ANSWER/COMPARE 经原有会话生成。无模型时仍能浏览检索结果。

**E2E 验收：** 真 Host + 真 Session 查询、生成、引用回跳；busy queue 后源更改/授权撤销；伪造 citation、注入文本、跨 session 引用；网络/模型离线。不得用 HTML mock 或 Spike 输出冒充实际 Agent 会话测试。

**阻断：** 如果找不到可靠 admission 扩展边界，保留只读文章检索，输出 NO-GO 及后续方案，禁止修改 Runtime 队列语义来掩盖问题。