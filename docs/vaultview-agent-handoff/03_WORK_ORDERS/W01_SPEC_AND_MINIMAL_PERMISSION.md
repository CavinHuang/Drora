# W01 — Spec 与 Obsidian 自动授权最小收窄

**依赖：W00。**本阶段不等于已经强制拦截一切写操作。

1. 新增 `specs/obsidian-knowledge.md`，包含状态所有者、方案 C、权限策略、查询和 Evidence 语义、验收矩阵；更新 `specs/obsidian-plugin.md` 明确现有 allowAgentWrites 和未来 Proposal 的区别。
2. 对已有 `permission-request.ts` 的自动 allow，仅允许安全 root 内、无隐藏路径段/无软链逃逸、普通 `.md` 明确授权编辑；未授权或异常静默交回 Runtime 默认问询。
3. 独立可测的路径策略；覆盖 Windows UNC/相对 cwd、Unicode、大小写、符号链接、路径穿越、缺失/坏配置。
4. 审查 Hook 仅匹配 Write/Edit 的真实边界；不得在代码或 UI 里宣传它能阻断 Bash/MCP 的 L2/L3 写入。

**验证：** `.obsidian/**`、`.hidden/**`、非 Markdown、软链、root 外、`allowAgentWrites=false` 均不得自动 allow；合法 Markdown 编辑与既有默认问询不能回归。运行插件 hook stdin/stdout E2E、typecheck/lint/architecture，并记录结果。T0 Patch 仅对照，不盲目 apply。