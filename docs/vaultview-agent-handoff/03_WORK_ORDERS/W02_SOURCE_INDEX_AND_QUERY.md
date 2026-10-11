# W02 — Source / Index / 文章召回服务

**依赖：W00/W01。**只读索引，不触及真实用户笔记修改。

1. 按当前 Drora RPC 注册 `IKnowledgeIndexService`、`IKnowledgeQueryService`；共享 channel/type 单一出处，service lifecycle 支持 dispose。
2. SourceRegistry 仅由当前活动 Vault 和 Profile 推导，sourceEpoch 变化使旧 Query、Index Job、Receipt 失效；不能复制独立 Vault 配置。
3. SQLite WAL + migration + FTS index/rowid + short transaction；真实验证多 Host lease/fencing 和崩溃恢复。索引是可重建缓存，不删除审核账本。
4. 只索引现有安全门面的 Markdown；排除隐藏/软链/超配额；chunk 保存 heading/quote selector/sha；支持增删改、重命名、漏事件 reconcile、partial coverage。
5. 中文汉字 bigram 或经验证的 tokenizer、英文 BM25，严格 MATCH 参数化；提供 Embedding 端口，未可用时显式 `semantic_unavailable`。
6. article candidates 按 scope、sourceEpoch、runGeneration 隔离，去重并聚合，不能让模型扩展授权范围或日期筛选条件。

**演示：** 临时合成 Vault 的新增/修改/删除/重建/切库/撤权/partial；两个真实 Host 的 index writer 竞争；中文+英文混搜。不能将合成检索结果声称为真实 Vault 命中率。