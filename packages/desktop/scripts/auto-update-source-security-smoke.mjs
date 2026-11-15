import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";
import { _electron } from "playwright-core";

// 修复原因（win32 平台缺陷）：上游脚本按 POSIX CI 编写，alias 与 onLoad 里直接把
// node:path.resolve 的 Windows 反斜杠绝对路径当模块说明符喂给 esbuild——esbuild 的
// import 说明符不接受反斜杠分隔符，193 个 @drora/shared 解析全部报
// "Cannot read directory"。统一转 POSIX 正斜杠（esbuild 在 Windows 亦按正斜杠解析）。
const toPosixSpecifier = (p) => p.split("\\").join("/");

const desktopDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(desktopDir, "../..");
// 直读 workspace 内 package.json（根 node_modules 不链接 @drora/shared，createRequire 走不通）。
const sharedExports = JSON.parse(
  readFileSync(resolve(repoRoot, "packages/shared/package.json"), "utf8"),
).exports;
const require = createRequire(resolve(desktopDir, "package.json"));
const useAppImageUpdater = process.argv.includes("--appimage");
const useNsisUpdater = process.argv.includes("--nsis");
await mkdir(resolve(desktopDir, ".e2e-artifacts"), { recursive: true });
const artifactDir = await mkdtemp(resolve(desktopDir, ".e2e-artifacts/update-source-security-"));
const entryPath = resolve(artifactDir, "main.cjs");
// D5 裁决区适配（specs/update-feed-github.md）：上游通过 resolveUpdateFeedSourceFromStartupConfig
// 支持 argv/env/direct/backend 覆盖 feed 地址（dev 环境期望 override）；本仓 manifest 链随
// MOD-ABSENT 两件保删除，feed 由打包期 app-update.yml 钉死（GitHub 通道），任何启动参数/
// 环境变量/后端 origin 都不能改写 feed——因此全部场景期望 trusted（即 D5 通道安全不变量）。
const cases = [
  { name: "packaged-argv", packaged: true, input: "argv", expected: "trusted" },
  { name: "packaged-env", packaged: true, input: "env", expected: "trusted" },
  { name: "packaged-direct", packaged: true, input: "direct", expected: "trusted" },
  { name: "packaged-backend-override", packaged: true, input: "backend", expected: "trusted" },
  { name: "packaged-deep-link", packaged: true, input: "deep-link", expected: "trusted" },
  { name: "dev-argv", packaged: false, input: "argv", expected: "trusted" },
  { name: "dev-env", packaged: false, input: "env", expected: "trusted" },
  { name: "dev-delimiter", packaged: false, input: "deep-link", expected: "trusted" },
];

await build({
  stdin: {
    resolveDir: desktopDir,
    sourcefile: "update-source-security-fixture.mjs",
    contents: `
import { app, ipcMain } from 'electron';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import pkg from 'electron-updater';
import { initAutoUpdater } from './src/main/autoUpdater.ts';
import { setSecuritySmokeOrigin } from 'security-smoke-origin';
import { extractDeepLinkUrlFromArgs } from './src/main/desktopDeepLinkUrl.ts';
const scenario = JSON.parse(process.env.DRORA_SECURITY_SCENARIO);
const root = process.env.DRORA_SECURITY_ROOT;
app.setPath('userData', root);
Object.defineProperty(app, 'isPackaged', { value: scenario.packaged });
process.env.DRORA_AUTO_UPDATE_DEV = '1';
process.env.DRORA_AUTO_UPDATE_DEV_VERSION = '3.17.0';
const { autoUpdater } = pkg;
// 普通 Linux Electron 没有 APPIMAGE，打包态模拟不会经过产品的开发态激活逻辑。
// 只激活隔离夹具的更新器，保留 scenario.packaged 作为更新源安全边界的被测输入。
autoUpdater.forceDevUpdateConfig = true;
const requests = [];
async function listen(label) {
  const server = createServer((req, res) => {
    requests.push({ label, url: req.url, headers: req.headers });
    if (req.url === '/package.bin') {
      res.end('update-auth-download-fixture');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/yaml' });
    res.end('version: 0.0.1\\nfiles: []\\n');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, url: 'http://127.0.0.1:' + server.address().port + '/manifest' };
}
(async () => {
  await app.whenReady();
  const trusted = await listen('trusted');
  const override = await listen('override');
  setSecuritySmokeOrigin(trusted.url);
  const argv = ['app'];
  const env = {};
  if (scenario.input === 'argv') argv.push('--drora-update-feed-url=' + override.url);
  if (scenario.input === 'env') env.DRORA_UPDATE_FEED_URL = override.url;
  if (scenario.input === 'deep-link') argv.push('--', 'zcode://x', '--drora-update-feed-url=' + override.url);
  // D5：本仓无 startup-config feed 覆盖机制（上游该函数随 manifest 链属删除面）。
  const updateFeedSource = null;
  const configPath = resolve(root, 'app-update.yml');
  await writeFile(configPath, 'provider: generic\\nurl: ' + trusted.url + '\\nupdaterCacheDirName: security-smoke\\n');
  autoUpdater.updateConfigPath = configPath;
  const completed = new Promise((done, fail) => {
    autoUpdater.once('update-not-available', done);
    autoUpdater.once('error', fail);
  });
  const handlers = new Map();
  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => { handlers.set(channel, handler); originalHandle(channel, handler); };
  const installOrder = [];
  let loginToken = null;
  let failCredentialRead = false;
  // D5：updateFeedSource/resolveDroraJwtToken/resolveEndpointOrigin 均为 manifest 链删除面，
  // 本仓 initAutoUpdater 不接收（feed 钉死于 app-update.yml、无 Bearer 鉴权）。
  await initAutoUpdater({ onBeforeQuitAndInstall: async () => { installOrder.push('prepare'); } });
  await completed;
  // 等待启动检查的 Promise 收口，再在同一更新器上验证登录、换账号和退出。
  await autoUpdater.checkForUpdates();
  for (const token of [' fixture-account-a ', 'fixture-account-b', '   ', 'bad' + String.fromCharCode(10) + 'token', '非ascii', null, 'fixture-recovered']) {
    loginToken = token;
    failCredentialRead = token === null;
    await autoUpdater.checkForUpdates();
    if (token?.trim() === 'fixture-account-a') {
      const provider = await autoUpdater.clientPromise;
      await autoUpdater.httpExecutor.download(new URL('/package.bin', trusted.url), resolve(root, 'package.bin'), {
        cancellationToken: new pkg.CancellationToken(),
        headers: autoUpdater.computeRequestHeaders(provider),
        sha512: createHash('sha512').update('update-auth-download-fixture').digest('base64'),
      });
    }
  }
  const signatureChecks = [];
  const cachedInstallChecks = [];
  if (autoUpdater instanceof pkg.NsisUpdater) {
    const childProcess = require('node:child_process');
    const original = childProcess.execFile;
    let signature = {status: 0, subject: 'CN=New Publisher, O=New Company, C=GB'};
    childProcess.execFile = (...args) => {
      installOrder.push('verify');
      const command = Buffer.from(args[1].at(-1), 'base64').toString('utf16le');
      const output = command.match(/\\$droraSignatureOutput='((?:[^'‘’‚‛]|(['‘’‚‛])\\2)*)';/)?.[1]?.replace(/(['‘’‚‛])\\1/g, '$1');
      if (!output) throw new Error('signature output path missing');
      void writeFile(output, '\\uFEFF' + JSON.stringify(signature), 'utf8').then(
        () => args.at(-1)(null, '', ''),
        error => args.at(-1)(error, '', ''),
      );
      return {};
    };
    try {
      // 包内仅有旧 DN，仍必须调用真实装配的自定义校验，不能因缺配置而免检。
      await writeFile(configPath, 'publisherName: ["CN=Old Publisher, O=Old Company, C=US"]\\n');
      // 修复依据：electron-updater 的 configOnDisk 是 Lazy 单例，init 期已按无 publisherName
      // 的配置解析并记忆，中途写文件不会触发重读——verifySignature 会走 publisherName==null
      // 早退 null（免检）。重设 updateConfigPath（setter 内部会重建 Lazy）使新配置可见。
      autoUpdater.updateConfigPath = configPath;
      signatureChecks.push(await autoUpdater.verifySignature('C:\\\\update.exe') === null);
      signature = {status: 2, subject: null};
      signatureChecks.push(await autoUpdater.verifySignature('C:\\\\update.exe') !== null);
      if (scenario.packaged) {
        // 已缓存包不会重走 NSIS 下载 hook，直接从真实 IPC 安装入口验证。
        const platform = Object.getOwnPropertyDescriptor(process, 'platform');
        Object.defineProperty(process, 'platform', {value: 'win32'});
        Object.defineProperty(autoUpdater, 'installerPath', {get: () => 'C:/cached/update.exe'});
        autoUpdater.checkForUpdates = async () => null;
        autoUpdater.quitAndInstall = () => installOrder.push('install');
        const install = handlers.get('drora:quit-and-install-update');
        try {
          installOrder.length = 0;
          autoUpdater.emit('update-downloaded', {version: '99.0.0'});
          await install().then(() => cachedInstallChecks.push(false), () => cachedInstallChecks.push(true));
          cachedInstallChecks.push(installOrder.join(',') === 'verify');
          signature = {status: 0, subject: 'CN=Renewed Publisher'};
          installOrder.length = 0;
          autoUpdater.emit('update-downloaded', {version: '99.0.0'});
          await Promise.all([install(), install()]);
          cachedInstallChecks.push(installOrder.join(',') === 'verify,prepare,install');
        } finally {Object.defineProperty(process, 'platform', platform);}
      }
    } finally { childProcess.execFile = original; }
  }
  const callbacks = ['zcode://oauth/callback?state=example&code=test', 'zcode://payment/callback?provider=example&channel=web&status=success', 'zcode://workspace/open?path=%2Ftmp%2Fexample', 'zcode://share/import?code=example'];
  const result = { cachedInstallChecks, signatureChecks, scenario: scenario.name, updaterType: autoUpdater.constructor.name, requests, autoDownload: autoUpdater.autoDownload, autoInstallOnAppQuit: autoUpdater.autoInstallOnAppQuit, callbacks: callbacks.map(url => extractDeepLinkUrlFromArgs(['app', '--', url]) === url) };
  await writeFile(resolve(root, 'result.json'), JSON.stringify(result, null, 2));
  console.log('UPDATE_SECURITY_RESULT=' + JSON.stringify(result));
  trusted.server.close(); override.server.close(); app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
`,
  },
  outfile: entryPath,
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron", "electron-updater", "semver"],
  // 修复原因（win32 + 子路径双缺陷）：上游用 alias 把 @drora/shared 指到 index.ts——
  // ① alias 值是 Windows 反斜杠路径时 esbuild 说明符解析失败；② esbuild 的 alias 会对
  // 子路径做前缀拼接（@drora/shared/credential-security → index.ts/credential-security），
  // 本仓 autoUpdater 依赖图经 services 引入多个 @drora/shared/<sub> 子路径（POSIX CI 同样
  // 会失败）。改为插件内显式解析：主入口映射 index.ts 并保留官方 origin 覆盖语义，
  // 子路径按 src/<sub>.ts → src/<sub>/index.ts 顺序落位。
  // v3.18.2 上游同步删除了 alias 行（与本仓插件显式解析方案收敛一致），注释保留载因。
  plugins: [
    {
      name: "security-smoke-official-origin",
      setup(api) {
        api.onResolve({ filter: /^security-smoke-origin$/ }, () => ({
          path: "origin",
          namespace: "security-origin",
        }));
        api.onLoad({ filter: /.*/, namespace: "security-origin" }, () => ({
          contents:
            "export let origin; export function setSecuritySmokeOrigin(value) { origin = value; }",
        }));
        api.onResolve({ filter: /^@drora\/shared$/ }, () => ({
          path: "shared",
          namespace: "security-shared",
        }));
        api.onLoad({ filter: /.*/, namespace: "security-shared" }, () => ({
          contents:
            "export * from " +
            JSON.stringify(toPosixSpecifier(resolve(repoRoot, "packages/shared/src/index.ts"))) +
            '; export { origin as DEFAULT_DRORA_ENDPOINT_ORIGIN } from "security-smoke-origin";',
          resolveDir: desktopDir,
        }));
        api.onResolve({ filter: /^@drora\/shared\// }, (args) => {
          const sub = args.path.slice("@drora/shared/".length);
          // 子路径入口以 packages/shared/package.json exports 为单一出处（credential-security
          // 等目录入口是 module.ts/contract.ts，不一定是 index.ts）。
          const mapped = sharedExports[`./${sub}`];
          assert.ok(mapped, `@drora/shared/${sub} 不在 shared exports 映射内`);
          return { path: toPosixSpecifier(resolve(repoRoot, "packages/shared", mapped)) };
        });
        // @napi-rs/keyring 的平台子包带 .node 二进制，无法进 bundle；smoke 在真实
        // Electron + packages/desktop/node_modules 下运行，运行时按 external 解析。
        api.onResolve({ filter: /^@napi-rs\/keyring/ }, (args) => ({ path: args.path, external: true }));
      },
    },
    ...(useAppImageUpdater || useNsisUpdater
      ? [
          {
            name: "isolated-platform-updater",
            setup(api) {
              api.onResolve({ filter: /^electron-updater$/ }, (args) =>
                args.namespace === "appimage"
                  ? { path: args.path, external: true }
                  : { path: args.path, namespace: "appimage" },
              );
              api.onLoad({ filter: /.*/, namespace: "appimage" }, () => ({
                contents:
                  'const upstream = require("electron-updater"); module.exports = { ...upstream, autoUpdater: new upstream.' +
                  (useNsisUpdater ? "NsisUpdater" : "AppImageUpdater") +
                  "() };",
              }));
            },
          },
        ]
      : []),
    {
      name: "isolated-logger",
      setup(api) {
        api.onResolve({ filter: /^\.\/logger\.js$/ }, (args) =>
          args.importer.replaceAll("\\", "/").endsWith("/autoUpdater.ts")
            ? { path: "logger", namespace: "smoke" }
            : undefined,
        );
        api.onLoad({ filter: /.*/, namespace: "smoke" }, () => ({
          contents:
            "export const logger = { info: console.log, warn: console.warn, error: console.error };",
        }));
      },
    },
    {
      // 修复原因（cjs 打包 × 本仓依赖图）：services/shared 侧 13 处 createRequire(import.meta.url)
      // 在 format=cjs 下 import.meta 被 esbuild 置空，模块加载即抛 ERR_INVALID_ARG_VALUE
      // （上游依赖图不含这些模块所以没暴露）。重写为 cjs 全局 __filename——require 解析
      // 基准变为 bundle 文件所在目录，对这些模块只用于裸说明符解析（原生模块等），语义等价。
      name: "security-smoke-cjs-import-meta",
      setup(api) {
        api.onLoad({ filter: /\.[cm]?tsx?$/ }, async (args) => {
          if (!/[\\/]packages[\\/]/.test(args.path)) return undefined;
          const source = await readFile(args.path, "utf8");
          if (!source.includes("import.meta.")) return undefined;
          const loader = args.path.endsWith(".tsx") ? "tsx" : "ts";
          return {
            contents: source
              .replaceAll("import.meta.url", "__filename")
              .replaceAll("import.meta.dirname", "__dirname"),
            loader,
            resolveDir: dirname(args.path),
          };
        });
      },
    },
  ],
});

const results = [];
for (const scenario of cases) {
  const root = resolve(artifactDir, scenario.name);
  await mkdir(root);
  const env = {
    ...process.env,
    DRORA_SECURITY_SCENARIO: JSON.stringify(scenario),
    DRORA_SECURITY_ROOT: root,
    NODE_PATH: resolve(repoRoot, "node_modules"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  if (useAppImageUpdater) delete env.APPIMAGE;
  const electronApp = await _electron.launch({
    executablePath: require("electron"),
    args: [entryPath],
    env,
  });
  let output = "";
  const child = electronApp.process();
  child.stdout?.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    output += chunk;
  });
  try {
    // app.exit 关闭调试连接；进程退出是这里的完成信号，不靠固定延时判断网络结果。
    if (child.exitCode === null) await onceExit(child);
    const { readFile } = await import("node:fs/promises");
    const result = JSON.parse(await readFile(resolve(root, "result.json"), "utf8"));
    results.push(result);
    await writeFile(resolve(artifactDir, "results.json"), JSON.stringify(results, null, 2));
    assert.deepEqual(
      result.requests.filter((item) => item.url !== "/package.bin").map((item) => item.label),
      Array(8).fill(scenario.expected),
      scenario.name,
    );
    // D5：无 jwt Bearer 链——所有 feed 请求都必须不带 Authorization（登录态不进更新通道）。
    assert.deepEqual(
      result.requests
        .filter((item) => item.url !== "/package.bin")
        .map((item) => item.headers.authorization ?? null),
      Array(8).fill(null),
      `${scenario.name}: feed requests must not carry authorization on the GitHub channel`,
    );
    assert.ok(
      !output.includes("sensitive-fixture-credential-error"),
      "credential errors must not leak into logs",
    );
    const downloadRequests = result.requests.filter((item) => item.url === "/package.bin");
    assert.equal(downloadRequests.length, 1);
    assert.equal(
      downloadRequests[0].headers.authorization,
      undefined,
      "download must not receive login token",
    );
    if (useAppImageUpdater) assert.equal(result.updaterType, "AppImageUpdater");
    if (useNsisUpdater) {
      assert.equal(result.updaterType, "NsisUpdater");
      assert.deepEqual(result.signatureChecks, [true, true]);
      if (scenario.packaged) assert.deepEqual(result.cachedInstallChecks, [true, true, true]);
    }
    assert.equal(result.autoDownload, false);
    assert.equal(result.autoInstallOnAppQuit, false);
    assert.ok(result.callbacks.every(Boolean));
    console.log(`PASS ${scenario.name}`);
  } finally {
    await writeFile(resolve(root, "runtime.log"), output);
    await electronApp.close().catch(() => {});
  }
}
console.log(`Evidence: ${artifactDir}`);

function onceExit(child) {
  return new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Electron security scenario timed out"));
    }, 30_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolveExit();
      else reject(new Error(`Electron exited ${code}`));
    });
  });
}
