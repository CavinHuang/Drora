const POWERSHELL_COMMON_ARGS = ["-NoLogo", "-NoProfile", "-NonInteractive"];

const WINDOWS_POWERSHELL_SECURITY_BOOTSTRAP = [
  "$ErrorActionPreference='Stop';",
  "try{",
  "$droraSecurityModule=[IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Security','Microsoft.PowerShell.Security.psd1');",
  "Import-Module -Name $droraSecurityModule -Force -ErrorAction Stop;",
  "}catch{",
  "[Console]::Error.WriteLine(('Windows PowerShell Security module load failed: {0}' -f $_.Exception.Message));",
  "exit 26;",
  "};",
].join("");

function encodeUtf8Value(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

// 修复依据：Windows PowerShell 5.1 的 [Console]::Out 默认按本机控制台输出代码页
// （如 zh-CN 的 GBK）写出，Node 侧按 utf8 解码导致非 ASCII 值往返即成 mojibake
// （powershell-command.test 实测中文路径损坏）。注入脚本前先把控制台输出编码显式
// 置为 UTF-8；重定向 stdout 下该 setter 会重建写入器，对后续 [Console]::Out.Write 生效。
const UTF8_OUTPUT_BOOTSTRAP = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;";

export function createEncodedPowerShellArgs(script, values = []) {
  // Windows PowerShell 5.1 会把普通 `-Command` 后续 argv 拼回命令文本，
  // 不会把它们注入 `$args`。动态值先单独编码，再放进 `-EncodedCommand`，同时避免
  // Program Files 空格、引号或分号被 PowerShell 二次解析成脚本内容。
  const valueBindings = values
    .map(
      (value, index) =>
        `$droraArg${index}=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodeUtf8Value(value)}'));`,
    )
    .join("");
  const encodedCommand = Buffer.from(
    `${UTF8_OUTPUT_BOOTSTRAP}${valueBindings}${script}`,
    "utf16le",
  ).toString("base64");
  return [...POWERSHELL_COMMON_ARGS, "-EncodedCommand", encodedCommand];
}

export function createWindowsPowerShellSecurityArgs(script, values = []) {
  // 由 pwsh 启动的 Node 会继承 PowerShell 7 的 PSModulePath，随后再启动
  // Windows PowerShell 5.1 时可能错误发现不兼容的 Security 模块。直接从当前
  // powershell.exe 的 PSHOME 加载系统模块，避免把外部环境变量当作模块信任根。
  return createEncodedPowerShellArgs(`${WINDOWS_POWERSHELL_SECURITY_BOOTSTRAP}${script}`, values);
}
