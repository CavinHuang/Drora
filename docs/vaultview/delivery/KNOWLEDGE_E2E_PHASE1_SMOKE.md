# Obsidian Knowledge → Agent 第一轮验收（真实桌面门禁）

> 工作分支：`feat/obsidian-knowledge-e2e`。状态：**代码已接线；GUI 尚未在真实 Electron 中执行**。本文件是验收执行单，不是验收通过报告。

## 验收边界

- **必须使用独立测试 Vault**（示例 `drora-knowledge-e2e-fixture`），不得修改、索引或撤销用户生产 Vault。
- **必须启动真正的 Electron 桌面端**；单纯的 services test、模拟 hook、静态页面或 CI bundle 成功，不等于 GUI E2E 成功。
- Agent 端只允许使用已有会话的发送链路；`evidenceRefs` 由服务端签发、CLI admission / queue promotion 执行时复验。
- 已禁用的 L2 Review write path 继续关闭，本轮不启用。

## 环境与自动测试（执行并保存日志）

- Node.js ≥24（仓库要求），pnpm 10.33.2；用 macOS 和 Windows 分别验收。
- `pnpm install --frozen-lockfile`
- `pnpm typecheck && pnpm lint`
- `pnpm exec vitest run packages/ui/test/conversationSelectionReference.test.ts packages/ui/test/knowledgeAskModel.test.ts packages/ui/test/knowledgeEvidenceVerification.test.ts packages/ui/test/knowledgeAgentHandoff.test.ts packages/ui/test/knowledgeTurnCitations.test.ts packages/ui/test/knowledgeCitationMarkdown.test.ts`
- `node --import tsx --test packages/services/test/knowledgeE2EFullChain.test.ts packages/services/test/knowledgeIndexQuery.test.ts apps/drora-cli/packages/bootstrap/test/knowledge-evidence-gate.test.mjs`
- CLI 证据接线测试必须先完成 CLI workspace 依赖构建（CI `cli-build` 负责），然后执行 `node --import tsx --test apps/drora-cli/packages/bootstrap/test/evidence-session-wiring.test.mjs`。
- `pnpm dev:desktop:test`：打开真正的 Drora 桌面实例，必须确认使用测试环境，不触碰真实 Vault。

## GUI 实操验收矩阵

| ID | 操作 | 必须观察到的结果 | 执行记录 |
| --- | --- | --- | --- |
| G01 | 使用全新测试环境启动 Electron，连接临时 Obsidian Vault，建立索引 | `configured=true`；索引任务真实完成且覆盖文件数符合夹具 | 未执行 |
| G02 | 在 VaultView 智能问库里用中文检索唯一标题/句子 | 匹配对应真实文章；候选路径、引用片段和位置准确 | 未执行 |
| G03 | 在**已存在 Agent 会话**下点击「加入 Agent（可信证据）」 | 当前文件重新核验；Composer 出现引用；不会把 Receipt ID 拼入模型 prompt | 未执行 |
| G04 | 点击 Composer 发送，对真实 CLI admission 打日志/断点 | `sendText.payload.evidenceRefs=[{receiptId:'evr_…'}]`；CLI gate 接受当前证据；Agent 收到原文片段 | 未执行 |
| G05 | 先添加证据，**修改**原文，再发送 | CLI 返回 `guard.evidenceStale`，拒绝执行，Composer 保留待改输入 | 未执行 |
| G06 | 先添加证据，**删除**原文，再发送 | CLI 返回 `guard.evidenceMissing`；没有使用旧引用生成回答 | 未执行 |
| G07 | 先添加证据，断开 Vault / 撤销授权，再发送 | CLI 返回 `guard.evidenceForbidden`；原文不泄漏 | 未执行 |
| G08 | Busy Session 下加入队列，在队列提升前修改原文 | `sendQueuedNow` 再次验证并拒绝过期证据；不能静默降级 | 未执行 |
| G09 | 同一节选两次「加入 Agent」，第二次拿到新 Receipt | Composer 只保留一项；发送的是第二次签发的 ID | 未执行 |
| G10 | 查询 RPC/Host 断开后重试相同检索 | 复用原 clientRequestId，不产生重复 Run | 未执行 |
| G11 | 证据核验未完成时提交新的检索 | 旧结果不能污染新 Run，也不能被加入 Composer | 未执行 |
| G12 | 保存证据后重启 Electron，再打开源文件和已有会话 | 未出现旧 Receipt 被误判为 current；真实会话仍可正常发送 | 未执行 |
| G13 | ANSWER 模式选择两篇真实笔记后准备 Agent 问题并发送 | 两篇来源均被单独签发和复验；Agent 输入仅包含通过验证的两篇原文；回答能区分不同来源 | 未执行 |
| G14 | ANSWER / COMPARE 尝试选第六篇、取消一篇后重选 | 第六篇不能添加；取消后可以换选，COMPARE 最少两篇才能交接 | 未执行 |
| G15 | 正在搜索时点击取消，并让原搜索 RPC 延迟返回；再创建新搜索 | UI 不持续显示“检索中”；已取消请求和晚到结果不能覆盖新查询 | 未执行 |
| G16 | 在多篇 ANSWER 中修改其中一篇后点击准备交接 | 整批交接 fail-closed，不能只将另一篇可信材料送进 Agent | 未执行 |
| G17 | 完成两轮检索后展开上一轮，点击旧笔记 | 点击时重新 prepareEvidence + resolveCitation，仅在 current 时按新 quote 位置打开 | 未执行 |
| G18 | 在两轮检索之间修改/删除上一轮笔记或切换 Vault，再点击旧候选 | 拒绝历史路径直接回跳；显示结构化 stale/missing/forbidden，不打开错误文件 | 未执行 |
| G19 | 在同一 Agent Session 中将上一轮笔记重新「加入 Agent」后追问 | 重新签发当前 Receipt，Composer 收到原文与新 ID；发送及队列提升继续复验 | 未执行 |
| G20 | 旧笔记复验 RPC 挂起时切换会话或发起新检索 | 迟到引用不打开笔记，也不进入新 Session 的 Composer | 未执行 |
| G21 | ANSWER 选中两篇笔记并触发 Agent 交接，核验期间改选第二篇 | 旧两篇引用不得进入 Composer；需要对新选择重新执行交接 | 未执行 |
| G22 | 在核验 RPC 未返回时快速双击「交给 Agent」，然后切换 Session/Workspace | 仅执行一次有效核验批次；旧会话结果不得写入新会话 Composer | 未执行 |
| G23 | 选择两篇 Obsidian 笔记交给 Agent，并观察交接问题与生成回答 | 交接问题包含与两篇核验片段顺序一致的来源编号、路径及行号；回答应使用已列出的编号，生成内容仍需人工核对 | 未执行 |
| G24 | 将可信证据与普通 Markdown 选区分别加入 Composer | 仅有服务端 Receipt 的条目显示「发送时复验」标记；普通选区不得出现可信标记，也不得携带 evidenceRefs | 未执行 |
| G25 | 已签发凭据后修改原文并尝试发送 | 虽显示凭据待复验提示，发送门禁仍必须拒绝失效来源；提示不能误导为永久有效 | 未执行 |
| G26 | 从多篇 ANSWER 交接到 Composer 后删除第二篇引用，再按 Enter 或发送 | 发送按钮禁用并显示来源清单不一致；命令不出站，草稿保留；重回问库重新准备可恢复 | 未执行 |
| G27 | 交接后换序、替换一篇或编辑来源行号/标题；只修改自然语言问题作为对照 | 换序/替换/篡改来源行必定拒绝；只修改问题但完整保留索引和凭据可以发送，并由 CLI 再次复验 | 未执行 |
| G28 | 将可信笔记加入已有 Agent Composer，点击该引用的「核验后打开原文」 | 对当前 Session 执行 resolveCitation=current，打开 VaultView 中服务端给出的相对路径并定位 quote 行号 | 未执行 |
| G29 | 修改/删除原文、切换 Vault/Session 或关闭对应 VaultView 后点击引用 | 禁止按缓存路径跳转；结构化显示 stale/missing/forbidden/unavailable，不打开其他 Vault 的同名文件 | 未执行 |
| G30 | 在 Composer 中附加普通 Markdown 选区而非可信 Receipt | 不出现「核验后打开原文」动作，不会因本地 path 文本获得可信来源权限 | 未执行 |
| G31 | 在未引入 S03 写安全门禁的生产桌面端打开 Vault 审核视图 | L2 开关禁用，并明确显示 S03 NO-GO；批准、拒绝、提案预览仍可用 | 未执行 |
| G32 | 手动把 `vault-config.json.reviewWritePathEnabled` 设置 true 后重启 Drora | 不自动激活 L2；apply/undo 返回 write_path_disabled，不能写入 Vault 文件 | 未执行 |
| G33 | 已显式通过安全门禁的测试环境中快速切换开启/关闭，或切换到另一个 Vault | 关闭立即撤销权限，旧配置读不能复活开关；切库后不能沿用旧 Vault 写授权 | 未执行 |
| G34 | ANSWER/COMPARE 发送两篇可信笔记并得到完整 Agent 回答 | 对应本轮 assistant 回复下方出现 [1]/[2] 来源操作；点击只传当前 turn 绑定的 receiptId，重新 resolve 后按实际原文路径和行号打开 | 未执行 |
| G35 | 连续发送两轮包含 [1] 的问答、切换会话并重启桌面端恢复转录 | 两轮只使用各自 CLI UserInputRow 上持久化的 evidenceRefs；相同编号不得跨 turn 借用上一轮凭据 | 未执行 |
| G36 | 普通对话手写 [1]、用户清除来源或旧转录不含 evidenceRefs | 不显示可信来源操作；模型生成的 [1] 不会凭文字获得任何原文打开权限 | 未执行 |
| G37 | Agent 答案写出不存在的 [9] 或引用未包含在原始清单中的编号 | 给出未知来源编号提示，只有实际携带 Receipt 的来源可点击；不宣称完成逐句语义事实验证 | 未执行 |
| G38 | Agent 回答包含带来源的长段落、无来源的长段落及未知 [9] | 只显示解释性标注缺口数量和未知编号；已知来源标示为「回答提及」，不标「已核实」 | 未执行 |
| G39 | Agent 答案包含带 [9] 的代码块、普通 [2](https://...) 链接和 Markdown 标题 | 这些表示形式不计入有效来源标注；不能据文本产生新的可信 Receipt 或跳转权限 | 未执行 |
| G40 | 在 S03 NO-GO 环境执行只读 reconcile，并尝试 undo | reconcile 继续可读取并落定账本，不被 L2 写开关阻断；undo 必须检查当前 Vault 写授权 | 未执行 |
| G41 | ANSWER/COMPARE 完成后，点击回答正文中的 [1]、[2] | 仅当前 turn 的 CLI 入参、Receipt 与来源清单严密对应时，正文编号变为可点击按钮；点击传 opaque Receipt，由当前 VaultView 重新校验并定位原文 | 未执行 |
| G42 | 第一轮 [1] 与第二轮 [1] 对应不同笔记，快速切换 Session、Workspace、重启再分别点击 | Markdown 缓存不得复用旧 click handler；每轮只能请求自身 session/workspace/receipt，异会话或旧 Vault 必须 fail-closed | 未执行 |
| G43 | 在普通 Agent 回复直接生成 [1]、伪造 [1](#drora-knowledge-source-1) 或旧转录缺少 evidenceRefs | 不得凭模型字符串创建可点击的可信跳转；常规 Markdown、URL 与文件链接行为不改变 | 未执行 |
| G44 | 同轮回答同时包含 Markdown 代码块、行内代码、标题、表格、已有链接与普通段落中的 [1] | 只有普通 prose 内允许编号变为可点来源；已有链接和代码的文本/行为保留，未知 [9] 不能点击 | 未执行 |
| G45 | 快速多次点击同一可信 Receipt，模拟 resolveCitation RPC 挂起超过 15 秒 | 同一身份只请求一次；超时结束等待并提示失败，迟到的 current 回复不能再打开笔记 | 未执行 |
| G46 | 点击引用后立即关闭 VaultView、切换 Session/Workspace 或切换 Vault，直到 RPC 返回 | 请求按最新 mounted/scope/Vault 身份 fail-closed；历史弹出结果不应重新打开笔记 | 未执行 |
| G47 | 点击可信来源时本地编辑器存在无法保存的草稿，或目标笔记读取失败/请求被更新的读取取代 | 不改变笔记选择或显示错误原文定位；引用打开返回失败而不是伪造成功，不覆盖原编辑器内容 | 未执行 |
| G48 | RPC 返回 current 时 Vault 已切换、文件读取失败或引用已超时 | 核验→打开整条 transaction 返回结构化 forbidden/failed；迟到的 RPC 不打开原文 | 未执行 |
| G49 | 同一 Agent 回答同时包含已准入 [1]、未准入 [4]、模型伪造的 [1](#drora-knowledge-source-1)、代码/标题中的 [1]，随后切换到另一历史会话 | 仅正文真实准入 [n] 可点击，模型链接不能借身份触发导航；切换后旧来源回调完全失效 | 未执行 |
| G50 | 点击完成态 Agent 回答的可信引用，由当前 Session VaultView 解析 Receipt；再在 RPC 尚未完成时切换 Vault/Session，或使来源 stale | 实际 Markdown 按钮→全局事件→新鲜 Receipt 解析→安全读文件整条链路成功；stale/作用域失效不打开笔记，模型伪造 fragment 不派发事件 | 未执行 |
| G51 | 连续多次点击同一条 stale 来源、等待核验过程中切换会话或退出再返回同一轮 | 同 Receipt 的 RPC/警告仅触发一次；旧作用域完成后不弹过期提示；返回后可重新点击并核验 | 未执行 |
| G52 | 点击可信来源让核验 RPC 挂起，快速从 Session A → B → A（或 Vault A → B → A、切换 QueryService），之后旧 RPC 返回 current | 作用域 epoch 单调前进，旧请求一经失效永久 forbidden，即使最终身份与初始完全相同也绝不重新打开原文；用户新点击可正常核验 | 未执行 |
| G53 | 点击已核验来源，在 CodeMirror 尚未 ready/定位 quote 前快速 Session A → B → A 或切换 Vault | 旧引用的待处理选区与聚焦请求被取消；即使回到同名文件也不重新选中旧 quote 或抢焦点；普通非引用编辑聚焦不受影响 | 未执行 |
| G54 | 在服务端 `resolveCitation=current` 之后、VaultView 第二次 `readFile` 之前修改来源 Markdown 的引用片段 | 第二次读取的完整文件 SHA-256 与 quote excerpt 必须同时匹配服务端刚复验的版本（包括摘录 240 字符之后的改动），变化时保留原编辑器/选中文件、不跳错行、不抢焦点并反馈失败；完全未变化时正常定位 | 未执行 |

## 核验回执

每次验收至少保留：系统/版本、测试 Vault 夹具文件列表、执行命令的退出码、UI 截图、关键 ACK reasonCode、CI run URL。不得提交生产 Vault 内容或密钥。

**GO 条件**：CI 的 typecheck、lint、知识库相关测试全部通过；G01–G11、G13–G54 在 Windows/macOS 上通过；G12 没有生命周期回归。否则 Draft PR 继续保持未合并。

## 已知不在第一轮承诺范围

- FIND/ANSWER/COMPARE 的独立答案生成服务；当前跨文章回答仅完成“经用户选源 → 全部核验 → 编号来源清单 → 交给现有 Agent”的交接。来源编号仅为模型回答提示，不能宣称已做逐句引用真实性验证或生成内容质量评测。
- 已完成的 Agent 回答在轮尾提供与 CLI UserInputRow / sourceCommandId / turnId 严格绑定的可信来源按钮，点击时重新核验 Receipt 才打开原文。本轮已补上**正文普通段落中的 [1]–[5] 内联点击**（仅 CLI 已归属的来源），由 Vault Host 点击时重新核验；代码/标题/链接/表格不改写，对模型逐句事实正确性仍不作保证；没有行级凭据的旧转录不会凭文本补造来源。Composer 已附加的可信引用 chip 支持点击时重新核验并打开 Vault 原文，两者不要混淆。Composer 发送前只做编号清单与当前凭据的一致性保护，不能代替 CLI 的可信证据验收。
- Jev 实际 Provider 调用与重排效果评测。
- Review L2 diff/approve/undo 写入和 S03 复审。
- 候选卡的「就此追问」侧会话仍走普通选区引用语义，不将其声称为 Receipt 可信链路。与此不同，「上一轮 → 加入 Agent」是同 Session 的显式可信证据重新核验流程。
