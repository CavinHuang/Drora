# W04 — VaultView 四视图真实 UI 接入

**依赖：W02；问答与 citation 操作须满足 W03。**

- 在现有 `VaultView` 内整合「笔记 / 智能问库 / 洞察 / 审核」，默认笔记；不新增 Knowledge 顶级入口。
- “笔记”保持现有文件树、Markdown 编辑器、wiki link、图片、Properties、选区对话与键盘焦点。
- “智能问库”接真实 Query/Index/Citation RPC：自然语言意图（找文章、问内容、比较）、Scope/filters、候选、证据 Inspector、可取消/有限扩搜、追问。
- 显示本地候选即时结果；Jev 完成后只更新排序提示，不抢走已选文章焦点。Decision trace 默认折叠。
- 状态：无 Vault、索引 partial、semantic unavailable、Jev 拒绝/超时、无答案、多候选、过期/撤权、模型不可用、Host 重连。
- 复用 Drora DESIGN.md 中 `text-ui-*`、主题 token、现有 UI 组件；浅/深色、Web/窄屏、Windows/macOS/Linux。

**完成验收：** 真实 VaultView 能连接临时 Vault、搜索、展开候选并跳到正确原文；回归旧编辑器；有真实 E2E、键盘及截图证据。原型 HTML 仅用于视觉对照，不能当真实集成成果。