# 架构检查比较基线

App affected 单测入口已退役，原先与架构检查共用的默认分支选择函数保留在
`scripts/architecture/default-branch.mjs`。首次推送优先使用 `origin/staging`，随后是
`origin/HEAD`、`origin/main`、`origin/master`、`main`、`master`。

Drora 适配（divergence 台账 8 / v3.17.1 N2）：受影响工程测试入口为
`scripts/engineering-tests/scope.mjs`（engineering+drora 双清单选择，见
[pre-push 说明](../testing/pre-push-hook.md)）。首次推送基线在 `origin/staging` 是 HEAD
祖先时用之，否则回退 `drora/main`——本仓无 staging 集成分支，且 `origin` 指向上游官方仓
zai-org，用 `origin/main` 会让 merge-base 退回上一上游锚点导致全量误选（pre-push 历史崩溃
同模式），不猜测其他分支。

架构检查的实际基线选择和 push 门禁见 [pre-push 说明](../testing/pre-push-hook.md)。
不再提供 App 单测选择或全量回退。
