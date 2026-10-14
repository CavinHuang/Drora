# ZCode v3.15.1 官方实现优先收敛

日期：2026-10-13（Asia/Shanghai）。官方基线 `aac4755666d09fdcd70272fcf063c077a639015f`，本地修复起点 `11d92f9b`。

用户确认尽量以官方实现为准。策略与逐项取舍已写入 [迁移 spec](../../specs/upstream-v3.15.1-migration.md#官方实现优先2026-10-13) 和根 `AGENTS.md`：官方覆盖现有需求时替换自研实现、删除重复链路；只需发行或部署差异时通过端口装配；保留的独有能力记录差异原因及再次迁移条件。

## 本轮实际改动

修复二次审查 R01：Bootstrap 的 CUA seed 清单补回官方要求的 `skills/computer-use/SKILL.md`。filesystem 与 SEA 继续走既有生产校验和 seed 链路，不新增检查器、缓存或状态所有者。当前清单涵盖官方三项路径，额外保留冻结 SDK 所需的 `package.json` 和 `node_modules/sharp/package.json`，与 Desktop staging 五项一致。

新增 `cua-seed-completeness.test.ts`，验证实际缓存行为：

| seed 来源        | 场景                             | 结果                                         |
| ---------------- | -------------------------------- | -------------------------------------------- |
| filesystem / SEA | 无缓存，源仅缺 Skill             | 拒绝写入缓存，告警准确列出 Skill，启动不抛错 |
| filesystem / SEA | 已有同版本完整缓存，源仅缺 Skill | 保留 Skill 与原 seed marker，不用残缺源覆盖  |
| 共同校验器       | 分别缺 package / sharp           | 继续拒绝缺少运行时依赖的 seed                |

filesystem 测试使用临时磁盘文件和真实生产复制/校验/缓存逻辑；SEA 测试在 builtin adapter 边界提供资产 fixture，执行真实生产 manifest/hash/seed 逻辑，未声称生成并运行原生 SEA 可执行文件。完整源在“已有缓存”两个场景中先成功 seed。

冻结 0.6.3 SDK、Helper、依赖版本和 lockfile 未改动。公开 0.6.4 占位包不能覆盖当前可运行的还原能力。

## 同职责实现复核

这些链路在前轮已收敛，本轮确认现状，没有再次搬动：

- 远控页面、任务/聊天、manager、transport 与 Host attachment 使用官方实现；`mobile-web` 构建直接调用 `packages/web`，旧 UI 只保留取证用途。
- 输出风格服务与服务契约和固定上游逐字比对，除 `@zcode/` → `@drora/` 包名外完全一致。复用同一 `.claude` 配置及官方 service。
- 模型执行材料 helper 与官方源码比对，仅有包名、协议名和迁址后的相对 type import 差异；旧协议 re-export，共用一个实现。会话收尾 helper 同样共用官方行为，不另维护另一套 residency 状态。
- 更新通用状态机、Gen UI/MCP Apps、Bot 与工作流继续使用官方路径。

知识库/Vault/Jev/ONNX、证据审批、S03、桌面宠物和 Relay 服务端在该公开版本中没有覆盖当前需求的同等实现，继续保留独立模块。官方 memory 不等于 Vault 检索，公开 Relay 客户端不等于未开源服务端。发行 feed、LAN 端点、凭据 origin 隔离属于装配差异。完整取舍与替换条件以 spec 为准。

## 本轮验证

- 新增四个缺 Skill 场景：修复前全部失败，原因均为未发出残缺 seed 告警；修复后全部通过。另有两项 native 依赖校验通过。
- Bootstrap 插件相关六个测试文件：79 passed、0 failed。
- 既有输出风格 Node 回归：9 passed、0 failed。
- `pnpm typecheck`、Bootstrap `pnpm typecheck`：通过。
- 新增测试文件单独执行严格 TypeScript 检查：通过（Bootstrap 常规 typecheck 只包含 `src`）。
- `pnpm lint`：395 warnings、0 errors，与基线一致。
- `pnpm architecture:check --changed`：0 violation、0 baseline、0 new。

可复查的测试入口：

```sh
pnpm --dir apps/drora-cli/packages/bootstrap exec vitest run \
  tests/cua-seed-completeness.test.ts tests/plugins.test.ts \
  tests/bundled-plugins-resilience.test.ts tests/official-plugin-runtime.test.ts \
  tests/official-plugin-cache-fs.test.ts tests/official-plugin-seed-lock.test.ts \
  --maxWorkers=2
node --import tsx --test packages/services/test/output-style.node-test.mjs
pnpm typecheck
pnpm --dir apps/drora-cli/packages/bootstrap typecheck
pnpm exec tsc --noEmit --target ES2023 --strict --module NodeNext \
  --moduleResolution NodeNext --skipLibCheck \
  apps/drora-cli/packages/bootstrap/tests/cua-seed-completeness.test.ts
pnpm lint
pnpm architecture:check --changed
```

没有重复运行前轮全量测试、发行构建或真机 E2E；前轮的 49 项独立上游基线失败、两项公网归档访问失败，以及跨平台/官方云服务/新版 bundle 未验收边界仍保留，不能因本轮聚焦测试通过而改写为成功。
