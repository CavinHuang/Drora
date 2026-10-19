# G-BACKLOG 八用例自动化补齐回执（2026-10-18）

- 工作分支：`feat/g-backlog-e2e`（基于 main `6115052c`）。
- 任务来源：KNOWLEDGE_E2E_PHASE1_SMOKE.md「2026-10-18 补记 · 未覆盖交互用例 backlog」中 8 个「无任何自动化映射」用例（G11/G20/G21/G22/G25/G28/G29/G30）。
- 执行环境：Windows 10.0.26300 x64，Node v24.1.0，真实 Electron 41.0.3 + ChromeDriver 146.0.7680.80（WDIO），隔离 `.e2e-home`，真实 main/host/CLI RPC + 真实托管 Vault 索引，仅上游模型经仓内 SSE 回放（`packages/desktop/test/e2e/fixtures/upstream/conversation-session/G-*.json`）。
- 结论：**7 PASS / 1 FAIL（G20，产品缺陷 D-G20-1）**。三个 spec 已接入 `.github/workflows/obsidian-electron-cross-platform.yml` 的 R1-R9 acceptance job（ubuntu/windows/macos 三平台矩阵）。

## 标准运行命令（从 `packages/desktop` 目录；前置构建见下）

```bash
# 前置构建（dist 已存在时可跳过，本批实际运行带 DRORA_E2E_SKIP_BUILD=1）：
pnpm --filter @drora/e2e-report build:node && node scripts/build-desktop-agent-cli.mjs

CI=1 E2E_PROVIDER_HTTP_MODE=replay \
E2E_PROVIDER_REPLAY_FIXTURE_PATH="<fixture 绝对路径>" \
VITE_DRORA_E2E_STORE_BRIDGE=1 DRORA_SKIP_REMOTE_ASSETS=1 \
pnpm exec wdio run wdio.conf.ts --spec ./test/e2e/acceptance/<spec>.ts
```

## 逐用例结果

| ID | spec | it | 结果 | 运行证据 |
| --- | --- | --- | --- | --- |
| G11 | g-interleaving.test.ts | G11 new submission while evidence verification is pending… | PASS | 见下节 |
| G20 | g-interleaving.test.ts | G20 previous-round re-verification racing…（主 it）+ G20 positive control（正向对照探针） | **FAIL（产品缺陷 D-G20-1）** | 见下节与「产品缺陷」 |
| G21 | g-interleaving.test.ts | G21 changing the second selection during an ANSWER handoff… | PASS | 见下节 |
| G22 | g-interleaving.test.ts | G22 double-clicking the handoff while verification is in flight… | PASS | 见下节 |
| G28 | g-citation-open-errors.test.ts | G28 verified chip open… | PASS | 见下节（含两轮修复记录） |
| G29 | g-citation-open-errors.test.ts | G29 stale / G29 missing / G29 forbidden / G29 session switch…（4 个 it） | PASS | 见下节 |
| G25 | g-hint-and-plain-selection.test.ts | G25 stale receipt still shows the recheck-on-send hint… | PASS | 见下节 |
| G30 | g-hint-and-plain-selection.test.ts | G30 plain markdown selection chip… | PASS | 见下节 |

spec 级退出码（真实运行，artifact 目录 `packages/desktop/.e2e-artifacts/desktop-e2e-*`）：

- `g-interleaving.test.ts`：**exit=0**（2026-10-19 02:02 收尾复跑，`4 passing + 1 skipped`，Spec Files `1 passed`；探针 it 自 2026-10-19 起默认门控跳过，见「产品缺陷 D-G20-1」）。改门控前的最终硬断言形态运行为 `4 passing, 1 failing`（desktop-e2e-20261018-174329-973 / -175308-157，failing 仅 G20 positive control 探针）。
- `g-citation-open-errors.test.ts`：**exit=0**（desktop-e2e-20261018-163051-707 与 -163612-123 两轮，均 5/5 用例 `passed=true`）。
- `g-hint-and-plain-selection.test.ts`：**exit=0**（desktop-e2e-20261018-174043-798，G25/G30 均 `passed=true`）。

## 逐用例命令与关键断言证据

### G11 检索核验挂起时提交新检索 —— PASS

命令：标准命令，spec `./test/e2e/acceptance/g-interleaving.test.ts`，fixture `G-interleaving.json`。

关键断言（g-interleaving.test.ts:526-641）：同一同步栈先点「加入 Agent（可信证据）」再点检索提交（真实 IPC 在途交错，无 mock）；新 Run 落定后间隔 1s 双采样：新轮卡片 `data-evidence-phase === "none"`、window 探针（`drora:conversation-selection-add`/`drora:knowledge-agent-handoff` CustomEvent 计数）`add===0 && handoff===0`、全 DOM `chipCount===0 && manifestHits===0`；正向对照同卡片手动核验 → `"verified"`（证明流水线存活，此前丢弃确因交错守卫 `useKnowledgeCandidateVerification.ts:45-59` 的 submitSeq 失配）。

运行证据：g-interleaving-run4.log 与 g-interleaving-triage-run2.log 均 `✓ G11 …`；2026-10-19 02:02 收尾复跑 `✓ G11 …`。

### G20 旧笔记复验挂起时切换会话/发起新检索 —— FAIL（产品缺陷 D-G20-1）

命令：同 G11（同一 spec）。

主 it（g-interleaving.test.ts:643-862）三个交错变体全部通过：①旧笔记 open + 新检索提交、②旧笔记 attach + 新检索提交、③旧笔记 open + 切 Session B。每变体间隔 1s 双采样断言 notes tab `aria-selected !== "true"`、可见 CodeMirror 不含原文 token、探针 `add===0 && handoff===0`、新会话可见 composer `chipCount===0 && manifestHits===0`；变体一另有正向对照（当前轮手动核验 → "verified"，排除流水线死亡）。即**「迟到引用不进新 Session Composer」与三个竞态下的「不打开笔记」均为 PASS**。

FAIL 判定依据：G20 判据要求「迟到引用不打开笔记」具备正向判定力（须证明通路本身可用，否则无法区分「守卫丢弃」与「打开链路损坏」）。正向对照探针 it（g-interleaving.test.ts:1187-1258）验证「无竞态的上一轮『跳到原文』应打开原文」，真实运行确定性失败：`false !== true`（g-interleaving.test.ts:1247，desktop-e2e-20261018-175308-157，15s 超时采样 notes tab 未激活、无 CodeMirror 原文）。根因是产品缺陷 D-G20-1（见「产品缺陷」），不是测试构造问题——当前轮卡片 open 与引用回跳（epoch 型）均正常。**G20 整体如实记 FAIL**；探针 it 自 2026-10-19 起默认 `this.skip()`（无 `DRORA_E2E_PROBE_D_G20_1` 时），产品修复后以该 env 重跑转正并撤销 skip。

### G21 ANSWER 交接核验期间改选第二篇 —— PASS

命令：同 G11。关键断言（g-interleaving.test.ts:864-1016）：同一同步栈点「交给 Agent」+ 取消 Two 改选 Three 后，busy 解除并双采样：探针 `handoff===0`（旧 [One,Two] 批次被 `selectionVersionRef` 守卫丢弃，useKnowledgeAgentActions.ts:176-182）、chipCount/manifestHits 0、选择态 One=true/Two=false/Three=true；重新执行交接后 composer `manifestHits===1`、`anchoredChipCount===2`、文本含 `[1] path=`+One、`[2] path=`+Three 且不含 Two、finalProbe `handoff===1 && add===1`。运行证据：run4/triage2/收尾复跑均 `✓ G21 …`。

### G22 核验在途双击「交给 Agent」后切换 Session —— PASS

命令：同 G11。关键断言（g-interleaving.test.ts:1018-1165）：阶段一同一同步栈双击 → 恰一个 manifest（`manifestHits===1`、`anchoredChipCount===2`、探针 `handoff===1 && add===1`，同步 ref 锁 useKnowledgeAgentActions.ts:53-54/155-156）；阶段二双击后立即切回 Session A → 双采样探针计数不增（handoff 停在 1）、A 可见 composer `visibleChipCount===0 && visibleManifestHits===0`（可见域断言，防旧会话隐藏挂载误判）；回 C 后草稿原样恢复（`visibleManifestHits===1`、`anchoredChipCount===2`）。运行证据：同上三轮 `✓ G22 …`。

### G28 Composer 可信 chip「核验后打开原文」 —— PASS（含两轮修复）

命令：标准命令，spec `./test/e2e/acceptance/g-citation-open-errors.test.ts`，fixture `G28-citation-open-errors.json`。

修复轮记录（"G28-fix-rounds"）：第一轮 desktop-e2e-20261018-161926-561、第二轮 -162524-009 均 exit=1（hover card 定位与候选匹配修正），修复后 -163051-707、-163612-123 两轮 5/5 exit=0。

关键断言（g-citation-open-errors.test.ts:567-646）：真实指针 hover chip（radix HoverCard ~700ms openDelay）点击 `composer-open-trusted-citation` → notes tab 激活 + CodeMirror 原文出现 + **原生 Selection 双行选区**（`lineCount===2`、`firstLine/lastLine` 逐字等于 quote 两行、编辑器聚焦、首行滚入视口 `0 <= top < viewportHeight`）+ 文件树存在服务端相对路径条目 + 源文件字节不动。fixture 采用 r9 缺陷规避结构（无标题、引用双行构成文件末 chunk 且不以换行结尾，保证 chunk sha 与 quote 切片一致）。

### G29 修改/删除原文、切 Vault/Session 后点击引用 —— PASS

命令：同 G28。四个 it（g-citation-open-errors.test.ts:648-820）：

- stale：改文件头部（距 quote >5000 字符）后点击 → toast「笔记内容已变更，请重新检索并签发引用。」+ 间隔 1s 双采样 Vault 主视图零激活 + 磁盘保持修改后内容（无回写）。
- missing：删原文后点击 → toast「笔记已不存在，无法打开旧引用。」+ 零激活 + 文件不被复活。
- forbidden：经 mock 原生 `dialog.showOpenDialog`（desktopMainIpcPlatform.ts SelectDirectory 链路）切到第二 Vault（预置同名诱饵、内容含独立 token）→ toast「引用所属会话或 Vault 已改变，拒绝打开。」+ 零激活 + 全 DOM 任何 CodeMirror 不渲染诱饵 token + 两个 Vault 文件均原样。
- session 切换面 + 恢复收尾：切回托管 Vault（`configureVaultAt` 刷新 configuredAt → 既有 receipt 全部失效，产品 fail-closed 语义非缺陷）→ 新建真实会话 B 的 composer `chipCount===0`（旧会话引用不可达）；回 A 点击同一 chip → stale 结构化拒绝 + 零导航。

边界如实记录：unavailable 态（「当前没有可接收引用的 Obsidian 笔记视图」）在本流程不可构造——chip 产生路径必经 Vault Ask（vaultHasOpenedRef 已置位），VaultView 常驻挂载，异会话下 chip 不在 DOM 无从点击；该态不在本 spec 断言（g-citation-open-errors.test.ts:35-39）。挂起类（resolveCitation 在途切换）无产品注入口，epoch 竞态面已由 R9 G54 真实验证，本 spec forbidden 由服务端 vaultSwitched 语义直达。

### G25 已签发凭据后修改原文再发送 —— PASS

命令：标准命令，spec `./test/e2e/acceptance/g-hint-and-plain-selection.test.ts`，fixture `G-hint-and-plain-selection.json`。

关键断言（g-hint-and-plain-selection.test.ts:561-695）：真实 ANSWER 检索 + 交接取得服务端新 Receipt 后：①hover card 提示存在且语义正确（匹配「发送时复验」，且不匹配「永久/无需复验/permanent」误导词）；②改原文后发送 → **SEND_FAILED 结构化错误面 + 点击展开含 `guard.evidenceStale`**（B-4 断言形态，非 idle+行数替代）+ idle 且无新权威行（rowCount 与发送前相等）+ 被拒草稿保留 + 源文件保持修改后内容；③拒绝后再采样提示仍在且逐字不变。运行证据：desktop-e2e-20261018-174043-798 `G25 … passed=true`（此前 -170104 至 -173811 八轮为调试轮）。

### G30 Composer 附加普通 Markdown 选区 —— PASS

命令：同 G25。关键断言（g-hint-and-plain-selection.test.ts:697-941）：清理 Composer 后经工作区 Markdown 预览真实文本选区 →「加入当前对话」（无 Receipt 的普通引用）：①chip hover card 双采样（间隔 1s）含选区文本与本地 path 文本，但 `hintText===null` 且无 `composer-open-trusted-citation` 动作；②发送完成态 turn 的 CLI 权威投影诊断 `receiptCount===0 && hasManifest===false && turnCitationCount===0`；③双采样无 `knowledge-answer-*` 可信来源渲染、全 DOM 无 chip 级可信标记/核验动作；④回放 artifact 请求体实证：含 `<conversation_quote>` 块 + 选区文本 + 本地 path 文本 + 问题 marker，**不含任何 `evr_`**（path 文本流入消息换不来可信来源权限）；⑤两个 fixture 文件字节不动。

## 产品缺陷（只记录不修）

### D-G20-1 上一轮候选「跳到原文」在无竞态下也确定性静默失败（G20 记 FAIL 的根因）

- 链路证据（文件:行以当前源码为准，2026-10-19 收尾复核命中）：
  - `packages/ui/src/v4/vault/knowledge/usePreviousKnowledgeActions.ts:91-97` —— `onOpenNote` 未被 await，其 `isCurrent` 闭包读取 `openingPreviousRef.current === token`；
  - `packages/ui/src/v4/vault/knowledge/usePreviousKnowledgeActions.ts:134-140` —— try 结束后 `finally` 在同一 tick 内把 `openingPreviousRef.current` 置空；
  - `packages/ui/src/v4/VaultView.tsx:1339-1340` —— `openFile` 内 `await flushCurrentEditor()`（至少让出一个微任务），紧随其后的第二次 `isCurrent()` 因此恒为 `false` → `return false`。
- 真实运行证据（desktop-e2e-20261018-175308-157 / g-interleaving-triage-run2.log）：探针 it `false !== true`（g-interleaving.test.ts:1247）；host 侧 `prepareEvidence/resolveCitation` 返回 OK（desktop log 23:45:57.245/249），全程零 `obsidian-vault.readFile`，30s 采样 notes tab 未激活。Node 最小时序复现脚本（仓外工作文件 `d-g20-1-minimal-repro.mjs`）输出 `note-closed(bail-second-isCurrent)`。
- 影响面：G17/G18/G20/G28 一族「上一轮/历史候选打开原文」交互；当前轮卡片 open（scope 型 isCurrent）与回答引用回跳（epoch 型）不受影响。
- 处置：探针 it 保留在 g-interleaving.test.ts（含完整证据注释），默认 `this.skip()`（CI 步骤不带 `DRORA_E2E_PROBE_D_G20_1`）；修复落地后以该 env 重跑，探针转绿即撤销 skip，G20 随之恢复完整判定力。

### D-minor-1 会话切换后重开 Ask 视图，索引状态条停留 loading

`packages/ui/src/v4/vault/knowledge/KnowledgeAskView.tsx:125-143`：切会话触发 scopeReset 置空 indexStatus（`setIndexStatus(null)`），而 refreshIndexStatus 仅依赖 indexService 身份、不随 scope 重跑 → 重开视图后状态条真实停留 "loading"。检索功能不受影响（就绪性由真实候选轮询证明）。g-interleaving.test.ts 头注与 `openVaultAsk` 注释（:232-254）已记录。

### 环境现象（非产品判据，如实记录）

g-hint 批三轮观察到桌面 app 在 G30 turn 完成后数秒内被外部整体重启（main 日志 `[app-quit]` + 新 pid；desktop-e2e-20261018-172326-244 等三轮复现），其后用例只能见到 root-startup-loading。已把 G30 排在最后一个 it 使其不参与判定；来源待查，与本批用例判据无关。

## CI 接入

`.github/workflows/obsidian-electron-cross-platform.yml` `desktop-acceptance-r1-r9` job（ubuntu/windows/macos 矩阵）在 R9 步骤后新增三步：`G interleaving (G11/G20/G21/G22)`、`G citation open errors (G28/G29)`、`G hint and plain selection (G25/G30)`，env 照抄相邻 R 步骤（`DRORA_E2E_SPEC` / `E2E_PROVIDER_REPLAY_FIXTURE_PATH` / `DRORA_E2E_HOME_DIR` 独立目录 / Linux `xvfb-run` 前缀）；三个 `G-*.json` fixture 同步登记进 fixture 存在性校验步骤与 pull_request paths 触发器（EC-1 同款教训：fixture 变更必须触发验收）。

## 本地门禁（收尾提交员 2026-10-19 执行）

- `pnpm typecheck`：exit=0。
- `pnpm architecture:check -- --changed`：exit=0。
- `pnpm exec oxfmt`（三个触碰的 spec .ts）：exit=0，无 diff。
- 三个 spec 真实 Electron 运行：g-interleaving exit=0（本次收尾复跑，4 passing + 1 skipped）；g-citation-open-errors exit=0、g-hint-and-plain-selection exit=0（三批运行 artifact 见上，spec 未被收尾改动）。

## 2026-10-19 补记 · D-G20-1 修复与 G20 转正

产品缺陷 D-G20-1（usePreviousKnowledgeActions.ts finally 与未 await 的 onOpenNote 竞态，见上文根因链）已于 2026-10-19 修复：导航 isCurrent 闭包改为自包含（mountedRef + openEpoch + submitSeq，对齐当前轮 openCurrentCandidate 先例），与 finally 即时清空的 busy token 解耦；取消/新动作/新检索/卸载各失效路径保持不变。g-interleaving.test.ts 的正向对照探针撤销 DRORA_E2E_PROBE_D_G20_1 门控、转为默认回归守卫。G20 在 SMOKE 矩阵改记 PASS（2026-10-19）。
