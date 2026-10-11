# W00 DB 双 Host Spike（W00_DB_HOST_SPIKE）

**工作单：** W00 执行项 4　**日期：** 2026-10-10　**基线 HEAD：** `c39ce3712275bbc570865b37fe9f0f4cb42b8ecb`（分支 `feat/vaultview-impl`）

> 审计人：W00 审计-DB 双 Host Spike（只读审计，未修改仓库任何文件；全部脚本与合成库在 `C:/Users/A/AppData/Local/Temp/vaultview-w00-spike/`）。撰写人：W00 证据撰写员，正稿整合自审计素材 `C:/Users/A/AppData/Local/Temp/vaultview-w00-spike/W00_DB_HOST_SPIKE.md`（撰写员已全文读取并核对）。撰写员亲自执行的验证仅为读取该素材文件；§2 的全部命令由审计员实际运行，退出码逐一附后，撰写员未重跑。

## 0. 范围与结论

在两个目标运行时实测 `node:sqlite` 可用性，并以「两个独立 OS 进程共享同一 `.db` 文件」的模型验证 WAL、跨进程写互斥、lease/fencing、硬杀崩溃恢复与接管。**四个 Spike 全部真实跑通（每个退出码 0）**。

预判（仅 DB 层输入，非完整门禁结论）：

- **S02**：DB 层不构成阻断——跨进程 `BEGIN IMMEDIATE` 互斥与 busy_timeout 等待已实证，可为持久化队列提供串行化基础；但 DB 锁只保证**串行化**、不保证 admission 顺序与过期来源拒绝，顺序仍归 CommandInbox/Host owner。
- **S03**：DB 层基础机制全部 GO，前提是按 §4 纪律实现（禁止 naive fence-CAS、lease 必须 TTL 化、显式 busy_timeout、接管后体检）。风险面须在门禁记录：全新 SQLite 依赖面（仓库当前零依赖）、node:sqlite 在 node 24.1 仍打 ExperimentalWarning、Electron 非 main 进程可用性与真实双窗口并发未验证。

## 1. 运行时事实

| 项 | 值 | 证据 |
| --- | --- | --- |
| 本地 CLI node | v24.1.0（`C:\Users\A\AppData\Local\Volta\tools\image\node\24.1.0\node.exe`） | `node --version` → `v24.1.0`；**撰写员已复核**（本会话重跑输出一致） |
| mise 钉的 node | 24.14.0（本会话未激活） | `mise.toml:2` `node = "24.14.0"` |
| Electron | 41.0.3，二进制在 worktree `node_modules/electron/dist/electron.exe` | `packages/desktop/package.json:79` `"electron": "41.0.3"` |
| Electron 内嵌 Node | 24.14.0，SQLite 3.51.2，Chrome 146 | Electron probe 输出 `process.versions` |
| 仓库现有 sqlite 依赖 | 无（零依赖，node:sqlite 属全新依赖面） | `grep -rn --include=package.json -iE "sqlite" packages apps` → 退出码 1（无匹配） |

### 1.1 node:sqlite 可用性（已确认，非假设）

- node 24.1.0：`node -e "require('node:sqlite')"` 成功，导出 `DatabaseSync, StatementSync, constants, backup`；内嵌 SQLite **3.49.1**（`select sqlite_version()`）。每次加载打印 `ExperimentalWarning: SQLite is an experimental feature`。
- Electron 41.0.3 main 进程（真实仓库二进制，无窗口，probe 后 `process.exit(0)`）：`node:sqlite` 可用，导出比 node 24.1 多一个 `Session`（changeset API）；内嵌 SQLite **3.51.2**；功能性验证通过：建临时库、`PRAGMA journal_mode=WAL` → `wal`、插入、读回 `rows=1`，进程退出码 0。
  - 命令：`node_modules/electron/dist/electron.exe C:/Users/A/AppData/Local/Temp/vaultview-w00-spike/electron_probe_main.js`，**退出码 0**，关键输出 `ELECTRON_PROBE sqlite functional journal_mode=wal rows=1 sqlite=3.51.2`。
  - 注意：Electron 侧 probe **未**出现 ExperimentalWarning（node 24.14 中 node:sqlite 已非实验性警告或被 Electron 吞掉）——两个运行时告警行为不同，集成按 24.14 行为预期。

## 2. Spike 与真实命令（全部退出码 0）

每个 spike 都是「父进程 + spawn 出的独立子进程」两个 OS 进程共享同一 `.db` 文件；库文件为合成临时库。命令均在仓库根 cwd 执行，脚本用绝对路径。

### 2.1 Spike1 — 同库两进程开 WAL + 跨进程可见性

脚本 `spike1_wal_two_processes.mjs` + `spike1_child.mjs`；命令 `node "C:/Users/A/AppData/Local/Temp/vaultview-w00-spike/spike1_wal_two_processes.mjs"`，**退出码 0**。

- 默认 journal 是 `delete`；`PRAGMA journal_mode=WAL` 双方都返回 `wal`，P1 持连接期间 P2 打开同文件成功。
- 跨进程可见性：P2 读到 P1 提交行；P1 读回 P2 提交行 `[P1] read back kv.from = P2-child`。
- 文件证据：并发期 `-wal` 20,632→28,872 字节、`-shm` 32,768 字节；`PRAGMA wal_checkpoint(TRUNCATE)` → `{"busy":0,"log":0,"checkpointed":0}` 后 `-wal` 截断为 0 字节；`integrity_check=ok`。

### 2.2 Spike2 — 跨进程 BEGIN IMMEDIATE 互斥 + busy_timeout

脚本 `spike2_begin_immediate.mjs`（contender）+ `spike2_holder.mjs`（holder：`BEGIN IMMEDIATE` 持锁约 1.5s 后 COMMIT）；命令 `node "…/spike2_begin_immediate.mjs"`，**退出码 0**。

- **node:sqlite 默认 busy_timeout=0**：holder 持锁期间，未设 busy_timeout 的 autocommit 写 **0ms 即失败**——`Error: database is locked`，`code='ERR_SQLITE_ERROR'`、`errcode=5`（SQLITE_BUSY）。集成时每条连接必须显式 `PRAGMA busy_timeout` 并按 `errcode===5` 分类。
- `busy_timeout=0` 时 `BEGIN IMMEDIATE` 同样 0ms 失败（同一错误形状）。
- **WAL 读不受写者阻塞**：holder 持锁期间 `SELECT count(*)` 正常返回。
- `busy_timeout=5000` 的 `BEGIN IMMEDIATE` 阻塞 **1613ms** 后成功（等 holder COMMIT），事务内可见 `holder-row`——跨进程写互斥与释放即接管成立。

### 2.3 Spike3 — lease/fencing 语义（含 naive 反例）

脚本 `spike3_lease_fencing.mjs`（P1）+ `spike3_worker_child.mjs`（Host A）；命令 `node "…/spike3_lease_fencing.mjs"`，**退出码 0**。表结构 `leases(name, owner, epoch, expires_at_ms)` + `kv(k, v, fence)` + `history`。

- A 以 `BEGIN IMMEDIATE` CAS 抢到 lease epoch=1（TTL 800ms）并纪律化写入成功。
- lease 未过期时 P1 接管 → `{"acquired":false,"heldBy":"A","epoch":1}`——互斥成立。
- A 停跳后（过期）尝试纪律化写（事务内校验 owner+epoch+未过期）→ `fence-rejected`，附当前 lease 快照。
- **反例（设计红线）**：仅按 fence 列做 CAS（`UPDATE kv SET v=… WHERE k='x' AND fence=1`）→ `changes=1`，**stale writer 写入成功**（随后读到 `{"v":"A-stale-naive","fence":1}`）。结论：fencing 不能只靠列戳，必须在每个写事务内对照 lease 表当前 epoch/owner/过期时间校验。
- P1 过期后接管 → fence=2，写入生效，最终 `kv={'v':'P1-final','fence':2}`，history 干净，`integrity_check=ok`。

### 2.4 Spike4 — 硬杀进程、崩溃恢复与接管

脚本 `spike4_crash_recovery.mjs` + `spike4_holder_child.mjs`；命令 `node "…/spike4_crash_recovery.mjs"`，**退出码 0**。

- **方法论诚实记录**：第一次运行不算数——child 用 unsettled top-level await 等待被杀，Node 以 exit 13 自行退出，taskkill 报「没有找到进程」（exit 128），库被干净关闭（`-wal` 消失）。修复为 `setInterval` keep-alive 后重跑，才构成真实硬杀。
- 真实硬杀：child 持 lease(epoch=1, TTL 1.5s) + 未提交 `BEGIN IMMEDIATE`（本地可见 3 行）时，`taskkill /F /T /PID` → exit 0，child exit code 1（TerminateProcess）。杀后 `-wal` 12,392 字节、`-shm` 32,768 字节遗留盘上。
- B（新连接，触发 WAL 恢复）打开：`journal_mode=wal`；已提交行完好（`committed-early`、`committed-by-A-before-immediate`），**未提交行消失**；`integrity_check=ok`——崩溃原子性成立。
- **lease 不能检测死亡**：B 在 TTL 未过期时立即接管 → `{"acquired":false,"heldBy":"A","epoch":1}`（holder 已死仍被拒）。接管只能等 TTL 过后：等待 1,404ms 后接管成功 fence=2，写入 `committed-by-B-after-takeover` 成功。
- 接管后 `PRAGMA wal_checkpoint(TRUNCATE)` → `{"busy":0,"log":0,"checkpointed":0}`，`-wal` 归 0 字节，`integrity_check=ok`。

## 3. node 级实验 vs Electron 双窗口 Host 的差异（关键判断点）

1. **Spike 的进程模型**：两个独立 OS 进程各持一条 `DatabaseSync` 连接。此模型下 SQLite 文件锁 / WAL 恢复 / lease 语义全部实证成立，Windows（mandatory file lock，进程死亡句柄即释放）included。
2. **Electron window-scoped Host 的真实拓扑决定语义是否等价**（Spike 无法替代的判断点）：
   - 若两个窗口的 Host **DB 连接同属一个进程**（都在 main，或同一 host-service/utilityProcess），则窗口（renderer）崩溃不会释放 DB 锁、不会过期 lease——Spike4 的「杀进程→接管」路径根本不会被触发；必须依赖 AGENTS.md 已有的 owner/lease 路由与 Host 存活检测，DB lease 仅作第二道防线。
   - 若每个窗口 Host 是**独立进程**（utilityProcess/child process 各持连接），则与 Spike 模型一致，全部语义成立。
   - 结论措辞：Spike 证明的是「**跨进程双连接 + SQLite WAL** 机制本身可行」；Electron 双窗口落地前必须先确认连接所有者进程粒度，再在真实双窗口中复测崩溃接管。
3. **同步 API 与事件循环**：`DatabaseSync` 是同步 IO。放 Electron main 会阻塞主事件循环（busy_timeout 等待、checkpoint 都会卡 UI 消息泵）；放 utilityProcess 则隔离但引入 IPC。长事务与 5s 级 busy_timeout 在 main 里不可接受，建议短事务 + 明确超时预算。
4. **运行时差异已实测缩小**：Electron 41 内嵌 Node 24.14.0（恰与 mise 钉的版本一致），main 进程实测可用（§1.1）；SQLite 3.51.2 与 CLI node 24.1 的 3.49.1 属跨运行时版本混用，WAL 格式向前兼容，但应记录。
5. **未验证/假设项（不得写成已确认）**：
   - renderer/utilityProcess 内 `node:sqlite` 可用性未测（本会话只测 main）；
   - 真实 Electron 双窗口并发写同库未复测（Spike 为两个纯 node 进程 + 一次 Electron main probe）；
   - `taskkill /F`（TerminateProcess）已测，断电级崩溃（`-wal` 中间态帧恢复）由 SQLite 文档保证但未单独构造；
   - `Session`/changeset API（仅 Electron 侧导出）未做行为测试。

## 4. 对实现的具体纪律（Spike 直接推出的设计要求）

1. 每条写连接显式 `PRAGMA journal_mode=WAL` + `PRAGMA busy_timeout=<预算>`（默认 0 会立即抛 busy）；按 `errcode===5`（SQLITE_BUSY）分类处理。
2. 单写者纪律：写路径一律 `BEGIN IMMEDIATE` 短事务；读走 WAL 快照不被阻塞。
3. lease 表 `epoch` 单调递增作为 fence token；**每个写事务内**校验 `owner===me && epoch===myFence && expires_at_ms>now`（Spike3 反例证明列戳 CAS 不设防）。
4. lease 死亡检测只能靠 TTL + 心跳（Spike4 证明死进程的 lease 照样拒人）；TTL 要显著小于人工接管预期。
5. 接管成功后执行 `wal_checkpoint(TRUNCATE)` + `integrity_check` 作为接管体检（已在崩溃后验证二者可用）。

## 5. Spike 文件清单（均在临时目录，仓库零改动）

`lib.mjs`、`spike1_wal_two_processes.mjs`、`spike1_child.mjs`、`spike2_begin_immediate.mjs`、`spike2_holder.mjs`、`spike3_lease_fencing.mjs`、`spike3_worker_child.mjs`、`spike4_crash_recovery.mjs`、`spike4_holder_child.mjs`、`electron_probe_main.js`、素材文档 `W00_DB_HOST_SPIKE.md`；产物 `spike1.db` `spike2.db` `spike3.db` `spike4.db`（及 -wal/-shm，合成临时库）。

## 6. 验证记录与未执行项

- 已运行（审计员执行，退出码全 0）：`node --version`、`node -e "require('node:sqlite')…"`、Electron main probe、spike1-4 五条主命令。
- 未执行（撰写员/审计员均未做，如实声明）：Electron renderer/utilityProcess 内 node:sqlite 可用性；真实 Electron 双窗口并发写同库；断电级 WAL 中间态帧恢复；`Session`/changeset API 行为测试；DB 层实现与回归（属后续工作单）。本专项无仓库代码改动，typecheck/lint/architecture:check 由脚本统一跑（见 `W00_EVIDENCE_REPORT.md` §2）。
