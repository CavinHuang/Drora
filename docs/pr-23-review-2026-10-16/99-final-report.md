# PR #23 独立评审报告（2026-10-16）

- **被审对象**：PR #23 `feat/obsidian-knowledge-e2e` → `main`（feat(obsidian): unified VaultView knowledge, evidence handoff and review）
- **审查基线**：PR head 提交 `ce86499fa0cf6ae7238898e6a6966dccf16a0720`（合并基 `7ced6f898070eaae63822f4ae97d635c3dfb1567`，diff 90 文件 +8543/-410）
- **评审方式**：13 路独立审查员分域审查 + 逐发现交叉复核（复核证实/未复核/复核不成立三态）+ 评审主席对关键争议项亲自只读定夺。全部证据来自只读命令（`git show`/`git diff`/`git grep`/`gh api`/`gh pr view`/`gh pr checks`），未 checkout、未修改工作区、未重跑测试。
- **评审期间实测的关键事实（均主席本会话亲测，命令与输出见附录 7.2）**：① 基线 `ce86499` 上 CI/Cross-platform/Provenance 三个必需工作流 run 全部 `cancelled`（仅 Website `success`）；② PR head 已漂移至 `873cd961a66a51159edf39ce44b13d90f6713e61`（当日 14+ 次前移），其 checks 全部 `pending`；③ PR 已转 Ready for Review（`isDraft=false`）而正式 review 数为 0、review request 为 0。本报告结论针对基线 `ce86499`；基线外增量（`dc153a3`…`873cd961`）不在任何审查范围内。

---

## 一、结论速览（判定 + 一段话理由 + 审查基线）

**判定：NO-GO（当前时点、审查基线 `ce86499` 不可合并）。**

代码本体质量高：13 路审查与交叉复核未发现任何 high 级缺陷或安全旁路——「来源安全与 L2 门禁」组对六个安全声称（伪造来源拒绝、session/workspace/turn/receipt 四维绑定、全场景 fail-closed、receiptId 不泄漏模型、L2 生产默认关、G66 行为匹配）做攻击性证伪后**全部成立**；可信交接链（发送复验→排队→提升复验→投影→持久化→冷恢复→edit/retry 复验→完成态 `[n]`→回跳二次读校验）逐环闭合且处处比旧宿主更严格；自动化测试是真实行为测试而非空转（回放服务器未匹配请求 500 fail-closed、生产 manifest 头钉死传输链、真 Electron 进程重启、隔离 `.e2e-home`）。**但合并被流程与验收门禁全面阻塞**：PR 自定四条「合并前必须关闭」没有一条真正关闭——G01–G55 人工验收零执行且 R1–R9 裁剪未获批、S03 独立安全复评仍 NO-GO 且安全负责人 L2 排除签署未完成、独立 Reviewer 正式 review 为 0（作者反而在条件未满足时将 Draft 转为 Ready，违反自身条件 4）、审查基线上三个必需工作流全部 cancelled 且 head 当日 14+ 次漂移（当前 `873cd961` checks 全 pending）——按 PR 自身规则「缺少证据即未通过、旧/新结果不混算」，这些门禁不能由代码审查替代放行。另有 spec 与实现五处直接矛盾（含把「宿主未注入 gate」从 additive 改为 fail-closed 未改 spec、spec 明文「不新增提案生产者」却新增了生产入口）违反 AGENTS.md「先更新 spec」。**NO-GO 不是对代码质量的否定，而是流程门禁与验收证据链未闭合；关闭第二节阻塞项后可重新提请合并。**

---

## 二、最终判定与阻塞项/条件

### verdict：**NO-GO**

### 阻塞项

**流程门禁（不得由代码审查替代放行）：**

1. **B1｜G01–G55 人工验收未执行、裁剪方案未获批。** 验收矩阵 G01–G55 共 55 行执行记录全部「未执行」（本人 grep 亲测基线版 SMOKE 矩阵，G05/G06/G07/G12 行逐一确认）；R1–R9 风险优先裁剪包（评论 6209475838 §B）须维护者明确批准方可取代 55 项全量，评论 6209580588 复选框未勾；Windows/macOS 无任何人工回执。对应 PR body「合并前必须关闭」第 2 条。
2. **B2｜独立 Reviewer 正式 Review 为零。** 本人亲测 `gh pr view 23 --json reviews,reviewRequests` → `{"reviews":0,"reviewRequests":0}`；评论 6209664666 记录 Request reviewers 因 422（非 collaborator）失败、需管理员指定合格协作者。本报告（13 路审查 + 复核）是评审输入，**不构成** GitHub 流程意义上的正式 Review 签收。
3. **B3｜S03 独立安全复评仍 NO-GO，安全负责人「L2 排除且继续 fail-closed」发布例外签署未完成。** `specs/obsidian-knowledge.md:1022`（主席亲读：「S03 门禁仍是 NO-GO……生产 L2 写入必须保持关闭」）；`WRITE_SAFETY_NO_GO.md` 未被有权审核人撤销；A1（评论 6209580588）仅是管理员范围批准且明言「未授权立即合并」，其自列的「安全负责人签署 L2 排除」复选框未勾。走 L0/L1+L2 排除路径必须补此签署。
4. **B4｜不存在「同一最新 SHA 全绿」的 CI 证据，head 持续漂移。** 本人亲测 `gh api "repos/CavinHuang/Drora/actions/runs?head_sha=ce86499f…"`：CI 38869599104、Cross-platform 38869599066、Provenance 38869599050 均 `cancelled`（attempt=1；PR 引用的绿色 run head_sha 均为早 3 提交的 `666ea735`，基线上的 L2 增量三提交 6d1db892/63bf2f5f/ce86499 无任何完整 CI 记录）；本人亲测 `gh pr checks 23`：当前 head `873cd961` 的全部 checks `pending`。取消机制为分支快速推送触发 `cancel-in-progress`（三工作流同构 concurrency 配置），属验收证据缺口而非已证测试失败。违反 PR「合并前必须关闭」第 1 条与「旧/新结果不混算」——任务说明中「该 head CI 全绿」与 Actions API 记录不符，本报告以 API 记录为准。
5. **B5｜PR 已在条件未满足时擅自转 Ready，违反自定纪律；验收锚点持续失效。** 本人亲测 `gh pr view 23`：`isDraft=false`、head=`873cd961`（评论时间线显示当日 `1f1a457`→`666ea735`→…→`dc153a3`→…→`873cd961` 至少 14 次前移）。PR body 条件 4 要求「完成正式 Review/验收后再将 Draft 变为 Ready」；评论 1 §D 要求「基线 SHA 未变」、评论 3 明言「Merge decision remains: HOLD/Draft」。
6. **B6｜typecheck / lint / architecture:check 在基线上无完成执行记录。** 基线 CI run cancelled（B4），AGENTS.md「必须执行 `pnpm typecheck` 和 `pnpm lint`」在本基线无任何已完成 run 佐证；`ci.yml` 不含 architecture:check 且无其他执行记录（standard-9，未复核）。本人未在工作区重跑（工作区检出 main 且禁止 checkout）——如实报告：未运行。

**文档/一致性修复（合并前应关闭，均可在最终 head 一次修复随 CI 复验）：**

7. **B7｜spec 与实现五处矛盾（AGENTS.md「新增或修改行为前先更新对应 spec」）。** ① `specs/obsidian-knowledge.md:152`「宿主未注入 gate → 不复验（additive 演进）」vs `apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/commands/handlers/evidence-admission.ts:44-50` fail-closed 抛 `guard.evidenceForbidden/"gate_unavailable"`（主席亲读 spec 原文；四路发现、三路复核证实；`types.ts:237-238` JSDoc 同段自相矛盾）；② `spec:1031/1017`「本阶段不新增提案生产者/当前无提案生产者入口」vs `KnowledgeReviewProposalComposer.tsx:40` `await reviewService.createProposal(params)`（主席亲读 spec；两路复核证实；修复提交 dc153a3 在基线外，最终 head 须重核）；③ `spec:481`「加入 Agent 不是 Receipt、不获执行时复验」vs `useKnowledgeAgentActions.ts:89`/`usePreviousKnowledgeActions.ts:78` 携带 `evidenceReceiptId` 全链复验（复核证实）；④ `spec:1040`「以 G01–G30 为最终人工验收矩阵」vs SMOKE 实有人工矩阵 G01–G55、MERGE_READINESS:48/RELEASE_CANDIDATE_SCOPE:60/PR body 均 G01–G55 口径（主席亲读；normative spec 少认 25 个人工用例）；⑤ spec 双 `## 5f` 编号冲突（999 行 W09 章与 1054 行 agent VaultSearch 章，5f.1–5f.3 子节成对重复，主席 grep 亲测）。
8. **B8｜PR 描述声称的 G67 测试不在审查基线。** `git grep "G67" ce86499`（复核证实）除 base64 偶然子串零命中；基线 `obsidian-knowledge-positive.test.ts` 仅 G58/G60/G65；G67 由基线外 `dc153a3` 引入。PR 描述与被审代码不一致；最终 head 须核验 G67 实际执行日志（不得以 job success 替代 test log）。
9. **B9｜生产 UI 硬编码「S03 门禁已 GO」并引用不存在的 spec 文件。** `packages/ui/src/i18n/locales/zh-CN.ts:7363`、`en-US.ts:7731-7732`（渲染于 `KnowledgeReviewView.tsx:321`）称「S03 门禁已 GO，见 specs/write-safety-gating.md」——该文件不存在（真实裁定在 `docs/vaultview/delivery/WRITE_SAFETY_NO_GO.md`）、`spec:1022` 明文 NO-GO、生产 `writeSafetyGatePassed` 恒 false，与同屏 `s03GateBlocked` 警告（:323-325）矛盾陈述。运行时防线完整（开关/按钮禁用+服务端拒绝），纯文案风险（ui-lib-2 复核证实）。

### 转 GO 路径（关闭上列阻塞后）

1. 分支停止漂移，在最终 head 上三个工作流完整跑完且全绿，核验 G67/WDIO 原始日志实际执行且 PASS；
2. 维护者正式批准 R1–R9 裁剪（或指定扩展项），在独立临时 Vault + 非生产 Profile 上完成 Windows、macOS 各至少一轮人工验收并留回执；
3. 独立 Reviewer 出具正式 GitHub review 结论；安全负责人签署「L2 排除且继续 fail-closed」首发限定范围（不是 S03 GO）；
4. 修正五处 spec 矛盾、验收口径（G01–G55）、双 §5f 编号与「已 GO」文案；
5. 处理第五节 medium 级代码项（reconcile UI 入口、混合输入静默降级提示、提案表单 i18n、"evr_" 单一出处）。

---

## 三、合并条件核对表

### (a) PR 描述「合并评审速览」+「合并前必须关闭」四条

| # | 条件 | 判定 | 证据 |
|---|------|------|------|
| 速览-最新 HEAD | `fdf807a1`、Ready for Review 未合并 | **过期且违反纪律** | 主席亲测 head 已是 `873cd961`（速览两次过期）；`isDraft=false` 违反条件 4（B5） |
| 速览-L0/L1 首批范围 | A1 已批准 | **满足** | 评论 6209580588（管理员原话「批准 A1……不要直接合并」） |
| 速览-L2 本轮交付 | 提案 create/write/delete、预览、审批 | **部分满足（基线上）** | 基线含人工提案入口（祖先提交 6d1db892）；但 spec:1031 矛盾未同步（B7②），后续 L2 apply/undo 功能增量全部在基线外、未经本审查 |
| 速览-强制写安全 | S03 NO-GO、apply/undo 不可操作 | **代码满足/文案缺陷** | 生产装配三处不传 `writeSafetyGatePassed`（`node.ts:2604-2616` 等，安全组证实）；UI 文案误称「已 GO」（B9） |
| 速览-新增自动化 | G67 测试纳入 | **不满足（基线）** | G67 不在 `ce86499`（B8）；`knowledgeReviewProposalInput.test.ts` 纳入 CI 属实（`ci.yml:36`） |
| 速览-最新 CI | 运行中/待最终结论，须核实 G67 日志 | **不满足** | 基线 run 全 cancelled、当前 head checks 全 pending（主席亲测，B4） |
| 速览-人工/独立 Review | 尚未签收 | **不满足（如实）** | reviews=0（主席亲测）；PR 自认 |
| **必须关闭 1** | 同一最新 SHA 完成所有必需 CI/Electron | **不满足** | B4（主席亲测 Actions API + `gh pr checks`） |
| **必须关闭 2** | G01–G55 用户可达场景人工验收，证据截图可追溯 | **不满足（需人工）** | SMOKE 55 行全「未执行」；R1–R9 未批准；无 Win/mac 回执（B1） |
| **必须关闭 3** | S03 独立复评未撤销 NO-GO；L0/L1+L2 排除须显式批准受限范围 | **部分满足/需人工签核** | A1 已显式批准 L0+L1+L2 排除范围（评论 6209580588）；但安全负责人 L2 排除签署未完成、S03 NO-GO 未撤销（B3）——若维持 L2 排除路径，不强制 S03 GO，但须签署承接 |
| **必须关闭 4** | 正式 Review/验收完成后才转 Ready；不自动合并 | **已被违反** | `isDraft=false` 且 reviews=0（主席亲测，B5）；未合并/未部署属实 |

### (b) PR 三条核心评论中的门禁（实得 11 条评论，任务所指三条为核心；其余 8 条为基线外 L2 增量交付更新，作 head 漂移证据）

| 来源 | 门禁 | 判定 | 证据 |
|------|------|------|------|
| 评论 6209475838 §A | A1/A2 二选一并由维护者签名 | **满足** | 评论 6209580588 确认 A1（L0+手动编辑+L1 opt-in；L2 继续禁用） |
| 评论 6209475838 §B/C | R1–R9 裁剪须维护者明确批准 + Win/mac 各至少一轮人工回执 | **不满足（需人工）** | 裁剪复选框未勾（评论 6209580588）；无任何回执；SMOKE 矩阵全「未执行」 |
| 评论 6209475838 §D | 独立 Reviewer 正式 review（作者自检不算） | **不满足（需人工）** | reviews=0（主席亲测）；422 失败后未重新分配（评论 6209664666） |
| 评论 6209475838 §D | 安全负责人签署「L2 排除且继续 fail-closed」 | **不满足（需人工）** | 评论 6209580588 未勾项 |
| 评论 6209475838 §D | 维护者批准 + 收齐人工记录 + **基线 SHA 未变**；改代码重跑完整 CI | **不满足** | head 当日 14+ 次前移至 `873cd961`；CI 无闭合证据（B4/B5） |
| 评论 6209580588 | A1 批准但「未授权立即合并」；保持 Draft/HOLD，不伪造人工 PASS/Reviewer APPROVE | **纪律被违反** | 已转 Ready（B5）；未直接合并（合规部分） |
| 评论 6209664666 | 当前 HEAD 新 CI 完成前不得引用上一 SHA 绿色结论放行 | **不满足** | 当前 head checks 全 pending（主席亲测）；PR 速览仍引用 `fdf807a1` 时点「运行中」run |

### (c) 本仓 AGENTS.md 工程合并标准（以 `ce86499` 版为准；本 PR 未改动 AGENTS.md）

| 标准 | 判定 | 证据 |
|------|------|------|
| spec 先行 | **不满足（多处）** | B7 五处矛盾 + edit/retry/canonical-replay 复验接线与 createRun 幂等拒绝语义未回写 spec（standard-4，low） |
| 必须执行 `pnpm typecheck`/`lint` | **基线上无法证实** | 基线 CI run cancelled（B4）；其他 SHA 的绿按 PR 自身规则不得替代；本人未重跑（工作区检出 main、禁止 checkout）——未运行 |
| 行为改动先补测试 | **基本满足** | 15 UI vitest + 5 node 测试 + 3 WDIO 真 Electron spec 均为行为断言（测试组逐项核实）；缺口：ProposalComposer 交互基线内无测试（standard-7）、审核视图无组件测试（ui-knowledge-a-8）、G66 断言弱（acceptance-3） |
| 交互改动需要 E2E | **基本满足** | G56–G66 覆盖伪造/托管 Vault/交接/真进程重启；缺口：负向断言用固定 sleep 一次性检查（acceptance-4） |
| 契约键单一出处 | **部分不满足** | `knowledgeTurnCitations.ts:61` 手写 `"evr_"`（主席亲读，违反 `knowledge-evidence.ts:23` 唯一定义处及文件头禁令）；`ConversationTurnGroup.tsx:1634` 手写 manifest 表头（主席亲测 grep） |
| UI 经 hooks/IPlatformService，不直调 `window.drora` | **满足** | 多路审查 grep 零命中生产直调 |
| 架构检查 `architecture:check` | **未验证** | ci.yml 不含该步骤、基线上无执行记录（standard-9，未复核）；本人未运行 |
| 删除功能同步清理 | **不满足（轻微）** | 约 12–16 个死 i18n 键（三批：`chat.evidence.*` 等 9 键主席亲测零消费者、旧附件 4 键、旧审核 3 键） |
| 日志规范 | **满足** | 新增代码零 `console.*`/`window.drora?.log`（多路 grep） |
| 门禁平台强制力 | **不适用/缺失** | main 无分支保护（acceptance-6 未复核：404），全部检查为报告性，强制力仅靠流程纪律——而该纪律已被 B5 证明出现松动 |

---

## 四、功能完整性结论（五大能力域）

| 能力域 | 结论 | 断点/缺口位置 |
|--------|------|---------------|
| ① 真实 Vault（授权/目录树/CodeMirror/SHA 乐观锁/行锚定） | **完整** | `vault-fs.ts:59-75,286-289` SHA 乐观锁、本地/托管授权、`vault-quote-reveal.ts` 锚定、二次读校验（`VaultView.tsx:1392-1396`）均落地（完整性组+安全组核证）；无断链 |
| ② Knowledge（索引/中英文 FIND/多源选择/上一轮重核验/幂等单飞） | **完整** | ANSWER 1–5/COMPARE 2–5 显式多选 all-or-nothing（`knowledgeAgentHandoff.ts:124-130`）、singleflight 有真实并发测试、Jev 生产默认关；low 级缺口：上一轮「打开」缺 `validateRead` 二次读回（`usePreviousKnowledgeActions.ts:70`，未复核） |
| ③ 可信 Agent 交接链 | **完整（含三处 UX 级降级断点）** | 全链逐环闭合（admission `session-flow.ts:79` → 队列提升 `queue.ts:195` → guide 强制回退 → edit/retry 复验 `fork-edit-retry.ts:134,317` → 投影 → 冷恢复 `transcript-hydration.ts:433-436` → nonce `[n]` → 回跳二次读校验；CLI 组核实）。断点：a) 混合「可信引用+普通选区」完成态引用静默消失（`knowledgeTurnCitations.ts:59` 计数门，复核证实+主席亲读）；b) 6–8 条合法 evidenceRefs 整组丢失（`:56` 上限 5 vs 契约 8，主席亲读）；c) renderer 重载后未发送草稿的 receipt 丢失、发送永久禁用无恢复入口（`ConversationComposer.tsx:872-886`，未复核）；另 edit/retry 截断后二次复验窄窗口竞态（`fork-edit-retry.ts` → `canonical-intent-replay.ts:66`，主席亲读顺序证实，fail-loud） |
| ④ 来源安全（防伪造/四维绑定/fail-closed/receiptId 不泄漏） | **完整** | 六条安全声称攻击性证伪全部成立：receipt 仅服务端签发、渲染面只信 CLI 投影、nonce 模型输出后铸造、guide/steer/side-session/auto-drain 旁路面逐一排查无绕过、userselect 白名单只含 `{text,path}`；无断点（spec 文档滞后不改变代码行为） |
| ⑤ Review/L2（提案/审批/预览/账本/双条件硬门/S03 NO-GO） | **部分** | 双必要条件写门（`reviewEngine.ts:119-123`）+ 生产装配不传 gate（`node.ts:2604-2616`）+ UI 双禁用（`KnowledgeReviewView.tsx:419/447`）+ 重新授权清除偏好 + 持久化 true 不可恢复写权限（测试锁定）均完整。断点：a) **reconcile 动作无 UI 入口**（接口在 `reviewService.ts:74-81`、视图零调用，复核证实 medium；基线外后续提交声称补 live reconciler，不在审查范围）；b) 人工提案入口与 spec:1031 矛盾（B7②）；c) S03 文案误称已 GO（B9）；d) undo 按钮状态边界（low，未复核）；e) `setVaultReviewWritePathEnabled` 与重授权并发丢更新竞态（主席亲读证实，low、生产 NO-GO 下难触发） |

PR 描述五大能力声称与基线代码**总体相符、主链无夸大**；「G67 自动化」为唯一基线外声称（B8）。

---

## 五、分领域发现明细

去重说明：4 组跨审查员重复发现已合并（spec:152 四路、spec:1031 两路、spec:481 两路、提案表单 i18n 两路、manifest 表头两路、上限 5/8 两路、死键两路）。复核状态：✔复核证实＝交叉复核确认；◎主席亲证＝本会话亲自读码/跑命令确认；△未复核＝单组低危发现，按其证据采信并保留不确定性。

### A. 规格/文档与实现矛盾（spec 先行）

| 编号 | 严重度 | 状态 | 内容与证据 |
|------|--------|------|-----------|
| A-1 | medium/doc | ✔◎ | `spec:152-153`「不复验（additive）」vs `evidence-admission.ts:44-50` fail-closed 抛错（主席亲读 spec 原文与 diff：基线为 `return` 放行，本 PR 改为抛 `forbidden/"gate_unavailable"`；测试同步翻转但 spec 未改）。即 B7① |
| A-2 | medium | ✔◎ | `spec:1031/1017` vs `KnowledgeReviewProposalComposer.tsx:40`（主席亲读 spec 两行；代码先落 6d1db892、spec 修复 dc153a3 在基线外）。即 B7② |
| A-3 | medium/doc | ✔◎ | `spec:481` Receipt 旧语义 vs 实现携带 `evidenceReceiptId` 全链复验（主席亲读；该段为 PR diff 未改动上下文行，同 PR 新增 §5f.1 直接矛盾）。即 B7③ |
| A-4 | medium/doc | ✔◎ | `spec:1040` G01–G30 vs 全库 G01–G55 口径（主席亲读；merge-standard-1 复核证实 SMOKE 66 行中恰 55 行人工「未执行」）。即 B7④ |
| A-5 | medium/doc | ✔ | `writePathToggleHint` 硬编码「S03 门禁已 GO」+ 引用不存在的 `specs/write-safety-gating.md`（`zh-CN.ts:7363`/`en-US.ts:7731-7732`，渲染于 `KnowledgeReviewView.tsx:321`，与 :323-325 警告同屏矛盾）。即 B9 |
| A-6 | low/doc | ◎ | spec 双 `## 5f` 编号冲突（999/1054 行，子节 5f.1–5f.3 成对重复：1001/1061、1010/1077、1020/1096；主席 grep 亲测）。即 B7⑤ |
| A-7 | low/doc | △ | SMOKE G61–G66 表行挂在「核验回执」节下、脱离「GUI 实操验收矩阵」节（merge-standard-3） |
| A-8 | low/doc | △ | `W09_DELIVERY.md:49` 演示路径仍指已替代的旧 UI 入口与生产不可达 L2 路径（merge-standard-4） |
| A-9 | low/doc | ◎ | SMOKE G05/G06/G07/G12 行「未执行」与文档头部/PR 评论自动化 passing 口径不一致（主席亲测 grep）。即 acceptance-5 |
| A-10 | low/doc | △ | `knowledgeServices.ts:207-208` 注释称生产异步加载初值，实际该分支以 gate=true 为前提、生产永不发生（services-2） |
| A-11 | low/doc | △ | `input-intent.ts:98` 注释「edit/retry 不继承」与实现继承并复验相反（cli-2） |
| A-12 | low/standard | △ | edit/retry/canonical-replay 复验接线与 createRun 幂等拒绝语义未回写 spec（standard-4） |

### B. 验收证据与 CI 门禁

| 编号 | 严重度 | 状态 | 内容与证据 |
|------|--------|------|-----------|
| B-1 | 阻塞组成 | ✔◎ | 基线三工作流全 cancelled、被引绿 run 全挂 `666ea735`、基线上 L2 增量三提交无完整 CI 记录（主席亲测 Actions API）。即 B4 |
| B-2 | medium/test | ✔ | 两 Electron 工作流 `paths` 遗漏 `evidence-admission.ts`、`packages/services/src/knowledge/**`、`obsidian-vault/config.ts`、`ConversationComposer.tsx`、`conversationSelectionReference.ts`、`transcript-hydration.ts`（acceptance-2 复核证实两清单）——本 PR 刚在 `0b3c32e` 修过 transcript-hydration 漏回填，同类回归将失去 Electron 级防线。缓解：ci.yml 无 paths 过滤仍有单测/接线级防线。即条件 C2 |
| B-3 | medium | ✔ | G67 不在基线、基线外 L2 增量未经审查（completeness-3 复核证实）。即 B8 |
| B-4 | low/test | △ | G66 未断言 SEND_FAILED 错误面与 guard 码，无法区分 CLI 拒绝与渲染层吞发送（acceptance-3） |
| B-5 | low/test | △ | G64/G12 重启 helper 用 `pause(1800)` 后一次性检查「无导航」，慢 runner 下迟到导航漏检——绿≠测到（acceptance-4） |
| B-6 | low/standard | △ | main 无分支保护，全部检查非 required，门禁无平台强制力（acceptance-6） |
| B-7 | low/standard | △ | 基线上无 architecture:check 执行记录（standard-9） |
| B-8 | low/test | △ | 新增动态 i18n 键族未纳入 A21 纪律测试动态键族清单（standard-5；实测本 PR 新增键双语无缺失） |

### C. 契约单一出处（AGENTS.md 明文规则）

| 编号 | 严重度 | 状态 | 内容与证据 |
|------|--------|------|-----------|
| C-1 | medium/standard | ✔◎ | `knowledgeTurnCitations.ts:61` 手写 `"evr_"`（主席亲读全文：import 区仅 `UserInputRow` 与 `KNOWLEDGE_SOURCE_MANIFEST_HEADER`；定义处 `knowledge-evidence.ts:23`，文件头明文禁止第二份；全仓生产代码仅此一处手写） |
| C-2 | low/standard | ◎ | `ConversationTurnGroup.tsx:1634` E2E 诊断属性手写 manifest 表头中文字面量（主席亲测 grep 恰两处：常量定义+此手写；两组发现合并） |
| C-3 | low/bug | ◎ | `knowledgeTurnCitations.ts:56` 读取端上限 5（魔数）vs wire 契约上限 8（`MAX_EVIDENCE_REFS_PER_INPUT`/`CONVERSATION_SELECTION_MAX_COUNT`；两组发现合并；主席亲读）。合法 6–8 条整组静默丢失，与 handoff ≤5 约束不一致 |
| C-4 | low | △ | 基线遗留（非本 PR 引入）：`command.ts:116-126` 内联重复 schema 形状、`session.port.ts:399-401` 注释与手写类型不符——提示后续收口 |

### D. UI 功能与体验缺口

| 编号 | 严重度 | 状态 | 内容与证据 |
|------|--------|------|-----------|
| D-1 | medium/completeness | ✔ | reconcile 无 UI 入口：接口存在（`reviewService.ts:74-81`）但 `KnowledgeReviewView.tsx` 零调用，apply 返回 `reconcile_required` 后 UI 内无解除路径，与 spec §5f.2「全链人工动作」矛盾（复核证实；基线外后续提交声称补齐，最终 head 须重核） |
| D-2 | medium/completeness | ✔◎ | 混合「可信引用+普通选区」合法输入完成态引用链静默消失：`knowledgeTurnCitations.ts:59` 计数门必然不等，manifest 校验不拦、CLI schema 不拦、无任何提示（复核证实六环复现链；主席亲读计数门），与 spec「不得静默降级」相悖 |
| D-3 | medium/standard | ✔ | 提案表单 7 条校验错误硬编码英文直出（`knowledgeReviewProposalInput.ts:26/30/33/36/40/44/53` → `KnowledgeReviewProposalComposer.tsx:45`；两组发现合并均复核证实），违反 spec §5f.5 WSG-UI-5 双语声明 |
| D-4 | low/completeness | △ | renderer 重载后未发送草稿的 receipt 引用丢失：引用只存模块级内存 Map，草稿文本跨刷新持久化；重载后 manifest 判 mismatch、发送永久禁用、无恢复入口（`ConversationComposer.tsx:872-886/1299/2507`；ui-citation-a-3） |
| D-5 | low/bug | △ | 上一轮「打开」仅传两参，缺 `isCurrent/expectedExcerpt/expectedFileSha256`，跳过 validateRead 二次读回，防护强度低于当前轮五参路径（ui-knowledge-a-6） |
| D-6 | low/bug | △ | undo 按钮对非 applied 提案一律可点，与 spec「undo（applied）」边界不符（`KnowledgeReviewView.tsx:441-452`；ui-knowledge-a-5） |
| D-7 | low/standard | △ | 引用覆盖审计每次渲染全量重算无 useMemo（`KnowledgeAnswerSources.tsx:32`；ui-knowledge-a-7） |
| D-8 | low/standard | △ | `usePreviousCandidate` use 前缀非 hook、JSX 内联回调中调用（ui-knowledge-b-3） |
| D-9 | low/standard | △ | `SessionPane.tsx:3560,3596` 两行 evidenceRefs 缩进漂移违反 oxfmt（ui-citation-a-1，审查员以 oxfmt 副本 diff 验证） |
| D-10 | low | △ | Agent handoff prompt 指令行硬编码中文（表头常量须固定，指令行可本地化未做；ui-knowledge-a-4） |
| D-11 | low/completeness | ◎（chat.evidence.* 部分） | i18n 死键三批：`chat.evidence.*` 等 9 键（主席亲测零消费者）+ 旧附件 4 键 + 旧审核视图 3 键，违反「删除功能同步清理」（两组发现合并） |
| D-12 | low/test | △ | 审核视图无任何组件级测试，spec §5f.5 却以「审核视图测试」为验证来源（两组发现合并；基线外 G67 部分补齐，须核验） |

### E. 服务端低危缺陷

| 编号 | 严重度 | 状态 | 内容与证据 |
|------|--------|------|-----------|
| E-1 | low/bug | ◎ | `obsidian-vault/config.ts` `setVaultReviewWritePathEnabled` 读-改-写无版本比对，与 `configureVaultAt` 重授权并发丢更新（主席亲读全文：两条写入路径无共享锁；进程内 preferenceWrites 串行不覆盖 configure 路径）。生产 NO-GO 下 UI disabled，仅 RPC 直达 |
| E-2 | low/bug | ◎ | edit/retry rewind 截断后的二次复验窄窗口竞态：`fork-edit-retry.ts:134`（注释明言「引用失效要在截断历史之前暴露」）→ rewind → `canonical-intent-replay.ts:66` 再复验（主席亲读顺序证实）；retry 同型。失败为 fail-loud ACK，残留竞态而非回归 |

### F. 上游对齐与还原文件纪律

| 编号 | 严重度 | 状态 | 内容与证据 |
|------|--------|------|-----------|
| F-1 | ~~medium~~ → low/doc | ◎定夺 | **standard-3 原判复核不成立，主席裁定降级**。原指控：`message.tsx` 内联 6+ 处自研接线超出「最小接缝」。定夺依据（主席亲证）：① `ce86499` 版 AGENTS.md「上游对齐」章节（49-59 行）grep 无「最小接缝（单处 import 或单处分支）/接缝须在 spec 记录」条款——该措辞仅存在于评审时点工作区未提交的 AGENTS.md 改动，属事后规则回溯，不适用于本 PR；② `message.tsx` 头注为 `Derived from vercel/ai-elements…Modified by Drora`，非「还原自发行 bundle」还原文件；③ 同类集成模式（import 自研 remark plugin/prop/缓存键）在合并基 `7ced6f89` 已确立，本 PR 沿用且自研主体在独立新文件 `lib/knowledgeCitationMarkdown.ts`（145 行）。残余缺口仅为 spec 未记录该集成点（文档性） |

### G. 正面结论（经独立复核证实，无发现）

- 六条安全声称全部成立（见第四节④）；L2 关闭竞态/切库/异步加载窗口/多实例/幂等回放五场景推演无提权路径。
- 测试工程「模型回放、其余真实链路」声称经机制核实成立（replay server fail-closed、生产 manifest 头钉死、真进程重启+同 userData 断言、`.e2e-home` 沙箱）。
- 架构边界（服务经注入、无 `window.drora` 直调、Main 零 diff）、日志规范、Zustand 无越权、DESIGN token 复用、异步 IO——各专项组均未发现违反。

---

## 六、未覆盖与残留风险

1. **人工验收（最大空白，流程门禁）**：G01–G55 全部未执行。其中 CI 永远无法覆盖、必须真人/真机：真人感知类（G53/G55 焦点/滚动/选区、G02 中文检索相关性、G23 人工核对）；真实 Provider（固定 SSE 回放按 PR 自身规则不得替代真实模型输出形态）；真实 Obsidian 授权/多窗口/系统行为与真机 Win/mac 体验；依赖手速/挂起时序的 R4（G08 Busy GUI 队列、G09 二次签发）、R8（G45/G46/G52 并发迟到 epoch）、R9（G47/G54 二次读取 SHA 与未存草稿）；安全签核（G32 真机手改配置、L1 真实 Runtime ask 与 Bash/MCP 旁路披露、S03 独立复评与独立 Reviewer 正式 Review）。
2. **审查范围局限**：① 基线 `ce86499` 之后的 14+ 提交（dc153a3 G67/spec 修复、09558a1/f642ade L2 P0 TTL/ownership/crash-safe、57a001c SIGKILL fixtures、a2f29b8/82098a5 reconciler、66cb904 apply/undo 功能 pass 等）完全未经本 13 路审查覆盖——其中 L2 写路径并发/崩溃恢复属安全敏感面，合并前必须在最终 head 重新独立审查；② 13 路审查均为静态阅读 + CI 事实核对，未重跑任何测试（工作区检出 main 且禁止 checkout；任务给定「CI 全绿」与 Actions 记录冲突，已以 API 实查为准）；③ 混合输入降级（D-2）、6–8 条引用丢失（C-3）为静态推演，无动态复现；E-1/E-2 竞态窗口未做并发实测。
3. **平台强制力缺失**：main 无分支保护、无 required checks（acceptance-6，未复核），全部门禁强制力依赖流程纪律——而 PR 已在条件未满足时转 Ready（B5），证明该纪律已松动。
4. **当前 head CI 未落定**：`gh pr checks 23` 评审时全 pending，最终结论在本报告之后产生，须另行核验；G56/G57（伪造来源负向）从未在 Windows/macOS 运行（doc:85-86 如实标注）。

---

## 七、附录：审查方法与覆盖

### 7.1 审查员配置（13 路）

| # | 领域 | 核心覆盖 |
|---|------|---------|
| 1 | 测试与 CI 验收 | ci.yml、两个 Electron 工作流、3 WDIO spec、重启 helper、SSE fixture、Actions API 实查 |
| 2 | CLI 协议链路 | evidence-admission/fork-edit-retry/canonical-intent-replay/session-flow/投影与持久化 13 文件 |
| 3 | 合并标准与规格 | spec §5f/§5c.3、SMOKE/MERGE_READINESS/RELEASE_CANDIDATE_SCOPE、PR 评论核实 |
| 4 | Knowledge 服务 | reviewEngine 双门、config 偏好、queryOrchestrator singleflight、evidenceRegistry |
| 5 | 共享协议契约 | rows.ts/knowledge-evidence.ts/input-intent schema 单一出处、CLI 投影链 |
| 6 | 会话引用链 UI（a） | Composer 发送链、[n] 投影、nonce、回跳、i18n |
| 7 | 会话引用链 UI（b） | 同域独立第二路：混合输入、spec 矛盾、渲染安全 |
| 8 | 知识面板 UI（a） | Ask 流程、Review 面、L2 开关、完成态来源面板 |
| 9 | 知识面板 UI（b） | 同域独立第二路：证据核验、handoff 全或无、竞态守卫 |
| 10 | UI 基础与国际化 | conversationSelectionReference/knowledgeSources/citationMarkdown/message.tsx/WorkspaceShellLayout/i18n 键对等 |
| 11 | 功能完整性核查 | 五大能力域端到端断环检查、PR 声称逐条对码 |
| 12 | 来源安全与 L2 门禁 | 六条安全声称攻击视角证伪、旁路面排查 |
| 13 | 合并标准核查 | AGENTS.md 逐条、上游对齐、契约键、head 漂移 |

每路产出总结、完整性核对与 findings；medium 级发现经第二人复核（复核意见全文在案），low 级多为单路发现（表中标注 △）。

### 7.2 评审主席本会话亲自执行的命令与结果

| 亲证点 | 命令 | 结果 |
|--------|------|------|
| 基线 CI 状态 | `gh api "repos/CavinHuang/Drora/actions/runs?head_sha=ce86499fa0cf6ae7238898e6a6966dccf16a0720" --jq …` | CI 38869599104 / Cross-platform 38869599066 / Provenance 38869599050 均 `completed/cancelled`（attempt=1）；Website 38869599491 `success` |
| PR 状态 | `gh pr view 23 --repo CavinHuang/Drora --json headRefOid,isDraft,state,title,mergedAt` | head=`873cd961a66a51159edf39ce44b13d90f6713e61`、`isDraft=false`、OPEN、未合并 |
| 当前 checks | `gh pr checks 23 --repo CavinHuang/Drora` | 全部 `pending`（website 相关 pass/skipping） |
| 正式 review | `gh pr view 23 --json reviews,reviewRequests` | `{"reviews":0,"reviewRequests":0}` |
| PR body 与评论 | `gh pr view 23 --json body`；`gh api repos/CavinHuang/Drora/issues/23/comments`（含 6209475838/6209580588/6209664666 全文） | 实得 11 条评论；评论时间线证实 head 当日 14+ 次前移（1f1a457→…→873cd961） |
| 基线 AGENTS.md 规则 | `git show ce86499:AGENTS.md \| grep -n -E "seam\|还原\|接缝\|上游"` | 「上游对齐」章节（49-59 行）无「最小接缝」条款 → F-1 定夺依据 |
| spec 矛盾原文 | `git show ce86499:specs/obsidian-knowledge.md \| sed -n '150,153p;478,483p;1015,1035p;1038,1042p'`；`grep -n -E "^## 5f\|^### 5f"` | 亲读确认 :152 additive、:481 Receipt 旧语义、:1017/:1031 提案生产者、:1022 S03 NO-GO、:1040 G01–G30、双 §5f（999/1054） |
| knowledgeTurnCitations 三合一 | `git show ce86499:packages/ui/src/v4/knowledgeTurnCitations.ts`（全文） | `:56` 上限 5 魔数、`:59` quotes 等长计数门、`:61` 手写 `"evr_"`、import 区无前缀常量 |
| config 竞态 | `git show ce86499:packages/services/src/obsidian-vault/config.ts`（全文） | `setVaultReviewWritePathEnabled` 读-改-写无版本比对；`configureVaultAt` 整体重建写；两路径无共享锁 |
| edit/retry 顺序 | `git show ce86499:…/fork-edit-retry.ts \| sed -n '125,145p;310,325p'` | edit: 复验→（映射）→rewind→replay 再复验；retry: 复验(:317)→rewind(:320)→replay(:321) |
| 手写表头 | `git show ce86499:…/ConversationTurnGroup.tsx \| grep -n "来源索引"` | `:1634` 手写 manifest 表头中文字面量 |
| 死键 | `git grep -c "chat.evidence…" ce86499 -- packages/ui/src` + `git show ce86499:…/zh-CN.ts \| grep -n "chat.evidence"` | 仅 locale 文件命中（en-US/zh-CN），零消费者；键存在于 zh-CN.ts:7349-7353 等 |
| SMOKE 矩阵 | `git show ce86499:…/KNOWLEDGE_E2E_PHASE1_SMOKE.md \| grep -E "^\| G0[567] \|^\| G12 \|…"` | G05/G06/G07/G12 行执行记录均「未执行」；头部自动化口径与矩阵不一致 |

### 7.3 文件覆盖矩阵（按审查员分组声明）

- **CLI/协议**：evidence-admission、fork-edit-retry、canonical-intent-replay、session-flow、queue、event-normalizer、product-projection、projection-rows、input-intent-persistence、transcript-hydration、v4-gateway（+组外调用点 prompt-turn/steering/v4-bridge 交叉阅读）
- **shared 契约**：rows.ts、input-intent.ts、knowledge-evidence.ts、command.ts、conversationSelection.ts
- **services**：obsidian-vault/config.ts、knowledge/{reviewEngine,knowledgeServices,queryOrchestrator,evidenceRegistry}.ts、node.ts
- **UI 生产**：conversationSelectionReference/conversationKnowledgeSources/knowledgeCitationMarkdown/knowledgeTurnCitations/knowledgeCitationNavigation、SessionPane、ConversationComposer、ConversationTurnGroup、message.tsx、WorkspaceShellLayout、KnowledgeAnswerSources、vault/knowledge/* 20+ 文件
- **测试与 CI**：ci.yml、两个 Electron 工作流、3 WDIO spec、restart helper、SSE fixtures、15 UI vitest、5 node 测试
- **文档/规格**：specs/obsidian-knowledge.md、SMOKE、MERGE_READINESS、RELEASE_CANDIDATE_SCOPE、W09_DELIVERY、PR body 与 11 条评论

### 7.4 CI 证据链结论

- 基线 `ce86499`：无完成的 CI/Electron run（三 run cancelled，系分支快速推送触发 cancel-in-progress，属证据缺口而非已证测试失败）。
- PR 描述/评论引用的绿色 run：head_sha 均为 `666ea735` 或更早（1f1a457 等），按 PR 自身「旧/新结果不混算」不得替代。
- 当前 head `873cd961`：checks 全 pending（本会话实查），结论落定后须重核。
- main 无分支保护：全部检查为报告性而非强制门禁（acceptance-6，未复核）。

### 7.5 未执行项（如实声明）

- 未重跑 `pnpm typecheck`/`pnpm lint`/任何测试/E2E/architecture:check：工作区检出 main 且任务禁止 checkout/stash、禁止重跑全量测试；基线 CI 本身 cancelled，无基线执行证据可引用。
- 未对基线外 14+ 提交（`dc153a3`…`873cd961`）做任何审查。
- low 级未复核项（表中 △）按审查员证据采信并标注不确定性；关键 low/bug（E-1/E-2/C-3/C-2/A-9）已由主席亲读佐证。

---

*报告生成：2026-10-16 · 评审主席（13 路独立审查汇总裁决）· 基线 `ce86499fa0cf6ae7238898e6a6966dccf16a0720`*
