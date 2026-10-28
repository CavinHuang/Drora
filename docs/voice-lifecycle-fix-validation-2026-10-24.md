# 语音生命周期修复验证（2026-10-24）

对象：`D:/workspace/projects/drora-voice-agent`，`feat/voice-agent-phase1`，基线 HEAD `37100ee8` + 本批未提交改动。
设计先行记录：`specs/voice-agent-integration.md §9.8`。本批只修 F1–F6，没有提交、推送或提升候选到正式 CI。

## 修复与回归

| 发现 | 修复机制 | 主要证据 |
|---|---|---|
| F1 Esc 只改界面状态 | Esc 定向录音入口，失效 episode 后 abort 引擎/音轨、取消上传并退订，再回 Idle；点按 stop 保留最终转写；逐句 injecting 不结束 episode | useVoiceDictation、Web Speech/remote adapter UT；VOICE-L01 Desktop |
| F2 跨会话误取消 | workspace key + session 定向单播，同会话双 pane 只处理一次，优先播报 owner 保证同步静音；保留既有 stop/stale-run 守卫 | voiceCommandBus、双 hook、interruptCommandFlow UT |
| F3 非 owner 卸载破坏播报 | store 原子分配播报 owner；control 所有写路径校验凭证；非 owner 不执行共享引擎 cancel；指示器停止路由到真实 owner | 双 planner 卸载隔离与 owner UT |
| F4 迟到 claim 重新开播 | 起播 generation + disposed/owner/录音条件复核；claim 返回具体 lease，续约与释放按对象身份；旧结果只释放自己；同 owner 换正文继续采用有效续约 | 停止/卸载后的 acquire、续约后新 pane 播报、同 owner 正文替换、旧 token release UT |
| F5 仅权限 pending 不排空 | 录音结束调度权限优先队列；获取 claim 返回后复核 pending；权限段第一句同样阻止简报插队 | 仅权限录音释放、已处理权限、权限整段顺序 UT |
| F6 remote 入口依赖 Web Speech | 入口和起录共用选型；remote 独立检查媒体/网络 API + 厂商档；凭据只经 credentialService 读取，不入 store | 能力矩阵/hook UT；VOICE-L06 Desktop |

为遵守 800 行上限，纯文本聚合/分句迁入 `turnSpeechText.ts`，播报 control 迁入
`voiceAnnouncementControl.ts`；原 planner 导出入口保持兼容。新增源码位于 managed voice 模块，
`voiceRecordingControl.ts` 的跨模块消费已登记公开入口。测试分句组随实现独立为 `turnSpeechText.test.ts`。

## 最终检查

环境：通过 `volta run --node 24.14.0` 固定 Node，pnpm 10.33.2。

| 检查 | 真实结果 |
|---|---|
| freshness | voice worktree 基线检查通过 |
| `pnpm typecheck` | exit 0 |
| `pnpm --filter @drora/desktop typecheck:e2e` | exit 0 |
| `pnpm lint` | exit 0，421 warnings / 0 errors，与初始警告总数相同 |
| `pnpm architecture:check --changed --base ee9c97b0` | exit 0，violations/baseline/new = 0 |
| 相关 Vitest | 29 文件、316 测试通过 |
| 改动 TS/TSX 的 `oxfmt --check`、`git diff --check` | 通过 |
| Windows Desktop 候选 E2E，最终源码重新构建 | 1 spec、2 case 通过，exit 0 |

单测命令：

```powershell
volta run --node 24.14.0 pnpm exec vitest run packages/ui/src/voice packages/ui/src/store/voiceSessionStore.test.ts packages/ui/src/settings/VoiceSection.test.tsx packages/shared/src/contracts/contract.test.ts packages/ui/src/prompt-editor/composerEscapePlan.test.ts packages/ui/src/v4/composer/composerTextAppend.test.ts --reporter=dot
```

Vitest 有 jsdom 的既有 canvas getContext 未实现提示，不影响以上通过结果。没有运行全量 UT。

## Desktop E2E

候选：`packages/desktop/test/e2e/conversation-session/manual-review/pending/voice-lifecycle.test.ts`。

- VOICE-L01：真实 mic/Esc 操作，受控 Web Speech/MediaStream，断言底层 abort 一次、活动音轨归零、迟到 final 不写草稿。
- VOICE-L06：真实设置与 composer，移除 SpeechRecognition，受控 MediaRecorder/测试 URL，断言 remote final 追加一次、上传一次、音轨归零。
- 最终运行：`desktop-e2e-20261024110611497-p52752-f6bac12bca1bea62`，重新构建 renderer，复用未改协议/CLI 的 agent。
- [最终 E2E summary](../packages/desktop/.e2e-artifacts/desktop-e2e-20261024110611497-p52752-f6bac12bca1bea62/summary.md)
- [最终 E2E manifest/JSON](../packages/desktop/.e2e-artifacts/desktop-e2e-20261024110611497-p52752-f6bac12bca1bea62/summary.json)

重放命令（从仓库根目录执行；fixture 路径按仓库根解析）：

```powershell
$env:DRORA_E2E_MANUAL_REVIEW='1'
$env:E2E_PROVIDER_REPLAY_FIXTURE_PATH=(Resolve-Path './packages/desktop/test/e2e/fixtures/upstream/common.json').Path
$env:DRORA_E2E_SKIP_BUILD='0'
$env:DRORA_E2E_SKIP_AGENT_BUILD='1'
volta run --node 24.14.0 pnpm --filter @drora/desktop test:e2e -- --spec './test/e2e/conversation-session/manual-review/pending/voice-lifecycle.test.ts'
```

SKIP_AGENT_BUILD 仅适用于本地已有与当前未改 CLI 对应的产物；新环境应不设该项。
本用例不发主模型请求，使用 common replay 支撑环境初始化，不需要真实厂商凭据。

过程中的失败也保留：首轮 capture 缺少上游地址、第二轮 fixture 相对路径错误，均在 before-all 阻断；
第三轮进入用例后暴露测试准备对跨 case 保留设置的错误假设，以及录音预览遮挡点击命中点。
准备逻辑改为读取实际开关状态、键盘场景直接聚焦 composer；未降低资源与转写断言。
第四轮 2/2 通过；最终在最新源码重建后再次 2/2 通过。

## 验证范围

VOICE-L02–05 的多 pane、异步竞态和 lease 边界由生产 hook/planner/store 的受控 UT 覆盖，
没有把它们写成已完成的 Desktop E2E。候选保持 pending，未做人审转正或 Docker/CI admission。

真实麦克风/音质、厂商连通性与格式、多窗口真机、手机语音、CLI source 透传等仍按原 spec 的 TV/延期项处理。
本批六项修复完成，不代表整个语音 Agent 路线图全部完成。
