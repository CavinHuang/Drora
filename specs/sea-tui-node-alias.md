# SEA TUI 的 Windows 原生模块绑定修复 Spec

## 背景

`drora-windows-x64.exe tui`（SEA 单文件）在真实终端中无响应并退出。
ConPTY 捕获的真实错误链：

1. opentui 初始化时 `loadNode22Modules()` 依次 `require("koffi")`、
   `require("unsafe-pointer")`；
2. `unsafe-pointer` 的 prebuild（`.node`）把 N-API 符号静态绑定到 **`NODE.EXE`** 导入；
3. Windows 加载器按**进程映像名**解析宿主：SEA 可执行文件名为
   `drora-windows-x64.exe` ≠ `node.exe` → 绑定失败（126 找不到指定的模块）；
4. opentui 回退为 unsupported FFI backend → 抛
   "OpenTUI native FFI is not available for this runtime yet" → TUI 退出。
   （node-gyp-build 随后输出的 "not a valid Win32 application" 是误导性的二次错误。）

koffi 自身不含 NODE.EXE 导入，同一 SEA 内加载正常——问题仅在
`unsafe-pointer` 这类按宿主名绑定的原生模块。

## 决策

SEA + win32 环境下，TUI 不在当前进程运行，而是：

1. 把 SEA 自身（`process.execPath`）复制为解包运行时目录中的 `node.exe`
   （内容相同的副本；已存在且大小一致时跳过复制）；
2. 以该 `node.exe` 为映像名spawn 子进程运行嵌入式 CLI 的 `tui`，
   `stdio: inherit`、同 cwd、同参数（SEA 的 argv 形如
   `[execPath, execPath, ...userArgs]`，用户参数从 index 2 起）；
3. 环境变量哨兵 `DRORA_TUI_NODE_ALIAS_CHILD=1` 防止子进程再次派生；
4. 父进程等待子进程退出并透传退出码。

非 SEA / 非 Windows 返回 null，走原进程内路径，行为不变。

## 不变量与边界

- 该路径仅影响 Windows SEA 的 `tui` 命令；`--prompt`、app-server 等
  不加载 opentui，不需要别名进程。
- 复制的 `node.exe` 位于用户缓存目录（sea-assets 解包目录），随缓存
  生命周期管理；复制失败时向 stderr 报告后仍尝试派生。
- macOS/Linux 的 SEA 无 NODE.EXE 绑定问题，TUI 保持进程内运行。

## 验收

1. Windows ConPTY 下 `drora-windows-x64.exe tui` 渲染启动屏并保持运行
   （≥25s 不退出），无 FFI 错误、无 Unknown command。
2. 子进程哨兵生效（无递归派生）。
3. `pnpm typecheck` / `pnpm lint` 回基线。
