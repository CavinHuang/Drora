# pass28 全域静态对拍 · 共用简报（2026-10-09）

你是本战役某批次的静态对拍收集员。所有批次共用本简报，你的具体域和必查项在派单 prompt 中给出。

## 战役目标

收集真值 zcode.cjs 的实现证据，与我方 drora CLI 当前检出源码逐域对拍，产出差距清单（分级 REAL-GAP）与对齐状态。**只收集与判定，不修改任何代码**（你唯一的写权限是本战役 `parts/` 目录下的自己的报告文件）。

## 资产路径

- **真值（zcode 0.16.9）**：`D:\software\zcode\resources\glm\`
  - `zcode.cjs`（14.8MB bundle，2026-09-22 构建；minified 但保留字符串字面量/反引号模板/多数属性名；函数名为压缩名如 `WKo`，可用字面串+邻近源码注释反查）
  - `packages\`：10 个明文内置插件包（android-emulator / browser-use / bundled-skills / documents / image-search / ios-simulator / node-repl-host / pdf / plugin-creator / presentations）
  - `provider\zcode-builtin.json`：内置模型目录（rev30）
  - `debug\zcode-debug.cjs`：打点副本（日志补丁版，仅作辅助，判差距以 zcode.cjs 为准）
- **我方（drora）**：`D:\workspace\projects\Drora\`（分支 feat/migrate-remote-and-pet @1c6e9f2d）
  - CLI 主体：`apps\drora-cli\packages\`（cli / core / tui / adapters / contracts / telemetry / tui / dynamic-workflow / dynamic-workflow-runtime / node-repl-host / 各插件包 / bundled-skills / shared-types / i18n / bootstrap / swift-bridge / debug）
  - 共享协议：`packages\shared\src\drora-protocol\index.ts`；RPC 框架 `packages\rpc`；服务 `packages\services`；客户端 SDK `packages\client`
- **既往战役报告**（方法论与基线，可引用须复证）：`docs\glm-parity-pass27-2026-10-08\`（22 零件+99-final-report）、`docs\glm-parity-pass26-2026-09-29\`、`docs\glm-parity-pass25*`、`docs\restoration-plan.md`（byte-offset 索引）

## 判定口径（逐条发现必须落级）

- `REAL-GAP P0/P1/P2/P3`：真值有行为、我方缺失或语义不同。P0=崩溃/数据破坏/安全洞；P1=主链路功能缺失或恒败；P2=边界面/健壮性/生态兼容缺失；P3=字面残差/日志/遥测细目。
- `EXTRA`：我方有、真值无的 wire 面/命令/行为（多余协议面也算账）。
- `翻案`：既往台账记录与当前代码不符（附当前证据推翻）。
- `销案`：确认双侧同形/同一缺省行为，不算差距。
- `复证-已修` / `复证-仍开`：对派单 prompt 中列出的"既往未清项"给出当前状态。
- **品牌改名不算 gap**：zcode→drora、ZCODE_*→DRORA_* 字面替换本身豁免；**但改名后丢失对旧名的兼容接受（真值接受旧名而我方只认新名、或生态约定名被改断）算 REAL-GAP**（例：pass27 P2 "ZCODE_* hook env 改名断生态"）。
- 版本号差异单列一条（我方 package.json 现为 0.0.1，真值 0.16.9，此案已知，勿重复立账）。

## 取证纪律（违反即报告无效）

1. **双搜**：方法面/命令面 grep 必须字面串与常量表双搜（历史教训：rewind/projection/plugins 三案因只搜单面误立又翻案）。
2. **活代码验证**：grep 命中≠活代码。看调用链是否可达、是否被注释/门禁关闭（例：pass27 P1 workflow 工具条目被注释）。dead code 单独标注。
3. **证据三件**：每条发现给 真值侧证据（文件+字节偏移或行号+≤20 字短摘）、我方侧证据（`file:line`）、判定理由。禁止长串粘贴（内容过滤风险）。
4. **不轻信既往报告**：引用 pass27/26 结论时必须自己复证当前代码。
5. minified bundle 定位技巧：先字面串 grep 拿偏移（`grep -abo`），再看前后文；bundle 内有 `// path/to/file.ts` 式段注释可定位源文件边界。
6. 报告用中文；结论部分先给"判定汇总表"（编号/级别/一句话/状态），后给逐条详证。

## 当前 checkout 已知未清项（派单到相关域时须给出复证状态）

- **P1 session/messages 投影回归**：`packages/server`（或 server-operations.ts:1885 附近）readMessages 被统一 `mapMessageWithParts`，真值语义双面分形（session/read→映射形、session/messages→raw 形）。修复=去掉一处 `.map`。**判据**：session/messages 应答帧的 id/sessionID/modelSelection 键名是否被改写为 messageId/sessionId/model，anchor/contextSnapshot 是否丢失。
- **P2 s08 goal 门窗口差**：goal 门两侧边界不一致（op6 resume 场景真值放行我方拒）。
- **P2 mobile-bridge wire 族**：真值 zcode_type 判别 19 值 vs 我方 2 值；failure 枚举 11 值缺。
- **P3**：rpcFrame 遥测 28→7 键、provider_endpoint_routing / client_signing / sr.memory 共 14 键缺、bundled-skills 不再内联进 bundle、插件级改名桥缺。
- **pass27 P1×5 状态待复证**：①workflow 工具条目注释；②官方插件 12 包源码缺（10-09 动态轮称引导 15/15 修复，静态源码面待复证）；③zcode-cua stub；④ClientRequestSigningV4 签名链缺（ed25519+HKDF+PoW+七头）；⑤drora-builtin.json siteRules 半截改名永不命中。
- **pass27 P2 遗留**：子代理 permissionMode 收窄、automation 模式拒收、ZCODE_*/DRORA_* hook env 兼容、env 双环境分流、ANTHROPIC_* 不进 SDK、validate path wire、EndpointRoutingService、--enable-workflow EXTRA、login 位置参数 EXTRA、Memory 段尾句。

## 输出约定

- 报告写到 `docs/glm-parity-pass28-2026-10-09/parts/p28-<你的批次-员号>.md`（派单 prompt 给出确切文件名）。
- 返回给主控的最终消息：判定汇总表（条数×级别）+ P0/P1 逐条一句话 + 报告文件路径。不要在返回消息里贴长报告。
