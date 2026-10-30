# CLI persona store

独立 SQLite 库（`personas/persona.sqlite`）的 P0 仓储：authority / core / mutation receipt
三类表（specs/drora-persona-system.md §4「adapters/persona」；存储合同
docs/design/drora-persona-data-contracts-2026-10-29.md §1/§2）。schema 只由本模块拥有，
Host/UI 不执行 DDL；P1a/P1b 的 policy/preference/candidate/work 表不在本模块。

## 所有权与边界

- 库路径由调用方（PersonaAppService）从可信存储根解析后传入
  （shared contracts 的 `PERSONA_STORAGE_KEYS`）；本模块不定路径规则，不接受
  project config `storage.dir` 或 cwd。未启用且未进入资料管理时不会被打开：
  不读库、不迁移、不起常驻任务。
- 业务时间由服务产生（每个变更输入带 `now`）；`authorityId`/`personaId` 在初始化事务内
  用 `crypto.randomUUID` 生成，不从昵称/cwd/用户文本推导。字段校验（NFC/控制字符/code
  point）属服务层与 cli-persona-domain；本模块只做 SQL CHECK 与行级严格解码。
- 产品默认核心与 `templateVersion` 由服务在初始化输入中提供；存储不定默认值。

## 语义（合同 §2 逐条）

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

## 结果通道

业务终态（`uninitialized` / `revision_conflict` / `mutation_conflict` /
`storage_capacity` / created·saved·unchanged 及其回放）经 `PersonaManagementResult`
以值返回；环境级故障（`storage_unavailable` / `schema_incompatible` / `outcome_unknown`）
抛 `PersonaStoreError`。错误码字面量唯一出处是 shared contracts 的 `PERSONA_ERROR_CODES`。

## 异步边界

沿 session-store 既有体系：异步方法门面 + node:sqlite 单连接短事务 +
`begin immediate`/`begin deferred` + busy_timeout 有限等待 + 预算内退避。当前实现
仍在调用线程上同步执行 SQL；正式异步 worker 线程是实施计划 §3.B 的剩余交付
（「adapters worker / 正式 worker 最低可运行验证」，合同 §2「SQLite 位于异步 worker」），
随发行包的三平台打包检查记录才属切片 D。切片 C 把管理 API 接到进程主线程前必须先
落地 worker。同实例重叠事务由进程内队列串行化（单连接重叠 begin 会被误分类为
`storage_unavailable`）；多进程共享同一库靠 WAL + 短事务 + CAS；内存不缓存可变状态。

## 公开入口

`contract.ts`（端口与类型）与 `index.ts`（工厂 `openPersonaStore`）。消费方只有
PersonaAppService（服务层）；capture 端口与协议注册不直接依赖本模块。

## 实现语义要点（PersonaSqliteStore，逐条对应合同 §2）

- 访问模式沿既有 session-store 体系：node:sqlite DatabaseSync 单连接 + 异步方法门面 + 短事务
  （begin immediate/deferred）+ busy_timeout 有限等待 + 预算内退避重试。当前实现仍在调用线程上
  同步执行 SQL：正式异步 worker 与三平台打包检查分别属切片 B 剩余交付与切片 D，不得记为已交付。
- 并发串行化：单连接上同一实例的重叠事务由进程内队列互斥（txnQueue）；跨连接并发由 SQLite
  WAL/事务与 BUSY 预算重试裁决。
- CAS：core/policy/preference 更新必须 expectedRevision 匹配；冲突返回 revision_conflict 且不写
  receipt（失效回执不能绕过 CAS）。
- receipt 幂等：同 scope+mutationId 同摘要回放先前终态（saved 带当时的 revision+generation）；
  同 ID 异摘要 mutation_conflict；权限/authority 检查先于 receipt 查询。
- 容量：达到 4096 条/authority 时先清 7 天窗口外的过期项；窗口内凭据不驱逐；仍满则拒绝新管理写
  并返回 storage_capacity。
- 超时：写请求在预算内拿不到锁/提交，对外表达 outcome_unknown；读请求表达 storage_unavailable。
- 未初始化（无 authority 行）与损坏（非 SQLite 文件、checksum 不符、未知账本、行内容非法、
  schemaVersion 更大）严格区分：后者 schema_incompatible 只停扩展，不降级写旧 schema、不静默换
  默认身份。
