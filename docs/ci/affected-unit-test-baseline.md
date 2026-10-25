# Push 前 affected 单测比较基线

首次推送新分支时，远端 ref 没有可比较的 commit，affected 单测 runner 会回退到默认基线。默认基线取 HEAD 与 `origin/staging` 的 merge-base；`origin/staging` 不存在或不是当前 HEAD 祖先时回退 `origin/main`（Drora 适配：本仓无 staging 集成分支，见 `scripts/affected-unit-tests/scope.mjs` 的 `firstPushBase`），不猜测其他分支。

不再按锁文件、package、Vitest、TypeScript 或门禁脚本等文件名强制执行全量测试。只要存在可用比较基线，就统一根据实际变更运行 affected/related 单测。

只有找不到任何可用基线，或删除了无法交给 Vitest related 分析的源码文件时，才执行全量 `pnpm test:unit`。
