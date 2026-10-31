# CLI persona store

独立 SQLite 库（`personas/persona.sqlite`）的 P0/P1a/P1b 仓储：authority / core /
mutation receipt / policy / preference 五类管理表（specs/drora-persona-system.md §4
「adapters/persona」；存储合同 docs/design/drora-persona-data-contracts-2026-10-29.md
§1/§2）＋ P1b 学习域五表（evidence/work/candidate/source/budget_day，合同 §1/§6）。
schema 只由本模块拥有，Host/UI 不执行 DDL。

## 所有权与边界

- 库路径由调用方（PersonaAppService）从可信存储根解析后传入
  （shared contracts 的 `PERSONA_STORAGE_KEYS`）；本模块不定路径规则，不接受
  project config `storage.dir` 或 cwd。未启用且未进入资料管理时不会被打开：
  不读库、不迁移、不起常驻任务。
- 业务时间由服务产生（每个变更输入带 `now`）；`authorityId`/`personaId`/`workId` 在
  事务内用 `crypto.randomUUID` 生成，不从昵称/cwd/用户文本推导。字段校验（NFC/控制字符/
  code point/受控值集合）属服务层与 cli-persona-domain；本模块只做 SQL CHECK、结构
  完整性校验（sourceHandle 最少字段、keyGenerations 键集合、evidenceRefs ≤4×≤512cp）
  与行级严格解码。
- 产品默认核心与 `templateVersion` 由服务在初始化输入中提供；存储不定默认值。
- 学习域的源复验（消息 owner 只读验证）发生在事务外，属服务层；本仓储只在提交事务内
  复核库内屏障（U/L/epoch/generation/pinned/fence）。

## 管理面语义（合同 §2 逐条）

- **CAS**：`updateCore` 必须 `expectedRevision` 匹配；冲突返回 `revision_conflict`，
  不写 receipt。无内容变化返回 `unchanged`，不新增 revision。
- **receipt 幂等**：键 `(scope, mutation_id)`。同 ID 同摘要回放先前终态（`saved` 带当时
  记录的 revision）；同 ID 异摘要 `mutation_conflict`；authority 检查先于 receipt 查询。
  receipt 不含核心正文，不是审计转录。
- **容量**：达到 4,096 条/authority 先清 7 天窗口外过期项；窗口内凭据不驱逐；仍满则拒绝
  新管理写并返回 `storage_capacity`。
- **超时**：锁等待初始 100ms（连接 `timeout`）+ 管理请求总预算初始 5s（BUSY 退避重试）。
  写请求超预算对外抛 `PersonaStoreError(outcome_unknown)`——不谎报失败或成功，调用方凭
  `mutationId` 查询/重试；读请求表达 `storage_unavailable`。
- **状态区分**：无 authority 行＝`uninitialized`（读取的成功答案）；非 SQLite 文件、
  迁移 checksum 不符、账本含未知迁移、行内容非法、`schemaVersion` 更大＝
  `schema_incompatible`（PersonaStoreError），只停扩展，不降级写旧 schema、不静默换默认
  身份。其余 IO/锁/打开失败＝`storage_unavailable`。
- **策略（P1b）**：policy 行含 auto_learn/learning_generation。autoLearn 是 patch 字段
  （缺省＝保持当前值）；关闭 U 同一事务强制 L=false。任何「L true→false」转移在同一
  事务内递增 learning_generation（学习域单调屏障），并级联：非终态工作全部终态化
  （rejected/policy_off，撤租约）＋清全部待确认候选正文（合同 §4.2）。显式保存清该键
  候选与合并来源、disputed 归零；忘记同样清候选/来源并置屏障（P1a 语义叠加）。

## 学习域语义（P1b，合同 §6 逐条；`PersonaStorePort.learning`）

- **接收**：evidenceId 幂等（同 ID 同内容 already_accepted 回放 workId；工作终态行已按
  7 天保留清理后的回放仍 already_accepted 但省略 workId——evidence 是来源定位/复验记录
  长期保留，失对不是库损坏；同 ID 异内容 mutation_conflict）；非终态工作 ≥128/authority
  拒绝（storage_capacity）；单事务写入 evidence 行＋accepted 工作行。sourceHandle 是服务构造的可信 JSON（最少字段结构校验），
  仓储不保存聊天原文；policyEpoch/keyGenerations 是接收屏障快照。
- **队列**：accepted → running（租约 owner+到期，领取即 fence+1、attempts+1）→
  applied/no_change/rejected/retry_wait。存活租约互斥全部领取（每 authority 并发 1）；
  过期租约可重领，旧 fence 的提交/settle 一律 revision_conflict 且不改工作状态；
  24 小时超龄与尝试耗尽（≥2）在领取路径终态化（rejected）；终态保留最小 id/reason
  7 天（接收/领取路径顺带清理；清理先于幂等回放与策略门——U/L 关闭期间触达的调用
  同样清理，全程无调用的静默期顺延到下次调用）。
- **提交**：策略屏障（U/L 任一关闭或接收后 epoch 推进）拒绝整个提交并把工作终态化
  （rejected/policy_barrier）——不能靠预算重试复活。候选逐条过屏障：抑制键丢弃
  （dropped_suppressed）、generation 陈旧丢弃（dropped_stale_generation）、结构非法
  丢弃（dropped_invalid）——三类一律不留正文；pinned 槽不被覆盖，不同值只进待确认
  候选（candidate_pending）；同值并源（≤4，先到先保留）；异值置槽 disputed＋待确认
  候选（每键最多一项，被取代候选整行删除）；无槽首写 inferred
  （extraction/inferred/unpinned，generation 不递增以暴露并发冲突）。效果 ≥1 项即
  applied，否则 no_change。
- **预算**：调用前 `reserveLearningBudget` 在 DB 预留硬上界（1 次尝试＋输入/输出
  token），超界 budget_exhausted 不计数；失败计入不退尝试；confirmed 核销退 token
  差额，崩溃不退（保守）；UTC 日窗口按服务时间记账，时钟倒退落到既有 day 行继续
  记账（不补额度），day 行不清理。

## 结果通道

业务终态（`uninitialized` / `revision_conflict` / `mutation_conflict` /
`storage_capacity` / `budget_exhausted` / `validation_failed` 及 created·saved·unchanged·
accepted·already_accepted 及其回放）经 `PersonaManagementResult` 以值返回；环境级故障
（`storage_unavailable` / `schema_incompatible` / `outcome_unknown`）抛
`PersonaStoreError`。错误码字面量唯一出处是 shared contracts 的 `PERSONA_ERROR_CODES`；
工作状态机字面量唯一出处是 `PERSONA_LEARNING_WORK_STATES`。

## 异步边界

沿 session-store 既有体系：异步方法门面 + node:sqlite 单连接短事务 +
`begin immediate`/`begin deferred` + busy_timeout 有限等待 + 预算内退避。管理面与学习面
的所有短事务经同一 `PersonaSqliteTxnRunner` 队列串行化（单连接重叠 begin 会被误分类为
`storage_unavailable`）；多进程共享同一库靠 WAL + 短事务 + CAS/租约/fencing；内存不缓存
可变状态。

**正式异步 worker（2026-10-31 批次，合同 §2「SQLite 位于异步 worker」）**：
`openPersonaStore` 是在程 engine（worker 内与测试直接使用）；生产装配
（bootstrap persona-system）经 `openWorkerPersonaStore`——worker 线程持有
DatabaseSync（PersonaSqliteStore 是唯一实现，零语义复制），主线程经消息传递调用同一
`PersonaStorePort`（`persona-store-worker-client.ts` / `-main.ts` / `-protocol.ts`）。

- **worker 入口两种形态**：构建期由 adapters build 脚本用 esbuild 把
  `persona-store-worker-main.ts` 打包为 CJS `persona-store-worker-main.bundle.cjs`
  （内联 @drora/shared 链——shared 公开导出直接指向 TS 源，纯 Node worker 不能加载）。
  CLI 主 bundle（drora.cjs 单文件产物）构建时把该文件读成字符串经 esbuild define 注入
  `__DRORA_PERSONA_WORKER_SOURCE__`，运行时以 `eval` 形态 spawn（fs/ripgrep worker 同款
  先例）；非打包形态（dist/vitest）spawn 同一 bundle 文件。旁挂文件在单文件产物
  （drora.cjs / SEA / desktop-agent 内置 bundle）中不会随包发布，因此打包态必须走注入。
- **生命周期**：spawn → worker 打开/迁移 → ready 回执；请求按 postMessage FIFO 到达，
  与在程实现同一事务队列串行语义一致（排队不消耗预算——预算计时在事务真正开跑后才起算）。
- **故障处置**（PM16）：worker `error`/`exit` 时在飞请求与后续调用一律以
  `storage_unavailable` 拒绝（error 监听常驻，worker 异常不会以 uncaught exception 打穿
  主进程——扩展只停不崩进程）；本层不自动重开，重开/降级语义属服务层。`close()` 幂等；
  worker 已死时 close 直接成功（库随线程消亡）。管理请求在飞时 close 会等待回执
  （在途请求完成后再关）——主循环逐消息串行处理，close 的 handler 排在在飞请求完成
  之后，不会在其 BUSY 退避让出事件循环的窗口并发关库；与在程 engine「queued 事务在
  close 后拒绝」的差异如实记录。
- **测试钩子**：`terminatePersonaWorkerForTests` 仅供测试/诊断模拟崩溃路径，生产不得调用。

## 公开入口

`contract.ts`（管理端口与类型）、`persona-learning-contract.ts`（学习端口与类型）与
`index.ts`（工厂 `openPersonaStore`＝在程 engine、`openWorkerPersonaStore`＝生产默认
worker 形态、`terminatePersonaWorkerForTests`＝测试钩子）。消费方只有 PersonaAppService
（服务层）与学习消费者；capture 端口与协议注册不直接依赖本模块。

## P1b 只读观测（2026-10-31 批次）

`PersonaLearningStorePort` 新增三个只读方法（不改变任何写侧屏障）：
`readLearningBudgetUsage(now)`（UTC 日台账，跨连接一致——接收预算门的服务侧判定依据）、
`readInferredSlotSources()`（inferred 槽合并来源 × evidence 定位联读，capture 读取侧复验
用；evidence 行缺失或 handle 解码失败按损坏处理）、`hasLearningEvidence(evidenceId)`
（幂等消歧：同 ID 异内容时区分重复通知与请求缺陷）。行原语在 `persona-learning-rows.ts`
（`readInferredSlotSourceBindings`），不经公开入口暴露。
