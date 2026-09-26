# Server 型远程工作区（客户端链）Spec

对齐官方原版第 46 轮 C 项：Drora 桌面端作为客户端，连接一个已经独立运行的
Drora Server（`packages/server` 的 HTTP/WS 服务），复用其上的 Agent 运行时，
不在本机做任何 asset 部署。服务端端点（`/api/server-info`、`/api/rpc-host-capability`、
`/ws/host`）已在 `packages/server/src/http.ts` 与 `packages/shared/src/server-remote.ts`
落地；本 spec 定义**客户端链**。

## 协议与端点解析（shared）

`resolveServerRemoteEndpoints(url)`（`packages/shared/src/server-remote.ts`，
对齐官方 `IRe`）是唯一的端点解析入口，禁止业务代码手拼端点 URL：

- 输入 `http(s)://` → info/capability 保持 http(s)，ws/hostWs 转 ws(s)；
  输入 `ws(s)://` → info/capability 转 http(s)，ws/hostWs 保持 ws(s)；
  其它协议抛 `Unsupported server URL protocol: <protocol>`；空输入抛
  `Server URL is required`。
- 先剥掉末尾 `/ws/host`、`/ws` 再拼接端点路径；`search`/`hash` 一律清空。
- 输出 `{ infoUrl, wsUrl, hostCapabilityUrl, hostWsUrl }`（`/api/server-info`、
  `/ws`、`/api/rpc-host-capability`、`/ws/host`）。

## 客户端连接链（services）

`@drora/services/server-remote`（对齐官方 `RRe`/`ARe`/`ERe`/`JJ`）：

1. `fetchServerRemoteInfo(infoUrl, { token? }, fetchImpl?)` — GET；token 同时走
   `Authorization: Bearer` 与 `?token=` 查询参数；非 ok 抛
   `Server info request failed: <status>`；响应用 `serverRemoteInfoSchema`
   safeParse，失败抛 `Server info response is invalid`。
2. `fetchServerRemoteHostCapability(url, { token? }, fetchImpl?)` — POST（无
   Authorization 头，仅查询参数 token）；非 ok 抛
   `Host capability request failed: <status>`；响应用
   `serverRemoteHostCapabilitySchema` safeParse，失败抛
   `Host capability response is invalid`；返回一次性 capability 字符串。
3. `connectServerRemoteTarget({ url, token? }, options?)` — 组合 1→2→WS：
   `new WebSocket(authenticatedUrl(hostWsUrl), { headers: { authorization?, 
   x-drora-rpc-host-capability: capability } })`；open 前错误/关闭分别
   reject；close-before-open 的 reason 文案 `WebSocket closed before ready: <reason>`
   或 `WebSocket closed before ready (<code>)`。成功返回
   `{ serverInfo, capability, socket, dispose }`。`fetchImpl` 与 WebSocket
   构造器均可注入（测试与宿主环境差异）。

状态所有者：连接生命周期由窗口 Host 的
`windowRemoteConnectionRegistry`（desktop）按 `server:<hostWsUrl>` 复用键管理；
capability 是一次性票据，每次 connect 重新申请，不做缓存。token 只经
credentialService 存储（snapshot 仅存 `tokenCredentialKey`），与 SSH password
同一边界。

## 消费边界（本轮范围）

- `RemoteTargetSnapshot` / `RemoteTarget` 增加 `kind: "server"`（url +
  token/tokenCredentialKey）；identity 构造走既有
  `buildRemoteWorkspaceIdentity`（authority 段 encodeURIComponent 编码 URL）。
- 注册表 `buildConnectionKey` 增加 server 分支；`createRemoteBackend` 对
  server 显式抛错（server 不走 SSH/WSL/Docker 部署链）。
- 不在本轮：Host `setupRemoteConnection` 的 server 分支（ws → RPC services 组装、
  prompt attachment 与 capabilities 组合）、连接向导表单与 `remote.kind.server`
  等 i18n 键、重连链路的完整 token 恢复端到端验证。

## 恢复快照与 serverInfo 透出（第四十九轮）

对齐官方提交形态：renderer 提交的 target 带 `name?/workspacePath?`，官方快照
target 同样持久化这两个字段。

- `ServerRemoteTargetSnapshot`（`packages/shared/src/protocol.ts`）与
  `remoteWorkspaceTargetSchema`（`validationAppSettings.ts`，setting.json 读写
  校验面）增加可选 `name`/`workspacePath`；token 仍只存 `tokenCredentialKey`。
- UI 写入链：`createRemoteTargetSnapshot`（`packages/ui/src/lib/remoteWorkspaceHistory.ts`）
  把 ConnectOptions 的 name/workspacePath（trim 后非空才写）带进快照；恢复链
  `createRemoteTargetFromSnapshot` 原样带回，保证重连/重启后 tab 副标题
  （`formatRemoteWorkspaceHeaderHostLabel` 消费 name）与后续落库不丢字段。
- 打开语义：重连沿用既有 `sessionEntry.workspacePath` 自动打开；target 级
  workspacePath 只是“默认目录”，新连接表单预填路径，不参与重连目录决策。
- serverInfo 透出路径（唯一通道，无新增 IPC channel）：Host 连接 handle 携带
  `serverInfo` → `windowRemoteConnectionRegistry.connect` 写进
  `WindowHostRemoteWorkspaceDescriptor`（`windowHostRemoteWorkspaceDescriptorSchema`
  增加可选 `serverInfo`，strict 校验）→ main `attachRendererPort` 随既有
  `ScopedServicePort` 元数据附带 → renderer 解析后挂进
  `RemoteWorkspaceSession.serverInfo`（remoteWorkspaceSessionStore）。
  renderer 侧再过一次 `serverRemoteInfoSchema` safeParse，坏值只丢字段不丢 port。
- 消费面：连接向导 directory 步骤顶部渲染 `serverInfo.workspaces`
  （`{path,label?,workspaceIdentity?}[]`）快捷列表（i18n
  `remote.serverWorkspacesTitle`），点击与手选目录同链（`onSelect(path)` →
  `selectRemoteDirectory(sessionId, path)`）；空列表不渲染，回落完整目录浏览器。
  非 server 形态全程无该字段，UI 不展示列表。

## 验收场景

1. `resolveServerRemoteEndpoints`：http/https/ws/wss 四类输入 × 四端点 URL 生成、
   尾部 `/ws` 剥离、非法协议/空输入错误文案逐字一致。
2. fetch 两个函数：注入 fetchImpl mock，校验 Bearer+query token、错误文案逐字一致。
3. connect：mock WebSocket，校验 URL/header 构造与 close-before-open 文案。
4. services 单测（`node --import tsx --test`）与 `tsc --noEmit` 通过；shared 构建通过。
5. （第四十九轮）快照往返：带 name/workspacePath/token 的 server 连接落库后，
   快照含 name/workspacePath 与 tokenCredentialKey、不含明文 token；
   `createRemoteTargetFromSnapshot` 回读保留 name/workspacePath；空白值不落快照；
   settings patch schema 接受新旧两种 server 快照形态。
6. （第四十九轮）serverInfo 透出：registry connect 返回的 descriptor 原样携带
   handle.serverInfo 并通过 `windowHostRemoteWorkspaceDescriptorSchema` strict
   校验；非 server 形态 descriptor 无 serverInfo 键且校验兼容。
