# Computer Use 对齐状态（2026-11-10 · 3.17.2 对齐收官 + 差距修复收官）

一页交接文档；过程档案见 `docs/cua-restoration-manifest.md`（第 50–73 轮逐轮），
战役权威 spec 见 `specs/cua-3.17.2-alignment.md`（四裁定+证据规则），
差距修复战役方案见 `specs/cua-gap-remediation-2026-11-09.md`（已收官），
产物契约与遗留决策见 `specs/mac-cua-helper-app-alignment.md`。

## 当前状态：3.17.2 全量对齐（P0–P5+P6 自动化面收官）

对官方 ZCode 3.17.2（本机 `/Applications/ZCode.app`；addon 锚
sha256 `b169b8dc…ceaea`）：

| 层                                                       | 状态                      | 验证方式                            |
| -------------------------------------------------------- | ------------------------- | ----------------------------------- |
| producer 层（zcode-cua 0.6.5 切段+方法表 43）             | ✅ 0.6.5+Apache-2.0       | host dist 四族 token 级 identical   |
| Helper JS（ghost 接线四件+IPC v3+element_scroll 门控）    | ✅ 还原自发行 bundle      | 五测试链全绿                        |
| **mac addon（ax_native）**                               | ✅ **逆向重建自建产物**    | 见下"自建 addon parity 终态"        |
| glm 内嵌插件与 darwin 原生件（koffi/sharp/libvips）      | ✅ 字节级                 | 种子替换 + afterSign 保真           |
| Helper 版本线/打包（SEA 3.17.2 骨架/node_modules 清单门） | ✅ 随 App=3.17.2          | build-cua-helper-app + 冒烟         |
| 首用链（安装/信任/发射/身份/状态）                        | ✅ 双路径 live 闭环       | 五处断裂修复各有测试/live 锚        |
| 生命周期（认领超时 90s 兜底 / 闲置 300s 自眠）            | ✅ 双路实测               | 直启观测                            |
| 渲染层 / 权限浮窗 / main 胶水 / agent 胶水                | ✅ 逐字同构               | 全文比对（浮窗仅产品名差）          |
| 认证模型 v2（peer 互验原生面）                            | ✅ LOCAL_PEERCRED 真实现  | launcher 门+peer 门 live（adhoc 线）|
| win32 行为面                                             | ✅ 97/97 面全收+三面套件全绿（W0-W5 收官 2026-11-11） | 9 面探针全 EQUAL；57/57+123 矩阵 0 差+41/41 写路径；接口双工具 97/97；字面量 276/276；fork E2E 双形态 |
| 跨进程桥接（launcher-pid/懒启动发现链/占位发射）          | ✅ 差距修复战役 R1+R2    | lazy-discovery-bridge + services 18 回归 |
| Helper 行为面细件（旋钮/socket 兜底/paste 串行/exit-log） | ✅ 差距修复战役 R3       | r3-behavior-restoration 全绿        |
| 版本/元数据解锁与打包门（placeholder/staging arch）      | ✅ 差距修复战役 R4+R5    | 见 manifest 第七十三轮逐项          |

## 差距修复战役（2026-11-09 审查 → 2026-11-10 收官）

3.17.2 对齐收官后的独立差距审查（run dwfrun-7c7706ec → dwfrun-29201688 修订版，
23 条定案）产出修复方案 `specs/cua-gap-remediation-2026-11-09.md`，R1–R5 五批
已全部落地：跨进程契约键桥接（launcher-pid 切 ZCODE_ 消费面键名 + 发现链三桥接
键 + `ZCODE_HOME` 透传钉住）、pre-launch 占位贯通 token 鉴权（D1=选项 A）、
Helper 行为面六件机械还原（SEA offset 逐字锚定）、版本/元数据解锁（0.6.5 +
`droraCuaPlaceholder:false`）、打包门生效（staging `<arch>` 段）。逐项登记见
manifest 第七十三轮；桥接键双轨=有意分歧见 divergence ledger 台账 17。回填时
复跑回归全绿（lazy-discovery-bridge / r3-behavior-restoration / services 四文件
18/18）。遗留 backlog 一项：paste reader 钉扎（low，待官方语义生效证据）。

## 自建 addon parity 终态（第七十二轮，生成器 `generate-mac-rebuilt.py`）

- 导出面 **136/136**；全量扫荡 297 形态（余项=探针驱动器跨跑 pid 键伪差与
  scw 分钟级窗表漂移，按 windowId 对齐 37/37 零差）。
- **captureApp 全树 1000/1000 节点全键 JSON 精确零差**；text_preview 字节级一致；
  axh-N 句柄注册表生命周期（首轮 1000 上限/跨调用保活/越界 null）同构。
- ghost 状态机 20 场景 + 会话调色板 44 键 + 自检三件套（确定性纯数学输出）全 MATCH。
- 生产路径（探针盲区，换装首跑抓出并 live 修复）：`getPeerCredentials(fd)`=
  LOCAL_PEERCRED+LOCAL_PEERPID；`verifyProcessCodeSignature(pid, requirement)`=
  SecRequirement 真校验。
- 钉扎：`native/ax_native_mac.node` = 自建产物 sha256 `4214ee9be3d1394…`（build
  脚本常量；重跑生成器+make 后产物字节变，须同步换值）。
- 已知残留（记档）：beginAction 会话组 occl 官方 0/1 跨轮翻转（异步遮蔽态，取多数 0）；
  AXColumn 全属性 cannot-complete 时 enabled 官方稳定 true（按证据特例化）；
  StableSessionIndex 多字符一般式未破（44 键实测覆盖表+规则层+fnv1a 兜底，仅影响配色）。

## 分发形态（路线 A：ad-hoc）

- 包内 Helper 为自建折叠产物（`CUA_HELPER_ALLOW_UNSIGNED_LAUNCHER=1`），
  buildId `drora-<版本>`；`LSEnvironment.DRORA_CUA_HELPER_ADHOC_DISTRIBUTION=1`
  贯穿 launcher 门/安装校验/live 复核（`adhocDistribution` 分支）。
- 首用自动安装至 `~/.drora/computer-use`（ZCODE_HOME 路由），meta/lock 齐备，
  buildId 变更自动重装。
- ad-hoc 固有代价：每次重打包 cdhash 变 → TCC 授权需重授（自签名线见下）。

## 复验命令

```bash
# mac addon 逆向重建（生成器→编译→产物）
cd packages/zcode-cua-helper/native/reverse && python3 generate-mac-rebuilt.py \
  && cd build && make Release/ax_native_mac_rebuilt.node
# 套件（构建→探针→契约→双轨 parity）
pnpm --filter @drora/drora-cua-helper-runtime verify:mac
# 五测试链
cd packages/zcode-cua && for t in restored-smoke cua-tool-layer-smoke embedded-build-id \
  mac-launch-contract adhoc-distribution-profile; do node test/$t.mjs; done
# 打包冒烟（SEA→staged bundled-cua-helper）
cd packages/desktop && node scripts/prepare-cua-helper.mjs
```

构建工具链注意：volta 自带 pnpm 绑 node 18 不可用——
`PATH="$HOME/.volta/tools/image/node/24.14.0/bin:$PATH" corepack enable --install-directory /tmp/ci-bin && PATH=/tmp/ci-bin:$PATH pnpm …`
（postject 对 3.17.2 骨架 memory-out-of-bounds——build 脚本 Mach-O 直补回退可用。）

## 待用户参与的两项（P6 残留）

1. **真机 ghost 肉眼验收**：会话开 CUA→glide 曲线/涟漪/会话色/badge/多屏跟随
   （ghost 视觉层官方=ZcPip ObjC 窗口栈，重建侧为状态机+自检面，视觉生效随真机链）。
2. **release 真实打包冒烟**：electron-builder 全量（16 类资产清单+afterSign 新链）。

## 工作树

第 50–73 轮累计未提交（用户明示不 commit）；3.17.2 战役五会话改动清单见
manifest 第六十七–七十二轮逐轮登记，差距修复战役见第七十三轮。win32 专属文件
零改动声明成立
（win target 语义未变、共享模块 tsc+build 无损、architecture:check 三零）。
