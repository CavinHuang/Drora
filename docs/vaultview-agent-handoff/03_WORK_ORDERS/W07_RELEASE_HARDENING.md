# W07 — 集成与发布前质量门槛

**依赖：计划进入当期交付的所有工作单。未来 P1 洞察/记忆扩展不必阻断只读 MVP。**

- 在真实 Drora 仓库运行并记录 `git diff --check`、`pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed` 和其他 AGENTS.md 所要求检查。
- 临时 Vault 真实 E2E：连接→索引→中文检索→候选→原文回跳→当前 Session 问答→可信 citation。
- 兼容性回归：笔记编辑、选区、粘图、managed Vault、普通 Agent 会话、窗口切换、远端工作区隔离、手机重连。
- 并发与安全：双 Electron Host 索引竞争、切源迟到响应丢弃、撤权阻断、索引 partial、伪造 receipt、提示词注入、无授权出站请求为零。
- 真正 Jev/模型联调要记录真实 SDK/API 版本、开销与成本；若未运行则明确未运行。
- 硬门槛：本地检索不因 Jev/模型不可用而失效，出站默认关，L2/L3 写入仅在 S03 GO 后开放，洞察未完成不出现假成功。

最后交付 `06_AGENT_OUTPUT/PR_DELIVERY_REPORT_TEMPLATE.md` 所要求的真实 Diff、日志、截图、已知风险和回滚说明。