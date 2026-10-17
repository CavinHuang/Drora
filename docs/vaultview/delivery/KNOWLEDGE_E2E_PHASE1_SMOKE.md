# Obsidian Knowledge → Agent 第一轮验收（真实桌面门禁）

> 工作分支：`feat/obsidian-knowledge-e2e`。状态：**G56/G57 Ubuntu Electron/WebDriver 负向来源测试已通过；G58–G60 Ubuntu Electron 已 3/3 通过；G61–G64 Agent 全链路 Ubuntu Electron 已 4/4 通过，macOS/Windows [38696660072](https://github.com/CavinHuang/Drora/actions/runs/38696660072) 真桌面两项 Job 均通过；G65 实机已通过；G66 在最新 Linux Electron 5/5 测试中已通过；Windows/macOS G01–G55 全量人工验收仍未完成**。本文件是分项验收执行单，不是完整验收通过报告。

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

- G61–G63 跨视图 Agent 的真实 Electron 路径：`pnpm --dir packages/desktop exec wdio run wdio.conf.ts --spec ./test/e2e/conversation-session/manual-review/obsidian-authenticated-handoff.test.ts`。此项使用隔离 `.e2e-home` 真实 Vault/Knowledge/CLI RPC，仅模型通过固定 SSE 回放返回普通 `[1]`；**不能以该模型回放代替真实用户笔记的人工验收**。同工作流先运行 `apps/drora-cli/packages/bootstrap/test/evidence-session-wiring.test.mjs`，锁定 direct/queued canonical UserInputRow 的已准入 Receipt 投影。
- G58/G59 正向 Electron：`pnpm --dir packages/desktop exec wdio run wdio.conf.ts --spec ./test/e2e/obsidian-knowledge-positive.test.ts`；仅在 `.e2e-home/.drora/cli/data/obsidian@drora-plugins-official/managed-vault` 中预置文件，不发起模型请求，测试前必须验证 E2E HOME 隔离。
- G56 真实 Electron 负向来源验证：`pnpm --dir packages/desktop exec wdio run wdio.conf.ts --spec ./test/e2e/conversation-session/manual-review/obsidian-inline-citation-provenance.test.ts`。使用隔离 E2E HOME 和仓内合成回放；G56 已在 Ubuntu Actions run [38668209293](https://github.com/CavinHuang/Drora/actions/runs/38668209293) 实际通过（1/1）；G57 亦已在 Ubuntu [38669023497](https://github.com/CavinHuang/Drora/actions/runs/38669023497) 的真实 Electron 工作流通过（同一 WDIO spec 2/2）。G58–G60 已在 Ubuntu Electron [38671681092](https://github.com/CavinHuang/Drora/actions/runs/38671681092) 真实 3/3 通过，G56/G57 同一次 workflow 2/2 通过；相关完整 CI [38671681360](https://github.com/CavinHuang/Drora/actions/runs/38671681360) 成功。

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
| G55 | 已验证引用进入真实 CodeMirror 后定位双行 quote；再触发 A→B→A 会话切换使旧 focus 请求失效 | 当前来源的选区起止落在正确行、滚动到目标附近并聚焦；失效请求不改变 CodeMirror 的选区/焦点或正文，普通单行/越界行锚定仍安全 | 未执行 |
| G56 | 在隔离 Electron WDIO 中让固定模型回放伪造 [1](#drora-knowledge-source-1)，但不提供任何真实 Receipt | 应答正常渲染，伪造链接不变成可信来源按钮、点击不派发 drora:knowledge-citation-open，也不更改 hash；该负例不能代替 G41 正向真实 Vault 回跳 | Ubuntu Electron CI run [38668209293](https://github.com/CavinHuang/Drora/actions/runs/38668209293)：1/1 通过，工件已上传；Windows/macOS 未验收 |
| G57 | 在相同真实 Electron Agent Session 连续得到两轮模型回放伪造 [1] 和 fragment 链接，第二轮包含列表、引用、行内代码 | 第二轮回复的伪造链接保持非可信；任一轮不得产生可信来源按钮、Receipt 打开事件或意外 URL hash 导航；不把 G57 视为真实 Receipt 正向证据 | Ubuntu Electron CI [38669023497](https://github.com/CavinHuang/Drora/actions/runs/38669023497)：2/2 通过；Windows/macOS 未验收 |
| G58 | 在隔离 E2E HOME 中预置真实 Markdown，Electron UI 选择托管 Vault 后执行真实索引和 FIND | KnowledgeIndexService 从真实文件建立索引、Candidate 指向准确文件并包含原文关键字；不使用模拟 Knowledge 服务或生产 Vault | Ubuntu Electron [38671681092](https://github.com/CavinHuang/Drora/actions/runs/38671681092)：通过（真实索引/查询） |
| G59 | 从 G58 的真实检索候选点击 Inspector 复验后「打开原文」 | prepareEvidence/resolveCitation 当前版本通过；CodeMirror 显示原文件，磁盘内容保持不变。不代表 Agent Turn admission/inline citation 回跳已通过 | Ubuntu Electron [38671681092](https://github.com/CavinHuang/Drora/actions/runs/38671681092)：通过（真实 Receipt/CodeMirror） |
| G60 | G58/G59 原文件已成功检索，Inspector 显示已验证后修改该文件，再点击「打开原文」 | 必须重新 prepareEvidence+resolveCitation；已更改的版本不可按缓存路径进入笔记，Ask 保持激活并标注来源失效，文件始终只在 E2E HOME 内修改并恢复 | Ubuntu Electron [38671681092](https://github.com/CavinHuang/Drora/actions/runs/38671681092)：通过（修改后拒绝打开） |

## 核验回执

每次验收至少保留：系统/版本、测试 Vault 夹具文件列表、执行命令的退出码、UI 截图、关键 ACK reasonCode、CI run URL。不得提交生产 Vault 内容或密钥。

| G61 | 在真实会话中打开 Vault ANSWER 搜索真实索引候选，显式选中并提交给 Agent | 可信 `prepareEvidence + resolveCitation` 之后，保活的真实会话 Composer 接受来源索引与摘录，再回到聊天；不可自行创造 Receipt | Ubuntu Electron [38674667455](https://github.com/CavinHuang/Drora/actions/runs/38674667455)：通过（实际 CLI Session + Vault / Composer 同步 ACK） |
| G62 | 从 G61 的 Composer 原文发送至真实 CLI/Host，模型回放仅输出普通 `[1]` | `evidenceRefs` 经真实 Session admission 复验，完成态 Agent 应答出现有 Receipt 的可信可点击编号；回放模型不携带预签发路径或证明 | Ubuntu Electron [38674667455](https://github.com/CavinHuang/Drora/actions/runs/38674667455)：通过（CLI 权威投影 + 非伪造可信引用） |
| G63 | 点击 G62 的真实可信 `[1]` 来源按钮 | 经过当前 Session/Vault 校验后路由到真正的 VaultView CodeMirror 原文、无写盘；非授权模型伪造链接继续不可回跳 | Ubuntu Electron [38674667455](https://github.com/CavinHuang/Drora/actions/runs/38674667455)：通过（真实引用点击 + 原文只读回跳） |
| G64 | 真实 CLI 已准入的回答已渲染可信 `[1]` 后，在点击前修改原始 Markdown；拒绝后恢复文件，再执行 G63 | 过期来源在点击时重新 resolveCitation，不能打开被修改的笔记；修改后的文件保持原样（无写盘）；恢复为原始 SHA 后同一原始来源可重新验证并回跳 | Ubuntu Electron [38696659954](https://github.com/CavinHuang/Drora/actions/runs/38696659954)：真实 4/4 通过；macOS/Windows [38696660072](https://github.com/CavinHuang/Drora/actions/runs/38696660072) 同套测试成功 |
| G65 | 在真实 Electron 中打开审核视图并等待生产 Knowledge Review RPC 回报 S03 门禁状态 | 显示 S03 NO-GO 提示，L2 开关必须既禁用又未勾选，测试 Vault Markdown 内容不变 | Linux [38698082728](https://github.com/CavinHuang/Drora/actions/runs/38698082728)；Windows/macOS [38698082386](https://github.com/CavinHuang/Drora/actions/runs/38698082386)：真实 Electron 全通过 |
| G66 | 已有真实 Agent Session，在 Vault ANSWER 将当前 Receipt 交给 Composer 后、尚未发送前修改原 Markdown，随后点击发送 | 必须由真实 CLI admission 拒绝旧 Receipt，保留完整 Composer 草稿；没有新的权威对话行或 Agent 回答；源文件不写盘 | Ubuntu Electron [38699452742](https://github.com/CavinHuang/Drora/actions/runs/38699452742) 真实 Agent E2E 5/5 通过（Job 116304280716）；Windows/macOS [38699452739](https://github.com/CavinHuang/Drora/actions/runs/38699452739) 跨平台真实 Electron 通过；CLI guard reason 由单测验证 |

**2026-10-15 最新自动化回执（head `335eb9d8`）**：Linux Electron [38699452742](https://github.com/CavinHuang/Drora/actions/runs/38699452742) 三个独立 Job 成功；Windows/macOS 实际 Electron [38699452739](https://github.com/CavinHuang/Drora/actions/runs/38699452739) 两个 Job 成功；完整 CI [38699452748](https://github.com/CavinHuang/Drora/actions/runs/38699452748) 八个 Job 成功。自动化覆盖与 G01–G55 人工逐项验收不同；后者仍不得标记通过，PR 仍处于 Draft。

**GO 条件**：CI 的 typecheck、lint、知识库相关测试全部通过；G01–G11、G13–G66 在 Windows/macOS 上通过；G12 没有生命周期回归。否则 Draft PR 继续保持未合并。

## 已知不在第一轮承诺范围

- FIND/ANSWER/COMPARE 的独立答案生成服务；当前跨文章回答仅完成“经用户选源 → 全部核验 → 编号来源清单 → 交给现有 Agent”的交接。来源编号仅为模型回答提示，不能宣称已做逐句引用真实性验证或生成内容质量评测。
- 已完成的 Agent 回答在轮尾提供与 CLI UserInputRow / sourceCommandId / turnId 严格绑定的可信来源按钮，点击时重新核验 Receipt 才打开原文。本轮已补上**正文普通段落中的 [1]–[5] 内联点击**（仅 CLI 已归属的来源），由 Vault Host 点击时重新核验；代码/标题/链接/表格不改写，对模型逐句事实正确性仍不作保证；没有行级凭据的旧转录不会凭文本补造来源。Composer 已附加的可信引用 chip 支持点击时重新核验并打开 Vault 原文，两者不要混淆。Composer 发送前只做编号清单与当前凭据的一致性保护，不能代替 CLI 的可信证据验收。
- Jev 实际 Provider 调用与重排效果评测。
- Review L2 diff/approve/undo 写入和 S03 复审。
- 候选卡的「就此追问」侧会话仍走普通选区引用语义，不将其声称为 Receipt 可信链路。与此不同，「上一轮 → 加入 Agent」是同 Session 的显式可信证据重新核验流程。


## 2026-10-17 · Automated self-review coverage supplement

Per the maintainer's instruction, the remaining work is reviewed and verified through automated tests rather than a manual walkthrough. The current case-to-test mapping is in [AUTOMATED_SELF_REVIEW_2026-10-17.md](./AUTOMATED_SELF_REVIEW_2026-10-17.md). In particular:

- G35/G42: distinct Receipt isolation across two source notes and cross-session rejection.
- G45: duplicate citation-open request single-flight, timeout, and ignored late success.
- G54: second-read full-file SHA mismatch is rejected even when the quote excerpt still matches.
- G65/G67: real Electron confirms L2 proposal/preview/approval while production write toggle, Apply, and Undo stay disabled under A1/S03 NO-GO.

This supplement does not mark unrelated, untested cases as passed. Real Electron evidence is labeled separately from unit/service integration coverage. The formal S03 NO-GO remains unchanged.
