# Start Plan 模型请求的阿里云 Captcha 校验（3007 修复）

## 背景与根因

`account:bigmodel-start-plan` / `account:zai-start-plan` 的模型请求（`https://zcode.z.ai/api/v1/zcode-plan/anthropic`）在认证通过后仍被拒：

```
status=400 provider_code=3007 msg="captcha verify failed" reason=auth_failed retryable=false
```

2026-09-26 用本机真实凭据 A/B 复现实锤（详见记忆 `drora-start-plan-3007`）：

- `Authorization: Bearer <drorajwttoken>` 通道有效（只带 `x-api-key` 是 401）；JWT、权益（billing/balance 成功、plan active）、请求头结构与原版 bundle 逐函数一致——客户端凭据面无错误。
- 3007 的真实语义是阿里云 ESA 边缘 WAF 的**人机验证（captcha）关卡**：官方客户端对 Start Plan 的每次模型请求都会附带一次性的人机验证凭证，凭证缺失/无效时 WAF 以 3007 拒绝。换 UA（Chrome/Electron）不改变结果，判定维度是凭证而非 UA。
- 官方同族问题：zai-org/feedback#548（同套餐裸 Node 进程 100% 3007，桌面端正常）、#349（Windows 客户端 Aliyun CAPTCHA getInstance 超时 → 后续请求 3007）。

## 官方实现（3.14.x 桌面端 out/ 反汇编取证）

官方桌面端在该场景下的完整链路：

```
CLI 模型请求前 ── interaction/requestProviderRuntimeHeaders (reason=model-request|captcha-retry)
  → host 转发给 renderer
  → renderer（仅 access.type=zhipu-account && access.mode=start-plan 时）：
      1. client-configs 读 configs.captcha（{enabled,region,prefix,sceneId}，60s 缓存）
      2. per-provider 串行锁内加载 https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js
         window.AliyunCaptchaConfig={region,prefix}
         initAliyunCaptcha({SceneId, mode:"popup", language, showErrorTip:false, element, button,
                           getInstance, success, fail, onError})
      3. 无感优先：instance.startTracelessVerification()（8s 无响应超时）；
         必要时点击 button 触发交互挑战（滑块），整体预算 120s
      4. success(captchaVerifyParam) —— param 一次性，用后即弃；重复 certifyId 检测（F008）
      5. headers = { "X-Aliyun-Captcha-Verify-Param": param,
                   ("X-Aliyun-Captcha-Verify-Region": region) }
  → respondProviderRuntimeHeaders 回 host
  → host 只把上述两个头白名单合并进 requestAuth.headers 回 CLI
  → CLI 原样透传（CLI bundle 不含任何 captcha 字样，只透传 headers）
```

关键证据（官方 out/renderer/assets/styles-DEELZGp2.js）：

- `bnn`：仅 `zhipu-account`+`start-plan` 走 captcha；付费 Coding Plan 不需要。
- `XTs/ZTs`（与还原目录 `withAnthropicAuthorizationHeader` 逐字等价）：host 合并头的方式与 CLI SDK 头构造，还原稿均忠实。
- source 标注 `send_preflight`（每次请求）/`captcha_retry`（3007 重试路径）。

## Drora 缺口

- 本仓（还原自 3.14.x CLI bundle）CLI 侧无需改动也不含 captcha——缺口在**桌面端从未实现采集与注入链路**（全仓 `rg -i captcha` 为 0）。
- 付费 Coding Plan（open.bigmodel.cn/api/anthropic 或网关 ultra 路径）不受影响；仅 Start Plan 被拦。

## 方案（与官方的有意分歧，均已评估）

官方采集环境是 renderer DOM。Drora renderer 目前只是 RPC client、没有 host→renderer 的反向 channel；为不扩大 RPC 拓扑改动面，Drora 把采集器放在 **main 进程隐藏 BrowserWindow**（同为 Chromium DOM，SDK 指纹一致），host 经既有 parentPort 桥（browser-use 同款模式）按需调用：

```
CLI runtime-headers 请求 → droraAgentService（services 层，新增 StartPlanCaptchaResolver port）
  → desktop host 装配的 resolver（startPlanCaptchaMainBridge，parentPort）
  → main desktopHostProcess 分发 → captchaSolverWindow（隐藏窗口 executeJavaScript 跑 SDK）
  → {captchaVerifyParam, captchaRegion} 回 host → 白名单头合并进 requestAuth.headers → CLI
```

有意分歧（后续从官方同步时按此甄别，不算缺口）：

1. **采集环境**：renderer → main 隐藏窗口。理由见上。
2. **交互挑战**：官方在 renderer 内弹滑块；隐藏窗口用户不可见，第一版只做无感（traceless），采集失败/超时降级为现状（不带头 → WAF 3007 透出），不做无限重试。后续如需交互挑战，可将窗口临时可见承载 popup。
3. **触发路径**：官方还有 `captcha-retry` reason 的显式重试；Drora 第一版在每次 Start Plan 请求的 runtime-headers 应答内即时采集（send_preflight 语义等价），不单独实现 retry reason。
4. **远程 workspace（desktop-attached-remote）**：官方远程模式同样无法弹验证码（#548）；Drora 远端 authority 不注入 resolver，保持现状。

不变量：

- CLI bundle（还原文件）零改动；协议 schema 零改动（reason 枚举保持 `model-request`）。
- resolver 失败绝不能让请求失败——降级只回 apiKey，与修复前行为一致。
- 头白名单只认 `X-Aliyun-Captcha-Verify-Param` / `X-Aliyun-Captcha-Verify-Region`（与官方一致），param 不落盘、不进日志。

## 验收场景

1. bigmodel 账号 + Start Plan（active）+ GLM-5.3-Flash 发消息：请求带验证头，WAF 放行，正常出流。
2. captcha 配置缺失/采集超时：请求仍发出（无验证头），错误与修复前一致（3007 auth_failed），无新增异常路径。
3. 付费 Coding Plan / API Key provider：请求头不包含验证头（回归）。
4. `pnpm typecheck` / `pnpm lint` 通过；resolver 注入/降级有单测。
